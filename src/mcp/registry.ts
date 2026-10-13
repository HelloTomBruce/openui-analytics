import fs from "node:fs";
import path from "node:path";
import { DIALECTS } from "./db/dialect";
import { probeStdioCli } from "./stdioMcp";

/**
 * 数据源注册表 v3：所有数据源一律为用户动态配置，无内置概念。
 * kind = http-mcp | db | stdio-cli；写入 tmp+rename 原子替换。
 * v2（含 builtin 段）读时迁移：zentao-cli 种子化 stdio 源、gitlab-mcp 在 env
 * GITLAB_MCP_URL 存在时种子化、postgres 丢弃（演示库移除）。
 */

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

export interface StdioCliSourceConfig {
  id: string;
  name: string;
  kind: "stdio-cli";
  command: string;
  args?: string[];
  enabled: boolean;
}

export type DynamicSourceConfig =
  | HttpMcpSourceConfig
  | DbSourceConfig
  | StdioCliSourceConfig;

export interface DatasourcesConfig {
  sources: DynamicSourceConfig[];
}

export interface DataSourceDescriptor {
  id: string;
  name: string;
  kind: "http-mcp" | "db" | "stdio-cli";
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

const HEALTH_TIMEOUT_MS = 3000;

const DEFAULT_DATASOURCES_PATH = path.join(
  process.cwd(),
  "config",
  "datasources.json"
);

const DB_SOURCE_TOOLS = ["execute_sql", "list_tables", "describe_table"];

/** v2 builtin 段的迁移种子定义（读时一次性，不落盘重写 v2 文件） */
const ZENTAO_SEED: StdioCliSourceConfig = {
  id: "zentao-cli",
  name: "ZenTao 禅道 CLI MCP (本地)",
  kind: "stdio-cli",
  command: "zentao",
  args: ["mcp", "--read-only"],
  enabled: true,
};

function defaultConfig(): DatasourcesConfig {
  return { sources: [] };
}

/** 单个 source 条目规范化，不合法条目丢弃（不抛错） */
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
  if (o.kind === "stdio-cli" && typeof o.command === "string" && o.command) {
    const args = Array.isArray(o.args)
      ? o.args.filter((a): a is string => typeof a === "string")
      : undefined;
    return { id, name, kind: "stdio-cli", command: o.command, args, enabled };
  }
  return null;
}

/** v2/v3 统一迁移：v2（有 builtin 段）按种子规则转换；损坏输入返回空配置 */
function migrateConfig(parsed: unknown): DatasourcesConfig {
  if (!parsed || typeof parsed !== "object") return defaultConfig();
  const o = parsed as Record<string, unknown> & {
    builtin?: Record<string, { enabled?: boolean }>;
  };

  const sources: DynamicSourceConfig[] = Array.isArray(o.sources)
    ? o.sources
        .map(normalizeSourceEntry)
        .filter((s): s is DynamicSourceConfig => s !== null)
    : [];

  // v2 builtin 段存在 → 迁移种子
  if (o.builtin && typeof o.builtin === "object") {
    if (o.builtin["zentao-cli"]?.enabled) {
      sources.push({ ...ZENTAO_SEED });
    }
    const gitlabUrl = process.env.GITLAB_MCP_URL;
    if (o.builtin["gitlab-mcp"]?.enabled && gitlabUrl) {
      sources.push({
        id: "gitlab-mcp",
        name: "GitLab MCP (外部)",
        kind: "http-mcp",
        url: gitlabUrl,
        token:
          process.env.GITLAB_TOKEN ||
          process.env.GITLAB_API_KEY ||
          "",
        enabled: true,
      });
    }
    // builtin.postgres：演示库已移除，丢弃
  }

  return { sources };
}

function loadConfig(configPath: string): DatasourcesConfig {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return migrateConfig(JSON.parse(raw));
  } catch {
    return defaultConfig();
  }
}

let configCache: DatasourcesConfig | null = null;
let declarativePath = DEFAULT_DATASOURCES_PATH;

/** 重新加载配置（测试可传入临时路径） */
export function reloadDataSources(
  configPath: string = DEFAULT_DATASOURCES_PATH
): void {
  declarativePath = configPath;
  configCache = null;
}

/** 读取配置；v2 自动迁移；文件缺失/损坏返回空配置。传 path 时不走缓存。 */
export function readDatasourcesConfig(
  configPath?: string
): DatasourcesConfig {
  if (configPath) return loadConfig(configPath);
  if (configCache === null) configCache = loadConfig(declarativePath);
  return configCache;
}

/** 原子写：tmp + rename；同步 fs 调用单进程内天然串行 */
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

/** 校验并规范化动态源配置（三种 kind 同构入口） */
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
    if (!dbType) errors.push("dbType 仅支持 postgres | mysql");
    if (!CONN_PATTERN.test(connectionString)) {
      errors.push("connectionString 连接串非法（需 URL 形式且不能为空）");
    }
    if (dbType && errors.length === 0) {
      return {
        ok: true,
        config: { id, name, kind: "db", dbType, connectionString, enabled },
      };
    }
  } else if (o.kind === "stdio-cli") {
    const command = typeof o.command === "string" ? o.command.trim() : "";
    if (!command) errors.push("command 不能为空");
    const rawArgs = Array.isArray(o.args) ? o.args : [];
    if (rawArgs.some((a) => typeof a !== "string")) {
      errors.push("args 必须是字符串数组");
    }
    if (command && errors.length === 0) {
      const args = rawArgs.map(String).filter((a) => a.length > 0);
      return {
        ok: true,
        config: { id, name, kind: "stdio-cli", command, args, enabled },
      };
    }
  } else {
    errors.push("kind 仅支持 http-mcp | db | stdio-cli");
  }

  return { ok: false, errors };
}

/** 新增或覆盖动态源（同 id 覆盖） */
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

/** 删除动态源；存在并删除返回 true */
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

/** 取当前配置中的某个源（供加载层与探活使用） */
export function getDynamicSourceConfig(
  id: string
): DynamicSourceConfig | undefined {
  return readDatasourcesConfig().sources.find((s) => s.id === id);
}

/** 脱敏连接串：隐藏密码；无密码或解析失败原样返回 */
export function maskConnectionString(conn: string): string {
  try {
    const u = new URL(conn);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return conn;
  }
}

/** 脱敏 URL：去 query 与 userinfo，仅保留 protocol//host/pathname */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url;
  }
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
  return {
    id: config.id,
    name: config.name,
    kind: "stdio-cli",
    tools: [],
    enabled: config.enabled,
    command: config.command,
  };
}

export function listDataSources(): DataSourceDescriptor[] {
  return readDatasourcesConfig().sources.map(describeDynamicSource);
}

export interface ActiveSourceSummary {
  id: string;
  name: string;
  kind: DataSourceDescriptor["kind"];
  dbType?: "postgres" | "mysql";
  tools: string[];
}

/** 会话请求的源 id 与「全局启用 ∩ 实际存在」取交集；未知/禁用 id 忽略并告警 */
export function resolveActiveSources(
  requestedIds: string[] | undefined,
  cfg: DatasourcesConfig
): ActiveSourceSummary[] {
  const enabled = new Map<string, ActiveSourceSummary>();
  for (const s of cfg.sources) {
    if (!s.enabled) continue;
    const summary: ActiveSourceSummary = {
      id: s.id,
      name: s.name,
      kind: s.kind,
      tools: s.kind === "db" ? [...DB_SOURCE_TOOLS] : [],
      ...(s.kind === "db" ? { dbType: s.dbType } : {}),
    };
    enabled.set(s.id, summary);
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

async function probeHttpMcp(url: string): Promise<void> {
  const res = await fetch(url, { method: "GET" });
  if (res.status >= 500) {
    throw new Error(`HTTP ${res.status}`);
  }
}

export async function checkDataSourceHealth(
  id: string
): Promise<HealthResult> {
  const startedAt = Date.now();
  const dyn = getDynamicSourceConfig(id);
  if (!dyn) {
    return { ok: false, latencyMs: 0, error: "unknown datasource" };
  }
  try {
    if (dyn.kind === "http-mcp") {
      await withTimeout(probeHttpMcp(dyn.url), HEALTH_TIMEOUT_MS);
    } else if (dyn.kind === "db") {
      const dialect = DIALECTS[dyn.dbType];
      const client = await withTimeout(
        dialect.connect(dyn.connectionString),
        HEALTH_TIMEOUT_MS
      );
      try {
        await withTimeout(dialect.ping(client), HEALTH_TIMEOUT_MS);
      } finally {
        await client.close().catch(() => {});
      }
    } else {
      await withTimeout(
        probeStdioCli(dyn.command, dyn.args ?? []),
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
}
