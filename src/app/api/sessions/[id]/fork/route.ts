import { sessionStore } from "@/lib/sessionStore";

/**
 * POST /api/sessions/:id/fork — 从某条消息分叉出新会话。
 * body: { uptoMessageId: string }（分叉点含该消息，即复制 [0..该消息] 前缀历史）。
 * 新会话继承 enabledSources，标题加「（分叉）」后缀，上下文元数据不继承
 * （新会话独立计量）。消息 id 不存在 400；会话不存在 404；成功 201 返回完整记录。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const source = await sessionStore.get(id);
    if (!source) {
      return Response.json({ error: `会话不存在: ${id}` }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const uptoMessageId =
      body && typeof body === "object"
        ? (body as { uptoMessageId?: unknown }).uptoMessageId
        : undefined;
    if (typeof uptoMessageId !== "string" || uptoMessageId.length === 0) {
      return Response.json(
        { errors: ["uptoMessageId 必须是非空字符串"] },
        { status: 400 }
      );
    }

    const uptoIndex = source.messages.findIndex((m) => m.id === uptoMessageId);
    if (uptoIndex === -1) {
      return Response.json(
        { errors: [`消息不存在于会话中: ${uptoMessageId}`] },
        { status: 400 }
      );
    }

    const verdict = await sessionStore.create({
      title: `${source.title}（分叉）`,
      messages: source.messages.slice(0, uptoIndex + 1),
      ...(source.enabledSources
        ? { enabledSources: source.enabledSources }
        : {}),
    });
    if (!verdict.ok) {
      return Response.json(
        { errors: verdict.errors },
        { status: verdict.status }
      );
    }
    return Response.json({ session: verdict.record }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
