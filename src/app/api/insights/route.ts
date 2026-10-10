import { callMcpTool } from "@/mcp/mcpClient";
import { detectAnomalies, type MetricSnapshot, type Insight } from "@/lib/insights";

interface TrendsRow {
  month: string;
  revenue: number;
  marketing_cost: number;
  new_leads: number;
  paying_customers: number;
}

const METRIC_LABELS: Array<{ key: keyof Omit<TrendsRow, "month">; label: string }> = [
  { key: "revenue", label: "营收" },
  { key: "marketing_cost", label: "营销成本" },
  { key: "new_leads", label: "新增线索数" },
  { key: "paying_customers", label: "付费客户数" },
];

/**
 * GET /api/insights
 * 拉取最近两期月度指标计算环比快照，运行异常检测，返回洞察列表。
 * 任何数据源失败都返回 200 + { insights: [], error }，绝不 500。
 */
export async function GET() {
  try {
    const result = (await callMcpTool("execute_sql", {
      sql: "SELECT month, revenue, marketing_cost, new_leads, paying_customers FROM monthly_trends ORDER BY month DESC LIMIT 2",
    })) as { rows?: TrendsRow[] };

    const rows = result?.rows ?? [];
    let insights: Insight[] = [];

    if (rows.length >= 2) {
      const [current, baseline] = rows;
      const snapshots: MetricSnapshot[] = METRIC_LABELS.map(({ key, label }) => ({
        metric: label,
        current: Number(current[key]),
        baseline: Number(baseline[key]),
      }));
      insights = detectAnomalies(snapshots);
    }

    return Response.json({ insights, generatedAt: new Date().toISOString() });
  } catch (err) {
    return Response.json(
      {
        insights: [],
        error: err instanceof Error ? err.message : String(err),
        generatedAt: new Date().toISOString(),
      },
      { status: 200 }
    );
  }
}
