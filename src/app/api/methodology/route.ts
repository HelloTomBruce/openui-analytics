import { builtinMethodCards } from "@openui-analytics/methodology";
import { createAppMethodology } from "@/lib/methodologyLoader";

/**
 * GET /api/methodology — 分析方法论查看入口的数据源。
 * 返回与分析时实际注入一致的合并卡集（内置 + data/methodology/*.json 用户卡）。
 * executeGuidance 是 LLM prompt 内部件，不进查看契约。
 * 鉴权由 middleware 统一拦截 /api/*，本层不再重复校验。
 */
export async function GET() {
  try {
    const { library, skipped, userIds } = createAppMethodology();
    const builtinIds = new Set(builtinMethodCards.map((c) => c.id));
    let overridden = 0;
    for (const id of userIds) {
      if (builtinIds.has(id)) overridden++;
    }
    return Response.json({
      cards: library.cards.map(
        ({ id, name, when, steps, chartPairing }) => ({
          id,
          name,
          when,
          steps,
          chartPairing,
          source: userIds.has(id) ? ("user" as const) : ("builtin" as const),
        })
      ),
      counts: {
        builtin: builtinMethodCards.length,
        user: userIds.size,
        overridden,
      },
      skipped,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
