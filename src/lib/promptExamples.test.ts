import { describe, it, expect } from "vitest";
import { createParser } from "@openuidev/lang-core";
import { serverLibrary } from "./serverLibrary";
import { promptExample } from "./prompt";

/**
 * Prompt ↔ Schema 一致性守护：
 * prompt 中的 few-shot 示例会被模型逐字模仿，必须能通过
 * serverLibrary 自身的解析与 zod 校验，否则是在教模型生成非法代码。
 */
describe("prompt 示例与组件库 schema 一致性", () => {
  const parser = createParser(serverLibrary.toJSONSchema(), "Root");

  it("示例代码解析出根组件且无校验错误", () => {
    const result = parser.parse(promptExample);
    expect(result.root).not.toBeNull();
    expect(result.meta.errors).toEqual([]);
  });

  it("示例中所有引用的语句均已定义（无 unresolved）", () => {
    const result = parser.parse(promptExample);
    expect(result.meta.unresolved).toEqual([]);
  });

  it("示例覆盖了全部主力可视化组件", () => {
    for (const name of [
      "GaugeProgress",
      "MetricCard",
      "MetricGrid",
      "FunnelChart",
      "ContributionHeatmap",
      "RadarChart",
      "ActionPlanCard",
      "DataTable",
      "InsightBox",
    ]) {
      expect(promptExample).toContain(`${name}(`);
    }
  });
});
