import { describe, it, expect } from "vitest";
import type { CoreMessage } from "ai";
import {
  resolveContextWindow,
  computeBudget,
  estimateTextTokens,
  estimateMessagesTokens,
  projectMessages,
  trimAfterSummaryCut,
  buildSummaryPrompt,
  findLastPlanReviewIndex,
  DEFAULT_CONTEXT_WINDOW,
} from "./context";

function toolResultMsg(
  toolName: string,
  resultLength: number,
  id = "c1"
): CoreMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: id,
        toolName,
        result: "x".repeat(resultLength),
      },
    ],
  } as unknown as CoreMessage;
}

function userMsg(text: string): CoreMessage {
  return { role: "user", content: text } as CoreMessage;
}

function assistantMsg(text: string): CoreMessage {
  return { role: "assistant", content: text } as CoreMessage;
}

describe("resolveContextWindow", () => {
  it("客户端 hint 优先并钳制在 8k–2M", () => {
    expect(resolveContextWindow("whatever", 200_000)).toBe(200_000);
    expect(resolveContextWindow("whatever", 100)).toBe(8192);
    expect(resolveContextWindow("whatever", 99_000_000)).toBe(2_000_000);
  });

  it("模型名查表（长前缀优先），未知回落缺省", () => {
    expect(resolveContextWindow("gpt-4o-mini")).toBe(128_000);
    expect(resolveContextWindow("gpt-4.1")).toBe(1_000_000);
    expect(resolveContextWindow("claude-sonnet-4-5")).toBe(200_000);
    expect(resolveContextWindow("some-unknown-model")).toBe(
      DEFAULT_CONTEXT_WINDOW
    );
  });
});

describe("computeBudget", () => {
  it("阈值 = min(窗口×0.7, 窗口−maxTokens−8k)；保留窗口 = 25%", () => {
    const b = computeBudget(128_000, 16_384);
    expect(b.triggerAt).toBe(Math.min(89_600, 128_000 - 16_384 - 8192));
    expect(b.retainTokens).toBe(32_000);
    // maxTokens 很大时由右侧约束生效
    const tight = computeBudget(32_768, 16_384);
    expect(tight.triggerAt).toBe(32_768 - 16_384 - 8192);
  });
});

describe("token 估算", () => {
  it("CJK 密度高于英文（同字符数 token 更多）", () => {
    const cjk = estimateTextTokens("渠道获客成本分析".repeat(10));
    const latin = estimateTextTokens("abcdefghij".repeat(8));
    expect(cjk).toBeGreaterThan(latin);
  });

  it("消息估算含结构开销与 parts 序列化", () => {
    const simple = estimateMessagesTokens([userMsg("hi")]);
    const withParts = estimateMessagesTokens([
      {
        role: "assistant",
        content: "",
        parts: [{ type: "text", text: "x".repeat(1000) }],
      } as unknown as CoreMessage,
    ]);
    expect(simple).toBeGreaterThan(0);
    expect(withParts).toBeGreaterThan(simple);
  });
});

describe("projectMessages 投影", () => {
  // 预算：triggerAt = min(11468, 7168) = 7168；retain = 4096
  const budget = computeBudget(16_384, 1024);

  it("未超阈值：原样直发（同引用、无裁剪标记）", () => {
    const messages = [userMsg("分析一下营收"), assistantMsg("好的")];
    const result = projectMessages({ messages, budget });
    expect(result.messages).toBe(messages);
    expect(result.pruned).toBe(false);
    expect(result.summarizeUpToIndex).toBe(-1);
  });

  it("锚点校准：实测锚点超过阈值时即使启发式很小也触发裁剪", () => {
    // 启发式总量 ~5300 < 7168（直发区间），锚点 8000 > 7168 → 触发 pruning
    const messages = [
      userMsg("q"),
      toolResultMsg("execute_sql", 3000, "old"), // ~833 tok，在保留窗口外
      userMsg("y".repeat(8000)), // ~2208 tok
      userMsg("y".repeat(8000)),
      assistantMsg("a"),
    ];
    const result = projectMessages({
      messages,
      budget,
      anchorTokens: 8000, // > 7168
    });
    expect(result.pruned).toBe(true);
    expect(result.prunedCount).toBe(1);
  });

  it("pruning：保留窗口外 tool 结果替换占位符，保留 toolCallId/toolName；窗口内逐字", () => {
    const oldTool = toolResultMsg("execute_sql", 6000, "old1");
    const olderTool = toolResultMsg("describe_table", 6000, "old2");
    const edgeTool = toolResultMsg("execute_sql", 6000, "edge");
    const recentTool = toolResultMsg("list_tables", 2000, "recent");
    // 启发式总量 ~7300+ > 7168 触发；retain=4096 把 tool1/tool2 挤出窗口
    const messages = [
      userMsg("分析 CAC"),
      oldTool,
      olderTool,
      edgeTool,
      assistantMsg("中间结论"),
      userMsg("y".repeat(6000)),
      recentTool,
      userMsg("继续"),
    ];
    const result = projectMessages({ messages, budget });
    expect(result.pruned).toBe(true);
    expect(result.prunedCount).toBe(2);

    // 窗口外 tool 结果被裁剪：占位符 + 协议字段保留
    for (const [idx, name, id] of [
      [1, "execute_sql", "old1"],
      [2, "describe_table", "old2"],
    ] as const) {
      const prunedMsg = result.messages[idx] as unknown as {
        content: { toolCallId: string; toolName: string; result: string }[];
      };
      expect(prunedMsg.content[0].result).toBe(`[已裁剪: ${name}]`);
      expect(prunedMsg.content[0].toolCallId).toBe(id);
      expect(prunedMsg.content[0].toolName).toBe(name);
    }

    // 保留窗口内的 tool 结果逐字保留
    const keptMsg = result.messages[6] as unknown as {
      content: { result: string }[];
    };
    expect(keptMsg.content[0].result).toHaveLength(2000);

    // 用户消息不动
    expect((result.messages[0] as { content: string }).content).toBe(
      "分析 CAC"
    );
    // 入参原数组未被修改（投影式）
    expect(
      (messages[1] as unknown as { content: { result: string }[] }).content[0]
        .result
    ).toHaveLength(6000);
  });

  it("PlanReviewCard 豁免：assistant 消息在窗口外也逐字保留", () => {
    const plan = assistantMsg(
      '```openui\nplan = PlanReviewCard("思路确认", "问题", [], [])\n```'
    );
    // 启发式总量 ~9100 > 7168 触发；plan 与 tool2 都在保留窗口外
    const messages = [
      userMsg("z".repeat(8000)),
      plan,
      toolResultMsg("execute_sql", 8000, "t2"),
      toolResultMsg("execute_sql", 8000, "t3"),
      userMsg("y".repeat(8000)),
      userMsg("继续"),
    ];
    const result = projectMessages({ messages, budget });
    // assistant（含 PlanReviewCard）不在 pruning 目标内
    expect(
      (result.messages[1] as { content: string }).content
    ).toContain("PlanReviewCard");
    expect(result.prunedCount).toBe(2); // 窗口外的两条 tool 被裁；plan/user 不动
  });

  it("pruning 后仍超阈值 → 标记摘要裁剪区间", () => {
    // 大量不可裁剪的 user 消息（窗口外），pruning 无效
    const messages = [
      ...Array.from({ length: 6 }, (_, i) => userMsg("u".repeat(7000) + i)),
      userMsg("最新问题"),
    ];
    const result = projectMessages({ messages, budget });
    expect(result.summarizeUpToIndex).toBeGreaterThanOrEqual(0);
    // 摘要区间不覆盖保留窗口内的最新消息
    expect(result.summarizeUpToIndex).toBeLessThan(messages.length - 1);
  });
});

describe("trimAfterSummaryCut 边界清理", () => {
  it("丢弃开头孤儿 tool 消息；首条非 user 时补衔接消息", () => {
    const trimmed = trimAfterSummaryCut([
      toolResultMsg("execute_sql", 100),
      assistantMsg("结论"),
    ]);
    expect(trimmed[0].role).toBe("user");
    expect((trimmed[0] as { content: string }).content).toContain("摘要");
    expect(trimmed[1].role).toBe("assistant");
  });

  it("首条已是 user 时不补", () => {
    const trimmed = trimAfterSummaryCut([userMsg("继续"), assistantMsg("好")]);
    expect(trimmed).toHaveLength(2);
    expect(trimmed[0].role).toBe("user");
  });

  it("裁空时也返回一条衔接消息（保证首条 user）", () => {
    const trimmed = trimAfterSummaryCut([]);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].role).toBe("user");
  });
});

describe("buildSummaryPrompt", () => {
  it("包含保留要点与历史正文；有旧摘要时含增量指令", () => {
    const prompt = buildSummaryPrompt({
      covered: [userMsg("分析 CAC"), assistantMsg("结论：渠道 A 最低")],
      previousSummary: "旧摘要",
    });
    expect(prompt).toContain("原始分析目标");
    expect(prompt).toContain("PlanReviewCard");
    expect(prompt).toContain("旧摘要");
    expect(prompt).toContain("分析 CAC");
  });
});

describe("findLastPlanReviewIndex", () => {
  it("只看最近一条 assistant 消息", () => {
    const old = assistantMsg('PlanReviewCard("旧规划")');
    const messages = [old, userMsg("确认"), assistantMsg("看板输出")];
    expect(findLastPlanReviewIndex(messages)).toBe(-1);
    const messages2 = [old, userMsg("确认")];
    expect(findLastPlanReviewIndex(messages2)).toBe(0);
  });
});
