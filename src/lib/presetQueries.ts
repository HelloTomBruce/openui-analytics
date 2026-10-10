/**
 * 预设分析场景与 DevTools 沙盒默认代码。
 * 单独成模块以便组件与测试复用。
 */
export const PRESET_QUERIES = [
  "本迭代各项目的 Bug 收敛情况如何？请按严重度分析并给出收敛漏斗",
  "统计各团队成员的任务分配、工时消耗与负载饱和度雷达图",
  "从 GitLab 分析核心仓库的代码提交轨迹与时段活跃度热力图",
  "当前进行中项目的进度达成度、延期风险与干预建议",
];

export const DEFAULT_SANDBOX_CODE = `root = Root([gauge, grid, funnel, radar, action_plan])
gauge = GaugeProgress("Sprint 24 迭代进度达成度", "目标交付 38 个任务", 31, 38, "个", "达成率 81.6%")
c1 = MetricCard("未关闭 Bug", "23", "-34.3%", "down", "严重 Bug 仅剩 2 个")
c2 = MetricCard("人均工时饱和度", "86%", "+6.2%", "up", "整体负载健康")
grid = MetricGrid(2, [c1, c2])
funnel = FunnelChart("迭代缺陷收敛漏斗", "从发现到关闭的 Bug 生命周期", [{"name":"新增 Bug","value":57,"conversion":"100%"},{"name":"已确认","value":49,"conversion":"86.0%"},{"name":"已解决","value":38,"conversion":"77.6%"},{"name":"已关闭","value":34,"conversion":"89.5%"}], "个")
radar = RadarChart("团队成员负载与能力画像", "任务量/工时/缺陷修复维度", [{"member":"张伟","workload":82,"quality":90},{"member":"李娜","workload":76,"quality":85}], "member", [{"key":"workload","label":"工时负载","color":"#3b82f6"},{"key":"quality","label":"交付质量","color":"#10b981"}])
action_plan = ActionPlanCard("迭代风险干预建议", "基于 Bug 收敛速度与工时分布测算", [{"title":"为张伟分流 2 个 P3 任务给王强","priority":"high","impact":"消除超载风险","owner":"项目经理"}])`;
