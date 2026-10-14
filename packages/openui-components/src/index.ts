"use client";

/**
 * @openui-analytics/components —— OpenUI 规范展示组件库
 *
 * 分类目录（新增组件时按职能放入对应目录，文件内同时持有
 * React 组件与其 defineComponent 定义，最后在下方 library 清单注册一行）：
 *
 *   layout/      布局容器      Root、MetricGrid
 *   metrics/     指标类        MetricCard、GaugeProgress
 *   charts/      图表类        AnalyticsChart、FunnelChart、RadarChart、ContributionHeatmap
 *   data/        数据明细      DataTable
 *   insight/     洞察结论      InsightBox、ActionPlanCard
 *   timeline/    时间线        ActivityTimeline
 *   interaction/ 交互控件      AnalyticsFilterBar、ActionButton、ReactiveSimulator
 *   internal/    内部支撑      ErrorBoundary、ComponentSafeWrapper、parseProp、csv（不对外承诺稳定性）
 *
 * 扩展指南见包内 README.md。
 */

import { createLibrary } from "@openuidev/react-lang";

// layout
import { RootComponent } from "./layout/Root";
import { MetricGrid, MetricGridDef } from "./layout/MetricGrid";
// metrics
import { MetricCard, MetricCardDef } from "./metrics/MetricCard";
import { GaugeProgress, GaugeProgressDef } from "./metrics/GaugeProgress";
// charts
import { AnalyticsChart, AnalyticsChartDef } from "./charts/AnalyticsChart";
import { FunnelChart, FunnelChartDef } from "./charts/FunnelChart";
import { RadarChart, RadarChartDef } from "./charts/RadarChart";
import { ContributionHeatmap, ContributionHeatmapDef } from "./charts/ContributionHeatmap";
// data
import { DataTable, DataTableDef } from "./data/DataTable";
// insight
import { InsightBox, InsightBoxDef } from "./insight/InsightBox";
import { ActionPlanCard, ActionPlanCardDef } from "./insight/ActionPlanCard";
// timeline
import { ActivityTimeline, ActivityTimelineDef } from "./timeline/ActivityTimeline";
// interaction
import { AnalyticsFilterBar, AnalyticsFilterBarDef } from "./interaction/AnalyticsFilterBar";
import { ActionButton, ActionButtonDef } from "./interaction/ActionButton";
import { ReactiveSimulator, ReactiveSimulatorDef } from "./interaction/ReactiveSimulator";

/**
 * OpenUI 组件库：传给 @openuidev/react-lang <Renderer library={...}/> 渲染。
 * root 固定为 "Root"。
 */
export const analyticsLibrary = createLibrary({
  components: [
    RootComponent,
    MetricGridDef,
    MetricCardDef,
    GaugeProgressDef,
    AnalyticsChartDef,
    FunnelChartDef,
    RadarChartDef,
    ContributionHeatmapDef,
    DataTableDef,
    InsightBoxDef,
    ActionPlanCardDef,
    ActivityTimelineDef,
    AnalyticsFilterBarDef,
    ActionButtonDef,
    ReactiveSimulatorDef,
  ],
  root: "Root",
});

// ===== 对外导出：React 组件（可脱离 OpenUI DSL 直接在页面使用）=====
export {
  MetricGrid,
  MetricCard,
  GaugeProgress,
  AnalyticsChart,
  FunnelChart,
  RadarChart,
  ContributionHeatmap,
  DataTable,
  InsightBox,
  ActionPlanCard,
  ActivityTimeline,
  AnalyticsFilterBar,
  ActionButton,
  ReactiveSimulator,
};

// ===== 对外导出：组件定义（组合自定义 library 时复用）=====
export { RootComponent };

// ===== 对外导出：共享基础设施（app 侧 OpenUIRenderer / clientTools 也依赖）=====
export { ErrorBoundary } from "./internal/ErrorBoundary";
export { toCsvContent, downloadCsv, escapeCsvCell } from "./internal/csv";
export { parseArrayProp } from "./internal/parseProp";
