import { dashboardStore, toSummary } from "@/lib/dashboardStore";
import { refreshDashboard } from "@/lib/dashboardRefresh";
import { datasources } from "@/lib/datasources";

/**
 * POST /api/dashboards/:id/refresh — 活看板数据刷新（P2-A，全程零 LLM 调用）。
 *
 * 按 record.queries 重放取数（sql 走只读守卫 + dbMcpServer；tool 走 MCP callTool）
 * → 回填 dsl 组件数据 → 落盘新 dsl。降级语义：
 * - 404 看板不存在
 * - 400 静态快照（无 queries，v0.1 旧记录）不支持刷新
 * - 502 数据源不存在/停用/连接失败，或全部查询重放失败（附「重新分析」引导；
 *   后者不落盘——原 dsl/dataUpdatedAt 原样保留）
 * - 500 DSL 解析/序列化失败（不落盘）
 * - 200 `{ dashboard: 摘要, stale: string[] }`：stale 为保留旧数据的组件
 *   statementId 列表；仅当全部组件刷新成功（stale 为空）才更新 dataUpdatedAt
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const record = await dashboardStore.get(id);
    if (!record) {
      return Response.json({ error: `看板不存在: ${id}` }, { status: 404 });
    }

    const verdict = await refreshDashboard(record, datasources);
    if (!verdict.ok) {
      if (verdict.reason === "readonly") {
        return Response.json({ error: verdict.error }, { status: 400 });
      }
      if (verdict.reason === "source-unavailable" || verdict.reason === "replay-failed") {
        return Response.json({ error: verdict.error }, { status: 502 });
      }
      return Response.json({ error: verdict.error }, { status: 500 });
    }

    const updated = await dashboardStore.update(id, {
      dsl: verdict.dsl,
      // 部分组件 stale 时保留旧 dataUpdatedAt（过期徽标按 stale 精确到组件）
      ...(verdict.stale.length === 0 ? { dataUpdatedAt: Date.now() } : {}),
    });
    if (!updated.ok) {
      return Response.json({ errors: updated.errors }, { status: updated.status });
    }
    return Response.json({
      dashboard: toSummary(updated.record),
      stale: verdict.stale,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
