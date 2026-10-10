import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import { getGitLabAiTools } from "@/mcp/mcpClient";
import { getZentaoAiTools } from "@/mcp/zentaoMcpClient";
import { streamText } from "ai";

vi.mock("@/mcp/mcpClient", () => ({
  callMcpTool: vi.fn(),
  getGitLabAiTools: vi.fn(),
}));

vi.mock("@/mcp/zentaoMcpClient", () => ({
  getZentaoAiTools: vi.fn(),
}));

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
});
