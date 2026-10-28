import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { connectHttpMcp } from "./connectors/http";
import { connectStdioMcp, probeStdioCli } from "./connectors/stdio";
import { DIALECTS, type DbDialect, type DbDialectClient } from "./connectors/db/dialect";
import { duckdbDialect } from "./connectors/db/duckdbDialect";
import { createDbMcpServer } from "./connectors/db/dbMcpServer";
import {
  readManifest,
  duckDbPath,
  ingestSourceFiles,
  removeSourceFiles,
  type FileSourceManifest,
  type FileSourceUpload,
} from "./connectors/file/fileStore";
import { parseMcpToolResult } from "./parseToolResult";
import {
  loadConfigFile,
  writeConfigFile,
  validateSourceConfig,
  upsertSource,
  deleteSource,
  maskUrl,
  maskConnectionString,
  type DynamicSourceConfig,
  type DatasourcesConfig,
  type ValidateResult,
} from "./config";

/**
 * 数据源门面：配置读写（委托 config 纯函数）+ 连接装配与键控缓存。
 * 全部状态为实例私有（配置缓存 + 连接缓存），无模块级可变状态。
 */

export interface DataSourceDescriptor {
  id: string;
  name: string;
  kind: "http-mcp" | "db" | "stdio-cli" | "file";
  tools: string[];
  enabled: boolean;
  dbType?: "postgres" | "mysql";
  /** 永不回传明文凭证：token 只暴露存在性，url/连接串只暴露脱敏形态 */
  hasToken?: boolean;
  maskedUrl?: string;
  maskedConnectionString?: string;
  /** stdio 源的命令非机密，可回传用于编辑展示 */
  command?: string;
}

export interface HealthResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ActiveSourceSummary {
  id: string;
  name: string;
  kind: DataSourceDescriptor["kind"];
  dbType?: "postgres" | "mysql";
  tools: string[];
}

/** SDK 无关的 MCP 连接：三种 kind（远程/子进程/内存 DB Server）统一形态 */
export interface McpConnection {
  listTools(): Promise<
    { name: string; description?: string; inputSchema?: unknown }[]
  >;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/** 工具绑定：注册名带 `<id>_` 前缀，MCP 侧调用用 originalName */
export interface McpToolBinding {
  name: string;
  originalName: string;
  description?: string;
  inputSchema?: unknown;
  call(args: Record<string, unknown>): Promise<unknown>;
}

export interface DatasourceManager {
  readConfig(): DatasourcesConfig;
  writeConfig(c: DatasourcesConfig): void;
  validate(s: DynamicSourceConfig): ValidateResult;
  upsert(s: DynamicSourceConfig): DatasourcesConfig;
  delete(id: string): DatasourcesConfig;
  get(id: string): DynamicSourceConfig | undefined;
  list(): DataSourceDescriptor[];
  connect(s: DynamicSourceConfig): Promise<McpConnection>;
  tools(s: DynamicSourceConfig): Promise<McpToolBinding[]>;
  close(id: string): Promise<void>;
  health(s: DynamicSourceConfig): Promise<HealthResult>;
  resolveActive(ids: string[] | undefined): ActiveSourceSummary[];
  /**
   * 文件源灌库：完全覆盖语义。先关闭并失效缓存连接（旧库文件句柄），
   * staging 构建成功后整体替换；失败时旧数据保留、连接缓存已失效。
   */
  ingestFiles(
    id: string,
    uploads: FileSourceUpload[]
  ): Promise<FileSourceManifest>;
  /** 文件源 manifest（未上传返回 null） */
  filesManifest(id: string): Promise<FileSourceManifest | null>;
  /** 删除文件源全部落盘内容（调用方负责先 close） */
  removeFiles(id: string): Promise<void>;
}

const DB_SOURCE_TOOLS = ["execute_sql", "list_tables", "describe_table"];
const HEALTH_TIMEOUT_MS = 3000;

interface ConnCacheEntry {
  key: string;
  connection: McpConnection;
  /** 已构建的工具绑定缓存：配置不变时零额外 listTools 往返（与旧 CacheEntry 同语义） */
  bindings?: McpToolBinding[];
}

/** 缓存键 = 完整配置的 JSON 形态；配置变更即视为不同连接 */
function configKey(source: DynamicSourceConfig): string {
  if (source.kind === "http-mcp")
    return JSON.stringify(["http-mcp", source.url, source.token ?? ""]);
  if (source.kind === "db")
    return JSON.stringify(["db", source.dbType, source.connectionString]);
  if (source.kind === "file") return JSON.stringify(["file", source.id]);
  return JSON.stringify(["stdio-cli", source.command, source.args ?? []]);
}

function wrapClient(client: Pick<Client, "listTools" | "callTool" | "close">): McpConnection {
  return {
    listTools: async () => {
      const { tools } = await client.listTools();
      return tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },
    callTool: (name, args) => client.callTool({ name, arguments: args }),
    close: async () => {
      try {
        await client.close();
      } catch {
        // 关闭失败不阻断
      }
    },
  };
}

async function connectHttpSource(
  source: Extract<DynamicSourceConfig, { kind: "http-mcp" }>
): Promise<McpConnection> {
  const headers: Record<string, string> = source.token
    ? { Authorization: `Bearer ${source.token}` }
    : {};
  const client = await connectHttpMcp(
    `openui-dynamic-${source.id}`,
    source.url,
    headers
  );
  return wrapClient(client);
}

async function connectStdioSource(
  source: Extract<DynamicSourceConfig, { kind: "stdio-cli" }>
): Promise<McpConnection> {
  const client = await connectStdioMcp(
    `openui-dynamic-${source.id}`,
    source.command,
    source.args ?? []
  );
  return wrapClient(client);
}

/** 方言 → 进程内 MCP 连接装配（db 与 file 源共用） */
async function connectDialectMcp(
  dialect: DbDialect,
  dbClient: DbDialectClient,
  clientName: string,
  sourceName: string
): Promise<McpConnection> {
  const server = createDbMcpServer(dialect, dbClient, sourceName);
  const mcpClient = new Client(
    { name: clientName, version: "1.0.0" },
    { capabilities: {} }
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return {
    listTools: async () => {
      const { tools } = await mcpClient.listTools();
      return tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },
    callTool: (name, args) => mcpClient.callTool({ name, arguments: args }),
    close: async () => {
      // 逐层关闭，任一失败不阻断其余
      for (const closeFn of [
        () => mcpClient.close(),
        () => server.close(),
        () => dbClient.close(),
      ]) {
        try {
          await closeFn();
        } catch {
          // ignore
        }
      }
    },
  };
}

async function connectDbSource(
  source: Extract<DynamicSourceConfig, { kind: "db" }>
): Promise<McpConnection> {
  const dialect = DIALECTS[source.dbType];
  const dbClient = await dialect.connect(source.connectionString);
  return connectDialectMcp(
    dialect,
    dbClient,
    `openui-dynamic-${source.id}`,
    source.name
  );
}

async function connectFileSource(
  source: Extract<DynamicSourceConfig, { kind: "file" }>,
  filesDir: string
): Promise<McpConnection> {
  const manifest = await readManifest(filesDir, source.id);
  if (!manifest) {
    throw new Error(`文件数据源尚未上传文件: ${source.id}`);
  }
  const dbClient = await duckdbDialect.connect(duckDbPath(filesDir, source.id));
  return connectDialectMcp(
    duckdbDialect,
    dbClient,
    `openui-dynamic-${source.id}`,
    source.name
  );
}

/** 配置 → 脱敏描述符（API 响应与列表共用） */
export function describeDynamicSource(
  config: DynamicSourceConfig
): DataSourceDescriptor {
  if (config.kind === "http-mcp") {
    return {
      id: config.id,
      name: config.name,
      kind: "http-mcp",
      tools: [],
      enabled: config.enabled,
      hasToken: Boolean(config.token),
      maskedUrl: maskUrl(config.url),
    };
  }
  if (config.kind === "db") {
    return {
      id: config.id,
      name: config.name,
      kind: "db",
      tools: [...DB_SOURCE_TOOLS],
      enabled: config.enabled,
      dbType: config.dbType,
      maskedConnectionString: maskConnectionString(config.connectionString),
    };
  }
  if (config.kind === "file") {
    return {
      id: config.id,
      name: config.name,
      kind: "file",
      tools: [...DB_SOURCE_TOOLS],
      enabled: config.enabled,
    };
  }
  return {
    id: config.id,
    name: config.name,
    kind: "stdio-cli",
    tools: [],
    enabled: config.enabled,
    command: config.command,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`健康检查超时（>${ms}ms）`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function probeHttpMcp(url: string): Promise<void> {
  const res = await fetch(url, { method: "GET" });
  if (res.status >= 500) {
    throw new Error(`HTTP ${res.status}`);
  }
}

export function createDatasourceManager(opts: {
  configPath: string;
  /** 文件数据源落盘根目录；默认 <configPath 同级>/../data/files */
  filesDir?: string;
}): DatasourceManager {
  const { configPath } = opts;
  const filesDir =
    opts.filesDir ?? path.join(path.dirname(configPath), "..", "data", "files");
  let configCache: DatasourcesConfig | null = null;
  const connCache = new Map<string, ConnCacheEntry>();
  /**
   * 按源 id 的灌库串行链：staging 目录名同源同进程相同，
   * 并发上传会互相抹除进行中构建并竞态交换，必须排队。
   */
  const ingestChains = new Map<string, Promise<unknown>>();

  const readConfig = (): DatasourcesConfig => {
    if (configCache === null) configCache = loadConfigFile(configPath);
    return configCache;
  };

  const syncConfig = (c: DatasourcesConfig): void => {
    configCache = c;
  };

  const getOrConnectEntry = async (
    source: DynamicSourceConfig
  ): Promise<ConnCacheEntry> => {
    const key = configKey(source);
    const cached = connCache.get(source.id);
    if (cached && cached.key === key) return cached;

    if (cached) {
      connCache.delete(source.id);
      try {
        await cached.connection.close();
      } catch {
        // ignore
      }
    }

    const connection =
      source.kind === "http-mcp"
        ? await connectHttpSource(source)
        : source.kind === "db"
          ? await connectDbSource(source)
          : source.kind === "file"
            ? await connectFileSource(source, filesDir)
            : await connectStdioSource(source);
    const entry: ConnCacheEntry = { key, connection };
    connCache.set(source.id, entry);
    return entry;
  };

  return {
    readConfig,
    writeConfig(c) {
      writeConfigFile(c, configPath);
      syncConfig(c);
    },
    validate: (s) => validateSourceConfig(s),
    upsert(s) {
      const next = upsertSource(readConfig(), s);
      writeConfigFile(next, configPath);
      syncConfig(next);
      return next;
    },
    delete(id) {
      const next = deleteSource(readConfig(), id);
      writeConfigFile(next, configPath);
      syncConfig(next);
      return next;
    },
    get(id) {
      return readConfig().sources.find((s) => s.id === id);
    },
    list() {
      return readConfig().sources.map(describeDynamicSource);
    },
    connect: (s) => getOrConnectEntry(s).then((e) => e.connection),
    async tools(source) {
      const entry = await getOrConnectEntry(source);
      if (entry.bindings) return entry.bindings;
      const connection = entry.connection;
      const mcpTools = await connection.listTools();
      const logPrefix = `Dynamic ${source.id}`;
      const bindings = mcpTools.map((t) => ({
        name: `${source.id}_${t.name}`,
        originalName: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        call: async (args: Record<string, unknown>) => {
          console.log(`[${logPrefix}] execute ${t.name}:`, args);
          const res = await connection.callTool(t.name, args);
          return parseMcpToolResult(res, `MCP tool ${t.name}`);
        },
      }));
      entry.bindings = bindings;
      return bindings;
    },
    async close(id) {
      const entry = connCache.get(id);
      if (!entry) return;
      connCache.delete(id);
      try {
        await entry.connection.close();
      } catch {
        // ignore
      }
    },
    async health(s) {
      const startedAt = Date.now();
      try {
        if (s.kind === "http-mcp") {
          await withTimeout(probeHttpMcp(s.url), HEALTH_TIMEOUT_MS);
        } else if (s.kind === "db") {
          const dialect = DIALECTS[s.dbType];
          const client = await withTimeout(
            dialect.connect(s.connectionString),
            HEALTH_TIMEOUT_MS
          );
          try {
            await withTimeout(dialect.ping(client), HEALTH_TIMEOUT_MS);
          } finally {
            await client.close().catch(() => {});
          }
        } else if (s.kind === "file") {
          const manifest = await readManifest(filesDir, s.id);
          if (!manifest) throw new Error("尚未上传文件");
          const client = await withTimeout(
            duckdbDialect.connect(duckDbPath(filesDir, s.id)),
            HEALTH_TIMEOUT_MS
          );
          try {
            await withTimeout(duckdbDialect.ping(client), HEALTH_TIMEOUT_MS);
          } finally {
            await client.close().catch(() => {});
          }
        } else {
          await withTimeout(
            probeStdioCli(s.command, s.args ?? []),
            HEALTH_TIMEOUT_MS
          );
        }
        return { ok: true, latencyMs: Date.now() - startedAt };
      } catch (err) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    resolveActive(ids) {
      const cfg = readConfig();
      const enabled = new Map<string, ActiveSourceSummary>();
      for (const s of cfg.sources) {
        if (!s.enabled) continue;
        const summary: ActiveSourceSummary = {
          id: s.id,
          name: s.name,
          kind: s.kind,
          tools:
            s.kind === "db" || s.kind === "file" ? [...DB_SOURCE_TOOLS] : [],
          ...(s.kind === "db" ? { dbType: s.dbType } : {}),
        };
        enabled.set(s.id, summary);
      }
      if (ids === undefined) return [...enabled.values()];
      return ids.flatMap((id) => {
        const hit = enabled.get(id);
        if (hit) return [hit];
        console.warn(`[datasources] 忽略未知或未启用的数据源 id: ${id}`);
        return [];
      });
    },
    async ingestFiles(id, uploads) {
      // 校验在链外快速失败（只读配置，无共享状态）
      const source = readConfig().sources.find((s) => s.id === id);
      if (!source) throw new Error(`数据源不存在: ${id}`);
      if (source.kind !== "file") {
        throw new Error(`数据源 ${id} 不是文件类型（kind=${source.kind}）`);
      }
      const prev = ingestChains.get(id) ?? Promise.resolve();
      const task = prev.catch(() => {}).then(async () => {
        // 先失效缓存连接（持有旧库文件句柄），再 staging 灌库整体替换
        const entry = connCache.get(id);
        if (entry) {
          connCache.delete(id);
          try {
            await entry.connection.close();
          } catch {
            // 关闭失败不阻断灌库
          }
        }
        return ingestSourceFiles(filesDir, id, uploads);
      });
      ingestChains.set(id, task);
      try {
        return await task;
      } finally {
        if (ingestChains.get(id) === task) ingestChains.delete(id);
      }
    },
    filesManifest(id) {
      return readManifest(filesDir, id);
    },
    removeFiles(id) {
      return removeSourceFiles(filesDir, id);
    },
  };
}

/**
 * 合并工具集：同名工具后注册者跳过并告警（动态源按配置顺序注册）。
 */
export function mergeToolSets(
  target: Record<string, unknown>,
  incoming: Record<string, unknown>,
  sourceId: string
): void {
  for (const [name, t] of Object.entries(incoming)) {
    if (name in target) {
      console.warn(
        `[dynamicSources] 工具名冲突，跳过 ${name}（来自 ${sourceId}）`
      );
      continue;
    }
    target[name] = t;
  }
}
