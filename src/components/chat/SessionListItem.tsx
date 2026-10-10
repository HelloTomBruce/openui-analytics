"use client";

import React from "react";
import { MessageSquare, Edit3, Trash2, Check } from "lucide-react";
import type { ChatSession } from "@/lib/sessionStorage";

export function formatSessionTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return `${diffDays} 天前`;

  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

interface SessionListItemProps {
  session: ChatSession;
  isActive: boolean;
  isEditing: boolean;
  editingTitleText: string;
  onSelect: (sessionId: string) => void;
  onStartRename: (e: React.MouseEvent, session: ChatSession) => void;
  onSaveRename: (sessionId: string) => void;
  onDelete: (e: React.MouseEvent, sessionId: string) => void;
  onEditTitleChange: (text: string) => void;
  onCancelEdit: () => void;
}

export function SessionListItem({
  session,
  isActive,
  isEditing,
  editingTitleText,
  onSelect,
  onStartRename,
  onSaveRename,
  onDelete,
  onEditTitleChange,
  onCancelEdit,
}: SessionListItemProps) {
  return (
    <div
      onClick={() => onSelect(session.id)}
      className={`group relative flex items-center justify-between p-2.5 rounded-xl text-xs cursor-pointer transition-all border ${
        isActive
          ? "bg-blue-50/90 dark:bg-blue-950/50 border-blue-200 dark:border-blue-900 text-blue-900 dark:text-blue-200 font-medium"
          : "border-transparent hover:bg-slate-100/80 dark:hover:bg-slate-800/60 text-slate-600 dark:text-slate-300"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1 pr-1">
        <MessageSquare
          className={`w-3.5 h-3.5 shrink-0 ${
            isActive ? "text-blue-600 dark:text-blue-400" : "text-slate-400"
          }`}
        />
        {isEditing ? (
          <input
            type="text"
            value={editingTitleText}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSaveRename(session.id);
              if (e.key === "Escape") onCancelEdit();
            }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
            className="flex-1 px-1.5 py-0.5 bg-white dark:bg-slate-900 border border-blue-400 rounded text-xs focus:outline-none"
          />
        ) : (
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs">{session.title}</div>
            <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5">
              <span>{formatSessionTime(session.updatedAt)}</span>
              <span>•</span>
              <span>{session.messages?.length || 1} 条消息</span>
            </div>
          </div>
        )}
      </div>

      {/* 悬浮操作按钮 */}
      <div className="flex items-center gap-1 shrink-0">
        {isEditing ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSaveRename(session.id);
            }}
            className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded"
            title="保存"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
        ) : (
          <>
            <button
              onClick={(e) => onStartRename(e, session)}
              className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-slate-600 transition-opacity"
              title="重命名"
            >
              <Edit3 className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => onDelete(e, session.id)}
              className="p-1 opacity-0 group-hover:opacity-100 hover:bg-rose-50 dark:hover:bg-rose-950/60 rounded text-slate-400 hover:text-rose-600 transition-opacity"
              title="删除会话"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
