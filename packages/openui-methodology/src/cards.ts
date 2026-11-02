import type { MethodCard } from "./types";

/**
 * 内置 10 张方法卡（通用分析思维，全部映射既有 OpenUI 组件）。
 * 配对组件名与 @openui-analytics/components 的 serverLibrary 键一一对应，
 * 一致性由 llm 包 promptExamples.test.ts 传入组件名集合校验（本包零依赖）。
 */
export const builtinMethodCards: MethodCard[] = [
  {
    id: "trend",
    name: "趋势与同比环比",
    when: "指标随时间如何变化？相比上期/去年同期是升是降？",
    steps: [
      "按时间粒度（日/周/月）聚合目标指标",
      "计算环比与同比变化率，标注拐点",
      "折线呈现走势，KPI 卡呈现最新值与涨跌",
    ],
    chartPairing: ["AnalyticsChart", "MetricCard"],
    executeGuidance:
      "Use AnalyticsChart(type=line) for the time series with period-over-period deltas annotated at inflection points; lead with MetricCard(value, change, trend) for the headline metric. Time granularity must match the question's horizon (daily for ops, monthly for reviews). Always compute both MoM and YoY when history allows.",
  },
  {
    id: "pareto",
    name: "构成与帕累托",
    when: "头部因素贡献了多少？哪些是关键的少数（80/20）？",
    steps: [
      "按维度聚合贡献值并降序排列",
      "计算累计占比，定位 80% 分界线",
      "柱状呈现各因素 + 累计线，头部置顶",
    ],
    chartPairing: ["AnalyticsChart", "MetricGrid"],
    executeGuidance:
      "Rank dimension values descending, compute cumulative share, and highlight the cutoff where ~80% accumulates. Present as bar (per-factor) plus cumulative line if possible; otherwise order bars and mark the vital-few in the narrative. Name the top factors explicitly with their shares.",
  },
  {
    id: "funnel",
    name: "漏斗转化",
    when: "多阶段流程中用户/需求在哪一步流失最多？",
    steps: [
      "定义阶段序列与各阶段计量口径",
      "计算阶段间转化率与整体转化率",
      "漏斗图呈现收窄，标注最大流失环节",
    ],
    chartPairing: ["FunnelChart", "InsightBox"],
    executeGuidance:
      "Define stages with ONE consistent unit across the chain (people, requests or sessions — never mixed). Compute stage-to-stage conversion plus end-to-end, then call out the biggest drop-off with its percentage. Use FunnelChart(stages, unit) and an InsightBox summarizing where and why users leak.",
  },
  {
    id: "rfm",
    name: "RFM 分层",
    when: "如何把用户/客户按价值与行为分层运营？",
    steps: [
      "计算每个对象的最近一次行为(R)、频次(F)、金额(M)",
      "按分位打分（1-5）并组合成分层",
      "分层呈现规模与特征，给出差异化策略",
    ],
    chartPairing: ["AnalyticsChart", "DataTable"],
    executeGuidance:
      "Compute Recency/Frequency/Monetary per entity, score each 1-5 by quantile, and compose segment labels (e.g. champions, at-risk, hibernating). Show segment sizes via bar/scatter and detail representative members in DataTable. Conclude with per-segment action suggestions.",
  },
  {
    id: "cohort",
    name: "同期群留存",
    when: "不同批次（注册月/首个购买月）的留存曲线有何差异？",
    steps: [
      "按起始事件周期划分同期群",
      "计算各群在后续周期的留存率矩阵",
      "热力图呈现留存衰减，对比群间差异",
    ],
    chartPairing: ["ContributionHeatmap", "AnalyticsChart"],
    executeGuidance:
      "Bucket entities by their first-event period (cohort), compute retention share for each subsequent period, and render the triangle matrix with ContributionHeatmap. Compare early vs recent cohorts on slope; surface any cohort that decays materially faster and hypothesize why.",
  },
  {
    id: "anomaly",
    name: "异常检测",
    when: "指标是否有异常点/异常时段？偏离正常范围多少？",
    steps: [
      "建立基线（移动均值或同期分布）",
      "按 IQR 或 z-score 计算偏离度",
      "标记异常点并量化偏移，给出可能解释方向",
    ],
    chartPairing: ["AnalyticsChart", "InsightBox"],
    executeGuidance:
      "Establish a baseline (rolling mean / seasonal profile), score deviations via IQR fences or z-score (|z|>3 default), and mark anomalous points on the line chart. Quantify each anomaly's magnitude and timing in an InsightBox(type=warning); list plausible causes as hypotheses to verify, never as facts.",
  },
  {
    id: "attribution",
    name: "维度拆解归因",
    when: "指标为什么涨/跌？哪个维度的变化贡献最大？",
    steps: [
      "把总变化按维度拆解（加法：各部分变化之和；乘法：因子贡献率）",
      "计算各维度贡献占比并排序",
      "定位主贡献维度，深钻其二级构成",
    ],
    chartPairing: ["FocusLayout", "ComparisonLayout"],
    executeGuidance:
      "Decompose the total delta additively (sum of dimension-level changes) or multiplicatively (rate contributions) and rank contributors. Present with FocusLayout: main chart shows the headline trend, sidebar insights rank contributing dimensions with signs. For before/after or A-vs-B framing use ComparisonLayout with a verdict.",
  },
  {
    id: "goal-gap",
    name: "目标达成与差距",
    when: "对照目标/预算/SLA 的达成度如何？缺口多大？",
    steps: [
      "明确目标值与当前值（含时间进度基准）",
      "计算达成率与缺口，判断是否符合时间进度",
      "仪表盘呈现达成度，按差距给出干预建议",
    ],
    chartPairing: ["GaugeProgress", "MetricCard"],
    executeGuidance:
      "State target, current and time-progress baseline explicitly (ahead/behind pace). Render GaugeProgress(current, target, unit) plus MetricCard for the gap. When behind pace, quantify the required run-rate for the remaining period and recommend concrete interventions.",
  },
  {
    id: "ranking",
    name: "排名与头尾分析",
    when: "谁/哪个表现最好最差？头尾差距有多大？",
    steps: [
      "选定排序指标与范围（全量或 TopN）",
      "降序/升序排列，标注头尾与中位数",
      "表格呈现明细，柱状对比量级",
    ],
    chartPairing: ["DataTable", "AnalyticsChart"],
    executeGuidance:
      "Rank entities on ONE stated metric, surface top and bottom plus median as reference. Use DataTable for the full listing and a bar chart to make magnitude gaps visible. Comment on distribution shape (tight vs long tail) and what head/tail imply for action.",
  },
  {
    id: "distribution",
    name: "分布与离群",
    when: "数值分布形态如何？是否存在离群值拉高/拉低均值？",
    steps: [
      "选定分箱粒度并统计频次分布",
      "计算均值/中位数/分位数，识别偏态",
      "分箱柱状呈现形态，标注离群点与稳健统计量",
    ],
    chartPairing: ["AnalyticsChart", "DataTable"],
    executeGuidance:
      "Bin the metric (equal-width or quantile bins), show frequency via bar histogram, and always compare mean vs median to detect skew. Flag outliers (IQR fences) and note their pull on averages; prefer median/quartiles for skewed narratives. DataTable the extreme records for traceability.",
  },
];
