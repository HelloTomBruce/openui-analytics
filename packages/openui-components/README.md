# @openui-analytics/components

OpenUI 规范展示组件库：15 个 `defineComponent` 组件 + 共享容错基础设施，
经 `createLibrary` 聚合为 `analyticsLibrary`，由 app 侧 `<Renderer library={analyticsLibrary}/>` 渲染。

## 目录分类

| 目录 | 职能 | 组件 |
|---|---|---|
| `src/layout/` | 布局与模板 | `Root`、`MetricGrid`、`ReportLayout`（BI 报表模板） |
| `src/metrics/` | 指标类 | `MetricCard`、`GaugeProgress` |
| `src/charts/` | 图表类（recharts） | `AnalyticsChart`、`FunnelChart`、`RadarChart`、`ContributionHeatmap` |
| `src/data/` | 数据明细 | `DataTable` |
| `src/insight/` | 洞察结论 | `InsightBox`、`ActionPlanCard` |
| `src/timeline/` | 时间线 | `ActivityTimeline` |
| `src/interaction/` | 交互控件 | `AnalyticsFilterBar`、`ActionButton`、`ReactiveSimulator` |
| `src/internal/` | 内部支撑（不承诺稳定） | `ErrorBoundary`、`ComponentSafeWrapper`、`parseProp`、`csv` |

## 布局模板（Layout Templates）

布局组件作为模板概念：嵌在 `Root` 内、按命名区块（zone）组织内容，LLM 按场景选择。

- `ReportLayout(title, subtitle?, kpis?, charts?, detail?, insights?)` — BI 报表：页头 + KPI 横排（4 列栅格）+ 双列图表（奇数个时末张占满整行）+ 全宽明细 + 结论区。适用于周期性综合复盘。
- 不套模板时 = Root 垂直平铺（默认，向后兼容）。

新增模板：在 `layout/` 建文件（区块用 `renderNode(props.xxx)` 渲染），同步 `llm` 包 `serverLibrary.ts` 的 server def（description 写清适用场景，是 LLM 选模板的依据）与 `prompt.ts` 的 few-shot 示例（受 `promptExamples.test.ts` 解析守护）。

## 如何新增一个展示组件

1. **按职能建文件**：在对应分类目录新建 `XxxYyy.tsx`（目录不存在就新建，
   并同步更新 `src/index.ts` 顶部注释与上表）。
2. **同一个文件里写两样东西**：
   - 纯 React 组件 `XxxYyy`（可独立在页面中使用，"use client" 开头）；
   - OpenUI 定义 `XxxYyyDef = defineComponent({ name, description, props, component })`，
     def 内统一用 `<ComponentSafeWrapper name="XxxYyy">` 包裹以隔离单组件故障。
   - props schema 保持宽松容错风格（`z.any().optional()` + 运行时收敛），
     供 LLM 流式半成品输出兜底；LLM 侧强约束在 `@openui-analytics/llm` 的 prompt/schema。
3. **注册一行**：`src/index.ts` 中 import 并加入 `createLibrary({ components: [...] })`。
4. **测试**：交互复杂的组件在旁建 `XxxYyy.test.tsx`（jsdom + @testing-library/react）。
5. **联动（勿漏）**：
   - `@openui-analytics/llm` 的 prompt/schema 若需让大模型知道新组件，同步更新其组件清单；
   - app 的 `globals.css` 已通过 `@source` 覆盖本包全部源码，新目录无需额外配置。

## 约定

- 组件不依赖 app 侧状态（toast、路由、session 等）；需要 app 能力时通过
  `@openuidev/react-lang` 的 action 流（`useTriggerAction` 等）上抛。
- 所有面向 LLM 输出的数组 prop 过 `parseArrayProp` 收敛；CSV 导出统一走 `internal/csv`。
