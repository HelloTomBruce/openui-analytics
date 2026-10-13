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
  setBuiltinEnabled,
  maskConnectionString,
  maskUrl,
  resolveActiveSources,
} from "./registry";
import { getGitLabMcpClient } from "./mcpClient";

vi.mock("./mcpClient", () => ({
  getGitLabMcpClient: vi.fn(),
}));

function writeTempConfig(content: string): string {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "datasources-")),
    "datasources.json"
  );
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

describe("listDataSources", () => {
  afterEach(() => {
    reloadDataSources();
  });

  it("默认返回 3 个内置数据源且 id 稳定（不依赖仓库真实配置文件）", () => {
    // 密闭化：用空临时配置驱动，避免仓库 config/datasources.json 的真实动态源影响计数
    reloadDataSources(writeTempConfig(JSON.stringify({ sources: [] })));
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
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("未知 id 返回 ok: false 与 unknown datasource 错误", async () => {
    const result = await checkDataSourceHealth("does-not-exist");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unknown datasource");
  });

  it("gitlab-mcp 探活使用调用方传入的 url 与 token，而非服务端默认值", async () => {
    vi.mocked(getGitLabMcpClient).mockRejectedValue(
      new Error("connection refused")
    );

    const result = await checkDataSourceHealth("gitlab-mcp", {
      gitlabUrl: "http://10.0.0.9:5002/mcp",
      gitlabToken: "glpat-test",
    });

    expect(getGitLabMcpClient).toHaveBeenCalledWith(
      "http://10.0.0.9:5002/mcp",
      "glpat-test"
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("connection refused");
  });
});

describe("配置模型 v2", () => {
  afterEach(() => {
    reloadDataSources();
  });

  it("v1 配置（含 _comment、无 builtin、源无 enabled）自动迁移不抛错", () => {
    const file = writeTempConfig(
      JSON.stringify({
        _comment: "legacy v1",
        sources: [
          {
            id: "jira-mcp",
            name: "Jira MCP",
            kind: "http-mcp",
            url: "http://127.0.0.1:6000/mcp",
          },
        ],
      })
    );
    expect(readDatasourcesConfig(file)).toEqual({
      builtin: {
        postgres: { enabled: true },
        "gitlab-mcp": { enabled: true },
        "zentao-cli": { enabled: true },
      },
      sources: [
        {
          id: "jira-mcp",
          name: "Jira MCP",
          kind: "http-mcp",
          url: "http://127.0.0.1:6000/mcp",
          token: "",
          enabled: true,
        },
      ],
    });
  });

  it("文件缺失或损坏时返回全内置默认", () => {
    const broken = writeTempConfig("{ broken json !!!");
    expect(readDatasourcesConfig(broken)).toEqual({
      builtin: {
        postgres: { enabled: true },
        "gitlab-mcp": { enabled: true },
        "zentao-cli": { enabled: true },
      },
      sources: [],
    });
    expect(readDatasourcesConfig("/nonexistent/datasources.json")).toEqual(
      readDatasourcesConfig(broken)
    );
  });

  it("校验拒绝非法格式 id", () => {
    const r = validateDynamicSourceConfig({
      id: "My_ID",
      name: "x",
      kind: "http-mcp",
      url: "u",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(";")).toContain("id");
  });

  it("校验拒绝内置 id 冲突", () => {
    const r = validateDynamicSourceConfig({
      id: "postgres",
      name: "x",
      kind: "http-mcp",
      url: "http://x/mcp",
    });
    expect(r.ok).toBe(false);
  });

  it("校验拒绝 db 源缺连接串", () => {
    const r = validateDynamicSourceConfig({
      id: "a",
      name: "x",
      kind: "db",
      dbType: "mysql",
      connectionString: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(";")).toContain("连接串");
  });

  it("校验拒绝不支持的 dbType", () => {
    const r = validateDynamicSourceConfig({
      id: "a",
      name: "x",
      kind: "db",
      dbType: "oracle",
      connectionString: "oracle://u:p@h/db",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(";")).toContain("dbType");
  });

  it("合法 http-mcp 配置通过校验并默认 enabled", () => {
    const r = validateDynamicSourceConfig({
      id: "a",
      name: "n",
      kind: "http-mcp",
      url: "http://x/mcp",
    });
    expect(r).toEqual({
      ok: true,
      config: {
        id: "a",
        name: "n",
        kind: "http-mcp",
        url: "http://x/mcp",
        token: "",
        enabled: true,
      },
    });
  });

  it("upsert 动态 db 源后可读回", () => {
    const file = writeTempConfig(JSON.stringify({ sources: [] }));
    upsertDynamicSource(
      {
        id: "mysql-a",
        name: "订单库",
        kind: "db",
        dbType: "mysql",
        connectionString: "mysql://u:p@h:3306/db",
        enabled: true,
      },
      file
    );
    expect(readDatasourcesConfig(file).sources).toHaveLength(1);
    expect(readDatasourcesConfig(file).sources[0]).toMatchObject({
      id: "mysql-a",
      dbType: "mysql",
    });
  });

  it("deleteDynamicSource 存在时返回 true，不存在时返回 false", () => {
    const file = writeTempConfig(JSON.stringify({ sources: [] }));
    upsertDynamicSource(
      {
        id: "a",
        name: "n",
        kind: "http-mcp",
        url: "http://x/mcp",
        token: "",
        enabled: true,
      },
      file
    );
    expect(deleteDynamicSource("a", file)).toBe(true);
    expect(readDatasourcesConfig(file).sources).toHaveLength(0);
    expect(deleteDynamicSource("a", file)).toBe(false);
  });

  it("setBuiltinEnabled 写入 builtin 段并可读回", () => {
    const file = writeTempConfig(JSON.stringify({ sources: [] }));
    setBuiltinEnabled("postgres", false, file);
    expect(readDatasourcesConfig(file).builtin.postgres.enabled).toBe(false);
  });

  it("writeDatasourcesConfig 原子写不留 tmp 残留", () => {
    const file = writeTempConfig(JSON.stringify({ sources: [] }));
    const dir = path.dirname(file);
    writeDatasourcesConfig(
      {
        builtin: {
          postgres: { enabled: true },
          "gitlab-mcp": { enabled: true },
          "zentao-cli": { enabled: true },
        },
        sources: [],
      },
      file
    );
    expect(fs.readdirSync(dir).some((f) => /\.tmp$/.test(f))).toBe(false);
    expect(readDatasourcesConfig(file).sources).toHaveLength(0);
  });

  it("listDataSources 描述符含 enabled/builtin/hasToken/maskedUrl 且不泄露 token", () => {
    const file = writeTempConfig(JSON.stringify({ sources: [] }));
    setBuiltinEnabled("zentao-cli", false, file);
    upsertDynamicSource(
      {
        id: "gitlab-b",
        name: "GitLab B",
        kind: "http-mcp",
        url: "http://127.0.0.1:7002/mcp?private_token=leak",
        token: "glpat-secret",
        enabled: true,
      },
      file
    );

    const sources = listDataSources();
    const zentao = sources.find((s) => s.id === "zentao-cli");
    expect(zentao).toMatchObject({ enabled: false, builtin: true });

    const dyn = sources.find((s) => s.id === "gitlab-b");
    expect(dyn).toMatchObject({
      builtin: false,
      enabled: true,
      kind: "http-mcp",
      hasToken: true,
    });
    expect(JSON.stringify(dyn)).not.toContain("glpat-secret");
    expect(JSON.stringify(dyn)).not.toContain("private_token");
    expect(dyn?.maskedUrl).toBe("http://127.0.0.1:7002/mcp");
    expect(dyn?.maskedUrl).not.toContain("?");
  });

  it("maskConnectionString 隐藏密码，无密码时原样返回", () => {
    expect(maskConnectionString("mysql://u:p@h:3306/db")).toBe(
      "mysql://u:***@h:3306/db"
    );
    expect(maskConnectionString("postgres://u@h/db")).toBe("postgres://u@h/db");
  });

  it("maskUrl 去掉 query 与 userinfo", () => {
    expect(maskUrl("http://u:p@h:7002/mcp?x=1")).toBe("http://h:7002/mcp");
  });
});

describe("resolveActiveSources", () => {
  const CFG = {
    builtin: {
      postgres: { enabled: true },
      "gitlab-mcp": { enabled: false },
      "zentao-cli": { enabled: true },
    },
    sources: [
      {
        id: "jira",
        name: "Jira MCP",
        kind: "http-mcp" as const,
        url: "http://10.0.0.1:6000/mcp",
        token: "",
        enabled: true,
      },
    ],
  };

  it("未指定时返回全部启用源（内置按 enabled 过滤）", () => {
    const active = resolveActiveSources(undefined, CFG);
    expect(active.map((s) => s.id).sort()).toEqual([
      "jira",
      "postgres",
      "zentao-cli",
    ]);
  });

  it("指定列表与全局启用取交集：禁用源被滤掉", () => {
    const active = resolveActiveSources(
      ["postgres", "gitlab-mcp"],
      CFG
    );
    expect(active.map((s) => s.id)).toEqual(["postgres"]);
  });

  it("未知 id 忽略并告警，不抛错", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const active = resolveActiveSources(["nope"], CFG);
    expect(active).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("nope"));
    warnSpy.mockRestore();
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
