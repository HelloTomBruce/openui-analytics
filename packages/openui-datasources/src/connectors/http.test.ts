// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock MCP SDK：观察 transport 构造参数与 client.connect 的调用序列
const clientInstances: Array<{
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
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
  return await import("./http");
}

describe("connectHttpMcp", () => {
  beforeEach(() => {
    clientInstances.length = 0;
    vi.clearAllMocks();
  });

  it("StreamableHTTP 连接成功时不尝试 SSE", async () => {
    const { connectHttpMcp } = await importFreshModule();

    const client = await connectHttpMcp("test-client", "http://10.0.0.1/mcp", {
      Authorization: "Bearer t",
    });

    expect(client).toBe(clientInstances[0]);
    expect(clientInstances[0].connect).toHaveBeenCalledTimes(1);
    const { SSEClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/sse.js"
    );
    expect(SSEClientTransport).not.toHaveBeenCalled();
  });

  it("StreamableHTTP 失败时降级 SSE 连接", async () => {
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );
    vi.mocked(StreamableHTTPClientTransport).mockImplementationOnce(() => {
      throw new Error("streamable refused");
    });
    const { connectHttpMcp } = await importFreshModule();

    const client = await connectHttpMcp("test-client", "http://10.0.0.1/mcp", {});

    expect(client).toBe(clientInstances[0]);
    const { SSEClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/sse.js"
    );
    expect(SSEClientTransport).toHaveBeenCalledTimes(1);
    expect(clientInstances[0].connect).toHaveBeenCalledTimes(1);
  });

  it("headers 经 requestInit 原样传入 transport", async () => {
    const { connectHttpMcp } = await importFreshModule();
    const headers = { Authorization: "Bearer t", "Private-Token": "glpat" };

    await connectHttpMcp("test-client", "http://10.0.0.1/mcp", headers);

    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );
    expect(StreamableHTTPClientTransport).toHaveBeenCalledTimes(1);
    const [urlArg, initArg] = vi.mocked(StreamableHTTPClientTransport).mock
      .calls[0] as unknown as [URL, { requestInit: { headers: typeof headers } }];
    expect(urlArg).toBeInstanceOf(URL);
    expect(urlArg.href).toBe("http://10.0.0.1/mcp");
    expect(initArg.requestInit.headers).toEqual(headers);
  });
});
