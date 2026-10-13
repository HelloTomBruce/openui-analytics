// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function makeRequest(auth?: string): NextRequest {
  return new NextRequest("http://localhost:3006/api/analyze", {
    headers: auth ? { authorization: auth } : {},
  });
}

describe("middleware API 鉴权", () => {
  const saved = process.env.OPENAI_API_AUTH_TOKEN;

  afterEach(() => {
    if (saved === undefined) delete process.env.OPENUI_API_AUTH_TOKEN;
    else process.env.OPENUI_API_AUTH_TOKEN = saved;
  });

  it("未配置 OPENUI_API_AUTH_TOKEN 时放行（本地开发模式）", async () => {
    delete process.env.OPENUI_API_AUTH_TOKEN;
    const res = middleware(makeRequest());
    // NextResponse.next() 不设置 401
    expect(res.status).not.toBe(401);
  });

  it("配置 token 后无 Authorization 返回 401", async () => {
    process.env.OPENUI_API_AUTH_TOKEN = "secret-token";
    const res = middleware(makeRequest());
    expect(res.status).toBe(401);
  });

  it("配置 token 后错误凭证返回 401", async () => {
    process.env.OPENUI_API_AUTH_TOKEN = "secret-token";
    const res = middleware(makeRequest("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("配置 token 后正确凭证放行", async () => {
    process.env.OPENUI_API_AUTH_TOKEN = "secret-token";
    const res = middleware(makeRequest("Bearer secret-token"));
    expect(res.status).not.toBe(401);
  });
});
