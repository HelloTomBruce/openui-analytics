// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock MCP SDK：Client/Transport 均为假实现，仅观察构造与 connect/close 调用
const clientInstances: Array<{
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  // 用 function 而非箭头函数实现，保证可被 new 调用（构造函数返回对象时以对象为准）
  Client: vi.fn().mockImplementation(function () {
    const instance = {
      connect: vi.fn(async () => ({})),
      close: vi.fn(async () => ({})),
    };
    clientInstances.push(instance);
    return instance;
  }),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn(),
}));

async function importFreshModule() {
  vi.resetModules();
  return await import("./mcpClient");
}

describe("getGitLabMcpClient 缓存键控", () => {
  beforeEach(() => {
    clientInstances.length = 0;
    vi.clearAllMocks();
  });

  it("相同 endpoint+token 复用同一连接，不重复建连", async () => {
    const { getGitLabMcpClient } = await importFreshModule();

    const c1 = await getGitLabMcpClient("http://10.0.0.1:5002/mcp", "glpat-a");
    const c2 = await getGitLabMcpClient("http://10.0.0.1:5002/mcp", "glpat-a");

    expect(c1).toBe(c2);
    expect(clientInstances).toHaveLength(1);
  });

  it("endpoint 或 token 变化时关闭旧连接并重建", async () => {
    const { getGitLabMcpClient } = await importFreshModule();

    const c1 = await getGitLabMcpClient("http://10.0.0.1:5002/mcp", "glpat-a");
    const c2 = await getGitLabMcpClient("http://10.0.0.2:5002/mcp", "glpat-a");
    const c3 = await getGitLabMcpClient("http://10.0.0.2:5002/mcp", "glpat-b");

    expect(c2).not.toBe(c1);
    expect(c3).not.toBe(c2);
    expect(clientInstances).toHaveLength(3);
    // 旧连接均被显式关闭
    expect(clientInstances[0].close).toHaveBeenCalledTimes(1);
    expect(clientInstances[1].close).toHaveBeenCalledTimes(1);
    expect(clientInstances[2].close).not.toHaveBeenCalled();
  });

  it("同一 endpoint 不同 token 不串用连接（凭证隔离）", async () => {
    const { getGitLabMcpClient } = await importFreshModule();

    const c1 = await getGitLabMcpClient("http://10.0.0.1:5002/mcp", "glpat-user-a");
    const c2 = await getGitLabMcpClient("http://10.0.0.1:5002/mcp", "glpat-user-b");

    expect(c2).not.toBe(c1);
    expect(clientInstances[0].close).toHaveBeenCalledTimes(1);
  });
});
