import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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

const ID_RE = /^dash_[0-9a-f]{8}$/;

export interface DashboardOrigin {
  sessionId?: string;
  messageId?: string;
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
}

interface ValidFields {
  dsl?: string;
  title?: string;
  prompt?: string;
  sourceNames?: string[];
  origin?: DashboardOrigin;
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

  if (errors.length > 0) return { ok: false, status: 400, errors };
  return {
    ok: true,
    value: {
      ...(dsl !== undefined ? { dsl } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
      ...(sourceNames !== undefined ? { sourceNames } : {}),
      ...(origin !== undefined ? { origin } : {}),
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

export interface DashboardStore {
  /** 摘要列表（updatedAt 降序；坏文件静默跳过） */
  list(): Promise<DashboardSummary[]>;
  /** 详情（含 dsl）；未知/坏文件返回 null */
  get(id: string): Promise<DashboardRecord | null>;
  /** 收藏/覆盖收藏：dsl 必填；同 origin.messageId 命中已有记录则覆盖更新 */
  upsert(
    body: DashboardWriteInput
  ): Promise<
    | { ok: true; record: DashboardRecord }
    | { ok: false; status: 400 | 413; errors: string[] }
  >;
  /** 局部更新：title / dsl / prompt / sourceNames / origin 至少一项 */
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
      const existing = fields.origin?.messageId
        ? (
            await readAll()
          ).find((r) => r.origin?.messageId === fields.origin?.messageId) ??
          null
        : null;

      if (existing) {
        // 覆盖更新：保 id/createdAt 与（可能已重命名的）标题；显式字段覆盖
        const record: DashboardRecord = {
          ...existing,
          dsl: fields.dsl,
          ...(fields.title !== undefined ? { title: fields.title } : {}),
          ...(fields.prompt !== undefined ? { prompt: fields.prompt } : {}),
          ...(fields.sourceNames !== undefined
            ? { sourceNames: fields.sourceNames }
            : {}),
          ...(fields.origin !== undefined ? { origin: fields.origin } : {}),
          updatedAt: now,
        };
        await writeRecord(record);
        return { ok: true, record };
      }

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
        createdAt: now,
        updatedAt: now,
      };
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
        fields.origin === undefined
      ) {
        return { ok: false, status: 400, errors: ["无可更新字段"] };
      }

      const record: DashboardRecord = {
        ...existing,
        ...(fields.dsl !== undefined ? { dsl: fields.dsl } : {}),
        ...(fields.title !== undefined ? { title: fields.title } : {}),
        ...(fields.prompt !== undefined ? { prompt: fields.prompt } : {}),
        ...(fields.sourceNames !== undefined
          ? { sourceNames: fields.sourceNames }
          : {}),
        ...(fields.origin !== undefined ? { origin: fields.origin } : {}),
        updatedAt: Date.now(),
      };
      await writeRecord(record);
      return { ok: true, record };
    },

    async remove(id) {
      if (!isValidId(id)) return false;
      try {
        await fs.unlink(fileFor(id));
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
