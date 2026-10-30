"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Message } from "@ai-sdk/react";
import { ArrowDown, ArrowUp, Loader2, Sparkles, FileCode, Printer, Star } from "lucide-react";
import { OpenUIRenderer } from "@/components/OpenUIRenderer";
import { extractOpenUI } from "@/lib/extractOpenUI";
import { toast } from "@/lib/toast";
import type { FavoriteDashboardInput, FavoriteResult } from "@/hooks/useDashboards";

export interface ToolInvocationState {
  state: "call" | "result" | "partial-call";
  toolCallId: string;
  toolName: string;
  args?: { sql?: string; [key: string]: unknown };
  result?: unknown;
}

interface MessageItemProps {
  msg: Message;
  isStreaming: boolean;
  showRawLang: boolean;
  /** 当前会话启用源（工具调用归因展示）；memo 靠引用稳定，由父层 useMemo 供给 */
  activeSources?: { id: string; name: string }[];
  onRendererAction: (actionPrompt: string) => void;
  /** 打印导出：目标消息标记与触发回调（见 MessageList 打印状态机） */
  isPrintTarget?: boolean;
  onPrintDashboard?: (id: string) => void;
  /** 看板收藏：该消息是否已收藏（按 origin.messageId 判定）与收藏触发 */
  isFavorited?: boolean;
  isFavoritePending?: boolean;
  onFavoriteDashboard?: (messageId: string) => void;
}

/** 工具调用徽标：按 <id>_ 前缀归因到源名称，未匹配走通用兜底 */
function toolBadgeText(
  toolName: string,
  args: Record<string, unknown> | undefined,
  activeSources?: { id: string; name: string }[]
): string {
  const dyn = activeSources?.find((s) => toolName.startsWith(`${s.id}_`));
  if (dyn) {
    return toolName.endsWith("execute_sql")
      ? `⚡ [${dyn.name}] 执行 SQL: ${args?.sql || ""}`
      : `⚡ [${dyn.name}] 调用: ${toolName}`;
  }
  return `⚡ [MCP Tool] 调用: ${toolName}`;
}

/**
 * 单条消息（memo 化）。流式期间仅最后一条消息的 content 变化，
 * 历史消息跳过重渲染与 openui DSL 的重复 AST 解析。
 */
const MessageItem = React.memo(function MessageItem({
  msg,
  isStreaming,
  showRawLang,
  activeSources,
  onRendererAction,
  isPrintTarget = false,
  onPrintDashboard,
  isFavorited = false,
  isFavoritePending = false,
  onFavoriteDashboard,
}: MessageItemProps) {
  const rawContent = msg.content;
  // 提取 openui 代码块（仅 ```openui 与裸围栏进渲染器，sql/json 等留在正文）
  const { textPart, openuiPart } = useMemo(() => extractOpenUI(rawContent), [rawContent]);

  // SAFETY: AI SDK v4 的 Message 类型不含 toolInvocations，但运行时（data stream v1）会附加该字段；此处仅做可选读取，缺省降级为空数组。
  const toolInvocations =
    (msg as unknown as { toolInvocations?: ToolInvocationState[] }).toolInvocations || [];

  return (
    <div
      className={`print-message flex flex-col ${
        msg.role === "user" ? "items-end" : "items-start"
      }${isPrintTarget ? " print-target" : ""}`}
    >
      <div
        className={`max-w-4xl rounded-2xl p-4 text-sm ${
          msg.role === "user"
            ? "bg-blue-600 text-white rounded-br-xs"
            : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-xs w-full shadow-xs"
        }`}
      >
        {/* 工具调用指示器（执行步骤不进入打印导出） */}
        {toolInvocations.length > 0 && (
          <div className="no-print space-y-2 mb-3">
            {toolInvocations.map((tool, idx: number) => {
              const isRunning = tool.state !== "result";
              return (
                <div
                  key={tool.toolCallId || idx}
                  className={`flex items-center gap-2 text-xs px-3 py-2.5 rounded-lg border transition-all ${
                    isRunning
                      ? "text-blue-700 dark:text-blue-300 bg-blue-50/80 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800 animate-pulse"
                      : "text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800"
                  }`}
                >
                  <Loader2 className={`w-3.5 h-3.5 ${isRunning ? "animate-spin text-blue-500" : "text-emerald-500"}`} />
                  <span className="font-mono flex-1 truncate">
                    {toolBadgeText(tool.toolName, tool.args, activeSources)}
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
          <div className="no-print leading-relaxed whitespace-pre-wrap">
            {textPart}
            {isStreaming && !openuiPart && (
              <span className="inline-block w-1.5 h-3.5 bg-blue-500 animate-pulse ml-1 align-middle rounded-xs" />
            )}
          </div>
        )}

        {/* 原始 OpenUI Lang 源代码展示 */}
        {showRawLang && openuiPart && (
          <div className="no-print mt-3 bg-blue-950/20 text-blue-900 dark:text-blue-200 p-3 rounded-lg text-xs font-mono overflow-x-auto border border-blue-200 dark:border-blue-900">
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
            <div className="no-print flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider">
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
              <div className="flex items-center gap-0.5">
                {onFavoriteDashboard && (
                  <button
                    type="button"
                    onClick={() => onFavoriteDashboard(msg.id)}
                    disabled={isStreaming || isFavoritePending}
                    aria-label={
                      isFavorited
                        ? "已收藏，点击覆盖更新"
                        : `收藏看板（消息 ${msg.id}）`
                    }
                    title={
                      isFavorited
                        ? "已收藏，点击覆盖更新为最新看板"
                        : "收藏到看板库"
                    }
                    className={`flex items-center gap-1 text-[10px] normal-case tracking-normal px-1.5 py-0.5 rounded transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                      isFavorited
                        ? "text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/50"
                        : "text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/50"
                    }`}
                  >
                    {isFavoritePending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Star
                        className={`w-3 h-3 ${isFavorited ? "fill-current" : ""}`}
                      />
                    )}
                    <span>{isFavorited ? "已收藏" : "收藏"}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onPrintDashboard?.(msg.id)}
                  disabled={isStreaming}
                  aria-label={`导出 PDF（消息 ${msg.id}）`}
                  title="打印看板，可在打印对话框中另存为 PDF"
                  className="flex items-center gap-1 text-[10px] normal-case tracking-normal text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 px-1.5 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-950/50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  <Printer className="w-3 h-3" />
                  <span>导出 PDF</span>
                </button>
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
});

interface MessageListProps {
  messages: Message[];
  /** useChat 状态：submitted | streaming | ready | error */
  status: string;
  error: Error | undefined;
  showRawLang: boolean;
  /** 当前会话启用的数据源（加载提示与工具归因），由父层 useMemo 供给 */
  activeSources?: { id: string; name: string }[];
  onRendererAction: (actionPrompt: string) => void;
  onReload: () => void;
  /** 看板收藏：已收藏消息 id 集合（按收藏记录 origin.messageId 判定） */
  favoritedMessageIds?: Set<string>;
  /** 收藏回调：MessageList 组装 dsl/prompt/sourceNames/origin.messageId，sessionId 由上层补齐 */
  onFavoriteDashboard?: (
    input: FavoriteDashboardInput
  ) => Promise<FavoriteResult>;
}

/** 距顶/底多远以内视为「已在顶/底」（阈值像素） */
const SCROLL_EDGE_THRESHOLD = 120;

export function MessageList({
  messages,
  status,
  error,
  showRawLang,
  activeSources,
  onRendererAction,
  onReload,
  favoritedMessageIds,
  onFavoriteDashboard,
}: MessageListProps) {
  // isLoading 与 status 同源，内部派生避免双重传参
  const isLoading = status === "submitted" || status === "streaming";

  // 快捷滚动：右侧悬浮「回到顶部/回到底部」，仅在离开对应边缘时出现
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(true);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtTop(el.scrollTop <= SCROLL_EDGE_THRESHOLD);
    setAtBottom(distanceFromBottom <= SCROLL_EDGE_THRESHOLD);
  }, []);

  // 挂载后校准一次（恢复历史长会话时初始位置可能不在底部）
  useEffect(() => {
    updateScrollState();
  }, [updateScrollState]);

  const scrollToEdge = useCallback((top: number) => {
    scrollRef.current?.scrollTo({ top, behavior: "smooth" });
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) scrollToEdge(el.scrollHeight);
  }, [scrollToEdge]);

  /**
   * 看板打印状态机：标记目标消息 → body 加 print-mode → 下一帧 window.print()
   * （等 React 渲染出 print-target）→ afterprint（含取消）清理标记还原页面。
   */
  const [printTargetId, setPrintTargetId] = useState<string | null>(null);

  const handlePrintDashboard = useCallback((id: string) => {
    setPrintTargetId(id);
  }, []);

  /**
   * 看板收藏：按消息组装收藏载荷（dsl 提取自消息内容；prompt 取该消息之前
   * 最近一条用户提问；sourceNames 归档当前启用源名称；origin.messageId 用于
   * 重复收藏覆盖判定）。结果 toast：新收藏/覆盖更新/失败（含 413 等服务端错误）。
   */
  const [pendingFavoriteId, setPendingFavoriteId] = useState<string | null>(null);

  const handleFavoriteDashboard = useCallback(
    async (msgId: string) => {
      if (!onFavoriteDashboard) return;
      const idx = messages.findIndex((m) => m.id === msgId);
      if (idx < 0) return;
      const { openuiPart } = extractOpenUI(messages[idx].content);
      if (!openuiPart) return;

      // 向前找最近一条用户提问作为「重新分析」种子
      let prompt: string | undefined;
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          prompt = messages[i].content;
          break;
        }
      }

      const wasFavorited = favoritedMessageIds?.has(msgId) ?? false;
      setPendingFavoriteId(msgId);
      try {
        const res = await onFavoriteDashboard({
          dsl: openuiPart,
          prompt,
          sourceNames: activeSources?.map((s) => s.name),
          origin: { messageId: msgId },
        });
        if (res.ok) {
          toast(wasFavorited ? "收藏已更新" : "已收藏到看板库", "success");
        } else {
          toast(res.error || "收藏失败", "error");
        }
      } finally {
        setPendingFavoriteId(null);
      }
    },
    [messages, onFavoriteDashboard, favoritedMessageIds, activeSources]
  );

  useEffect(() => {
    if (!printTargetId) return;
    document.body.classList.add("print-mode");
    const restore = () => {
      document.body.classList.remove("print-mode");
      setPrintTargetId(null);
    };
    window.addEventListener("afterprint", restore);
    const raf = requestAnimationFrame(() => window.print());
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("afterprint", restore);
      document.body.classList.remove("print-mode");
    };
  }, [printTargetId]);

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        data-scroll-container=""
        className="h-full overflow-y-auto p-6 space-y-6"
      >
      {messages.map((msg, index) => (
        <MessageItem
          key={msg.id || `msg-${index}`}
          msg={msg}
          isStreaming={index === messages.length - 1 && status === "streaming"}
          showRawLang={showRawLang}
          activeSources={activeSources}
          onRendererAction={onRendererAction}
          isPrintTarget={printTargetId === msg.id}
          onPrintDashboard={handlePrintDashboard}
          isFavorited={favoritedMessageIds?.has(msg.id) ?? false}
          isFavoritePending={pendingFavoriteId === msg.id}
          onFavoriteDashboard={
            onFavoriteDashboard ? handleFavoriteDashboard : undefined
          }
        />
      ))}

      {/* 当用户刚发出消息，大模型尚在准备第一阶段响应时的全局 Thinking Loading 卡片 */}
      {isLoading && messages[messages.length - 1]?.role === "user" && (
        <div className="flex flex-col items-start">
          <div className="max-w-4xl rounded-2xl p-4 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-xs w-full shadow-xs space-y-3">
            <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 font-medium">
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              <span>
                {activeSources && activeSources.length > 0
                  ? `AI 正在分析意图并连接 ${activeSources
                      .map((s) => s.name)
                      .join(" / ")} 数据源...`
                  : "AI 正在分析意图并连接已启用的数据源..."}
              </span>
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

      {/* 右侧快捷滚动操作：仅离开对应边缘时出现对应按钮（不进入打印导出） */}
      {(!atTop || !atBottom) && (
        <div className="no-print absolute right-4 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-2">
          {!atTop && (
            <button
              onClick={() => scrollToEdge(0)}
              aria-label="回到顶部"
              title="回到顶部"
              className="w-7 h-7 rounded-full flex items-center justify-center bg-white/80 dark:bg-slate-900/80 backdrop-blur border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 shadow-md transition-colors"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
          )}
          {!atBottom && (
            <button
              onClick={scrollToBottom}
              aria-label="回到底部"
              title="回到底部（最新消息）"
              className="w-7 h-7 rounded-full flex items-center justify-center bg-white/80 dark:bg-slate-900/80 backdrop-blur border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 shadow-md transition-colors"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
