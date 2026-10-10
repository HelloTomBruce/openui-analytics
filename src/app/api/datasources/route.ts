import { listDataSources, checkDataSourceHealth } from "@/mcp/registry";

/**
 * GET /api/datasources
 * 返回所有数据源描述符与实时健康状态。
 * 单个源的健康检查失败不影响其他源，路由本身也不抛错。
 */
export async function GET() {
  const sources = listDataSources();

  const entries = await Promise.all(
    sources.map(async (s) => [s.id, await checkDataSourceHealth(s.id)] as const)
  );
  const health = Object.fromEntries(entries);

  return Response.json({ sources, health });
}
