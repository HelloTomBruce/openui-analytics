import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { DbDialect, DbDialectClient, DbQueryResult } from "./dialect";
import { guardReadOnlySql } from "./sqlGuard";

/**
 * SQLite 方言：node:sqlite（Node ≥22.13 内置，零第三方依赖）。
 *
 * 连接串约定：`sqlite:/abs/path.db`、`sqlite:./rel.db` 或纯路径；
 * 只读双保险：DatabaseSync 以 readOnly:true 打开（引擎级硬约束，写语句直接报错）
 * + guardReadOnlySql 词法守卫（给出友好错误而非引擎报错）。
 */

/** 连接串 → 数据库文件路径（剥 sqlite: 前缀；:memory: 供测试） */
export function sqlitePath(connectionString: string): string {
  if (connectionString.startsWith("sqlite:")) {
    return connectionString.slice("sqlite:".length);
  }
  return connectionString;
}

/** PRAGMA 不支持参数绑定：表名走白名单断言后以标识符引用形式插值 */
function assertSafeSqliteIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`非法表名标识符: ${JSON.stringify(name)}`);
  }
  return name;
}

export const sqliteDialect: DbDialect = {
  dbType: "sqlite",

  async connect(connectionString: string): Promise<DbDialectClient> {
    const dbPath = sqlitePath(connectionString);
    if (!dbPath) throw new Error("SQLite 连接串不能为空（文件路径或 sqlite: 前缀路径）");
    // readOnly:true = 引擎级只读（文件存在性错误在此暴露）
    const db = new DatabaseSync(dbPath, { readOnly: true });
    return {
      query: async (sql: string, params?: unknown[]): Promise<DbQueryResult> => {
        // node:sqlite all() 返回对象数组；参数仅支持匿名 ?（undefined 归一为 null）
        const stmt = db.prepare(sql);
        const args = (params ?? []).map(
          (v): SQLInputValue => (v === undefined ? null : (v as SQLInputValue))
        );
        const rows = (args.length > 0
          ? stmt.all(...args)
          : stmt.all()) as Record<string, unknown>[];
        return { rows, rowCount: rows.length };
      },
      close: async () => {
        try {
          db.close();
        } catch {
          // 关闭失败不阻断
        }
      },
    };
  },

  async listTables(client) {
    const res = await client.query(
      // "table" 是 SQLite 保留字，别名必须引用
      `SELECT name AS "table" FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`
    );
    return res.rows as { table: string }[];
  },

  async describeTable(client, table) {
    // PRAGMA table_info 不接受绑定参数：白名单断言 + 引用插值
    const safe = assertSafeSqliteIdentifier(table);
    const res = await client.query(`PRAGMA table_info("${safe}")`);
    return res.rows.map((r) => ({
      column: String(r.name),
      type: String(r.type || "TEXT"),
    }));
  },

  async readOnlyQuery(client, sql) {
    // 词法守卫（友好报错）→ readOnly 打开模式为引擎级硬约束
    const finalSql = guardReadOnlySql(sql);
    return client.query(finalSql);
  },

  async ping(client) {
    await client.query("SELECT 1 AS one");
  },
};
