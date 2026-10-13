"use client";

import React, { useEffect, useState } from "react";
import { X, Sliders, Key, Globe, Bot, Database } from "lucide-react";
import type { DataSourceDescriptor, HealthResult } from "@/mcp/registry";
import { authHeaders } from "@/lib/auth";

interface DataSourcesResponse {
  sources: DataSourceDescriptor[];
  health: Record<string, HealthResult>;
}

async function loadDataSources(): Promise<DataSourcesResponse | null> {
  try {
    // 透传页面设置中的 GitLab 配置，使探活与 /api/analyze 实际使用的配置一致。
    // 走自定义请求头而非 URL query，避免 token 进入访问日志/浏览器历史。
    const headers: Record<string, string> = { ...authHeaders() };
    if (typeof window !== "undefined") {
      const gitlabUrl = localStorage.getItem("openui_gitlab_url");
      const gitlabToken = localStorage.getItem("openui_gitlab_token");
      if (gitlabUrl) headers["x-gitlab-url"] = gitlabUrl;
      if (gitlabToken) headers["x-gitlab-token"] = gitlabToken;
    }
    const res = await fetch("/api/datasources", { headers });
    return (await res.json()) as DataSourcesResponse;
  } catch {
    return null;
  }
}

interface SettingsModalProps {
  apiKey: string;
  baseURL: string;
  model: string;
  gitlabToken: string;
  gitlabUrl: string;
  accessToken: string;
  temperature: string;
  onApiKeyChange: (v: string) => void;
  onBaseURLChange: (v: string) => void;
  onModelChange: (v: string) => void;
  onGitlabTokenChange: (v: string) => void;
  onGitlabUrlChange: (v: string) => void;
  onAccessTokenChange: (v: string) => void;
  onTemperatureChange: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
}

type SettingsTab = "model" | "datasources";

const SETTINGS_TABS: { id: SettingsTab; label: string; Icon: typeof Bot }[] = [
  { id: "model", label: "模型配置", Icon: Bot },
  { id: "datasources", label: "数据源", Icon: Database },
];

export function SettingsModal({
  apiKey,
  baseURL,
  model,
  gitlabToken,
  gitlabUrl,
  accessToken,
  temperature,
  onApiKeyChange,
  onBaseURLChange,
  onModelChange,
  onGitlabTokenChange,
  onGitlabUrlChange,
  onAccessTokenChange,
  onTemperatureChange,
  onSave,
  onClose,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("model");
  const [sources, setSources] = useState<DataSourceDescriptor[]>([]);
  const [health, setHealth] = useState<Record<string, HealthResult>>({});

  // 模态框由父组件条件渲染，挂载即「进入设置」，此时 lazy fetch 数据源状态
  useEffect(() => {
    let cancelled = false;
    loadDataSources().then((data) => {
      if (cancelled || !data) return;
      setSources(data.sources);
      setHealth(data.health);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ARIA tab 模式：左右方向键 / Home / End 在 tab 间移动并聚焦
  const handleTablistKeyDown = (e: React.KeyboardEvent) => {
    const order = SETTINGS_TABS.map((t) => t.id);
    const idx = order.indexOf(activeTab);
    let next: SettingsTab | undefined;
    if (e.key === "ArrowRight") next = order[(idx + 1) % order.length];
    else if (e.key === "ArrowLeft") next = order[(idx - 1 + order.length) % order.length];
    else if (e.key === "Home") next = order[0];
    else if (e.key === "End") next = order[order.length - 1];
    if (next) {
      e.preventDefault();
      setActiveTab(next);
      document.getElementById(`settings-tab-${next}`)?.focus();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-blue-500" />
            <h3 className="font-bold text-sm">设置</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭设置"
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          role="tablist"
          aria-label="设置分类"
          onKeyDown={handleTablistKeyDown}
          className="flex bg-slate-100 dark:bg-slate-800/70 p-1 rounded-lg text-xs font-medium"
        >
          {SETTINGS_TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={activeTab === id}
              aria-controls={`settings-panel-${id}`}
              tabIndex={activeTab === id ? 0 : -1}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all ${
                activeTab === id
                  ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs font-semibold"
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {activeTab === "model" && (
          <div
            role="tabpanel"
            id="settings-panel-model"
            aria-labelledby="settings-tab-model"
            className="space-y-3 text-xs"
          >
            <div>
              <label htmlFor="settings-api-key" className="block text-slate-500 mb-1 font-medium flex items-center gap-1">
                <Key className="w-3.5 h-3.5" />
                <span>API Key</span>
              </label>
              <input
                id="settings-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder="sk-..."
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
              />
            </div>

            <div>
              <label htmlFor="settings-base-url" className="block text-slate-500 mb-1 font-medium flex items-center gap-1">
                <Globe className="w-3.5 h-3.5" />
                <span>Base URL</span>
              </label>
              <input
                id="settings-base-url"
                type="text"
                value={baseURL}
                onChange={(e) => onBaseURLChange(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
              />
            </div>

            <div>
              <label htmlFor="settings-model" className="block text-slate-500 mb-1 font-medium flex items-center gap-1">
                <Bot className="w-3.5 h-3.5" />
                <span>Model</span>
              </label>
              <input
                id="settings-model"
                type="text"
                value={model}
                onChange={(e) => onModelChange(e.target.value)}
                placeholder="gpt-4o-mini / deepseek-chat"
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
              />
            </div>

            <div>
              <label htmlFor="settings-temperature" className="block text-slate-500 mb-1 font-medium flex items-center justify-between">
                <span>Temperature（0–2，数据分析建议 0.2）</span>
                <span className="font-mono text-slate-400">{temperature}</span>
              </label>
              <input
                id="settings-temperature"
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => onTemperatureChange(e.target.value)}
                className="w-full accent-blue-600"
              />
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <label htmlFor="settings-access-token" className="block text-slate-500 mb-1 font-medium flex items-center gap-1">
                <Key className="w-3.5 h-3.5" />
                <span>访问令牌（部署鉴权，可选）</span>
              </label>
              <input
                id="settings-access-token"
                type="password"
                value={accessToken}
                onChange={(e) => onAccessTokenChange(e.target.value)}
                placeholder="服务端配置 OPENUI_API_AUTH_TOKEN 时必填"
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
              />
            </div>
          </div>
        )}

        {activeTab === "datasources" && (
          <div
            role="tabpanel"
            id="settings-panel-datasources"
            aria-labelledby="settings-tab-datasources"
            className="space-y-4 text-xs"
          >
            <div>
              <div className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 mb-2">
                外部 GitLab MCP 配置
              </div>
              <div className="space-y-2">
                <div>
                  <label htmlFor="settings-gitlab-url" className="block text-slate-500 mb-1 font-medium">GitLab MCP Endpoint</label>
                  <input
                    id="settings-gitlab-url"
                    type="text"
                    value={gitlabUrl}
                    onChange={(e) => onGitlabUrlChange(e.target.value)}
                    placeholder="http://127.0.0.1:5002/mcp"
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="settings-gitlab-token" className="block text-slate-500 mb-1 font-medium">GitLab Private Token / Access Token</label>
                  <input
                    id="settings-gitlab-token"
                    type="password"
                    value={gitlabToken}
                    onChange={(e) => onGitlabTokenChange(e.target.value)}
                    placeholder="glpat-..."
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 mb-1 flex items-center justify-between">
                <span>本地 ZenTao (禅道) MCP</span>
                <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded font-normal">已自动挂载</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                通过本地 <code>zentao mcp --read-only</code> 自动连接已登录账号，支持项目进度、Bug 缺陷、任务工时与需求流转等多维统计。
              </p>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-2 flex items-center gap-1">
                <Database className="w-3.5 h-3.5" />
                <span>数据源状态</span>
              </div>
              <div className="space-y-1.5">
                {sources.length === 0 ? (
                  <div className="text-[11px] text-slate-400">加载中或不可用...</div>
                ) : (
                  sources.map((s) => {
                    const h = health[s.id];
                    return (
                      <div
                        key={s.id}
                        className="flex items-center gap-2 text-[11px]"
                        title={h?.error || s.tools.join(", ")}
                      >
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            h === undefined
                              ? "bg-slate-300 dark:bg-slate-600"
                              : h.ok
                                ? "bg-emerald-500"
                                : "bg-rose-500"
                          }`}
                        />
                        <span className="flex-1 truncate text-slate-600 dark:text-slate-300">
                          {s.name}
                        </span>
                        <span className="text-slate-400 font-mono">
                          {h === undefined ? "..." : h.ok ? `${h.latencyMs}ms` : "异常"}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

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
