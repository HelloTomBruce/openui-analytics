import { defineComponent, createLibrary } from "@openuidev/lang-core";
import { z } from "zod";

export const serverRoot = defineComponent({
  name: "Root",
  description: "页面顶级布局容器",
  props: z.object({
    children: z.array(z.any()).describe("子组件列表"),
  }),
  component: () => null,
});

export const serverMetricCard = defineComponent({
  name: "MetricCard",
  description: "展示单个核心数据指标（KPI）、变化幅度及趋势徽章",
  props: z.object({
    title: z.string().describe("指标卡片标题"),
    value: z.union([z.string(), z.number()]).describe("指标核心数值"),
    change: z.string().optional().describe("环比或同比变化率"),
    trend: z.enum(["up", "down", "neutral"]).optional().describe("趋势方向"),
    subtext: z.string().optional().describe("补充说明文本"),
  }),
  component: () => null,
});

export const serverAnalyticsChart = defineComponent({
  name: "AnalyticsChart",
  description: "多维数据可视化图表，支持折线图(line)、柱状图(bar)、面积图(area)和饼图(pie)",
  props: z.object({
    type: z.enum(["line", "bar", "area", "pie"]).describe("图表类型"),
    title: z.string().optional().describe("图表标题"),
    description: z.string().optional().describe("图表副标题或说明"),
    xAxisKey: z.string().optional().default("name").describe("X轴对应的数据键名"),
    data: z.array(z.record(z.string(), z.any())).describe("结构化图表数据数组"),
    series: z.array(
      z.object({
        key: z.string().describe("对应数据对象中的字段名"),
        label: z.string().optional().describe("显示标签"),
        color: z.string().optional().describe("颜色代码"),
      })
    ).optional().describe("数据序列配置"),
    height: z.number().optional().describe("图表容器高度（像素）"),
  }),
  component: () => null,
});

export const serverDataTable = defineComponent({
  name: "DataTable",
  description: "交互式明细数据表格，支持前端搜索、列排序和一键导出CSV",
  props: z.object({
    title: z.string().optional().describe("表格标题"),
    columns: z.array(
      z.object({
        key: z.string().describe("列字段键名"),
        header: z.string().describe("列显示表头名称"),
        align: z.enum(["left", "center", "right"]).optional().describe("对齐方式"),
      })
    ).optional().describe("表头定义"),
    data: z.array(z.record(z.string(), z.any())).describe("行数据数组"),
    searchable: z.boolean().optional().describe("是否启用搜索框"),
  }),
  component: () => null,
});

export const serverInsightBox = defineComponent({
  name: "InsightBox",
  description: "高亮展示关键分析结论、行动建议或异常警报",
  props: z.object({
    type: z.enum(["tip", "info", "warning", "success"]).optional().describe("提示框类型"),
    title: z.string().optional().describe("提示标题"),
    content: z.string().describe("提示详细内容与分析洞察"),
  }),
  component: () => null,
});

export const serverMetricGrid = defineComponent({
  name: "MetricGrid",
  description: "并排布局多个 MetricCard 指标卡的栅格容器",
  props: z.object({
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional().describe("网格列数"),
    children: z.array(z.any()).describe("子组件列表"),
  }),
  component: () => null,
});

export const serverAnalyticsFilterBar = defineComponent({
  name: "AnalyticsFilterBar",
  description: "供用户二次过滤渠道、切换指标维度、调整模拟预算并触发 AI 重新计算的交互式表单控件",
  props: z.object({
    title: z.string().optional().describe("表单标题"),
    defaultChannel: z.string().optional().describe("默认选中的渠道"),
    defaultMetric: z.string().optional().describe("默认选中的指标维度"),
  }),
  component: () => null,
});

export const serverFunnelChart = defineComponent({
  name: "FunnelChart",
  description: "业务转化旅程与流失漏斗图，用于获客流程、商机跟进与留存各阶段流失率分析",
  props: z.object({
    title: z.string().optional().describe("漏斗图标题"),
    description: z.string().optional().describe("说明描述"),
    stages: z.array(
      z.object({
        name: z.string().describe("阶段名称"),
        value: z.number().describe("该阶段数值量"),
        conversion: z.string().optional().describe("转化率说明"),
        subtext: z.string().optional().describe("补充说明"),
      })
    ).describe("漏斗阶段序列"),
    unit: z.string().optional().describe("数值单位"),
  }),
  component: () => null,
});

export const serverGaugeProgress = defineComponent({
  name: "GaugeProgress",
  description: "目标达成度与核心进度条组件，用于展示年度/季度 KPI、预算消耗进度与超额达成状况",
  props: z.object({
    title: z.string().optional().describe("目标指标标题"),
    description: z.string().optional().describe("副标题或周期说明"),
    current: z.union([z.number(), z.string()]).describe("当前实际完成数值"),
    target: z.union([z.number(), z.string()]).describe("预定目标数值"),
    unit: z.string().optional().describe("指标单位"),
    subtext: z.string().optional().describe("底部辅助说明"),
  }),
  component: () => null,
});

export const serverActionPlanCard = defineComponent({
  name: "ActionPlanCard",
  description: "大模型归因后给出的具体落地措施与优化行动清单，支持交互式点击触发进一步深度拆解",
  props: z.object({
    title: z.string().optional().describe("行动建议清单标题"),
    description: z.string().optional().describe("行动清单背景说明"),
    actions: z.array(
      z.object({
        title: z.string().describe("具体执行措施描述"),
        priority: z.enum(["high", "medium", "low"]).optional().describe("优先级：high 高优, medium 中优, low 日常"),
        impact: z.string().optional().describe("预期收益"),
        owner: z.string().optional().describe("建议责任人"),
        status: z.enum(["todo", "in_progress", "done"]).optional().describe("状态"),
      })
    ).describe("行动建议项列表"),
  }),
  component: () => null,
});

export const serverActivityTimeline = defineComponent({
  name: "ActivityTimeline",
  description: "垂直事件时间线，用于展示 GitLab Merge Request 合并历史、版本发版里程碑或业务事件流",
  props: z.object({
    title: z.string().optional().describe("时间线标题"),
    description: z.string().optional().describe("说明描述"),
    items: z.array(
      z.object({
        time: z.string().describe("发生时间或日期"),
        title: z.string().describe("事件主标题"),
        desc: z.string().optional().describe("详细描述"),
        status: z.enum(["success", "warning", "error", "info"]).optional().describe("节点状态"),
        author: z.string().optional().describe("关联人员或作者"),
        tag: z.string().optional().describe("分支或版本标签"),
      })
    ).describe("时间线事件列表"),
  }),
  component: () => null,
});

export const serverRadarChart = defineComponent({
  name: "RadarChart",
  description: "多维能力与指标画像雷达图，用于销售代表综合胜任力、代码仓库质量多维体检与对比",
  props: z.object({
    title: z.string().optional().describe("雷达图标题"),
    description: z.string().optional().describe("图表说明"),
    data: z.array(z.record(z.string(), z.any())).describe("结构化极坐标数据数组"),
    angleKey: z.string().optional().default("metric").describe("极坐标维度键名"),
    series: z.array(
      z.object({
        key: z.string().describe("对应数据字段名"),
        name: z.string().optional().describe("系列名称"),
        color: z.string().optional().describe("颜色代码"),
      })
    ).optional().describe("系列配置"),
    height: z.number().optional().describe("高度"),
  }),
  component: () => null,
});

export const serverContributionHeatmap = defineComponent({
  name: "ContributionHeatmap",
  description: "活跃度与密度热力图，用于研发团队 Commit 活跃度分布、时段流量或高频获客密度分析",
  props: z.object({
    title: z.string().optional().describe("热力图标题"),
    description: z.string().optional().describe("说明描述"),
    data: z.array(
      z.object({
        date: z.string().optional().describe("日期"),
        day: z.string().optional().describe("星期"),
        count: z.number().describe("频次数值"),
        label: z.string().optional().describe("悬浮标签"),
      })
    ).describe("热力分布数据点"),
    color: z.enum(["green", "blue", "purple"]).optional().describe("色系主题"),
  }),
  component: () => null,
});

export const serverActionButton = defineComponent({
  name: "ActionButton",
  description: "交互动作按钮，支持触发客户端本地工具执行 (Run)、修改状态 (Set) 或向 Agent 发送提示词 (ToAssistant)",
  props: z.object({
    label: z.string().describe("按钮文案"),
    variant: z.enum(["primary", "secondary", "outline", "success", "danger"]).optional().describe("按钮样式主题"),
    icon: z.enum(["play", "download", "copy", "link", "zap"]).optional().describe("图标类型"),
    prompt: z.string().optional().describe("点击后向 AI 发送的分析提问"),
    action: z.any().optional().describe("OpenUI 结构化动作流配置"),
  }),
  component: () => null,
});

export const serverReactiveSimulator = defineComponent({
  name: "ReactiveSimulator",
  description: "响应式预算模拟与本地实时试算器，集成 OpenUI 响应式状态绑定、表单约束校验与客户端一键导出",
  props: z.object({
    title: z.string().optional().describe("试算器标题"),
    defaultBudget: z.number().optional().describe("默认模拟预算金额"),
    channelName: z.string().optional().describe("聚焦分析渠道"),
    currentCac: z.number().optional().describe("基准获客成本 CAC"),
    cvrRate: z.number().optional().describe("预估转化率"),
  }),
  component: () => null,
});

export const serverLibrary = createLibrary({
  components: [
    serverRoot,
    serverMetricCard,
    serverAnalyticsChart,
    serverDataTable,
    serverInsightBox,
    serverMetricGrid,
    serverAnalyticsFilterBar,
    serverFunnelChart,
    serverGaugeProgress,
    serverActionPlanCard,
    serverActivityTimeline,
    serverRadarChart,
    serverContributionHeatmap,
    serverActionButton,
    serverReactiveSimulator,
  ],
  root: "Root",
});

