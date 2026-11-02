import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { DbDialect, DbDialectClient, DbQueryResult } from "./dialect";
import { guardReadOnlySql } from "./sqlGuard";

/**
 * ClickHouse 方言：@clickhouse/client（HTTP 协议）。
 *
 * 连接串：`http(s)://[user[:password]@]host:8123[/database]`（userinfo 或
 * query 里的 user/password 均可）。
 *
 * 只读双保险：DbDialectClient.query 封装对**所有**查询统一附加
 * settings.readonly=1（服务端拒绝写语句），readOnlyQuery 再叠加
 * guardReadOnlySql 词法守卫（给出友好报错）。
 */

interface ParsedClickhouseUrl {
  url: string;
  username: string;
  password: string;
  database?: string;
}

/** 连接串解析：userinfo 凭证 + 路径首段为库名（非 http(s) 抛友好错误） */
export function parseClickhouseUrl(connectionString: string): ParsedClickhouseUrl {
  let u: URL;
  try {
    u = new URL(connectionString);
  } catch {
    throw new Error("ClickHouse 连接串必须是 http(s):// URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("ClickHouse 连接串必须是 http(s):// URL");
  }
  const username = u.username || (u.searchParams.get("user") ?? "default");
  const password = u.password || (u.searchParams.get("password") ?? "");
  const database =
    u.searchParams.get("database") ??
    (u.pathname && u.pathname !== "/"
      ? decodeURIComponent(u.pathname.replace(/^\/|\/$/g, ""))
      : undefined);
  // 重建干净的 base url（去 userinfo/path/query，只留 origin）
  return { url: u.origin, username, password, database };
}

/** CH 参数绑定只支持命名值：表名走白名单断言 + 引用插值 */
function assertSafeChIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) {
    throw new Error(`非法表名标识符: ${JSON.stringify(name)}`);
  }
  return name;
}

interface ChJsonShape<T> {
  data: T[];
  rows: number;
}
type ChJson<T> = ChJsonShape<T> & Record<string, unknown>;

/** 真实 Client → 方言客户端封装：统一 JSON 格式 + readonly=1 + 命名参数 */
function wrapChClient(client: ClickHouseClient): DbDialectClient {
  return {
    query: async (sql: string, params?: unknown[]): Promise<DbQueryResult> => {
      // 方言内部查询统一走 {pN: Type} 命名参数（CH 不支持匿名 ?）
      const named: Record<string, unknown> = {};
      (params ?? []).forEach((v, i) => {
        named[`p${i}`] = v;
      });
      const rs = await client.query({
        query: sql,
        format: "JSON",
        ...(Object.keys(named).length > 0 ? { query_params: named } : {}),
        // CH 引擎级只读：请求附带 readonly=1，服务端拒绝一切写语句
        clickhouse_settings: { readonly: "1" },
      });
      const json = await rs.json<ChJson<Record<string, unknown>>>();
      return { rows: json.data, rowCount: json.rows ?? json.data.length };
    },
    close: async () => {
      await client.close().catch(() => {});
    },
  };
}

export const clickhouseDialect: DbDialect = {
  dbType: "clickhouse",

  async connect(connectionString: string): Promise<DbDialectClient> {
    // parseClickhouseUrl 已完成协议校验（http/https）与凭证/库名解析
    const parsed = parseClickhouseUrl(connectionString);
    const client = createClient({
      url: parsed.url,
      username: parsed.username,
      password: parsed.password,
      ...(parsed.database ? { database: parsed.database } : {}),
      request_timeout: 10_000,
    });
    const wrapped = wrapChClient(client);
    // fail-fast：连接串错误（协议/主机/端口/凭证）在此暴露而非首次查询
    await wrapped.query("SELECT 1 AS one");
    return wrapped;
  },

  async listTables(client) {
    // SHOW TABLES 走当前库，无需库名注入
    const res = await client.query("SHOW TABLES");
    return res.rows.map((r) => ({ table: String(r.name) }));
  },

  async describeTable(client, table) {
    const safe = assertSafeChIdentifier(table);
    const res = await client.query(`DESCRIBE TABLE "${safe}"`);
    return res.rows.map((r) => ({
      column: String(r.name),
      type: String(r.type),
    }));
  },

  async readOnlyQuery(client, sql) {
    // 词法守卫（友好报错）→ readonly=1 已在 query 封装内（服务端硬约束）
    const finalSql = guardReadOnlySql(sql);
    return client.query(finalSql);
  },

  async ping(client) {
    await client.query("SELECT 1 AS one");
  },
};
