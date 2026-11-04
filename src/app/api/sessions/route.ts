import { sessionStore } from "@/lib/sessionStore";

/**
 * GET /api/sessions — 会话列表（摘要，不含 messages 全文；updatedAt 降序）
 * 附活跃会话指针 activeId（可能指向已删除会话，客户端负责回落到列表首条）。
 * 鉴权由 middleware 统一拦截 /api/*，本层不再重复校验。
 */
export async function GET() {
  try {
    const [sessions, activeId] = await Promise.all([
      sessionStore.list(),
      sessionStore.getActiveId(),
    ]);
    return Response.json({ sessions, activeId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/sessions — 新建会话。
 * body 全可选：title / messages / enabledSources / createdAt / updatedAt
 * （后两个仅迁移场景用于保留原时间戳）。成功 201 返回完整记录（含 id 与 messages）。
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const verdict = await sessionStore.create(body ?? {});
    if (!verdict.ok) {
      return Response.json({ errors: verdict.errors }, { status: verdict.status });
    }
    return Response.json({ session: verdict.record }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT /api/sessions — 设置活跃会话指针：{ activeId: string | null }。
 * 指向不存在的会话 404；null 清除指针。
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const activeId =
      body && typeof body === "object" && "activeId" in body
        ? (body as { activeId: unknown }).activeId
        : undefined;
    if (activeId !== null && typeof activeId !== "string") {
      return Response.json(
        { errors: ["activeId 必须是字符串或 null"] },
        { status: 400 }
      );
    }
    const ok = await sessionStore.setActiveId(activeId);
    if (!ok) {
      return Response.json(
        { errors: [`会话不存在: ${activeId}`] },
        { status: 404 }
      );
    }
    return Response.json({ activeId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
