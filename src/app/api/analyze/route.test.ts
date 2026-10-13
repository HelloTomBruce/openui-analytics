// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import { getGitLabAiTools, getPostgresAiTools } from "@/mcp/mcpClient";
import { getZentaoAiTools } from "@/mcp/zentaoMcpClient";
import { getDynamicSourceTools } from "@/mcp/dynamicSources";
import { streamText } from "ai";

vi.mock("@/mcp/mcpClient", () => ({
  getPostgresAiTools: vi.fn(async () => ({})),
  getGitLabAiTools: vi.fn(),
}));

vi.mock("@/mcp/zentaoMcpClient", () => ({
  getZentaoAiTools: vi.fn(),
}));

vi.mock("@/mcp/dynamicSources", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/mcp/dynamicSources")
  >();
  return {
    ...actual,
    getDynamicSourceTools: vi.fn(async () => ({})),
  };
});

const TEST_DYNAMIC_HTTP = {
  id: "jira",
  name: "Jira MCP",
  kind: "http-mcp" as const,
  url: "http://10.0.0.1:6000/mcp",
  token: "",
  enabled: true,
};

vi.mock("@/mcp/registry", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/mcp/registry")
  >();
  return {
    ...actual,
    readDatasourcesConfig: vi.fn(() => ({
      builtin: {
        postgres: { enabled: true },
        "gitlab-mcp": { enabled: true },
        "zentao-cli": { enabled: true },
      },
      sources: [TEST_DYNAMIC_HTTP],
    })),
    getDynamicSourceConfig: vi.fn(() => TEST_DYNAMIC_HTTP),
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

describe("POST /api/analyze", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["OPENAI_API_KEY", "LLM_API_KEY", "OPENAI_BASE_URL", "LLM_BASE_URL", "OPENAI_MODEL", "LLM_MODEL"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    vi.mocked(getZentaoAiTools).mockResolvedValue({});
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.clearAllMocks();
  });

  it("未配置 API Key 时返回合规 data stream 降级响应", async () => {
    const res = await POST(makeRequest({ messages: [] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-vercel-ai-data-stream")).toBe("v1");
    const text = await res.text();
    expect(text).toContain("未检测到 LLM API Key");
  });

  it("GitLab MCP 加载失败时降级为空工具集并正常流式响应，不返回错误流", async () => {
    vi.mocked(getGitLabAiTools).mockRejectedValue(
      new Error("GitLab MCP connection refused")
    );
    vi.mocked(streamText).mockReturnValue({
      toDataStreamResponse: () =>
        new Response('0:"ok"\n', {
          headers: { "x-vercel-ai-data-stream": "v1" },
        }),
    } as unknown as ReturnType<typeof streamText>);

    const res = await POST(
      makeRequest({ messages: [], apiKey: "test-key" })
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    // 不应以 `3:` 错误块开头（即整个请求不应因单一数据源失败而失败）
    expect(text.startsWith("3:")).toBe(false);
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("客户端提供 baseURL 但未提供 apiKey 时拒绝（防服务端 env 凭证外泄）", async () => {
    // 模拟服务端配置了 env key
    process.env.OPENAI_API_KEY = "server-secret-key";

    const res = await POST(
      makeRequest({
        messages: [],
        baseURL: "http://attacker.example/v1",
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("apiKey");
    expect(streamText).not.toHaveBeenCalled();
  });

  it("客户端 baseURL 与 apiKey 配对提供时正常放行", async () => {
    process.env.OPENAI_API_KEY = "server-secret-key";
    vi.mocked(getGitLabAiTools).mockResolvedValue({});
    vi.mocked(streamText).mockReturnValue({
      toDataStreamResponse: () =>
        new Response('0:"ok"\n', {
          headers: { "x-vercel-ai-data-stream": "v1" },
        }),
    } as unknown as ReturnType<typeof streamText>);

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

  it("temperature 越界时钳制到 0–2", async () => {
    vi.mocked(getGitLabAiTools).mockResolvedValue({});
    vi.mocked(streamText).mockReturnValue({
      toDataStreamResponse: () =>
        new Response('0:"ok"\n', {
          headers: { "x-vercel-ai-data-stream": "v1" },
        }),
    } as unknown as ReturnType<typeof streamText>);

    await POST(makeRequest({ messages: [], apiKey: "k", temperature: 5 }));
    expect(vi.mocked(streamText).mock.calls[0][0]).toMatchObject({ temperature: 2 });

    await POST(makeRequest({ messages: [], apiKey: "k", temperature: -1 }));
    expect(vi.mocked(streamText).mock.calls[1][0]).toMatchObject({ temperature: 0 });
  });

  it("未提供 temperature 时默认 0.2", async () => {
    vi.mocked(getGitLabAiTools).mockResolvedValue({});
    vi.mocked(streamText).mockReturnValue({
      toDataStreamResponse: () =>
        new Response('0:"ok"\n', {
          headers: { "x-vercel-ai-data-stream": "v1" },
        }),
    } as unknown as ReturnType<typeof streamText>);

    await POST(makeRequest({ messages: [], apiKey: "k" }));
    expect(vi.mocked(streamText).mock.calls[0][0]).toMatchObject({ temperature: 0.2 });
  });
});

describe("POST /api/analyze 会话数据源装配", () => {
  function mockStreamOk() {
    vi.mocked(streamText).mockReturnValue({
      toDataStreamResponse: () =>
        new Response('0:"ok"\n', {
          headers: { "x-vercel-ai-data-stream": "v1" },
        }),
    } as unknown as ReturnType<typeof streamText>);
  }

  beforeEach(() => {
    vi.mocked(getZentaoAiTools).mockResolvedValue({});
    vi.mocked(getGitLabAiTools).mockResolvedValue({});
    mockStreamOk();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sources 指定 postgres 时仅装载 postgres，其余内置与动态源不装载", async () => {
    await POST(
      makeRequest({ messages: [], apiKey: "k", sources: ["postgres"] })
    );

    expect(getPostgresAiTools).toHaveBeenCalledTimes(1);
    expect(getGitLabAiTools).not.toHaveBeenCalled();
    expect(getZentaoAiTools).not.toHaveBeenCalled();
    expect(getDynamicSourceTools).not.toHaveBeenCalled();
  });

  it("sources 含动态源 id 时装载其工具并入 tools，prompt 列出该源", async () => {
    vi.mocked(getDynamicSourceTools).mockResolvedValueOnce({
      jira_jira_search: { description: "d" } as never,
    });

    await POST(
      makeRequest({ messages: [], apiKey: "k", sources: ["jira"] })
    );

    expect(getDynamicSourceTools).toHaveBeenCalledWith(TEST_DYNAMIC_HTTP);
    const arg = vi.mocked(streamText).mock.calls[0][0];
    expect(Object.keys(arg.tools ?? {})).toContain("jira_jira_search");
    expect(Object.keys(arg.tools ?? {})).toContain("cross_source_link");
    expect(arg.system).toContain("Jira MCP");
    expect(arg.system).not.toContain("ZenTao 禅道");
  });

  it("sources 全部未知/禁用时忽略并告警，请求仍 200", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST(
      makeRequest({ messages: [], apiKey: "k", sources: ["nope"] })
    );

    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("nope"));
    expect(getPostgresAiTools).not.toHaveBeenCalled();
    expect(getDynamicSourceTools).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
