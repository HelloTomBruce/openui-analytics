// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "./route";

/** 薄壳冒烟：接线正确性（包 handler + 应用数据源单例）经真实路由导出验证 */
describe("POST /api/analyze 薄壳", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["OPENAI_API_KEY", "LLM_API_KEY"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("无 key 请求返回合规降级流（引导「设置」）", async () => {
    const res = await POST(
      new Request("http://localhost:3006/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [] }),
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-vercel-ai-data-stream")).toBe("v1");
    const text = await res.text();
    expect(text).toContain("未检测到 LLM API Key");
    expect(text).toContain("「设置」");
  });
});
