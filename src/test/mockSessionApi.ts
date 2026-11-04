import { vi } from "vitest";
import type { SessionRecord, SessionSummary } from "@/lib/sessionStore";

/**
 * 测试用内存版 /api/sessions 服务端：以 fetch mock 形式实现真实路由语义
 * （列表摘要 / 详情 / 新建 / 局部更新 / 删除 / 活跃指针），
 * 供 useSessionManager 与 ChatDashboard 等组件测试共享。
 *
 * 用法：
 *   const server = installSessionServer();
 *   server.seed([{ id: "sess_00000001", ... }]);
 *   // 测试后 vi.unstubAllGlobals()
 */
export interface SessionServer {
  records: Map<string, SessionRecord>;
  activeId: string | null;
  seed(records: SessionRecord[], activeId?: string | null): void;
}

let idCounter = 0;

function toSummary(record: SessionRecord): SessionSummary {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.enabledSources !== undefined
      ? { enabledSources: record.enabledSources }
      : {}),
    ...(record.planMode !== undefined ? { planMode: record.planMode } : {}),
    messageCount: record.messages.length,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 生成确定性递增 id（测试可读性） */
export function nextSessionId(): string {
  idCounter++;
  return `sess_${String(idCounter).padStart(8, "0").slice(-8)}`;
}

export function makeSessionRecord(
  overrides: Partial<Omit<SessionRecord, "messages">> & {
    /** 测试夹具直接给 AI SDK Message 亦可（SDK 边界经 unknown 桥接） */
    messages?: unknown[];
  } = {}
): SessionRecord {
  const now = Date.now();
  return {
    id: nextSessionId(),
    title: "测试会话",
    createdAt: now,
    updatedAt: now,
    ...overrides,
    messages: (overrides.messages ?? []) as SessionRecord["messages"],
  };
}

/** 安装 fetch mock；返回内存服务端句柄。
 *  非 /api/sessions 路径交 fallback（如数据源列表 mock），缺省返回 404。 */
export function installSessionServer(
  fallback?: (url: string, init?: RequestInit) => Response | Promise<Response>
): SessionServer {
  const records = new Map<string, SessionRecord>();
  const server: SessionServer = {
    records,
    activeId: null,
    seed(list, activeId = null) {
      records.clear();
      for (const r of list) records.set(r.id, r);
      server.activeId = activeId;
    },
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      const match = url.match(/^\/api\/sessions(?:\/([^/?]+?))?(?:\/(fork))?$/);
      if (!match) {
        return fallback
          ? fallback(url, init)
          : jsonResponse({ error: "not mocked" }, 404);
      }

      const id = match[1];
      const action = match[2];
      const body = init?.body
        ? JSON.parse(typeof init.body === "string" ? init.body : "{}")
        : null;

      // 分叉：POST /api/sessions/:id/fork
      if (id && action === "fork" && method === "POST") {
        const source = records.get(id);
        if (!source) return jsonResponse({ error: "会话不存在" }, 404);
        const uptoMessageId = body?.uptoMessageId;
        const idx = source.messages.findIndex(
          (m) => (m as { id?: string }).id === uptoMessageId
        );
        if (idx === -1) {
          return jsonResponse({ errors: ["消息不存在于会话中"] }, 400);
        }
        const now = Date.now();
        const forked: SessionRecord = {
          id: nextSessionId(),
          title: `${source.title}（分叉）`,
          createdAt: now,
          updatedAt: now,
          messages: source.messages.slice(0, idx + 1),
          ...(source.enabledSources
            ? { enabledSources: source.enabledSources }
            : {}),
        };
        records.set(forked.id, forked);
        return jsonResponse({ session: forked }, 201);
      }

      // 集合路由
      if (!id) {
        if (method === "GET") {
          const sessions = [...records.values()]
            .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
            .map(toSummary);
          return jsonResponse({ sessions, activeId: server.activeId });
        }
        if (method === "POST") {
          const now = Date.now();
          const record: SessionRecord = {
            id: nextSessionId(),
            title: body?.title ?? "新建分析会话",
            createdAt: body?.createdAt ?? now,
            updatedAt: body?.updatedAt ?? now,
            messages: body?.messages ?? [],
            ...(body?.enabledSources
              ? { enabledSources: body.enabledSources }
              : {}),
            ...(typeof body?.planMode === "boolean"
              ? { planMode: body.planMode }
              : {}),
          };
          records.set(record.id, record);
          return jsonResponse({ session: record }, 201);
        }
        if (method === "PUT") {
          const activeId = body?.activeId ?? null;
          if (activeId !== null && !records.has(activeId)) {
            return jsonResponse({ errors: ["会话不存在"] }, 404);
          }
          server.activeId = activeId;
          return jsonResponse({ activeId });
        }
      }

      // 单会话路由
      const existing = id ? records.get(id) : undefined;
      if (id && method === "GET") {
        return existing
          ? jsonResponse({ session: existing })
          : jsonResponse({ error: "会话不存在" }, 404);
      }
      if (id && method === "PUT") {
        if (!existing) return jsonResponse({ errors: ["会话不存在"] }, 404);
        const next: SessionRecord = {
          ...existing,
          ...(body?.title !== undefined ? { title: body.title } : {}),
          ...(body?.messages !== undefined ? { messages: body.messages } : {}),
          updatedAt: Date.now(),
        };
        if (body && "enabledSources" in body) {
          if (body.enabledSources === null) delete next.enabledSources;
          else next.enabledSources = body.enabledSources;
        }
        if (body && "planMode" in body) {
          if (body.planMode === null) delete next.planMode;
          else next.planMode = body.planMode;
        }
        records.set(id, next);
        return jsonResponse({ session: toSummary(next) });
      }
      if (id && method === "DELETE") {
        if (!existing) return jsonResponse({ error: "会话不存在" }, 404);
        records.delete(id);
        if (server.activeId === id) server.activeId = null;
        return new Response(null, { status: 204 });
      }

      return jsonResponse({ error: "method not mocked" }, 405);
    })
  );

  return server;
}
