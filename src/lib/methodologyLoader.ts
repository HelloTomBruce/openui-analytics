import fs from "node:fs";
import path from "node:path";
import {
  builtinMethodCards,
  createMethodLibrary,
  filterCardShape,
  type CardValidationIssue,
  type MethodCard,
  type MethodLibrary,
} from "@openui-analytics/methodology";

/**
 * 用户方法卡运行时加载（三级扩展的第三级）：
 * 启动读 data/methodology/*.json → 形态过滤 → 与内置卡合并（同 id 覆盖内置）。
 *
 * - 单文件支持「单卡对象」或「卡数组」两种形态
 * - 坏 JSON / 形态不完整的卡跳过并 console.warn（不拖垮启动，容错哲学同 config.ts）
 * - validComponentNames 可选：传入时启用卡↔组件名校验（validateCards），
 *   缺省只做形态过滤（组件名错卡的兜底是渲染层 ErrorBoundary）
 */

export const USER_METHOD_CARDS_DIR = path.join(
  process.cwd(),
  "data",
  "methodology"
);

/** 读取用户卡目录；目录不存在视为零卡（正常态，非错误） */
export function loadUserMethodCards(
  dir: string = USER_METHOD_CARDS_DIR
): { cards: MethodCard[]; skipped: CardValidationIssue[] } {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { cards: [], skipped: [] };
  }

  const raw: unknown[] = [];
  const skipped: CardValidationIssue[] = [];
  for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
    const file = path.join(dir, name);
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (Array.isArray(parsed)) raw.push(...parsed);
      else raw.push(parsed);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      skipped.push({ cardId: name, reason: `JSON 解析失败: ${reason}` });
      console.warn(`[methodology] 跳过坏卡文件 ${name}: ${reason}`);
    }
  }

  const { ok, skipped: shapeSkipped } = filterCardShape(raw);
  for (const s of shapeSkipped) {
    console.warn(`[methodology] 跳过形态不完整卡: ${s.cardId}（${s.reason}）`);
  }
  return { cards: ok, skipped: [...skipped, ...shapeSkipped] };
}

/** 组装应用方法论库：内置 10 卡 + 用户卡（同 id 覆盖内置），供 handler 注入 */
export function createAppMethodology(
  dir: string = USER_METHOD_CARDS_DIR
): {
  library: MethodLibrary;
  skipped: CardValidationIssue[];
  /** 用户卡 id 集合（含覆盖内置的 id）——查看入口据此判定卡来源 */
  userIds: Set<string>;
} {
  const { cards, skipped } = loadUserMethodCards(dir);
  return {
    ...createMethodLibrary({ builtin: builtinMethodCards, custom: cards }),
    skipped,
    userIds: new Set(cards.map((c) => c.id)),
  };
}
