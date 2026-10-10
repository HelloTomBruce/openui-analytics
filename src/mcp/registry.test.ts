import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listDataSources,
  checkDataSourceHealth,
  reloadDataSources,
} from "./registry";

function writeTempConfig(content: string): string {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "datasources-")),
    "datasources.json"
  );
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

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

describe("声明式数据源扩展", () => {
  afterEach(() => {
    reloadDataSources();
  });

  it("config/datasources.json 中的合法 http-mcp 声明并入列表", () => {
    const file = writeTempConfig(
      JSON.stringify({
        sources: [
          {
            id: "jira-mcp",
            name: "Jira MCP (外部)",
            kind: "http-mcp",
            url: "http://127.0.0.1:6000/mcp",
          },
        ],
      })
    );
    reloadDataSources(file);

    const sources = listDataSources();
    expect(sources).toHaveLength(4);
    expect(sources[3]).toMatchObject({
      id: "jira-mcp",
      name: "Jira MCP (外部)",
      kind: "http-mcp",
    });
  });

  it("配置文件 JSON 损坏时忽略并仅返回内置 3 源", () => {
    const file = writeTempConfig("{ broken json !!!");
    reloadDataSources(file);

    const sources = listDataSources();
    expect(sources).toHaveLength(3);
    expect(sources.map((s) => s.id)).toEqual([
      "postgres",
      "gitlab-mcp",
      "zentao-cli",
    ]);
  });
});
