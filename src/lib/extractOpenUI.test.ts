import { describe, it, expect } from "vitest";
import { extractOpenUI } from "./extractOpenUI";

describe("extractOpenUI", () => {
  it("提取 ```openui 围栏内容并从正文移除", () => {
    const raw = "分析如下：\n```openui\nroot = Root([])\n```\n以上。";
    const { textPart, openuiPart } = extractOpenUI(raw);
    expect(openuiPart).toBe("root = Root([])");
    expect(textPart).toBe("分析如下：\n\n以上。");
    expect(textPart).not.toContain("root = Root");
  });

  it("```sql 围栏不进入渲染器，正文原样保留", () => {
    const raw = "查询语句：\n```sql\nSELECT * FROM t\n```";
    const { textPart, openuiPart } = extractOpenUI(raw);
    expect(openuiPart).toBe("");
    expect(textPart).toBe(raw);
  });

  it("```json 围栏不进入渲染器", () => {
    const raw = "数据：\n```json\n{\"a\":1}\n```";
    const { textPart, openuiPart } = extractOpenUI(raw);
    expect(openuiPart).toBe("");
    expect(textPart).toBe(raw);
  });

  it("未标注语言的裸围栏按 openui 兜底处理", () => {
    const raw = "```\nroot = Root([])\n```";
    const { openuiPart } = extractOpenUI(raw);
    expect(openuiPart).toBe("root = Root([])");
  });

  it("流式未闭合的 openui 围栏也能提取", () => {
    const raw = "```openui\nroot = Root([car";
    const { openuiPart } = extractOpenUI(raw);
    expect(openuiPart).toBe("root = Root([car");
  });

  it("无代码块时正文原样返回", () => {
    const raw = "纯文本回答，没有代码块。";
    const { textPart, openuiPart } = extractOpenUI(raw);
    expect(textPart).toBe(raw);
    expect(openuiPart).toBe("");
  });

  it("sql 在前、openui 在后时：openui 进渲染器，sql 留在正文", () => {
    const raw = "```sql\nSELECT 1\n```\n看板：\n```openui\nroot = Root([])\n```";
    const { textPart, openuiPart } = extractOpenUI(raw);
    expect(openuiPart).toBe("root = Root([])");
    expect(textPart).toContain("SELECT 1");
    expect(textPart).not.toContain("root = Root");
  });

  it("语言标签大小写不敏感（OpenUI/OPENUI）", () => {
    const { openuiPart } = extractOpenUI("```OpenUI\nroot = Root([])\n```");
    expect(openuiPart).toBe("root = Root([])");
  });

  it("空输入安全返回", () => {
    expect(extractOpenUI("")).toEqual({ textPart: "", openuiPart: "" });
  });
});
