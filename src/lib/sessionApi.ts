"use client";

import { authHeaders } from "@/lib/auth";
// 仅取类型（编译期擦除，不会把 server-only 的 sessionStore 打进客户端包）
import type {
  SessionContextMeta,
  SessionRecord,
  SessionSummary,
} from "@/lib/sessionStore";
import {
  getSavedSessions,
  getActiveSessionId,
  clearLegacySessions,
} from "@/lib/sessionStorage";

/**
 * 会话服务端 API 客户端层（fetch 薄封装）：
 * - 所有请求经 authHeaders() 携带部署令牌（middleware 统一校验）
 * - 失败归一为 null / false，由调用方决定降级策略（不抛异常打断聊天主流程）
 * - 服务端是唯一数据源，本层不做任何本地缓存
 */

export interface SessionListResult {
  sessions: SessionSummary[];
  activeId: string | null;
}

/** 拉取会话摘要列表 + 活跃指针；失败返回 null */
export async function fetchSessionList(): Promise<SessionListResult | null> {
  try {
    const res = await fetch("/api/sessions", {
      headers: { ...authHeaders() },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const sessions = (body as { sessions?: unknown } | null)?.sessions;
    if (!Array.isArray(sessions)) return null;
    const activeId = (body as { activeId?: unknown } | null)?.activeId;
    return {
      sessions: sessions as SessionSummary[],
      activeId: typeof activeId === "string" ? activeId : null,
    };
  } catch {
    return null;
  }
}

/** 拉取单会话完整记录（含 messages）；失败/不存在返回 null */
export async function fetchSession(id: string): Promise<SessionRecord | null> {
  try {
    const res = await fetch(`/api/sessions/${id}`, {
      headers: { ...authHeaders() },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const session = (body as { session?: unknown } | null)?.session;
    return session ? (session as SessionRecord) : null;
  } catch {
    return null;
  }
}

export interface CreateSessionInput {
  title?: string;
  messages?: SessionRecord["messages"];
  enabledSources?: string[];
  /** 先出思路开关；缺省 = 默认开 */
  planMode?: boolean;
  /** 迁移场景保留原时间戳 */
  createdAt?: number;
  updatedAt?: number;
}

/** 新建会话；失败返回 null */
export async function createSessionApi(
  input: CreateSessionInput
): Promise<SessionRecord | null> {
  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const session = (body as { session?: unknown } | null)?.session;
    return session ? (session as SessionRecord) : null;
  } catch {
    return null;
  }
}

export interface UpdateSessionInput {
  title?: string;
  messages?: SessionRecord["messages"];
  /** 数组 = 设置；null = 清除（恢复全选） */
  enabledSources?: string[] | null;
  /** 增量合并；null = 清除（如 rewind 后重置计量锚点） */
  context?: SessionContextMeta | null;
  /** boolean = 设置；null = 恢复默认（开） */
  planMode?: boolean | null;
}

/** 局部更新会话；失败返回 null（成功返回最新摘要） */
export async function updateSessionApi(
  id: string,
  input: UpdateSessionInput
): Promise<SessionSummary | null> {
  try {
    const res = await fetch(`/api/sessions/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const session = (body as { session?: unknown } | null)?.session;
    return session ? (session as SessionSummary) : null;
  } catch {
    return null;
  }
}

/** 删除会话；失败返回 false */
export async function deleteSessionApi(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/sessions/${id}`, {
      method: "DELETE",
      headers: { ...authHeaders() },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 设置服务端活跃会话指针（fire-and-forget 场景忽略返回值） */
export async function setActiveSessionApi(id: string | null): Promise<boolean> {
  try {
    const res = await fetch("/api/sessions", {
      method: "PUT",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ activeId: id }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 从某条消息分叉出新会话（复制 [0..该消息] 前缀历史）；失败返回 null */
export async function forkSessionApi(
  id: string,
  uptoMessageId: string
): Promise<SessionRecord | null> {
  try {
    const res = await fetch(`/api/sessions/${id}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ uptoMessageId }),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const session = (body as { session?: unknown } | null)?.session;
    return session ? (session as SessionRecord) : null;
  } catch {
    return null;
  }
}

/**
 * 旧 localStorage 会话一次性迁移（v1 → 服务端）：
 * - 逐条 POST 保留 title/messages/enabledSources 与原时间戳（服务端生成新 id）
 * - 幂等去重：服务端已存在同 title+createdAt+消息数 的会话时跳过
 *   （双标签页/重试场景不产生重复会话）
 * - 旧活跃指针映射到新 id 并写回服务端
 * - 全部成功才清除 localStorage 旧键（失败留下次启动重试，不产生半迁移状态）
 * - 无旧数据返回 null（调用方跳过迁移分支）
 */
async function migrateLegacySessions(): Promise<{
  migratedCount: number;
  activeId: string | null;
} | null> {
  const legacy = getSavedSessions();
  if (legacy.length === 0) return null;

  // 幂等指纹：已迁移过的会话（同标题 + 同创建时间 + 同消息数）跳过
  const existing = await fetchSessionList();
  const fingerprint = (title: string, createdAt: number, messageCount: number) =>
    `${title}|${createdAt}|${messageCount}`;
  const existingFingerprints = new Set(
    (existing?.sessions ?? []).map((s) =>
      fingerprint(s.title, s.createdAt, s.messageCount)
    )
  );

  const legacyActiveId = getActiveSessionId();
  let newActiveId: string | null = null;
  let migratedCount = 0;

  for (const old of legacy) {
    if (
      existingFingerprints.has(
        fingerprint(old.title, old.createdAt, old.messages.length)
      )
    ) {
      continue; // 已迁移过（如另一标签页已完成），跳过
    }
    const created = await createSessionApi({
      title: old.title,
      messages: old.messages as unknown as SessionRecord["messages"],
      ...(old.enabledSources ? { enabledSources: old.enabledSources } : {}),
      createdAt: old.createdAt,
      updatedAt: old.updatedAt,
    });
    if (!created) {
      // 中断：保留 localStorage 旧键，下次启动重试
      console.error(
        `[SessionMigration] 迁移中断于会话 "${old.title}"（已迁移 ${migratedCount}/${legacy.length}）`
      );
      return null;
    }
    migratedCount++;
    if (old.id === legacyActiveId) newActiveId = created.id;
  }

  // 活跃指针映射：旧活跃会话被去重跳过时，退化为服务端现有指针
  if (newActiveId) await setActiveSessionApi(newActiveId);
  clearLegacySessions();
  if (migratedCount > 0) {
    console.info(`[SessionMigration] 已迁移 ${migratedCount} 个会话到服务端`);
  }
  return { migratedCount, activeId: newActiveId };
}

/** 空库时的初始会话创建入参 */
export interface EnsureInitialInput {
  title: string;
  messages: SessionRecord["messages"];
}

let ensureInFlight: Promise<{
  list: SessionListResult;
  created: SessionRecord | null;
} | null> | null = null;

/**
 * bootstrap 幂等保证（迁移 + 空库创建初始会话）：
 * 并发调用共享同一在途 Promise——React StrictMode 双调用 effect、
 * 快速重挂载等场景下副作用（迁移 POST / 初始会话 POST）只执行一次；
 * 在途期结束后新的调用重新拉取，保证数据新鲜。
 */
export function ensureSessionsReady(
  initial: EnsureInitialInput
): Promise<{ list: SessionListResult; created: SessionRecord | null } | null> {
  if (!ensureInFlight) {
    ensureInFlight = (async () => {
      await migrateLegacySessions();
      let list = await fetchSessionList();
      if (!list) return null;

      let created: SessionRecord | null = null;
      if (list.sessions.length === 0) {
        created = await createSessionApi({
          title: initial.title,
          messages: initial.messages,
        });
        if (!created) return null;
        list = {
          sessions: [
            {
              id: created.id,
              title: created.title,
              createdAt: created.createdAt,
              updatedAt: created.updatedAt,
              messageCount: created.messages.length,
            },
          ],
          activeId: created.id,
        };
        void setActiveSessionApi(created.id);
      }
      return { list, created };
    })().finally(() => {
      ensureInFlight = null;
    });
  }
  return ensureInFlight;
}
