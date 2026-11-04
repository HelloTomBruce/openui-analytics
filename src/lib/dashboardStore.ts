import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isValidTransformSpec, type TransformSpec } from "./transforms";

/**
 * 看板收藏存储层（server-only：依赖 node:fs，禁止在客户端组件引入）。
 *
 * 单条收藏 = data/dashboards/<id>.json 一个文件（不可变值对象，重建即整体替换）：
 * - dsl ≤ 2MB（413 语义）；目录内坏 JSON 静默跳过（沿用数据源 config.ts 容错哲学）
 * - 重复收藏依据 origin.messageId upsert：同消息再次收藏 = 覆盖更新，不产生重复条目
 * - 列表只回摘要（不含 dsl 全文），避免载荷膨胀
 *
 * 纯校验（validateDashboardFields）与 IO 分离；工厂 createDashboardStore 由调用方
 * 注入目录，应用级单例见文件底部。
 */

/** 单条 dsl 上限（按字符数计，2MB） */
export const DASHBOARD_DSL_MAX = 2 * 1024 * 1024;
export const DASHBOARD_TITLE_MAX = 200;
export const DASHBOARD_PROMPT_MAX = 2000;
export const DASHBOARD_QUERIES_MAX = 50;
/** 单条查询 payload 上限（SQL 文本或 {tool,args} JSON，64KB） */
export const DASHBOARD_QUERY_PAYLOAD_MAX = 64 * 1024;
export const DASHBOARD_BINDINGS_MAX = 100;

const ID_RE = /^dash_[0-9a-f]{8}$/;
/** 查询 id：q_ + 1-32 位小写字母数字（生成期捕获为 q_ + 8 位十六进制散列） */
const QUERY_ID_RE = /^q_[0-9a-z]{1,32}$/;
/** 源 id 规则与数据源配置层一致（packages/openui-datasources SOURCE_ID_PATTERN） */
const QUERY_SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
/** 绑定键：DSL statementId（标识符语法，长度 ≤ 64） */
const BINDING_KEY_RE = /^[$_a-zA-Z][$_a-zA-Z0-9]{0,63}$/;

export interface DashboardOrigin {
  sessionId?: string;
  messageId?: string;
}

/**
 * 活看板取数查询（P2-A）：收藏时从 execute 轮工具调用记录捕获。
 * kind=sql → payload 为 SQL 文本（db 类源重放）；kind=tool → payload 为
 * {"tool","args"} JSON 串（MCP 类源重放）。
 */
export interface DashboardQuery {
  /** q_ 前缀；由 (sourceId, kind, payload) 散列决定，同查询幂等 */
  id: string;
  sourceId: string;
  kind: "sql" | "tool";
  payload: string;
}

export interface DashboardRecord {
  id: string;
  title: string;
  /** OpenUI DSL 快照全文（收藏时刻的静态数据） */
  dsl: string;
  /** 生成该看板的用户提问（重新分析的种子；可空） */
  prompt?: string;
  /** 生成时启用源的名称快照，仅展示归档（不含 id/凭据） */
  sourceNames?: string[];
  /** 重复收藏 upsert 依据 */
  origin?: DashboardOrigin;
  /** 活看板：被看板组件直接引用的取数查询（derived 组件不绑定；可空 = 旧快照只读） */
  queries?: DashboardQuery[];
  /** 活看板：DSL 组件 statementId → queries[].id（值必引 queries 内存在的 id） */
  bindings?: Record<string, string>;
  /** 派生变换绑定：statementId → 确定性变换 spec（键必 ⊆ bindings 键；刷新时重放后重算） */
  transforms?: Record<string, TransformSpec>;
  /** 数据确认时间：收藏捕获时 = 生成时刻；刷新成功后更新（后续任务） */
  dataUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** 列表摘要：不含 dsl 全文 */
export type DashboardSummary = Omit<DashboardRecord, "dsl">;

export function toSummary(record: DashboardRecord): DashboardSummary {
  return {
    id: record.id,
    title: record.title,
    prompt: record.prompt,
    sourceNames: record.sourceNames,
    origin: record.origin,
    queries: record.queries,
    bindings: record.bindings,
    transforms: record.transforms,
    dataUpdatedAt: record.dataUpdatedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** 入参宽容（未经校验的 JSON body）；校验统一收敛在 validateDashboardFields */
export interface DashboardWriteInput {
  dsl?: unknown;
  title?: unknown;
  prompt?: unknown;
  sourceNames?: unknown;
  origin?: unknown;
  queries?: unknown;
  bindings?: unknown;
  transforms?: unknown;
  dataUpdatedAt?: unknown;
}

interface ValidFields {
  dsl?: string;
  title?: string;
  prompt?: string;
  sourceNames?: string[];
  origin?: DashboardOrigin;
  /** 空数组 = 清空语义（显式清除旧查询） */
  queries?: DashboardQuery[];
  /** 空对象 = 清空语义 */
  bindings?: Record<string, string>;
  /** 空对象 = 清空语义；键必须 ⊆ 同请求/合并后 bindings 键 */
  transforms?: Record<string, TransformSpec>;
  dataUpdatedAt?: number;
}

export type DashboardVerdict<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 413; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 字段级校验（全部字段可选，必填语义由调用方叠加）：
 * 返回 400（形态非法）/ 413（超限）/ ok（规范化后的字段，字符串已 trim）。
 */
export function validateDashboardFields(
  body: unknown
): DashboardVerdict<ValidFields> {
  const errors: string[] = [];
  if (!isRecord(body)) {
    return { ok: false, status: 400, errors: ["请求体必须是 JSON 对象"] };
  }

  let dsl: string | undefined;
  if (body.dsl !== undefined && body.dsl !== null) {
    if (typeof body.dsl !== "string" || body.dsl.trim().length === 0) {
      errors.push("dsl 必须是非空字符串");
    } else if (body.dsl.length > DASHBOARD_DSL_MAX) {
      return {
        ok: false,
        status: 413,
        errors: [`dsl 超过 ${DASHBOARD_DSL_MAX} 字符上限（2MB）`],
      };
    } else {
      dsl = body.dsl;
    }
  }

  let title: string | undefined;
  if (body.title !== undefined && body.title !== null && body.title !== "") {
    if (typeof body.title !== "string") {
      errors.push("title 必须是字符串");
    } else {
      const trimmed = body.title.trim();
      if (trimmed.length === 0) {
        errors.push("title 不能为空白");
      } else if (trimmed.length > DASHBOARD_TITLE_MAX) {
        errors.push(`title 超过 ${DASHBOARD_TITLE_MAX} 字符上限`);
      } else {
        title = trimmed;
      }
    }
  }

  let prompt: string | undefined;
  if (body.prompt !== undefined && body.prompt !== null && body.prompt !== "") {
    if (typeof body.prompt !== "string") {
      errors.push("prompt 必须是字符串");
    } else if (body.prompt.length > DASHBOARD_PROMPT_MAX) {
      errors.push(`prompt 超过 ${DASHBOARD_PROMPT_MAX} 字符上限`);
    } else {
      prompt = body.prompt;
    }
  }

  let sourceNames: string[] | undefined;
  if (body.sourceNames !== undefined && body.sourceNames !== null) {
    const raw = body.sourceNames;
    if (!Array.isArray(raw)) {
      errors.push("sourceNames 必须是字符串数组");
    } else if (raw.length === 0) {
      // 空数组视为未提供（清空语义不进存储层，列表展示自然缺省）
    } else if (raw.length > 20) {
      errors.push("sourceNames 最多 20 项");
    } else if (
      !raw.every(
        (n) =>
          typeof n === "string" && n.trim().length > 0 && n.trim().length <= 100
      )
    ) {
      errors.push("sourceNames 每项必须是不超过 100 字符的非空字符串");
    } else {
      sourceNames = raw.map((n) => (n as string).trim());
    }
  }

  let origin: DashboardOrigin | undefined;
  if (body.origin !== undefined && body.origin !== null) {
    if (!isRecord(body.origin)) {
      errors.push("origin 必须是对象");
    } else {
      const sessionId =
        body.origin.sessionId !== undefined &&
        body.origin.sessionId !== null &&
        body.origin.sessionId !== ""
          ? String(body.origin.sessionId)
          : undefined;
      const messageId =
        body.origin.messageId !== undefined &&
        body.origin.messageId !== null &&
        body.origin.messageId !== ""
          ? String(body.origin.messageId)
          : undefined;
      if (
        (sessionId !== undefined && sessionId.length > 200) ||
        (messageId !== undefined && messageId.length > 200)
      ) {
        errors.push("origin.sessionId/messageId 各不超过 200 字符");
      } else {
        origin = {
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(messageId !== undefined ? { messageId } : {}),
        };
      }
    }
  }

  let queries: DashboardQuery[] | undefined;
  if (body.queries !== undefined && body.queries !== null) {
    const raw = body.queries;
    if (!Array.isArray(raw)) {
      errors.push("queries 必须是数组");
    } else if (raw.length === 0) {
      queries = []; // 显式空数组 = 清空语义（保留「已提供」信号）
    } else if (raw.length > DASHBOARD_QUERIES_MAX) {
      errors.push(`queries 最多 ${DASHBOARD_QUERIES_MAX} 条`);
    } else {
      const seen = new Set<string>();
      const list: DashboardQuery[] = [];
      for (const item of raw) {
        if (!isRecord(item)) {
          errors.push("queries 每项必须是对象");
          break;
        }
        const id = typeof item.id === "string" ? item.id : "";
        const sourceId = typeof item.sourceId === "string" ? item.sourceId : "";
        const payload =
          typeof item.payload === "string" ? item.payload.trim() : "";
        if (!QUERY_ID_RE.test(id)) {
          errors.push(`queries[].id 非法（需 q_ 前缀）: "${id}"`);
        } else if (seen.has(id)) {
          errors.push(`queries[].id 重复: "${id}"`);
        }
        if (!QUERY_SOURCE_ID_RE.test(sourceId)) {
          errors.push(`queries[].sourceId 非法: "${sourceId}"`);
        }
        if (item.kind !== "sql" && item.kind !== "tool") {
          errors.push("queries[].kind 必须是 sql 或 tool");
        }
        if (payload.length === 0) {
          errors.push("queries[].payload 必须是非空字符串");
        } else if (payload.length > DASHBOARD_QUERY_PAYLOAD_MAX) {
          errors.push(
            `queries[].payload 超过 ${DASHBOARD_QUERY_PAYLOAD_MAX} 字符上限`
          );
        }
        if (errors.length > 0) break;
        seen.add(id);
        list.push({ id, sourceId, kind: item.kind as "sql" | "tool", payload });
      }
      if (errors.length === 0) queries = list;
    }
  }

  let bindings: Record<string, string> | undefined;
  if (body.bindings !== undefined && body.bindings !== null) {
    if (!isRecord(body.bindings)) {
      errors.push("bindings 必须是对象（组件 id → query id）");
    } else {
      const entries = Object.entries(body.bindings);
      if (entries.length === 0) {
        bindings = {}; // 显式空对象 = 清空语义
      } else if (entries.length > DASHBOARD_BINDINGS_MAX) {
        errors.push(`bindings 最多 ${DASHBOARD_BINDINGS_MAX} 项`);
      } else {
        const map: Record<string, string> = {};
        for (const [key, value] of entries) {
          if (!BINDING_KEY_RE.test(key)) {
            errors.push(`bindings 键非法（DSL 组件标识符）: "${key}"`);
            break;
          }
          if (typeof value !== "string" || !QUERY_ID_RE.test(value)) {
            errors.push(`bindings["${key}"] 必须是 q_ 前缀的 query id`);
            break;
          }
          map[key] = value;
        }
        if (errors.length === 0) bindings = map;
      }
    }
  }

  let transforms: Record<string, TransformSpec> | undefined;
  if (body.transforms !== undefined && body.transforms !== null) {
    if (!isRecord(body.transforms)) {
      errors.push("transforms 必须是对象（组件 id → 变换 spec）");
    } else {
      const entries = Object.entries(body.transforms);
      if (entries.length === 0) {
        transforms = {}; // 显式空对象 = 清空语义
      } else if (entries.length > DASHBOARD_BINDINGS_MAX) {
        errors.push(`transforms 最多 ${DASHBOARD_BINDINGS_MAX} 项`);
      } else {
        const map: Record<string, TransformSpec> = {};
        for (const [key, value] of entries) {
          if (!BINDING_KEY_RE.test(key)) {
            errors.push(`transforms 键非法（DSL 组件标识符）: "${key}"`);
            break;
          }
          if (!isValidTransformSpec(value)) {
            errors.push(`transforms["${key}"] 不是合法的变换 spec`);
            break;
          }
          map[key] = value;
        }
        if (errors.length === 0) transforms = map;
      }
    }
  }

  let dataUpdatedAt: number | undefined;
  if (
    body.dataUpdatedAt !== undefined &&
    body.dataUpdatedAt !== null
  ) {
    if (
      typeof body.dataUpdatedAt !== "number" ||
      !Number.isInteger(body.dataUpdatedAt) ||
      body.dataUpdatedAt <= 0
    ) {
      errors.push("dataUpdatedAt 必须是正整数时间戳");
    } else {
      dataUpdatedAt = body.dataUpdatedAt;
    }
  }

  // 引用完整性：非空 bindings 的值必须指向同请求内的 query id
  // （空 bindings/空 queries = 清空语义不参与；update 局部更新时由调用方按合并后记录复核）
  const hasBindings = bindings !== undefined && Object.keys(bindings).length > 0;
  if (hasBindings) {
    if (queries === undefined) {
      errors.push("提供 bindings 时必须同时提供 queries");
    } else {
      const ids = new Set(queries.map((q) => q.id));
      for (const [key, value] of Object.entries(bindings as Record<string, string>)) {
        if (!ids.has(value)) {
          errors.push(`bindings["${key}"] 引用了不存在的 query: "${value}"`);
        }
      }
    }
  }

  // 引用完整性：非空 transforms 的键必须 ⊆ 同请求 bindings 键
  // （transform 绑定建立在 query 绑定之上；合并后复核在 mergeLiveFields）
  const hasTransforms = transforms !== undefined && Object.keys(transforms).length > 0;
  if (hasTransforms) {
    if (!hasBindings) {
      errors.push("提供 transforms 时必须同时提供非空 bindings");
    } else {
      for (const key of Object.keys(transforms as Record<string, TransformSpec>)) {
        if (!(bindings as Record<string, string>)[key]) {
          errors.push(`transforms["${key}"] 没有对应的 bindings 绑定`);
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, status: 400, errors };
  return {
    ok: true,
    value: {
      ...(dsl !== undefined ? { dsl } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
      ...(sourceNames !== undefined ? { sourceNames } : {}),
      ...(origin !== undefined ? { origin } : {}),
      ...(queries !== undefined ? { queries } : {}),
      ...(bindings !== undefined ? { bindings } : {}),
      ...(transforms !== undefined ? { transforms } : {}),
      ...(dataUpdatedAt !== undefined ? { dataUpdatedAt } : {}),
    },
  };
}

/**
 * 缺省标题推导：与 sessionStorage.generateSessionTitle 同规则
 * （去 markdown 记号与【】前缀、20 字截断加省略号）；无 prompt 返回 null。
 */
export function deriveDashboardTitle(prompt?: string): string | null {
  if (!prompt) return null;
  const clean = prompt
    .replace(/[#*`_~]/g, "")
    .replace(/^【.*?】/, "")
    .trim();
  if (!clean) return null;
  return clean.length > 20 ? `${clean.slice(0, 20)}...` : clean;
}

/**
 * 活看板字段的合并语义（upsert/update 共用）：
 * - 显式空数组/空对象 = 清空；queries 显式提供时 bindings 缺省随之清空
 *   （收藏覆盖链路同请求总是成对提供；防止旧绑定残留指向已清除的查询）
 * - 引用完整性按**合并后**记录判定（validateDashboardFields 只校验同请求一致）
 * - dataUpdatedAt：合并后仍有查询时取 max(显式值, 缺省值)；无查询则清除
 */
function mergeLiveFields(
  existing: DashboardRecord | null,
  fields: ValidFields,
  fallbackDataUpdatedAt: number
):
  | {
      ok: true;
      queries?: DashboardQuery[];
      bindings?: Record<string, string>;
      transforms?: Record<string, TransformSpec>;
      dataUpdatedAt?: number;
    }
  | { ok: false; errors: string[] } {
  const queries =
    fields.queries !== undefined ? fields.queries : existing?.queries;
  const bindings =
    fields.bindings !== undefined
      ? fields.bindings
      : fields.queries !== undefined
        ? undefined
        : existing?.bindings;
  // transforms 跟随 bindings 生命周期：重新捕获（显式提供 queries/bindings）
  // 而未提供 transforms 时旧变换即过期清除
  const transforms =
    fields.transforms !== undefined
      ? fields.transforms
      : fields.queries !== undefined || fields.bindings !== undefined
        ? undefined
        : existing?.transforms;

  if (bindings) {
    if (!queries || queries.length === 0) {
      return { ok: false, errors: ["存在 bindings 但无对应 queries"] };
    }
    const ids = new Set(queries.map((q) => q.id));
    for (const [key, value] of Object.entries(bindings)) {
      if (!ids.has(value)) {
        return {
          ok: false,
          errors: [`bindings["${key}"] 引用了不存在的 query: "${value}"`],
        };
      }
    }
  }

  if (transforms && Object.keys(transforms).length > 0) {
    if (!bindings || Object.keys(bindings).length === 0) {
      return { ok: false, errors: ["存在 transforms 但无对应 bindings"] };
    }
    for (const key of Object.keys(transforms)) {
      if (!bindings[key]) {
        return {
          ok: false,
          errors: [`transforms["${key}"] 没有对应的 bindings 绑定`],
        };
      }
    }
  }

  return {
    ok: true,
    ...(queries && queries.length > 0 ? { queries } : {}),
    ...(bindings && Object.keys(bindings).length > 0 ? { bindings } : {}),
    ...(transforms && Object.keys(transforms).length > 0 ? { transforms } : {}),
    ...(queries && queries.length > 0
      ? {
          dataUpdatedAt:
            fields.dataUpdatedAt ??
            Math.max(fallbackDataUpdatedAt, existing?.dataUpdatedAt ?? 0),
        }
      : {}),
  };
}

export interface DashboardStore {
  /** 摘要列表（updatedAt 降序；坏文件静默跳过） */
  list(): Promise<DashboardSummary[]>;
  /** 详情（含 dsl）；未知/坏文件返回 null */
  get(id: string): Promise<DashboardRecord | null>;
  /** 收藏/覆盖收藏：dsl 必填；同 origin.messageId 命中已有记录则覆盖更新（活看板字段整体替换） */
  upsert(
    body: DashboardWriteInput
  ): Promise<
    | { ok: true; record: DashboardRecord }
    | { ok: false; status: 400 | 413; errors: string[] }
  >;
  /** 局部更新：title / dsl / prompt / sourceNames / origin / queries / bindings / dataUpdatedAt 至少一项 */
  update(
    id: string,
    body: DashboardWriteInput
  ): Promise<
    | { ok: true; record: DashboardRecord }
    | { ok: false; status: 400 | 404 | 413; errors: string[] }
  >;
  /** 删除；不存在返回 false */
  remove(id: string): Promise<boolean>;
}

export function createDashboardStore(opts: { dir: string }): DashboardStore {
  const dir = opts.dir;
  const fileFor = (id: string) => path.join(dir, `${id}.json`);

  /** 严格 id 白名单（防路径穿越；id 一律由本存储层生成） */
  const isValidId = (id: string) => ID_RE.test(id);

  async function readRecord(fileName: string): Promise<DashboardRecord | null> {
    try {
      const raw = await fs.readFile(path.join(dir, fileName), "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) return null;
      // 形态校验：缺关键字段或类型不对按坏文件跳过
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.title !== "string" ||
        typeof parsed.dsl !== "string" ||
        typeof parsed.createdAt !== "number" ||
        typeof parsed.updatedAt !== "number"
      ) {
        return null;
      }
      return parsed as unknown as DashboardRecord;
    } catch {
      return null;
    }
  }

  async function readAll(): Promise<DashboardRecord[]> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const records = await Promise.all(
      names
        .filter((n) => n.endsWith(".json"))
        .map((n) => readRecord(n))
    );
    return records.filter((r): r is DashboardRecord => r !== null);
  }

  async function writeRecord(record: DashboardRecord): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      fileFor(record.id),
      JSON.stringify(record, null, 2),
      "utf-8"
    );
  }

  /**
   * origin.messageId → dashboard id 内存索引：upsert 覆盖判定的 O(1) 通道
   * （替代每次全目录扫描）。首次使用惰性构建；写路径同步维护。
   * 假设：所有写经本实例（应用单例），进程外改文件后重启即可自愈。
   */
  let messageIdIndex: Map<string, string> | null = null;
  const indexByMessageId = async (): Promise<Map<string, string>> => {
    if (messageIdIndex === null) {
      messageIdIndex = new Map();
      for (const r of await readAll()) {
        if (r.origin?.messageId) messageIdIndex.set(r.origin.messageId, r.id);
      }
    }
    return messageIdIndex;
  };
  const reindexOrigin = (
    prev: DashboardOrigin | undefined,
    next: DashboardOrigin | undefined,
    id: string
  ): void => {
    if (messageIdIndex === null) return; // 索引未构建无需维护（下次构建即准确）
    if (prev?.messageId && prev.messageId !== next?.messageId) {
      messageIdIndex.delete(prev.messageId);
    }
    if (next?.messageId) messageIdIndex.set(next.messageId, id);
  };

  return {
    async list() {
      const records = await readAll();
      records.sort(
        (a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt
      );
      return records.map(toSummary);
    },

    async get(id) {
      if (!isValidId(id)) return null;
      return readRecord(`${id}.json`);
    },

    async upsert(body) {
      const verdict = validateDashboardFields(body);
      if (!verdict.ok) return verdict;
      const fields = verdict.value;
      if (fields.dsl === undefined) {
        return { ok: false, status: 400, errors: ["dsl 不能为空"] };
      }

      const now = Date.now();
      let existing: DashboardRecord | null = null;
      const messageId = fields.origin?.messageId;
      if (messageId) {
        const index = await indexByMessageId();
        const hitId = index.get(messageId);
        existing = hitId ? ((await readRecord(`${hitId}.json`)) ?? null) : null;
      }

      if (existing) {
        // 覆盖更新：保 id/createdAt 与（可能已重命名的）标题；显式字段覆盖
        // 活看板字段：收藏覆盖时捕获结果整体替换（空 = 清空），引用完整性按合并后判定
        const live = mergeLiveFields(existing, fields, now);
        if (!live.ok) return { ok: false, status: 400, errors: live.errors };
        const record: DashboardRecord = {
          ...existing,
          dsl: fields.dsl,
          ...(fields.title !== undefined ? { title: fields.title } : {}),
          ...(fields.prompt !== undefined ? { prompt: fields.prompt } : {}),
          ...(fields.sourceNames !== undefined
            ? { sourceNames: fields.sourceNames }
            : {}),
          ...(fields.origin !== undefined ? { origin: fields.origin } : {}),
          ...(live.queries !== undefined ? { queries: live.queries } : {}),
          ...(live.bindings !== undefined ? { bindings: live.bindings } : {}),
          ...(live.transforms !== undefined
            ? { transforms: live.transforms }
            : {}),
          ...(live.dataUpdatedAt !== undefined
            ? { dataUpdatedAt: live.dataUpdatedAt }
            : {}),
          updatedAt: now,
        };
        // 清空语义：合并结果无对应字段时显式剔除（避免残留旧值）
        if (live.queries === undefined) delete record.queries;
        if (live.bindings === undefined) delete record.bindings;
        if (live.transforms === undefined) delete record.transforms;
        if (live.dataUpdatedAt === undefined) delete record.dataUpdatedAt;
        reindexOrigin(existing.origin, record.origin, record.id);
        await writeRecord(record);
        return { ok: true, record };
      }

      const live = mergeLiveFields(null, fields, now);
      if (!live.ok) return { ok: false, status: 400, errors: live.errors };
      const record: DashboardRecord = {
        id: `dash_${crypto.randomBytes(4).toString("hex")}`,
        title:
          fields.title ??
          deriveDashboardTitle(fields.prompt) ??
          "未命名看板",
        dsl: fields.dsl,
        ...(fields.prompt !== undefined ? { prompt: fields.prompt } : {}),
        ...(fields.sourceNames !== undefined
          ? { sourceNames: fields.sourceNames }
          : {}),
        ...(fields.origin !== undefined ? { origin: fields.origin } : {}),
        ...(live.queries !== undefined ? { queries: live.queries } : {}),
        ...(live.bindings !== undefined ? { bindings: live.bindings } : {}),
        ...(live.transforms !== undefined
          ? { transforms: live.transforms }
          : {}),
        ...(live.dataUpdatedAt !== undefined
          ? { dataUpdatedAt: live.dataUpdatedAt }
          : {}),
        createdAt: now,
        updatedAt: now,
      };
      reindexOrigin(undefined, record.origin, record.id);
      await writeRecord(record);
      return { ok: true, record };
    },

    async update(id, body) {
      if (!isValidId(id)) {
        return { ok: false, status: 404, errors: [`看板不存在: ${id}`] };
      }
      const existing = await readRecord(`${id}.json`);
      if (!existing) {
        return { ok: false, status: 404, errors: [`看板不存在: ${id}`] };
      }
      const verdict = validateDashboardFields(body);
      if (!verdict.ok) return verdict;
      const fields = verdict.value;
      if (
        fields.dsl === undefined &&
        fields.title === undefined &&
        fields.prompt === undefined &&
        fields.sourceNames === undefined &&
        fields.origin === undefined &&
        fields.queries === undefined &&
        fields.bindings === undefined &&
        fields.transforms === undefined &&
        fields.dataUpdatedAt === undefined
      ) {
        return { ok: false, status: 400, errors: ["无可更新字段"] };
      }

      // 活看板字段按合并后记录复核引用完整性；dataUpdatedAt 缺省保留旧值
      const live = mergeLiveFields(existing, fields, existing.dataUpdatedAt ?? 0);
      if (!live.ok) return { ok: false, status: 400, errors: live.errors };
      const record: DashboardRecord = {
        ...existing,
        ...(fields.dsl !== undefined ? { dsl: fields.dsl } : {}),
        ...(fields.title !== undefined ? { title: fields.title } : {}),
        ...(fields.prompt !== undefined ? { prompt: fields.prompt } : {}),
        ...(fields.sourceNames !== undefined
          ? { sourceNames: fields.sourceNames }
          : {}),
        ...(fields.origin !== undefined ? { origin: fields.origin } : {}),
        ...(live.queries !== undefined ? { queries: live.queries } : {}),
        ...(live.bindings !== undefined ? { bindings: live.bindings } : {}),
        ...(live.transforms !== undefined
          ? { transforms: live.transforms }
          : {}),
        ...(live.dataUpdatedAt !== undefined
          ? { dataUpdatedAt: live.dataUpdatedAt }
          : {}),
        updatedAt: Date.now(),
      };
      if (live.queries === undefined) delete record.queries;
      if (live.bindings === undefined) delete record.bindings;
      if (live.transforms === undefined) delete record.transforms;
      if (live.dataUpdatedAt === undefined) delete record.dataUpdatedAt;
      reindexOrigin(existing.origin, record.origin, record.id);
      await writeRecord(record);
      return { ok: true, record };
    },

    async remove(id) {
      if (!isValidId(id)) return false;
      const record = await readRecord(`${id}.json`);
      try {
        await fs.unlink(fileFor(id));
        if (record?.origin?.messageId && messageIdIndex) {
          messageIdIndex.delete(record.origin.messageId);
        }
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** 应用级单例：落盘位置与应用其余数据（data/files、config）同根 */
export const dashboardStore = createDashboardStore({
  dir: path.join(process.cwd(), "data", "dashboards"),
});
