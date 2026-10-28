import fs from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import ExcelJS from "exceljs";

/**
 * 文件数据源落盘层：CSV/Excel → DuckDB 完全覆盖式灌库 + manifest 读写。
 * 目录布局：<filesDir>/<sourceId>/raw/（原始文件）、analytics.duckdb、manifest.json。
 * 灌库采用「staging 目录构建 + 整体替换」：失败时旧数据原样保留。
 */

export const FILE_SOURCE_MAX_BYTES = 50 * 1024 * 1024;
export const FILE_SOURCE_EXTENSIONS = [".csv", ".xlsx"] as const;
export const FILE_SOURCE_DB_FILENAME = "analytics.duckdb";

export interface FileSourceUpload {
  name: string;
  data: Buffer;
}

export interface FileTableInfo {
  table: string;
  fromFile: string;
  sheet?: string;
  rowCount: number;
  columns: { name: string; type: string }[];
}

export interface FileSourceManifest {
  files: { name: string; size: number; uploadedAt: string }[];
  tables: FileTableInfo[];
  ingestedAt: string;
}

/** 上传文件类型校验：扩展名白名单（路由层负责大小限制与内容嗅探） */
export function isSupportedUpload(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return (FILE_SOURCE_EXTENSIONS as readonly string[]).includes(ext);
}

function sourceDir(filesDir: string, sourceId: string): string {
  return path.join(filesDir, sourceId);
}

/** 落盘文件名清洗：去路径分隔与危险字符，保留扩展名 */
function sanitizeStoredFilename(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const base = path
    .basename(name, path.extname(name))
    .replace(/[/\\]/g, "_")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${base || "upload"}${ext}`;
}

/** 清洗为合法表名片段（不去重）：小写、非法字符转 _、数字开头加 t_ */
function cleanTablePart(raw: string): string {
  let name = raw
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!name) name = "table";
  if (/^[0-9]/.test(name)) name = `t_${name}`;
  return name;
}

/** 去重：冲突加序号并登记 */
function dedupeTableName(base: string, used: Set<string>): string {
  let candidate = base;
  let i = 2;
  while (used.has(candidate)) candidate = `${base}_${i++}`;
  used.add(candidate);
  return candidate;
}

/** 表名清洗（单段输入，如 CSV 文件名）：分段清洗 + 去重 */
export function sanitizeTableName(raw: string, used: Set<string>): string {
  return dedupeTableName(cleanTablePart(raw), used);
}

/**
 * SQL 标识符白名单断言：sanitizeTableName 的输出天然满足 ^[a-z0-9_]+$，
 * 此处显式校验后才允许插值进 DDL（标识符无法参数化，只能走白名单）。
 */
function assertSafeIdentifier(identifier: string): string {
  if (!/^[a-z0-9_]+$/.test(identifier)) {
    throw new Error(`非法表名标识符: ${JSON.stringify(identifier)}`);
  }
  return identifier;
}

/** Excel 单元格 → CSV 字段文本（含 RFC-4180 转义） */
function csvCell(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) {
    s = value.toISOString();
  } else if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      s = value.richText.map((t) => t.text).join("");
    } else if ("result" in value) {
      const r = value.result;
      s = r === null || r === undefined ? "" : r instanceof Date ? r.toISOString() : String(r);
    } else if ("text" in value) {
      s = String(value.text);
    } else if ("error" in value) {
      s = "";
    } else {
      s = String(value);
    }
  } else {
    s = String(value);
  }
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface IngestTableSpec {
  table: string;
  fromFile: string;
  sheet?: string;
  csvPath: string;
}

/**
 * 完全覆盖式灌库：staging 目录解析 + 建库，成功后整体替换目标目录。
 * 任何一步失败抛出错误，旧数据不受影响。
 */
export async function ingestSourceFiles(
  filesDir: string,
  sourceId: string,
  uploads: FileSourceUpload[]
): Promise<FileSourceManifest> {
  if (uploads.length === 0) {
    throw new Error("至少需要上传一个文件");
  }
  const targetDir = sourceDir(filesDir, sourceId);
  const stagingDir = `${targetDir}.staging-${process.pid}`;
  await fs.rm(stagingDir, { recursive: true, force: true });
  const stagingRaw = path.join(stagingDir, "raw");
  await fs.mkdir(stagingRaw, { recursive: true });

  const usedNames = new Set<string>();
  const specs: IngestTableSpec[] = [];
  const manifestFiles: FileSourceManifest["files"] = [];
  const uploadedAt = new Date().toISOString();

  try {
    for (const upload of uploads) {
      const storedName = sanitizeStoredFilename(upload.name);
      const storedPath = path.join(stagingRaw, storedName);
      await fs.writeFile(storedPath, upload.data);
      manifestFiles.push({
        name: upload.name,
        size: upload.data.byteLength,
        uploadedAt,
      });

      const ext = path.extname(storedName).toLowerCase();
      const fileBase = path.basename(storedName, ext);
      if (ext === ".csv") {
        specs.push({
          table: sanitizeTableName(fileBase, usedNames),
          fromFile: upload.name,
          csvPath: storedPath,
        });
      } else if (ext === ".xlsx") {
        specs.push(
          ...(await excelToCsvSpecs(
            storedPath,
            upload.name,
            fileBase,
            stagingRaw,
            usedNames
          ))
        );
      } else {
        throw new Error(`不支持的文件类型: ${upload.name}（仅 .csv / .xlsx）`);
      }
    }

    if (specs.length === 0) {
      throw new Error("未能从上传文件中解析出任何数据表");
    }

    const tables = await buildDuckDb(stagingDir, specs);
    const manifest: FileSourceManifest = {
      files: manifestFiles,
      tables,
      ingestedAt: uploadedAt,
    };
    await fs.writeFile(
      path.join(stagingDir, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      "utf-8"
    );

    // 整体替换：先删旧目录再 rename（同分区原子语义）
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    await fs.rename(stagingDir, targetDir);
    return manifest;
  } catch (err) {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/**
 * xlsx → 每 sheet 一个临时 CSV（首行视为表头，与 CSV 文件行为一致）。
 * 用文档式 load 而非流式 WorkbookReader：后者存在 model 未就绪的竞态
 * （同一文件多次解析结果不定），50MB 上限下全量加载内存可接受。
 */
async function excelToCsvSpecs(
  xlsxPath: string,
  originalName: string,
  fileBase: string,
  stagingRaw: string,
  usedNames: Set<string>
): Promise<IngestTableSpec[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(xlsxPath);
  } catch (err) {
    throw new Error(
      `Excel 解析失败: ${originalName}（${err instanceof Error ? err.message : String(err)}）`
    );
  }

  interface SheetRows {
    name: string;
    rows: string[];
  }
  const sheets: SheetRows[] = [];
  for (const worksheet of workbook.worksheets) {
    const rows: string[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1);
      rows.push(values.map(csvCell).join(","));
    });
    while (rows.length > 0 && rows[rows.length - 1].trim() === "") rows.pop();
    if (rows.length > 0) {
      sheets.push({ name: worksheet.name, rows });
    }
  }

  const specs: IngestTableSpec[] = [];
  for (const [index, sheet] of sheets.entries()) {
    const csvName = `.sheet_${index}_${sanitizeStoredFilename(fileBase)}.tmp.csv`;
    const csvPath = path.join(stagingRaw, csvName);
    await fs.writeFile(csvPath, rowsToCsvText(sheet.rows), "utf-8");
    // 分段清洗后以 __ 拼接（折叠规则只作用于段内，保留分隔符语义）
    const base =
      sheets.length === 1
        ? cleanTablePart(fileBase)
        : `${cleanTablePart(fileBase)}__${cleanTablePart(sheet.name)}`;
    specs.push({
      table: dedupeTableName(base, usedNames),
      fromFile: originalName,
      sheet: sheet.name,
      csvPath,
    });
  }
  return specs;
}

function rowsToCsvText(rows: string[]): string {
  return rows.join("\n") + "\n";
}

/** 在 staging 目录建 DuckDB 库：逐表 read_csv_auto 灌入并收集列/行数 */
async function buildDuckDb(
  stagingDir: string,
  specs: IngestTableSpec[]
): Promise<FileTableInfo[]> {
  const dbPath = path.join(stagingDir, FILE_SOURCE_DB_FILENAME);
  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();
  const tables: FileTableInfo[] = [];
  try {
    for (const spec of specs) {
      const safeTable = assertSafeIdentifier(spec.table);
      // 标识符无法参数化：safeTable 已经白名单断言（^[a-z0-9_]+$），路径走绑定参数
      const createSql = `CREATE TABLE "${safeTable}" AS SELECT * FROM read_csv_auto(?, header=true)`;
      await connection.run(createSql, [spec.csvPath]);
      const cols = await connection.run(
        `SELECT column_name AS column, data_type AS type
         FROM information_schema.columns
         WHERE table_name = ?
         ORDER BY ordinal_position`,
        [spec.table]
      );
      const colRows = await cols.getRowsJS();
      const countSql = `SELECT count(*) AS c FROM "${safeTable}"`;
      const count = await connection.run(countSql);
      const countRows = await count.getRowsJS();
      tables.push({
        table: spec.table,
        fromFile: spec.fromFile,
        ...(spec.sheet !== undefined ? { sheet: spec.sheet } : {}),
        rowCount: Number(countRows[0]?.[0] ?? 0),
        columns: colRows.map((r) => ({
          name: String(r[0]),
          type: String(r[1]),
        })),
      });
    }
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
  return tables;
}

/** 读取 manifest；未上传或损坏返回 null */
export async function readManifest(
  filesDir: string,
  sourceId: string
): Promise<FileSourceManifest | null> {
  try {
    const raw = await fs.readFile(
      path.join(sourceDir(filesDir, sourceId), "manifest.json"),
      "utf-8"
    );
    return JSON.parse(raw) as FileSourceManifest;
  } catch {
    return null;
  }
}

/** 删除数据源时联动清理全部落盘内容 */
export async function removeSourceFiles(
  filesDir: string,
  sourceId: string
): Promise<void> {
  await fs.rm(sourceDir(filesDir, sourceId), { recursive: true, force: true });
}

/** DuckDB 库文件路径（连接前由调用方确认 manifest 存在） */
export function duckDbPath(filesDir: string, sourceId: string): string {
  return path.join(sourceDir(filesDir, sourceId), FILE_SOURCE_DB_FILENAME);
}
