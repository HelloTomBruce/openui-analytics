"use client";

import React from "react";
import { X, Code2 } from "lucide-react";
import { OpenUIRenderer } from "@/components/OpenUIRenderer";

interface DevToolsPanelProps {
  code: string;
  onCodeChange: (code: string) => void;
  onAction: (msg: string) => void;
  onClose: () => void;
}

export function DevToolsPanel({ code, onCodeChange, onAction, onClose }: DevToolsPanelProps) {
  return (
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
            onClick={onClose}
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
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
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
              content={code}
              isStreaming={false}
              onAction={onAction}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
