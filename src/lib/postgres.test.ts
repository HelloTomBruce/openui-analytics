import { describe, it, expect } from "vitest";
import { assertReadOnlySql } from "./postgres";

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
});
