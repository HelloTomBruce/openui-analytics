import { datasources } from "@/lib/datasources";

/**
 * GET /api/datasources/:id/schema-card — 结构卡详情。
 * 返回卡全文 + generatedAt + stale（标脏=后台重建中）；源不存在 404，未建卡 404 语义区分。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const source = datasources.get(id);
    if (!source) {
      return Response.json({ error: `数据源不存在: ${id}` }, { status: 404 });
    }
    const got = await datasources.getSchemaCard(id);
    if (!got) {
      return Response.json(
        { error: `结构卡尚未生成: ${id}`, pending: true },
        { status: 404 }
      );
    }
    return Response.json({
      card: got.card,
      generatedAt: got.card.generatedAt,
      stale: got.stale,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
