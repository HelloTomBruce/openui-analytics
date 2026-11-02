import { describe, it, expect } from "vitest";
import { builtinMethodCards } from "./cards";
import { METHOD_ID_RE } from "./types";

describe("内置方法卡", () => {
  it("恰好 10 张且 id 唯一、全部符合 id 规范", () => {
    expect(builtinMethodCards).toHaveLength(10);
    const ids = builtinMethodCards.map((c) => c.id);
    expect(new Set(ids).size).toBe(10);
    for (const id of ids) expect(METHOD_ID_RE.test(id)).toBe(true);
  });

  it("每张卡字段完整：name/when/steps≥2/chartPairing≥1/guidance 非空", () => {
    for (const c of builtinMethodCards) {
      expect(c.name.trim().length).toBeGreaterThan(0);
      expect(c.when.trim().length).toBeGreaterThan(0);
      expect(c.steps.length).toBeGreaterThanOrEqual(2);
      expect(c.chartPairing.length).toBeGreaterThanOrEqual(1);
      expect(c.executeGuidance.trim().length).toBeGreaterThan(40);
    }
  });

  it("chartPairing 组件名均为 PascalCase（组件库键形态）", () => {
    for (const c of builtinMethodCards) {
      for (const name of c.chartPairing) {
        expect(name).toMatch(/^[A-Z][A-Za-z]+$/);
      }
    }
  });

  it("PRD 配对表落地：关键方法 → 关键组件", () => {
    const byId = new Map(builtinMethodCards.map((c) => [c.id, c]));
    expect(byId.get("trend")?.chartPairing).toContain("AnalyticsChart");
    expect(byId.get("funnel")?.chartPairing).toContain("FunnelChart");
    expect(byId.get("cohort")?.chartPairing).toContain("ContributionHeatmap");
    expect(byId.get("anomaly")?.chartPairing).toContain("InsightBox");
    expect(byId.get("attribution")?.chartPairing).toEqual(
      expect.arrayContaining(["FocusLayout", "ComparisonLayout"])
    );
    expect(byId.get("goal-gap")?.chartPairing).toContain("GaugeProgress");
  });
});
