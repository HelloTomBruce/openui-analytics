"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  RefreshCw,
  AlertTriangle,
  Lightbulb,
  ListOrdered,
  PieChart,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** 查看契约：GET /api/methodology 的 cards 项（不含 executeGuidance——LLM prompt 内部件） */
interface MethodCardView {
  id: string;
  name: string;
  when: string;
  steps: string[];
  chartPairing: string[];
  source: "builtin" | "user";
}

interface MethodologyResponse {
  cards: MethodCardView[];
  counts: { builtin: number; user: number; overridden: number };
  skipped: { cardId: string; reason: string }[];
}

interface MethodologyModalProps {
  /** 打开时拉取最新方法论库 */
  open: boolean;
  onClose: () => void;
}

/** 取数结果：字符串 = 错误消息（模块级函数，setState 只发生在调用方的 then 回调） */
type MethodologyPayload = MethodologyResponse | string;

async function fetchMethodology(): Promise<MethodologyPayload> {
  try {
    const res = await fetch("/api/methodology");
    if (!res.ok) return `HTTP ${res.status}`;
    const body: unknown = await res.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !Array.isArray((body as MethodologyResponse).cards)
    ) {
      return "响应格式不正确";
    }
    return body as MethodologyResponse;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * 分析方法论查看入口：浏览与分析时实际注入一致的合并卡集
 * （内置卡 + data/methodology/*.json 用户卡，同 id 覆盖）。
 * 打开时按需拉取；加载失败展示错误态与重试。
 */
export function MethodologyModal({ open, onClose }: MethodologyModalProps) {
  const [data, setData] = useState<MethodologyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 重试等事件处理器置位；effect 路径靠派生 loading 兜底 */
  const [busy, setBusy] = useState(false);
  const loading = busy || (open && !data && !error);

  const applyResult = useCallback((result: MethodologyPayload) => {
    if (typeof result === "string") setError(result);
    else {
      setData(result);
      setError(null);
    }
    setBusy(false);
  }, []);

  // 打开时拉取：setState 只发生在 promise 回调中，避免 effect 内同步 setState 级联渲染
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchMethodology().then((result) => {
      if (!cancelled) applyResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open, applyResult]);

  const retry = () => {
    setBusy(true);
    void fetchMethodology().then(applyResult);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-[calc(100%-2rem)] sm:max-w-2xl max-h-[85vh] w-full p-0 gap-0 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col"
      >
        <DialogTitle className="sr-only">分析方法论</DialogTitle>

        {/* 头部 */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
            <BookOpen className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-sm">分析方法论</h2>
            <p className="text-[11px] text-slate-400">
              分析师工具箱：提问时自动匹配下列方法卡组织分析
            </p>
          </div>
          {data && (
            <div className="text-[11px] text-slate-400 shrink-0 text-right leading-relaxed">
              内置 {data.counts.builtin} 张
              {data.counts.user > 0 && ` · 自定义 ${data.counts.user} 张`}
              {data.counts.overridden > 0 && `（覆盖内置 ${data.counts.overridden}）`}
            </div>
          )}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="py-12 text-center text-xs text-slate-400">
              正在加载方法论库...
            </div>
          )}

          {!loading && error && (
            <div className="py-10 text-center space-y-3">
              <AlertTriangle className="w-5 h-5 mx-auto text-amber-500" />
              <p className="text-xs text-slate-500">加载失败：{error}</p>
              <button
                onClick={retry}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                重试
              </button>
            </div>
          )}

          {!loading && !error && data && (
            <div className="space-y-3">
              {data.cards.map((card) => (
                <MethodCardItem key={card.id} card={card} />
              ))}
              {data.skipped.length > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    {data.skipped.length} 张自定义卡被跳过（坏 JSON / 形态不完整），
                    详见服务端启动日志。
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部：用户卡扩展提示 */}
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
          <p className="text-[11px] text-slate-400 leading-relaxed">
            自定义方法卡：在{" "}
            <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
              data/methodology/*.json
            </code>{" "}
            放置卡定义（单卡对象或数组，同 id 覆盖内置），重启后生效。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 单张方法卡：名称/id/来源 + 适用信号 + 分析步骤 + 图表配对 */
function MethodCardItem({ card }: { card: MethodCardView }) {
  return (
    <div className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-xs text-slate-700 dark:text-slate-200">
          {card.name}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-slate-400">
          {card.id}
        </span>
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
            card.source === "user"
              ? "bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400"
              : "bg-slate-100 dark:bg-slate-800 text-slate-400"
          }`}
        >
          {card.source === "user" ? "自定义覆盖" : "内置"}
        </span>
      </div>

      <div className="flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
        <span>{card.when}</span>
      </div>

      <div className="flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        <ListOrdered className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
        <ol className="space-y-0.5 leading-relaxed">
          {card.steps.map((step, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-slate-300 dark:text-slate-600 tabular-nums">
                {i + 1}.
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-400">
        <PieChart className="w-3.5 h-3.5 shrink-0" />
        {card.chartPairing.map((name) => (
          <span
            key={name}
            className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
