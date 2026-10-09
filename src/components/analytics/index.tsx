import { defineComponent, createLibrary } from "@openuidev/react-lang";
import { z } from "zod";
import React from "react";
import { MetricCard } from "./MetricCard";
import { AnalyticsChart } from "./AnalyticsChart";
import { DataTable } from "./DataTable";
import { InsightBox } from "./InsightBox";
import { MetricGrid } from "./MetricGrid";
import { AnalyticsFilterBar } from "./AnalyticsFilterBar";
import { FunnelChart } from "./FunnelChart";
import { GaugeProgress } from "./GaugeProgress";
import { ActionPlanCard } from "./ActionPlanCard";
import { ActivityTimeline } from "./ActivityTimeline";
import { RadarChart } from "./RadarChart";
import { ContributionHeatmap } from "./ContributionHeatmap";
import { ActionButton } from "./ActionButton";
import { ReactiveSimulator } from "./ReactiveSimulator";

class ComponentSafeWrapper extends React.Component<
  { children: React.ReactNode; name: string },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; name: string }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.warn(`[OpenUI Local Component Guard in ${this.props.name}]:`, error?.message || error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-xl text-xs text-amber-700 dark:text-amber-400">
          ⚠️ 动态组件「{this.props.name}」正在加载或数据格式解析中...
        </div>
      );
    }
    return this.props.children;
  }
}

// 1. Root 根容器定义
export const RootComponent = defineComponent({
  name: "Root",
  description: "页面顶级布局容器",
  props: z.object({
    children: z.any().optional().describe("子组件列表"),
  }),
  component: ({ props, renderNode }: { props: { children?: unknown }; renderNode?: (node?: unknown) => React.ReactNode }) => {
    const rawChildren = props?.children;
    return (
      <ComponentSafeWrapper name="Root">
        <div className="space-y-4 w-full">
          {renderNode ? renderNode(rawChildren) : null}
        </div>
      </ComponentSafeWrapper>
    );
  },
});

// 2. 指标卡定义
export const MetricCardDef = defineComponent({
  name: "MetricCard",
  description: "展示单个核心数据指标（KPI）、变化幅度及趋势徽章",
  props: z.object({
    title: z.any().optional().describe("指标卡片标题"),
    value: z.any().optional().describe("指标核心数值"),
    change: z.any().optional().describe("环比或同比变化率"),
    trend: z.any().optional().describe("趋势方向"),
    subtext: z.any().optional().describe("补充说明文本"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    const title = String(props?.title ?? "核心指标");
    const value = props?.value !== undefined ? (props.value as string | number) : "-";
    const change = props?.change ? String(props.change) : undefined;
    const trend = (["up", "down", "neutral"].includes(String(props?.trend)) ? props.trend : "neutral") as "up" | "down" | "neutral";
    const subtext = props?.subtext ? String(props.subtext) : undefined;

    return (
      <ComponentSafeWrapper name="MetricCard">
        <MetricCard title={title} value={value} change={change} trend={trend} subtext={subtext} />
      </ComponentSafeWrapper>
    );
  },
});

// 3. 多维分析图表定义
export const AnalyticsChartDef = defineComponent({
  name: "AnalyticsChart",
  description: "多维数据可视化图表，支持折线图(line)、柱状图(bar)、面积图(area)和饼图(pie)",
  props: z.object({
    type: z.any().optional().describe("图表类型"),
    title: z.any().optional().describe("图表标题"),
    description: z.any().optional().describe("图表副标题或说明"),
    xAxisKey: z.any().optional().describe("X轴对应的数据键名"),
    data: z.any().optional().describe("结构化图表数据数组"),
    series: z.any().optional().describe("数据序列配置"),
    height: z.any().optional().describe("图表容器高度（像素）"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    const type = (["line", "bar", "area", "pie"].includes(String(props?.type)) ? props.type : "bar") as "line" | "bar" | "area" | "pie";
    const title = props?.title ? String(props.title) : undefined;
    const description = props?.description ? String(props.description) : undefined;
    const xAxisKey = props?.xAxisKey ? String(props.xAxisKey) : "name";
    const height = typeof props?.height === "number" ? props.height : 280;

    return (
      <ComponentSafeWrapper name="AnalyticsChart">
        <AnalyticsChart
          type={type}
          title={title}
          description={description}
          xAxisKey={xAxisKey}
          data={props?.data as Array<Record<string, unknown>>}
          series={props?.series as Array<{ key: string; label?: string; color?: string }>}
          height={height}
        />
      </ComponentSafeWrapper>
    );
  },
});

// 4. 明细数据表格定义
export const DataTableDef = defineComponent({
  name: "DataTable",
  description: "交互式明细数据表格，支持前端搜索、列排序和一键导出CSV",
  props: z.object({
    title: z.any().optional().describe("表格标题"),
    columns: z.any().optional().describe("表头定义或数据数组"),
    data: z.any().optional().describe("行数据数组"),
    searchable: z.any().optional().describe("是否启用搜索框"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    const title = props?.title ? String(props.title) : undefined;
    let columns = props?.columns;
    let data = props?.data;

    // 容错：如果用户写成 DataTable("标题", data)，2nd 参数为数组时自动处理
    if (Array.isArray(columns) && (!data || !Array.isArray(data))) {
      if (columns.length > 0 && typeof columns[0] === "object" && !("header" in columns[0] && "key" in columns[0])) {
        data = columns;
        columns = undefined;
      }
    }

    return (
      <ComponentSafeWrapper name="DataTable">
        <DataTable
          title={title}
          columns={columns as React.ComponentProps<typeof DataTable>["columns"]}
          data={data as React.ComponentProps<typeof DataTable>["data"]}
          searchable={props?.searchable !== false}
        />
      </ComponentSafeWrapper>
    );
  },
});

// 5. 洞察提示卡定义
export const InsightBoxDef = defineComponent({
  name: "InsightBox",
  description: "高亮展示关键分析结论、行动建议或异常警报",
  props: z.object({
    type: z.any().optional().describe("提示框类型"),
    title: z.any().optional().describe("提示标题"),
    content: z.any().optional().describe("提示详细内容与分析洞察"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    const type = (["tip", "info", "warning", "success"].includes(String(props?.type)) ? props.type : "info") as "tip" | "info" | "warning" | "success";
    let title = props?.title ? String(props.title) : undefined;
    let content = props?.content ? String(props.content) : "";

    // 容错：如果只传了 2 个参数 InsightBox("tip", "长文本内容")
    if (!content && title) {
      content = title;
      title = undefined;
    }

    return (
      <ComponentSafeWrapper name="InsightBox">
        <InsightBox type={type} title={title} content={content} />
      </ComponentSafeWrapper>
    );
  },
});

// 6. 指标卡栅格容器定义
export const MetricGridDef = defineComponent({
  name: "MetricGrid",
  description: "并排布局多个 MetricCard 指标卡的栅格容器",
  props: z.object({
    columns: z.any().optional().describe("网格列数或子组件列表"),
    children: z.any().optional().describe("子组件列表"),
  }),
  component: ({ props, renderNode }: { props: { columns?: unknown; children?: unknown }; renderNode?: (node?: unknown) => React.ReactNode }) => {
    let colNum: 2 | 3 | 4 = 3;
    let rawChildren = props?.children;

    if (Array.isArray(props?.columns)) {
      rawChildren = props.columns;
    } else if (typeof props?.columns === "number" && [2, 3, 4].includes(props.columns)) {
      colNum = props.columns as 2 | 3 | 4;
    }

    return (
      <ComponentSafeWrapper name="MetricGrid">
        <MetricGrid columns={colNum}>
          {renderNode ? renderNode(rawChildren) : null}
        </MetricGrid>
      </ComponentSafeWrapper>
    );
  },
});

// 7. 交互式分析筛选与参数表单组件
export const AnalyticsFilterBarDef = defineComponent({
  name: "AnalyticsFilterBar",
  description: "供用户二次过滤渠道、切换指标维度、调整模拟预算并触发 AI 重新计算的交互式表单控件",
  props: z.object({
    title: z.any().optional().describe("表单标题"),
    defaultChannel: z.any().optional().describe("默认选中的渠道"),
    defaultMetric: z.any().optional().describe("默认选中的指标维度"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <ComponentSafeWrapper name="AnalyticsFilterBar">
        <AnalyticsFilterBar
          title={props?.title ? String(props.title) : undefined}
          defaultChannel={props?.defaultChannel ? String(props.defaultChannel) : undefined}
          defaultMetric={props?.defaultMetric ? String(props.defaultMetric) : undefined}
        />
      </ComponentSafeWrapper>
    );
  },
});

// 8. 转化漏斗图组件定义
export const FunnelChartDef = defineComponent({
  name: "FunnelChart",
  description: "业务转化旅程与流失漏斗图，用于获客流程、商机跟进与留存各阶段流失率分析",
  props: z.object({
    title: z.any().optional().describe("漏斗图标题"),
    description: z.any().optional().describe("说明描述"),
    stages: z.any().optional().describe("漏斗阶段序列"),
    unit: z.any().optional().describe("数值单位，如：人、单、美元"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <ComponentSafeWrapper name="FunnelChart">
        <FunnelChart
          title={props?.title ? String(props.title) : undefined}
          description={props?.description ? String(props.description) : undefined}
          stages={props?.stages as React.ComponentProps<typeof FunnelChart>["stages"]}
          unit={props?.unit ? String(props.unit) : undefined}
        />
      </ComponentSafeWrapper>
    );
  },
});

// 9. 目标达成仪表进度条组件定义
export const GaugeProgressDef = defineComponent({
  name: "GaugeProgress",
  description: "目标达成度与核心进度条组件，用于展示年度/季度 KPI、预算消耗进度与超额达成状况",
  props: z.object({
    title: z.any().optional().describe("目标指标标题"),
    description: z.any().optional().describe("副标题或周期说明"),
    current: z.any().optional().describe("当前实际完成数值"),
    target: z.any().optional().describe("预定目标数值"),
    unit: z.any().optional().describe("指标单位，如：美元、元、单、%"),
    subtext: z.any().optional().describe("底部辅助说明"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <ComponentSafeWrapper name="GaugeProgress">
        <GaugeProgress
          title={props?.title ? String(props.title) : undefined}
          description={props?.description ? String(props.description) : undefined}
          current={props?.current as number | string}
          target={props?.target as number | string}
          unit={props?.unit ? String(props.unit) : undefined}
          subtext={props?.subtext ? String(props.subtext) : undefined}
        />
      </ComponentSafeWrapper>
    );
  },
});

// 10. AI 落地行动建议清单组件定义
export const ActionPlanCardDef = defineComponent({
  name: "ActionPlanCard",
  description: "大模型归因后给出的具体落地措施与优化行动清单，支持交互式点击触发进一步深度拆解",
  props: z.object({
    title: z.any().optional().describe("行动建议清单标题"),
    description: z.any().optional().describe("行动清单背景说明"),
    actions: z.any().optional().describe("行动建议项列表"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <ComponentSafeWrapper name="ActionPlanCard">
        <ActionPlanCard
          title={props?.title ? String(props.title) : undefined}
          description={props?.description ? String(props.description) : undefined}
          actions={props?.actions as React.ComponentProps<typeof ActionPlanCard>["actions"]}
        />
      </ComponentSafeWrapper>
    );
  },
});

// 11. 活动与事件轨迹时间线组件定义
export const ActivityTimelineDef = defineComponent({
  name: "ActivityTimeline",
  description: "垂直事件时间线，用于展示 GitLab Merge Request 合并历史、版本发版里程碑或业务事件流",
  props: z.object({
    title: z.any().optional().describe("时间线标题"),
    description: z.any().optional().describe("说明描述"),
    items: z.any().optional().describe("时间线事件列表"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <ComponentSafeWrapper name="ActivityTimeline">
        <ActivityTimeline
          title={props?.title ? String(props.title) : undefined}
          description={props?.description ? String(props.description) : undefined}
          items={props?.items as React.ComponentProps<typeof ActivityTimeline>["items"]}
        />
      </ComponentSafeWrapper>
    );
  },
});

// 12. 多维综合能力雷达图组件定义
export const RadarChartDef = defineComponent({
  name: "RadarChart",
  description: "多维能力与指标画像雷达图，用于销售代表综合胜任力、代码仓库质量多维体检与对比",
  props: z.object({
    title: z.any().optional().describe("雷达图标题"),
    description: z.any().optional().describe("图表说明"),
    data: z.any().optional().describe("结构化极坐标数据数组"),
    angleKey: z.any().optional().describe("极坐标维度键名，如：metric"),
    series: z.any().optional().describe("系列配置"),
    height: z.any().optional().describe("图表容器高度（像素）"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <ComponentSafeWrapper name="RadarChart">
        <RadarChart
          title={props?.title ? String(props.title) : undefined}
          description={props?.description ? String(props.description) : undefined}
          data={props?.data as Array<Record<string, unknown>>}
          angleKey={props?.angleKey ? String(props.angleKey) : "metric"}
          series={props?.series as React.ComponentProps<typeof RadarChart>["series"]}
          height={typeof props?.height === "number" ? props.height : 300}
        />
      </ComponentSafeWrapper>
    );
  },
});

// 13. 研发提交热力图组件定义
export const ContributionHeatmapDef = defineComponent({
  name: "ContributionHeatmap",
  description: "活跃度与密度热力图，用于研发团队 Commit 活跃度分布、时段流量或高频获客密度分析",
  props: z.object({
    title: z.any().optional().describe("热力图标题"),
    description: z.any().optional().describe("说明描述"),
    data: z.any().optional().describe("热力分布数据点"),
    color: z.any().optional().describe("色系主题"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    const color = (["green", "blue", "purple"].includes(String(props?.color)) ? props.color : "green") as "green" | "blue" | "purple";
    return (
      <ComponentSafeWrapper name="ContributionHeatmap">
        <ContributionHeatmap
          title={props?.title ? String(props.title) : undefined}
          description={props?.description ? String(props.description) : undefined}
          data={props?.data as React.ComponentProps<typeof ContributionHeatmap>["data"]}
          color={color}
        />
      </ComponentSafeWrapper>
    );
  },
});

// 14. 动作按钮组件定义 (支持 OpenUI 动作流 Action Pipelines & Client Tool)
export const ActionButtonDef = defineComponent({
  name: "ActionButton",
  description: "交互动作按钮，支持触发客户端本地工具执行 (Run)、修改状态 (Set) 或向 Agent 发送提示词 (ToAssistant)",
  props: z.object({
    label: z.any().optional().describe("按钮文案"),
    variant: z.any().optional().describe("按钮样式主题"),
    icon: z.any().optional().describe("图标类型"),
    prompt: z.any().optional().describe("点击后向 AI 发送的分析提问"),
    action: z.any().optional().describe("OpenUI 结构化动作流配置"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <ComponentSafeWrapper name="ActionButton">
        <ActionButton
          label={String(props?.label || "点击执行")}
          variant={props?.variant as React.ComponentProps<typeof ActionButton>["variant"]}
          icon={props?.icon as React.ComponentProps<typeof ActionButton>["icon"]}
          prompt={props?.prompt ? String(props.prompt) : undefined}
          action={props?.action}
        />
      </ComponentSafeWrapper>
    );
  },
});

// 15. 响应式本地试算与约束校验模拟器 (Reactive State + Validation + Client Tools)
export const ReactiveSimulatorDef = defineComponent({
  name: "ReactiveSimulator",
  description: "响应式预算模拟与本地实时试算器，集成 OpenUI 响应式状态绑定、表单约束校验与客户端一键导出",
  props: z.object({
    title: z.any().optional().describe("试算器标题"),
    defaultBudget: z.any().optional().describe("默认模拟预算金额"),
    channelName: z.any().optional().describe("聚焦分析渠道"),
    currentCac: z.any().optional().describe("基准获客成本 CAC"),
    cvrRate: z.any().optional().describe("预估转化率"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <ComponentSafeWrapper name="ReactiveSimulator">
        <ReactiveSimulator
          title={props?.title ? String(props.title) : undefined}
          defaultBudget={typeof props?.defaultBudget === "number" ? props.defaultBudget : Number(props?.defaultBudget) || 50000}
          channelName={props?.channelName ? String(props.channelName) : "TikTok Ads"}
          currentCac={typeof props?.currentCac === "number" ? props.currentCac : Number(props?.currentCac) || 20}
          cvrRate={typeof props?.cvrRate === "number" ? props.cvrRate : Number(props?.cvrRate) || 0.1}
        />
      </ComponentSafeWrapper>
    );
  },
});

// 导出标准的 OpenUI Library
export const analyticsLibrary = createLibrary({
  components: [
    RootComponent,
    MetricCardDef,
    AnalyticsChartDef,
    DataTableDef,
    InsightBoxDef,
    MetricGridDef,
    AnalyticsFilterBarDef,
    FunnelChartDef,
    GaugeProgressDef,
    ActionPlanCardDef,
    ActivityTimelineDef,
    RadarChartDef,
    ContributionHeatmapDef,
    ActionButtonDef,
    ReactiveSimulatorDef,
  ],
  root: "Root",
});

export {
  MetricCard,
  AnalyticsChart,
  DataTable,
  InsightBox,
  MetricGrid,
  AnalyticsFilterBar,
  FunnelChart,
  GaugeProgress,
  ActionPlanCard,
  ActivityTimeline,
  RadarChart,
  ContributionHeatmap,
  ActionButton,
  ReactiveSimulator,
};

