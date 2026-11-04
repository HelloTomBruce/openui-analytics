import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * 会话存储层（server-only：依赖 node:fs，禁止在客户端组件引入）。
 *
 * 单个会话 = data/sessions/<id>.json 一个文件（不可变值对象，更新即整体替换）：
 * - 列表只回摘要（不含 messages 全文 + messageCount），避免载荷膨胀
 * - 活跃会话指针存 data/sessions/_meta.json（readAll 只扫 sess_*.json，无碰撞）
 * - 写入走「临时文件 + rename」原子替换，避免流式保存中途崩溃留下半截文件
 * - 坏 JSON / 形态不符的文件静默跳过（沿用 dashboardStore 容错哲学）
 * - messages 结构宽容：只校验 {id, role} 锚点字段，parts/toolInvocations 等
 *   AI SDK 扩展字段原样透传（存储层不绑定具体 SDK 版本的消息结构）
 *
 * 纯校验（validateSessionFields）与 IO 分离；工厂 createSessionStore 由调用方
 * 注入目录，应用级单例见文件底部。
 */

export const SESSION_TITLE_MAX = 200;
/** 单会话消息条数上限 */
export const SESSION_MESSAGES_MAX = 1000;
/** 单会话 messages 序列化上限（8MB；超出 413） */
export const SESSION_MESSAGES_PAYLOAD_MAX = 8 * 1024 * 1024;
/** 单条消息 id / context.summaryUptoMessageId 上限 */
export const SESSION_MESSAGE_ID_MAX = 200;
/** 上下文摘要上限（64KB，TASK-033 摘要缓存） */
export const SESSION_CONTEXT_SUMMARY_MAX = 64 * 1024;
/** 源 id 规则与数据源配置层一致（packages/openui-datasources SOURCE_ID_PATTERN） */
const SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

const ID_RE = /^sess_[0-9a-f]{8}$/;
/** 活跃指针文件名：下划线前缀，天然避开 readAll 的 sess_*.json 扫描 */
const META_FILE = "_meta.json";

/**
 * 消息锚点结构：存储层只承诺这两个字段存在，
 * 其余字段（content/parts/toolInvocations/annotations…）原样保留。
 */
export interface SessionMessage {
  id: string;
  role: string;
  [key: string]: unknown;
}

/** 上下文治理元数据（TASK-033）：token 锚点与摘要缓存，投影式压缩的会话级状态 */
export interface SessionContextMeta {
  /** 最近一次响应 usage.promptTokens 实测值（下次估算的锚点） */
  lastPromptTokens?: number;
  /** 旧历史摘要文本（第二道压缩产物，缓存复用） */
  summary?: string;
  /** 摘要覆盖到的最后一条消息 id（增量更新依据） */
  summaryUptoMessageId?: string;
}

export interface SessionRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: SessionMessage[];
  /** 会话启用的数据源 id；undefined = 全选（跟随全局启用项） */
  enabledSources?: string[];
  /** 上下文治理元数据（可选；缺省 = 从未计量/压缩过） */
  context?: SessionContextMeta;
  /** 先出思路开关（Plan-first）；undefined = 默认开（true） */
  planMode?: boolean;
}

/** 列表摘要：不含 messages 全文 */
export type SessionSummary = Omit<SessionRecord, "messages" | "context"> & {
  messageCount: number;
};

export function toSummary(record: SessionRecord): SessionSummary {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.enabledSources !== undefined
      ? { enabledSources: record.enabledSources }
      : {}),
    ...(record.planMode !== undefined ? { planMode: record.planMode } : {}),
    messageCount: record.messages.length,
  };
}

/** 入参宽容（未经校验的 JSON body）；校验统一收敛在 validateSessionFields */
export interface SessionWriteInput {
  title?: unknown;
  messages?: unknown;
  /** 数组 = 设置；null = 清除（恢复全选语义）；undefined = 不改动 */
  enabledSources?: unknown;
  context?: unknown;
  /** boolean = 设置；null = 恢复默认（开）；undefined = 不改动 */
  planMode?: unknown;
  /** 仅 create 生效：迁移旧数据时保留原始时间戳 */
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface ValidFields {
  title?: string;
  messages?: SessionMessage[];
  /** undefined = 未提供；null = 显式清除；数组 = 设置 */
  enabledSources?: string[] | null;
  context?: SessionContextMeta | null;
  /** undefined = 未提供；null = 恢复默认；boolean = 设置 */
  planMode?: boolean | null;
  createdAt?: number;
  updatedAt?: number;
}

export type SessionVerdict<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 413; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/** 消息形态校验：数组长度 + 每条 {id, role} 锚点 + 序列化总量预算 */
function validateMessages(raw: unknown): SessionVerdict<SessionMessage[]> {
  if (!Array.isArray(raw)) {
    return { ok: false, status: 400, errors: ["messages 必须是数组"] };
  }
  if (raw.length > SESSION_MESSAGES_MAX) {
    return {
      ok: false,
      status: 413,
      errors: [`messages 超过 ${SESSION_MESSAGES_MAX} 条上限`],
    };
  }
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i];
    if (!isRecord(m)) {
      return { ok: false, status: 400, errors: [`messages[${i}] 必须是对象`] };
    }
    if (
      typeof m.id !== "string" ||
      m.id.length === 0 ||
      m.id.length > SESSION_MESSAGE_ID_MAX
    ) {
      return {
        ok: false,
        status: 400,
        errors: [
          `messages[${i}].id 必须是 1~${SESSION_MESSAGE_ID_MAX} 字符的字符串`,
        ],
      };
    }
    if (typeof m.role !== "string" || m.role.length === 0 || m.role.length > 32) {
      return {
        ok: false,
        status: 400,
        errors: [`messages[${i}].role 必须是非空字符串`],
      };
    }
  }
  // 总量预算按序列化长度计（内容形态多样，序列化是唯一公平口径）
  const payloadBytes = Buffer.byteLength(JSON.stringify(raw), "utf-8");
  if (payloadBytes > SESSION_MESSAGES_PAYLOAD_MAX) {
    return {
      ok: false,
      status: 413,
      errors: [
        `messages 序列化大小超过 ${SESSION_MESSAGES_PAYLOAD_MAX} 字符上限（8MB）`,
      ],
    };
  }
  return { ok: true, value: raw as SessionMessage[] };
}

function validateContextMeta(raw: unknown): SessionVerdict<SessionContextMeta> {
  if (!isRecord(raw)) {
    return { ok: false, status: 400, errors: ["context 必须是对象"] };
  }
  const errors: string[] = [];
  const meta: SessionContextMeta = {};
  if (raw.lastPromptTokens !== undefined && raw.lastPromptTokens !== null) {
    if (!isPositiveInt(raw.lastPromptTokens)) {
      errors.push("context.lastPromptTokens 必须是正整数");
    } else {
      meta.lastPromptTokens = raw.lastPromptTokens;
    }
  }
  if (raw.summary !== undefined && raw.summary !== null) {
    if (typeof raw.summary !== "string" || raw.summary.trim().length === 0) {
      errors.push("context.summary 必须是非空字符串");
    } else if (raw.summary.length > SESSION_CONTEXT_SUMMARY_MAX) {
      errors.push(
        `context.summary 超过 ${SESSION_CONTEXT_SUMMARY_MAX} 字符上限（64KB）`
      );
    } else {
      meta.summary = raw.summary;
    }
  }
  if (
    raw.summaryUptoMessageId !== undefined &&
    raw.summaryUptoMessageId !== null
  ) {
    if (
      typeof raw.summaryUptoMessageId !== "string" ||
      raw.summaryUptoMessageId.length === 0 ||
      raw.summaryUptoMessageId.length > SESSION_MESSAGE_ID_MAX
    ) {
      errors.push(
        `context.summaryUptoMessageId 必须是 1~${SESSION_MESSAGE_ID_MAX} 字符的字符串`
      );
    } else {
      meta.summaryUptoMessageId = raw.summaryUptoMessageId;
    }
  }
  if (errors.length > 0) return { ok: false, status: 400, errors };
  return { ok: true, value: meta };
}

/**
 * 字段级校验（全部字段可选，必填语义由调用方叠加）：
 * 返回 400（形态非法）/ 413（超限）/ ok（规范化后的字段，字符串已 trim）。
 */
export function validateSessionFields(
  body: unknown
): SessionVerdict<ValidFields> {
  const errors: string[] = [];
  if (!isRecord(body)) {
    return { ok: false, status: 400, errors: ["请求体必须是 JSON 对象"] };
  }

  let title: string | undefined;
  if (body.title !== undefined && body.title !== null && body.title !== "") {
    if (typeof body.title !== "string") {
      errors.push("title 必须是字符串");
    } else {
      const trimmed = body.title.trim();
      if (trimmed.length === 0) {
        errors.push("title 不能为空白");
      } else if (trimmed.length > SESSION_TITLE_MAX) {
        errors.push(`title 超过 ${SESSION_TITLE_MAX} 字符上限`);
      } else {
        title = trimmed;
      }
    }
  }

  let messages: SessionMessage[] | undefined;
  if (body.messages !== undefined && body.messages !== null) {
    const verdict = validateMessages(body.messages);
    if (!verdict.ok) return verdict;
    messages = verdict.value;
  }

  let enabledSources: string[] | null | undefined;
  if (body.enabledSources === null) {
    enabledSources = null; // 显式清除 = 恢复全选语义
  } else if (body.enabledSources !== undefined) {
    const raw = body.enabledSources;
    if (!Array.isArray(raw)) {
      errors.push("enabledSources 必须是字符串数组或 null");
    } else if (raw.length === 0) {
      enabledSources = null; // 空数组归一为清除（与 undefined 全选语义对齐）
    } else if (raw.length > 50) {
      errors.push("enabledSources 最多 50 项");
    } else if (!raw.every((id) => typeof id === "string" && SOURCE_ID_RE.test(id))) {
      errors.push("enabledSources 每项必须是合法的源 id");
    } else {
      enabledSources = raw as string[];
    }
  }

  let context: SessionContextMeta | null | undefined;
  if (body.context === null) {
    context = null; // 显式清除（如 rewind 后重置计量锚点）
  } else if (body.context !== undefined) {
    const verdict = validateContextMeta(body.context);
    if (!verdict.ok) return verdict;
    context = verdict.value;
  }

  let planMode: boolean | null | undefined;
  if (body.planMode === null) {
    planMode = null; // 显式清除 = 恢复默认（开）
  } else if (body.planMode !== undefined) {
    if (typeof body.planMode !== "boolean") {
      errors.push("planMode 必须是布尔值或 null");
    } else {
      planMode = body.planMode;
    }
  }

  let createdAt: number | undefined;
  if (body.createdAt !== undefined && body.createdAt !== null) {
    if (!isPositiveInt(body.createdAt)) {
      errors.push("createdAt 必须是正整数时间戳");
    } else {
      createdAt = body.createdAt;
    }
  }
  let updatedAt: number | undefined;
  if (body.updatedAt !== undefined && body.updatedAt !== null) {
    if (!isPositiveInt(body.updatedAt)) {
      errors.push("updatedAt 必须是正整数时间戳");
    } else {
      updatedAt = body.updatedAt;
    }
  }

  if (errors.length > 0) return { ok: false, status: 400, errors };
  return {
    ok: true,
    value: {
      ...(title !== undefined ? { title } : {}),
      ...(messages !== undefined ? { messages } : {}),
      ...(enabledSources !== undefined ? { enabledSources } : {}),
      ...(context !== undefined ? { context } : {}),
      ...(planMode !== undefined ? { planMode } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
    },
  };
}

export interface SessionStore {
  /** 摘要列表（updatedAt 降序；坏文件静默跳过） */
  list(): Promise<SessionSummary[]>;
  /** 详情（含 messages）；未知/坏文件返回 null */
  get(id: string): Promise<SessionRecord | null>;
  /** 新建会话：生成 id；createdAt/updatedAt 可选（迁移场景保留原时间戳） */
  create(
    body: SessionWriteInput
  ): Promise<
    | { ok: true; record: SessionRecord }
    | { ok: false; status: 400 | 413; errors: string[] }
  >;
  /** 局部更新：title / messages / enabledSources / context 至少一项 */
  update(
    id: string,
    body: SessionWriteInput
  ): Promise<
    | { ok: true; record: SessionRecord }
    | { ok: false; status: 400 | 404 | 413; errors: string[] }
  >;
  /** 删除；不存在返回 false。删除的是活跃会话时指针一并清除 */
  remove(id: string): Promise<boolean>;
  /** 活跃会话指针（指向不存在的会话时原样返回，由调用方回落） */
  getActiveId(): Promise<string | null>;
  /** 设置活跃会话指针；null 清除。指向不存在会话返回 false */
  setActiveId(id: string | null): Promise<boolean>;
}

export function createSessionStore(opts: { dir: string }): SessionStore {
  const dir = opts.dir;
  const fileFor = (id: string) => path.join(dir, `${id}.json`);
  const metaFile = () => path.join(dir, META_FILE);

  /** 严格 id 白名单（防路径穿越；id 一律由本存储层生成） */
  const isValidId = (id: string) => ID_RE.test(id);

  function readShape(raw: unknown): SessionRecord | null {
    if (!isRecord(raw)) return null;
    // 形态校验：缺关键字段或类型不对按坏文件跳过
    if (
      typeof raw.id !== "string" ||
      !isValidId(raw.id) ||
      typeof raw.title !== "string" ||
      !Array.isArray(raw.messages) ||
      !isPositiveInt(raw.createdAt) ||
      !isPositiveInt(raw.updatedAt)
    ) {
      return null;
    }
    return raw as unknown as SessionRecord;
  }

  async function readRecord(fileName: string): Promise<SessionRecord | null> {
    try {
      const raw = await fs.readFile(path.join(dir, fileName), "utf-8");
      return readShape(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async function readAll(): Promise<SessionRecord[]> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const records = await Promise.all(
      names
        .filter((n) => ID_RE.test(n.replace(/\.json$/, "")) && n.endsWith(".json"))
        .map((n) => readRecord(n))
    );
    return records.filter((r): r is SessionRecord => r !== null);
  }

  /** 原子写：临时文件 + rename，崩溃不留半截 JSON */
  async function writeRecord(record: SessionRecord): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${fileFor(record.id)}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(record, null, 2), "utf-8");
    await fs.rename(tmp, fileFor(record.id));
  }

  async function readMeta(): Promise<{ activeId?: string | null }> {
    try {
      const raw = await fs.readFile(metaFile(), "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) return {};
      return { activeId: typeof parsed.activeId === "string" ? parsed.activeId : null };
    } catch {
      return {};
    }
  }

  async function writeMeta(activeId: string | null): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${metaFile()}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify({ activeId }), "utf-8");
    await fs.rename(tmp, metaFile());
  }

  /** 合并可选字段（create/update 共用）：null 语义 = 删除字段 */
  function applyOptionalFields(
    base: SessionRecord,
    fields: ValidFields
  ): SessionRecord {
    const record: SessionRecord = {
      ...base,
      ...(fields.title !== undefined ? { title: fields.title } : {}),
      ...(fields.messages !== undefined ? { messages: fields.messages } : {}),
    };
    if (fields.enabledSources !== undefined) {
      if (fields.enabledSources === null) delete record.enabledSources;
      else record.enabledSources = fields.enabledSources;
    }
    if (fields.context !== undefined) {
      if (fields.context === null) delete record.context;
      else record.context = { ...record.context, ...fields.context };
    }
    if (fields.planMode !== undefined) {
      if (fields.planMode === null) delete record.planMode;
      else record.planMode = fields.planMode;
    }
    return record;
  }

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

    async create(body) {
      const verdict = validateSessionFields(body);
      if (!verdict.ok) return verdict;
      const fields = verdict.value;

      const now = Date.now();
      const record = applyOptionalFields(
        {
          id: `sess_${crypto.randomBytes(4).toString("hex")}`,
          title: fields.title ?? "新建分析会话",
          createdAt: fields.createdAt ?? now,
          updatedAt: fields.updatedAt ?? now,
          messages: fields.messages ?? [],
        },
        fields
      );
      await writeRecord(record);
      return { ok: true, record };
    },

    async update(id, body) {
      if (!isValidId(id)) {
        return { ok: false, status: 404, errors: [`会话不存在: ${id}`] };
      }
      const existing = await readRecord(`${id}.json`);
      if (!existing) {
        return { ok: false, status: 404, errors: [`会话不存在: ${id}`] };
      }
      const verdict = validateSessionFields(body);
      if (!verdict.ok) return verdict;
      const fields = verdict.value;
      if (
        fields.title === undefined &&
        fields.messages === undefined &&
        fields.enabledSources === undefined &&
        fields.context === undefined &&
        fields.planMode === undefined
      ) {
        return { ok: false, status: 400, errors: ["无可更新字段"] };
      }

      const record = applyOptionalFields(
        { ...existing, updatedAt: Date.now() },
        fields
      );
      await writeRecord(record);
      return { ok: true, record };
    },

    async remove(id) {
      if (!isValidId(id)) return false;
      const record = await readRecord(`${id}.json`);
      if (!record) return false;
      try {
        await fs.unlink(fileFor(id));
        // 活跃指针指向被删会话时一并清除（调用方回落到列表首条）
        const meta = await readMeta();
        if (meta.activeId === id) await writeMeta(null);
        return true;
      } catch {
        return false;
      }
    },

    async getActiveId() {
      const meta = await readMeta();
      return typeof meta.activeId === "string" ? meta.activeId : null;
    },

    async setActiveId(id) {
      if (id !== null) {
        if (!isValidId(id)) return false;
        const existing = await readRecord(`${id}.json`);
        if (!existing) return false;
      }
      await writeMeta(id);
      return true;
    },
  };
}

/** 应用级单例：落盘位置与应用其余数据（data/dashboards、data/files）同根 */
export const sessionStore = createSessionStore({
  dir: path.join(process.cwd(), "data", "sessions"),
});
