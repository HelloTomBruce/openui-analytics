import { describe, it, expect } from "vitest";
import { builtinMethodCards } from "./cards";
import {
  renderMethodIndex,
  renderCardDetail,
  INDEX_BUDGET_BYTES,
  DETAIL_BUDGET_BYTES,
} from "./render";
import type { MethodCard } from "./types";

describe("renderMethodIndex", () => {
  it("10 张内置卡：含标题与每卡一行，总量 ≤1KB", () => {
    const out = renderMethodIndex(builtinMethodCards);
    expect(out).toContain("Analysis Method Index");
    expect(out).toContain("- trend: 趋势与同比环比");
    expect(out).toContain("- pareto:");
    expect(Buffer.byteLength(out, "utf-8")).toBeLessThanOrEqual(INDEX_BUDGET_BYTES);
  });

  it("超预算：保序截断并标注省略", () => {
    const many: MethodCard[] = Array.from({ length: 50 }, (_, i) => ({
      id: `m${i}`,
      name: `方法${i}`,
      when: `场景${i}`,
      steps: ["s"],
      chartPairing: ["AnalyticsChart"],
      executeGuidance: "g",
    }));
    const out = renderMethodIndex(many);
    expect(Buffer.byteLength(out, "utf-8")).toBeLessThanOrEqual(INDEX_BUDGET_BYTES);
    expect(out).toContain("其余方法省略");
    expect(out).toContain("- m0:"); // 保序保留头部
    expect(out).not.toContain("- m49:");
  });
});

describe("renderCardDetail", () => {
  it("内置卡：含名称/适用/配对/步骤/指导，总量 ≤600B", () => {
    for (const card of builtinMethodCards) {
      const out = renderCardDetail(card);
      expect(out).toContain(`### Method ${card.id} · ${card.name}`);
      expect(out).toContain(`Charts: ${card.chartPairing.join(" + ")}`);
      expect(Buffer.byteLength(out, "utf-8")).toBeLessThanOrEqual(DETAIL_BUDGET_BYTES);
    }
  });

  it("超长卡：逐步骤截尾并守预算", () => {
    const huge: MethodCard = {
      id: "huge",
      name: "超长方法",
      when: "w",
      steps: Array.from({ length: 20 }, (_, i) => `步骤${i}：${"细节".repeat(30)}`),
      chartPairing: ["AnalyticsChart"],
      executeGuidance: "G".repeat(400),
    };
    const out = renderCardDetail(huge);
    expect(Buffer.byteLength(out, "utf-8")).toBeLessThanOrEqual(DETAIL_BUDGET_BYTES);
    expect(out).toContain("### Method huge");
  });
});
