"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import type { FileSourceManifest } from "@openui-analytics/datasources";
import { authHeaders } from "@/lib/auth";
import { useDatasourceList } from "./useDatasources";

/** 模块级 fetch：effect 与上传后复用；失败静默为 null（面板显示「尚未上传」） */
async function fetchManifest(
  sourceId: string
): Promise<FileSourceManifest | null> {
  try {
    const res = await fetch(`/api/datasources/${sourceId}/file`, {
      headers: { ...authHeaders() },
    });
    const body = (await res.json()) as {
      manifest?: FileSourceManifest | null;
    };
    return body.manifest ?? null;
  } catch {
    return null;
  }
}

/**
 * 文件源上传面板：manifest 展示 + CSV/Excel 上传（完全覆盖语义）。
 * 注意上传请求不能带 Content-Type: application/json，
 * multipart boundary 由 fetch 自动设置，仅透传鉴权头。
 */
export function FileSourcePanel({ sourceId }: { sourceId: string }) {
  // 上传成功后经 hook 广播刷新列表健康状态（与同面板其它变更同语义）
  const { refresh } = useDatasourceList();
  const [manifest, setManifest] = useState<FileSourceManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 初始加载：setState 只发生在 promise 回调中（与 useDatasourceList 同模式）
  useEffect(() => {
    let cancelled = false;
    fetchManifest(sourceId).then((m) => {
      if (cancelled) return;
      setManifest(m);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setUploading(true);
      setError(null);
      try {
        const form = new FormData();
        for (const f of list) form.append("files", f);
        const res = await fetch(`/api/datasources/${sourceId}/file`, {
          method: "POST",
          headers: { ...authHeaders() },
          body: form,
        });
        const body = (await res.json().catch(() => null)) as {
          manifest?: FileSourceManifest;
          error?: string;
        } | null;
        if (res.status === 201 && body?.manifest) {
          setManifest(body.manifest);
          void refresh();
        } else {
          setError(body?.error ?? `上传失败（HTTP ${res.status}）`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "上传失败");
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [sourceId, refresh]
  );

  return (
    <div className="space-y-2">
      {/* 已灌表清单 */}
      {loading ? (
        <div className="text-[10px] text-slate-400 flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>读取文件清单…</span>
        </div>
      ) : manifest && manifest.tables.length > 0 ? (
        <div className="space-y-1">
          {manifest.tables.map((t) => (
            <div
              key={t.table}
              className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400"
            >
              <FileSpreadsheet className="w-3 h-3 shrink-0 text-emerald-600" />
              <span className="font-mono font-medium text-slate-600 dark:text-slate-300">
                {t.table}
              </span>
              <span>
                {t.rowCount} 行 · {t.columns.length} 列
                {t.sheet ? ` · sheet「${t.sheet}」` : ""}
              </span>
            </div>
          ))}
          <div className="text-[10px] text-slate-400">
            {manifest.files.map((f) => f.name).join("、")} ·{" "}
            {new Date(manifest.ingestedAt).toLocaleString()}
          </div>
        </div>
      ) : (
        <div className="text-[10px] text-slate-400">尚未上传文件</div>
      )}

      {/* 上传区（点击选择或拖入） */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`上传文件到 ${sourceId}`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void upload(e.dataTransfer.files);
        }}
        className={`flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed text-[10px] transition-colors cursor-pointer ${
          dragOver
            ? "border-blue-400 bg-blue-50 dark:bg-blue-950/40 text-blue-600"
            : "border-slate-300 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/50"
        }`}
      >
        {uploading ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>上传并灌库中…</span>
          </>
        ) : (
          <>
            <Upload className="w-3 h-3" />
            <span>
              {manifest ? "重新上传（将完全覆盖现有表）" : "上传 .csv / .xlsx（≤50MB）"}
            </span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
          }}
        />
      </div>

      {error && (
        <div className="text-[10px] text-rose-600 dark:text-rose-400">
          · {error}
        </div>
      )}
    </div>
  );
}
