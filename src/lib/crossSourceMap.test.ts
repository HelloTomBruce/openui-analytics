import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getCrossSourceLinks, reloadCrossSourceMap } from "./crossSourceMap";

function writeTempConfig(content: string): string {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "cross-source-")),
    "map.json"
  );
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

afterEach(() => {
  // 恢复默认配置路径与缓存
  reloadCrossSourceMap();
});

describe("getCrossSourceLinks", () => {
  it("映射命中时返回 gitlab 项目路径与 mapped", () => {
    const file = writeTempConfig(
      JSON.stringify({
        mappings: [
          {
            zentaoProjectId: "42",
            zentaoProjectName: "交易平台重构",
            gitlabProject: "backend/trading-platform",
          },
        ],
      })
    );
    reloadCrossSourceMap(file);

    expect(getCrossSourceLinks("42")).toEqual({
      gitlabProject: "backend/trading-platform",
      confidence: "mapped",
      zentaoProjectName: "交易平台重构",
    });
  });

  it("映射缺失时返回 none 且不抛错", () => {
    const file = writeTempConfig(JSON.stringify({ mappings: [] }));
    reloadCrossSourceMap(file);

    expect(getCrossSourceLinks("999")).toEqual({
      gitlabProject: null,
      confidence: "none",
    });
  });

  it("配置文件不存在时降级为 none 且不抛错", () => {
    reloadCrossSourceMap("/nonexistent/path/cross-source-map.json");
    expect(() => getCrossSourceLinks("42")).not.toThrow();
    expect(getCrossSourceLinks("42")).toEqual({
      gitlabProject: null,
      confidence: "none",
    });
  });

  it("配置文件 JSON 损坏时降级为 none 且不抛错", () => {
    const file = writeTempConfig("{ not valid json !!!");
    reloadCrossSourceMap(file);

    expect(getCrossSourceLinks("42")).toEqual({
      gitlabProject: null,
      confidence: "none",
    });
  });
});
