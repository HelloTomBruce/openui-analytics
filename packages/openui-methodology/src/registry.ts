import { METHOD_ID_RE, type MethodCard } from "./types";

/**
 * 方法库注册表：内置卡 + 自定义卡（业务包 / 用户 JSON 卡）合并契约。
 *
 * 三级扩展的单通道：
 * - custom 同 id **覆盖** builtin（可定制内置行为而非报错）
 * - validateCards 参数化组件名集合（不依赖组件库——由调用方注入，
 *   llm 侧测试传 serverLibrary 组件名，杜绝 methodology → llm 反向依赖）
 * - 无效卡跳过并返回 warnings（沿用 config.ts 容错哲学，不拖垮装配）
 */

export interface MethodLibrary {
  /** 合并后的卡（builtin 顺序保持，custom 追加） */
  cards: MethodCard[];
  find(id: string): MethodCard | undefined;
  /** 卡 id 集合（execute 阶段对 PlanReviewCard 内容匹配用） */
  ids: Set<string>;
}

export interface CardValidationIssue {
  cardId: string;
  reason: string;
}

/** 卡形态校验（不含组件名检查——组件名由 validateCards 参数化完成） */
function isCardShape(v: unknown): v is MethodCard {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    METHOD_ID_RE.test(c.id) &&
    typeof c.name === "string" &&
    c.name.trim().length > 0 &&
    typeof c.when === "string" &&
    Array.isArray(c.steps) &&
    c.steps.length > 0 &&
    c.steps.every((s) => typeof s === "string" && s.trim().length > 0) &&
    Array.isArray(c.chartPairing) &&
    c.chartPairing.length > 0 &&
    c.chartPairing.every((n) => typeof n === "string" && n.trim().length > 0) &&
    typeof c.executeGuidance === "string" &&
    c.executeGuidance.trim().length > 0
  );
}

/**
 * 组件名校验：chartPairing 每项必须存在于调用方传入的合法组件名集合。
 * 返回通过校验的卡与被跳过卡的原因清单。
 */
export function validateCards(
  cards: readonly unknown[],
  validComponentNames: ReadonlySet<string> | readonly string[]
): { valid: MethodCard[]; skipped: CardValidationIssue[] } {
  const names =
    validComponentNames instanceof Set
      ? validComponentNames
      : new Set(validComponentNames);
  const valid: MethodCard[] = [];
  const skipped: CardValidationIssue[] = [];
  for (const raw of cards) {
    if (!isCardShape(raw)) {
      skipped.push({
        cardId: String((raw as { id?: unknown } | null)?.id ?? "<unknown>"),
        reason: "字段形态不完整",
      });
      continue;
    }
    const unknown = raw.chartPairing.filter((n) => !names.has(n));
    if (unknown.length > 0) {
      skipped.push({
        cardId: raw.id,
        reason: `图表配对引用未知组件: ${unknown.join(", ")}`,
      });
      continue;
    }
    valid.push(raw);
  }
  return { valid, skipped };
}

/** 过滤非法形态（静默版：无组件名校验场景，如运行时装配前的初筛） */
export function filterCardShape(cards: unknown[]): { ok: MethodCard[]; skipped: CardValidationIssue[] } {
  const ok: MethodCard[] = [];
  const skipped: CardValidationIssue[] = [];
  for (const c of cards) {
    if (isCardShape(c)) ok.push(c);
    else skipped.push({ cardId: String((c as { id?: unknown })?.id ?? "<unknown>"), reason: "字段形态不完整" });
  }
  return { ok, skipped };
}

/**
 * 组装方法库：builtin + custom 合并（custom 同 id 覆盖 builtin），
 * 传入组件名集合时执行校验并跳过无效卡（warn 交由调用方决定是否打印）。
 */
export function createMethodLibrary(input: {
  builtin: MethodCard[];
  custom?: MethodCard[];
  validComponentNames?: ReadonlySet<string> | readonly string[];
}): { library: MethodLibrary; skipped: CardValidationIssue[] } {
  const merged = new Map<string, MethodCard>();
  const orderedIds: string[] = [];
  const register = (card: MethodCard) => {
    if (!merged.has(card.id)) orderedIds.push(card.id);
    merged.set(card.id, card); // 后写覆盖：custom > builtin
  };
  for (const c of input.builtin) register(c);
  for (const c of input.custom ?? []) register(c);

  let all = [...orderedIds.map((id) => merged.get(id)!)];
  const skipped: CardValidationIssue[] = [];

  // 组件名校验（可选：运行时用户卡可跳过此步只做形态过滤）
  if (input.validComponentNames) {
    const verdict = validateCards(all, input.validComponentNames);
    all = verdict.valid;
    skipped.push(...verdict.skipped);
  } else {
    const verdict = filterCardShape(all);
    all = verdict.ok;
    skipped.push(...verdict.skipped);
  }

  const byId = new Map(all.map((c) => [c.id, c]));
  return {
    library: {
      cards: all,
      find: (id) => byId.get(id),
      ids: new Set(all.map((c) => c.id)),
    },
    skipped,
  };
}
