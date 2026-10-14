import { datasources } from "@/lib/datasources";
import { describeDynamicSource } from "@openui-analytics/datasources";

/**
 * GET /api/datasources
 * 返回所有数据源描述符（同构、含 enabled 与脱敏字段）与实时健康状态。
 * 永不回传明文 token 与连接串密码。
 */
export async function GET() {
  const sources = datasources.list();
  const entries = await Promise.all(
    sources.map(async (s) => {
      const conf = datasources.get(s.id);
      const health = conf
        ? await datasources.health(conf).catch(() => ({
            ok: false,
            latencyMs: 0,
            error: "probe crashed",
          }))
        : { ok: false, latencyMs: 0, error: "unknown datasource" };
      return [s.id, health] as const;
    })
  );
  return Response.json({ sources, health: Object.fromEntries(entries) });
}

/**
 * POST /api/datasources — 新建（http-mcp / db / stdio-cli）。
 * 校验失败 400 + errors；id 重复 409；成功 201 返回脱敏描述符。
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const verdict = datasources.validate(body);
    if (!verdict.ok) {
      return Response.json({ errors: verdict.errors }, { status: 400 });
    }
    if (datasources.get(verdict.config.id)) {
      return Response.json(
        { error: `id 已存在: ${verdict.config.id}` },
        { status: 409 }
      );
    }
    datasources.upsert(verdict.config);
    return Response.json(
      { source: describeDynamicSource(verdict.config) },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
