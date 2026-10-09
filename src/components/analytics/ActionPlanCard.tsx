"use client";

import React from "react";
import { useTriggerAction } from "@openuidev/react-lang";
import { ArrowRight, Zap } from "lucide-react";

export interface ActionItem {
  title: string;
  priority?: "high" | "medium" | "low";
  impact?: string;
  owner?: string;
  status?: "todo" | "in_progress" | "done";
}

export interface ActionPlanCardProps {
  title?: string;
  description?: string;
  actions: ActionItem[];
}

export const ActionPlanCard: React.FC<ActionPlanCardProps> = ({
  title = "AI 归因建议与落地行动清单",
  description,
  actions = [],
}) => {
  const triggerAction = useTriggerAction();

  let rawActions: unknown[] = [];
  if (Array.isArray(actions)) {
    rawActions = actions;
  } else if (typeof actions === "string") {
    try {
      const parsed = JSON.parse(actions);
      if (Array.isArray(parsed)) rawActions = parsed;
    } catch {
      rawActions = [];
    }
  }

  const safeActions: ActionItem[] = rawActions
    .filter((a): a is Record<string, unknown> => a != null && typeof a === "object")
    .map((a) => ({
      title: String(a.title || a.name || a.desc || "待办事项"),
      priority: (["high", "medium", "low"].includes(String(a.priority)) ? a.priority : "medium") as ActionItem["priority"],
      impact: a.impact ? String(a.impact) : undefined,
      owner: a.owner ? String(a.owner) : undefined,
      status: (["todo", "in_progress", "done"].includes(String(a.status)) ? a.status : "todo") as ActionItem["status"],
    }));

  const handleExecuteAction = (item: ActionItem) => {
    if (triggerAction) {
      triggerAction(`【执行行动项】请针对「${item.title}」进行进一步深入分析，给出具体实施方案及预期收益测算。`);
    }
  };

  const priorityStyles = {
    high: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border-rose-200 dark:border-rose-800",
    medium: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    low: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  };

  const priorityLabels = {
    high: "高优决策",
    medium: "中优改进",
    low: "日常优化",
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-amber-500" />
            <span>{title}</span>
          </h3>
          {description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {description}
            </p>
          )}
        </div>
        <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-full font-medium">
          共 {safeActions.length} 项措施
        </span>
      </div>

      <div className="space-y-2.5">
        {safeActions.length === 0 ? (
          <div className="text-xs text-slate-400 text-center py-4">
            暂无行动项建议
          </div>
        ) : (
          safeActions.map((action, idx) => {
            const priority = action.priority || "medium";
            return (
              <div
                key={`action-${idx}`}
                className="group p-3 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition-colors flex items-start gap-3 justify-between"
              >
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${priorityStyles[priority]}`}
                    >
                      {priorityLabels[priority]}
                    </span>
                    <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {action.title}
                    </h4>
                  </div>
                  {action.impact && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">预期成效:</span>
                      <span>{action.impact}</span>
                    </p>
                  )}
                  {action.owner && (
                    <span className="text-[10px] text-slate-400">责任人: {action.owner}</span>
                  )}
                </div>

                <button
                  onClick={() => handleExecuteAction(action)}
                  className="shrink-0 opacity-80 group-hover:opacity-100 p-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md text-slate-600 dark:text-slate-300 hover:text-blue-600 hover:border-blue-300 text-xs flex items-center gap-1 shadow-2xs transition-all"
                  title="触发深入分析"
                >
                  <span className="text-[11px]">拆解</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
