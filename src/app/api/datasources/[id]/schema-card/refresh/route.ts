import { datasources } from "@/lib/datasources";

/**
 * POST /api/datasources/:id/schema-card/refresh — 手动重建结构卡。
 * 202 Accepted：重建在后台串行链中进行，不阻塞响应；源不存在 404。
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const source = datasources.get(id);
    if (!source) {
      return Response.json({ error: `数据源不存在: ${id}` }, { status: 404 });
    }
    // 后台重建：失败只进服务端日志（熔断状态由 manager 内部管理）
    datasources.refreshSchemaCard(id).catch((err: unknown) => {
      console.warn(
        `[schema-card] 手动刷新失败（${id}）:`,
        err instanceof Error ? err.message : err
      );
    });
    return Response.json({ accepted: true, id }, { status: 202 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
