import fs from "node:fs";
import path from "node:path";

/**
 * 数据源配置模型 v3 + 纯函数读写层。
 * 仅认 v3（{ sources: [...] }）；无模块级可变状态，路径与缓存由调用方（manager 实例）持有。
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

export type ValidateResult =
  | { ok: true; config: DynamicSourceConfig }
  | { ok: false; errors: string[] };

/** 旧格式兼容：仅取 sources[] 并规范化；其余顶层字段（含历史 v2 builtin 段）静默忽略 */
function normalizeConfig(parsed: unknown): DatasourcesConfig {
  if (!parsed || typeof parsed !== "object") return defaultConfig();
  const o = parsed as Record<string, unknown>;

  const sources: DynamicSourceConfig[] = Array.isArray(o.sources)
    ? o.sources
        .map(normalizeSourceEntry)
        .filter((s): s is DynamicSourceConfig => s !== null)
    : [];

  return { sources };
}

/** 读取配置文件；文件缺失/损坏返回空配置。 */
export function loadConfigFile(configPath: string): DatasourcesConfig {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return defaultConfig();
  }
}

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

/** 原子写：tmp + rename；同步 fs 调用单进程内天然串行 */
export function writeConfigFile(
  config: DatasourcesConfig,
  target: string
): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, target);
}

const SOURCE_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const URL_PATTERN = /^https?:\/\//;
const CONN_PATTERN = /^[\w+.-]+:\/\//;

/** 校验并规范化动态源配置（三种 kind 同构入口） */
export function validateSourceConfig(input: unknown): ValidateResult {
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

/** 新增或覆盖动态源（同 id 覆盖）；纯函数，返回新配置对象 */
export function upsertSource(
  config: DatasourcesConfig,
  source: DynamicSourceConfig
): DatasourcesConfig {
  const sources = [...config.sources];
  const idx = sources.findIndex((s) => s.id === source.id);
  if (idx >= 0) sources[idx] = source;
  else sources.push(source);
  return { sources };
}

/** 删除动态源；纯函数，返回新配置对象（不存在时内容不变） */
export function deleteSource(
  config: DatasourcesConfig,
  id: string
): DatasourcesConfig {
  return { sources: config.sources.filter((s) => s.id !== id) };
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
