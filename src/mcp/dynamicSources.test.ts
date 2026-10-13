// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("./httpMcp", () => ({
  connectHttpMcp: vi.fn(),
}));

// 只 mock DIALECTS：dbMcpServer 保持真实实现，经 InMemoryTransport 走完整 MCP 协议
vi.mock("./db/dialect", () => ({
  DIALECTS: {
    postgres: { connect: vi.fn(), ping: vi.fn() },
    mysql: { connect: vi.fn(), ping: vi.fn() },
  },
}));

import { connectHttpMcp } from "./httpMcp";
import { DIALECTS } from "./db/dialect";
import { reloadDataSources } from "./registry";

async function importFreshModule() {
  vi.resetModules();
  vi.doUnmock("./registry");
  return await import("./dynamicSources");
}

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

describe("dynamicSources 装配器", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    reloadDataSources();
    vi.unstubAllGlobals();
  });

  it("http-mcp 源经 connectHttpMcp 挂载工具，execute 走 callTool", async () => {
    const fake = makeFakeMcpClient("jira_search");
    vi.mocked(connectHttpMcp).mockResolvedValue(fake as never);
    const { getDynamicSourceTools } = await importFreshModule();

    const tools = await getDynamicSourceTools(HTTP_SOURCE);

    expect(connectHttpMcp).toHaveBeenCalledWith(
      "openui-dynamic-jira",
      "http://10.0.0.1:6000/mcp",
      { Authorization: "Bearer tk" }
    );
    expect(Object.keys(tools)).toEqual(["jira_search"]);
    const out = await tools.jira_search!.execute!({ q: "x" }, {} as never);
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
    const { getDynamicSourceTools } = await importFreshModule();

    const tools = await getDynamicSourceTools(DB_SOURCE);

    expect(DIALECTS.mysql.connect).toHaveBeenCalledWith(
      "mysql://u:p@h:3306/orders"
    );
    expect(Object.keys(tools).sort()).toEqual([
      "describe_table",
      "execute_sql",
      "list_tables",
    ]);
  });

  it("配置变更时关闭旧连接并以新配置重建", async () => {
    const clientA = makeFakeMcpClient();
    const clientB = makeFakeMcpClient();
    vi.mocked(connectHttpMcp)
      .mockResolvedValueOnce(clientA as never)
      .mockResolvedValueOnce(clientB as never);
    const { getDynamicSourceTools } = await importFreshModule();

    await getDynamicSourceTools(HTTP_SOURCE);
    await getDynamicSourceTools({ ...HTTP_SOURCE, url: "http://10.0.0.2/mcp" });

    expect(clientA.close).toHaveBeenCalledTimes(1);
    expect(clientB.close).not.toHaveBeenCalled();
    expect(connectHttpMcp).toHaveBeenLastCalledWith(
      "openui-dynamic-jira",
      "http://10.0.0.2/mcp",
      { Authorization: "Bearer tk" }
    );
  });

  it("closeDynamicSource 关闭并清空缓存，未知 id 不抛", async () => {
    const fake = makeFakeMcpClient();
    vi.mocked(connectHttpMcp).mockResolvedValue(fake as never);
    const { getDynamicSourceTools, closeDynamicSource } =
      await importFreshModule();

    await getDynamicSourceTools(HTTP_SOURCE);
    await closeDynamicSource("jira");
    await expect(closeDynamicSource("nope")).resolves.toBeUndefined();
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it("mergeToolSets 冲突时跳过后注册者并告警", async () => {
    const { mergeToolSets } = await importFreshModule();
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

describe("checkDataSourceHealth 动态源扩展", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    reloadDataSources();
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
    const file = writeTempConfig(
      JSON.stringify({ builtin: {}, sources: [DB_SOURCE] })
    );
    const { checkDataSourceHealth, reloadDataSources: reload } =
      await import("./registry");
    reload(file);

    const result = await checkDataSourceHealth("m1");

    expect(result.ok).toBe(true);
    expect(DIALECTS.mysql.ping).toHaveBeenCalledTimes(1);
    expect(fakeDbClient.close).toHaveBeenCalled();
  });

  it("动态 http-mcp 源探活走 URL 可达性", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 405 });
    vi.stubGlobal("fetch", fetchMock);
    const file = writeTempConfig(
      JSON.stringify({ builtin: {}, sources: [HTTP_SOURCE] })
    );
    const { checkDataSourceHealth, reloadDataSources: reload } =
      await import("./registry");
    reload(file);

    const result = await checkDataSourceHealth("jira");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("http://10.0.0.1:6000/mcp", {
      method: "GET",
    });
  });
});
