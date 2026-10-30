"use client";

import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "@/lib/auth";
// 仅取类型（编译期擦除，不会把 server-only 的 dashboardStore 打进客户端包）
import type { DashboardRecord, DashboardSummary } from "@/lib/dashboardStore";

/**
 * 看板收藏库客户端状态：列表 / 收藏 / 重命名 / 删除。
 * - 所有请求经 authHeaders() 携带部署令牌（middleware 统一校验）
 * - 列表失败静默降级（收藏库不可用不阻塞聊天主流程）；写操作返回结果由调用方 toast
 */

export interface FavoriteDashboardInput {
  dsl: string;
  title?: string;
  prompt?: string;
  sourceNames?: string[];
  origin?: { sessionId?: string; messageId?: string };
}

export type FavoriteResult = { ok: true } | { ok: false; error: string };

/** 错误体归一：优先展开服务端 errors 数组，兜底状态码文案 */
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  const errors = (body as { errors?: unknown } | null)?.errors;
  if (Array.isArray(errors) && errors.every((e) => typeof e === "string")) {
    return errors.join("；");
  }
  return `${fallback}（${res.status}）`;
}

/** 拉取收藏列表；失败返回 null（调用方静默降级） */
async function fetchDashboardSummaries(): Promise<DashboardSummary[] | null> {
  try {
    const res = await fetch("/api/dashboards", {
      headers: { ...authHeaders() },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const list = (body as { dashboards?: unknown } | null)?.dashboards;
    return Array.isArray(list) ? (list as DashboardSummary[]) : null;
  } catch {
    return null;
  }
}

export function useDashboards() {
  const [summaries, setSummaries] = useState<DashboardSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  // 初始加载：setState 只发生在 promise 回调中，避免 effect 内同步 setState 级联渲染
  useEffect(() => {
    let cancelled = false;
    fetchDashboardSummaries().then((data) => {
      if (cancelled) return;
      if (data) setSummaries(data);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    const data = await fetchDashboardSummaries();
    if (data) setSummaries(data);
    setLoaded(true);
  }, []);

  /** 拉取单条完整记录（含 dsl，预览用）；未知/失败返回 null */
  const get = useCallback(async (id: string): Promise<DashboardRecord | null> => {
    try {
      const res = await fetch(`/api/dashboards/${encodeURIComponent(id)}`, {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return null;
      const body = await res.json().catch(() => null);
      const record = (body as { dashboard?: unknown } | null)?.dashboard;
      return record !== null &&
        typeof record === "object" &&
        typeof (record as DashboardRecord).dsl === "string"
        ? (record as DashboardRecord)
        : null;
    } catch {
      return null;
    }
  }, []);

  /** 收藏/覆盖收藏；成功后自动刷新列表 */
  const favorite = useCallback(
    async (input: FavoriteDashboardInput): Promise<FavoriteResult> => {
      try {
        const res = await fetch("/api/dashboards", {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify(input),
        });
        if (res.status === 201) {
          void refresh();
          return { ok: true };
        }
        return {
          ok: false,
          error: await readErrorMessage(res, "收藏失败"),
        };
      } catch {
        return { ok: false, error: "收藏失败：网络错误" };
      }
    },
    [refresh]
  );

  /** 重命名；成功返回 true 并刷新 */
  const rename = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/dashboards/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) return false;
        void refresh();
        return true;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  /** 删除；成功返回 true 并刷新 */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/dashboards/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { ...authHeaders() },
        });
        if (!res.ok) return false;
        void refresh();
        return true;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  return { summaries, loaded, refresh, get, favorite, rename, remove };
}
