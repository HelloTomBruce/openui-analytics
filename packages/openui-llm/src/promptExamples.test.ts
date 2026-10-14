import { describe, it, expect } from "vitest";
import { createParser } from "@openuidev/lang-core";
import { serverLibrary } from "./serverLibrary";
import { promptExample, reportLayoutExample, focusLayoutExample, comparisonLayoutExample } from "./prompt";

/**
 * Prompt ↔ Schema 一致性守护：
 * prompt 中的 few-shot 示例会被模型逐字模仿，必须能通过
 * serverLibrary 自身的解析与 zod 校验，否则是在教模型生成非法代码。
 */
describe("prompt 示例与组件库 schema 一致性", () => {
  const parser = createParser(serverLibrary.toJSONSchema(), "Root");
  const examples: Array<[string, string]> = [
    ["promptExample", promptExample],
    ["reportLayoutExample", reportLayoutExample],
    ["focusLayoutExample", focusLayoutExample],
    ["comparisonLayoutExample", comparisonLayoutExample],
  ];

  for (const [name, code] of examples) {
    it(`${name}：解析出根组件且无校验错误`, () => {
      const result = parser.parse(code);
      expect(result.root).not.toBeNull();
      expect(result.meta.errors).toEqual([]);
    });

    it(`${name}：所有引用的语句均已定义（无 unresolved）`, () => {
      const result = parser.parse(code);
      expect(result.meta.unresolved).toEqual([]);
    });
  }

  it("示例覆盖了全部主力可视化组件与布局模板", () => {
    const all = promptExample + reportLayoutExample + focusLayoutExample + comparisonLayoutExample;
    for (const name of [
      "ReportLayout",
      "FocusLayout",
      "ComparisonLayout",
      "GaugeProgress",
      "MetricCard",
      "MetricGrid",
      "FunnelChart",
      "ContributionHeatmap",
      "RadarChart",
      "ActionPlanCard",
      "DataTable",
      "InsightBox",
      "AnalyticsChart",
    ]) {
      expect(all).toContain(`${name}(`);
    }
  });

  it("报表模板示例：Root 的直接子组件就是 ReportLayout", () => {
    const result = parser.parse(reportLayoutExample);
    expect(result.root?.typeName).toBe("Root");
    // Root 的 children 数组内就是 ReportLayout，各区块已就位
    const children = result.root?.props?.children;
    const first = Array.isArray(children) ? children[0] : children;
    expect((first as { typeName?: string })?.typeName).toBe("ReportLayout");
    const zoneProps = (first as { props?: Record<string, unknown> })?.props ?? {};
    for (const zone of ["kpis", "charts", "detail", "insights"]) {
      expect(Array.isArray(zoneProps[zone])).toBe(true);
    }
  });

  it("深钻模板示例：FocusLayout 主区/侧栏/明细区块均为数组", () => {
    const result = parser.parse(focusLayoutExample);
    const children = result.root?.props?.children;
    const first = Array.isArray(children) ? children[0] : children;
    expect((first as { typeName?: string })?.typeName).toBe("FocusLayout");
    const zoneProps = (first as { props?: Record<string, unknown> })?.props ?? {};
    expect(zoneProps.title).toBe("为什么 Q3 CAC 上升");
    for (const zone of ["main", "side", "detail"]) {
      expect(Array.isArray(zoneProps[zone])).toBe(true);
    }
  });

  it("对比模板示例：ComparisonLayout 左右栏标签与内容均为数组", () => {
    const result = parser.parse(comparisonLayoutExample);
    const children = result.root?.props?.children;
    const first = Array.isArray(children) ? children[0] : children;
    expect((first as { typeName?: string })?.typeName).toBe("ComparisonLayout");
    const zoneProps = (first as { props?: Record<string, unknown> })?.props ?? {};
    expect(zoneProps.leftLabel).toBe("TikTok Ads");
    expect(zoneProps.rightLabel).toBe("Google Ads");
    for (const zone of ["left", "right", "verdict"]) {
      expect(Array.isArray(zoneProps[zone])).toBe(true);
    }
  });
});
