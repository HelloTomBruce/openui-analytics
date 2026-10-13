// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listDataSources,
  checkDataSourceHealth,
  reloadDataSources,
  readDatasourcesConfig,
  writeDatasourcesConfig,
  validateDynamicSourceConfig,
  upsertDynamicSource,
  deleteDynamicSource,
  maskConnectionString,
  maskUrl,
  resolveActiveSources,
} from "./registry";

vi.mock("./stdioMcp", () => ({
  connectStdioMcp: vi.fn(),
  probeStdioCli: vi.fn(async () => {}),
}));

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
    reloadDataSources();
    vi.unstubAllEnvs();
  });

  it("v2 迁移：zentao-cli 种子化、postgres 丢弃、动态源原样保留、无 gitlab（env 未设）", () => {
    const file = writeTempConfig(V2_FILE);
    const cfg = readDatasourcesConfig(file);

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

    const gitlab = readDatasourcesConfig(file).sources.find(
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
    const ids = readDatasourcesConfig(file).sources.map((s) => s.id);
    expect(ids).not.toContain("gitlab-mcp");
  });

  it("文件缺失/损坏/v3 合法文件均返回可用配置", () => {
    expect(readDatasourcesConfig("/nonexistent/datasources.json")).toEqual({
      sources: [],
    });
    expect(readDatasourcesConfig(writeTempConfig("{ broken"))).toEqual({
      sources: [],
    });
    const v3 = writeTempConfig(
      JSON.stringify({ sources: [ZHAOBIAO_SOURCE] })
    );
    expect(readDatasourcesConfig(v3).sources).toHaveLength(1);
  });

  it("校验：stdio-cli 合法配置通过并规范化 args", () => {
    const r = validateDynamicSourceConfig({
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
    const noCmd = validateDynamicSourceConfig({
      id: "s1",
      name: "x",
      kind: "stdio-cli",
      command: "",
    });
    expect(noCmd.ok).toBe(false);

    const badArgs = validateDynamicSourceConfig({
      id: "s1",
      name: "x",
      kind: "stdio-cli",
      command: "zentao",
      args: ["ok", 42 as unknown as string],
    });
    expect(badArgs.ok).toBe(false);
  });

  it("校验：id 仍拒绝非法格式与空 name", () => {
    const bad = validateDynamicSourceConfig({
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
    upsertDynamicSource(ZHAOBIAO_SOURCE, file);
    expect(readDatasourcesConfig(file).sources).toHaveLength(1);
    expect(deleteDynamicSource("zhaobiao", file)).toBe(true);
    expect(readDatasourcesConfig(file).sources).toHaveLength(0);
    expect(deleteDynamicSource("zhaobiao", file)).toBe(false);
  });

  it("writeDatasourcesConfig 原子写不留 tmp 残留", () => {
    const file = writeTempConfig(JSON.stringify({ sources: [] }));
    writeDatasourcesConfig({ sources: [] }, file);
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

describe("listDataSources 描述符（全动态同构）", () => {
  afterEach(() => {
    reloadDataSources();
  });

  it("stdio 源描述符暴露 command、无 builtin 字段", () => {
    const file = writeTempConfig(
      JSON.stringify({
        sources: [
          {
            id: "zentao-cli",
            name: "禅道",
            kind: "stdio-cli",
            command: "zentao",
            args: ["mcp", "--read-only"],
            enabled: true,
          },
          ZHAOBIAO_SOURCE,
          {
            id: "jira",
            name: "Jira MCP",
            kind: "http-mcp",
            url: "http://10.0.0.1:6000/mcp?private_token=leak",
            token: "glpat-secret",
            enabled: false,
          },
        ],
      })
    );
    reloadDataSources(file);

    const sources = listDataSources();

    expect(sources).toHaveLength(3);
    for (const s of sources) {
      expect(s).not.toHaveProperty("builtin");
    }
    const zentao = sources.find((s) => s.id === "zentao-cli");
    expect(zentao).toMatchObject({
      kind: "stdio-cli",
      command: "zentao",
      tools: [],
      enabled: true,
    });
    const jira = sources.find((s) => s.id === "jira");
    expect(jira).toMatchObject({ enabled: false, hasToken: true });
    expect(JSON.stringify(jira)).not.toContain("glpat-secret");
    expect(jira?.maskedUrl).not.toContain("?");
  });
});

describe("resolveActiveSources（全动态）", () => {
  const CFG = {
    sources: [
      ZHAOBIAO_SOURCE,
      {
        id: "jira",
        name: "Jira MCP",
        kind: "http-mcp" as const,
        url: "http://10.0.0.1:6000/mcp",
        token: "",
        enabled: false,
      },
    ],
  };

  it("未指定时返回全部启用源；禁用源被滤掉", () => {
    const active = resolveActiveSources(undefined, CFG);
    expect(active.map((s) => s.id)).toEqual(["zhaobiao"]);
  });

  it("指定列表取交集，未知 id 忽略并告警", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveActiveSources(["zhaobiao", "jira", "nope"], CFG)).toEqual([
      {
        id: "zhaobiao",
        name: "招标平台数据/",
        kind: "db",
        dbType: "mysql",
        tools: ["execute_sql", "list_tables", "describe_table"],
      },
    ]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("nope"));
    warnSpy.mockRestore();
  });
});

describe("checkDataSourceHealth（全动态）", () => {
  afterEach(() => {
    reloadDataSources();
    vi.clearAllMocks();
  });

  it("stdio 源走 probeStdioCli 真实握手探活", async () => {
    const { probeStdioCli } = await import("./stdioMcp");
    const file = writeTempConfig(
      JSON.stringify({
        sources: [
          {
            id: "zentao-cli",
            name: "禅道",
            kind: "stdio-cli",
            command: "zentao",
            args: ["mcp", "--read-only"],
            enabled: true,
          },
        ],
      })
    );
    reloadDataSources(file);

    const result = await checkDataSourceHealth("zentao-cli");

    expect(result.ok).toBe(true);
    expect(probeStdioCli).toHaveBeenCalledWith("zentao", ["mcp", "--read-only"]);
  });

  it("未知 id 返回 unknown datasource", async () => {
    const result = await checkDataSourceHealth("does-not-exist");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unknown datasource");
  });
});
