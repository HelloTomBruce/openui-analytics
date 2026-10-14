"use client";

import React from "react";
import { Scale } from "lucide-react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";

/**
 * 左右对比布局模板：页头 + 带标签的左右双栏面板 + 底部结论区。
 *
 * 区块（zone）语义约定——LLM 侧同步见 llm 包 serverComparisonLayout：
 * - leftLabel / rightLabel  两栏各自的对比对象名（渠道、仓库、成员、版本……）
 * - left / right            两栏内容数组：MetricCard / AnalyticsChart 等
 * - verdict                 底部全宽结论区：InsightBox（谁更优、差多少、怎么决策）
 * 左右标签缺失时降级为"左/右"占位；verdict 可选。
 */
export interface ComparisonLayoutProps {
  title?: string;
  subtitle?: string;
  leftLabel?: string;
  left?: React.ReactNode;
  rightLabel?: string;
  right?: React.ReactNode;
  verdict?: React.ReactNode;
}

export const ComparisonLayout: React.FC<ComparisonLayoutProps> = ({
  title,
  subtitle,
  leftLabel,
  left,
  rightLabel,
  right,
  verdict,
}) => {
  const hasAnyColumn = left || right;
  return (
    <div className="space-y-4 w-full">
      {/* 页头 */}
      {(title || subtitle) && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-5 py-4 shadow-xs flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Scale className="w-4 h-4 text-blue-500 shrink-0" />
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
            A/B Compare
          </span>
        </div>
      )}

      {/* 左右双栏：各带对比对象标签头 */}
      {hasAnyColumn ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* 左栏：蓝色系 */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
            <header className="px-4 py-2.5 bg-blue-50 dark:bg-blue-950/40 border-b border-blue-100 dark:border-blue-900/60">
              <h3 className="text-sm font-semibold text-blue-700 dark:text-blue-300 truncate">
                {leftLabel || "左"}
              </h3>
            </header>
            <div className="p-4 space-y-4">{left}</div>
          </section>

          {/* 右栏：紫色系 */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
            <header className="px-4 py-2.5 bg-violet-50 dark:bg-violet-950/40 border-b border-violet-100 dark:border-violet-900/60">
              <h3 className="text-sm font-semibold text-violet-700 dark:text-violet-300 truncate">
                {rightLabel || "右"}
              </h3>
            </header>
            <div className="p-4 space-y-4">{right}</div>
          </section>
        </div>
      ) : null}

      {/* 底部结论区 */}
      {verdict ? <div className="w-full">{verdict}</div> : null}
    </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const ComparisonLayoutDef = defineComponent({
  name: "ComparisonLayout",
  description:
    "左右对比布局模板：带对比对象标签的双栏面板 + 底部结论区。适用于 A/B 测试、两个渠道/仓库/成员/版本间的横向对比；多主题综合复盘用 ReportLayout",
  props: z.object({
    title: z.any().optional().describe("对比主题标题"),
    subtitle: z.any().optional().describe("对比范围或口径说明"),
    leftLabel: z.any().optional().describe("左栏对比对象名，如：TikTok Ads"),
    left: z.any().optional().describe("左栏内容数组：MetricCard/AnalyticsChart 等"),
    rightLabel: z.any().optional().describe("右栏对比对象名，如：Google Ads"),
    right: z.any().optional().describe("右栏内容数组"),
    verdict: z.any().optional().describe("底部结论区：InsightBox 数组"),
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
      <ComponentSafeWrapper name="ComparisonLayout">
        <ComparisonLayout
          title={props?.title ? String(props.title) : undefined}
          subtitle={props?.subtitle ? String(props.subtitle) : undefined}
          leftLabel={props?.leftLabel ? String(props.leftLabel) : undefined}
          left={zone(props?.left)}
          rightLabel={props?.rightLabel ? String(props.rightLabel) : undefined}
          right={zone(props?.right)}
          verdict={zone(props?.verdict)}
        />
      </ComponentSafeWrapper>
    );
  },
});
