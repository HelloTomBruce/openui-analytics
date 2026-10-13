import { listDataSources, checkDataSourceHealth } from "@/mcp/registry";

/**
 * GET /api/datasources
 * 返回所有数据源描述符与实时健康状态。
 * 单个源的健康检查失败不影响其他源，路由本身也不抛错。
 *
 * GitLab 探活配置通过请求头传递（x-gitlab-url / x-gitlab-token），
 * 避免 token 出现在 URL 中被访问日志/浏览器历史记录。
 */
export async function GET(request: Request) {
  const gitlabUrl = request.headers.get("x-gitlab-url") || undefined;
  const gitlabToken = request.headers.get("x-gitlab-token") || undefined;

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
