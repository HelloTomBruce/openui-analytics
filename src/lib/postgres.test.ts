import { describe, it, expect } from "vitest";
import { assertReadOnlySql, enforceRowLimit } from "./postgres";

describe("assertReadOnlySql", () => {
  it("允许标准 SELECT 查询", () => {
    expect(() => assertReadOnlySql("SELECT 1")).not.toThrow();
  });

  it("允许 WITH CTE 查询", () => {
    expect(() =>
      assertReadOnlySql("WITH x AS (SELECT 1) SELECT * FROM x")
    ).not.toThrow();
  });

  it("拒绝 DELETE 语句", () => {
    expect(() => assertReadOnlySql("DELETE FROM users")).toThrow(/安全限制/);
  });

  it("拒绝 INSERT 语句", () => {
    expect(() => assertReadOnlySql("INSERT INTO t VALUES (1)")).toThrow(
      /安全限制/
    );
  });

  it("拒绝 DROP 语句", () => {
    expect(() => assertReadOnlySql("DROP TABLE t")).toThrow(/安全限制/);
  });

  it("拒绝前导空白后的 DELETE", () => {
    expect(() => assertReadOnlySql("   DELETE FROM users")).toThrow(
      /安全限制/
    );
  });

  it("拒绝前导注释后的 DELETE", () => {
    expect(() => assertReadOnlySql("-- 恶意注释\nDELETE FROM users")).toThrow(
      /安全限制/
    );
  });

  it("拒绝 SELECT 伪装下的多语句注入", () => {
    expect(() =>
      assertReadOnlySql("SELECT 1; DELETE FROM users")
    ).toThrow(/安全限制/);
  });

  it("拒绝 SELECT ... INTO 隐式建表（写操作绕过）", () => {
    expect(() =>
      assertReadOnlySql("SELECT * INTO backup FROM channel_metrics")
    ).toThrow(/安全限制.*INTO/i);
  });

  it("拒绝 CTE 内嵌写操作", () => {
    expect(() =>
      assertReadOnlySql(
        "WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x"
      )
    ).toThrow(/安全限制/);
  });

  it("拒绝 pg_sleep 资源耗尽攻击", () => {
    expect(() => assertReadOnlySql("SELECT pg_sleep(3600)")).toThrow(
      /安全限制/
    );
  });

  it("拒绝 pg_terminate_backend 破坏数据库连接", () => {
    expect(() =>
      assertReadOnlySql(
        "WITH x AS (SELECT pg_terminate_backend(pid) FROM pg_stat_activity) SELECT * FROM x"
      )
    ).toThrow(/安全限制/);
  });

  it("拒绝 FOR UPDATE / FOR SHARE 行级锁", () => {
    expect(() =>
      assertReadOnlySql("SELECT * FROM monthly_trends FOR UPDATE")
    ).toThrow(/安全限制/);
    expect(() =>
      assertReadOnlySql("SELECT * FROM monthly_trends FOR SHARE")
    ).toThrow(/安全限制/);
  });

  it("拒绝 set_config 修改会话参数", () => {
    expect(() =>
      assertReadOnlySql("SELECT set_config('statement_timeout', '0', false)")
    ).toThrow(/安全限制/);
  });

  it("不误伤含危险词片段的标识符", () => {
    expect(() =>
      assertReadOnlySql("SELECT updated_at FROM monthly_trends")
    ).not.toThrow();
  });
});

describe("enforceRowLimit", () => {
  it("无 LIMIT 时追加封顶", () => {
    expect(enforceRowLimit("SELECT * FROM t")).toBe("SELECT * FROM t\nLIMIT 200");
  });

  it("已有 LIMIT 时不再追加", () => {
    expect(enforceRowLimit("SELECT * FROM t LIMIT 5")).toBe(
      "SELECT * FROM t LIMIT 5"
    );
  });

  it("字符串字面量含 limit 字样不影响封顶", () => {
    expect(enforceRowLimit("SELECT 'no limit here' AS note")).toBe(
      "SELECT 'no limit here' AS note\nLIMIT 200"
    );
  });

  it("注释中的 limit 字样不影响封顶，且追加的 LIMIT 不被行注释吞掉", () => {
    expect(enforceRowLimit("SELECT 1 -- remove limit later")).toBe(
      "SELECT 1 -- remove limit later\nLIMIT 200"
    );
  });

  it("列别名 limit_count 不误判为 LIMIT 子句", () => {
    expect(enforceRowLimit("SELECT count(*) AS limit_count FROM t")).toBe(
      "SELECT count(*) AS limit_count FROM t\nLIMIT 200"
    );
  });
});
