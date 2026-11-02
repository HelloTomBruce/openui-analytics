/**
 * SQL 词法守卫与方言客户端契约（无循环依赖的共享层）。
 *
 * 从 dialect.ts 拆出的原因：方言文件运行时引用 guardReadOnlySql、
 * dialect.ts 又 import 方言组装 DIALECTS——「外部先 import 某方言」
 * 时该循环会让 DIALECTS 在方言导出求值前定格为 undefined。
 * 守卫下沉本文件后，方言 → sqlGuard 单向依赖，循环消除；
 * dialect.ts re-export 本文件全部导出，既有外部引用零变化。
 */

export interface DbQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface DbDialectClient {
  query(sql: string, params?: unknown[]): Promise<DbQueryResult>;
  close(): Promise<void>;
}

/**
 * 只读 SQL 安全校验：仅允许 SELECT / WITH，禁止多语句与 DDL/DML 危险关键字。
 * 校验不通过时抛出包含「安全限制」的错误。
 *
 * 注意：关键字黑名单只是用户体验层（给出明确报错）；真正的硬约束在各方言
 * 的引擎级只读保障上（只读事务 / readOnly 打开模式 / readonly=1 设置）。
 */
export function assertReadOnlySql(sql: string): void {
  const cleanSql = sql.trim().replace(/;+$/, "");

  // 严禁包含多语句分号（防止通过分号执行多条恶意指令）
  if (cleanSql.includes(";")) {
    throw new Error("安全限制：禁止执行包含多个分号语句的复合 SQL！");
  }

  // 安全校验：只允许 SELECT / WITH 语句开头
  const lower = cleanSql.toLowerCase();
  if (
    !lower.startsWith("select") &&
    !lower.startsWith("with")
  ) {
    throw new Error("安全限制：仅允许执行只读 SELECT / WITH 查询！");
  }

  // 严禁 DDL / DML 危险关键字与高危函数
  // into：SELECT ... INTO 会隐式建表（写操作）；pg_sleep 等：资源耗尽/破坏连接
  const dangerousKeywords = [
    "drop", "delete", "update", "insert", "alter", "truncate",
    "create", "grant", "revoke", "exec", "execute", "call", "copy",
    "into", "prepare", "listen", "notify",
    "pg_sleep", "pg_terminate_backend", "pg_cancel_backend",
    "set_config", "dblink", "lo_import", "lo_export",
  ];
  for (const kw of dangerousKeywords) {
    // 前缀允许 (：覆盖 WITH x AS (DELETE ...) 这类括号内嵌写操作
    const regex = new RegExp(`(^|\\s|;|\\()(${kw})(\\s|;|\$|\\()`, "i");
    if (regex.test(lower)) {
      throw new Error(`安全限制：检测到禁止的 SQL 指令 [${kw.toUpperCase()}]`);
    }
  }

  // 行级锁子句（多词，单独检测）
  if (/(^|\s)for\s+(update|share)(\s|$)/i.test(lower)) {
    throw new Error("安全限制：检测到禁止的 SQL 指令 [FOR UPDATE/SHARE]");
  }
}

/**
 * 词法级行数封顶：忽略字符串字面量与注释后检测 LIMIT，
 * 避免「列别名或字面量中含 limit 字样」导致封顶被跳过。
 */
export function enforceRowLimit(sql: string, maxRows = 200): string {
  const stripped = sql
    .replace(/'(?:[^']|'')*'/g, "''") // 字符串字面量
    .replace(/--[^\n]*/g, "") // 行注释
    .replace(/\/\*[\s\S]*?\*\//g, ""); // 块注释
  if (/\blimit\b/i.test(stripped)) return sql;
  // 前置换行：防止原 SQL 末尾的行注释把 LIMIT 吞进注释
  return `${sql}\nLIMIT ${maxRows}`;
}

/** 共享只读防护：词法校验 + 行数封顶（默认 200），返回待包裹的最终 SQL。 */
export function guardReadOnlySql(sql: string): string {
  assertReadOnlySql(sql);
  const clean = sql.trim().replace(/;+$/, "");
  return enforceRowLimit(clean);
}
