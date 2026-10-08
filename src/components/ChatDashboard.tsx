"use client";

import React, { useState } from "react";
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
} from "lucide-react";

interface ToolInvocationState {
  state: "call" | "result" | "partial-call";
  toolCallId: string;
  toolName: string;
  args?: { sql?: string; [key: string]: unknown };
  result?: unknown;
}

const PRESET_QUERIES = [
  "帮我从数据库分析各渠道转化率与获客成本(CAC)",
  "对比张伟与陈静的业绩达成与胜率差异，并给出建议",
  "哪个月份各渠道的获客量增长最快？分析其主要驱动力",
  "如果下季度要砍掉一个 ROI 最低的渠道，应该选谁？",
];

export default function ChatDashboard() {
  const [showRawLang, setShowRawLang] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // LLM 配置状态 (惰性初始化读取 localStorage，避免 useEffect 内直接 setState 触发的 cascading render)
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

  const saveSettings = () => {
    localStorage.setItem("openui_llm_api_key", apiKey);
    localStorage.setItem("openui_llm_base_url", baseURL);
    localStorage.setItem("openui_llm_model", model);
    setShowSettings(false);
  };

  // 使用 Next.js 官方 Vercel AI SDK 的 useChat Hook
  const {
    messages,
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
    body: {
      apiKey: apiKey.trim() || undefined,
      baseURL: baseURL.trim() || undefined,
      model: model.trim() || undefined,
    },
    onError: (err) => {
      console.error("Chat error:", err);
    },
    initialMessages: [
      {
        id: "welcome",
        role: "assistant",
        content:
          "👋 你好！我是基于 **Vercel AI SDK**、**OpenUI 规范** 与 **PostgreSQL MCP Server** 构建的对话式数据分析助手。\n已开启流式多步 Agent 推理与实时视觉渲染，你可以直接提问，大模型将自动执行数据库分析。",
      },
    ],
  });

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
      {/* 侧边栏 */}
      <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col p-4">
        <div className="flex items-center gap-2.5 px-2 py-3 border-b border-slate-100 dark:border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-sm leading-tight">OpenUI Analytics</h1>
            <p className="text-[11px] text-slate-400">Vercel AI SDK + OpenUI</p>
          </div>
        </div>

        {/* LLM & DB 运行状态卡片 */}
        <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Bot className="w-4 h-4 text-blue-500" />
              <span>{apiKey ? "Vercel AI SDK 流式" : "未配置 Key"}</span>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md text-slate-500 hover:text-slate-900 transition-colors"
              title="配置 LLM"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="text-[11px] text-slate-400 truncate">
            {apiKey ? `模型: ${model}` : "点击右侧齿轮配置 API Key"}
          </div>
          <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800 flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>PostgreSQL MCP (Auto Agent)</span>
          </div>
        </div>

        <div className="mt-4 flex-1 space-y-4">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-2">
            推荐分析场景
          </div>
          <div className="space-y-1.5">
            {PRESET_QUERIES.map((preset, idx) => (
              <button
                key={idx}
                onClick={() => append({ role: "user", content: preset })}
                className="w-full text-left text-xs p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors flex items-start gap-2"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                <span className="line-clamp-2">{preset}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 底部功能按钮 */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <button
            onClick={() => setShowRawLang(!showRawLang)}
            className={`w-full text-xs p-2.5 rounded-lg border transition-colors flex items-center gap-2 ${
              showRawLang
                ? "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 font-medium"
                : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>{showRawLang ? "隐藏 OpenUI 源码" : "查看 OpenUI Lang 源码"}</span>
          </button>
        </div>
      </aside>

      {/* 主对话工作区 */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* 顶部标题栏 */}
        <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <TrendingUp className="w-4 h-4 text-blue-500" />
            <span>OpenUI 对话式数据分析看板</span>
            {apiKey && (
              <span className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 px-2 py-0.5 rounded-full font-semibold border border-emerald-200 dark:border-emerald-800">
                AI SDK: {model}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className="text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>LLM 设置</span>
            </button>
            <button
              onClick={() => window.location.reload()}
              className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1 p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
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

            // 精确提取 openui 代码块
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
                key={msg.id}
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
                    <div className="space-y-1.5 mb-3">
                      {toolInvocations.map((tool, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 rounded-lg border border-blue-100 dark:border-blue-900/50"
                        >
                          <Loader2 className={`w-3.5 h-3.5 ${tool.state === "result" ? "text-emerald-500" : "animate-spin"}`} />
                          <span className="font-mono">
                            {tool.toolName === "execute_sql"
                              ? `⚡ [PostgreSQL MCP] 执行 SQL: ${tool.args?.sql || ""}`
                              : `⚡ [PostgreSQL MCP] 调用工具: ${tool.toolName}`}
                          </span>
                          {tool.state === "result" && (
                            <span className="ms-auto text-[10px] bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-sans">
                              已完成
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {textPart && (
                    <p className="leading-relaxed whitespace-pre-wrap">{textPart}</p>
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

                  {/* 核心：流式渐进式渲染 OpenUI Lang 界面 */}
                  {openuiPart && (
                    <div className="mt-5 space-y-4">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                          <span>OpenUI 动态仪表盘</span>
                          {isStreaming && (
                            <span className="text-[10px] text-blue-500 font-normal lowercase flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping"></span>
                              streaming...
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-emerald-600 font-normal lowercase">
                          powered by Vercel AI SDK
                        </span>
                      </div>

                      <OpenUIRenderer
                        content={openuiPart}
                        isStreaming={isStreaming}
                        onAction={(actionPrompt) => {
                          append({ role: "user", content: actionPrompt });
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}

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
                  : "例如：从数据库分析各渠道 CAC 和投产比，或输出销售代表胜率排名..."
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
