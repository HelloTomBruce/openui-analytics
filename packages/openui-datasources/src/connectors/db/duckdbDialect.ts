import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";
import type { DbDialect, DbDialectClient } from "./dialect";
import { guardReadOnlySql } from "./dialect";

const QUERY_TIMEOUT_MS = 5000;

/** client → 底层连接，供 readOnlyQuery 超时中断使用（不暴露到接口上） */
const rawConnections = new WeakMap<DbDialectClient, DuckDBConnection>();

/** 归一化后的查询单元值：BigInt 已消除，可安全 JSON 序列化 */
export type NormalizedCell =
  | string
  | number
  | boolean
  | null
  | Date
  | NormalizedCell[]
  | { [key: string]: NormalizedCell };

/**
 * 值归一化：BIGINT 在 neo 客户端下是 JS BigInt，JSON.stringify 会直接抛错。
 * 安全整数转 Number，超范围转字符串；Date 交给 JSON 序列化为 ISO 字符串。
 */
function normalizeValue(value: unknown): NormalizedCell {
  if (typeof value === "bigint") {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) &&
      value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalizeValue(v)])
    );
  }
  return value as NormalizedCell;
}

function toObjects(
  columns: string[],
  rows: unknown[][]
): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(columns.map((c, i) => [c, normalizeValue(row[i])]))
  );
}

/**
 * DuckDB 方言：文件数据源（CSV/Excel 灌库）的进程内引擎。
 * 不进 DIALECTS 用户配置注册表，仅由 file 连接器内部使用；
 * connectionString 语义 = DuckDB 库文件路径。
 * 引擎层 access_mode=READ_ONLY 与词法层 guardReadOnlySql 双保险。
 */
export const duckdbDialect: DbDialect = {
  dbType: "duckdb",

  async connect(dbPath: string): Promise<DbDialectClient> {
    const instance = await DuckDBInstance.create(dbPath, {
      access_mode: "READ_ONLY",
    });
    const connection = await instance.connect();
    // 安全硬约束：查询连接禁用文件系统访问。词法层黑名单是为 pg/mysql
    // 设计的，而 DuckDB 表函数（read_csv_auto/glob/read_parquet 等）天然持有
    // 进程文件系统权限且都以 SELECT 开头——不封死则可读服务器任意文件。
    // 已开库文件的表扫描不走文件系统层，正常查询不受影响。
    await connection.run("SET disabled_filesystems = 'LocalFileSystem'");
    const client: DbDialectClient = {
      query: async (sql: string, params?: unknown[]) => {
        const result = await connection.run(
          sql,
          params as (string | number | boolean | null)[] | undefined
        );
        const rows = toObjects(result.columnNames(), await result.getRowsJS());
        return { rows, rowCount: result.rowCount };
      },
      close: async () => {
        connection.closeSync();
        instance.closeSync();
      },
    };
    rawConnections.set(client, connection);
    return client;
  },

  async listTables(client) {
    const res = await client.query(
      `SELECT table_name AS table
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY table_name`
    );
    return res.rows.map((r) => ({ table: String(r.table) }));
  },

  async describeTable(client, table) {
    const res = await client.query(
      `SELECT column_name AS column, data_type AS type
       FROM information_schema.columns
       WHERE table_name = ?
       ORDER BY ordinal_position`,
      [table]
    );
    return res.rows.map((r) => ({
      column: String(r.column),
      type: String(r.type),
    }));
  },

  async readOnlyQuery(client, sql) {
    const finalSql = guardReadOnlySql(sql);
    const raw = rawConnections.get(client);
    const timer = raw
      ? setTimeout(() => {
          try {
            raw.interrupt();
          } catch {
            // 已关闭的连接中断失败不阻断
          }
        }, QUERY_TIMEOUT_MS)
      : undefined;
    try {
      return await client.query(finalSql);
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  async ping(client) {
    await client.query("SELECT 1");
  },
};
