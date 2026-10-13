import { Pool } from "pg";
import type { DbDialect, DbDialectClient, DbQueryResult } from "./dialect";
import { guardReadOnlySql } from "./dialect";

/**
 * PostgreSQL 方言：独立于应用 demo 库（@/lib/postgres 的单例 pool），
 * 每个动态 pg 源持有自己的小连接池。
 */
export const postgresDialect: DbDialect = {
  dbType: "postgres",

  async connect(connectionString: string): Promise<DbDialectClient> {
    const pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 3000,
      max: 2,
    });
    // 持住一根专用连接：只读事务 / statement_timeout / 业务查询必须在同一连接上生效，
    // 否则 Pool 逐次取连接会让 BEGIN READ ONLY 形同虚设
    const dedicated = await pool.connect();
    return {
      query: async (sql: string, params?: unknown[]) => {
        const res = await dedicated.query(sql, params);
        const result: DbQueryResult = {
          rows: res.rows as Record<string, unknown>[],
          rowCount: res.rowCount ?? res.rows.length,
        };
        return result;
      },
      close: async () => {
        try {
          dedicated.release();
        } finally {
          await pool.end();
        }
      },
    };
  },

  async listTables(client) {
    const res = await client.query(
      `SELECT table_name AS table
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY table_name`
    );
    return res.rows as { table: string }[];
  },

  async describeTable(client, table) {
    const res = await client.query(
      `SELECT column_name AS column, data_type AS type
       FROM information_schema.columns
       WHERE table_name = $1
       ORDER BY ordinal_position`,
      [table]
    );
    return res.rows as { column: string; type: string }[];
  },

  async readOnlyQuery(client, sql) {
    const finalSql = guardReadOnlySql(sql);
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    try {
      const result = await client.query(finalSql);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  },

  async ping(client) {
    await client.query("SELECT 1");
  },
};
