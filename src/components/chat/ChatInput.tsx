"use client";

import React from "react";
import { Send, Loader2, ClipboardList } from "lucide-react";

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  /** Plan-first：新问题先出分析思路供确认（默认关） */
  planMode: boolean;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onPlanModeChange: (next: boolean) => void;
}

/** 自适应高度上限：约 6 行（24px 行高 + 余量），超出后内滚 */
const TEXTAREA_MAX_HEIGHT = 160;

export function ChatInput({
  input,
  isLoading,
  planMode,
  onChange,
  onSubmit,
  onPlanModeChange,
}: ChatInputProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // 受控值变化（输入/清空/预设带入）后重算高度：先归零再取 scrollHeight 才会收缩
  const resize = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  }, []);

  React.useEffect(() => {
    resize();
  }, [input, resize]);

  // Enter 发送 / Shift+Enter 换行；中文输入法组词期间的 Enter（isComposing）不触发发送
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      !isLoading &&
      input.trim()
    ) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div className="no-print p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
      <form onSubmit={onSubmit} className="max-w-4xl mx-auto">
        {/* 输入框容器：边框/聚焦环在容器上，内部为 textarea + 底部工具行 */}
        <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            placeholder={
              isLoading
                ? "Vercel AI SDK 正在流式推理并调用 MCP 查询..."
                : planMode
                  ? "先出思路模式：AI 将先探查数据结构并给出分析思路与澄清问题，确认后再产出看板...（Enter 发送，Shift+Enter 换行）"
                  : "例如：从数据库分析各渠道 CAC，输出响应式预算试算器与落地行动建议...（Enter 发送，Shift+Enter 换行）"
            }
            disabled={isLoading}
            className="w-full bg-transparent px-4 pt-3.5 pb-1 text-sm leading-6 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none resize-none disabled:opacity-50 overflow-y-auto"
            style={{ maxHeight: TEXTAREA_MAX_HEIGHT }}
          />
          {/* 底部工具行：左「先出思路」无边框开关，右发送按钮 */}
          <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
            <button
              type="button"
              aria-pressed={planMode}
              onClick={() => onPlanModeChange(!planMode)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors select-none cursor-pointer ${
                planMode
                  ? "bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300"
                  : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
              }`}
              title="开启后，新问题将先探查数据结构并给出分析思路与澄清问题，确认方向后再产出看板"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>先出思路</span>
            </button>
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-xs"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>发送</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
