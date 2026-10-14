"use client";

import React from "react";
import { Crosshair } from "lucide-react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";

/**
 * 深钻归因布局模板：页头 + 主区（2/3 宽）+ 侧栏（1/3 窄列洞察）+ 底部明细。
 *
 * 区块（zone）语义约定——LLM 侧同步见 llm 包 serverFocusLayout：
 * - main     主分析区：AnalyticsChart / FunnelChart / RadarChart 等主图（有侧栏时占 2/3，无侧栏时占满）
 * - side     侧栏洞察：InsightBox / GaugeProgress / MetricCard / ActionPlanCard 等结论件
 * - detail   底部全宽明细：DataTable
 * side/detail 可选，未提供的区块不渲染占位。
 */
export interface FocusLayoutProps {
  title?: string;
  subtitle?: string;
  main?: React.ReactNode;
  side?: React.ReactNode;
  detail?: React.ReactNode;
}

export const FocusLayout: React.FC<FocusLayoutProps> = ({
  title,
  subtitle,
  main,
  side,
  detail,
}) => {
  return (
    <div className="space-y-4 w-full">
      {/* 页头 */}
      {(title || subtitle) && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-5 py-4 shadow-xs flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Crosshair className="w-4 h-4 text-blue-500 shrink-0" />
                <span className="truncate">{title}</span>
              </h2>
            )}
            {subtitle && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <span className="text-[10px] bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 px-2.5 py-1 rounded-full font-semibold border border-blue-200 dark:border-blue-800 shrink-0">
            Deep Dive
          </span>
        </div>
      )}

      {/* 主区 + 侧栏：有侧栏时 2/3 + 1/3，无侧栏时主区占满 */}
      {main || side ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {main ? (
            <div className={side ? "lg:col-span-2 space-y-4" : "lg:col-span-3 space-y-4"}>
              {main}
            </div>
          ) : null}
          {side ? <div className="space-y-4">{side}</div> : null}
        </div>
      ) : null}

      {/* 底部全宽明细区 */}
      {detail ? <div className="w-full">{detail}</div> : null}
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const FocusLayoutDef = defineComponent({
  name: "FocusLayout",
  description:
    "深钻归因布局模板：主图区（2/3 宽）+ 侧栏洞察（1/3 窄列）+ 底部明细。适用于单一主题的根因分析与归因（为什么 X 上升/下降）；多主题综合复盘用 ReportLayout",
  props: z.object({
    title: z.any().optional().describe("深钻主题标题，如：为什么 Q3 CAC 上升"),
    subtitle: z.any().optional().describe("聚焦对象或范围说明"),
    main: z.any().optional().describe("主分析区：核心趋势/对比图表数组"),
    side: z.any().optional().describe("侧栏洞察：InsightBox/GaugeProgress/MetricCard/ActionPlanCard 数组"),
    detail: z.any().optional().describe("底部全宽明细区：DataTable 数组"),
  }),
  component: ({
    props,
    renderNode,
  }: {
    props?: Record<string, unknown>;
    renderNode?: (node?: unknown) => React.ReactNode;
  }) => {
    const zone = (v: unknown) => (renderNode ? renderNode(v) : null);
    return (
      <ComponentSafeWrapper name="FocusLayout">
        <FocusLayout
          title={props?.title ? String(props.title) : undefined}
          subtitle={props?.subtitle ? String(props.subtitle) : undefined}
          main={zone(props?.main)}
          side={zone(props?.side)}
          detail={zone(props?.detail)}
        />
      </ComponentSafeWrapper>
    );
  },
});
