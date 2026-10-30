import { dashboardStore, toSummary } from "@/lib/dashboardStore";

/**
 * GET /api/dashboards — 收藏列表（摘要，不含 dsl 全文；updatedAt 降序）。
 * 鉴权由 middleware 统一拦截 /api/*，本层不再重复校验。
 */
export async function GET() {
  try {
    const dashboards = await dashboardStore.list();
    return Response.json({ dashboards });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/dashboards — 收藏/覆盖收藏。
 * dsl 必填（缺失/空 400，超 2MB 413）；同 origin.messageId 命中已有记录则
 * 覆盖更新（保 id/createdAt/已重命名标题）。成功 201 返回摘要。
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const verdict = await dashboardStore.upsert(body);
    if (!verdict.ok) {
      return Response.json({ errors: verdict.errors }, { status: verdict.status });
    }
    return Response.json({ dashboard: toSummary(verdict.record) }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
