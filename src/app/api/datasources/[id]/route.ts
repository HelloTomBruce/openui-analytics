import {
  BUILTIN_SOURCE_IDS,
  type BuiltinSourceId,
  type DynamicSourceConfig,
  validateDynamicSourceConfig,
  upsertDynamicSource,
  setBuiltinEnabled,
  deleteDynamicSource,
  getDynamicSourceConfig,
  describeDynamicSource,
} from "@/mcp/registry";
import { closeDynamicSource } from "@/mcp/dynamicSources";

/**
 * PATCH /api/datasources/:id
 * 部分更新：动态源可改 name/enabled/url/token/connectionString；
 * token 不传 = 保留旧值，显式传 "" = 清空。内置源仅接受 enabled。
 * 更新成功后关闭旧连接（下次使用时按新配置重建）。
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

    if ((BUILTIN_SOURCE_IDS as readonly string[]).includes(id)) {
      const extra = Object.keys(body).filter((k) => k !== "enabled");
      if (extra.length > 0) {
        return Response.json(
          { error: `内置数据源仅接受 enabled 字段，不接受: ${extra.join(", ")}` },
          { status: 400 }
        );
      }
      if (typeof body.enabled !== "boolean") {
        return Response.json(
          { error: "enabled 必须是 boolean" },
          { status: 400 }
        );
      }
      setBuiltinEnabled(id as BuiltinSourceId, body.enabled);
      return Response.json({ ok: true });
    }

    const existing = getDynamicSourceConfig(id);
    if (!existing) {
      return Response.json({ error: `数据源不存在: ${id}` }, { status: 404 });
    }

    const merged: DynamicSourceConfig = {
      ...existing,
      ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(existing.kind === "http-mcp" &&
      typeof body.token === "string"
        ? { token: body.token }
        : {}),
      ...(existing.kind === "http-mcp" && typeof body.url === "string"
        ? { url: body.url }
        : {}),
      ...(existing.kind === "db" &&
      typeof body.connectionString === "string"
        ? { connectionString: body.connectionString }
        : {}),
    };

    const verdict = validateDynamicSourceConfig(merged);
    if (!verdict.ok) {
      return Response.json({ errors: verdict.errors }, { status: 400 });
    }
    upsertDynamicSource(verdict.config);
    await closeDynamicSource(id).catch(() => {});
    return Response.json({ source: describeDynamicSource(verdict.config) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/datasources/:id
 * 删除动态源并关闭其缓存连接；内置源 405（请用启停），不存在 404。
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if ((BUILTIN_SOURCE_IDS as readonly string[]).includes(id)) {
      return Response.json(
        { error: "内置数据源不可删除，可使用启停开关" },
        { status: 405 }
      );
    }
    const deleted = deleteDynamicSource(id);
    if (!deleted) {
      return Response.json({ error: `数据源不存在: ${id}` }, { status: 404 });
    }
    await closeDynamicSource(id).catch(() => {});
    return new Response(null, { status: 204 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
