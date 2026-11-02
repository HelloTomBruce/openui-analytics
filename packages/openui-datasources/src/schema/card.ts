/**
 * Schema Card 结构卡：数据源的「表结构知识快照」。
 *
 * 表结构在两次配置变更之间是稳定知识——卡一次生成、反复注入 prompt，
 * 免去 LLM 每轮 list_tables/describe_table 的往返与 token 开销。
 *
 * 分层：buildSchemaCard / renderCardForPrompt 为纯函数（零 IO）；
 * collectSchemaCard 为采集器（经 SchemaProbe 抽象取数，测试可注入假探针）。
 */

export interface SchemaCardColumn {
  name: string;
  type: string;
  /** 低基数列（≤ LOW_CARDINALITY_THRESHOLD）才有：distinct 计数 */
  cardinality?: number;
  /** 低基数列才有：出现频次最高的取值（≤ TOP_VALUES_MAX 个） */
  topValues?: string[];
  /** 数值/日期列才有：值域 */
  min?: string;
  max?: string;
}

export interface SchemaCardTable {
  name: string;
  rowCount?: number;
  columns: SchemaCardColumn[];
}

export interface SchemaCardToolSummary {
  name: string;
  description?: string;
}

export interface SchemaCard {
  sourceId: string;
  generatedAt: number;
  /** db-like：真实表结构；mcp：http/stdio 源仅记工具摘要（不主动探查数据） */
  kind: "db-like" | "mcp";
  tables: SchemaCardTable[];
  toolSummaries?: SchemaCardToolSummary[];
  /** 内容因预算被截断（表/列/取值任一维度） */
  truncated: boolean;
}

// ---- 预算常量（快照测试守护，防回归） ----
export const LOW_CARDINALITY_THRESHOLD = 50;
export const TOP_VALUES_MAX = 10;
export const CARD_MAX_TABLES = 50;
export const PROFILE_MAX_COLUMNS = 20;
/** 每表 topValues 细化查询上限（控制采集查询数） */
export const TOP_VALUE_QUERIES_PER_TABLE = 10;
/** 单卡渲染进 prompt 的字节预算（每源 ≤2KB） */
export const CARD_RENDER_BUDGET_BYTES = 2048;
/** 单卡落盘上限 64KB */
export const CARD_STORE_MAX_BYTES = 64 * 1024;

const NUMERIC_OR_DATE_RE =
  /int|numeric|decimal|double|float|real|number|date|time|hugeint|bigint|smallint|tinyint/i;

/** 数值/日期列才记 min/max（文本列的 lexicographic 极值无分析价值） */
function isNumericOrDate(type: string): boolean {
  return NUMERIC_OR_DATE_RE.test(type);
}

/** JSON 安全化：BigInt → string（duckdb/pg 大数），Date → ISO，其余原样 */
export function normalizeCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** 采集期单表原始数据（采集器产出，构建器消费） */
export interface RawTableProfile {
  name: string;
  rowCount?: number;
  columns: { column: string; type: string }[];
  /** column 名 → distinct 计数（仅被剖析的列） */
  cardinalities?: Record<string, number>;
  /** column 名 → 值域（仅数值/日期列） */
  ranges?: Record<string, { min: string; max: string }>;
  /** column 名 → 高频取值（仅低基数列，已截断至 TOP_VALUES_MAX） */
  topValues?: Record<string, string[]>;
}

/**
 * 纯函数构建：采集产物 → 结构卡（含预算截断）。
 * 截断顺序：表数 > CARD_MAX_TABLES → 列数 > PROFILE_MAX_COLUMNS → 落盘字节 > 64KB。
 */
export function buildSchemaCard(input: {
  sourceId: string;
  profiles: RawTableProfile[];
  generatedAt?: number;
}): SchemaCard {
  let truncated = false;
  const tables: SchemaCardTable[] = [];

  for (const profile of input.profiles.slice(0, CARD_MAX_TABLES)) {
    const columns: SchemaCardColumn[] = profile.columns
      .slice(0, PROFILE_MAX_COLUMNS)
      .map((col) => {
        const out: SchemaCardColumn = { name: col.column, type: col.type };
        const card = profile.cardinalities?.[col.column];
        if (
          card !== undefined &&
          card <= LOW_CARDINALITY_THRESHOLD
        ) {
          out.cardinality = card;
          const tops = profile.topValues?.[col.column];
          if (tops && tops.length > 0) {
            out.topValues = tops.slice(0, TOP_VALUES_MAX);
          }
        }
        const range = profile.ranges?.[col.column];
        if (range && isNumericOrDate(col.type)) {
          out.min = range.min;
          out.max = range.max;
        }
        return out;
      });
    if (profile.columns.length > PROFILE_MAX_COLUMNS) truncated = true;

    tables.push({
      name: profile.name,
      ...(profile.rowCount !== undefined ? { rowCount: profile.rowCount } : {}),
      columns,
    });
  }
  if (input.profiles.length > CARD_MAX_TABLES) truncated = true;

  let card: SchemaCard = {
    sourceId: input.sourceId,
    generatedAt: input.generatedAt ?? Date.now(),
    kind: "db-like",
    tables,
    truncated,
  };

  // 落盘字节预算：超限则逐表去 topValues → 截尾表 → 裁列，直至达标。
  // 每一步都严格缩小体积，保证终止（单表裁到 1 列仍超限则放弃收敛，
  // 由 store 层 64KB 防线抛错暴露——不在这里死循环硬压）。
  while (JSON.stringify(card).length > CARD_STORE_MAX_BYTES && card.tables.length > 0) {
    truncated = true;
    const withTops = card.tables.some((t) => t.columns.some((c) => c.topValues));
    if (withTops) {
      card = {
        ...card,
        truncated,
        tables: card.tables.map((t) => ({
          ...t,
          columns: t.columns.map((c) => {
            const { topValues, ...rest } = c;
            void topValues;
            return rest;
          }),
        })),
      };
    } else if (card.tables.length > 1) {
      card = {
        ...card,
        truncated,
        tables: card.tables.slice(0, Math.max(1, Math.floor(card.tables.length / 2))),
      };
    } else {
      const only = card.tables[0];
      if (only.columns.length <= 1) break;
      card = {
        ...card,
        truncated,
        tables: [
          { ...only, columns: only.columns.slice(0, Math.max(1, Math.floor(only.columns.length / 2))) },
        ],
      };
    }
  }
  return { ...card, truncated };
}

/** MCP 源（http/stdio）结构卡：仅工具摘要，不探查数据 */
export function buildMcpToolCard(input: {
  sourceId: string;
  tools: SchemaCardToolSummary[];
  generatedAt?: number;
}): SchemaCard {
  return {
    sourceId: input.sourceId,
    generatedAt: input.generatedAt ?? Date.now(),
    kind: "mcp",
    tables: [],
    toolSummaries: input.tools.slice(0, 30).map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description.slice(0, 120) } : {}),
    })),
    truncated: input.tools.length > 30,
  };
}

/**
 * 结构卡 → prompt markdown 附录（预算 CARD_RENDER_BUDGET_BYTES）。
 * 行数多的表优先保留；超预算截断并标注。
 */
export function renderCardForPrompt(
  card: SchemaCard,
  budgetBytes = CARD_RENDER_BUDGET_BYTES
): string {
  const generatedAt = new Date(card.generatedAt).toISOString().slice(0, 16).replace("T", " ");
  const lines: string[] = [];
  const header =
    card.kind === "mcp"
      ? `### 数据源 ${card.sourceId} 工具卡（生成于 ${generatedAt}）`
      : `### 数据源 ${card.sourceId} 结构卡（生成于 ${generatedAt}）`;
  lines.push(header);

  if (card.kind === "mcp") {
    for (const t of card.toolSummaries ?? []) {
      lines.push(`- ${t.name}${t.description ? `：${t.description}` : ""}`);
    }
  } else {
    const sorted = [...card.tables].sort(
      (a, b) => (b.rowCount ?? 0) - (a.rowCount ?? 0)
    );
    for (const table of sorted) {
      const cols = table.columns
        .map((c) => {
          let s = `${c.name} ${c.type}`;
          if (c.cardinality !== undefined) {
            s += `(${c.cardinality} 值`;
            if (c.topValues && c.topValues.length > 0) {
              s += `: ${c.topValues.slice(0, 5).join("/")}${c.topValues.length > 5 ? "/…" : ""}`;
            }
            s += ")";
          }
          if (c.min !== undefined && c.max !== undefined) {
            s += `[${c.min} ~ ${c.max}]`;
          }
          return s;
        })
        .join("，");
      const rows =
        table.rowCount !== undefined ? `约 ${table.rowCount.toLocaleString()} 行` : "";
      lines.push(`- ${table.name}${rows ? `（${rows}）` : ""}：${cols}`);
    }
  }
  if (card.truncated) lines.push("（内容已按预算截断）");

  // 预算截断：超预算时逐行裁掉尾部内容行（保留头部与截断标注），
  // 每轮严格减少一行，保证终止。
  const TRUNCATION_NOTE = "（内容已按预算截断）";
  const fits = (ls: string[]) =>
    Buffer.byteLength(ls.join("\n"), "utf-8") <= budgetBytes;
  if (fits(lines)) return lines.join("\n");

  const headLine = lines[0];
  const body = lines.slice(1).filter((l) => !l.includes("已按预算截断"));
  while (body.length > 0) {
    body.pop();
    const candidate = [headLine, ...body, TRUNCATION_NOTE];
    if (fits(candidate)) return candidate.join("\n");
  }
  // 极端：仅头部就超预算（异常长的 sourceId），返回头部由调用侧日志暴露
  return headLine;
}

// ---- 采集器（IO 边界；探针抽象使测试零数据库） ----

export interface SchemaProbe {
  listTables(): Promise<{ table: string }[]>;
  describeTable(table: string): Promise<{ column: string; type: string }[]>;
  query(sql: string): Promise<Record<string, unknown>[]>;
}

export interface CollectOptions {
  /** 标识符引用（postgres/duckdb 双引号，mysql 反引号） */
  quoteIdent: (name: string) => string;
  /** 单表剖析列数上限（默认 PROFILE_MAX_COLUMNS） */
  maxColumns?: number;
}

/**
 * 采集单表画像：1 次聚合查询（行数 + 各列 distinct + 数值/日期列值域）
 * + 低基数列各 1 次 topValues 查询（≤ TOP_VALUE_QUERIES_PER_TABLE 个）。
 * 单表失败不拖垮整卡（由调用方 try/catch 后跳过）。
 */
export async function collectTableProfile(
  probe: SchemaProbe,
  table: string,
  opts: CollectOptions
): Promise<RawTableProfile> {
  const q = opts.quoteIdent;
  const maxColumns = opts.maxColumns ?? PROFILE_MAX_COLUMNS;
  const columns = (await probe.describeTable(table)).slice(0, maxColumns);
  if (columns.length === 0) {
    return { name: table, columns: [] };
  }

  // 第一遍：单条聚合查询拿 rowCount + 各列 cardinality + 数值/日期值域
  const selects: string[] = [`COUNT(*) AS "rowCount"`];
  columns.forEach((col, i) => {
    selects.push(`COUNT(DISTINCT ${q(col.column)}) AS "card_${i}"`);
    if (isNumericOrDate(col.type)) {
      selects.push(`MIN(${q(col.column)}) AS "min_${i}"`);
      selects.push(`MAX(${q(col.column)}) AS "max_${i}"`);
    }
  });
  const aggregateRows = await probe.query(
    `SELECT ${selects.join(", ")} FROM ${q(table)}`
  );
  const agg = aggregateRows[0] ?? {};

  const cardinalities: Record<string, number> = {};
  const ranges: Record<string, { min: string; max: string }> = {};
  columns.forEach((col, i) => {
    const cardRaw = agg[`card_${i}`];
    if (cardRaw !== undefined && cardRaw !== null) {
      cardinalities[col.column] = Number(normalizeCellValue(cardRaw));
    }
    const minRaw = agg[`min_${i}`];
    const maxRaw = agg[`max_${i}`];
    if (minRaw !== undefined && minRaw !== null) {
      ranges[col.column] = {
        min: normalizeCellValue(minRaw),
        max: normalizeCellValue(maxRaw),
      };
    }
  });

  // 第二遍：低基数列 topValues（频次降序，封顶）
  const topValues: Record<string, string[]> = {};
  const lowCardCols = columns.filter(
    (col) =>
      cardinalities[col.column] !== undefined &&
      cardinalities[col.column] > 0 &&
      cardinalities[col.column] <= LOW_CARDINALITY_THRESHOLD
  );
  for (const col of lowCardCols.slice(0, TOP_VALUE_QUERIES_PER_TABLE)) {
    try {
      const rows = await probe.query(
        `SELECT ${q(col.column)} AS "v", COUNT(*) AS "c" FROM ${q(table)} GROUP BY ${q(col.column)} ORDER BY "c" DESC LIMIT ${TOP_VALUES_MAX}`
      );
      topValues[col.column] = rows.map((r) => normalizeCellValue(r.v));
    } catch {
      // 单列细化失败不阻断其余列
    }
  }

  return {
    name: table,
    rowCount:
      agg.rowCount !== undefined && agg.rowCount !== null
        ? Number(normalizeCellValue(agg.rowCount))
        : undefined,
    columns,
    cardinalities,
    ranges,
    topValues,
  };
}

/** 采集整库画像：逐表收集，单表失败跳过（保证部分卡可用） */
export async function collectSchemaCard(input: {
  sourceId: string;
  probe: SchemaProbe;
  quoteIdent: (name: string) => string;
}): Promise<SchemaCard> {
  const tables = await input.probe.listTables();
  const profiles: RawTableProfile[] = [];
  for (const t of tables.slice(0, CARD_MAX_TABLES)) {
    try {
      profiles.push(
        await collectTableProfile(input.probe, t.table, {
          quoteIdent: input.quoteIdent,
        })
      );
    } catch (err) {
      console.warn(
        `[schema-card] 剖析表 ${t.table} 失败（跳过）:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return buildSchemaCard({
    sourceId: input.sourceId,
    profiles,
  });
}
