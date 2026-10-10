import { describe, it, expect } from "vitest";
import { detectAnomalies, type MetricSnapshot } from "./insights";

describe("detectAnomalies", () => {
  it("环比偏差超过 50% 产出 critical 洞察", () => {
    const metrics: MetricSnapshot[] = [
      { metric: "新增线索数", current: 160, baseline: 100 },
    ];
    const insights = detectAnomalies(metrics);
    expect(insights).toHaveLength(1);
    expect(insights[0].level).toBe("critical");
    expect(insights[0].metric).toBe("新增线索数");
    expect(insights[0].changePct).toBeCloseTo(60);
  });

  it("环比偏差在 30%~50% 之间产出 warning 洞察", () => {
    const insights = detectAnomalies([
      { metric: "营销成本", current: 140, baseline: 100 },
    ]);
    expect(insights).toHaveLength(1);
    expect(insights[0].level).toBe("warning");
  });

  it("负向偏差同样按绝对值判定", () => {
    const insights = detectAnomalies([
      { metric: "付费客户数", current: 60, baseline: 100 },
    ]);
    expect(insights).toHaveLength(1);
    expect(insights[0].level).toBe("warning");
    expect(insights[0].changePct).toBeCloseTo(-40);
  });

  it("偏差不超过 30% 不产出洞察", () => {
    const insights = detectAnomalies([
      { metric: "新增线索数", current: 110, baseline: 100 },
    ]);
    expect(insights).toEqual([]);
  });

  it("空数组输入返回空数组", () => {
    expect(detectAnomalies([])).toEqual([]);
  });

  it("baseline 为 0 时跳过该指标（无法计算环比）", () => {
    const insights = detectAnomalies([
      { metric: "新增线索数", current: 100, baseline: 0 },
    ]);
    expect(insights).toEqual([]);
  });
});
