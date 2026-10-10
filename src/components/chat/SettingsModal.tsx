"use client";

import React from "react";
import { X, Sliders, Key, Globe, Bot } from "lucide-react";

interface SettingsModalProps {
  apiKey: string;
  baseURL: string;
  model: string;
  gitlabToken: string;
  gitlabUrl: string;
  onApiKeyChange: (v: string) => void;
  onBaseURLChange: (v: string) => void;
  onModelChange: (v: string) => void;
  onGitlabTokenChange: (v: string) => void;
  onGitlabUrlChange: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function SettingsModal({
  apiKey,
  baseURL,
  model,
  gitlabToken,
  gitlabUrl,
  onApiKeyChange,
  onBaseURLChange,
  onModelChange,
  onGitlabTokenChange,
  onGitlabUrlChange,
  onSave,
  onClose,
}: SettingsModalProps) {
  return (
    <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-blue-500" />
            <h3 className="font-bold text-sm">自定义大模型配置</h3>
          </div>
          <button
            onClick={onClose}
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
              onChange={(e) => onApiKeyChange(e.target.value)}
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
              onChange={(e) => onBaseURLChange(e.target.value)}
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
              onChange={(e) => onModelChange(e.target.value)}
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
                  onChange={(e) => onGitlabUrlChange(e.target.value)}
                  placeholder="http://127.0.0.1:5002/mcp"
                  className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1 font-medium">GitLab Private Token / Access Token</label>
                <input
                  type="password"
                  value={gitlabToken}
                  onChange={(e) => onGitlabTokenChange(e.target.value)}
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
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs hover:bg-slate-100"
          >
            取消
          </button>
          <button
            onClick={onSave}
            className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 shadow-xs"
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
}
