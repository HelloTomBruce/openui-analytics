"use client";

import React from "react";
import type { Message } from "@ai-sdk/react";
import { Loader2, Sparkles, FileCode } from "lucide-react";
import { OpenUIRenderer } from "@/components/OpenUIRenderer";

export interface ToolInvocationState {
  state: "call" | "result" | "partial-call";
  toolCallId: string;
  toolName: string;
  args?: { sql?: string; [key: string]: unknown };
  result?: unknown;
}

interface MessageListProps {
  messages: Message[];
  status: string;
  isLoading: boolean;
  error: Error | undefined;
  showRawLang: boolean;
  onRendererAction: (actionPrompt: string) => void;
  onReload: () => void;
}

export function MessageList({
  messages,
  status,
  isLoading,
  error,
  showRawLang,
  onRendererAction,
  onReload,
}: MessageListProps) {
  return (
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
        // SAFETY: AI SDK v4 的 Message 类型不含 toolInvocations，但运行时（data stream v1）会附加该字段；此处仅做可选读取，缺省降级为空数组。
        const toolInvocations =
          (msg as unknown as { toolInvocations?: ToolInvocationState[] }).toolInvocations || [];

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
                    onAction={onRendererAction}
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
            onClick={onReload}
            className="px-2.5 py-1 bg-rose-100 dark:bg-rose-900 hover:bg-rose-200 rounded text-rose-800 dark:text-rose-200 font-medium transition-colors"
          >
            重试
          </button>
        </div>
      )}
    </div>
  );
}
