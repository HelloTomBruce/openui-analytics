"use client";

import React, { useState } from "react";
import { Database, Key, Pencil, Plus, Power, Trash2 } from "lucide-react";
import type { DataSourceDescriptor } from "@/mcp/registry";
import { useDatasources } from "./useDatasources";

interface DatasourceSettingsProps {
  /** 内置 GitLab 源的透传配置（保持原「页面设置 → localStorage → 请求头」行为） */
  gitlabUrl: string;
  gitlabToken: string;
  onGitlabUrlChange: (v: string) => void;
  onGitlabTokenChange: (v: string) => void;
}

type SourceKind = "http-mcp" | "db";

interface FormState {
  mode: "create" | "edit";
  id: string;
  name: string;
  kind: SourceKind;
  url: string;
  token: string;
  dbType: "postgres" | "mysql";
  connectionString: string;
  hasExistingToken: boolean;
  /** 编辑模式下展示脱敏预览（真实凭证永不回填表单） */
  urlPreview: string;
  connPreview: string;
}

const CLOSED_FORM: null = null;

function kindBadge(source: DataSourceDescriptor): string {
  if (source.kind === "db") {
    return source.dbType === "mysql" ? "MySQL" : "PostgreSQL";
  }
  return "HTTP MCP";
}

function badgeClass(source: DataSourceDescriptor): string {
  if (source.kind === "db") {
    return "bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300";
  }
  return "bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300";
}

export function DatasourceSettings({
  gitlabUrl,
  gitlabToken,
  onGitlabUrlChange,
  onGitlabTokenChange,
}: DatasourceSettingsProps) {
  const { sources, health, loading, createSource, updateSource, removeSource } =
    useDatasources();
  const [form, setForm] = useState<FormState | typeof CLOSED_FORM>(CLOSED_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [gitlabExpanded, setGitlabExpanded] = useState(false);

  const openCreate = () => {
    setErrors([]);
    setForm({
      mode: "create",
      id: "",
      name: "",
      kind: "http-mcp",
      url: "",
      token: "",
      dbType: "postgres",
      connectionString: "",
      hasExistingToken: false,
      urlPreview: "",
      connPreview: "",
    });
  };

  const openEdit = (s: DataSourceDescriptor) => {
    setErrors([]);
    setForm({
      mode: "edit",
      id: s.id,
      name: s.name,
      kind: s.kind === "db" ? "db" : "http-mcp",
      url: "",
      token: "",
      dbType: s.dbType ?? "postgres",
      connectionString: "",
      hasExistingToken: Boolean(s.hasToken),
      // 脱敏值仅作 placeholder 展示；若回填表单并在提交时发送，会把 *** 写成真实凭证
      urlPreview: s.kind === "http-mcp" ? (s.maskedUrl ?? "") : "",
      connPreview: s.kind === "db" ? (s.maskedConnectionString ?? "") : "",
    });
  };

  const closeForm = () => {
    setForm(CLOSED_FORM);
    setErrors([]);
  };

  const submit = async () => {
    if (!form) return;
    if (form.mode === "create") {
      const body: Record<string, unknown> = {
        id: form.id.trim(),
        name: form.name.trim(),
        kind: form.kind,
      };
      if (form.kind === "http-mcp") {
        body.url = form.url.trim();
        if (form.token.trim()) body.token = form.token.trim();
      } else {
        body.dbType = form.dbType;
        body.connectionString = form.connectionString.trim();
      }
      const result = await createSource(body);
      if (result.ok) closeForm();
      else setErrors(result.errors ?? ["创建失败"]);
      return;
    }
    // 编辑：token/url/connectionString 留空 = 不更新（不发送字段），脱敏值绝不作为新值提交
    const patch: Record<string, unknown> = { name: form.name.trim() };
    if (form.kind === "http-mcp") {
      if (form.url.trim()) patch.url = form.url.trim();
      if (form.token.trim()) patch.token = form.token.trim();
    } else {
      if (form.connectionString.trim())
        patch.connectionString = form.connectionString.trim();
    }
    const result = await updateSource(form.id, patch);
    if (result.ok) closeForm();
    else setErrors(result.errors ?? ["更新失败"]);
  };

  const toggleEnabled = async (s: DataSourceDescriptor) => {
    await updateSource(s.id, { enabled: !(s.enabled !== false) });
  };

  const inputClass =
    "w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono";
  const labelClass = "block text-slate-500 mb-1 font-medium";

  return (
    <div className="space-y-4 text-xs">
      {/* 源列表 */}
      <div className="space-y-2">
        {loading && sources.length === 0 && (
          <div className="text-[11px] text-slate-400">加载中...</div>
        )}
        {sources.map((s) => {
          const h = health[s.id];
          const enabled = s.enabled !== false;
          return (
            <div
              key={s.id}
              className="border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 space-y-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    h === undefined
                      ? "bg-slate-300 dark:bg-slate-600"
                      : h.ok
                        ? "bg-emerald-500"
                        : "bg-rose-500"
                  }`}
                  title={h?.error || ""}
                />
                <span className="flex-1 truncate text-slate-600 dark:text-slate-300">
                  {s.name}
                </span>
                {!s.builtin && (
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-medium shrink-0 ${badgeClass(s)}`}
                  >
                    {kindBadge(s)}
                  </span>
                )}
                <span className="text-slate-400 font-mono text-[10px] shrink-0">
                  {h === undefined ? "..." : h.ok ? `${h.latencyMs}ms` : "异常"}
                </span>
                <button
                  onClick={() => void toggleEnabled(s)}
                  aria-label={`启停 ${s.id}`}
                  title={enabled ? "点击停用" : "点击启用"}
                  className={`p-1 rounded transition-colors ${
                    enabled
                      ? "text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                      : "text-slate-300 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                </button>
                {s.id === "gitlab-mcp" && (
                  <button
                    onClick={() => setGitlabExpanded((v) => !v)}
                    aria-label="配置 gitlab-mcp"
                    className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                    title="展开 GitLab 连接配置"
                  >
                    <Key className="w-3.5 h-3.5" />
                  </button>
                )}
                {!s.builtin && (
                  <>
                    <button
                      onClick={() => openEdit(s)}
                      aria-label={`编辑 ${s.id}`}
                      className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                      title="编辑"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => void removeSource(s.id)}
                      aria-label={`删除 ${s.id}`}
                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>

              {/* 内置 GitLab 透传配置（localStorage，保持原有行为） */}
              {s.id === "gitlab-mcp" && gitlabExpanded && (
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <label htmlFor="builtin-gitlab-url" className={labelClass}>
                      GitLab MCP Endpoint
                    </label>
                    <input
                      id="builtin-gitlab-url"
                      type="text"
                      value={gitlabUrl}
                      onChange={(e) => onGitlabUrlChange(e.target.value)}
                      placeholder="http://127.0.0.1:5002/mcp"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="builtin-gitlab-token" className={labelClass}>
                      GitLab Private Token / Access Token
                    </label>
                    <input
                      id="builtin-gitlab-token"
                      type="password"
                      value={gitlabToken}
                      onChange={(e) => onGitlabTokenChange(e.target.value)}
                      placeholder="glpat-..."
                      className={inputClass}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 添加按钮 / 表单 */}
      {!form && (
        <button
          onClick={openCreate}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>添加数据源</span>
        </button>
      )}

      {form && (
        <div className="space-y-3 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
          <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            {form.mode === "create" ? "添加数据源" : `编辑 ${form.id}`}
          </div>

          {form.mode === "create" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="ds-kind-http" className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    id="ds-kind-http"
                    type="radio"
                    name="ds-kind"
                    checked={form.kind === "http-mcp"}
                    onChange={() => setForm({ ...form, kind: "http-mcp" })}
                  />
                  <span>HTTP MCP</span>
                </label>
              </div>
              <div>
                <label htmlFor="ds-kind-db" className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    id="ds-kind-db"
                    type="radio"
                    name="ds-kind"
                    checked={form.kind === "db"}
                    onChange={() => setForm({ ...form, kind: "db" })}
                  />
                  <span>数据库连接</span>
                </label>
              </div>
            </div>
          )}

          {form.mode === "create" && (
            <div>
              <label htmlFor="ds-id" className={labelClass}>
                ID（小写字母开头，仅小写字母/数字/连字符）
              </label>
              <input
                id="ds-id"
                type="text"
                value={form.id}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
                placeholder="jira-mcp / mysql-orders"
                className={inputClass}
              />
            </div>
          )}

          <div>
            <label htmlFor="ds-name" className={labelClass}>
              名称
            </label>
            <input
              id="ds-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Jira MCP / 订单库"
              className={inputClass}
            />
          </div>

          {form.kind === "http-mcp" ? (
            <>
              <div>
                <label htmlFor="ds-url" className={labelClass}>
                  URL
                </label>
                <input
                  id="ds-url"
                  type="text"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder={
                    form.mode === "edit" && form.urlPreview
                      ? `${form.urlPreview}（留空保持不变）`
                      : "http://127.0.0.1:6000/mcp"
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="ds-token" className={labelClass}>
                  Token（可选，Bearer）
                </label>
                <input
                  id="ds-token"
                  type="password"
                  value={form.token}
                  onChange={(e) => setForm({ ...form, token: e.target.value })}
                  placeholder={
                    form.mode === "edit" && form.hasExistingToken
                      ? "留空保持不变"
                      : "可选"
                  }
                  className={inputClass}
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label htmlFor="ds-dbtype" className={labelClass}>
                  数据库类型
                </label>
                <select
                  id="ds-dbtype"
                  value={form.dbType}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      dbType: e.target.value as "postgres" | "mysql",
                    })
                  }
                  className={inputClass}
                >
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                </select>
              </div>
              <div>
                <label htmlFor="ds-conn" className={labelClass}>
                  连接串（URL 形式，强制只读查询）
                </label>
                <input
                  id="ds-conn"
                  type="password"
                  value={form.connectionString}
                  onChange={(e) =>
                    setForm({ ...form, connectionString: e.target.value })
                  }
                  placeholder={
                    form.mode === "edit" && form.connPreview
                      ? `${form.connPreview}（留空保持不变）`
                      : "mysql://user:pass@host:3306/db"
                  }
                  className={inputClass}
                />
              </div>
              <div className="text-[10px] text-slate-400 flex items-center gap-1">
                <Database className="w-3 h-3" />
                <span>数据库源仅允许只读 SELECT，自动行数封顶与超时保护</span>
              </div>
            </>
          )}

          {errors.length > 0 && (
            <div className="text-[11px] text-rose-600 dark:text-rose-400 space-y-1">
              {errors.map((e) => (
                <div key={e}>· {e}</div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={closeForm}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs hover:bg-slate-100"
            >
              取消
            </button>
            <button
              onClick={() => void submit()}
              className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 shadow-xs"
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
