import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import {
  ingestSourceFiles,
  readManifest,
  removeSourceFiles,
  duckDbPath,
  sanitizeTableName,
  isSupportedUpload,
} from "./fileStore";
import { duckdbDialect } from "../db/duckdbDialect";

let filesDir: string;

beforeEach(() => {
  filesDir = fs.mkdtempSync(path.join(os.tmpdir(), "filestore-"));
});

afterEach(() => {
  fs.rmSync(filesDir, { recursive: true, force: true });
});

const CSV_SALES = Buffer.from(
  "city,amount,day\n北京,100,2024-01-01\n上海,250,2024-01-02\n北京,80,2024-01-03\n",
  "utf-8"
);

async function makeXlsx(
  sheets: { name: string; rows: (string | number)[][] }[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    for (const row of s.rows) ws.addRow(row);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function queryAll(dbPath: string, sql: string) {
  const client = await duckdbDialect.connect(dbPath);
  try {
    return await client.query(sql);
  } finally {
    await client.close();
  }
}

describe("sanitizeTableName", () => {
  it("清洗非法字符并小写化", () => {
    expect(sanitizeTableName("Sales Data 2024.csv", new Set())).toBe(
      "sales_data_2024"
    );
  });

  it("数字开头加 t_ 前缀", () => {
    expect(sanitizeTableName("2024报表", new Set())).toBe("t_2024");
  });

  it("空名兜底 table，冲突加序号", () => {
    const used = new Set<string>();
    expect(sanitizeTableName("!!!", used)).toBe("table");
    expect(sanitizeTableName("???", used)).toBe("table_2");
  });
});

describe("isSupportedUpload", () => {
  it("接受 .csv/.xlsx/.parquet/.json/.ndjson（大小写不敏感）", () => {
    expect(isSupportedUpload("a.csv")).toBe(true);
    expect(isSupportedUpload("A.XLSX")).toBe(true);
    expect(isSupportedUpload("b.parquet")).toBe(true);
    expect(isSupportedUpload("c.json")).toBe(true);
    expect(isSupportedUpload("d.NDJSON")).toBe(true);
    expect(isSupportedUpload("a.xls")).toBe(false);
    expect(isSupportedUpload("a.csv.zip")).toBe(false);
    expect(isSupportedUpload("noext")).toBe(false);
  });
});

describe("ingestSourceFiles: CSV", () => {
  it("灌库后 manifest 与查询链路正确（类型推断 + 聚合）", async () => {
    const manifest = await ingestSourceFiles(filesDir, "sales", [
      { name: "Sales Data.csv", data: CSV_SALES },
    ]);

    expect(manifest.files).toHaveLength(1);
    expect(manifest.tables).toHaveLength(1);
    const table = manifest.tables[0];
    expect(table.table).toBe("sales_data");
    expect(table.rowCount).toBe(3);
    expect(table.columns.map((c) => c.name)).toEqual(["city", "amount", "day"]);

    const res = await queryAll(
      duckDbPath(filesDir, "sales"),
      "SELECT city, sum(amount) AS total FROM sales_data GROUP BY city ORDER BY city"
    );
    expect(res.rows).toEqual([
      { city: "上海", total: 250 },
      { city: "北京", total: 180 },
    ]);
  });

  it("readManifest 往返一致", async () => {
    await ingestSourceFiles(filesDir, "sales", [
      { name: "s.csv", data: CSV_SALES },
    ]);
    const manifest = await readManifest(filesDir, "sales");
    expect(manifest?.tables[0].table).toBe("s");
  });

  it("未上传时 readManifest 返回 null", async () => {
    expect(await readManifest(filesDir, "ghost")).toBeNull();
  });
});

describe("ingestSourceFiles: Excel", () => {
  it("多 sheet 各自成表（<文件基名>__<sheet名>）", async () => {
    const xlsx = await makeXlsx([
      { name: "Q1", rows: [["item", "qty"], ["apple", 3], ["pear", 5]] },
      { name: "Q2 数据", rows: [["item", "qty"], ["apple", 7]] },
    ]);
    const manifest = await ingestSourceFiles(filesDir, "report", [
      { name: "季度 Report.xlsx", data: xlsx },
    ]);

    expect(manifest.tables.map((t) => t.table)).toEqual([
      "report__q1",
      "report__q2",
    ]);
    expect(manifest.tables[0]).toMatchObject({
      fromFile: "季度 Report.xlsx",
      sheet: "Q1",
      rowCount: 2,
    });

    const res = await queryAll(
      duckDbPath(filesDir, "report"),
      "SELECT sum(qty) AS total FROM report__q2"
    );
    expect(res.rows).toEqual([{ total: 7 }]);
  });

  it("单 sheet 直接用文件基名", async () => {
    const xlsx = await makeXlsx([
      { name: "Sheet1", rows: [["a", "b"], [1, 2]] },
    ]);
    const manifest = await ingestSourceFiles(filesDir, "single", [
      { name: "book.xlsx", data: xlsx },
    ]);
    expect(manifest.tables[0].table).toBe("book");
  });
});

describe("ingestSourceFiles: 覆盖与回滚", () => {
  it("重新上传完全覆盖：旧表消失、新表生效", async () => {
    await ingestSourceFiles(filesDir, "ds", [
      { name: "old_table.csv", data: CSV_SALES },
    ]);
    const before = await queryAll(
      duckDbPath(filesDir, "ds"),
      "SELECT table_name AS t FROM information_schema.tables"
    );
    expect(before.rows.map((r) => r.t)).toEqual(["old_table"]);

    const csvNew = Buffer.from("x,y\n1,2\n", "utf-8");
    const manifest = await ingestSourceFiles(filesDir, "ds", [
      { name: "new_table.csv", data: csvNew },
    ]);
    expect(manifest.tables.map((t) => t.table)).toEqual(["new_table"]);

    const after = await queryAll(
      duckDbPath(filesDir, "ds"),
      "SELECT table_name AS t FROM information_schema.tables"
    );
    expect(after.rows.map((r) => r.t)).toEqual(["new_table"]);
  });

  it("灌库失败保留旧数据（staging 回滚）", async () => {
    await ingestSourceFiles(filesDir, "ds", [
      { name: "good.csv", data: CSV_SALES },
    ]);
    const before = await readManifest(filesDir, "ds");

    // 伪 xlsx（内容非法）触发解析失败
    await expect(
      ingestSourceFiles(filesDir, "ds", [
        { name: "broken.xlsx", data: Buffer.from("not a zip", "utf-8") },
      ])
    ).rejects.toThrow();

    const after = await readManifest(filesDir, "ds");
    expect(after).toEqual(before);
    // 旧库仍可查
    const res = await queryAll(
      duckDbPath(filesDir, "ds"),
      "SELECT count(*) AS c FROM good"
    );
    expect(res.rows).toEqual([{ c: 3 }]);
    // staging 目录已清理
    expect(fs.readdirSync(filesDir).filter((d) => d.includes("staging"))).toEqual(
      []
    );
  });

  it("拒绝空上传", async () => {
    await expect(ingestSourceFiles(filesDir, "ds", [])).rejects.toThrow(
      "至少需要上传一个文件"
    );
  });

  it("拒绝不支持的类型", async () => {
    await expect(
      ingestSourceFiles(filesDir, "ds", [
        { name: "a.txt", data: Buffer.from("x") },
      ])
    ).rejects.toThrow("不支持的文件类型");
  });
});

describe("removeSourceFiles", () => {
  it("删除全部落盘内容", async () => {
    await ingestSourceFiles(filesDir, "ds", [
      { name: "a.csv", data: CSV_SALES },
    ]);
    expect(fs.existsSync(path.join(filesDir, "ds"))).toBe(true);
    await removeSourceFiles(filesDir, "ds");
    expect(fs.existsSync(path.join(filesDir, "ds"))).toBe(false);
  });

  it("目录不存在时不报错", async () => {
    await expect(removeSourceFiles(filesDir, "ghost")).resolves.toBeUndefined();
  });
});

describe("ingestSourceFiles: Parquet / JSON / NDJSON", () => {
  /** 用 DuckDB 现场生成 parquet fixture（零外部依赖） */
  async function makeParquetFixture(): Promise<Buffer> {
    const tmpDb = path.join(filesDir, `fixture-${process.pid}.duckdb`);
    const instance = await (await import("@duckdb/node-api")).DuckDBInstance.create(tmpDb);
    const conn = await instance.connect();
    const out = path.join(filesDir, "fixture.parquet");
    try {
      await conn.run(
        `COPY (SELECT * FROM (VALUES ('北京', 100), ('上海', 250)) AS t(city, amount)) TO ? (FORMAT PARQUET)`,
        [out]
      );
    } finally {
      conn.closeSync();
      instance.closeSync();
    }
    const buf = fs.readFileSync(out);
    fs.rmSync(tmpDb, { force: true });
    fs.rmSync(out, { force: true });
    return buf;
  }

  it("parquet 灌库：类型保留 + 可聚合；manifest 记 format=parquet", async () => {
    const parquet = await makeParquetFixture();
    expect(parquet.subarray(0, 4).toString("latin1")).toBe("PAR1");

    const manifest = await ingestSourceFiles(filesDir, "pq", [
      { name: "sales.parquet", data: parquet },
    ]);
    const table = manifest.tables.find((t) => t.table === "sales");
    expect(table?.format).toBe("parquet");
    expect(table?.rowCount).toBe(2);

    const result = await queryAll(duckDbPath(filesDir, "pq"), "SELECT sum(amount) AS total FROM sales");
    expect(Number(result.rows[0]?.total)).toBe(350);
  });

  it("json 数组灌库；ndjson 行文档灌库（read_json_auto 自动识别）", async () => {
    const jsonArr = Buffer.from(
      JSON.stringify([
        { city: "北京", amount: 100 },
        { city: "上海", amount: 250 },
      ]),
      "utf-8"
    );
    const ndjson = Buffer.from(
      '{"product":"apple","qty":3}\n{"product":"pear","qty":5}\n',
      "utf-8"
    );
    const manifest = await ingestSourceFiles(filesDir, "js", [
      { name: "sales.json", data: jsonArr },
      { name: "items.ndjson", data: ndjson },
    ]);
    expect(manifest.tables.find((t) => t.table === "sales")?.format).toBe("json");
    expect(manifest.tables.find((t) => t.table === "items")?.format).toBe("ndjson");

    const r1 = await queryAll(duckDbPath(filesDir, "js"), "SELECT sum(amount) AS t FROM sales");
    expect(Number(r1.rows[0]?.t)).toBe(350);
    const r2 = await queryAll(duckDbPath(filesDir, "js"), "SELECT sum(qty) AS t FROM items");
    expect(Number(r2.rows[0]?.t)).toBe(8);
  });

  it("伪装文件在灌库层明确报错（内容为 CSV 的 .parquet）", async () => {
    await expect(
      ingestSourceFiles(filesDir, "fake", [
        { name: "fake.parquet", data: CSV_SALES },
      ])
    ).rejects.toThrow();
    // 失败后旧数据语义：目标目录不应残留
    expect(fs.existsSync(path.join(filesDir, "fake"))).toBe(false);
  });

  it("坏 JSON 在灌库层明确报错", async () => {
    await expect(
      ingestSourceFiles(filesDir, "badjson", [
        { name: "bad.json", data: Buffer.from("{oops", "utf-8") },
      ])
    ).rejects.toThrow();
  });
});
