import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "./route";
import { createAppMethodology } from "@/lib/methodologyLoader";
import { createMethodLibrary } from "@openui-analytics/methodology";
import { builtinMethodCards } from "@openui-analytics/methodology";

/** 接缝 mock：路由层只验证协议/状态码/载荷形态，装配行为由 methodologyLoader 单测覆盖 */
vi.mock("@/lib/methodologyLoader", () => ({
  createAppMethodology: vi.fn(),
}));

const mockedCreate = vi.mocked(createAppMethodology);

/** 真实注册表装配：内置卡 + 一张覆盖卡 + 一张新卡 */
function assemble(overrides?: Partial<ReturnType<typeof createAppMethodology>>) {
  const userCards = builtinMethodCards.slice(0, 1).map((c) => ({
    ...c,
    name: "趋势分析（定制版）",
  }));
  const { library } = createMethodLibrary({
    builtin: builtinMethodCards,
    custom: userCards,
  });
  return {
    library,
    skipped: [{ cardId: "broken.json", reason: "JSON 解析失败" }],
    userIds: new Set(userCards.map((c) => c.id)),
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/methodology", () => {
  it("返回合并卡集：id/名称/适用信号/步骤/图表配对 + source 标记，不含 executeGuidance", async () => {
    mockedCreate.mockReturnValue(assemble());

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.cards).toHaveLength(builtinMethodCards.length);
    const trend = body.cards.find((c: { id: string }) => c.id === "trend");
    expect(trend).toMatchObject({
      name: "趋势分析（定制版）",
      source: "user",
    });
    expect(trend.steps.length).toBeGreaterThan(0);
    expect(trend.chartPairing).toEqual(["AnalyticsChart", "MetricCard"]);
    // executeGuidance 是 LLM prompt 内部件，不进查看契约
    expect(trend.executeGuidance).toBeUndefined();
    // 未被覆盖的内置卡 source=builtin
    expect(
      body.cards.find((c: { id: string }) => c.id === "pareto").source
    ).toBe("builtin");
  });

  it("counts 统计内置/用户/覆盖数，skipped 透传坏卡清单", async () => {
    mockedCreate.mockReturnValue(assemble());

    const body = await (await GET()).json();

    expect(body.counts).toEqual({
      builtin: builtinMethodCards.length,
      user: 1,
      overridden: 1,
    });
    expect(body.skipped).toEqual([
      { cardId: "broken.json", reason: "JSON 解析失败" },
    ]);
  });

  it("装配异常返回 500 + error 消息", async () => {
    mockedCreate.mockImplementation(() => {
      throw new Error("disk boom");
    });

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("disk boom");
  });
});
