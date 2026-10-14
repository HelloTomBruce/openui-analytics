/**
 * 宽松数组 prop 解析：OpenUI 渲染侧对 LLM 输出的容错层。
 * LLM 可能传真正的数组、JSON 字符串、或垃圾值——统一收敛为对象数组。
 *
 * 注意：这是渲染容错层，有意保持宽松；prompt 侧的强约束在 serverLibrary 的 zod schema。
 */
export function parseArrayProp(value: unknown): Array<Record<string, unknown>> {
  let raw: unknown[] = [];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) raw = parsed;
    } catch {
      raw = [];
    }
  }
  return raw.filter(
    (item): item is Record<string, unknown> =>
      item != null && typeof item === "object" && !Array.isArray(item)
  );
}
