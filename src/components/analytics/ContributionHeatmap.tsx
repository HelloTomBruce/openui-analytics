"use client";

import React from "react";
import { Flame } from "lucide-react";

export interface HeatmapDataPoint {
  date?: string;
  day?: string;
  count: number;
  label?: string;
}

export interface ContributionHeatmapProps {
  title?: string;
  description?: string;
  data: HeatmapDataPoint[];
  color?: "green" | "blue" | "purple";
}

export const ContributionHeatmap: React.FC<ContributionHeatmapProps> = ({
  title = "研发与提交活跃度热力图",
  description,
  data = [],
  color = "green",
}) => {
  let rawData: unknown[] = [];
  if (Array.isArray(data)) {
    rawData = data;
  } else if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) rawData = parsed;
    } catch {
      rawData = [];
    }
  }

  const safeData: HeatmapDataPoint[] = rawData
    .filter((d): d is Record<string, unknown> => d != null && typeof d === "object")
    .map((d) => ({
      date: d.date ? String(d.date) : undefined,
      day: d.day ? String(d.day) : undefined,
      count: typeof d.count === "number" ? d.count : Number(d.count) || 0,
      label: d.label ? String(d.label) : undefined,
    }));

  const defaultTheme = {
    0: "bg-slate-100 dark:bg-slate-800/80",
    1: "bg-emerald-200 dark:bg-emerald-900/60",
    2: "bg-emerald-400 dark:bg-emerald-700",
    3: "bg-emerald-500 dark:bg-emerald-600",
    4: "bg-emerald-600 dark:bg-emerald-500",
  };

  const colorThemes = {
    green: defaultTheme,
    blue: {
      0: "bg-slate-100 dark:bg-slate-800/80",
      1: "bg-blue-200 dark:bg-blue-900/60",
      2: "bg-blue-400 dark:bg-blue-700",
      3: "bg-blue-500 dark:bg-blue-600",
      4: "bg-blue-600 dark:bg-blue-500",
    },
    purple: {
      0: "bg-slate-100 dark:bg-slate-800/80",
      1: "bg-purple-200 dark:bg-purple-900/60",
      2: "bg-purple-400 dark:bg-purple-700",
      3: "bg-purple-500 dark:bg-purple-600",
      4: "bg-purple-600 dark:bg-purple-500",
    },
  }[color] || defaultTheme;

  const getLevel = (count: number) => {
    if (count <= 0) return 0;
    if (count <= 2) return 1;
    if (count <= 5) return 2;
    if (count <= 8) return 3;
    return 4;
  };

  const totalCount = safeData.reduce((acc, curr) => acc + curr.count, 0);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-emerald-500" />
            <span>{title}</span>
          </h3>
          {description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {description}
            </p>
          )}
        </div>
        <span className="text-[10px] bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 px-2.5 py-0.5 rounded-full font-semibold">
          累计 {totalCount} 次
        </span>
      </div>

      <div className="overflow-x-auto pb-2">
        {safeData.length === 0 ? (
          <div className="text-xs text-slate-400 text-center py-4">
            暂无热力图数据
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5 items-center">
              {safeData.map((item, idx) => {
                const level = getLevel(item.count) as 0 | 1 | 2 | 3 | 4;
                const cellBg = colorThemes[level];
                return (
                  <div
                    key={`heatmap-cell-${idx}`}
                    className={`w-5 h-5 rounded-sm ${cellBg} transition-transform hover:scale-125 cursor-pointer relative group`}
                    title={`${item.date || item.day || `点位 ${idx + 1}`}: ${item.count} 次`}
                  >
                    {/* 悬浮气泡 */}
                    <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-20 bg-slate-900 text-white text-[10px] py-1 px-2 rounded shadow-lg whitespace-nowrap pointer-events-none">
                      {item.date || item.day || item.label || `#${idx + 1}`}: <span className="font-bold">{item.count}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 图例 */}
            <div className="flex items-center justify-end gap-1.5 text-[10px] text-slate-400 pt-2">
              <span>低频</span>
              <div className={`w-3 h-3 rounded-xs ${colorThemes[0]}`} />
              <div className={`w-3 h-3 rounded-xs ${colorThemes[1]}`} />
              <div className={`w-3 h-3 rounded-xs ${colorThemes[2]}`} />
              <div className={`w-3 h-3 rounded-xs ${colorThemes[3]}`} />
              <div className={`w-3 h-3 rounded-xs ${colorThemes[4]}`} />
              <span>高频</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
