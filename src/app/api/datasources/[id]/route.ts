import {
  describeDynamicSource,
  type DynamicSourceConfig,
} from "@openui-analytics/datasources";
import { datasources } from "@/lib/datasources";

/**
 * PATCH /api/datasources/:id — 部分更新（所有源同构）。
 * name/enabled/命令类字段（url/command/args/dbType）显式传入才更新；
 * 凭证类字段（token/connectionString）留空 = 保留旧值，显式 "" = 清空。
 * 成功后关闭旧连接按新配置重建。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const existing = datasources.get(id);
    if (!existing) {
      return Response.json({ error: `数据源不存在: ${id}` }, { status: 404 });
    }

    const merged: DynamicSourceConfig = {
      ...existing,
      ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(existing.kind === "http-mcp" && typeof body.token === "string"
        ? { token: body.token }
        : {}),
      ...(existing.kind === "http-mcp" && typeof body.url === "string"
        ? { url: body.url }
        : {}),
      ...(existing.kind === "db" &&
      typeof body.connectionString === "string"
        ? { connectionString: body.connectionString }
        : {}),
      ...(existing.kind === "stdio-cli" && typeof body.command === "string"
        ? { command: body.command.trim() }
        : {}),
      ...(existing.kind === "stdio-cli" && Array.isArray(body.args)
        ? { args: body.args.map(String).filter((a) => a.length > 0) }
        : {}),
    };

    const verdict = datasources.validate(merged);
    if (!verdict.ok) {
      return Response.json({ errors: verdict.errors }, { status: 400 });
    }
    datasources.upsert(verdict.config);
    await datasources.close(id).catch(() => {});
    return Response.json({ source: describeDynamicSource(verdict.config) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/datasources/:id — 删除任意源并关闭其缓存连接；不存在 404。
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!datasources.get(id)) {
      return Response.json({ error: `数据源不存在: ${id}` }, { status: 404 });
    }
    datasources.delete(id);
    await datasources.close(id).catch(() => {});
    return new Response(null, { status: 204 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
