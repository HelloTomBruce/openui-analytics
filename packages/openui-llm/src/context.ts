import type { CoreMessage } from "ai";

/**
 * 上下文治理（投影式压缩）——设计定稿见 TASK-033：
 *
 * 管线：token 计量 → 未超阈值原样直发 → 超阈值走 tool-result pruning →
 * 仍超走 LLM 摘要（缓存在会话元数据）→ 发给模型。
 *
 * - 投影式：存储层永远保存完整历史，本模块只构造「发往模型的投影」
 * - 计量：usage.promptTokens 实测锚点 + 字符启发式增量（无 tokenizer 依赖）
 * - 豁免：用户消息、最近一张 PlanReviewCard 永不裁剪
 * - 触发：估算 prompt > min(窗口 × 0.7, 窗口 − maxTokens − 8k)
 * - 保留窗口：模型窗口 × 25% 的最近消息逐字保留
 */

/** 窗口解析上下限（客户端 hint 与查表值都钳制在此区间） */
export const CONTEXT_WINDOW_MIN = 8192;
export const CONTEXT_WINDOW_MAX = 2_000_000;
/** 未命中查表与 hint 时的保守缺省窗口 */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/** 常见模型窗口查表（前缀匹配，长前缀优先；命中不了回落缺省） */
const MODEL_WINDOW_TABLE: [prefix: string, window: number][] = [
  ["gpt-4o", 128_000],
  ["gpt-4.1", 1_000_000],
  ["gpt-5", 400_000],
  ["o4-mini", 200_000],
  ["o3", 200_000],
  ["claude-", 200_000],
  ["kimi", 262_144],
  ["glm-5", 200_000],
  ["glm-4", 128_000],
  ["deepseek", 128_000],
  ["qwen", 131_072],
  ["gemini", 1_000_000],
];

/**
 * 解析本次请求的上下文窗口：客户端 hint（provider catalog 提供）优先，
 * 其次模型名前缀查表，兜底 128k；结果钳制在 8k–2M。
 */
export function resolveContextWindow(
  model: string,
  clientHint?: unknown
): number {
  const hint = Number(clientHint);
  if (Number.isFinite(hint) && hint > 0) {
    return Math.min(
      Math.max(Math.round(hint), CONTEXT_WINDOW_MIN),
      CONTEXT_WINDOW_MAX
    );
  }
  const lower = model.toLowerCase();
  // 长前缀优先（如 gpt-4.1 先于 gpt-4o 无关顺序地命中正确行）
  const sorted = [...MODEL_WINDOW_TABLE].sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [prefix, window] of sorted) {
    if (lower.startsWith(prefix)) return window;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

export interface ContextBudget {
  window: number;
  /** 估算 prompt 超过此值启动第一道（pruning） */
  triggerAt: number;
  /** 保留窗口：最近消息逐字保留的 token 预算（窗口 × 25%） */
  retainTokens: number;
}

export function computeBudget(
  window: number,
  maxOutputTokens: number
): ContextBudget {
  return {
    window,
    triggerAt: Math.min(Math.floor(window * 0.7), window - maxOutputTokens - 8192),
    retainTokens: Math.floor(window * 0.25),
  };
}

// ========== token 估算（启发式） ==========

const CJK_RE =
  /[一-鿿㐀-䶿䶿豈-﫿぀-ヿ가-힯]/g;

/** 文本 token 估算：CJK ~1.5 字符/token，其余 ~4 字符/token */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(CJK_RE) ?? []).length;
  return Math.ceil((cjk / 1.5 + (text.length - cjk) / 4) * 1.1); // 10% 余量
}

/** 单条消息估算：文本内容 + 结构化 parts 的序列化开销 + 固定结构开销 */
export function estimateMessageTokens(message: unknown): number {
  const m = message as { role?: string; content?: unknown } | null;
  if (!m || typeof m !== "object") return 0;
  let tokens = 8; // role/分隔等结构开销
  if (typeof m.content === "string") {
    tokens += estimateTextTokens(m.content);
  } else if (m.content !== undefined && m.content !== null) {
    tokens += estimateTextTokens(safeSerialize(m.content));
  }
  const rest = m as Record<string, unknown>;
  for (const key of ["parts", "toolInvocations", "annotations"]) {
    if (rest[key] !== undefined) {
      tokens += estimateTextTokens(safeSerialize(rest[key]));
    }
  }
  return tokens;
}

export function estimateMessagesTokens(messages: unknown[]): number {
  let total = 0;
  for (const m of messages) total += estimateMessageTokens(m);
  return total;
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

// ========== 消息形态判定 ==========

function roleOf(m: unknown): string {
  return (m as { role?: unknown } | null)?.role as string ?? "";
}

function textOf(m: unknown): string {
  const content = (m as { content?: unknown } | null)?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string"
          ? (p as { text: string }).text
          : ""
      )
      .join("");
  }
  return "";
}

/** 最近一张 PlanReviewCard 所在 assistant 消息的下标（无则 -1） */
export function findLastPlanReviewIndex(messages: unknown[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (roleOf(messages[i]) !== "assistant") continue;
    if (/PlanReviewCard\s*\(/.test(textOf(messages[i]))) return i;
    break; // 只看最近一条 assistant（与前端 awaitingPlanConfirm 语义一致）
  }
  return -1;
}

/** tool 消息里 tool-result part 的工具名（占位符文案用） */
function toolNamesOf(m: unknown): string[] {
  const content = (m as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (p): p is Record<string, unknown> => p !== null && typeof p === "object"
    )
    .filter((p) => p.type === "tool-result")
    .map((p) => (typeof p.toolName === "string" ? p.toolName : "tool"));
}

/** 裁剪占位符：保留工具名与调用关联（协议完整性），替换原始结果 */
export const PRUNED_PLACEHOLDER = (toolName: string) =>
  `[已裁剪: ${toolName}]`;

// ========== 投影 ==========

export interface ProjectionResult {
  /** 发往模型的消息（pruning 已应用；摘要裁剪由调用方按 summarizeUpToIndex 执行） */
  messages: CoreMessage[];
  /** 是否发生了 pruning */
  pruned: boolean;
  /** 被裁剪的 tool 结果数量 */
  prunedCount: number;
  /** 投影前的 prompt 估算（含 system 与锚点校准） */
  estimatedPromptTokens: number;
  /**
   * ≥0 时：pruning 后仍超阈值，[0..该下标] 需要摘要覆盖后移除；
   * -1 = 无需摘要（直发或 pruning 已足够）
   */
  summarizeUpToIndex: number;
}

/**
 * 构造发往模型的投影。
 * messages 为完整会话历史（存储层原样），本函数不修改入参。
 */
export function projectMessages(opts: {
  messages: CoreMessage[];
  budget: ContextBudget;
  /** usage.promptTokens 实测锚点（会话元数据） */
  anchorTokens?: number;
  /** system prompt 估算 token */
  systemTokens?: number;
}): ProjectionResult {
  const { messages, budget } = opts;
  const overhead = opts.systemTokens ?? 0;
  const heuristic = estimateMessagesTokens(messages);
  const estimated =
    Math.max(heuristic, opts.anchorTokens ?? 0) + overhead;

  // 未超阈值：原样直发（99% 请求路径，零开销）
  if (estimated <= budget.triggerAt) {
    return {
      messages,
      pruned: false,
      prunedCount: 0,
      estimatedPromptTokens: estimated,
      summarizeUpToIndex: -1,
    };
  }

  // 保留窗口：从最新往前累积，直到达到 retainTokens 预算
  let acc = 0;
  let retainFrom = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateMessageTokens(messages[i]);
    if (acc + t > budget.retainTokens && retainFrom < messages.length) {
      retainFrom = i + 1;
      break;
    }
    acc += t;
    retainFrom = i;
  }
  // 极小会话（全部消息都在保留窗口内）仍超阈值 = system 太大或窗口太小，
  // 无可裁剪空间，直接原样发（压无可压，交给模型端报错兜底）
  if (retainFrom <= 0) {
    return {
      messages,
      pruned: false,
      prunedCount: 0,
      estimatedPromptTokens: estimated,
      summarizeUpToIndex: -1,
    };
  }

  // 第一道：pruning（保留窗口以外的 tool 结果替换为占位符）。
  // 豁免是结构性的：pruning 只针对 role=tool——用户消息与 assistant
  // （含最近一张 PlanReviewCard）天然不动。
  const projected = messages.map((m, i) => {
    if (i >= retainFrom) return m; // 保留窗口逐字
    if (roleOf(m) !== "tool") return m; // 用户/assistant 不动（PlanReviewCard 天然豁免）
    const content = (m as { content?: unknown }).content;
    if (!Array.isArray(content)) return m;
    return {
      ...m,
      content: content.map((p) =>
        p !== null &&
        typeof p === "object" &&
        (p as { type?: unknown }).type === "tool-result"
          ? {
              ...(p as Record<string, unknown>),
              result: PRUNED_PLACEHOLDER(
                typeof (p as { toolName?: unknown }).toolName === "string"
                  ? ((p as { toolName: string }).toolName)
                  : "tool"
              ),
            }
          : p
      ),
    } as CoreMessage;
  });
  const prunedCount = messages
    .slice(0, retainFrom)
    .reduce((n, m) => n + toolNamesOf(m).length, 0);

  // pruning 后重估（锚点已失效——内容变了，回到纯启发式）
  const afterPrune = estimateMessagesTokens(projected) + overhead;
  const needSummary = afterPrune > budget.triggerAt;

  return {
    messages: projected,
    pruned: prunedCount > 0,
    prunedCount,
    estimatedPromptTokens: afterPrune,
    summarizeUpToIndex: needSummary ? retainFrom - 1 : -1,
  };
}

/**
 * 摘要裁剪后的边界清理：
 * - 丢弃开头的孤儿 tool 消息（其 tool-call 已被裁掉，provider 会报协议错）
 * - 保证首条为 user（部分 provider 强制）
 */
export function trimAfterSummaryCut(messages: CoreMessage[]): CoreMessage[] {
  let start = 0;
  while (start < messages.length && roleOf(messages[start]) === "tool") {
    start++;
  }
  const trimmed = messages.slice(start);
  // 裁空或首条非 user（部分 provider 强制首条 user）：补一条衔接消息
  if (trimmed.length === 0 || roleOf(trimmed[0]) !== "user") {
    return [
      {
        role: "user",
        content: "（以上是此前会话的摘要，请基于此继续当前任务。）",
      } as CoreMessage,
      ...trimmed,
    ];
  }
  return trimmed;
}

// ========== LLM 摘要 ==========

/** 摘要生成输入的序列化：每条消息截断 4000 字符（tool 结果已被裁剪/无需全文） */
function serializeForSummary(messages: CoreMessage[]): string {
  return messages
    .map((m) => {
      const text = textOf(m);
      const clipped = text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
      return `[${roleOf(m)}] ${clipped}`;
    })
    .join("\n\n");
}

export function buildSummaryPrompt(opts: {
  covered: CoreMessage[];
  previousSummary?: string;
}): string {
  const { covered, previousSummary } = opts;
  return `你是一个数据分析会话的压缩器。把下面的会话历史压缩成一份中文摘要（不超过 1200 字），供后续对话作为背景使用。

必须保留：
1. 用户的原始分析目标与每一轮追问
2. 已确认的分析方案（PlanReviewCard 的方法、步骤、数据源选择）
3. 关键结论与数字（指标值、排名、异常点）
4. 用过的数据源、表名、关键字段与过滤条件
5. 未解决的澄清问题或用户偏好

必须丢弃：工具的原始输出细节、看板 DSL 代码、重复的客套话。
${previousSummary ? `\n此前的摘要（请在其基础上增量更新，不要重复劳动）：\n${previousSummary}\n` : ""}
需要压缩的会话历史：
${serializeForSummary(covered)}`;
}

/** 摘要输出上限（设计定稿：2k token） */
export const SUMMARY_MAX_TOKENS = 2048;
