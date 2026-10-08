import React from "react";
import { useSetFieldValue, useTriggerAction } from "@openuidev/react-lang";
import { Filter, Play } from "lucide-react";

export interface FilterOption {
  label: string;
  value: string;
}

export interface AnalyticsFilterBarProps {
  title?: string;
  channelOptions?: FilterOption[];
  metricOptions?: FilterOption[];
  defaultChannel?: string;
  defaultMetric?: string;
}

export const AnalyticsFilterBar: React.FC<AnalyticsFilterBarProps> = ({
  title = "数据动态钻取与参数微调",
  channelOptions = [
    { label: "全部渠道", value: "all" },
    { label: "TikTok Ads", value: "TikTok Ads" },
    { label: "Google Search", value: "Google Search" },
    { label: "Meta Ads", value: "Meta Ads" },
    { label: "LinkedIn Ads", value: "LinkedIn Ads" },
  ],
  metricOptions = [
    { label: "获客成本 (CAC)", value: "cac" },
    { label: "获取线索量 (Leads)", value: "leads" },
    { label: "转化率 (CVR)", value: "cvr" },
    { label: "投资回报率 (ROI)", value: "roi" },
  ],
  defaultChannel = "all",
  defaultMetric = "cac",
}) => {
  const setFieldValue = useSetFieldValue();
  const triggerAction = useTriggerAction();

  const [selectedChannel, setSelectedChannel] = React.useState(defaultChannel);
  const [selectedMetric, setSelectedMetric] = React.useState(defaultMetric);
  const [targetBudget, setTargetBudget] = React.useState("50000");

  const handleChannelChange = (val: string) => {
    setSelectedChannel(val);
    if (setFieldValue) {
      setFieldValue(undefined, "AnalyticsFilterBar", "channel", val);
    }
  };

  const handleMetricChange = (val: string) => {
    setSelectedMetric(val);
    if (setFieldValue) {
      setFieldValue(undefined, "AnalyticsFilterBar", "metric", val);
    }
  };

  const handleBudgetChange = (val: string) => {
    setTargetBudget(val);
    if (setFieldValue) {
      setFieldValue(undefined, "AnalyticsFilterBar", "budget", val);
    }
  };

  const handleSubmit = () => {
    const query = `【用户交互表单触发】请帮我针对渠道「${selectedChannel}」，核心指标聚焦于「${selectedMetric}」，在预算「$${targetBudget}」下进行重新计算、归因分析并刷新可视化看板。`;
    if (triggerAction) {
      triggerAction(query);
    }
  };

  return (
    <div className="bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
      <div className="flex items-center gap-2 mb-3">
        <Filter className="w-4 h-4 text-blue-500" />
        <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
          {title}
        </h4>
        <span className="text-[10px] bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full font-medium ms-auto">
          Interactive Form
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        {/* 渠道筛选 */}
        <div>
          <label className="block text-slate-500 dark:text-slate-400 mb-1 font-medium">
            聚焦推广渠道
          </label>
          <select
            value={selectedChannel}
            onChange={(e) => handleChannelChange(e.target.value)}
            className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {channelOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* 核心指标筛选 */}
        <div>
          <label className="block text-slate-500 dark:text-slate-400 mb-1 font-medium">
            主分析维度
          </label>
          <select
            value={selectedMetric}
            onChange={(e) => handleMetricChange(e.target.value)}
            className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {metricOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* 预算调整模拟 */}
        <div>
          <label className="block text-slate-500 dark:text-slate-400 mb-1 font-medium">
            模拟总预算 ($)
          </label>
          <input
            type="number"
            value={targetBudget}
            onChange={(e) => handleBudgetChange(e.target.value)}
            placeholder="例如: 50000"
            className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-slate-800">
        <span className="text-[11px] text-slate-400">
          点击提交后，AI 将根据表单参数实时重新计算并生成对应图表看板
        </span>
        <button
          onClick={handleSubmit}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors shadow-xs"
        >
          <Play className="w-3 h-3 fill-current" />
          <span>应用筛选并钻取</span>
        </button>
      </div>
    </div>
  );
};
