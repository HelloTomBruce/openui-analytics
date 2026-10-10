/**
 * 预设分析场景与 DevTools 沙盒默认代码。
 * 单独成模块以便组件与测试复用（任务 5 会统一切换为研发效能场景）。
 */
export const PRESET_QUERIES = [
  "帮我分析各渠道获客成本与投产，并提供响应式预算测算器与行动建议清单",
  "从禅道分析当前进行中项目的工时消耗、进度达成度与未关闭 Bug 严重度分布",
  "统计禅道中各团队成员的任务分配与工时饱和度雷达图",
  "从数据库分析全链路转化漏斗与 Q1 营销目标达成度",
  "从 GitLab 分析核心仓库的代码提交轨迹与时段活跃度热力图",
  "统计禅道各产品的需求生命周期流转漏斗与延期风险",
];

export const DEFAULT_SANDBOX_CODE = `root = Root([filter, gauge, sim, chart, action_plan])
filter = AnalyticsFilterBar("营销渠道实时钻取与测算表单", "TikTok Ads", "cac")
gauge = GaugeProgress("Q1 整体获客达成率", "目标 5,000 线索", 4640, 5000, "条", "达成率 92.8%")
sim = ReactiveSimulator("TikTok Ads 实时预算与投产测试器", 50000, "TikTok Ads", 19.87, 0.146)
chart = AnalyticsChart("bar", "各渠道获客成本对比", "单位：美元", "channel", [{"channel":"TikTok Ads","cac":19.87},{"channel":"Google Search","cac":28.38},{"channel":"Meta Ads","cac":43.99}], [{"key":"cac","label":"CAC ($)","color":"#3b82f6"}])
action_plan = ActionPlanCard("落地建议清单", "基于投入产出比测算", [{"title":"向 TikTok Ads 追加 20% 预算","priority":"high","impact":"预计新增线索 420 条","owner":"营销组"}])`;
