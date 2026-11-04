import { sessionStore, toSummary } from "@/lib/sessionStore";

/**
 * GET /api/sessions/:id — 详情（含 messages 全文，会话切换/恢复用）；不存在 404。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const record = await sessionStore.get(id);
    if (!record) {
      return Response.json({ error: `会话不存在: ${id}` }, { status: 404 });
    }
    return Response.json({ session: record });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT /api/sessions/:id — 局部更新：title / messages / enabledSources / context
 * 至少一项，否则 400；messages 为整体替换语义（调用方持有完整列表）；
 * enabledSources/context 传 null = 清除。成功返回摘要（不含 messages）。
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const verdict = await sessionStore.update(id, body);
    if (!verdict.ok) {
      return Response.json(
        { errors: verdict.errors },
        { status: verdict.status }
      );
    }
    return Response.json({ session: toSummary(verdict.record) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/sessions/:id — 删除会话；不存在 404，成功 204。
 * 删除的是活跃会话时服务端一并清除活跃指针。
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const removed = await sessionStore.remove(id);
    if (!removed) {
      return Response.json({ error: `会话不存在: ${id}` }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
