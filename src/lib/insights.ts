/**
 * 主动洞察：关键指标环比异常检测（纯函数，无副作用）。
 */

export interface MetricSnapshot {
  metric: string;
  current: number;
  baseline: number;
}

export interface Insight {
  metric: string;
  level: "warning" | "critical";
  changePct: number;
  current: number;
  baseline: number;
  message: string;
}

const WARNING_THRESHOLD = 30;
const CRITICAL_THRESHOLD = 50;

/**
 * 环比偏差（绝对值）> 30% 产出 warning，> 50% 产出 critical。
 * baseline 为 0 时无法计算环比，跳过该指标。
 */
export function detectAnomalies(metrics: MetricSnapshot[]): Insight[] {
  const insights: Insight[] = [];
  for (const m of metrics) {
    if (m.baseline === 0) continue;
    const changePct = ((m.current - m.baseline) / Math.abs(m.baseline)) * 100;
    const abs = Math.abs(changePct);
    if (abs <= WARNING_THRESHOLD) continue;

    const level = abs > CRITICAL_THRESHOLD ? "critical" : "warning";
    const direction = changePct > 0 ? "上升" : "下降";
    insights.push({
      metric: m.metric,
      level,
      changePct,
      current: m.current,
      baseline: m.baseline,
      message: `${m.metric} 环比${direction} ${abs.toFixed(1)}%（${m.baseline} → ${m.current}），超过${level === "critical" ? " 50% 严重" : " 30% 预警"}阈值`,
    });
  }
  return insights;
}
