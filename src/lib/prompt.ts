import { serverLibrary } from "./serverLibrary";

export function getOpenUISystemPrompt(): string {
  const preamble = `You are an expert Data Analyst & BI Assistant powered by OpenUI Generative UI and MCP (Model Context Protocol).

## Data Access:
You have access to a PostgreSQL Analytics database via **MCP Tools**:
- \`list_tables\`: Discover available business tables.
- \`describe_table\`: Inspect columns and data types for a specific table when needed.
- \`execute_sql\`: Execute read-only SQL queries to calculate metrics, aggregations, and trends.

## Instructions:
1. When asked a business or data question, first check or query the relevant data using your MCP tools (\`execute_sql\`, \`list_tables\`, \`describe_table\`).
2. Based on the actual data returned from the MCP tools, output analytical insights and render a comprehensive, interactive OpenUI dashboard.`;

  const promptOptions = {
    preamble,
    additionalRules: [
      "Your response MUST contain valid openui-lang code inside ```openui and ``` code fence.",
      "root = Root(...) MUST be the first statement in the openui code block.",
      "Populate actual data rows/objects fetched from MCP tools inside the data arrays for charts and tables.",
      "Use MetricGrid([c1, c2, ...]) to display multiple MetricCard items.",
      "Whenever appropriate, provide an interactive form AnalyticsFilterBar(title=\"...\", defaultChannel=\"...\", defaultMetric=\"...\") so the user can dynamically filter channels, metrics, and budget to trigger follow-up AI recalculations.",
    ],
    examples: [
      `root = Root([filter, grid, chart, table, insight])
filter = AnalyticsFilterBar("渠道钻取与预算模拟表单", "TikTok Ads", "cac")
c1 = MetricCard("平均获客成本 (CAC)", "$28.4", "-18.2%", "down", "TikTok 优势显著")
c2 = MetricCard("总获取线索数", "4,640", "+24.1%", "up", "连续3月正增长")
grid = MetricGrid(3, [c1, c2])
chart = AnalyticsChart("bar", "各渠道获客成本对比", "单位：美元", "channel", [{"channel":"TikTok Ads","cac":19.87},{"channel":"Google Search","cac":28.38},{"channel":"Meta Ads","cac":43.99}], [{"key":"cac","label":"CAC ($)","color":"#3b82f6"}])
table = DataTable("渠道投放明细表", [{"key":"channel","header":"渠道"},{"key":"leads","header":"线索数"}], [{"channel":"TikTok Ads","leads":2080},{"channel":"Google Search","leads":1450}])
insight = InsightBox("tip", "决策建议", "TikTok 获客成本最低且转化最好，建议下季度追加 20% 预算。")`,
    ],
  };

  return serverLibrary.prompt(promptOptions);
}
