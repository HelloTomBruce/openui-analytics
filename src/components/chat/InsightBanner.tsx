"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, AlertOctagon, RefreshCw, X, ChevronRight } from "lucide-react";
import type { Insight } from "@/lib/insights";

interface InsightBannerProps {
  onAnalyze: (prompt: string) => void;
}

interface InsightsResponse {
  insights: Insight[];
  error?: string;
  generatedAt?: string;
}

/**
 * 主动洞察横幅：进入会话时拉取 /api/insights，
 * 存在 warning/critical 洞察时展示可折叠横幅，支持刷新与"展开分析"。
 */
export function InsightBanner({ onAnalyze }: InsightBannerProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // 纯加载器：不含任何 setState，可安全地在 effect 中调用；
  // setState 全部发生在异步回调 / 事件处理器中。
  const loadInsights = useCallback(async (): Promise<InsightsResponse> => {
    try {
      const res = await fetch("/api/insights");
      return (await res.json()) as InsightsResponse;
    } catch (err) {
      return {
        insights: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadInsights().then((data) => {
      if (cancelled) return;
      setInsights(data.insights || []);
      setFetchError(data.error || null);
    });
    return () => {
      cancelled = true;
    };
  }, [loadInsights]);

  const handleRefresh = async () => {
    setLoading(true);
    const data = await loadInsights();
    setInsights(data.insights || []);
    setFetchError(data.error || null);
    setLoading(false);
  };

  // 无洞察且无错误时不渲染（静默）
  if (insights.length === 0 && !fetchError) return null;

  const criticalCount = insights.filter((i) => i.level === "critical").length;
  const isCritical = criticalCount > 0;

  return (
    <div
      className={`mx-6 mt-4 rounded-xl border text-xs ${
        isCritical
          ? "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200"
          : "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200"
      }`}
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        {isCritical ? (
          <AlertOctagon className="w-4 h-4 shrink-0" />
        ) : (
          <AlertTriangle className="w-4 h-4 shrink-0" />
        )}
        <span className="font-semibold flex-1 truncate">
          {fetchError
            ? `主动洞察暂不可用：${fetchError}`
            : `检测到 ${insights.length} 项指标异常${criticalCount > 0 ? `（${criticalCount} 项严重）` : ""}`}
        </span>
        {insights.length > 0 && (
          <>
            <button
              onClick={() =>
                onAnalyze(
                  `请深入分析以下指标异常并给出干预建议：${insights
                    .map((i) => i.message)
                    .join("；")}`
                )
              }
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/70 dark:bg-slate-900/60 border border-current/20 font-medium hover:bg-white dark:hover:bg-slate-900 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
              <span>展开分析</span>
            </button>
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="px-2 py-1 rounded-lg hover:bg-white/60 dark:hover:bg-slate-900/60 transition-colors"
            >
              {collapsed ? "展开" : "收起"}
            </button>
          </>
        )}
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="p-1 rounded hover:bg-white/60 dark:hover:bg-slate-900/60 transition-colors disabled:opacity-50"
          title="刷新洞察"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button
          onClick={() => {
            setInsights([]);
            setFetchError(null);
          }}
          className="p-1 rounded hover:bg-white/60 dark:hover:bg-slate-900/60 transition-colors"
          title="关闭"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {!collapsed && insights.length > 0 && (
        <div className="px-4 pb-3 space-y-1">
          {insights.map((insight, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                  insight.level === "critical"
                    ? "bg-rose-200/70 dark:bg-rose-900/60"
                    : "bg-amber-200/70 dark:bg-amber-900/60"
                }`}
              >
                {insight.level === "critical" ? "严重" : "预警"}
              </span>
              <span className="flex-1 truncate">{insight.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
