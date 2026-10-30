"use client";

import React, { useMemo, useState } from "react";
import {
  BarChart3,
  Plus,
  History,
  Compass,
  Search,
  Trash2,
  Bot,
  Settings,
  Code2,
  FileCode,
  Sparkles,
  LayoutGrid,
  Eye,
  RefreshCw,
  Edit3,
  Check,
  Star,
} from "lucide-react";
import type { ChatSession } from "@/lib/sessionStorage";
// 仅取类型（编译期擦除）
import type { DashboardSummary } from "@/lib/dashboardStore";
import { PRESET_QUERIES } from "@/lib/presetQueries";
import { SessionListItem, formatSessionTime } from "./SessionListItem";

interface ChatSidebarProps {
  sessions: ChatSession[];
  currentSessionId: string;
  editingSessionId: string | null;
  editingTitleText: string;
  apiKey: string;
  model: string;
  showRawLang: boolean;
  /** 看板收藏库（服务端存储，跨浏览器可用） */
  dashboards: DashboardSummary[];
  onPreviewDashboard: (id: string) => void;
  /** 重新分析：prompt 交回当前会话；未记录提问时由上层提示 */
  onReanalyzeDashboard: (prompt?: string) => void;
  onRenameDashboard: (id: string, title: string) => void;
  onDeleteDashboard: (id: string) => void;
  onCreateNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onStartRename: (e: React.MouseEvent, session: ChatSession) => void;
  onSaveRename: (sessionId: string) => void;
  onDeleteSession: (e: React.MouseEvent, sessionId: string) => void;
  onEditTitleChange: (text: string) => void;
  onCancelEdit: () => void;
  onClearAllSessions: () => void;
  onPresetSelect: (preset: string) => void;
  onOpenSettings: () => void;
  onOpenDevTools: () => void;
  onToggleRawLang: () => void;
}

export function ChatSidebar({
  sessions,
  currentSessionId,
  editingSessionId,
  editingTitleText,
  apiKey,
  model,
  showRawLang,
  dashboards,
  onPreviewDashboard,
  onReanalyzeDashboard,
  onRenameDashboard,
  onDeleteDashboard,
  onCreateNewChat,
  onSelectSession,
  onStartRename,
  onSaveRename,
  onDeleteSession,
  onEditTitleChange,
  onCancelEdit,
  onClearAllSessions,
  onPresetSelect,
  onOpenSettings,
  onOpenDevTools,
  onToggleRawLang,
}: ChatSidebarProps) {
  const [sidebarTab, setSidebarTab] = useState<
    "history" | "dashboards" | "presets"
  >("history");
  const [sessionSearch, setSessionSearch] = useState("");

  // 过滤后的会话列表
  const filteredSessions = useMemo(() => {
    if (!sessionSearch.trim()) return sessions;
    const q = sessionSearch.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, sessionSearch]);

  return (
    <aside className="w-72 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col shrink-0">
      {/* Logo 区域 */}
      <div className="flex items-center gap-2.5 p-4 border-b border-slate-100 dark:border-slate-800">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs">
          <BarChart3 className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-sm leading-tight truncate">OpenUI Analytics</h1>
          <p className="text-[11px] text-slate-400">Generative UI & MCP</p>
        </div>
      </div>

      {/* 顶部操作：新建会话按钮 */}
      <div className="p-3 border-b border-slate-100 dark:border-slate-800">
        <button
          onClick={onCreateNewChat}
          className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>新建对话会话</span>
        </button>
      </div>

      {/* 侧边栏导航 Tab 切换 */}
      <div className="px-3 pt-2">
        <div className="flex bg-slate-100 dark:bg-slate-800/70 p-1 rounded-lg text-xs font-medium">
          <button
            onClick={() => setSidebarTab("history")}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md transition-all ${
              sidebarTab === "history"
                ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs font-semibold"
                : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>历史 ({sessions.length})</span>
          </button>
          <button
            onClick={() => setSidebarTab("dashboards")}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md transition-all ${
              sidebarTab === "dashboards"
                ? "bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs font-semibold"
                : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>看板 ({dashboards.length})</span>
          </button>
          <button
            onClick={() => setSidebarTab("presets")}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md transition-all ${
              sidebarTab === "presets"
                ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs font-semibold"
                : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>推荐</span>
          </button>
        </div>
      </div>

      {/* 历史会话列表视图 */}
      {sidebarTab === "history" && (
        <div className="flex-1 flex flex-col min-h-0 px-3 py-2 space-y-2">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
              placeholder="搜索历史会话..."
              className="w-full pl-8 pr-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* 会话列表项 */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {filteredSessions.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">
                无匹配的会话记录
              </div>
            ) : (
              filteredSessions.map((session) => (
                <SessionListItem
                  key={session.id}
                  session={session}
                  isActive={session.id === currentSessionId}
                  isEditing={editingSessionId === session.id}
                  editingTitleText={editingTitleText}
                  onSelect={onSelectSession}
                  onStartRename={onStartRename}
                  onSaveRename={onSaveRename}
                  onDelete={onDeleteSession}
                  onEditTitleChange={onEditTitleChange}
                  onCancelEdit={onCancelEdit}
                />
              ))
            )}
          </div>

          {/* 清空历史按钮 */}
          <div className="pt-1 border-t border-slate-100 dark:border-slate-800 flex justify-end">
            <button
              onClick={onClearAllSessions}
              className="text-[11px] text-slate-400 hover:text-rose-600 py-1 transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              <span>清空所有记录</span>
            </button>
          </div>
        </div>
      )}

      {/* 看板收藏库视图 */}
      {sidebarTab === "dashboards" && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1 pb-1">
            收藏的看板（服务端存储，跨浏览器可用）
          </div>
          {dashboards.length === 0 ? (
            <div className="text-center py-10 px-3 text-xs text-slate-400 leading-relaxed">
              <Star className="w-5 h-5 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
              还没有收藏的看板
              <br />
              对话生成看板后，点击看板右上角 <span className="text-amber-500">★ 收藏</span> 保存到这里
            </div>
          ) : (
            dashboards.map((d) => (
              <DashboardListItem
                key={d.id}
                dashboard={d}
                onPreview={onPreviewDashboard}
                onReanalyze={onReanalyzeDashboard}
                onRename={onRenameDashboard}
                onDelete={onDeleteDashboard}
              />
            ))
          )}
        </div>
      )}

      {/* 预设推荐场景视图 */}
      {sidebarTab === "presets" && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1 pb-1">
            一键带入预设分析模板
          </div>
          {PRESET_QUERIES.map((preset) => (
            <button
              key={preset}
              onClick={() => onPresetSelect(preset)}
              className="w-full text-left text-xs p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors flex items-start gap-2"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
              <span className="line-clamp-2 leading-relaxed">{preset}</span>
            </button>
          ))}
        </div>
      )}

      {/* 底部功能栏与运行状态 */}
      <div className="p-3 border-t border-slate-100 dark:border-slate-800 space-y-2 bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex items-center justify-between text-[11px] px-1 text-slate-500">
          <div className="flex items-center gap-1.5 font-medium">
            <Bot className="w-3.5 h-3.5 text-blue-500" />
            <span>{apiKey ? model : "未配置 Key"}</span>
          </div>
          <button
            onClick={onOpenSettings}
            className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-slate-500 hover:text-slate-800"
            title="配置大模型与 MCP"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="space-y-1.5 pt-1">
          <button
            onClick={onOpenDevTools}
            className="w-full text-xs p-2 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/60 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 font-medium transition-colors flex items-center gap-2"
          >
            <Code2 className="w-3.5 h-3.5 text-purple-500" />
            <span>OpenUI 调试工作台 (DevTools)</span>
          </button>

          <button
            onClick={onToggleRawLang}
            className={`w-full text-xs p-2 rounded-lg border transition-colors flex items-center gap-2 ${
              showRawLang
                ? "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 font-medium"
                : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>{showRawLang ? "隐藏 OpenUI 源码" : "查看 OpenUI Lang 源码"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

/** 看板收藏列表项：查看 / 重新分析 / 行内重命名 / 删除（行内二次确认） */
function DashboardListItem({
  dashboard,
  onPreview,
  onReanalyze,
  onRename,
  onDelete,
}: {
  dashboard: DashboardSummary;
  onPreview: (id: string) => void;
  onReanalyze: (prompt?: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(dashboard.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== dashboard.title) onRename(dashboard.id, trimmed);
    setEditing(false);
  };

  return (
    <div
      onClick={() => !editing && onPreview(dashboard.id)}
      className="group relative flex items-center justify-between p-2.5 rounded-xl text-xs cursor-pointer transition-all border border-transparent hover:bg-slate-100/80 dark:hover:bg-slate-800/60 text-slate-600 dark:text-slate-300"
    >
      <div className="min-w-0 flex-1 pr-1">
        {editing ? (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveRename();
                if (e.key === "Escape") setEditing(false);
              }}
              aria-label={`重命名看板 ${dashboard.title}`}
              className="flex-1 min-w-0 px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-blue-300 dark:border-blue-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={saveRename}
              aria-label="保存标题"
              className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <Star className="w-3 h-3 text-amber-500 fill-current shrink-0" />
              <span className="font-medium truncate">{dashboard.title}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400 truncate">
              {dashboard.prompt ? dashboard.prompt : "（未记录原始提问）"}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
              <span>{formatSessionTime(dashboard.updatedAt)}</span>
              {dashboard.sourceNames && dashboard.sourceNames.length > 0 && (
                <span className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 truncate">
                  {dashboard.sourceNames.join(" / ")}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* 行内操作：编辑态隐藏；点击不冒泡到行预览 */}
      {!editing && (
        <div
          className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => onPreview(dashboard.id)}
            aria-label={`查看看板 ${dashboard.title}`}
            title="查看看板"
            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onReanalyze(dashboard.prompt)}
            disabled={!dashboard.prompt}
            aria-label={`重新分析 ${dashboard.title}`}
            title={dashboard.prompt ? "用原始提问重新分析" : "未记录原始提问"}
            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50 disabled:opacity-30 disabled:pointer-events-none"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setDraft(dashboard.title);
              setEditing(true);
            }}
            aria-label={`重命名看板 ${dashboard.title}`}
            title="重命名"
            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          {confirmDelete ? (
            <button
              onClick={() => onDelete(dashboard.id)}
              className="px-1.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium"
            >
              确认
            </button>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              aria-label={`删除看板 ${dashboard.title}`}
              title="删除收藏"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
