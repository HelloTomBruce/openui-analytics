"use client";

import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export interface SeriesConfig {
  key: string;
  label?: string;
  color?: string;
}

export interface AnalyticsChartProps {
  type: "line" | "bar" | "area" | "pie";
  title?: string;
  description?: string;
  data: Array<Record<string, unknown>>;
  xAxisKey?: string;
  series?: SeriesConfig[];
  height?: number;
}

const DEFAULT_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
];

export const AnalyticsChart: React.FC<AnalyticsChartProps> = ({
  type = "bar",
  title,
  description,
  data = [],
  xAxisKey = "name",
  series = [],
  height = 280,
}) => {
  // 安全容错：确保 data 与 series 始终为可迭代数组
  const safeData: Array<Record<string, unknown>> = Array.isArray(data)
    ? data
    : typeof data === "string"
    ? (() => {
        try {
          return JSON.parse(data);
        } catch {
          return [];
        }
      })()
    : [];

  let safeSeries: SeriesConfig[] = [];
  if (Array.isArray(series)) {
    safeSeries = series;
  } else if (typeof series === "string") {
    try {
      const parsed = JSON.parse(series);
      safeSeries = Array.isArray(parsed) ? parsed : [];
    } catch {
      safeSeries = [];
    }
  }

  // 如果没有传递 series，但 data 中有字段，自动提取数值字段作为默认序列
  if (safeSeries.length === 0 && safeData.length > 0) {
    const firstRow = safeData[0];
    const candidateKeys = Object.keys(firstRow).filter(
      (k) => k !== xAxisKey && typeof firstRow[k] === "number"
    );
    if (candidateKeys.length > 0) {
      safeSeries = candidateKeys.map((k, idx) => ({
        key: k,
        label: k,
        color: DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
      }));
    } else {
      const remainingKeys = Object.keys(firstRow).filter((k) => k !== xAxisKey);
      safeSeries = remainingKeys.map((k, idx) => ({
        key: k,
        label: k,
        color: DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
      }));
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
      {title && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </h3>
          {description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {description}
            </p>
          )}
        </div>
      )}

      <div style={{ width: "100%", height }}>
        {safeData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">
            暂无图表数据
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {type === "line" ? (
              <LineChart data={safeData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey={xAxisKey} tick={{ fontSize: 12 }} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                {safeSeries.map((s, idx) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label || s.key}
                    stroke={s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            ) : type === "bar" ? (
              <BarChart data={safeData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey={xAxisKey} tick={{ fontSize: 12 }} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                {safeSeries.map((s, idx) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label || s.key}
                    fill={s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]}
                    radius={[4, 4, 0, 0]}
                  />
                ))}
              </BarChart>
            ) : type === "area" ? (
              <AreaChart data={safeData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey={xAxisKey} tick={{ fontSize: 12 }} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                {safeSeries.map((s, idx) => {
                  const color = s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
                  return (
                    <Area
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label || s.key}
                      stroke={color}
                      fill={color}
                      fillOpacity={0.2}
                    />
                  );
                })}
              </AreaChart>
            ) : (
              <PieChart>
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Pie
                  data={safeData}
                  dataKey={safeSeries[0]?.key || "value"}
                  nameKey={xAxisKey}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label
                >
                  {safeData.map((_: unknown, index: number) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
                    />
                  ))}

                </Pie>
              </PieChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
