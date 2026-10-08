import { defineComponent, createLibrary } from "@openuidev/react-lang";
import { z } from "zod";
import React from "react";
import { MetricCard } from "./MetricCard";
import { AnalyticsChart } from "./AnalyticsChart";
import { DataTable } from "./DataTable";
import { InsightBox } from "./InsightBox";
import { MetricGrid } from "./MetricGrid";
import { AnalyticsFilterBar } from "./AnalyticsFilterBar";

// 1. Root 根容器定义
export const RootComponent = defineComponent({
  name: "Root",
  description: "页面顶级布局容器",
  props: z.object({
    children: z.array(z.any()).describe("子组件列表"),
  }),
  component: ({ props, renderNode }: { props: { children?: React.ReactNode[] }; renderNode?: (node?: unknown) => React.ReactNode }) => {
    return <div className="space-y-4 w-full">{renderNode?.(props?.children)}</div>;
  },
});

// 2. 指标卡定义
export const MetricCardDef = defineComponent({
  name: "MetricCard",
  description: "展示单个核心数据指标（KPI）、变化幅度及趋势徽章",
  props: z.object({
    title: z.string().describe("指标卡片标题"),
    value: z.union([z.string(), z.number()]).describe("指标核心数值"),
    change: z.string().optional().describe("环比或同比变化率"),
    trend: z.enum(["up", "down", "neutral"]).optional().describe("趋势方向"),
    subtext: z.string().optional().describe("补充说明文本"),
  }),
  component: ({ props }: { props: React.ComponentProps<typeof MetricCard> }) => <MetricCard {...props} />,
});

// 3. 多维分析图表定义
export const AnalyticsChartDef = defineComponent({
  name: "AnalyticsChart",
  description: "多维数据可视化图表，支持折线图(line concessions)、柱状图(bar)、面积图(area)和饼图(pie)",
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
  component: ({ props }: { props: React.ComponentProps<typeof AnalyticsChart> }) => <AnalyticsChart {...props} />,
});

// 4. 明细数据表格定义
export const DataTableDef = defineComponent({
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
  component: ({ props }: { props: React.ComponentProps<typeof DataTable> }) => <DataTable {...props} />,
});

// 5. 洞察提示卡定义
export const InsightBoxDef = defineComponent({
  name: "InsightBox",
  description: "高亮展示关键分析结论、行动建议或异常警报",
  props: z.object({
    type: z.enum(["tip", "info", "warning", "success"]).optional().describe("提示框类型"),
    title: z.string().optional().describe("提示标题"),
    content: z.string().describe("提示详细内容与分析洞察"),
  }),
  component: ({ props }: { props: React.ComponentProps<typeof InsightBox> }) => <InsightBox {...props} />,
});

// 6. 指标卡栅格容器定义
export const MetricGridDef = defineComponent({
  name: "MetricGrid",
  description: "并排布局多个 MetricCard 指标卡的栅格容器",
  props: z.object({
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional().describe("网格列数"),
    children: z.array(z.any()).describe("子组件列表"),
  }),
  component: ({ props, renderNode }: { props: { columns?: 2 | 3 | 4; children?: React.ReactNode[] }; renderNode?: (node?: unknown) => React.ReactNode }) => {
    return (
      <MetricGrid columns={props?.columns}>
        {renderNode?.(props?.children)}
      </MetricGrid>
    );
  },
});

// 7. 新增：交互式分析筛选与参数表单组件
export const AnalyticsFilterBarDef = defineComponent({
  name: "AnalyticsFilterBar",
  description: "供用户二次过滤渠道、切换指标维度、调整模拟预算并触发 AI 重新计算的交互式表单控件",
  props: z.object({
    title: z.string().optional().describe("表单标题"),
    defaultChannel: z.string().optional().describe("默认选中的渠道"),
    defaultMetric: z.string().optional().describe("默认选中的指标维度"),
  }),
  component: ({ props }: { props: React.ComponentProps<typeof AnalyticsFilterBar> }) => <AnalyticsFilterBar {...props} />,
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
};
