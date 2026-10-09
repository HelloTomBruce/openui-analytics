"use client";

import React from "react";
import { Filter, ArrowDown } from "lucide-react";

export interface FunnelStage {
  name: string;
  value: number;
  conversion?: string;
  subtext?: string;
}

export interface FunnelChartProps {
  title?: string;
  description?: string;
  stages: FunnelStage[];
  unit?: string;
}

const STAGE_COLORS = [
  "from-blue-600 to-blue-500",
  "from-indigo-600 to-indigo-500",
  "from-violet-600 to-violet-500",
  "from-purple-600 to-purple-500",
  "from-pink-600 to-pink-500",
  "from-rose-600 to-rose-500",
];

export const FunnelChart: React.FC<FunnelChartProps> = ({
  title,
  description,
  stages = [],
  unit = "",
}) => {
  // 安全容错：确保 stages 始终为有效数组
  let rawStages: unknown[] = [];
  if (Array.isArray(stages)) {
    rawStages = stages;
  } else if (typeof stages === "string") {
    try {
      const parsed = JSON.parse(stages);
      if (Array.isArray(parsed)) rawStages = parsed;
    } catch {
      rawStages = [];
    }
  }

  const safeStages: FunnelStage[] = rawStages
    .filter((s): s is Record<string, unknown> => s != null && typeof s === "object")
    .map((s) => ({
      name: String(s.name || s.label || s.stage || "阶段"),
      value: typeof s.value === "number" ? s.value : Number(s.value) || 0,
      conversion: s.conversion ? String(s.conversion) : undefined,
      subtext: s.subtext ? String(s.subtext) : undefined,
    }));

  if (safeStages.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs text-xs text-slate-400 text-center">
        暂无漏斗转化数据
      </div>
    );
  }

  const maxValue = Math.max(...safeStages.map((s) => s.value), 1);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
      {(title || description) && (
        <div className="mb-4">
          {title && (
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Filter className="w-4 h-4 text-blue-500" />
              <span>{title}</span>
            </h3>
          )}
          {description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {description}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2.5">
        {safeStages.map((stage, idx) => {
          const widthPercent = Math.max(Math.round((stage.value / maxValue) * 100), 12);
          const colorGradient = STAGE_COLORS[idx % STAGE_COLORS.length];
          const prevValue = idx > 0 ? safeStages[idx - 1].value : null;
          const dropOffRate = prevValue && prevValue > 0
            ? Math.round(((prevValue - stage.value) / prevValue) * 100)
            : 0;

          return (
            <div key={`stage-${idx}`} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center font-mono font-semibold text-[10px]">
                    {idx + 1}
                  </span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {stage.name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100 font-mono">
                    {stage.value.toLocaleString()} {unit}
                  </span>
                  {stage.conversion && (
                    <span className="text-[10px] bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-medium">
                      转化: {stage.conversion}
                    </span>
                  )}
                </div>
              </div>

              {/* 进度条与梯级 */}
              <div className="h-7 w-full bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 overflow-hidden flex items-center">
                <div
                  className={`h-full rounded-md bg-gradient-to-r ${colorGradient} transition-all duration-500 flex items-center justify-end px-2`}
                  style={{ width: `${widthPercent}%` }}
                >
                  <span className="text-[10px] text-white/90 font-medium">
                    {widthPercent}%
                  </span>
                </div>
              </div>

              {/* 阶段间转化率/流失提示 */}
              {idx < safeStages.length - 1 && (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 px-7">
                  <ArrowDown className="w-3 h-3 text-slate-300 dark:text-slate-600" />
                  <span>流失率: ~{dropOffRate}%</span>
                  {stage.subtext && <span>• {stage.subtext}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
