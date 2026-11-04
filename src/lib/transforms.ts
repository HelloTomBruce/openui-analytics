/**
 * 声明式变换管线（isomorphic，无 node 依赖）：
 * 把「LLM 一次性加工」固化为可重放的确定性 spec——收藏时随看板落盘，
 * 刷新时服务端按 spec 重算，全程零 LLM。
 *
 * 封闭算子词汇表（安全边界：无任意代码，表达式仅字段名/数字/四则/括号）：
 * - aggregate: groupBy + metrics（sum/avg/count/min/max）
 * - compute: 受限四则表达式派生列（如 cac = spend / leads）
 * - sort / limit: 排序与截断
 *
 * 捕获侧（dashboardCapture）用 inferTransform 推测 + verifyTransform 一致性验证；
 * 刷新侧（dashboardRefresh）用 applyTransform 重算回填。
 */

export type AggregateFn = "sum" | "avg" | "count" | "min" | "max";

export interface ComputeField {
  /** 派生列名 */
  field: string;
  /** 受限四则表达式：字段名/数字/+ - * /与括号，如 "spend / leads" */
  expr: string;
}

export interface TransformSpec {
  op: "aggregate";
  /** 分组键（≥1） */
  groupBy: string[];
  /** 输出字段 → 聚合方式（字段名与输入列同名） */
  metrics: Record<string, AggregateFn>;
  /** 派生列（在聚合结果上按行计算） */
  compute?: ComputeField[];
  /** 排序（单键，数值感知） */
  sort?: { key: string; desc?: boolean };
  /** 截断 */
  limit?: number;
}

export const TRANSFORM_GROUP_BY_MAX = 3;
export const TRANSFORM_METRICS_MAX = 12;
export const TRANSFORM_COMPUTE_MAX = 6;
export const TRANSFORM_EXPR_MAX = 200;
export const TRANSFORM_LIMIT_MAX = 10_000;
const AGGREGATE_FNS: AggregateFn[] = ["sum", "avg", "count", "min", "max"];

/** 表达式合法字符集（标识符/数字/空白/四则/括号/小数点，整体匹配） */
const EXPR_SAFE_RE = /^[\w$+\-*/().\d\s]+$/;
/** 函数调用形态（标识符后直接跟括号）：词汇表不支持函数，一律拒绝 */
const EXPR_FUNC_CALL_RE = /[A-Za-z_$][\w$]*\s*\(/;
/** 表达式取数字：比较与求值共用；数字字符串互认（LLM 偶发字符串化） */
function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 受限四则表达式求值（递归下降，无 eval）。
 * 词法：标识符（查行字段）、数字、+ - * / ( )；非法输入返回 null。
 */
export function evalExpr(
  expr: string,
  row: Record<string, unknown>
): number | null {
  if (
    expr.length > TRANSFORM_EXPR_MAX ||
    !EXPR_SAFE_RE.test(expr) ||
    EXPR_FUNC_CALL_RE.test(expr)
  ) {
    return null;
  }
  let pos = 0;

  function skipWs() {
    while (pos < expr.length && /\s/.test(expr[pos])) pos++;
  }
  function peek() {
    skipWs();
    return expr[pos];
  }
  function parseExpr(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    for (;;) {
      const c = peek();
      if (c === "+" || c === "-") {
        pos++;
        const right = parseTerm();
        if (right === null) return null;
        left = c === "+" ? left + right : left - right;
      } else {
        return left;
      }
    }
  }
  function parseTerm(): number | null {
    let left = parseFactor();
    if (left === null) return null;
    for (;;) {
      const c = peek();
      if (c === "*" || c === "/") {
        pos++;
        const right = parseFactor();
        if (right === null) return null;
        left = c === "*" ? left * right : left / right;
      } else {
        return left;
      }
    }
  }
  function parseFactor(): number | null {
    const c = peek();
    if (c === "(") {
      pos++;
      const v = parseExpr();
      if (v === null || peek() !== ")") return null;
      pos++;
      return v;
    }
    if (c === "-") {
      pos++;
      const v = parseFactor();
      return v === null ? null : -v;
    }
    if (/\d|\./.test(c ?? "")) {
      const m = /^\d*\.?\d+/.exec(expr.slice(pos));
      if (!m) return null;
      pos += m[0].length;
      return Number(m[0]);
    }
    if (/[A-Za-z_$]/.test(c ?? "")) {
      const m = /^[A-Za-z_$][\w$]*/.exec(expr.slice(pos));
      if (!m) return null;
      pos += m[0].length;
      return asNumber(row[m[0]]);
    }
    return null;
  }

  const value = parseExpr();
  skipWs();
  if (pos !== expr.length || value === null || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

/** spec 形态校验（捕获落盘与刷新重放入口共用；非法 spec 一律拒绝） */
export function isValidTransformSpec(raw: unknown): raw is TransformSpec {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return false;
  }
  const spec = raw as Record<string, unknown>;
  if (spec.op !== "aggregate") return false;
  if (
    !Array.isArray(spec.groupBy) ||
    spec.groupBy.length < 1 ||
    spec.groupBy.length > TRANSFORM_GROUP_BY_MAX ||
    !spec.groupBy.every((k) => typeof k === "string" && k.length > 0 && k.length <= 64)
  ) {
    return false;
  }
  if (
    typeof spec.metrics !== "object" ||
    spec.metrics === null ||
    Array.isArray(spec.metrics)
  ) {
    return false;
  }
  const metricEntries = Object.entries(spec.metrics as Record<string, unknown>);
  if (
    metricEntries.length < 1 ||
    metricEntries.length > TRANSFORM_METRICS_MAX ||
    !metricEntries.every(
      ([k, v]) =>
        k.length > 0 && k.length <= 64 && AGGREGATE_FNS.includes(v as AggregateFn)
    )
  ) {
    return false;
  }
  if (spec.compute !== undefined) {
    if (
      !Array.isArray(spec.compute) ||
      spec.compute.length > TRANSFORM_COMPUTE_MAX ||
      !spec.compute.every(
        (c) =>
          typeof c === "object" &&
          c !== null &&
          typeof (c as ComputeField).field === "string" &&
          (c as ComputeField).field.length > 0 &&
          typeof (c as ComputeField).expr === "string" &&
          (c as ComputeField).expr.length > 0 &&
          (c as ComputeField).expr.length <= TRANSFORM_EXPR_MAX &&
          EXPR_SAFE_RE.test((c as ComputeField).expr) &&
          !EXPR_FUNC_CALL_RE.test((c as ComputeField).expr)
      )
    ) {
      return false;
    }
  }
  if (spec.sort !== undefined) {
    const s = spec.sort as Record<string, unknown>;
    if (
      typeof s !== "object" ||
      s === null ||
      typeof s.key !== "string" ||
      (s.desc !== undefined && typeof s.desc !== "boolean")
    ) {
      return false;
    }
  }
  if (spec.limit !== undefined) {
    if (
      typeof spec.limit !== "number" ||
      !Number.isInteger(spec.limit) ||
      spec.limit < 1 ||
      spec.limit > TRANSFORM_LIMIT_MAX
    ) {
      return false;
    }
  }
  return true;
}

/** 确定性重放：rows → 聚合 → 派生列 → 排序 → 截断（纯函数，输入不被修改） */
export function applyTransform(
  rows: Record<string, unknown>[],
  spec: TransformSpec
): Record<string, unknown>[] {
  // 1) 分组聚合
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = JSON.stringify(spec.groupBy.map((k) => row[k] ?? null));
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  let out: Record<string, unknown>[] = [];
  for (const bucket of groups.values()) {
    const outRow: Record<string, unknown> = {};
    for (const k of spec.groupBy) outRow[k] = bucket[0][k];
    for (const [field, fn] of Object.entries(spec.metrics)) {
      const nums = bucket
        .map((r) => asNumber(r[field]))
        .filter((n): n is number => n !== null);
      switch (fn) {
        case "sum":
          outRow[field] = nums.reduce((a, b) => a + b, 0);
          break;
        case "avg":
          outRow[field] =
            nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
          break;
        case "count":
          outRow[field] = bucket.filter((r) => r[field] !== undefined && r[field] !== null).length;
          break;
        case "min":
          outRow[field] = nums.length > 0 ? Math.min(...nums) : null;
          break;
        case "max":
          outRow[field] = nums.length > 0 ? Math.max(...nums) : null;
          break;
      }
    }
    out.push(outRow);
  }

  // 2) 派生列（求值失败置 null，不中断整体）
  if (spec.compute) {
    out = out.map((row) => {
      const next = { ...row };
      for (const c of spec.compute ?? []) {
        next[c.field] = evalExpr(c.expr, next);
      }
      return next;
    });
  }

  // 3) 排序（数值感知；混型时字符串字典序兜底，稳定）
  if (spec.sort) {
    out = sortRows(out, spec.sort.key, spec.sort.desc ?? false);
  }

  // 4) 截断
  if (spec.limit !== undefined) out = out.slice(0, spec.limit);

  return out;
}

/** 排序（数值感知；混型时字符串字典序兜底，稳定） */
function sortRows(
  rows: Record<string, unknown>[],
  key: string,
  desc: boolean
): Record<string, unknown>[] {
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const na = asNumber(a[key]);
    const nb = asNumber(b[key]);
    if (na !== null && nb !== null) return (na - nb) * dir;
    return String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * dir;
  });
}

/** 数值比较容差：LLM 写组件行常四舍五入，重算值按相对 1e-3 + 绝对 1e-9 容差互认 */
const VERIFY_REL_TOL = 1e-3;
const VERIFY_ABS_TOL = 1e-9;

export function valuesClose(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) {
    return (
      Math.abs(na - nb) <=
      Math.max(VERIFY_ABS_TOL, VERIFY_REL_TOL * Math.max(Math.abs(na), Math.abs(nb)))
    );
  }
  return false;
}

/**
 * 一致性验证（捕获时的安全闸门）：spec 重算结果必须与组件实际数据
 * 多重集全等（行数、每行每个键）——验证不过则维持纯快照降级。
 * 比较忽略行序（sort 属于展示语义，不影响绑定正确性）。
 */
export function verifyTransform(
  queryRows: Record<string, unknown>[],
  spec: TransformSpec,
  compRows: Record<string, unknown>[],
  compKeys: Set<string>
): boolean {
  const out = applyTransform(queryRows, spec);
  if (out.length !== compRows.length) return false;

  const remaining = [...out];
  for (const compRow of compRows) {
    const hit = remaining.findIndex((outRow) => {
      for (const k of compKeys) {
        const a = compRow[k];
        const b = outRow[k];
        if (typeof a === "number" || typeof b === "number") {
          if (!valuesClose(a, b)) return false;
        } else if (!valuesClose(a, b)) {
          return false;
        }
      }
      return true;
    });
    if (hit === -1) return false;
    remaining.splice(hit, 1);
  }
  return true;
}

/** 推测的搜索上限：分组键候选数量与表达式字段对数量（防爆） */
const INFER_MAX_GROUP_KEYS = 6;
const INFER_MAX_EXPR_FIELD_PAIRS = 8;

/**
 * transform 推测（直接行匹配失败后的第二通道）：
 * 1) 分组键候选：查询与组件共有的字符串键（单键优先，其次双键）
 * 2) 指标：共有数值键一律按 sum 聚合建帧
 * 3) 派生列：组件多出的数值键在帧字段对内搜索 + - * /
 * 4) 候选 spec 全部过 verifyTransform 才返回，否则 null（宁缺勿错）
 */
export function inferTransform(
  queryRows: Record<string, unknown>[],
  compRows: Record<string, unknown>[],
  compKeys: Set<string>
): TransformSpec | null {
  if (queryRows.length === 0 || compRows.length === 0) return null;
  if (compRows.length >= queryRows.length) return null; // 聚合必然收敛行数

  const queryKeys = new Set<string>();
  for (const row of queryRows.slice(0, 50)) {
    for (const k of Object.keys(row)) queryKeys.add(k);
  }

  // 共有字符串键（分组候选）与共有数值键（指标候选）
  const sharedKeys = [...compKeys].filter((k) => queryKeys.has(k));
  const stringKeys = sharedKeys
    .filter((k) => queryRows.every((r) => typeof r[k] === "string"))
    .slice(0, INFER_MAX_GROUP_KEYS);
  const numericShared = sharedKeys.filter((k) =>
    queryRows.some((r) => asNumber(r[k]) !== null)
  );
  if (stringKeys.length === 0 || numericShared.length === 0) return null;

  // 分组键候选：单键 → 双键（不追三键，收益递减且爆炸）
  const groupCandidates: string[][] = [
    ...stringKeys.map((k) => [k]),
    ...stringKeys.flatMap((a, i) =>
      stringKeys.slice(i + 1).map((b) => [a, b])
    ),
  ];

  const missingCompKeys = [...compKeys].filter(
    (k) => !queryKeys.has(k)
  );

  for (const groupBy of groupCandidates) {
    const metrics: Record<string, AggregateFn> = {};
    for (const k of numericShared) metrics[k] = "sum";
    const baseSpec: TransformSpec = { op: "aggregate", groupBy, metrics };
    const frame = applyTransform(queryRows, baseSpec);
    if (frame.length === 0) continue;

    // 派生列推测：缺失键在帧数值字段对内搜索四则表达式
    const compute: ComputeField[] = [];
    let allSolved = true;
    for (const missing of missingCompKeys) {
      // 只推测数值型缺失键（字符串缺失键多半是 LLM 改写，不安全）
      if (!compRows.some((r) => asNumber(r[missing]) !== null)) {
        allSolved = false;
        break;
      }
      const expr = searchExpr(frame, compRows, missing, numericShared);
      if (!expr) {
        allSolved = false;
        break;
      }
      compute.push({ field: missing, expr });
    }
    if (!allSolved) continue;

    const spec: TransformSpec = {
      ...baseSpec,
      ...(compute.length > 0 ? { compute } : {}),
      ...inferSortLimit(frame, compRows, compKeys),
    };
    if (verifyTransform(queryRows, spec, compRows, compKeys)) {
      return spec;
    }
  }
  return null;
}

/** 在帧字段对内搜索能复现缺失键的四则表达式（限对数防爆） */
function searchExpr(
  frame: Record<string, unknown>[],
  compRows: Record<string, unknown>[],
  missing: string,
  fields: string[]
): string | null {
  const pairs: [string, string][] = [];
  outer: for (let i = 0; i < fields.length; i++) {
    for (let j = 0; j < fields.length; j++) {
      if (i === j) continue;
      pairs.push([fields[i], fields[j]]);
      if (pairs.length >= INFER_MAX_EXPR_FIELD_PAIRS) break outer;
    }
  }
  const ops = ["/", "*", "+", "-"] as const;
  for (const [a, b] of pairs) {
    for (const op of ops) {
      const expr = `${a} ${op} ${b}`;
      // 逐帧行求值，与组件行同键值集合比对（容差互认）
      const frameValues = frame.map((r) => evalExpr(expr, r));
      const compValues = compRows.map((r) => asNumber(r[missing]));
      if (compValues.some((v) => v === null)) return null;
      const unmatched = new Set(compValues as number[]);
      let covered = 0;
      for (const v of frameValues) {
        if (v === null) continue;
        for (const c of unmatched) {
          if (valuesClose(v, c)) {
            unmatched.delete(c);
            covered++;
            break;
          }
        }
      }
      if (covered === compRows.length && unmatched.size === 0) return expr;
    }
  }
  return null;
}

/**
 * 排序/截断推测：
 * - 组件行是帧子集（top N）：寻找使组件行成为「帧按某键排序后的有序前缀」的键
 *   → sort + limit（无前缀键可解释则不推测，交由 verify 否决）
 * - 完整覆盖：组件行在某数值字段单调 → sort（稳定重放顺序）
 */
function inferSortLimit(
  frame: Record<string, unknown>[],
  compRows: Record<string, unknown>[],
  compKeys: Set<string>
): Pick<TransformSpec, "sort" | "limit"> {
  const out: Pick<TransformSpec, "sort" | "limit"> = {};

  if (compRows.length < frame.length) {
    // 子集场景：compRows 必须恰好是排序帧的前缀（逐位容差比对）
    for (const k of compKeys) {
      for (const desc of [true, false]) {
        const sorted = sortRows(frame, k, desc);
        const prefixMatch = compRows.every((compRow, i) => {
          const frameRow = sorted[i];
          if (!frameRow) return false;
          for (const key of compKeys) {
            if (!valuesClose(compRow[key], frameRow[key])) return false;
          }
          return true;
        });
        if (prefixMatch) {
          out.sort = { key: k, desc };
          out.limit = compRows.length;
          return out;
        }
      }
    }
    return out;
  }

  // 完整覆盖：单调检测（忽略全等列的伪单调）
  for (const k of compKeys) {
    const values = compRows.map((r) => asNumber(r[k]));
    if (values.some((v) => v === null)) continue;
    const nums = values as number[];
    const asc = nums.every((v, i) => i === 0 || nums[i - 1] <= v);
    const desc = nums.every((v, i) => i === 0 || nums[i - 1] >= v);
    if ((asc || desc) && nums.length > 1) {
      if (!(asc && desc)) {
        out.sort = { key: k, desc };
        break;
      }
    }
  }
  return out;
}
