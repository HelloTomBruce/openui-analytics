import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pool } from "@/lib/postgres";
import { getGitLabMcpClient } from "./mcpClient";
import { DIALECTS } from "./db/dialect";

/**
 * 数据源注册表：内置三源 + 动态源（config/datasources.json v2）的读取、校验与 CRUD。
 * 所有健康检查带 3s 超时，任何失败都返回 { ok: false, error }，绝不抛错。
 *
 * v2 schema：
 *   builtin: { postgres/gitlab-mcp/zentao-cli: { enabled } }
 *   sources: [ { id, name, kind: "http-mcp", url, token?, enabled }
 *            | { id, name, kind: "db", dbType: "postgres"|"mysql", connectionString, enabled } ]
 * v1（无 builtin、sources 项无 enabled/token）读入时自动迁移，不落盘重写。
 * 写入走 tmp + rename 原子替换；读写均为同步 fs 调用，天然串行。
 */

export type BuiltinSourceId = "postgres" | "gitlab-mcp" | "zentao-cli";
export const BUILTIN_SOURCE_IDS: readonly BuiltinSourceId[] = [
  "postgres",
  "gitlab-mcp",
  "zentao-cli",
];

export interface HttpMcpSourceConfig {
  id: string;
  name: string;
  kind: "http-mcp";
  url: string;
  token?: string;
  enabled: boolean;
}

export interface DbSourceConfig {
  id: string;
  name: string;
  kind: "db";
  dbType: "postgres" | "mysql";
  connectionString: string;
  enabled: boolean;
}

export type DynamicSourceConfig = HttpMcpSourceConfig | DbSourceConfig;

export interface DatasourcesConfig {
  builtin: Record<BuiltinSourceId, { enabled: boolean }>;
  sources: DynamicSourceConfig[];
}

export interface DataSourceDescriptor {
  id: string;
  name: string;
  kind: "postgres" | "gitlab-mcp" | "zentao-cli" | "http-mcp" | "db";
  tools: string[];
  /** 全局启停；会话请求在此基础上再取交集 */
  enabled: boolean;
  builtin: boolean;
  dbType?: "postgres" | "mysql";
  /** 永不回传明文凭证：token 只暴露存在性，url/连接串只暴露脱敏形态 */
  hasToken?: boolean;
  maskedUrl?: string;
  maskedConnectionString?: string;
}

export interface HealthResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

const BUILTIN_SOURCES: (DataSourceDescriptor & { id: BuiltinSourceId })[] = [
  {
    id: "postgres",
    name: "PostgreSQL 分析库",
    kind: "postgres",
    tools: ["execute_sql", "list_tables", "describe_table"],
    enabled: true,
    builtin: true,
  },
  {
    id: "gitlab-mcp",
    name: "GitLab MCP (外部)",
    kind: "gitlab-mcp",
    tools: ["gitlab_*"],
    enabled: true,
    builtin: true,
  },
  {
    id: "zentao-cli",
    name: "ZenTao 禅道 CLI MCP (本地)",
    kind: "zentao-cli",
    tools: ["zentao_*"],
    enabled: true,
    builtin: true,
  },
];

const HEALTH_TIMEOUT_MS = 3000;

const DEFAULT_DATASOURCES_PATH = path.join(
  process.cwd(),
  "config",
  "datasources.json"
);

const DB_SOURCE_TOOLS = ["execute_sql", "list_tables", "describe_table"];

function defaultConfig(): DatasourcesConfig {
  return {
    builtin: {
      postgres: { enabled: true },
      "gitlab-mcp": { enabled: true },
      "zentao-cli": { enabled: true },
    },
    sources: [],
  };
}

/** 将 v1/v2 JSON 中的单个 source 条目规范化，不合法条目丢弃（不抛错） */
function normalizeSourceEntry(entry: unknown): DynamicSourceConfig | null {
  if (!entry || typeof entry !== "object") return null;
  const o = entry as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const name = typeof o.name === "string" ? o.name : "";
  if (!id || !name) return null;
  const enabled = o.enabled === undefined ? true : Boolean(o.enabled);
  if (o.kind === "http-mcp" && typeof o.url === "string" && o.url) {
    return {
      id,
      name,
      kind: "http-mcp",
      url: o.url,
      token: typeof o.token === "string" ? o.token : "",
      enabled,
    };
  }
  if (
    o.kind === "db" &&
    (o.dbType === "postgres" || o.dbType === "mysql") &&
    typeof o.connectionString === "string" &&
    o.connectionString
  ) {
    return {
      id,
      name,
      kind: "db",
      dbType: o.dbType,
      connectionString: o.connectionString,
      enabled,
    };
  }
  return null;
}

/** v1 声明式配置（{ sources: [{id,name,kind:"http-mcp",url,tools?}] }）与损坏输入统一迁移为 v2 */
function migrateToV2(parsed: unknown): DatasourcesConfig {
  const result = defaultConfig();
  if (!parsed || typeof parsed !== "object") return result;
  const o = parsed as Record<string, unknown>;

  if (o.builtin && typeof o.builtin === "object") {
    for (const id of BUILTIN_SOURCE_IDS) {
      const entry = (o.builtin as Record<string, unknown>)[id];
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { enabled?: unknown }).enabled === "boolean"
      ) {
        result.builtin[id] = { enabled: (entry as { enabled: boolean }).enabled };
      }
    }
  }

  if (Array.isArray(o.sources)) {
    result.sources = o.sources
      .map(normalizeSourceEntry)
      .filter((s): s is DynamicSourceConfig => s !== null);
  }
  return result;
}

function loadConfig(configPath: string): DatasourcesConfig {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return migrateToV2(JSON.parse(raw));
  } catch {
    return defaultConfig();
  }
}

let configCache: DatasourcesConfig | null = null;
let declarativePath = DEFAULT_DATASOURCES_PATH;

/**
 * 重新加载数据源配置（配置变更后调用；测试可传入临时路径）。
 */
export function reloadDataSources(
  configPath: string = DEFAULT_DATASOURCES_PATH
): void {
  declarativePath = configPath;
  configCache = null;
}

/**
 * 读取 v2 配置；v1 自动迁移。文件缺失/损坏返回全内置默认。
 * 传入 path 时从该文件读取（不走缓存）。
 */
export function readDatasourcesConfig(
  configPath?: string
): DatasourcesConfig {
  if (configPath) return loadConfig(configPath);
  if (configCache === null) configCache = loadConfig(declarativePath);
  return configCache;
}

/**
 * 原子写配置：tmp + rename。同步 fs 调用在单进程事件循环内天然串行。
 */
export function writeDatasourcesConfig(
  config: DatasourcesConfig,
  target: string = declarativePath
): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, target);
  if (target === declarativePath) {
    configCache = structuredClone(config);
  }
}

const SOURCE_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const URL_PATTERN = /^https?:\/\//;
const CONN_PATTERN = /^[\w+.-]+:\/\//;

/**
 * 校验并规范化动态源配置。id 需匹配 ^[a-z][a-z0-9-]{0,31}$ 且不得与内置冲突；
 * http-mcp 的 url 必须 http(s)://；db 的 dbType 仅 postgres|mysql、连接串必须是 URL 形式。
 */
export function validateDynamicSourceConfig(
  input: unknown
): { ok: true; config: DynamicSourceConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["配置必须是对象"] };
  }
  const o = input as Record<string, unknown>;

  const id = typeof o.id === "string" ? o.id : "";
  if (!SOURCE_ID_PATTERN.test(id)) {
    errors.push(`id 非法（需匹配 ^[a-z][a-z0-9-]{0,31}$）: "${id}"`);
  } else if ((BUILTIN_SOURCE_IDS as readonly string[]).includes(id)) {
    errors.push(`id 与内置数据源冲突: ${id}`);
  }

  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name) errors.push("name 不能为空");

  const enabled = o.enabled === undefined ? true : Boolean(o.enabled);

  if (o.kind === "http-mcp") {
    const url = typeof o.url === "string" ? o.url : "";
    if (!URL_PATTERN.test(url)) {
      errors.push("url 必须以 http:// 或 https:// 开头");
    }
    if (errors.length === 0) {
      return {
        ok: true,
        config: {
          id,
          name,
          kind: "http-mcp",
          url,
          token: typeof o.token === "string" ? o.token : "",
          enabled,
        },
      };
    }
  } else if (o.kind === "db") {
    const dbType =
      o.dbType === "postgres" || o.dbType === "mysql" ? o.dbType : undefined;
    const connectionString =
      typeof o.connectionString === "string" ? o.connectionString : "";
    if (!dbType) {
      errors.push("dbType 仅支持 postgres | mysql");
    }
    if (!CONN_PATTERN.test(connectionString)) {
      errors.push("connectionString 连接串非法（需 URL 形式且不能为空）");
    }
    if (dbType && errors.length === 0) {
      return {
        ok: true,
        config: { id, name, kind: "db", dbType, connectionString, enabled },
      };
    }
  } else {
    errors.push("kind 仅支持 http-mcp | db");
  }

  return { ok: false, errors };
}

/**
 * 新增或覆盖动态源（同 id 覆盖），写回配置文件并刷新缓存。
 */
export function upsertDynamicSource(
  config: DynamicSourceConfig,
  target: string = declarativePath
): void {
  declarativePath = target;
  const current = readDatasourcesConfig();
  const idx = current.sources.findIndex((s) => s.id === config.id);
  if (idx >= 0) current.sources[idx] = config;
  else current.sources.push(config);
  configCache = current;
  writeDatasourcesConfig(current, target);
}

/**
 * 删除动态源；存在并删除返回 true，不存在返回 false。
 */
export function deleteDynamicSource(
  id: string,
  target: string = declarativePath
): boolean {
  declarativePath = target;
  const current = readDatasourcesConfig();
  const idx = current.sources.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  current.sources.splice(idx, 1);
  configCache = current;
  writeDatasourcesConfig(current, target);
  return true;
}

/**
 * 设置内置源启停。
 */
export function setBuiltinEnabled(
  id: BuiltinSourceId,
  enabled: boolean,
  target: string = declarativePath
): void {
  declarativePath = target;
  const current = readDatasourcesConfig();
  current.builtin[id] = { enabled };
  configCache = current;
  writeDatasourcesConfig(current, target);
}

/**
 * 取当前激活配置中的动态源（供加载层与探活使用）。
 */
export function getDynamicSourceConfig(
  id: string
): DynamicSourceConfig | undefined {
  return readDatasourcesConfig().sources.find((s) => s.id === id);
}

/**
 * 脱敏连接串：隐藏密码部分。无密码或解析失败原样返回。
 */
export function maskConnectionString(conn: string): string {
  try {
    const u = new URL(conn);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return conn;
  }
}

/**
 * 脱敏 URL：去掉 query 与 userinfo，仅保留 protocol//host/pathname。
 */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * 动态源配置 → 脱敏描述符（POST/PATCH 响应与列表共用，避免两处映射漂移）。
 */
export function describeDynamicSource(
  config: DynamicSourceConfig
): DataSourceDescriptor {
  return config.kind === "http-mcp"
    ? {
        id: config.id,
        name: config.name,
        kind: "http-mcp" as const,
        tools: [],
        enabled: config.enabled,
        builtin: false,
        hasToken: Boolean(config.token),
        maskedUrl: maskUrl(config.url),
      }
    : {
        id: config.id,
        name: config.name,
        kind: "db" as const,
        tools: [...DB_SOURCE_TOOLS],
        enabled: config.enabled,
        builtin: false,
        dbType: config.dbType,
        maskedConnectionString: maskConnectionString(config.connectionString),
      };
}

export function listDataSources(): DataSourceDescriptor[] {
  const cfg = readDatasourcesConfig();
  const builtins: DataSourceDescriptor[] = BUILTIN_SOURCES.map((s) => ({
    ...s,
    enabled: cfg.builtin[s.id].enabled,
  }));
  return [...builtins, ...cfg.sources.map(describeDynamicSource)];
}

export interface ActiveSourceSummary {
  id: string;
  name: string;
  kind: DataSourceDescriptor["kind"];
  dbType?: "postgres" | "mysql";
  tools: string[];
}

/**
 * 会话请求的数据源 id 与「全局启用 ∩ 实际存在」取交集。
 * 未指定（undefined）视为全选启用源；未知/禁用 id 忽略并 console.warn。
 */
export function resolveActiveSources(
  requestedIds: string[] | undefined,
  cfg: DatasourcesConfig
): ActiveSourceSummary[] {
  const enabled = new Map<string, ActiveSourceSummary>();
  for (const builtin of BUILTIN_SOURCES) {
    if (!cfg.builtin[builtin.id].enabled) continue;
    enabled.set(builtin.id, {
      id: builtin.id,
      name: builtin.name,
      kind: builtin.kind,
      tools: builtin.tools,
    });
  }
  for (const s of cfg.sources) {
    if (!s.enabled) continue;
    enabled.set(
      s.id,
      s.kind === "http-mcp"
        ? { id: s.id, name: s.name, kind: "http-mcp", tools: [] }
        : {
            id: s.id,
            name: s.name,
            kind: "db",
            dbType: s.dbType,
            tools: [...DB_SOURCE_TOOLS],
          }
    );
  }

  if (requestedIds === undefined) return [...enabled.values()];
  return requestedIds.flatMap((id) => {
    const hit = enabled.get(id);
    if (hit) return [hit];
    console.warn(`[datasources] 忽略未知或未启用的数据源 id: ${id}`);
    return [];
  });
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

async function probePostgres(): Promise<void> {
  await pool.query("SELECT 1");
}

async function probeGitLabMcp(endpoint?: string, token?: string): Promise<void> {
  const client = await getGitLabMcpClient(endpoint, token);
  await client.listTools();
}

function probeZentaoCli(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("zentao", ["--help"], { timeout: HEALTH_TIMEOUT_MS }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** 探活可选配置：GitLab 源使用调用方（页面设置）的 endpoint/token，与 /api/analyze 实际使用的配置保持一致 */
export interface ProbeOptions {
  gitlabUrl?: string;
  gitlabToken?: string;
}

const PROBES: Record<string, (opts?: ProbeOptions) => Promise<void>> = {
  postgres: probePostgres,
  "gitlab-mcp": (opts) => probeGitLabMcp(opts?.gitlabUrl, opts?.gitlabToken),
  "zentao-cli": probeZentaoCli,
};

async function probeHttpMcp(url: string): Promise<void> {
  const res = await fetch(url, { method: "GET" });
  // MCP endpoint 可能对裸 GET 返回 4xx，但只要服务可达即视为存活
  if (res.status >= 500) {
    throw new Error(`HTTP ${res.status}`);
  }
}

export async function checkDataSourceHealth(
  id: string,
  opts?: ProbeOptions
): Promise<HealthResult> {
  const probe = PROBES[id];
  const startedAt = Date.now();
  if (!probe) {
    // 动态数据源：http-mcp 对配置 url 做可达性探测；db 源经方言 connect→ping→close 探活
    const dyn = getDynamicSourceConfig(id);
    if (dyn?.kind === "http-mcp") {
      try {
        await withTimeout(probeHttpMcp(dyn.url), HEALTH_TIMEOUT_MS);
        return { ok: true, latencyMs: Date.now() - startedAt };
      } catch (err) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    if (dyn?.kind === "db") {
      try {
        const dialect = DIALECTS[dyn.dbType];
        const dbClient = await withTimeout(
          dialect.connect(dyn.connectionString),
          HEALTH_TIMEOUT_MS
        );
        try {
          await withTimeout(dialect.ping(dbClient), HEALTH_TIMEOUT_MS);
        } finally {
          await dbClient.close().catch(() => {});
        }
        return { ok: true, latencyMs: Date.now() - startedAt };
      } catch (err) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    return { ok: false, latencyMs: 0, error: "unknown datasource" };
  }
  try {
    await withTimeout(probe(opts), HEALTH_TIMEOUT_MS);
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
