"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Table2 } from "lucide-react";
import { authHeaders } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { formatSessionTime } from "../SessionListItem";

type CardState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "ready"; generatedAt: number; stale: boolean };

/**
 * 源条目结构卡状态行：显示「结构卡 · 生成于 xx」+ 手动刷新。
 * 刷新走 202 后台语义：POST 后轮询 GET 直至卡时间戳更新（上限 ~6 次）。
 */
export function SchemaCardStatus({ sourceId }: { sourceId: string }) {
  const [state, setState] = useState<CardState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/datasources/${encodeURIComponent(sourceId)}/schema-card`,
        { headers: { ...authHeaders() }, cache: "no-store" }
      );
      if (res.status === 404) {
        setState({ status: "none" });
        return null;
      }
      if (!res.ok) return null;
      const body = (await res.json()) as {
        generatedAt?: number;
        stale?: boolean;
      };
      if (typeof body.generatedAt !== "number") return null;
      const next: CardState = {
        status: "ready",
        generatedAt: body.generatedAt,
        stale: Boolean(body.stale),
      };
      setState(next);
      return next;
    } catch {
      return null;
    }
  }, [sourceId]);

  // 初始加载：setState 只发生在 promise 回调中（避免 effect 内同步 setState）
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/datasources/${encodeURIComponent(sourceId)}/schema-card`, {
      headers: { ...authHeaders() },
      cache: "no-store",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setState({ status: "none" });
          return;
        }
        if (!res.ok) return;
        const body = (await res.json().catch(() => null)) as {
          generatedAt?: number;
          stale?: boolean;
        } | null;
        if (typeof body?.generatedAt === "number") {
          setState({
            status: "ready",
            generatedAt: body.generatedAt,
            stale: Boolean(body.stale),
          });
          return;
        }
        setState({ status: "none" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "none" });
      });
    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [sourceId]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    const prevGeneratedAt =
      state.status === "ready" ? state.generatedAt : null;
    try {
      const res = await fetch(
        `/api/datasources/${encodeURIComponent(sourceId)}/schema-card/refresh`,
        { method: "POST", headers: { ...authHeaders() } }
      );
      if (res.status === 202) {
        toast("结构卡重建已开始", "info");
        // 轮询直至时间戳更新（重建完成）或次数耗尽
        let attempts = 0;
        const poll = async () => {
          attempts++;
          const next = await load();
          const done =
            next !== null &&
            next.status === "ready" &&
            !next.stale &&
            next.generatedAt !== prevGeneratedAt;
          if (done) {
            toast("结构卡已更新", "success");
            setRefreshing(false);
            return;
          }
          if (attempts >= 6) {
            setRefreshing(false);
            return;
          }
          pollTimer.current = setTimeout(() => void poll(), 800);
        };
        pollTimer.current = setTimeout(() => void poll(), 800);
      } else {
        toast("重建请求失败", "error");
        setRefreshing(false);
      }
    } catch {
      toast("重建请求失败：网络错误", "error");
      setRefreshing(false);
    }
  }, [refreshing, state, sourceId, load]);

  const label =
    state.status === "loading"
      ? "结构卡加载中…"
      : state.status === "none"
        ? "结构卡：未生成（首次分析时自动生成）"
        : `结构卡 · 生成于 ${formatSessionTime(state.generatedAt)}${state.stale ? "（重建中）" : ""}`;

  return (
    <div className="flex items-center gap-2 text-[10px] text-slate-400">
      <Table2 className="w-3 h-3 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      <button
        onClick={() => void refresh()}
        disabled={refreshing}
        aria-label={`刷新结构卡 ${sourceId}`}
        title="重新扫描表结构并重建结构卡"
        className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50 disabled:opacity-50 transition-colors"
      >
        {refreshing ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <RefreshCw className="w-3 h-3" />
        )}
      </button>
    </div>
  );
}
