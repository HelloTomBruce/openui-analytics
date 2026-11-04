/**
 * 活看板生成期捕获（P2-A 第一步）：execute 轮工具调用记录 → queries/bindings。
 *
 * 纯 isomorphic 模块（无 node 依赖，客户端收藏链路直接调用）：
 * - 输入：看板 DSL 全文 + 该看板消息自身的 toolInvocations + 当前启用源
 * - 输出：被看板组件「直接引用」的取数查询（queries）与组件绑定（bindings）
 * - 保守优先：LLM 加工过的数据（计算列/合并/聚合）一律判 derived 不绑定，
 *   宁缺勿错——错误绑定会让后续刷新用错数据回填组件
 *
 * 见 DocMind「看板留存与分享」M3 节与「个人 BI Agent 能力演进路线图」P2-A。
 */
import { createParser } from "@openuidev/react-lang";
import { analyticsLibrary } from "@openui-analytics/components";
import { inferTransform, type TransformSpec } from "./transforms";
// 纯函数下沉到 queryRows（刷新端不经本模块间接引入 React 运行时）；
// 此处再导出保持既有调用方（含测试） import 路径不变
import { extractQueryRows, ROW_PROP_BY_TYPE } from "./queryRows";
export { extractQueryRows, rowPropFor } from "./queryRows";
// 仅取类型（编译期擦除，不会把 server-only 的 dashboardStore 打进客户端包）
import type { DashboardQuery } from "./dashboardStore";

/** execute 轮工具调用记录（AI SDK data stream 附加字段的结构子集） */
export interface CapturedToolCall {
  state?: string;
  toolCallId?: string;
  toolName: string;
  args?: Record<string, unknown> | undefined;
  result?: unknown;
}

/** 捕获输入的源信息（activeSources 的结构子集） */
export interface CaptureSourceInfo {
  id: string;
}

export interface CaptureResult {
  /** 仅含被 bindings 引用的查询（q_ 前缀 id，同查询幂等） */
  queries: DashboardQuery[];
  /** DSL 组件 statementId → query id；derived 组件不出现 */
  bindings: Record<string, string>;
  /**
   * 派生变换绑定（transform 推测 + 一致性验证通过的组件）：
   * statementId → 确定性变换 spec；刷新时先重放 query 再按 spec 重算。
   * 与 bindings 同键出现（transform 绑定也有底层 query）。
   */
  transforms?: Record<string, TransformSpec>;
}

/** 行数组匹配的行数上限（超出视为大规模数据，不做生成期绑定） */
const MATCH_ROW_CAP = 500;

/** 解析器单例：schema 与前端渲染器同源（analyticsLibrary），保证命名映射一致 */
const parser = createParser(analyticsLibrary.toJSONSchema(), "Root");

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** FNV-1a 32 位散列 → 8 位十六进制（查询 id 的确定性来源，无 node:crypto 依赖） */
function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function queryId(sourceId: string, kind: "sql" | "tool", payload: string): string {
  return `q_${fnv1aHex(`${sourceId}\u0000${kind}\u0000${payload}`)}`;
}


interface QueryCandidate {
  id: string;
  sourceId: string;
  kind: "sql" | "tool";
  payload: string;
  rows: Record<string, unknown>[];
}

/**
 * 从工具调用记录提取查询候选：
 * - 仅取已完成（result 存在）且能归属到启用源的调用（工具名 `<sourceId>_<原名>`，
 *   源 id 不含下划线，按首个下划线切分；cross_source_link 等无源前缀工具天然排除）
 * - `<源>_execute_sql` 且 args.sql 为非空字符串 → kind=sql，payload=SQL 文本
 * - 其余 → kind=tool，payload={tool,args} 的 JSON 串
 */
function buildQueryCandidates(
  toolCalls: CapturedToolCall[],
  sources: CaptureSourceInfo[]
): QueryCandidate[] {
  const sourceIds = new Set(sources.map((s) => s.id));
  const candidates: QueryCandidate[] = [];
  for (const call of toolCalls) {
    if (call.result === undefined) continue; // 未完成的调用（state=call/partial-call）
    const sep = call.toolName.indexOf("_");
    if (sep <= 0) continue;
    const sourceId = call.toolName.slice(0, sep);
    if (!sourceIds.has(sourceId)) continue;
    const originalName = call.toolName.slice(sep + 1);
    if (!originalName) continue;

    let kind: "sql" | "tool";
    let payload: string;
    if (originalName === "execute_sql") {
      // execute_sql 缺有效 sql 参数：无重放价值（重放必失败），跳过不产生候选
      if (typeof call.args?.sql !== "string" || call.args.sql.trim().length === 0) {
        continue;
      }
      kind = "sql";
      payload = call.args.sql;
    } else {
      kind = "tool";
      try {
        payload = JSON.stringify({ tool: originalName, args: call.args ?? {} });
      } catch {
        continue; // 参数不可序列化（理论上来自 JSON 流不会发生）
      }
    }

    const rows = extractQueryRows(call.result);
    if (!rows) continue; // 无行数组结果（如 list_tables）无从匹配
    candidates.push({
      id: queryId(sourceId, kind, payload),
      sourceId,
      kind,
      payload,
      rows: rows.slice(0, MATCH_ROW_CAP),
    });
  }
  // 同一查询被重复调用（LLM 重试等）：按 id 去重保留行数最多者，避免误判歧义
  const byId = new Map<string, QueryCandidate>();
  for (const cand of candidates) {
    const prev = byId.get(cand.id);
    if (!prev || cand.rows.length > prev.rows.length) byId.set(cand.id, cand);
  }
  return [...byId.values()];
}

interface ComponentNode {
  statementId: string;
  typeName: string;
  rows: Record<string, unknown>[];
}

/** 递归收集持行数组属性且有 statementId 的组件节点（内联组件无稳定标识，跳过） */
function collectComponentNodes(root: unknown): ComponentNode[] {
  const found: ComponentNode[] = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const node = value as {
      type?: unknown;
      statementId?: unknown;
      typeName?: unknown;
      props?: unknown;
    };
    if (node.type === "element") {
      const prop = typeof node.typeName === "string" ? ROW_PROP_BY_TYPE[node.typeName] : undefined;
      const statementId = typeof node.statementId === "string" ? node.statementId : undefined;
      if (prop && statementId && isPlainObject(node.props)) {
        const raw = node.props[prop];
        if (
          Array.isArray(raw) &&
          raw.length > 0 &&
          raw.every(isPlainObject)
        ) {
          found.push({ statementId, typeName: node.typeName as string, rows: raw as Record<string, unknown>[] });
        }
      }
    }
    // 继续深入 props / 数组 / 嵌套对象寻找子组件节点
    if (isPlainObject(node.props)) {
      for (const v of Object.values(node.props)) walk(v);
    } else if (Array.isArray(value)) {
      for (const v of value) walk(v);
    }
  };
  walk(root);
  return found;
}

/** 数值化比较基元：数字与数字字符串互认（LLM 偶发字符串化），其余严格相等 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const na = asNumber(a);
  const nb = asNumber(b);
  return na !== null && nb !== null && na === nb;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 行键集（截断保护）；空集返回 null */
function rowKeys(rows: Record<string, unknown>[]): Set<string> | null {
  const keys = new Set<string>();
  for (const row of rows.slice(0, MATCH_ROW_CAP)) {
    for (const k of Object.keys(row)) keys.add(k);
  }
  return keys.size > 0 ? keys : null;
}

/**
 * 直取数匹配（保守）：
 * - 组件行全键 ⊆ 结果行键（出现结果没有的键 = 计算列 → derived）
 * - 每个组件行都能在结果中按这些键值匹配（数值容忍数字字符串）
 * - 行数不超过结果行数；且（组件 ≥2 行 或 结果恰 1 行）——
 *   单行组件对多行结果通常是 LLM 聚合加工，判 derived
 */
function isDirectMatch(
  compRows: Record<string, unknown>[],
  compKeys: Set<string>,
  queryRows: Record<string, unknown>[]
): boolean {
  if (compRows.length > queryRows.length) return false;
  if (compRows.length < 2 && queryRows.length !== 1) return false;
  for (const d of compRows) {
    const hit = queryRows.some((r) => {
      for (const k of compKeys) {
        if (!valuesEqual(d[k], r[k])) return false;
      }
      return true;
    });
    if (!hit) return false;
  }
  return true;
}

/**
 * 生成期捕获主入口：DSL + execute 轮工具调用记录 → queries/bindings。
 * 任何内部异常（DSL 解析失败等）静默返回空结果——捕获绝不阻塞收藏主流程。
 */
export function captureDashboardQueries(
  dsl: string,
  toolCalls: CapturedToolCall[],
  sources: CaptureSourceInfo[]
): CaptureResult {
  try {
    const candidates = buildQueryCandidates(toolCalls, sources);
    if (candidates.length === 0) return { queries: [], bindings: {} };

    const parsed = parser.parse(dsl);
    if (!parsed.root) return { queries: [], bindings: {} };
    const components = collectComponentNodes(parsed.root);
    if (components.length === 0) return { queries: [], bindings: {} };

    const bindings: Record<string, string> = {};
    const transforms: Record<string, TransformSpec> = {};
    const usedQueryIds = new Map<string, QueryCandidate>();
    for (const comp of components) {
      const compRows = comp.rows.slice(0, MATCH_ROW_CAP);
      const compKeys = rowKeys(compRows);
      if (!compKeys) continue;

      // 取匹配行数最多的候选；并列 = 歧义，不绑定（宁缺勿错）
      let best: QueryCandidate | null = null;
      let ambiguous = false;
      for (const cand of candidates) {
        if (!isDirectMatch(compRows, compKeys, cand.rows)) continue;
        if (best === null || cand.rows.length > best.rows.length) {
          best = cand;
          ambiguous = false;
        } else if (cand.rows.length === best.rows.length) {
          ambiguous = true;
        }
      }
      if (best && !ambiguous) {
        bindings[comp.statementId] = best.id;
        usedQueryIds.set(best.id, best);
        continue;
      }

      // 第二通道（直取失败）：transform 推测 + 一致性验证。
      // 验证通过 = 「LLM 加工」被固化为确定性 spec，刷新时可零 LLM 重放；
      // 不通过维持纯快照降级。与直取一致的歧义规则：
      // 多个候选都验证通过 = 歧义，不绑定（宁缺勿错）。
      let inferred: { cand: QueryCandidate; spec: TransformSpec } | null = null;
      let inferredAmbiguous = false;
      for (const cand of candidates) {
        const spec = inferTransform(cand.rows, compRows, compKeys);
        if (!spec) continue;
        if (inferred === null) {
          inferred = { cand, spec };
        } else {
          inferredAmbiguous = true;
        }
      }
      if (inferred && !inferredAmbiguous) {
        bindings[comp.statementId] = inferred.cand.id;
        transforms[comp.statementId] = inferred.spec;
        usedQueryIds.set(inferred.cand.id, inferred.cand);
      }
    }

    return {
      queries: [...usedQueryIds.values()].map(({ id, sourceId, kind, payload }) => ({
        id,
        sourceId,
        kind,
        payload,
      })),
      bindings,
      ...(Object.keys(transforms).length > 0 ? { transforms } : {}),
    };
  } catch {
    return { queries: [], bindings: {} };
  }
}
