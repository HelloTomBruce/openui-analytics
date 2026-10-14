import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("./connectors/http", () => ({
  connectHttpMcp: vi.fn(),
}));

vi.mock("./connectors/stdio", () => ({
  connectStdioMcp: vi.fn(),
  probeStdioCli: vi.fn(async () => {}),
}));

// 只 mock DIALECTS：dbMcpServer 保持真实实现，经 InMemoryTransport 走完整 MCP 协议
vi.mock("./connectors/db/dialect", () => ({
  DIALECTS: {
    postgres: { connect: vi.fn(), ping: vi.fn() },
    mysql: { connect: vi.fn(), ping: vi.fn() },
  },
}));

import { connectHttpMcp } from "./connectors/http";
import { connectStdioMcp, probeStdioCli } from "./connectors/stdio";
import { DIALECTS } from "./connectors/db/dialect";
import { createDatasourceManager, mergeToolSets } from "./manager";
import { toAiTools } from "./adapters/ai";

function makeFakeMcpClient(name = "tool_x") {
  return {
    listTools: vi.fn(async () => ({
      tools: [
        {
          name,
          description: `desc of ${name}`,
          inputSchema: { type: "object", properties: {} },
        },
      ],
    })),
    callTool: vi.fn(async () => ({
      content: [{ type: "text", text: '{"rows": 1}' }],
    })),
    close: vi.fn(async () => ({})),
  };
}

function writeTempConfig(content: string): string {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "dynsources-")),
    "datasources.json"
  );
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

function managerFor(content: string) {
  const file = writeTempConfig(content);
  return createDatasourceManager({ configPath: file });
}

const HTTP_SOURCE = {
  id: "jira",
  name: "Jira MCP",
  kind: "http-mcp" as const,
  url: "http://10.0.0.1:6000/mcp",
  token: "tk",
  enabled: true,
};

const DB_SOURCE = {
  id: "m1",
  name: "订单库",
  kind: "db" as const,
  dbType: "mysql" as const,
  connectionString: "mysql://u:p@h:3306/orders",
  enabled: true,
};

const STDIO_SOURCE = {
  id: "zc",
  name: "禅道",
  kind: "stdio-cli" as const,
  command: "zentao",
  args: ["mcp", "--read-only"],
  enabled: true,
};

const ZHAOBIAO_SOURCE = {
  id: "zhaobiao",
  name: "招标平台数据/",
  kind: "db" as const,
  dbType: "mysql" as const,
  connectionString: "mysql://root:p@h:3306/dvadminlocal",
  enabled: true,
};

describe("list 描述符（全动态同构）", () => {
  it("stdio 源描述符暴露 command、无 builtin 字段", () => {
    const m = managerFor(
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

    const sources = m.list();

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

describe("resolveActive（全动态）", () => {
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
    const m = managerFor(JSON.stringify(CFG));
    const active = m.resolveActive(undefined);
    expect(active.map((s) => s.id)).toEqual(["zhaobiao"]);
  });

  it("指定列表取交集，未知 id 忽略并告警", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = managerFor(JSON.stringify(CFG));
    expect(m.resolveActive(["zhaobiao", "jira", "nope"])).toEqual([
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

describe("health（全动态）", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("stdio 源走 probeStdioCli 真实握手探活", async () => {
    const m = managerFor(JSON.stringify({ sources: [] }));

    const result = await m.health({
      id: "zentao-cli",
      name: "禅道",
      kind: "stdio-cli",
      command: "zentao",
      args: ["mcp", "--read-only"],
      enabled: true,
    });

    expect(result.ok).toBe(true);
    expect(probeStdioCli).toHaveBeenCalledWith("zentao", ["mcp", "--read-only"]);
  });
});

describe("manager 工具装配", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("http-mcp 源经 connectHttpMcp 挂载工具，execute 走 callTool", async () => {
    const fake = makeFakeMcpClient("jira_search");
    vi.mocked(connectHttpMcp).mockResolvedValue(fake as never);
    const m = managerFor(JSON.stringify({ sources: [HTTP_SOURCE] }));

    const bindings = await m.tools(HTTP_SOURCE);
    const aiTools = toAiTools(bindings);

    expect(connectHttpMcp).toHaveBeenCalledWith(
      "openui-dynamic-jira",
      "http://10.0.0.1:6000/mcp",
      { Authorization: "Bearer tk" }
    );
    expect(Object.keys(aiTools)).toEqual(["jira_jira_search"]);
    const out = await aiTools["jira_jira_search"]!.execute!({ q: "x" }, {} as never);
    expect(out).toEqual({ rows: 1 });
    expect(fake.callTool).toHaveBeenCalledWith({
      name: "jira_search",
      arguments: { q: "x" },
    });
  });

  it("db 源经方言连接挂载三件套工具", async () => {
    const fakeDbClient = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      close: vi.fn(async () => ({})),
    };
    vi.mocked(DIALECTS.mysql.connect).mockResolvedValue(
      fakeDbClient as never
    );
    const m = managerFor(JSON.stringify({ sources: [DB_SOURCE] }));

    const bindings = await m.tools(DB_SOURCE);

    expect(DIALECTS.mysql.connect).toHaveBeenCalledWith(
      "mysql://u:p@h:3306/orders"
    );
    // 动态源工具带 <id>_ 前缀：与其它源的同名三件套天然隔离，
    // LLM 可同时区分调用两个源的同契约工具
    expect(bindings.map((b) => b.name).sort()).toEqual([
      "m1_describe_table",
      "m1_execute_sql",
      "m1_list_tables",
    ]);
  });

  it("配置变更时关闭旧连接并以新配置重建", async () => {
    const clientA = makeFakeMcpClient();
    const clientB = makeFakeMcpClient();
    vi.mocked(connectHttpMcp)
      .mockResolvedValueOnce(clientA as never)
      .mockResolvedValueOnce(clientB as never);
    const m = managerFor(JSON.stringify({ sources: [HTTP_SOURCE] }));

    await m.tools(HTTP_SOURCE);
    await m.tools({ ...HTTP_SOURCE, url: "http://10.0.0.2/mcp" });

    expect(clientA.close).toHaveBeenCalledTimes(1);
    expect(clientB.close).not.toHaveBeenCalled();
    expect(connectHttpMcp).toHaveBeenLastCalledWith(
      "openui-dynamic-jira",
      "http://10.0.0.2/mcp",
      { Authorization: "Bearer tk" }
    );
  });

  it("stdio-cli 源经 StdioClientTransport 装载并带 id 前缀，args 变更重建连接", async () => {
    const clientA = makeFakeMcpClient("zentao_bug");
    const clientB = makeFakeMcpClient("zentao_bug");
    vi.mocked(connectStdioMcp)
      .mockResolvedValueOnce(clientA as never)
      .mockResolvedValueOnce(clientB as never);
    const m = managerFor(JSON.stringify({ sources: [STDIO_SOURCE] }));

    const bindings = await m.tools(STDIO_SOURCE);

    expect(connectStdioMcp).toHaveBeenCalledWith(
      "openui-dynamic-zc",
      "zentao",
      ["mcp", "--read-only"]
    );
    expect(bindings.map((b) => b.name)).toEqual(["zc_zentao_bug"]);

    // args 变更 → 旧连接关闭、以新 args 重建
    await m.tools({ ...STDIO_SOURCE, args: ["mcp"] });
    expect(clientA.close).toHaveBeenCalledTimes(1);
    expect(connectStdioMcp).toHaveBeenLastCalledWith(
      "openui-dynamic-zc",
      "zentao",
      ["mcp"]
    );
  });

  it("close 关闭并清空缓存，未知 id 不抛", async () => {
    const fake = makeFakeMcpClient();
    vi.mocked(connectHttpMcp).mockResolvedValue(fake as never);
    const m = managerFor(JSON.stringify({ sources: [HTTP_SOURCE] }));

    await m.tools(HTTP_SOURCE);
    await m.close("jira");
    await expect(m.close("nope")).resolves.toBeUndefined();
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it("mergeToolSets 冲突时跳过后注册者并告警", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t1 = {} as never;
    const t2 = {} as never;

    const target: Record<string, never> = {};
    mergeToolSets(target, { dup: t1 }, "src-a");
    mergeToolSets(target, { dup: t2, fresh: t2 }, "src-b");

    expect(target.dup).toBe(t1);
    expect(target.fresh).toBe(t2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dup"));
    warnSpy.mockRestore();
  });
});

describe("health 动态源扩展", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("db 源探活走方言 connect + ping + close", async () => {
    const fakeDbClient = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      close: vi.fn(async () => ({})),
    };
    vi.mocked(DIALECTS.mysql.connect).mockResolvedValue(
      fakeDbClient as never
    );
    vi.mocked(DIALECTS.mysql.ping).mockResolvedValue(undefined);
    const m = managerFor(JSON.stringify({ sources: [DB_SOURCE] }));

    const result = await m.health(DB_SOURCE);

    expect(result.ok).toBe(true);
    expect(DIALECTS.mysql.ping).toHaveBeenCalledTimes(1);
    expect(fakeDbClient.close).toHaveBeenCalled();
  });

  it("动态 http-mcp 源探活走 URL 可达性", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 405 });
    vi.stubGlobal("fetch", fetchMock);
    const m = managerFor(JSON.stringify({ sources: [HTTP_SOURCE] }));

    const result = await m.health(HTTP_SOURCE);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("http://10.0.0.1:6000/mcp", {
      method: "GET",
    });
  });
});
