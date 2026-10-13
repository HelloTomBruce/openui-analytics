import { assertReadOnlySql, enforceRowLimit } from "@/lib/postgres";
import { postgresDialect } from "./postgresDialect";
import { mysqlDialect } from "./mysqlDialect";

/**
 * DB 方言接口：动态数据库源的统一抽象。
 * 工具契约（execute_sql / list_tables / describe_table）由 dbMcpServer 承载，
 * 方言只负责连接、目录查询与「只读事务 + 超时 + 行数封顶」的执行包裹。
 * SQL 关键字黑名单（assertReadOnlySql）跨方言复用，写操作在词法层即被拒绝。
 */

export interface DbQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface DbDialectClient {
  query(sql: string, params?: unknown[]): Promise<DbQueryResult>;
  close(): Promise<void>;
}

export interface DbDialect {
  readonly dbType: "postgres" | "mysql";
  connect(connectionString: string): Promise<DbDialectClient>;
  listTables(client: DbDialectClient): Promise<{ table: string }[]>;
  describeTable(
    client: DbDialectClient,
    table: string
  ): Promise<{ column: string; type: string }[]>;
  /** assertReadOnlySql → 行数封顶 → 方言只读事务/超时包裹后执行 */
  readOnlyQuery(client: DbDialectClient, sql: string): Promise<DbQueryResult>;
  ping(client: DbDialectClient): Promise<void>;
}

/**
 * 共享只读防护：词法校验 + 行数封顶（默认 200），返回待包裹的最终 SQL。
 */
export function guardReadOnlySql(sql: string): string {
  assertReadOnlySql(sql);
  const clean = sql.trim().replace(/;+$/, "");
  return enforceRowLimit(clean);
}

/** 方言注册表：扩展新数据库 = 新增方言文件并在此注册 */
export const DIALECTS: Record<"postgres" | "mysql", DbDialect> = {
  postgres: postgresDialect,
  mysql: mysqlDialect,
};
