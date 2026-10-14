"use client";

import React, { useState } from "react";
import { Database, Loader2, Pencil, Plus, Power, Trash2 } from "lucide-react";
import type { DataSourceDescriptor } from "@/mcp/registry";
import { useDatasources } from "./useDatasources";

type SourceKind = "http-mcp" | "db" | "stdio-cli";

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
  command: string;
  /** 空格分隔的参数原文，提交时解析为数组 */
  argsRaw: string;
}

const CLOSED_FORM: null = null;

function kindBadge(source: DataSourceDescriptor): string {
  if (source.kind === "stdio-cli") return "本地 CLI";
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

export function DatasourceSettings() {
  const { sources, health, loading, refreshing, createSource, updateSource, removeSource } =
    useDatasources();
  const [form, setForm] = useState<FormState | typeof CLOSED_FORM>(CLOSED_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  /** 行内操作 pending：启停/删除涉及 PATCH + 全量探活刷新，秒级耗时必须有反馈 */
  const [pending, setPending] = useState<{
    id: string;
    action: "toggle" | "delete";
  } | null>(null);

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
      command: "",
      argsRaw: "",
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
      command: s.kind === "stdio-cli" ? (s.command ?? "") : "",
      argsRaw: "",
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
      } else if (form.kind === "db") {
        body.dbType = form.dbType;
        body.connectionString = form.connectionString.trim();
      } else {
        body.command = form.command.trim();
        body.args = form.argsRaw.split(/\s+/).filter(Boolean);
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
    } else if (form.kind === "db") {
      if (form.connectionString.trim())
        patch.connectionString = form.connectionString.trim();
    } else {
      // stdio：命令非机密总是提交；参数留空 = 不更新
      patch.command = form.command.trim();
      if (form.argsRaw.trim()) patch.args = form.argsRaw.split(/\s+/).filter(Boolean);
    }
    const result = await updateSource(form.id, patch);
    if (result.ok) closeForm();
    else setErrors(result.errors ?? ["更新失败"]);
  };

  const toggleEnabled = async (s: DataSourceDescriptor) => {
    setPending({ id: s.id, action: "toggle" });
    try {
      await updateSource(s.id, { enabled: !(s.enabled !== false) });
    } finally {
      setPending(null);
    }
  };

  const remove = async (id: string) => {
    setPending({ id, action: "delete" });
    try {
      await removeSource(id);
    } finally {
      setPending(null);
    }
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
        {refreshing && sources.length > 0 && (
          <div className="text-[10px] text-slate-400 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>正在检查数据源健康状态…</span>
          </div>
        )}
        {sources.map((s) => {
          const h = health[s.id];
          const enabled = s.enabled !== false;
          const busy = pending?.id === s.id;
          const busyToggle = busy && pending.action === "toggle";
          const busyDelete = busy && pending.action === "delete";
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
                {(
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
                  disabled={busy}
                  aria-busy={busyToggle}
                  aria-label={`启停 ${s.id}`}
                  title={enabled ? "点击停用" : "点击启用"}
                  className={`p-1 rounded transition-colors ${
                    enabled
                      ? "text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                      : "text-slate-300 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  {busyToggle ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Power className="w-3.5 h-3.5" />
                  )}
                </button>
                {(
                  <>
                    <button
                      onClick={() => openEdit(s)}
                      disabled={busy}
                      aria-label={`编辑 ${s.id}`}
                      className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                      title="编辑"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => void remove(s.id)}
                      disabled={busy}
                      aria-busy={busyDelete}
                      aria-label={`删除 ${s.id}`}
                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                      title="删除"
                    >
                      {busyDelete ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </>
                )}
              </div>

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
              <div>
                <label htmlFor="ds-kind-stdio" className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    id="ds-kind-stdio"
                    type="radio"
                    name="ds-kind"
                    checked={form.kind === "stdio-cli"}
                    onChange={() => setForm({ ...form, kind: "stdio-cli" })}
                  />
                  <span>本地 CLI</span>
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

          {form.kind === "stdio-cli" && (
            <>
              <div>
                <label htmlFor="ds-command" className={labelClass}>
                  命令
                </label>
                <input
                  id="ds-command"
                  type="text"
                  value={form.command}
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                  placeholder="zentao"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="ds-args" className={labelClass}>
                  参数（空格分隔，编辑留空表示不变）
                </label>
                <input
                  id="ds-args"
                  type="text"
                  value={form.argsRaw}
                  onChange={(e) => setForm({ ...form, argsRaw: e.target.value })}
                  placeholder="mcp --read-only"
                  className={inputClass}
                />
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
