"use client";

import React from "react";
import { useTriggerAction, defineComponent } from "@openuidev/react-lang";
import { ClipboardList, Database, HelpCircle, ListChecks, Play } from "lucide-react";
import { z } from "zod";
import { parseArrayProp } from "../internal/parseProp";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";

export interface PlanStep {
  title: string;
  detail?: string;
  chart?: string;
}

export interface PlanClarification {
  question: string;
  options?: string[];
  default?: string;
}

export interface PlanReviewCardProps {
  title?: string;
  question?: string;
  sources?: string[];
  steps: PlanStep[];
  clarifications?: PlanClarification[];
  confirmLabel?: string;
}

/**
 * 分析规划确认卡（Plan-first 规划阶段专用）：
 * 步骤清单 + 数据基础徽标 + 澄清问题选项 chips，点「确认」经 ToAssistant 通道
 * 注入答复消息并触发执行阶段。仅在规划轮次产出，执行轮次不应再出现。
 */
export const PlanReviewCard: React.FC<PlanReviewCardProps> = ({
  title = "分析思路确认",
  question,
  sources,
  steps = [],
  clarifications,
  confirmLabel = "按此思路开始分析",
}) => {
  const triggerAction = useTriggerAction();
  const [confirming, setConfirming] = React.useState(false);
  // 澄清问题的点选结果：索引 → 选中项（未选则执行时按 default 走）
  const [selections, setSelections] = React.useState<Record<number, string>>({});

  const safeSteps: PlanStep[] = parseArrayProp(steps)
    .map((s) => ({
      title: String(s.title || s.name || "分析步骤"),
      detail: s.detail ? String(s.detail) : undefined,
      chart: s.chart ? String(s.chart) : undefined,
    }))
    .filter((s) => s.title);

  // sources 是字符串数组（非对象数组），单独容错：真数组直取，JSON 字符串解析
  const safeSources: string[] = (() => {
    let raw: unknown = sources;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = [];
      }
    }
    return Array.isArray(raw)
      ? raw.map((s) => String(s)).filter(Boolean)
      : [];
  })();

  const safeClarifications: PlanClarification[] = parseArrayProp(clarifications)
    .map((c) => {
      const options = Array.isArray(c.options)
        ? c.options.map((o) => String(o)).filter(Boolean)
        : undefined;
      return {
        question: String(c.question || c.title || ""),
        options: options && options.length > 0 ? options : undefined,
        default: c.default ? String(c.default) : undefined,
      };
    })
    .filter((c) => c.question);

  const handleConfirm = async () => {
    if (!triggerAction) return;
    setConfirming(true);
    try {
      const parts: string[] = ["请按上述已确认的分析思路开始执行，产出完整的分析报告与看板。"];
      const answered = safeClarifications
        .map((c, i) => ({ c, sel: selections[i] }))
        .filter((x): x is { c: PlanClarification; sel: string } => Boolean(x.sel));
      if (answered.length > 0) {
        parts.push(
          `澄清问题答复：${answered.map(({ c, sel }) => `「${c.question}」选择：${sel}`).join("；")}。`
        );
      }
      const unanswered = safeClarifications.filter((_, i) => !selections[i]);
      if (unanswered.length > 0) {
        parts.push(`未答复的 ${unanswered.length} 个澄清问题按其默认假设执行。`);
      }
      await triggerAction(parts.join("\n"));
    } catch (e) {
      console.error("[PlanReviewCard confirm error]:", e);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-900/60 rounded-xl p-5 shadow-xs">
        {/* 头部：标题 + 原问题复述 */}
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <ClipboardList className="w-4 h-4 text-blue-500" />
            <span>{title}</span>
          </h3>
          {question && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              你的问题：{question}
            </p>
          )}
        </div>

        {/* 数据基础徽标 */}
        {safeSources.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            {safeSources.map((s, i) => (
              <span
                key={`src-${i}`}
                className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full font-medium"
              >
                {s}
              </span>
            ))}
          </div>
        )}

        {/* 分步思路 */}
        <div className="mb-4">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2 flex items-center gap-1.5">
            <ListChecks className="w-3.5 h-3.5 text-blue-500" />
            分析思路（{safeSteps.length} 步）
          </div>
          <ol className="space-y-2">
            {safeSteps.map((s, i) => (
              <li
                key={`step-${i}`}
                className="flex gap-2.5 items-start bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800 rounded-lg px-3 py-2"
              >
                <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-slate-800 dark:text-slate-200">{s.title}</div>
                  {s.detail && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{s.detail}</div>
                  )}
                  {s.chart && (
                    <div className="text-[10px] text-blue-600 dark:text-blue-400 font-mono mt-1 truncate">
                      📊 {s.chart}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* 澄清问题：选项 chips 可点选；未选按默认假设 */}
        {safeClarifications.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2 flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-amber-500" />
              需要确认的点（不选则按默认假设执行）
            </div>
            <div className="space-y-2.5">
              {safeClarifications.map((c, i) => (
                <div
                  key={`clar-${i}`}
                  className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 rounded-lg px-3 py-2"
                >
                  <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                    {i + 1}. {c.question}
                  </div>
                  {c.options && c.options.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {c.options.map((opt) => {
                        const selected = selections[i] === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() =>
                              setSelections((prev) => ({ ...prev, [i]: opt }))
                            }
                            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                              selected
                                ? "bg-blue-600 border-blue-600 text-white font-medium"
                                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-300 dark:hover:border-blue-700"
                            }`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {c.default && (
                    <div className="text-[10px] text-slate-400 mt-1.5">
                      默认假设：{c.default}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 确认按钮 */}
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!triggerAction || confirming}
          className="no-print w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
        >
          <Play className="w-3.5 h-3.5" />
          <span>{confirmLabel}</span>
          {confirming && <span className="animate-spin text-[10px]">⏳</span>}
        </button>
      </div>
  );
};

// ===== OpenUI 组件库定义 =====
export const PlanReviewCardDef = defineComponent({
  name: "PlanReviewCard",
  description:
    "分析规划确认卡（Plan-first 规划阶段专用）：问题复述 + 数据基础 + 分步思路（含图表选型）+ 澄清问题选项，一键确认触发执行；仅用于规划轮次",
  props: z.object({
    title: z.any().optional().describe("规划标题"),
    question: z.any().optional().describe("用户原始问题复述"),
    sources: z.any().optional().describe("数据基础徽标数组：源/表/字段"),
    steps: z.any().describe("有序分析步骤 [{title, detail?, chart?}]"),
    clarifications: z.any().optional().describe("澄清问题 [{question, options?, default?}]，每题须带 options 或 default"),
    confirmLabel: z.any().optional().describe("确认按钮文案，默认「按此思路开始分析」"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => (
    <ComponentSafeWrapper name="PlanReviewCard">
      <PlanReviewCard
        title={props?.title ? String(props.title) : undefined}
        question={props?.question ? String(props.question) : undefined}
        sources={props?.sources as React.ComponentProps<typeof PlanReviewCard>["sources"]}
        steps={props?.steps as React.ComponentProps<typeof PlanReviewCard>["steps"]}
        clarifications={props?.clarifications as React.ComponentProps<typeof PlanReviewCard>["clarifications"]}
        confirmLabel={props?.confirmLabel ? String(props.confirmLabel) : undefined}
      />
    </ComponentSafeWrapper>
  ),
});
