import type { DbDialect, DbDialectClient, DbQueryResult } from "./dialect";
import { guardReadOnlySql } from "./dialect";

/**
 * MySQL 方言：mysql2 惰性加载——驱动缺失时给出可操作的降级提示而非崩溃。
 * 只读保障：词法黑名单（共享）+ START TRANSACTION READ ONLY +
 * SET SESSION max_execution_time（仅对 SELECT 生效，防慢查询）。
 */
export const mysqlDialect: DbDialect = {
  dbType: "mysql",

  async connect(connectionString: string): Promise<DbDialectClient> {
    let mysql: typeof import("mysql2/promise");
    try {
      mysql = await import("mysql2/promise");
    } catch {
      throw new Error("MySQL 驱动未安装：请在服务端执行 pnpm add mysql2");
    }
    const pool = mysql.createPool({
      uri: connectionString,
      connectionLimit: 2,
      connectTimeout: 3000,
    });
    return {
      query: async (sql: string, params?: unknown[]) => {
        // 占位符参数必须透传（describeTable 依赖 ? 绑定）；无参数时不带第二参
        const [rows] =
          params === undefined
            ? await pool.query(sql)
            : await pool.query(sql, params);
        const list = Array.isArray(rows) ? rows : [];
        return {
          rows: list as Record<string, unknown>[],
          rowCount: list.length,
        } satisfies DbQueryResult;
      },
      close: async () => {
        await pool.end();
      },
    };
  },

  async listTables(client) {
    const res = await client.query(
      `SELECT table_name AS table
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
       ORDER BY table_name`
    );
    return res.rows as { table: string }[];
  },

  async describeTable(client, table) {
    const res = await client.query(
      `SELECT column_name AS column, data_type AS type
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?
       ORDER BY ordinal_position`,
      [table]
    );
    return res.rows as { column: string; type: string }[];
  },

  async readOnlyQuery(client, sql) {
    const finalSql = guardReadOnlySql(sql);
    await client.query("SET SESSION max_execution_time=5000");
    await client.query("START TRANSACTION READ ONLY");
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
