import { listDataSources, checkDataSourceHealth } from "@/mcp/registry";

/**
 * GET /api/datasources
 * 返回所有数据源描述符与实时健康状态。
 * 单个源的健康检查失败不影响其他源，路由本身也不抛错。
 *
 * query 参数（可选）：gitlabUrl / gitlabToken —— 页面设置中的 GitLab 配置，
 * 透传给 gitlab-mcp 探针，保证状态灯与 /api/analyze 实际使用的配置一致。
 */
export async function GET(request: Request) {
  let searchParams = new URLSearchParams();
  try {
    searchParams = new URL(request.url).searchParams;
  } catch {
    // 请求 URL 异常时降级为空参数（探针将使用服务端默认配置）
  }
  const gitlabUrl = searchParams.get("gitlabUrl") || undefined;
  const gitlabToken = searchParams.get("gitlabToken") || undefined;

  const sources = listDataSources();

  const entries = await Promise.all(
    sources.map(
      async (s) =>
        [
          s.id,
          await checkDataSourceHealth(
            s.id,
            s.id === "gitlab-mcp" ? { gitlabUrl, gitlabToken } : undefined
          ),
        ] as const
    )
  );
  const health = Object.fromEntries(entries);

  return Response.json({ sources, health });
}
