"use client";

import React from "react";
import { Send, Loader2 } from "lucide-react";

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}

export function ChatInput({ input, isLoading, onChange, onSubmit }: ChatInputProps) {
  return (
    <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
      <form onSubmit={onSubmit} className="flex items-center gap-2 max-w-4xl mx-auto">
        <input
          type="text"
          value={input}
          onChange={onChange}
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
  );
}
