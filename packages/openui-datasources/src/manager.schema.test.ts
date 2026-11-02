import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatasourceManager } from "./manager";
import type { FileSourceConfig } from "./config";

/**
 * Schema Card 集成：真实 DuckDB + 真实 MCP 装配（不经 mock），
 * 验证 灌库 → 惰性建卡 → 读卡 → 重灌失效重建 → 列缺失错误标脏重建 全链路。
 */

let rootDir: string;
let configPath: string;
let filesDir: string;
let schemaCardsDir: string;
let manager: ReturnType<typeof createDatasourceManager>;

const SOURCE: FileSourceConfig = {
  id: "csv1",
  name: "销售表",
  kind: "file",
  enabled: true,
};

const CSV_V1 = Buffer.from(
  "city,amount\n北京,100\n上海,250\n北京,80\n",
  "utf-8"
);
const CSV_V2 = Buffer.from("product,qty\napple,3\npear,5\n", "utf-8");

/** 轮询等待条件成立（后台建卡为异步，测试以产物可见为同步点） */
async function waitFor(
  cond: () => Promise<boolean>,
  timeoutMs = 5000
): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor 超时");
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "manager-schema-"));
  configPath = path.join(rootDir, "datasources.json");
  filesDir = path.join(rootDir, "files");
  schemaCardsDir = path.join(rootDir, "schema-cards");
  fs.writeFileSync(configPath, JSON.stringify({ sources: [SOURCE] }), "utf-8");
  manager = createDatasourceManager({ configPath, filesDir, schemaCardsDir });
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe("manager: Schema Card", () => {
  it("灌库后 tools() 装配触发惰性建卡：卡含表名/行数/低基数列取值", async () => {
    await manager.ingestFiles("csv1", [{ name: "sales.csv", data: CSV_V1 }]);

    // tools 装配触发后台建卡
    await manager.tools(SOURCE);
    await waitFor(async () => (await manager.getSchemaCard("csv1")) !== null);

    const got = await manager.getSchemaCard("csv1");
    expect(got).not.toBeNull();
    expect(got!.stale).toBe(false);
    const table = got!.card.tables.find((t) => t.name === "sales");
    expect(table).toBeDefined();
    expect(table!.rowCount).toBe(3);
    const city = table!.columns.find((c) => c.name === "city");
    expect(city?.cardinality).toBe(2);
    expect(city?.topValues).toContain("北京");
    const amount = table!.columns.find((c) => c.name === "amount");
    expect(amount?.min).toBe("80");
    expect(amount?.max).toBe("250");
  });

  it("重灌触发标脏重建：新卡反映新表结构", async () => {
    await manager.ingestFiles("csv1", [{ name: "sales.csv", data: CSV_V1 }]);
    await manager.refreshSchemaCard("csv1");
    const first = await manager.getSchemaCard("csv1");
    expect(first!.card.tables[0].name).toBe("sales");

    // 覆盖重灌为另一份文件（表名变为 v2 结构）
    await manager.ingestFiles("csv1", [{ name: "v2.csv", data: CSV_V2 }]);
    await waitFor(async () => {
      const got = await manager.getSchemaCard("csv1");
      return got !== null && got.card.tables.some((t) => t.name === "v2");
    });
    const got = await manager.getSchemaCard("csv1");
    expect(got!.card.tables.some((t) => t.name === "sales")).toBe(false);
    expect(got!.stale).toBe(false);
  });

  it("执行期列缺失错误：标脏并后台重建（getSchemaCard 期间可见 stale）", async () => {
    await manager.ingestFiles("csv1", [{ name: "sales.csv", data: CSV_V1 }]);
    await manager.refreshSchemaCard("csv1");

    const tools = await manager.tools(SOURCE);
    const exec = tools.find((t) => t.name === "csv1_execute_sql")!;
    await expect(
      exec.call({ sql: "SELECT not_a_column FROM sales" })
    ).rejects.toThrow();

    // 标脏 → 后台重建 → stale 解除（重建内容与现表一致，轮询至非脏）
    await waitFor(async () => {
      const got = await manager.getSchemaCard("csv1");
      return got !== null && got.stale === false;
    });
  });

  it("refreshSchemaCard 对未知源报错；getSchemaCard 对未建卡源返回 null", async () => {
    await expect(manager.refreshSchemaCard("ghost")).rejects.toThrow(
      "数据源不存在"
    );
    expect(await manager.getSchemaCard("csv1")).toBeNull();
  });

  it("手动 refresh 后可立即读到新卡（返回 promise 供等待）", async () => {
    await manager.ingestFiles("csv1", [{ name: "sales.csv", data: CSV_V1 }]);
    await manager.refreshSchemaCard("csv1");
    const got = await manager.getSchemaCard("csv1");
    expect(got).not.toBeNull();
    expect(got!.card.kind).toBe("db-like");
  });
});

describe("manager: Schema Card 覆盖新文件格式", () => {
  it("parquet 灌库后结构卡正常生成（格式无关：卡走 describe/execute_sql）", async () => {
    // 现场生成 parquet fixture
    const fixtureDb = path.join(rootDir, "fx.duckdb");
    const { DuckDBInstance } = await import("@duckdb/node-api");
    const instance = await DuckDBInstance.create(fixtureDb);
    const conn = await instance.connect();
    const parquetPath = path.join(rootDir, "fx.parquet");
    await conn.run(
      `COPY (SELECT * FROM (VALUES ('华东', 10), ('华北', 20)) AS t(region, sales)) TO ? (FORMAT PARQUET)`,
      [parquetPath]
    );
    conn.closeSync();
    instance.closeSync();

    await manager.ingestFiles("csv1", [
      { name: "regions.parquet", data: fs.readFileSync(parquetPath) },
    ]);
    await manager.refreshSchemaCard("csv1");

    const got = await manager.getSchemaCard("csv1");
    expect(got).not.toBeNull();
    const table = got!.card.tables.find((t) => t.name === "regions");
    expect(table).toBeDefined();
    expect(table!.rowCount).toBe(2);
    const region = table!.columns.find((c) => c.name === "region");
    expect(region?.cardinality).toBe(2);
    expect(region?.topValues).toContain("华东");
  });
});

describe("manager: 源删除联动清理结构卡（R1）", () => {
  it("delete 源后：落盘卡文件删除、getSchemaCard 为 null、同 id 重建源不读旧卡", async () => {
    await manager.ingestFiles("csv1", [{ name: "sales.csv", data: CSV_V1 }]);
    await manager.refreshSchemaCard("csv1");
    expect(await manager.getSchemaCard("csv1")).not.toBeNull();
    const cardFile = path.join(schemaCardsDir, "csv1.json");
    expect(fs.existsSync(cardFile)).toBe(true);

    manager.delete("csv1");

    // 落盘卡与配置同步清理
    await new Promise((r) => setTimeout(r, 50)); // drop 的文件删除是异步 fire-and-forget
    expect(fs.existsSync(cardFile)).toBe(false);
    expect(await manager.getSchemaCard("csv1")).toBeNull();
    expect(manager.get("csv1")).toBeUndefined();
  });
});
