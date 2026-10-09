"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { OpenUIRenderer } from "@/components/OpenUIRenderer";
import {
  Send,
  Sparkles,
  BarChart3,
  TrendingUp,
  RefreshCw,
  FileCode,
  Settings,
  X,
  Bot,
  Key,
  Globe,
  Sliders,
  Loader2,
  Code2,
  Plus,
  MessageSquare,
  Trash2,
  Edit3,
  Check,
  Search,
  History,
  Compass,
} from "lucide-react";
import {
  ChatSession,
  getSavedSessions,
  persistSessions,
  getActiveSessionId,
  setActiveSessionId,
  createNewSession,
  generateSessionTitle,
  DEFAULT_WELCOME_MESSAGE,
} from "@/lib/sessionStorage";

interface ToolInvocationState {
  state: "call" | "result" | "partial-call";
  toolCallId: string;
  toolName: string;
  args?: { sql?: string; [key: string]: unknown };
  result?: unknown;
}

const PRESET_QUERIES = [
  "帮我分析各渠道获客成本与投产，并提供响应式预算测算器与行动建议清单",
  "从禅道分析当前进行中项目的工时消耗、进度达成度与未关闭 Bug 严重度分布",
  "统计禅道中各团队成员的任务分配与工时饱和度雷达图",
  "从数据库分析全链路转化漏斗与 Q1 营销目标达成度",
  "从 GitLab 分析核心仓库的代码提交轨迹与时段活跃度热力图",
  "统计禅道各产品的需求生命周期流转漏斗与延期风险",
];

const DEFAULT_SANDBOX_CODE = `root = Root([filter, gauge, sim, chart, action_plan])
filter = AnalyticsFilterBar("营销渠道实时钻取与测算表单", "TikTok Ads", "cac")
gauge = GaugeProgress("Q1 整体获客达成率", "目标 5,000 线索", 4640, 5000, "条", "达成率 92.8%")
sim = ReactiveSimulator("TikTok Ads 实时预算与投产测试器", 50000, "TikTok Ads", 19.87, 0.146)
chart = AnalyticsChart("bar", "各渠道获客成本对比", "单位：美元", "channel", [{"channel":"TikTok Ads","cac":19.87},{"channel":"Google Search","cac":28.38},{"channel":"Meta Ads","cac":43.99}], [{"key":"cac","label":"CAC ($)","color":"#3b82f6"}])
action_plan = ActionPlanCard("落地建议清单", "基于投入产出比测算", [{"title":"向 TikTok Ads 追加 20% 预算","priority":"high","impact":"预计新增线索 420 条","owner":"营销组"}])`;

function formatSessionTime(timestamp: number): string {
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

export default function ChatDashboard() {
  const [showRawLang, setShowRawLang] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
  const [devToolsCode, setDevToolsCode] = useState(DEFAULT_SANDBOX_CODE);

  // 会话管理状态 (惰性初始化读取 localStorage)
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    if (typeof window !== "undefined") {
      const saved = getSavedSessions();
      if (saved.length > 0) return saved;
      const initial = createNewSession("营销获客与商业分析会话");
      return [initial];
    }
    return [];
  });

  const [currentSessionId, setCurrentSessionIdState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const active = getActiveSessionId();
      const saved = getSavedSessions();
      if (active && saved.some((s) => s.id === active)) return active;
      if (saved.length > 0) return saved[0].id;
    }
    return "";
  });

  const [sidebarTab, setSidebarTab] = useState<"history" | "presets">("history");
  const [sessionSearch, setSessionSearch] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitleText, setEditingTitleText] = useState("");

  // LLM 配置状态 (惰性初始化读取 localStorage)
  const [apiKey, setApiKey] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("openui_llm_api_key") || "";
    }
    return "";
  });
  const [baseURL, setBaseURL] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("openui_llm_base_url") || "https://api.openai.com/v1";
    }
    return "https://api.openai.com/v1";
  });
  const [model, setModel] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("openui_llm_model") || "gpt-4o-mini";
    }
    return "gpt-4o-mini";
  });
  const [gitlabToken, setGitlabToken] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("openui_gitlab_token") || "";
    }
    return "";
  });
  const [gitlabUrl, setGitlabUrl] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("openui_gitlab_url") || "http://127.0.0.1:5002/mcp";
    }
    return "http://127.0.0.1:5002/mcp";
  });

  const saveSettings = () => {
    localStorage.setItem("openui_llm_api_key", apiKey);
    localStorage.setItem("openui_llm_base_url", baseURL);
    localStorage.setItem("openui_llm_model", model);
    localStorage.setItem("openui_gitlab_token", gitlabToken);
    localStorage.setItem("openui_gitlab_url", gitlabUrl);
    setShowSettings(false);
  };

  const chatBody = useMemo(
    () => ({
      apiKey: apiKey.trim() || undefined,
      baseURL: baseURL.trim() || undefined,
      model: model.trim() || undefined,
      gitlabToken: gitlabToken.trim() || undefined,
      gitlabUrl: gitlabUrl.trim() || undefined,
    }),
    [apiKey, baseURL, model, gitlabToken, gitlabUrl]
  );

  const handleChatError = useCallback((err: Error) => {
    console.error("Chat error:", err);
  }, []);

  const currentSessionIdRef = useRef(currentSessionId);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // 保存消息列表到当前活跃会话
  const saveCurrentSessionMessages = useCallback((newMessages: typeof DEFAULT_WELCOME_MESSAGE[]) => {
    const activeId = currentSessionIdRef.current;
    if (!activeId || newMessages.length === 0) return;

    setSessions((prevSessions) => {
      const sessionIndex = prevSessions.findIndex((s) => s.id === activeId);
      if (sessionIndex === -1) return prevSessions;

      const current = prevSessions[sessionIndex];
      let title = current.title;
      const firstUserMessage = newMessages.find((m) => m.role === "user");
      if (
        (title === "新建分析会话" || title === "营销获客与商业分析会话" || title === "新分析会话") &&
        firstUserMessage
      ) {
        title = generateSessionTitle(firstUserMessage.content);
      }

      const updatedSession: ChatSession = {
        ...current,
        title,
        updatedAt: Date.now(),
        messages: newMessages,
      };

      const nextSessions = [...prevSessions];
      nextSessions[sessionIndex] = updatedSession;
      nextSessions.sort((a, b) => b.updatedAt - a.updatedAt);
      persistSessions(nextSessions);
      return nextSessions;
    });
  }, []);

  // 计算初始会话消息
  const initialMessages = useMemo(() => {
    if (typeof window !== "undefined") {
      const active = getActiveSessionId();
      const saved = getSavedSessions();
      const current = saved.find((s) => s.id === active) || saved[0];
      if (current && current.messages && current.messages.length > 0) {
        return current.messages;
      }
    }
    return [DEFAULT_WELCOME_MESSAGE];
  }, []);

  // 使用 Next.js 官方 Vercel AI SDK 的 useChat Hook
  const {
    messages,
    setMessages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    append,
    isLoading,
    error,
    reload,
  } = useChat({
    api: "/api/analyze",
    body: chatBody,
    onError: handleChatError,
    initialMessages,
    onFinish: (message) => {
      // 流式结束时保存
      saveCurrentSessionMessages([...messages, message]);
    },
  });

  // 新建会话
  const handleCreateNewChat = useCallback(() => {
    const newSession = createNewSession();
    setSessions((prev) => [newSession, ...prev]);
    setCurrentSessionIdState(newSession.id);
    setActiveSessionId(newSession.id);
    setMessages(newSession.messages);
  }, [setMessages]);

  // 切换会话
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      if (sessionId === currentSessionId) return;
      const target = sessions.find((s) => s.id === sessionId);
      if (!target) return;
      setCurrentSessionIdState(sessionId);
      setActiveSessionId(sessionId);
      setMessages(target.messages || [DEFAULT_WELCOME_MESSAGE]);
    },
    [currentSessionId, sessions, setMessages]
  );

  // 删除会话
  const handleDeleteSession = useCallback(
    (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      if (sessions.length <= 1) {
        const fresh = createNewSession("新分析会话");
        setSessions([fresh]);
        setCurrentSessionIdState(fresh.id);
        setActiveSessionId(fresh.id);
        setMessages(fresh.messages);
        return;
      }

      const nextSessions = sessions.filter((s) => s.id !== sessionId);
      setSessions(nextSessions);
      persistSessions(nextSessions);

      if (currentSessionId === sessionId) {
        const nextActive = nextSessions[0];
        setCurrentSessionIdState(nextActive.id);
        setActiveSessionId(nextActive.id);
        setMessages(nextActive.messages || [DEFAULT_WELCOME_MESSAGE]);
      }
    },
    [sessions, currentSessionId, setMessages]
  );

  // 开始重命名会话
  const handleStartRename = (e: React.MouseEvent, session: ChatSession) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitleText(session.title);
  };

  // 确认保存重命名
  const handleSaveRename = (sessionId: string) => {
    if (!editingTitleText.trim()) {
      setEditingSessionId(null);
      return;
    }
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === sessionId ? { ...s, title: editingTitleText.trim() } : s
      );
      persistSessions(next);
      return next;
    });
    setEditingSessionId(null);
  };

  // 清空所有历史会话
  const handleClearAllSessions = () => {
    if (confirm("确定要清空全部历史会话记录吗？此操作不可逆。")) {
      const fresh = createNewSession("新分析会话");
      setSessions([fresh]);
      setCurrentSessionIdState(fresh.id);
      setActiveSessionId(fresh.id);
      setMessages(fresh.messages);
    }
  };

  const handleRendererAction = useCallback(
    (actionPrompt: string) => {
      append({ role: "user", content: actionPrompt });
    },
    [append]
  );

  const handleDevToolsAction = useCallback((msg: string) => {
    alert(`触发 Action: ${msg}`);
  }, []);

  // 过滤后的会话列表
  const filteredSessions = useMemo(() => {
    if (!sessionSearch.trim()) return sessions;
    const q = sessionSearch.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, sessionSearch]);

  const activeSession = sessions.find((s) => s.id === currentSessionId);

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans overflow-hidden">
      {/* 侧边栏 */}
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
            onClick={handleCreateNewChat}
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
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all ${
                sidebarTab === "history"
                  ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs font-semibold"
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>历史会话 ({sessions.length})</span>
            </button>
            <button
              onClick={() => setSidebarTab("presets")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all ${
                sidebarTab === "presets"
                  ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs font-semibold"
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>推荐场景</span>
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
                filteredSessions.map((session) => {
                  const isActive = session.id === currentSessionId;
                  const isEditing = editingSessionId === session.id;

                  return (
                    <div
                      key={session.id}
                      onClick={() => handleSelectSession(session.id)}
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
                            onChange={(e) => setEditingTitleText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveRename(session.id);
                              if (e.key === "Escape") setEditingSessionId(null);
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
                              handleSaveRename(session.id);
                            }}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded"
                            title="保存"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={(e) => handleStartRename(e, session)}
                              className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-slate-600 transition-opacity"
                              title="重命名"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => handleDeleteSession(e, session.id)}
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
                })
              )}
            </div>

            {/* 清空历史按钮 */}
            {sessions.length > 1 && (
              <div className="pt-1 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                <button
                  onClick={handleClearAllSessions}
                  className="text-[11px] text-slate-400 hover:text-rose-600 py-1 transition-colors flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>清空所有记录</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* 预设推荐场景视图 */}
        {sidebarTab === "presets" && (
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1 pb-1">
              一键带入预设分析模板
            </div>
            {PRESET_QUERIES.map((preset, idx) => (
              <button
                key={idx}
                onClick={() => append({ role: "user", content: preset })}
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
              onClick={() => setShowSettings(true)}
              className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-slate-500 hover:text-slate-800"
              title="配置大模型与 MCP"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1.5 pt-1">
            <button
              onClick={() => setShowDevTools(true)}
              className="w-full text-xs p-2 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/60 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 font-medium transition-colors flex items-center gap-2"
            >
              <Code2 className="w-3.5 h-3.5 text-purple-500" />
              <span>OpenUI 调试工作台 (DevTools)</span>
            </button>

            <button
              onClick={() => setShowRawLang(!showRawLang)}
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

      {/* 主对话工作区 */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* 顶部标题栏 */}
        <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 text-sm font-medium min-w-0">
            <TrendingUp className="w-4 h-4 text-blue-500 shrink-0" />
            <span className="font-semibold truncate max-w-md">
              {activeSession?.title || "OpenUI 对话式数据分析看板"}
            </span>
            {apiKey && (
              <span className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 px-2 py-0.5 rounded-full font-semibold border border-emerald-200 dark:border-emerald-800 shrink-0">
                AI: {model}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateNewChat}
              className="text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新对话</span>
            </button>
            <button
              onClick={() => setShowDevTools(true)}
              className="text-xs text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/50 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-purple-200 dark:border-purple-800"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>AST 沙箱</span>
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>设置</span>
            </button>
            <button
              onClick={() => window.location.reload()}
              className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1 p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
              title="刷新页面"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* 消息滚动区 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg, index) => {
            const rawContent = msg.content;
            let textPart = rawContent;
            let openuiPart = "";

            // 提取 openui 代码块
            const openuiMatch = rawContent.match(/```(?:openui)?\s*([\s\S]*?)(?:```|$)/i);
            if (openuiMatch) {
              openuiPart = openuiMatch[1].trim();
              textPart = rawContent.replace(/```(?:openui)?\s*[\s\S]*?(?:```|$)/i, "").trim();
            }

            const isLastMessage = index === messages.length - 1;
            const isStreaming = isLastMessage && status === "streaming";
            const toolInvocations = ((msg as unknown as { toolInvocations?: ToolInvocationState[] }).toolInvocations) || [];

            return (
              <div
                key={msg.id || `msg-${index}`}
                className={`flex flex-col ${
                  msg.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={`max-w-4xl rounded-2xl p-4 text-sm ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white rounded-br-xs"
                      : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-xs w-full shadow-xs"
                  }`}
                >
                  {/* 工具调用指示器 */}
                  {toolInvocations.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {toolInvocations.map((tool, idx: number) => {
                        const isRunning = tool.state !== "result";
                        return (
                          <div
                            key={idx}
                            className={`flex items-center gap-2 text-xs px-3 py-2.5 rounded-lg border transition-all ${
                              isRunning
                                ? "text-blue-700 dark:text-blue-300 bg-blue-50/80 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800 animate-pulse"
                                : "text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800"
                            }`}
                          >
                            <Loader2 className={`w-3.5 h-3.5 ${isRunning ? "animate-spin text-blue-500" : "text-emerald-500"}`} />
                            <span className="font-mono flex-1 truncate">
                              {tool.toolName === "execute_sql"
                                ? `⚡ [PostgreSQL MCP] 执行 SQL: ${tool.args?.sql || ""}`
                                : tool.toolName.startsWith("zentao_")
                                ? `⚡ [ZenTao 禅道] 调用: ${tool.toolName}`
                                : tool.toolName.startsWith("gitlab_")
                                ? `⚡ [GitLab MCP] 调用: ${tool.toolName}`
                                : `⚡ [MCP Tool] 调用: ${tool.toolName}`}
                            </span>
                            {isRunning ? (
                              <span className="text-[10px] bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded font-sans font-medium flex items-center gap-1">
                                查询中...
                              </span>
                            ) : (
                              <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded font-sans font-medium">
                                已完成
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 如果工具刚执行完，模型正在构思下一段文本/OpenUI组件 */}
                  {isStreaming && toolInvocations.length > 0 && !openuiPart && !textPart && (
                    <div className="flex items-center gap-2 text-xs text-slate-500 py-1 font-medium animate-pulse">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                      <span>数据查询已完成，大模型正在组织分析洞察并构建视觉看板...</span>
                    </div>
                  )}

                  {textPart && (
                    <div className="leading-relaxed whitespace-pre-wrap">
                      {textPart}
                      {isStreaming && !openuiPart && (
                        <span className="inline-block w-1.5 h-3.5 bg-blue-500 animate-pulse ml-1 align-middle rounded-xs" />
                      )}
                    </div>
                  )}

                  {/* 原始 OpenUI Lang 源代码展示 */}
                  {showRawLang && openuiPart && (
                    <div className="mt-3 bg-blue-950/20 text-blue-900 dark:text-blue-200 p-3 rounded-lg text-xs font-mono overflow-x-auto border border-blue-200 dark:border-blue-900">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400 mb-1.5">
                        <FileCode className="w-3.5 h-3.5" />
                        <span>OpenUI Lang (Model Generated DSL)</span>
                      </div>
                      <pre className="whitespace-pre-wrap leading-relaxed">{openuiPart}</pre>
                    </div>
                  )}

                  {/* 流式渐进式渲染 OpenUI Lang 界面 */}
                  {openuiPart && (
                    <div className="mt-5 space-y-4">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                          <span>OpenUI 动态看板</span>
                          {isStreaming ? (
                            <span className="text-[10px] text-blue-500 font-normal lowercase flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping"></span>
                              streaming...
                            </span>
                          ) : (
                            <span className="text-[10px] bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 px-1.5 py-0.5 rounded font-normal">
                              已就绪
                            </span>
                          )}
                        </div>
                      </div>

                      <OpenUIRenderer
                        content={openuiPart}
                        isStreaming={isStreaming}
                        onAction={handleRendererAction}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* 当用户刚发出消息，大模型尚在准备第一阶段响应时的全局 Thinking Loading 卡片 */}
          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex flex-col items-start">
              <div className="max-w-4xl rounded-2xl p-4 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-xs w-full shadow-xs space-y-3">
                <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 font-medium">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                  <span>AI 正在分析意图并连接 PostgreSQL / GitLab / ZenTao MCP 数据源...</span>
                </div>
                <div className="space-y-2 pt-1">
                  <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full w-3/4 animate-pulse" />
                  <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full w-1/2 animate-pulse" />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-start gap-3">
              <span className="font-bold">⚠️ 请求异常:</span>
              <span className="flex-1 font-mono">{error.message || String(error)}</span>
              <button
                onClick={() => reload()}
                className="px-2.5 py-1 bg-rose-100 dark:bg-rose-900 hover:bg-rose-200 rounded text-rose-800 dark:text-rose-200 font-medium transition-colors"
              >
                重试
              </button>
            </div>
          )}
        </div>

        {/* 底部输入框 */}
        <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
          <form onSubmit={handleSubmit} className="flex items-center gap-2 max-w-4xl mx-auto">
            <input
              type="text"
              value={input}
              onChange={handleInputChange}
              placeholder={
                isLoading
                  ? "Vercel AI SDK 正在流式推理并调用 MCP 查询..."
                  : "例如：从数据库分析各渠道 CAC，输出响应式预算试算器与落地行动建议..."
              }
              disabled={isLoading}
              className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-3 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-xs"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>发送</span>
            </button>
          </form>
        </div>
      </main>

      {/* 特性 6: OpenUI 开发者实时调试工作台 (DevTools & AST Sandbox) */}
      {showDevTools && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950">
              <div className="flex items-center gap-2">
                <Code2 className="w-5 h-5 text-purple-600" />
                <div>
                  <h3 className="font-bold text-sm">OpenUI DevTools & 实时 AST 调试沙箱</h3>
                  <p className="text-[11px] text-slate-400">
                    可在此直接修改 OpenUI Lang 代码，实时验证语法解析、响应式变量计算与组件渲染
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDevTools(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {/* 左侧 DSL 实时编辑器 */}
              <div className="w-1/2 border-r border-slate-200 dark:border-slate-800 flex flex-col p-4 bg-slate-950 text-slate-100">
                <div className="flex items-center justify-between pb-2 text-xs font-mono text-slate-400">
                  <span>OpenUI Lang Source Editor</span>
                  <span className="text-[10px] text-purple-400 font-sans">毫秒级热编译</span>
                </div>
                <textarea
                  value={devToolsCode}
                  onChange={(e) => setDevToolsCode(e.target.value)}
                  className="flex-1 w-full bg-transparent font-mono text-xs leading-relaxed focus:outline-none resize-none text-purple-200"
                  spellCheck={false}
                />
              </div>

              {/* 右侧实时视觉预览区 */}
              <div className="w-1/2 flex flex-col p-4 overflow-y-auto bg-slate-50 dark:bg-slate-950/30">
                <div className="pb-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Live Preview Output
                </div>
                <OpenUIRenderer
                  content={devToolsCode}
                  isStreaming={false}
                  onAction={handleDevToolsAction}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LLM 设置模态框 */}
      {showSettings && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-blue-500" />
                <h3 className="font-bold text-sm">自定义大模型配置</h3>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1 font-medium flex items-center gap-1">
                  <Key className="w-3.5 h-3.5" />
                  <span>API Key</span>
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-500 mb-1 font-medium flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5" />
                  <span>Base URL</span>
                </label>
                <input
                  type="text"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-500 mb-1 font-medium flex items-center gap-1">
                  <Bot className="w-3.5 h-3.5" />
                  <span>Model</span>
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gpt-4o-mini / deepseek-chat"
                  className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                />
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 mb-2">
                  外部 GitLab MCP 配置
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="block text-slate-500 mb-1 font-medium">GitLab MCP Endpoint</label>
                    <input
                      type="text"
                      value={gitlabUrl}
                      onChange={(e) => setGitlabUrl(e.target.value)}
                      placeholder="http://127.0.0.1:5002/mcp"
                      className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1 font-medium">GitLab Private Token / Access Token</label>
                    <input
                      type="password"
                      value={gitlabToken}
                      onChange={(e) => setGitlabToken(e.target.value)}
                      placeholder="glpat-..."
                      className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 mb-1 flex items-center justify-between">
                  <span>本地 ZenTao (禅道) MCP</span>
                  <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded font-normal">已自动挂载</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  通过本地 <code>zentao mcp --read-only</code> 自动连接已登录账号，支持项目进度、Bug 缺陷、任务工时与需求流转等多维统计。
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setShowSettings(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs hover:bg-slate-100"
              >
                取消
              </button>
              <button
                onClick={saveSettings}
                className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 shadow-xs"
              >
                保存配置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
