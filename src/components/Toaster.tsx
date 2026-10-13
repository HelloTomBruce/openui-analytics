"use client";

import React from "react";
import { useSyncExternalStore } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import {
  dismissToast,
  getToastsSnapshot,
  subscribeToasts,
  type ToastItem,
} from "@/lib/toast";

const KIND_STYLE: Record<ToastItem["kind"], string> = {
  success:
    "bg-emerald-50 dark:bg-emerald-950/90 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200",
  error:
    "bg-rose-50 dark:bg-rose-950/90 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200",
  info: "bg-blue-50 dark:bg-blue-950/90 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200",
};

const KIND_ICON: Record<ToastItem["kind"], React.ReactNode> = {
  success: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />,
  error: <AlertCircle className="w-3.5 h-3.5 shrink-0" />,
  info: <Info className="w-3.5 h-3.5 shrink-0" />,
};

/**
 * 全局 toast 渲染层：挂载一次于 ChatDashboard，
 * 订阅 lib/toast 的模块级 store。
 */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToastsSnapshot);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border text-xs shadow-lg animate-in slide-in-from-right-2 ${KIND_STYLE[t.kind]}`}
        >
          {KIND_ICON[t.kind]}
          <span className="flex-1 leading-relaxed">{t.message}</span>
          <button
            onClick={() => dismissToast(t.id)}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            title="关闭"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
