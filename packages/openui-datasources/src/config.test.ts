import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadConfigFile,
  writeConfigFile,
  validateSourceConfig,
  upsertSource,
  deleteSource,
  maskConnectionString,
  maskUrl,
} from "./config";

function writeTempConfig(content: string): string {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "datasources-")),
    "datasources.json"
  );
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

const ZHAOBIAO_SOURCE = {
  id: "zhaobiao",
  name: "招标平台数据/",
  kind: "db" as const,
  dbType: "mysql" as const,
  connectionString: "mysql://root:p@h:3306/dvadminlocal",
  enabled: true,
};

/** v2 形态（builtin 段 + 动态源），迁移测试的输入 */
const V2_FILE = JSON.stringify({
  builtin: {
    postgres: { enabled: true },
    "gitlab-mcp": { enabled: true },
    "zentao-cli": { enabled: true },
  },
  sources: [ZHAOBIAO_SOURCE],
});

describe("配置模型 v3（无 builtin）", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("v2 迁移：zentao-cli 种子化、postgres 丢弃、动态源原样保留、无 gitlab（env 未设）", () => {
    const file = writeTempConfig(V2_FILE);
    const cfg = loadConfigFile(file);

    expect(cfg).not.toHaveProperty("builtin");
    const ids = cfg.sources.map((s) => s.id);
    expect(ids).toContain("zhaobiao");
    expect(ids).toContain("zentao-cli");
    expect(ids).not.toContain("postgres");
    expect(ids).not.toContain("gitlab-mcp");

    const zhaobiao = cfg.sources.find((s) => s.id === "zhaobiao");
    expect(zhaobiao).toEqual(ZHAOBIAO_SOURCE);
    const zentao = cfg.sources.find((s) => s.id === "zentao-cli");
    expect(zentao).toEqual({
      id: "zentao-cli",
      name: "ZenTao 禅道 CLI MCP (本地)",
      kind: "stdio-cli",
      command: "zentao",
      args: ["mcp", "--read-only"],
      enabled: true,
    });
  });

  it("v2 迁移：env 有 GITLAB_MCP_URL 时 gitlab 种子化（含 env token）", () => {
    vi.stubEnv("GITLAB_MCP_URL", "http://10.0.0.9:5002/mcp");
    vi.stubEnv("GITLAB_TOKEN", "glpat-env");
    const file = writeTempConfig(V2_FILE);

    const gitlab = loadConfigFile(file).sources.find(
      (s) => s.id === "gitlab-mcp"
    );

    expect(gitlab).toEqual({
      id: "gitlab-mcp",
      name: "GitLab MCP (外部)",
      kind: "http-mcp",
      url: "http://10.0.0.9:5002/mcp",
      token: "glpat-env",
      enabled: true,
    });
  });

  it("v2 迁移：gitlab 停用时不种子", () => {
    const file = writeTempConfig(
      JSON.stringify({
        builtin: {
          postgres: { enabled: true },
          "gitlab-mcp": { enabled: false },
          "zentao-cli": { enabled: true },
        },
        sources: [],
      })
    );
    const ids = loadConfigFile(file).sources.map((s) => s.id);
    expect(ids).not.toContain("gitlab-mcp");
  });

  it("文件缺失/损坏/v3 合法文件均返回可用配置", () => {
    expect(loadConfigFile("/nonexistent/datasources.json")).toEqual({
      sources: [],
    });
    expect(loadConfigFile(writeTempConfig("{ broken"))).toEqual({
      sources: [],
    });
    const v3 = writeTempConfig(
      JSON.stringify({ sources: [ZHAOBIAO_SOURCE] })
    );
    expect(loadConfigFile(v3).sources).toHaveLength(1);
  });

  it("校验：stdio-cli 合法配置通过并规范化 args", () => {
    const r = validateSourceConfig({
      id: "s1",
      name: "禅道",
      kind: "stdio-cli",
      command: "zentao",
      args: ["mcp", "--read-only"],
    });
    expect(r).toEqual({
      ok: true,
      config: {
        id: "s1",
        name: "禅道",
        kind: "stdio-cli",
        command: "zentao",
        args: ["mcp", "--read-only"],
        enabled: true,
      },
    });
  });

  it("校验：stdio-cli command 为空或 args 含非字符串时拒绝", () => {
    const noCmd = validateSourceConfig({
      id: "s1",
      name: "x",
      kind: "stdio-cli",
      command: "",
    });
    expect(noCmd.ok).toBe(false);

    const badArgs = validateSourceConfig({
      id: "s1",
      name: "x",
      kind: "stdio-cli",
      command: "zentao",
      args: ["ok", 42 as unknown as string],
    });
    expect(badArgs.ok).toBe(false);
  });

  it("校验：id 仍拒绝非法格式与空 name", () => {
    const bad = validateSourceConfig({
      id: "BAD",
      name: "",
      kind: "http-mcp",
      url: "http://x/mcp",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.join(";")).toContain("id");
      expect(bad.errors.join(";")).toContain("name");
    }
  });

  it("upsert/delete 往返（无内置特例）", () => {
    const file = writeTempConfig(JSON.stringify({ sources: [] }));
    writeConfigFile(
      upsertSource(loadConfigFile(file), ZHAOBIAO_SOURCE),
      file
    );
    expect(loadConfigFile(file).sources).toHaveLength(1);
    writeConfigFile(deleteSource(loadConfigFile(file), "zhaobiao"), file);
    expect(loadConfigFile(file).sources).toHaveLength(0);
    // 不存在的 id 删除：内容不变
    expect(deleteSource(loadConfigFile(file), "zhaobiao").sources).toHaveLength(0);
  });

  it("writeConfigFile 原子写不留 tmp 残留", () => {
    const file = writeTempConfig(JSON.stringify({ sources: [] }));
    writeConfigFile({ sources: [] }, file);
    expect(
      fs.readdirSync(path.dirname(file)).some((f) => /\.tmp$/.test(f))
    ).toBe(false);
  });

  it("mask 函数行为不变", () => {
    expect(maskConnectionString("mysql://u:p@h:3306/db")).toBe(
      "mysql://u:***@h:3306/db"
    );
    expect(maskUrl("http://u:p@h:7002/mcp?x=1")).toBe("http://h:7002/mcp");
  });
});
