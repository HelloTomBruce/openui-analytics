// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAnalyzeHandler, type SessionContextStore } from "./handler";
import type {
  DatasourceManager,
  McpToolBinding,
} from "@openui-analytics/datasources";
import { streamText, generateText } from "ai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DYNAMIC_HTTP = {
  id: "jira",
  name: "Jira MCP",
  kind: "http-mcp" as const,
  url: "http://10.0.0.1:6000/mcp",
  token: "",
  enabled: true,
};

// 依赖注入接缝：真 manager 读临时配置文件（resolveActive/get 走真实现），
// 仅 tools（IO）覆写为 mock —— 等价于原 vi.mock("@/lib/datasources") 的语义
async function makeFakeManager(): Promise<DatasourceManager> {
  const { createDatasourceManager } = await import(
    "@openui-analytics/datasources"
  );
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "llm-handler-")),
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
  const tools = vi.fn(async (): Promise<McpToolBinding[]> => []);
  return { ...real, tools };
}

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => vi.fn()),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn()),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
    generateText: vi.fn(),
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

describe("createAnalyzeHandler", () => {
  const savedEnv: Record<string, string | undefined> = {};
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    for (const key of ["OPENAI_API_KEY", "LLM_API_KEY", "OPENAI_BASE_URL", "LLM_BASE_URL", "OPENAI_MODEL", "LLM_MODEL"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    mockStreamOk();
    POST = createAnalyzeHandler({ datasources: await makeFakeManager() });
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
    const manager = await makeFakeManager();
    vi.mocked(manager.tools).mockRejectedValueOnce(
      new Error("connection refused")
    );
    POST = createAnalyzeHandler({ datasources: manager });

    const res = await POST(makeRequest({ messages: [], apiKey: "test-key" }));
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
    const manager = await makeFakeManager();
    POST = createAnalyzeHandler({ datasources: manager });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST(
      makeRequest({ messages: [], apiKey: "k", sources: ["nope"] })
    );

    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("nope"));
    expect(manager.tools).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("createAnalyzeHandler 全动态装配", () => {
  beforeEach(() => {
    mockStreamOk();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("未指定 sources 时装载全部启用源，gitlab 透传字段被忽略", async () => {
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });

    await POST(
      makeRequest({
        messages: [],
        apiKey: "k",
        gitlabUrl: "http://legacy.example/mcp",
        gitlabToken: "glpat-old",
      })
    );

    expect(manager.tools).toHaveBeenCalledWith(TEST_DYNAMIC_HTTP);
    const arg = vi.mocked(streamText).mock.calls[0][0];
    expect(Object.keys(arg.tools ?? {})).toContain("cross_source_link");
  });

  it("protocol=anthropic 时走 createAnthropic 且 baseURL 规范化补 /v1，不调 createOpenAI", async () => {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });

    await POST(
      makeRequest({
        messages: [],
        apiKey: "k",
        baseURL: "https://api.kimi.com/coding/",
        protocol: "anthropic",
      })
    );

    expect(createAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "k",
        baseURL: "https://api.kimi.com/coding/v1",
      })
    );
    expect(createOpenAI).not.toHaveBeenCalled();
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("maxTokens：请求体优先并钳制 1024–65536；缺省 16384；env LLM_MAX_OUTPUT_TOKENS 兜底", async () => {
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });

    // 请求体超上限 → 钳到 65536
    await POST(makeRequest({ messages: [], apiKey: "k", maxTokens: 999999 }));
    expect(vi.mocked(streamText).mock.calls[0][0].maxTokens).toBe(65536);

    // 请求体低于下限 → 钳到 1024
    await POST(makeRequest({ messages: [], apiKey: "k", maxTokens: 100 }));
    expect(vi.mocked(streamText).mock.calls[1][0].maxTokens).toBe(1024);

    // 缺省 → 16384
    await POST(makeRequest({ messages: [], apiKey: "k" }));
    expect(vi.mocked(streamText).mock.calls[2][0].maxTokens).toBe(16384);

    // env 覆盖缺省
    process.env.LLM_MAX_OUTPUT_TOKENS = "32768";
    try {
      await POST(makeRequest({ messages: [], apiKey: "k" }));
      expect(vi.mocked(streamText).mock.calls[3][0].maxTokens).toBe(32768);
    } finally {
      delete process.env.LLM_MAX_OUTPUT_TOKENS;
    }
  });

  it("sources 指定动态源时装载其工具并入 tools，prompt 列出该源", async () => {
    const manager = await makeFakeManager();
    vi.mocked(manager.tools).mockResolvedValueOnce([
      {
        name: "jira_jira_search",
        originalName: "jira_search",
        description: "d",
        inputSchema: { type: "object" },
        call: async () => ({}),
      },
    ]);
    const POST = createAnalyzeHandler({ datasources: manager });

    await POST(makeRequest({ messages: [], apiKey: "k", sources: ["jira"] }));

    expect(manager.tools).toHaveBeenCalledWith(TEST_DYNAMIC_HTTP);
    const arg = vi.mocked(streamText).mock.calls[0][0];
    expect(Object.keys(arg.tools ?? {})).toContain("jira_jira_search");
    expect(arg.system).toContain("Jira MCP");
    // 无内置静态段
    expect(arg.system).not.toContain("PostgreSQL Analytics Database");
  });

  it("mode 分派：plan → 规划提示词 + maxSteps=6；execute → 执行提示词；非法/缺省 → direct", async () => {
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });

    await POST(makeRequest({ messages: [], apiKey: "k", mode: "plan" }));
    let arg = vi.mocked(streamText).mock.calls[0][0];
    expect(arg.system).toContain("Planning Mode");
    expect(arg.system).toContain("PlanReviewCard");
    expect(arg.maxSteps).toBe(6);
    // 规划轮次工具照常装配（探查需要）
    expect(Object.keys(arg.tools ?? {})).toContain("cross_source_link");

    await POST(makeRequest({ messages: [], apiKey: "k", mode: "execute" }));
    arg = vi.mocked(streamText).mock.calls[1][0];
    expect(arg.system).toContain("Confirmed Plan Execution Mode");
    expect(arg.maxSteps).toBe(10);

    // 非法值回落 direct：不含规划/执行增量段
    await POST(
      makeRequest({ messages: [], apiKey: "k", mode: "bogus" as unknown as "plan" })
    );
    arg = vi.mocked(streamText).mock.calls[2][0];
    expect(arg.system).not.toContain("Planning Mode");
    expect(arg.system).not.toContain("Confirmed Plan Execution Mode");

    // 缺省完全向后兼容
    await POST(makeRequest({ messages: [], apiKey: "k" }));
    arg = vi.mocked(streamText).mock.calls[3][0];
    expect(arg.system).not.toContain("Planning Mode");
    expect(arg.maxSteps).toBe(10);
  });
});

describe("createAnalyzeHandler Schema Card 注入", () => {
  beforeEach(() => {
    mockStreamOk();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("启用源有卡时 system 含结构卡段；无卡时不含", async () => {
    const manager = await makeFakeManager();
    const card = {
      sourceId: "jira",
      generatedAt: 1761811200000,
      kind: "db-like" as const,
      truncated: false,
      tables: [
        {
          name: "issues",
          rowCount: 42,
          columns: [
            { name: "status", type: "text", cardinality: 3, topValues: ["open"] },
          ],
        },
      ],
    };
    const withCard = vi.fn(async () => ({ card, stale: false }));
    const POST1 = createAnalyzeHandler({
      datasources: { ...manager, getSchemaCard: withCard },
    });
    await POST1(makeRequest({ messages: [], apiKey: "k" }));
    const sys1 = vi.mocked(streamText).mock.calls[0][0].system as string;
    expect(sys1).toContain("Schema Cards");
    expect(sys1).toContain("issues（约 42 行）");

    // 无卡（null）→ 不注入
    const without = vi.fn(async () => null);
    const POST2 = createAnalyzeHandler({
      datasources: { ...manager, getSchemaCard: without },
    });
    await POST2(makeRequest({ messages: [], apiKey: "k" }));
    const sys2 = vi.mocked(streamText).mock.calls[1][0].system as string;
    expect(sys2).not.toContain("Schema Cards");
  });

  it("读卡失败静默降级（不阻塞分析请求）", async () => {
    const manager = await makeFakeManager();
    const broken = vi.fn(async () => {
      throw new Error("disk gone");
    });
    const POST = createAnalyzeHandler({
      datasources: { ...manager, getSchemaCard: broken },
    });
    const res = await POST(makeRequest({ messages: [], apiKey: "k" }));
    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalledTimes(1);
  });
});

describe("createAnalyzeHandler 方法论注入", () => {
  beforeEach(() => {
    mockStreamOk();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("direct 模式注入方法索引（含内置卡条目）", async () => {
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });
    await POST(makeRequest({ messages: [], apiKey: "k" }));
    const sys = vi.mocked(streamText).mock.calls[0][0].system as string;
    expect(sys).toContain("Analysis Method Index");
    expect(sys).toContain("- trend: 趋势与同比环比");
  });

  it("execute 模式：从最近 assistant 消息（PlanReviewCard）提取方法 id 注入详情", async () => {
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });
    await POST(
      makeRequest({
        messages: [
          { role: "user", content: "各渠道投放 ROI 怎么样" },
          {
            role: "assistant",
            content:
              '思路确认（方法：pareto + trend）\n```openui\nroot = Root([plan])\nplan = PlanReviewCard("投放 ROI 思路")\n```',
          },
          { role: "user", content: "按此思路开始分析" },
        ],
        apiKey: "k",
        mode: "execute",
      })
    );
    const sys = vi.mocked(streamText).mock.calls[0][0].system as string;
    expect(sys).toContain("### Method pareto");
    expect(sys).toContain("### Method trend");
    expect(sys).toContain("follow their detailed guidance strictly");
    // 按需详情：不注入全量索引
    expect(sys).not.toContain("Analysis Method Index");
  });

  it("execute 未命中方法：回落无详情的执行约束", async () => {
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({ datasources: manager });
    await POST(
      makeRequest({
        messages: [
          { role: "assistant", content: "一个没有方法命名的规划" },
          { role: "user", content: "开始" },
        ],
        apiKey: "k",
        mode: "execute",
      })
    );
    const sys = vi.mocked(streamText).mock.calls[0][0].system as string;
    expect(sys).toContain("Confirmed Plan Execution Mode");
    expect(sys).not.toContain("### Method ");
  });

  it("methodology 注入自定义库：索引与 execute 详情来自注入卡", async () => {
    const { createMethodLibrary, builtinMethodCards } = await import(
      "@openui-analytics/methodology"
    );
    const custom = createMethodLibrary({
      builtin: builtinMethodCards,
      custom: [
        {
          id: "dora",
          name: "DORA 效能分析",
          when: "研发交付效能四指标",
          steps: ["计算部署频率/变更前置时间/变更失败率/恢复时间", "对标基准并定位短板"],
          chartPairing: ["AnalyticsChart", "MetricCard"],
          executeGuidance: "Compute the four DORA metrics and benchmark them; highlight the weakest dimension.",
        },
      ],
    });
    const manager = await makeFakeManager();
    const POST = createAnalyzeHandler({
      datasources: manager,
      methodology: custom.library,
    });

    await POST(makeRequest({ messages: [], apiKey: "k" }));
    let sys = vi.mocked(streamText).mock.calls[0][0].system as string;
    // 索引注入生效（11 卡超 1KB 预算截断——断言头部条目而非尾部 dora）
    expect(sys).toContain("Analysis Method Index");
    expect(sys).toContain("- trend: 趋势与同比环比");

    await POST(
      makeRequest({
        messages: [
          { role: "assistant", content: "规划（方法 dora）" },
          { role: "user", content: "开始" },
        ],
        apiKey: "k",
        mode: "execute",
      })
    );
    sys = vi.mocked(streamText).mock.calls[1][0].system as string;
    expect(sys).toContain("### Method dora · DORA 效能分析");
  });
});

describe("createAnalyzeHandler 上下文治理", () => {
  const savedEnv: Record<string, string | undefined> = {};
  let POST: (req: Request) => Promise<Response>;
  let getContext: ReturnType<
    typeof vi.fn<SessionContextStore["getContext"]>
  >;
  let updateContext: ReturnType<
    typeof vi.fn<SessionContextStore["updateContext"]>
  >;

  const toolResultMsg = (toolName: string, len: number, id: string) => ({
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: id, toolName, result: "x".repeat(len) },
    ],
  });

  beforeEach(async () => {
    for (const key of ["OPENAI_API_KEY", "LLM_API_KEY", "OPENAI_BASE_URL", "LLM_BASE_URL", "OPENAI_MODEL", "LLM_MODEL"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    mockStreamOk();
    getContext = vi.fn(async () => undefined);
    updateContext = vi.fn(async () => {});
    POST = createAnalyzeHandler({
      datasources: await makeFakeManager(),
      sessions: { getContext, updateContext },
    });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.clearAllMocks();
  });

  it("小历史：消息原样透传（直发路径）", async () => {
    const messages = [
      { role: "user", content: "分析 CAC" },
      { role: "assistant", content: "好的" },
    ];
    await POST(
      makeRequest({ messages, apiKey: "k", sessionId: "sess_ab12cd34" })
    );
    const sent = vi.mocked(streamText).mock.calls[0][0].messages;
    expect(sent).toEqual(messages);
  });

  it("onFinish：实测 promptTokens 回写会话元数据（token 锚点）", async () => {
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "hi" }],
        apiKey: "k",
        sessionId: "sess_ab12cd34",
      })
    );
    const onFinish = vi.mocked(streamText).mock.calls[0][0].onFinish as (
      arg: unknown
    ) => void;
    onFinish({ usage: { promptTokens: 12345, completionTokens: 10 } });
    expect(updateContext).toHaveBeenCalledWith("sess_ab12cd34", {
      lastPromptTokens: 12345,
    });
  });

  it("无 sessionId：治理降级，不读写会话元数据", async () => {
    await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }], apiKey: "k" })
    );
    expect(getContext).not.toHaveBeenCalled();
    const onFinish = vi.mocked(streamText).mock.calls[0][0].onFinish as (
      arg: unknown
    ) => void;
    onFinish({ usage: { promptTokens: 123 } });
    expect(updateContext).not.toHaveBeenCalled();
  });

  it("超阈值：窗口外 tool 结果裁剪为占位符，用户消息不动", async () => {
    // contextWindow=16384 + maxTokens=1024 → triggerAt=7168（夹具总量 ~7300+）
    const messages = [
      { role: "user", content: "分析 CAC" },
      toolResultMsg("execute_sql", 6000, "c1"),
      toolResultMsg("describe_table", 6000, "c2"),
      { role: "assistant", content: "中间结论" },
      { role: "user", content: "y".repeat(6000) },
      toolResultMsg("list_tables", 2000, "c3"),
      { role: "user", content: "继续" },
    ];
    await POST(
      makeRequest({
        messages,
        apiKey: "k",
        sessionId: "sess_ab12cd34",
        contextWindow: 16384,
        maxTokens: 1024,
      })
    );
    const sent = vi.mocked(streamText).mock.calls[0][0].messages as {
      role: string;
      content: { result?: string }[] | string;
    }[];
    const pruned = sent[1].content as { result: string }[];
    expect(pruned[0].result).toBe("[已裁剪: execute_sql]");
    // 用户消息原样
    expect(sent[0].content).toBe("分析 CAC");
    // 无摘要触发时 system 不含摘要段
    const sys = vi.mocked(streamText).mock.calls[0][0].system as string;
    expect(sys).not.toContain("此前会话摘要");
  });

  it("pruning 不足：触发 LLM 摘要并缓存；命中缓存不再生成", async () => {
    // 大量不可裁剪 user 消息：pruning 无效 → 摘要兜底
    const messages = [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `u${i}`,
        role: "user",
        content: "u".repeat(7000) + i,
      })),
      { id: "latest", role: "user", content: "最新问题" },
    ];
    vi.mocked(generateText).mockResolvedValueOnce({
      text: " 缓存摘要内容 ",
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    await POST(
      makeRequest({
        messages,
        apiKey: "k",
        sessionId: "sess_ab12cd34",
        contextWindow: 16384,
        maxTokens: 1024,
      })
    );
    expect(generateText).toHaveBeenCalledTimes(1);
    const sys = vi.mocked(streamText).mock.calls[0][0].system as string;
    expect(sys).toContain("此前会话摘要");
    expect(sys).toContain("缓存摘要内容");
    // 摘要缓存写回（游标 = 覆盖区间末条消息 id）
    expect(updateContext).toHaveBeenCalledWith(
      "sess_ab12cd34",
      expect.objectContaining({ summary: "缓存摘要内容" })
    );
    // 摘要裁剪后消息数减少且首条为 user
    const sent = vi.mocked(streamText).mock.calls[0][0].messages as {
      role: string;
    }[];
    expect(sent.length).toBeLessThan(messages.length);
    expect(sent[0].role).toBe("user");

    // 第二次：摘要游标命中缓存 → 不再调用 generateText
    const coveredMarker = (
      updateContext.mock.calls[0][1] as { summaryUptoMessageId: string }
    ).summaryUptoMessageId;
    getContext.mockResolvedValueOnce({
      summary: "缓存摘要内容",
      summaryUptoMessageId: coveredMarker,
    });
    await POST(
      makeRequest({
        messages,
        apiKey: "k",
        sessionId: "sess_ab12cd34",
        contextWindow: 16384,
        maxTokens: 1024,
      })
    );
    expect(generateText).toHaveBeenCalledTimes(1); // 未新增调用
    const sys2 = vi.mocked(streamText).mock.calls[1][0].system as string;
    expect(sys2).toContain("缓存摘要内容");
  });

  it("摘要生成失败：退化为 pruning 投影，不阻塞分析", async () => {
    const messages = [
      ...Array.from({ length: 6 }, (_, i) => ({
        role: "user",
        content: "u".repeat(7000) + i,
      })),
      { role: "user", content: "最新问题" },
    ];
    vi.mocked(generateText).mockRejectedValueOnce(new Error("llm down"));
    const res = await POST(
      makeRequest({
        messages,
        apiKey: "k",
        sessionId: "sess_ab12cd34",
        contextWindow: 16384,
        maxTokens: 1024,
      })
    );
    expect(res.status).toBe(200);
    const sys = vi.mocked(streamText).mock.calls[0][0].system as string;
    expect(sys).not.toContain("此前会话摘要");
  });
});
