"use client";

import React, { useEffect, useState } from "react";
import { X, RefreshCw, Edit3, Trash2, Check, Star } from "lucide-react";
import { OpenUIRenderer } from "@/components/OpenUIRenderer";
// 仅取类型（编译期擦除）
import type { DashboardRecord } from "@/lib/dashboardStore";
import { formatSessionTime } from "./SessionListItem";

interface DashboardPreviewModalProps {
  /** 待预览的完整收藏记录；null 不渲染 */
  dashboard: DashboardRecord | null;
  onClose: () => void;
  /** 重新分析：把原始提问交回当前会话（由父层决定 append 或提示） */
  onReanalyze: (prompt?: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  /** 交互组件动作：注入 ChatInput（不自动发送），由父层接线 */
  onAction: (actionPrompt: string) => void;
}

/**
 * 收藏看板只读预览：全屏 Modal 内以 OpenUIRenderer 渲染快照 DSL。
 * 头部支持行内重命名 / 重新分析 / 删除（二次确认）；Esc 与遮罩点击关闭。
 * 交互组件的动作经 onAction 注入输入框（不自动发送），与消息流看板行为区分。
 */
export function DashboardPreviewModal({
  dashboard,
  onClose,
  onReanalyze,
  onRename,
  onDelete,
  onAction,
}: DashboardPreviewModalProps) {
  // 行内重命名与删除确认的本地状态；换预览目标（id 变化）时在 render 期复位
  // （setState-during-render 官方模式，替代 effect 内同步 setState）
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lastId, setLastId] = useState(dashboard?.id);

  if (dashboard && dashboard.id !== lastId) {
    setLastId(dashboard.id);
    setEditing(false);
    setConfirmDelete(false);
    setDraft(dashboard.title);
  }

  // Esc 关闭
  useEffect(() => {
    if (!dashboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dashboard, onClose]);

  if (!dashboard) return null;

  const startRename = () => {
    setDraft(dashboard.title);
    setEditing(true);
  };

  const saveRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== dashboard.title) onRename(dashboard.id, trimmed);
    setEditing(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 md:p-8"
      data-testid="dashboard-preview-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`看板预览：${dashboard.title}`}
        className="w-full max-w-6xl max-h-full flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
      >
        {/* 头部：标题（行内重命名）+ 元信息 + 操作 */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveRename();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  aria-label="看板标题"
                  className="flex-1 min-w-0 px-2 py-1 text-sm bg-slate-50 dark:bg-slate-950 border border-blue-300 dark:border-blue-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={saveRename}
                  aria-label="保存标题"
                  className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50"
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <Star className="w-4 h-4 text-amber-500 fill-current shrink-0" />
                <h2 className="font-semibold text-sm truncate">{dashboard.title}</h2>
                <button
                  onClick={startRename}
                  aria-label="重命名看板"
                  title="重命名"
                  className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50 shrink-0"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
              <span>收藏于 {formatSessionTime(dashboard.updatedAt)}</span>
              {dashboard.sourceNames && dashboard.sourceNames.length > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                  {dashboard.sourceNames.join(" / ")}
                </span>
              )}
              {dashboard.prompt && (
                <span className="truncate max-w-md" title={dashboard.prompt}>
                  原提问：{dashboard.prompt}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => onReanalyze(dashboard.prompt)}
              disabled={!dashboard.prompt}
              title={
                dashboard.prompt
                  ? "用原始提问在当前会话重新分析（取最新数据）"
                  : "该收藏未记录原始提问"
              }
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>重新分析</span>
            </button>
            {confirmDelete ? (
              <button
                onClick={() => onDelete(dashboard.id)}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium transition-colors"
              >
                确认删除
              </button>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                aria-label="删除收藏"
                title="删除收藏"
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="关闭预览"
              title="关闭（Esc）"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 快照看板本体（只读渲染；动作注入输入框不自动发送） */}
        <div className="flex-1 overflow-y-auto p-5 bg-slate-50/60 dark:bg-slate-950/40">
          <OpenUIRenderer
            content={dashboard.dsl}
            isStreaming={false}
            onAction={onAction}
          />
        </div>
      </div>
    </div>
  );
}
