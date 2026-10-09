"use client";

import React from "react";
import {
  ResponsiveContainer,
  RadarChart as RechartsRadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  Legend,
} from "recharts";
import { Compass } from "lucide-react";

export interface RadarSeriesConfig {
  key: string;
  name?: string;
  color?: string;
}

export interface RadarChartProps {
  title?: string;
  description?: string;
  data: Array<Record<string, unknown>>;
  angleKey?: string;
  series?: RadarSeriesConfig[];
  height?: number;
}

const DEFAULT_RADAR_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#ec4899", // pink
];

export const RadarChart: React.FC<RadarChartProps> = ({
  title,
  description,
  data = [],
  angleKey = "metric",
  series = [],
  height = 300,
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

  const safeData: Array<Record<string, unknown>> = rawData.filter(
    (item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item)
  );

  let safeSeries: RadarSeriesConfig[] = [];
  if (Array.isArray(series)) {
    safeSeries = series.filter(
      (s): s is RadarSeriesConfig => s != null && typeof s === "object" && typeof s.key === "string"
    );
  } else if (typeof series === "string") {
    try {
      const parsed = JSON.parse(series);
      if (Array.isArray(parsed)) {
        safeSeries = parsed.filter(
          (s): s is RadarSeriesConfig => s != null && typeof s === "object" && typeof s.key === "string"
        );
      }
    } catch {
      safeSeries = [];
    }
  }

  // 自动提取数值字段
  if (safeSeries.length === 0 && safeData.length > 0 && safeData[0] && typeof safeData[0] === "object") {
    const firstRow = safeData[0];
    const candidateKeys = Object.keys(firstRow).filter(
      (k) => k !== angleKey && (typeof firstRow[k] === "number" || !isNaN(Number(firstRow[k])))
    );
    safeSeries = candidateKeys.map((k, idx) => ({
      key: k,
      name: k,
      color: DEFAULT_RADAR_COLORS[idx % DEFAULT_RADAR_COLORS.length],
    }));
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
      {(title || description) && (
        <div className="mb-4">
          {title && (
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-blue-500" />
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

      <div style={{ width: "100%", height, minHeight: height }}>
        {safeData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">
            暂无雷达图数据
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={height} minWidth={0} debounce={50}>
            <RechartsRadarChart data={safeData} outerRadius="75%">
              <PolarGrid stroke="#e2e8f0" strokeOpacity={0.4} />
              <PolarAngleAxis
                dataKey={angleKey}
                tick={{ fontSize: 11, fill: "#64748b" }}
              />
              <PolarRadiusAxis angle={30} domain={[0, "auto"]} stroke="#cbd5e1" tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "6px" }} />
              {safeSeries.map((s, idx) => {
                const color = s.color || DEFAULT_RADAR_COLORS[idx % DEFAULT_RADAR_COLORS.length];
                return (
                  <Radar
                    key={`radar-${s.key || idx}`}
                    name={s.name || s.key}
                    dataKey={s.key}
                    stroke={color}
                    fill={color}
                    fillOpacity={0.25}
                  />
                );
              })}
            </RechartsRadarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
