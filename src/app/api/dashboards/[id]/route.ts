import { dashboardStore, toSummary } from "@/lib/dashboardStore";

/**
 * GET /api/dashboards/:id — 详情（含 dsl，预览用）；不存在 404。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const record = await dashboardStore.get(id);
    if (!record) {
      return Response.json({ error: `看板不存在: ${id}` }, { status: 404 });
    }
    return Response.json({ dashboard: record });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT /api/dashboards/:id — 重命名 / 覆盖 dsl（及可选 prompt/sourceNames/origin）。
 * 至少一项可更新字段，否则 400；dsl 超限 413；不存在 404。成功返回摘要。
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const verdict = await dashboardStore.update(id, body);
    if (!verdict.ok) {
      return Response.json(
        { errors: verdict.errors },
        { status: verdict.status }
      );
    }
    return Response.json({ dashboard: toSummary(verdict.record) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/dashboards/:id — 删除收藏；不存在 404，成功 204。
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const removed = await dashboardStore.remove(id);
    if (!removed) {
      return Response.json({ error: `看板不存在: ${id}` }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
