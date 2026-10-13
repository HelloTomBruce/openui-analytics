// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const clientInstances: Array<{
  connect: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(function () {
    const instance = {
      // connect 模拟异步握手，制造并发窗口
      connect: vi.fn(
        () => new Promise<void>((resolve) => setTimeout(resolve, 20))
      ),
    };
    clientInstances.push(instance);
    return instance;
  }),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(function () {
    return { onerror: null, onclose: null };
  }),
}));

vi.mock("ai", () => ({
  tool: vi.fn((config) => config),
  jsonSchema: vi.fn((schema) => schema),
}));

async function importFresh() {
  vi.resetModules();
  return await import("./zentaoMcpClient");
}

describe("getZentaoMcpClient 连接互斥", () => {
  beforeEach(() => {
    clientInstances.length = 0;
    vi.clearAllMocks();
  });

  it("并发调用只建立一个连接（共享 connecting Promise）", async () => {
    const { getZentaoMcpClient } = await importFresh();

    const [c1, c2, c3] = await Promise.all([
      getZentaoMcpClient(),
      getZentaoMcpClient(),
      getZentaoMcpClient(),
    ]);

    expect(clientInstances).toHaveLength(1);
    expect(c1).toBe(c2);
    expect(c2).toBe(c3);
  });

  it("连接建立后再次调用直接复用缓存", async () => {
    const { getZentaoMcpClient } = await importFresh();

    const c1 = await getZentaoMcpClient();
    const c2 = await getZentaoMcpClient();

    expect(clientInstances).toHaveLength(1);
    expect(c1).toBe(c2);
  });

  it("连接失败后释放互斥锁，允许后续重试", async () => {
    const { getZentaoMcpClient } = await importFresh();

    // 第一次连接失败
    clientInstances.length = 0;
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    vi.mocked(Client).mockImplementationOnce(function () {
      const instance = {
        connect: vi.fn(async () => {
          throw new Error("zentao CLI 未安装");
        }),
      };
      clientInstances.push(instance);
      return instance;
    });

    await expect(getZentaoMcpClient()).rejects.toThrow("zentao CLI 未安装");

    // 重试应能成功（新实例）
    const c = await getZentaoMcpClient();
    expect(c).toBeTruthy();
    expect(clientInstances).toHaveLength(2);
  });
});
