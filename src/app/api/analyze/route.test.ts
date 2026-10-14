// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import { datasources } from "@/lib/datasources";
import { streamText } from "ai";

const TEST_DYNAMIC_HTTP = {
  id: "jira",
  name: "Jira MCP",
  kind: "http-mcp" as const,
  url: "http://10.0.0.1:6000/mcp",
  token: "",
  enabled: true,
};

// 接缝 mock：真实 manager（读临时配置文件，resolveActive/get 走真实现），
// 仅 tools（IO）替换为 mock —— 等价于原 readDatasourcesConfig/getDynamicSourceConfig mock
// 注意：工厂执行期（模块导入时）顶层常量与顶层 import 均未初始化，
// 工厂内所需模块一律动态 import、配置内容内联
vi.mock("@/lib/datasources", async () => {
  const [{ createDatasourceManager }, fs, os, path] = await Promise.all([
    import("@openui-analytics/datasources"),
    import("node:fs"),
    import("node:os"),
    import("node:path"),
  ]);
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "analyze-route-")),
    "datasources.json"
  );
  fs.writeFileSync(
    file,
    JSON.stringify({
      sources: [
        {
          id: "jira",
          name: "Jira MCP",
          kind: "http-mcp",
          url: "http://10.0.0.1:6000/mcp",
          token: "",
          enabled: true,
        },
      ],
    })
  );
  const real = createDatasourceManager({ configPath: file });
  return {
    datasources: {
      ...real,
      tools: vi.fn(async () => []),
    },
  };
});

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => vi.fn()),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
  };
});

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3006/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockStreamOk() {
  vi.mocked(streamText).mockReturnValue({
    toDataStreamResponse: () =>
      new Response('0:"ok"\n', {
        headers: { "x-vercel-ai-data-stream": "v1" },
      }),
  } as unknown as ReturnType<typeof streamText>);
}

describe("POST /api/analyze", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["OPENAI_API_KEY", "LLM_API_KEY", "OPENAI_BASE_URL", "LLM_BASE_URL", "OPENAI_MODEL", "LLM_MODEL"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    mockStreamOk();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.clearAllMocks();
  });

  it("未配置 API Key 时返回合规 data stream 降级响应（引导「设置」）", async () => {
    const res = await POST(makeRequest({ messages: [] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-vercel-ai-data-stream")).toBe("v1");
    const text = await res.text();
    expect(text).toContain("未检测到 LLM API Key");
    expect(text).toContain("「设置」");
  });

  it("动态源工具加载失败时降级为空工具集并正常流式响应", async () => {
    vi.mocked(datasources.tools).mockRejectedValueOnce(
      new Error("connection refused")
    );

    const res = await POST(
      makeRequest({ messages: [], apiKey: "test-key" })
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.startsWith("3:")).toBe(false);
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("客户端提供 baseURL 但未提供 apiKey 时拒绝", async () => {
    process.env.OPENAI_API_KEY = "server-secret-key";

    const res = await POST(
      makeRequest({ messages: [], baseURL: "http://attacker.example/v1" })
    );

    expect(res.status).toBe(400);
    expect(streamText).not.toHaveBeenCalled();
  });

  it("客户端 baseURL 与 apiKey 配对提供时正常放行", async () => {
    process.env.OPENAI_API_KEY = "server-secret-key";
    const res = await POST(
      makeRequest({
        messages: [],
        baseURL: "http://my-llm.example/v1",
        apiKey: "client-own-key",
      })
    );
    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("temperature 越界时钳制到 0–2，缺省 0.2", async () => {
    await POST(makeRequest({ messages: [], apiKey: "k", temperature: 5 }));
    expect(vi.mocked(streamText).mock.calls[0][0]).toMatchObject({ temperature: 2 });

    await POST(makeRequest({ messages: [], apiKey: "k", temperature: -1 }));
    expect(vi.mocked(streamText).mock.calls[1][0]).toMatchObject({ temperature: 0 });

    await POST(makeRequest({ messages: [], apiKey: "k" }));
    expect(vi.mocked(streamText).mock.calls[2][0]).toMatchObject({ temperature: 0.2 });
  });

  it("sources 未知 id 忽略并告警，请求仍 200 且不装载任何源", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST(
      makeRequest({ messages: [], apiKey: "k", sources: ["nope"] })
    );

    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("nope"));
    expect(datasources.tools).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("POST /api/analyze 全动态装配", () => {
  beforeEach(() => {
    mockStreamOk();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("未指定 sources 时装载全部启用源，gitlab 透传字段被忽略", async () => {
    await POST(
      makeRequest({
        messages: [],
        apiKey: "k",
        gitlabUrl: "http://legacy.example/mcp",
        gitlabToken: "glpat-old",
      })
    );

    expect(datasources.tools).toHaveBeenCalledWith(TEST_DYNAMIC_HTTP);
    const arg = vi.mocked(streamText).mock.calls[0][0];
    expect(Object.keys(arg.tools ?? {})).toContain("cross_source_link");
  });

  it("sources 指定动态源时装载其工具并入 tools，prompt 列出该源", async () => {
    vi.mocked(datasources.tools).mockResolvedValueOnce([
      {
        name: "jira_jira_search",
        originalName: "jira_search",
        description: "d",
        inputSchema: { type: "object" },
        call: async () => ({}),
      },
    ]);

    await POST(
      makeRequest({ messages: [], apiKey: "k", sources: ["jira"] })
    );

    expect(datasources.tools).toHaveBeenCalledWith(TEST_DYNAMIC_HTTP);
    const arg = vi.mocked(streamText).mock.calls[0][0];
    expect(Object.keys(arg.tools ?? {})).toContain("jira_jira_search");
    expect(arg.system).toContain("Jira MCP");
    // 无内置静态段
    expect(arg.system).not.toContain("PostgreSQL Analytics Database");
  });
});
