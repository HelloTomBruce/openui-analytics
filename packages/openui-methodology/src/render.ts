import type { MethodCard } from "./types";

/**
 * 方法卡 → prompt 文本渲染（纯函数，预算硬上限防 token 失守）。
 * - 索引：direct/plan 模式常驻（≤1KB）
 * - 详情：execute 模式按所选方法注入（≤600B/卡）
 */

export const INDEX_BUDGET_BYTES = 1024;
export const DETAIL_BUDGET_BYTES = 600;

/** 索引：每卡一行 `- id：名称——适用信号`，超预算按序截断并标注 */
export function renderMethodIndex(
  cards: MethodCard[],
  budgetBytes = INDEX_BUDGET_BYTES
): string {
  const header = "## Analysis Method Index (pick by the question's intent):";
  const lines = cards.map((c) => `- ${c.id}: ${c.name} — ${c.when}`);
  if (Buffer.byteLength(header + "\n" + lines.join("\n"), "utf-8") <= budgetBytes) {
    return header + "\n" + lines.join("\n");
  }
  // 预算截断：保序保留头部行，标注剩余数
  const kept: string[] = [];
  for (const line of lines) {
    const candidate = [header, ...kept, line, "（其余方法省略）"].join("\n");
    if (Buffer.byteLength(candidate, "utf-8") > budgetBytes) break;
    kept.push(line);
  }
  return [header, ...kept, "（其余方法省略）"].join("\n");
}

/** 详情：execute 模式注入单卡完整指导（超预算截尾 steps） */
export function renderCardDetail(
  card: MethodCard,
  budgetBytes = DETAIL_BUDGET_BYTES
): string {
  const head = `### Method ${card.id} · ${card.name}`;
  const when = `When: ${card.when}`;
  const pairing = `Charts: ${card.chartPairing.join(" + ")}`;
  const full = [head, when, pairing, ...card.steps.map((s, i) => `${i + 1}. ${s}`), `Guidance: ${card.executeGuidance}`];

  // 先尝试全文（多数卡可直接放下）
  if (Buffer.byteLength(full.join("\n"), "utf-8") <= budgetBytes) {
    return full.join("\n");
  }
  // 截尾策略：逐步骤从尾部裁（Guidance 保留在最后，若整体仍超则裁 Guidance）
  const body = full.slice(3); // steps + guidance（已 pop Guidance）
  let guidance = body.pop() ?? "";
  while (
    Buffer.byteLength([head, when, pairing, ...body, guidance].join("\n"), "utf-8") > budgetBytes &&
    body.length > 0
  ) {
    body.pop();
  }
  let out = [head, when, pairing, ...body, guidance].join("\n");
  if (Buffer.byteLength(out, "utf-8") > budgetBytes && guidance) {
    guidance = `Guidance: ${card.executeGuidance.slice(0, Math.max(0, DETAIL_BUDGET_BYTES - 200))}…`;
    out = [head, when, pairing, ...body, guidance].join("\n");
  }
  return out;
}
