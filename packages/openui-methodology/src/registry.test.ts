import { describe, it, expect } from "vitest";
import { builtinMethodCards } from "./cards";
import {
  createMethodLibrary,
  validateCards,
  filterCardShape,
} from "./registry";
import type { MethodCard } from "./types";

const VALID_NAMES = new Set([
  "AnalyticsChart",
  "MetricCard",
  "FunnelChart",
  "InsightBox",
  "FocusLayout",
]);

function makeCard(overrides?: Partial<MethodCard>): MethodCard {
  return {
    id: "custom-x",
    name: "自定义方法",
    when: "何时用",
    steps: ["步骤一", "步骤二"],
    chartPairing: ["AnalyticsChart"],
    executeGuidance: "Use AnalyticsChart with clear annotation and ranked ordering.",
    ...overrides,
  };
}

describe("validateCards（组件名参数化）", () => {
  it("配对组件全部合法 → 通过", () => {
    const { valid, skipped } = validateCards(
      [makeCard(), makeCard({ id: "b", chartPairing: ["FunnelChart", "InsightBox"] })],
      VALID_NAMES
    );
    expect(valid).toHaveLength(2);
    expect(skipped).toEqual([]);
  });

  it("引用未知组件 → 跳过并给出原因", () => {
    const { valid, skipped } = validateCards(
      [makeCard({ id: "bad", chartPairing: ["NotAComponent"] })],
      VALID_NAMES
    );
    expect(valid).toHaveLength(0);
    expect(skipped[0]).toMatchObject({ cardId: "bad" });
    expect(skipped[0].reason).toContain("NotAComponent");
  });

  it("形态不完整（缺 steps/guidance/id 非法）→ 跳过", () => {
    const broken = [
      makeCard({ id: "X", steps: [] }),
      makeCard({ id: "no-guide", executeGuidance: "" }),
      makeCard({ id: "1bad", chartPairing: ["AnalyticsChart"] }),
    ] as unknown as MethodCard[];
    const { valid, skipped } = validateCards(broken, VALID_NAMES);
    expect(valid).toHaveLength(0);
    expect(skipped).toHaveLength(3);
  });
});

describe("createMethodLibrary", () => {
  it("无 custom：10 张内置卡全量装载，find/ids 可用", () => {
    const { library, skipped } = createMethodLibrary({
      builtin: builtinMethodCards,
      validComponentNames: VALID_NAMES,
    });
    // 内置卡引用的组件不全在测试集合内 → 只要求不被「形态」原因跳过
    expect(skipped.every((s) => s.reason.includes("未知组件"))).toBe(true);
    expect(library.cards.length).toBeGreaterThan(0);
    expect(library.find("trend")?.name).toContain("趋势");
    expect(library.ids.has("trend")).toBe(true);
    expect(library.find("nope")).toBeUndefined();
  });

  it("custom 同 id 覆盖 builtin；新 id 追加", () => {
    const override = makeCard({
      id: "trend",
      name: "定制趋势法",
      chartPairing: ["AnalyticsChart", "MetricCard"],
    });
    const fresh = makeCard({ id: "extra", chartPairing: ["FunnelChart"] });
    const { library } = createMethodLibrary({
      builtin: builtinMethodCards,
      custom: [override, fresh],
      validComponentNames: VALID_NAMES,
    });
    expect(library.find("trend")?.name).toBe("定制趋势法");
    expect(library.ids.has("extra")).toBe(true);
  });

  it("内置卡配对组件全部存在于真实组件库键集合（契约快照）", () => {
    // 与 @openui-analytics/components serverLibrary 对齐的组件名全集
    const realNames = [
      "Root", "MetricGrid", "MetricCard", "GaugeProgress", "AnalyticsChart",
      "FunnelChart", "RadarChart", "ContributionHeatmap", "DataTable",
      "InsightBox", "ActionPlanCard", "ActivityTimeline", "AnalyticsFilterBar",
      "ActionButton", "ReactiveSimulator", "PlanReviewCard", "ReportLayout",
      "FocusLayout", "ComparisonLayout",
    ];
    const { valid, skipped } = validateCards(builtinMethodCards, realNames);
    expect(skipped).toEqual([]);
    expect(valid).toHaveLength(10);
  });

  it("filterCardShape：运行时初筛（无组件集合）", () => {
    const { ok, skipped } = filterCardShape([
      makeCard(),
      { id: "broken" },
      "not-a-card",
    ]);
    expect(ok).toHaveLength(1);
    expect(skipped).toHaveLength(2);
  });
});
