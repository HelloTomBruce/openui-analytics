import { describe, it, expect } from "vitest";
import { listDataSources, checkDataSourceHealth } from "./registry";

describe("listDataSources", () => {
  it("默认返回 3 个内置数据源且 id 稳定", () => {
    const sources = listDataSources();
    expect(sources).toHaveLength(3);
    expect(sources.map((s) => s.id)).toEqual([
      "postgres",
      "gitlab-mcp",
      "zentao-cli",
    ]);
    for (const s of sources) {
      expect(s.name).toBeTruthy();
      expect(s.kind).toBe(s.id);
    }
  });
});

describe("checkDataSourceHealth", () => {
  it("未知 id 返回 ok: false 与 unknown datasource 错误", async () => {
    const result = await checkDataSourceHealth("does-not-exist");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unknown datasource");
  });
});
