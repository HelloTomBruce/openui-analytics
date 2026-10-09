"use client";

import React, { useState } from "react";
import { useTriggerAction, useSetFieldValue } from "@openuidev/react-lang";
import { Calculator, Sparkles, Download, AlertTriangle } from "lucide-react";
import { clientTools } from "@/lib/clientTools";

export interface ReactiveSimulatorProps {
  title?: string;
  defaultBudget?: number;
  channelName?: string;
  currentCac?: number;
  cvrRate?: number;
}

export const ReactiveSimulator: React.FC<ReactiveSimulatorProps> = ({
  title = "响应式预算模拟与本地实时试算器",
  defaultBudget = 50000,
  channelName = "TikTok Ads",
  currentCac = 19.87,
  cvrRate = 0.146,
}) => {
  const triggerAction = useTriggerAction();
  const setFieldValue = useSetFieldValue();

  // 本地响应式状态
  const [budget, setBudget] = useState(defaultBudget);
  const [targetCac, setTargetCac] = useState(currentCac);
  const [customCvr, setCustomCvr] = useState(Math.round(cvrRate * 100));

  // 声明式约束校验
  const [validationError, setValidationError] = useState<string | null>(null);

  // 实时本地响应式计算 (纯前端毫秒级刷新，不依赖 LLM 延迟)
  const estimatedLeads = targetCac > 0 ? Math.round(budget / targetCac) : 0;
  const estimatedDeals = Math.round(estimatedLeads * (customCvr / 100));
  const estimatedRevenue = estimatedDeals * 1500; // 假设客单价 1500
  const estimatedRoi = budget > 0 ? ((estimatedRevenue - budget) / budget).toFixed(2) : "0";

  const handleBudgetChange = (val: number) => {
    // 约束校验规则
    if (val < 1000) {
      setValidationError("预算金额不可低于 $1,000");
    } else if (val > 1000000) {
      setValidationError("单渠道模拟上限不可超过 $1,000,000");
    } else {
      setValidationError(null);
    }
    setBudget(val);
    if (setFieldValue) {
      setFieldValue(undefined, "ReactiveSimulator", "budget", val);
    }
  };

  const handleExportSimulation = async () => {
    await clientTools.export_csv({
      filename: `simulation_${channelName}_budget_${budget}.csv`,
      headers: [
        { key: "channel", header: "渠道" },
        { key: "budget", header: "模拟预算 ($)" },
        { key: "cac", header: "预估 CAC ($)" },
        { key: "cvr", header: "转化率 (%)" },
        { key: "leads", header: "预期线索数" },
        { key: "deals", header: "预期成交数" },
        { key: "revenue", header: "预期营收 ($)" },
        { key: "roi", header: "预估 ROI" },
      ],
      data: [
        {
          channel: channelName,
          budget,
          cac: targetCac,
          cvr: `${customCvr}%`,
          leads: estimatedLeads,
          deals: estimatedDeals,
          revenue: estimatedRevenue,
          roi: estimatedRoi,
        },
      ],
    });
  };

  const handleAskAIToAudit = () => {
    if (validationError) return;
    if (triggerAction) {
      triggerAction(
        `【响应式试算回传】我针对渠道「${channelName}」在预算 $${budget.toLocaleString()}、目标 CAC $${targetCac}、成交转化率 ${customCvr}% 条件下进行了测算，预计产出 ${estimatedLeads.toLocaleString()} 条线索与 $${estimatedRevenue.toLocaleString()} 营收 (ROI: ${estimatedRoi})。请对此方案进行专业风险评估与归因分析。`
      );
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <Calculator className="w-4 h-4 text-blue-500" />
            <span>{title}</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            OpenUI 响应式状态（Reactive State）+ 校验约束（Validation）+ 客户端工具（Client Tools）
          </p>
        </div>
        <span className="text-[10px] bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 px-2.5 py-1 rounded-full font-semibold border border-indigo-200 dark:border-indigo-800">
          ⚡ 客户端毫秒响应
        </span>
      </div>

      {/* 参数滑块与输入 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs bg-slate-50 dark:bg-slate-950/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex justify-between font-medium mb-1">
            <span className="text-slate-600 dark:text-slate-400">模拟投放预算</span>
            <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">
              ${budget.toLocaleString()}
            </span>
          </div>
          <input
            type="range"
            min="1000"
            max="200000"
            step="1000"
            value={budget}
            onChange={(e) => handleBudgetChange(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
        </div>

        <div>
          <div className="flex justify-between font-medium mb-1">
            <span className="text-slate-600 dark:text-slate-400">目标获客成本 (CAC)</span>
            <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">
              ${targetCac.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min="10"
            max="100"
            step="1"
            value={targetCac}
            onChange={(e) => setTargetCac(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-600"
          />
        </div>

        <div>
          <div className="flex justify-between font-medium mb-1">
            <span className="text-slate-600 dark:text-slate-400">预估成交转化率 (CVR)</span>
            <span className="font-mono text-violet-600 dark:text-violet-400 font-bold">
              {customCvr}%
            </span>
          </div>
          <input
            type="range"
            min="5"
            max="40"
            step="1"
            value={customCvr}
            onChange={(e) => setCustomCvr(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-600"
          />
        </div>
      </div>

      {/* 校验错误提示 */}
      {validationError && (
        <div className="flex items-center gap-1.5 text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/40 p-2.5 rounded-lg border border-rose-200 dark:border-rose-900">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {/* 实时响应式联动计算结果卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg border border-slate-200/60 dark:border-slate-800">
          <div className="text-[11px] text-slate-400">预期线索获取</div>
          <div className="text-lg font-bold text-slate-800 dark:text-slate-100 font-mono mt-0.5">
            {estimatedLeads.toLocaleString()} <span className="text-xs font-normal">条</span>
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg border border-slate-200/60 dark:border-slate-800">
          <div className="text-[11px] text-slate-400">预期签约成单</div>
          <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
            {estimatedDeals.toLocaleString()} <span className="text-xs font-normal">单</span>
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg border border-slate-200/60 dark:border-slate-800">
          <div className="text-[11px] text-slate-400">预估贡献营收</div>
          <div className="text-lg font-bold text-blue-600 dark:text-blue-400 font-mono mt-0.5">
            ${estimatedRevenue.toLocaleString()}
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg border border-slate-200/60 dark:border-slate-800">
          <div className="text-[11px] text-slate-400">预估投产比 (ROI)</div>
          <div className="text-lg font-bold text-violet-600 dark:text-violet-400 font-mono mt-0.5">
            {estimatedRoi}x
          </div>
        </div>
      </div>

      {/* 底部多步操作栏 */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 flex-wrap gap-2">
        <button
          onClick={handleExportSimulation}
          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-slate-500" />
          <span>客户端一键导出测算表 (Client Tool)</span>
        </button>

        <button
          onClick={handleAskAIToAudit}
          disabled={!!validationError}
          className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1.5 shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>将此测算案交由 Agent 深度归因 (ToAssistant)</span>
        </button>
      </div>
    </div>
  );
};
