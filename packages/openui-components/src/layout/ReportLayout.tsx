"use client";

import React from "react";
import { LayoutTemplate } from "lucide-react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";

/**
 * BI 报表布局模板：页头 + KPI 横排区 + 双列图表区 + 全宽明细区 + 结论区。
 *
 * 区块（zone）语义约定——LLM 侧同步见 llm 包 serverReportLayout：
 * - kpis     直接传 MetricCard 数组（模板自动 4 列栅格，勿再嵌 MetricGrid）
 * - charts   图表数组（lg 双列；奇数个时末张自动占满整行）
 * - detail   DataTable 等全宽明细
 * - insights InsightBox / ActionPlanCard 结论区（纵向堆叠）
 * 全部区块可选，未提供的区块不渲染占位。
 */
export interface ReportLayoutProps {
  title?: string;
  subtitle?: string;
  kpis?: React.ReactNode;
  charts?: React.ReactNode;
  detail?: React.ReactNode;
  insights?: React.ReactNode;
}

export const ReportLayout: React.FC<ReportLayoutProps> = ({
  title,
  subtitle,
  kpis,
  charts,
  detail,
  insights,
}) => {
  return (
    <div className="space-y-4 w-full">
      {/* 页头 */}
      {(title || subtitle) && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-5 py-4 shadow-xs flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <LayoutTemplate className="w-4 h-4 text-blue-500 shrink-0" />
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
            BI Report
          </span>
        </div>
      )}

      {/* KPI 横排区：手机 2 列，桌面 4 列 */}
      {kpis ? <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{kpis}</div> : null}

      {/* 双列图表区：奇数个时末张占满整行 */}
      {charts ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:[&>*:nth-child(odd):last-child]:col-span-2">
          {charts}
        </div>
      ) : null}

      {/* 全宽明细区 */}
      {detail ? <div className="w-full">{detail}</div> : null}

      {/* 结论区 */}
      {insights ? <div className="space-y-3">{insights}</div> : null}
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const ReportLayoutDef = defineComponent({
  name: "ReportLayout",
  description:
    "BI 报表布局模板：页头 + KPI 横排区 + 双列图表区 + 全宽明细区 + 结论区，适用于周期性经营/获客/迭代综合复盘；单一主题直接用 Root 平铺",
  props: z.object({
    title: z.any().optional().describe("报表标题"),
    subtitle: z.any().optional().describe("周期或范围说明，如：2026 Q3 · 全渠道"),
    kpis: z.any().optional().describe("KPI 横排区：直接传 MetricCard 数组，勿嵌 MetricGrid"),
    charts: z.any().optional().describe("双列图表区：AnalyticsChart/FunnelChart/RadarChart 等数组"),
    detail: z.any().optional().describe("全宽明细区：DataTable 数组"),
    insights: z.any().optional().describe("结论区：InsightBox/ActionPlanCard 数组"),
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
      <ComponentSafeWrapper name="ReportLayout">
        <ReportLayout
          title={props?.title ? String(props.title) : undefined}
          subtitle={props?.subtitle ? String(props.subtitle) : undefined}
          kpis={zone(props?.kpis)}
          charts={zone(props?.charts)}
          detail={zone(props?.detail)}
          insights={zone(props?.insights)}
        />
      </ComponentSafeWrapper>
    );
  },
});
