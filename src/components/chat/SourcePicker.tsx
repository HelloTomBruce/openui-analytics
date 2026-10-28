"use client";

import React, { useState } from "react";
import { Database, Lock } from "lucide-react";

export interface PickerSource {
  id: string;
  name: string;
  enabled: boolean;
}

interface SourcePickerProps {
  /** 全量数据源列表（含禁用项，组件内部过滤） */
  sources: PickerSource[];
  /** 当前会话选中的源 id；undefined = 全选 */
  selected: string[] | undefined;
  onChange: (ids: string[]) => void;
  /** 会话开始后锁定：面板只读，仅可查看当前选择 */
  disabled?: boolean;
}

/**
 * 会话级数据源多选器：勾选集即 session.enabledSources，改动立即写回。
 */
export function SourcePicker({ sources, selected, onChange, disabled }: SourcePickerProps) {
  const [open, setOpen] = useState(false);
  const enabled = sources.filter((s) => s.enabled !== false);
  const enabledIds = enabled.map((s) => s.id);
  const checkedIds = selected ?? enabledIds;
  const checkedCount = enabledIds.filter((id) => checkedIds.includes(id)).length;

  const toggle = (id: string) => {
    if (disabled) return;
    if (checkedIds.includes(id)) {
      onChange(checkedIds.filter((x) => x !== id));
    } else {
      onChange(enabledIds.filter((x) => x === id || checkedIds.includes(x)));
    }
  };

  return (
    <div className="no-print px-4 pb-1 max-w-4xl mx-auto relative flex justify-end">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={
          disabled
            ? "会话已开始，数据源选择已锁定"
            : "选择当前会话可用的数据源"
        }
        className="text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        {disabled ? (
          <Lock className="w-3.5 h-3.5" />
        ) : (
          <Database className="w-3.5 h-3.5" />
        )}
        <span>
          数据源 {checkedCount}/{enabledIds.length}
        </span>
      </button>
      {open && (
        <div
          role="group"
          aria-label="数据源选择"
          className="absolute right-4 bottom-full mb-1 z-40 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg p-2 w-72 space-y-0.5"
        >
          {disabled && (
            <div className="text-[10px] text-slate-400 flex items-center gap-1 px-2 py-1.5 border-b border-slate-100 dark:border-slate-800 mb-1">
              <Lock className="w-3 h-3" />
              <span>会话已开始，数据源选择已锁定</span>
            </div>
          )}
          {enabled.length === 0 && (
            <div className="text-[11px] text-slate-400 px-2 py-1.5">
              暂无可用数据源，请在「设置 → 数据源」中启用
            </div>
          )}
          {enabled.map((s) => (
            <label
              key={s.id}
              className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <input
                type="checkbox"
                checked={checkedIds.includes(s.id)}
                onChange={() => toggle(s.id)}
                disabled={disabled}
                aria-label={s.name}
              />
              <span
                className={`truncate flex-1 ${
                  disabled ? "cursor-not-allowed text-slate-400" : ""
                }`}
              >
                {s.name}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
