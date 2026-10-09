"use client";

import React from "react";
import { Target, CheckCircle2, AlertCircle } from "lucide-react";

export interface GaugeProgressProps {
  title?: string;
  description?: string;
  current: number | string;
  target: number | string;
  unit?: string;
  subtext?: string;
}

export const GaugeProgress: React.FC<GaugeProgressProps> = ({
  title,
  description,
  current = 0,
  target = 100,
  unit = "",
  subtext,
}) => {
  const numCurrent = typeof current === "number" ? current : Number(current) || 0;
  const numTarget = typeof target === "number" ? target : Number(target) || 100;

  const percentage = numTarget > 0 ? Math.min(Math.round((numCurrent / numTarget) * 100), 200) : 0;
  const isCompleted = percentage >= 100;
  const isWarning = percentage < 60;

  const strokeColor = isCompleted
    ? "#10b981" // emerald
    : isWarning
    ? "#f59e0b" // amber
    : "#3b82f6"; // blue

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
      <div className="flex items-center justify-between mb-3">
        <div>
          {title && (
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Target className="w-4 h-4 text-blue-500" />
              <span>{title}</span>
            </h3>
          )}
          {description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {description}
            </p>
          )}
        </div>
        <div
          className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
            isCompleted
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
              : isWarning
              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
              : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
          }`}
        >
          {isCompleted ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5" />
          )}
          <span>{isCompleted ? "已达成" : `完成度 ${percentage}%`}</span>
        </div>
      </div>

      <div className="space-y-2 mt-4">
        <div className="flex justify-between items-baseline text-xs">
          <span className="text-slate-500 dark:text-slate-400 font-medium">
            当前进度
          </span>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono">
              {numCurrent.toLocaleString()}
            </span>
            <span className="text-xs text-slate-400">
              / {numTarget.toLocaleString()} {unit}
            </span>
          </div>
        </div>

        {/* 进度条 */}
        <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden p-0.5">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(percentage, 100)}%`,
              backgroundColor: strokeColor,
            }}
          />
        </div>

        <div className="flex justify-between items-center text-[11px] text-slate-400 pt-1">
          <span>
            {numCurrent >= numTarget
              ? `超额完成 ${(numCurrent - numTarget).toLocaleString()} ${unit}`
              : `距离目标还需 ${(numTarget - numCurrent).toLocaleString()} ${unit}`}
          </span>
          {subtext && <span className="font-medium text-slate-500">{subtext}</span>}
        </div>
      </div>
    </div>
  );
};
