import {
  listDataSources,
  checkDataSourceHealth,
  validateDynamicSourceConfig,
  upsertDynamicSource,
  getDynamicSourceConfig,
  describeDynamicSource,
} from "@/mcp/registry";

/**
 * GET /api/datasources
 * 返回所有数据源描述符（内置+动态，含 enabled/builtin/脱敏字段）与实时健康状态。
 * 永不回传明文 token 与连接串密码。单个源的健康检查失败不影响其他源，路由本身也不抛错。
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

/**
 * POST /api/datasources
 * 新建动态源（http-mcp / db）。校验失败 400 + errors；id 重复 409。
 * 成功 201 并返回脱敏描述符（不回传明文凭证）。
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const verdict = validateDynamicSourceConfig(body);
    if (!verdict.ok) {
      return Response.json({ errors: verdict.errors }, { status: 400 });
    }
    if (getDynamicSourceConfig(verdict.config.id)) {
      return Response.json(
        { error: `id 已存在: ${verdict.config.id}` },
        { status: 409 }
      );
    }
    upsertDynamicSource(verdict.config);
    return Response.json(
      { source: describeDynamicSource(verdict.config) },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
