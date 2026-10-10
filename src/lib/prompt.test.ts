import { describe, it, expect } from "vitest";
import { getOpenUISystemPrompt } from "./prompt";

describe("getOpenUISystemPrompt", () => {
  const prompt = getOpenUISystemPrompt();

  it("包含禅道与 GitLab 数据源指引", () => {
    expect(prompt).toContain("zentao_bug");
    expect(prompt.toLowerCase()).toContain("gitlab");
  });

  it("不再包含旧营销示例", () => {
    expect(prompt).not.toContain("TikTok Ads 实时预算与投产测试器");
  });

  it("包含研发效能新示例标识", () => {
    expect(prompt).toContain("迭代缺陷收敛漏斗");
  });
});
