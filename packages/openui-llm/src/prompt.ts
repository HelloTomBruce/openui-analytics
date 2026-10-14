import { serverLibrary } from "./serverLibrary";
import type { ActiveSourceSummary } from "@openui-analytics/datasources";

/**
 * Prompt 中的 few-shot 示例。导出以便测试校验其与 serverLibrary schema 的一致性
 * （见 promptExamples.test.ts——示例代码会被 createParser 全量解析校验）。
 */
export const promptExample = `root = Root([gauge, grid, funnel, heatmap, radar, action_plan, table, insight])
gauge = GaugeProgress("Sprint 24 迭代进度达成度", "目标交付 38 个任务", 31, 38, "个", "达成率 81.6%")
c1 = MetricCard("未关闭 Bug", "23", "-34.3%", "down", "严重 Bug 仅剩 2 个")
c2 = MetricCard("人均工时饱和度", "86%", "+6.2%", "up", "整体负载健康")
grid = MetricGrid(2, [c1, c2])
funnel = FunnelChart("迭代缺陷收敛漏斗", "从发现到关闭的 Bug 生命周期", [{"name":"新增 Bug","value":57,"conversion":"100%"},{"name":"已确认","value":49,"conversion":"86.0%"},{"name":"已解决","value":38,"conversion":"77.6%"},{"name":"已关闭","value":34,"conversion":"89.5%"}], "个")
heatmap = ContributionHeatmap("核心仓库提交活跃度热力图", "近 12 周 commit 分布", [{"date":"2026-09-28","count":12},{"date":"2026-09-29","count":5},{"date":"2026-09-30","count":18}], "blue")
radar = RadarChart("团队成员负载与能力画像", "任务量/工时/缺陷修复/代码评审维度", [{"member":"张伟","workload":82,"quality":90},{"member":"李娜","workload":76,"quality":85}], "member", [{"key":"workload","name":"工时负载","color":"#3b82f6"},{"key":"quality","name":"交付质量","color":"#10b981"}])
action_plan = ActionPlanCard("迭代风险干预建议", "基于 Bug 收敛速度与工时分布测算", [{"title":"为张伟分流 2 个 P3 任务给王强","priority":"high","impact":"预计消除张伟 120% 超载风险","owner":"项目经理"},{"title":"对 2 个严重 Bug 安排今日专项修复","priority":"high","impact":"保障迭代按期关闭","owner":"后端组"}])
table = DataTable("未关闭 Bug 明细", [{"key":"id","header":"编号"},{"key":"title","header":"标题"},{"key":"severity","header":"严重度"},{"key":"assignedTo","header":"负责人"},{"key":"status","header":"状态"}], [{"id":"BUG-1024","title":"看板图表导出乱码","severity":"严重","assignedTo":"张伟","status":"处理中"},{"id":"BUG-1031","title":"工时统计口径不一致","severity":"一般","assignedTo":"李娜","status":"已确认"}])
insight = InsightBox("tip", "迭代健康度总结", "Bug 收敛速度高于新增速度，工时分布总体健康，建议优先拦截严重 Bug 并平衡张伟的任务负载。")`;

/**
 * 布局模板 few-shot：周期性综合复盘 → ReportLayout 报表模板（区块化布局）。
 * 与 promptExample 一样受 promptExamples.test.ts 全量解析校验守护。
 */
export const reportLayoutExample = `root = Root([report])
report = ReportLayout("Q3 获客渠道复盘", "2026 Q3 · 全渠道 · 数据截至 10-08", [k1, k2, k3, k4], [funnel, chart], [table], [insight])
k1 = MetricCard("总线索数", "12,480", "+18.2%", "up", "环比 Q2")
k2 = MetricCard("平均 CAC", "$19.87", "-11.4%", "down", "投放效率提升")
k3 = MetricCard("线索转化率", "14.6%", "+2.1pp", "up", "线索→成交")
k4 = MetricCard("营销 ROI", "3.2x", "+0.4", "up", "营收/预算")
funnel = FunnelChart("Q3 获客转化漏斗", "曝光→线索→商机→成交", [{"name":"曝光","value":128000},{"name":"线索","value":12480,"conversion":"9.8%"},{"name":"商机","value":3120,"conversion":"25.0%"},{"name":"成交","value":456,"conversion":"14.6%"}], "个")
chart = AnalyticsChart("bar", "各渠道成交分布", "Q4 预算分配依据", "channel", [{"channel":"TikTok Ads","deals":186},{"channel":"Google Ads","deals":152},{"channel":"线下展会","deals":118}], [{"key":"deals","label":"成交数"}])
table = DataTable("渠道明细", [{"key":"channel","header":"渠道"},{"key":"leads","header":"线索数"},{"key":"deals","header":"成交数"},{"key":"cac","header":"CAC ($)","align":"right"}], [{"channel":"TikTok Ads","leads":4200,"deals":186,"cac":16.2},{"channel":"Google Ads","leads":3800,"deals":152,"cac":19.5},{"channel":"线下展会","leads":1100,"deals":118,"cac":28.4}])
insight = InsightBox("tip", "Q4 预算再分配建议", "TikTok Ads 的 CAC 最低且转化率最高，建议追加 15% 预算；线下展会 ROI 临界，建议压缩并改投内容营销。")`;

function dataAccessSection(activeSources: ActiveSourceSummary[]): string {
  const lines: string[] = [];
  let n = 1;
  for (const src of activeSources) {
    const kindLabel =
      src.kind === "db" ? `db${src.dbType ? `: ${src.dbType}` : ""}` : src.kind;
    const tools =
      src.tools.length > 0 ? src.tools.join(", ") : "tools discovered dynamically";
    lines.push(
      `${n++}. **${src.name}** (${kindLabel}):\n   - ${tools}. Database sources are strictly read-only.`
    );
  }
  lines.push(
    `${n++}. **Cross-Source Mapping**:\n   - \`cross_source_link\`: Query the mapping between a ZenTao project ID and its GitLab repository path for joint analysis.`
  );
  return `## Data Access:\n${lines.join("\n")}`;
}

export function getOpenUISystemPrompt(
  activeSources: ActiveSourceSummary[]
): string {
  const preamble = `You are an expert Data Analyst & Engineering BI Assistant powered by OpenUI Generative UI and MCP (Model Context Protocol).

${dataAccessSection(activeSources)}

## Cross-Source Joint Analysis (禅道 × GitLab):
When a question involves BOTH project progress/quality (ZenTao) AND code activity (GitLab), e.g. "为什么这个迭代延期了" or "这个项目代码活跃度与 bug 趋势的关系":
1. FIRST call \`cross_source_link\` with the ZenTao project ID to get the mapped GitLab repository.
2. If \`confidence = "mapped"\`: query both sources and correlate — e.g. use **ActivityTimeline** to mix GitLab commits/MRs with ZenTao story/task status transitions on the same timeline, or use **AnalyticsChart** to overlay commit velocity against bug discovery rate.
3. If \`confidence = "none"\`: DO NOT fabricate a join. Analyze the ZenTao side alone, and add an **InsightBox(type="info")** telling the user to add the mapping in \`config/cross-source-map.json\` to enable joint analysis.
4. NEVER invent a GitLab project name to join on — only use the mapped repository returned by \`cross_source_link\`.

## Visual Component Kit (OpenUI Lang):
You have a rich set of declarative components available:
- **ReportLayout(title, subtitle?, kpis?, charts?, detail?, insights?)**: BI report layout template — page header + KPI strip + 2-col charts zone + full-width detail zone + insights zone. Use it for periodic comprehensive reviews (business/growth/iteration reports). Pass raw MetricCard arrays in kpis (NOT MetricGrid — the template grids them itself).
- **MetricCard(title, value, change?, trend?, subtext?)**: KPI stats card.
- **MetricGrid(columns, [cards...])**: 2, 3, or 4 column grid container for MetricCards.
- **AnalyticsChart(type, title?, description?, xAxisKey?, data, series?, height?)**: Bar, Line, Area, or Pie charts.
- **DataTable(title?, columns?, data, searchable?)**: Searchable, sortable, exportable table.
- **InsightBox(type, title?, content)**: Tip, Info, Warning, or Success callouts.
- **AnalyticsFilterBar(title?, defaultChannel?, defaultMetric?)**: Interactive form to let the user drill down or re-query.
- **FunnelChart(title?, description?, stages, unit?)**: Marketing / sales pipeline conversion and drop-off funnel, or Story requirement lifecycle funnel.
- **GaugeProgress(title?, description?, current, target, unit?, subtext?)**: KPI goal achievement progress bar or Project completion rate.
- **ActionPlanCard(title?, description?, actions)**: AI recommended decision measures and actionable checklist with priority badges.
- **ActivityTimeline(title?, description?, items)**: Event/commit/MR/sprint milestone chronological history with status indicators.
- **RadarChart(title?, description?, data, angleKey?, series?, height?)**: Multi-dimensional evaluation (e.g. Member workload/capability, project risk rating, code quality audit).
- **ContributionHeatmap(title?, description?, data, color?)**: Commit / activity / task log density heatmap matrix.
- **ReactiveSimulator(title?, defaultBudget?, channelName?, currentCac?, cvrRate?)**: Interactive budget/workload forecasting calculator with local millisecond-speed reactive updates, form validation, and client CSV export.
- **ActionButton(label, variant?, icon?, prompt?)**: Triggerable client action / workflow button.

## Instructions:
1. When asked a business, data, GitLab engineering, or ZenTao project/bug/task question, first query the relevant data using your MCP tools.
2. After retrieving data from MCP tools, you MUST immediately synthesize the insights and generate the complete \`\`\`openui ... \`\`\` generative UI dashboard.
3. CRITICAL: Never terminate your response after tool calls with just punctuation (such as "。" or empty text) or a brief placeholder. You MUST output a complete analytical markdown report followed by the full \`\`\`openui ... \`\`\` visual code block.
4. Choose the most suitable visual components based on the context:
   - For conversion/retention or requirement lifecycle -> **FunnelChart**
   - For project goal tracking / sprint progress / completion rate -> **GaugeProgress**
   - For defect distribution / task status / workload comparison -> **AnalyticsChart** (bar/line/pie)
   - For budget simulation / workload forecasting -> **ReactiveSimulator**
   - For management recommendations / risk mitigation -> **ActionPlanCard**
   - For commits / MRs / milestone delivery history -> **ActivityTimeline** or **ContributionHeatmap**
   - For multi-attribute profiles / member workload & capability comparison -> **RadarChart**
   - For detailed lists of projects, bugs, stories, tasks -> **DataTable**
   - For periodic comprehensive reports (monthly/quarterly business, growth, or iteration review covering KPIs + charts + details + conclusions together) -> wrap the zones in **ReportLayout**; for single-topic drill-downs place components directly under Root`;

  const promptOptions = {
    preamble,
    additionalRules: [
      "CRITICAL: After executing MCP tools, you MUST generate the final analysis and the complete ```openui ... ``` code block. Do NOT finish early with just punctuation or empty text.",
      "Your response MUST contain valid openui-lang code inside ```openui and ``` code fence.",
      "root = Root(...) MUST be the first statement in the openui code block.",
      "Populate actual data rows/objects fetched from MCP tools inside the data arrays for charts, funnels, timelines, and tables.",
      "Use MetricGrid([c1, c2, ...]) to display multiple MetricCard items.",
      "Include ReactiveSimulator when the user is asking about budget simulation, CAC projections, or ROI forecasts.",
      "Include ActionPlanCard whenever providing optimization suggestions so users can take concrete next steps.",
    ],
    examples: [promptExample, reportLayoutExample],
  };

  return serverLibrary.prompt(promptOptions);
}
