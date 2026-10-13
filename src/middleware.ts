import { NextRequest, NextResponse } from "next/server";

/**
 * API 鉴权中间件（部署模式）。
 *
 * 配置环境变量 OPENUI_API_AUTH_TOKEN 后，所有 /api/* 请求必须携带
 * `Authorization: Bearer <token>`；未配置时放行（本地开发零负担）。
 * 前端在「设置 → 模型配置 → 访问令牌」中配置，随所有 API 请求头自动携带。
 */
export function middleware(request: NextRequest) {
  const token = process.env.OPENUI_API_AUTH_TOKEN;
  if (!token) return NextResponse.next();

  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${token}`) return NextResponse.next();

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export const config = {
  matcher: ["/api/:path*"],
};
