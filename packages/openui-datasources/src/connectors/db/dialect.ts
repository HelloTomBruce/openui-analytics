import { postgresDialect } from "./postgresDialect";
import { mysqlDialect } from "./mysqlDialect";
import { sqliteDialect } from "./sqliteDialect";
import { clickhouseDialect } from "./clickhouseDialect";

/**
 * DB 方言接口：动态数据库源的统一抽象。
 * 工具契约（execute_sql / list_tables / describe_table）由 dbMcpServer 承载，
 * 方言只负责连接、目录查询与「只读事务 + 超时 + 行数封顶」的执行包裹。
 *
 * 词法守卫与客户端契约在 ./sqlGuard（方言 → sqlGuard 单向依赖，杜绝循环）；
 * 此处 re-export 保持既有 `from "./dialect"` 引用零变化。
 */
export {
  assertReadOnlySql,
  enforceRowLimit,
  guardReadOnlySql,
  type DbQueryResult,
  type DbDialectClient,
} from "./sqlGuard";

import type { DbDialectClient, DbQueryResult } from "./sqlGuard";

export interface DbDialect {
  /** duckdb 仅供 file 连接器内部使用，不进入 DIALECTS 用户配置注册表 */
  readonly dbType: "postgres" | "mysql" | "sqlite" | "clickhouse" | "duckdb";
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

/** 方言注册表：扩展新数据库 = 新增方言文件并在此注册 */
export const DIALECTS: Record<
  "postgres" | "mysql" | "sqlite" | "clickhouse",
  DbDialect
> = {
  postgres: postgresDialect,
  mysql: mysqlDialect,
  sqlite: sqliteDialect,
  clickhouse: clickhouseDialect,
};
