import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sqliteDialect, sqlitePath } from "./sqliteDialect";
import { createDatasourceManager } from "../../manager";
import type { DbSourceConfig } from "../../config";

/**
 * SQLite 方言全链路：真实数据库文件（node:sqlite 双向使用——
 * 可写模式建 fixture，方言 readOnly 模式连接）。
 */

let dir: string;
let dbFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-dialect-"));
  dbFile = path.join(dir, "analytics.db");
  // fixture：两张表 + 低基数列 + 数值列
  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT, amount REAL, created_at TEXT);
    CREATE TABLE regions (code TEXT, name TEXT);
    INSERT INTO orders (status, amount, created_at) VALUES
      ('paid', 100.5, '2026-01-01'),
      ('paid', 250.0, '2026-01-02'),
      ('shipped', 80.0, '2026-01-03'),
      ('refunded', 30.0, '2026-01-04');
    INSERT INTO regions (code, name) VALUES ('hz', '杭州'), ('sh', '上海');
  `);
  db.close();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("sqlitePath", () => {
  it("剥 sqlite: 前缀；纯路径原样返回", () => {
    expect(sqlitePath("sqlite:/tmp/a.db")).toBe("/tmp/a.db");
    expect(sqlitePath("./rel.db")).toBe("./rel.db");
  });
});

describe("sqliteDialect 契约", () => {
  it("connect/listTables/describeTable/readOnlyQuery/ping 全链路", async () => {
    const client = await sqliteDialect.connect(dbFile);

    const tables = await sqliteDialect.listTables(client);
    expect(tables.map((t) => t.table).sort()).toEqual(["orders", "regions"]);

    const cols = await sqliteDialect.describeTable(client, "orders");
    expect(cols.map((c) => c.column)).toEqual(["id", "status", "amount", "created_at"]);
    expect(cols[1].type.toUpperCase()).toContain("TEXT");

    const res = await sqliteDialect.readOnlyQuery(
      client,
      "SELECT status, sum(amount) AS total FROM orders GROUP BY status"
    );
    expect(res.rowCount).toBe(3);
    const paid = res.rows.find((r) => r.status === "paid");
    expect(Number(paid?.total)).toBeCloseTo(350.5);

    await sqliteDialect.ping(client);
    await client.close();
  });

  it("sqlite: 前缀连接串等效", async () => {
    const client = await sqliteDialect.connect(`sqlite:${dbFile}`);
    const tables = await sqliteDialect.listTables(client);
    expect(tables).toHaveLength(2);
    await client.close();
  });

  it("词法守卫：写语句/多语句被拒（友好报错）", async () => {
    const client = await sqliteDialect.connect(dbFile);
    await expect(
      sqliteDialect.readOnlyQuery(client, "DELETE FROM orders")
    ).rejects.toThrow("安全限制");
    await expect(
      sqliteDialect.readOnlyQuery(client, "SELECT 1; SELECT 2")
    ).rejects.toThrow("安全限制");
    await expect(
      sqliteDialect.readOnlyQuery(client, "SELECT * FROM orders; DROP TABLE orders")
    ).rejects.toThrow("安全限制");
    await client.close();
  });

  it("引擎级只读：绕过词法守卫的写语句被 readOnly 打开模式拒绝", async () => {
    const client = await sqliteDialect.connect(dbFile);
    // 直接走 client.query（不经 guardReadOnlySql）模拟词法层被绕过
    await expect(
      client.query("INSERT INTO orders (status, amount) VALUES ('x', 1)")
    ).rejects.toThrow();
    await expect(client.query("CREATE TABLE hack (a)")).rejects.toThrow();
    await client.close();
  });

  it("行数封顶：无 LIMIT 自动追加", async () => {
    const client = await sqliteDialect.connect(dbFile);
    const res = await sqliteDialect.readOnlyQuery(client, "SELECT * FROM orders");
    expect(res.rows.length).toBeLessThanOrEqual(4); // fixture 共 4 行，封顶不放大
    await client.close();
  });

  it("describeTable 白名单拒绝非法表名（防 PRAGMA 注入）", async () => {
    const client = await sqliteDialect.connect(dbFile);
    await expect(
      sqliteDialect.describeTable(client, 'orders"; DROP TABLE x--')
    ).rejects.toThrow("非法表名");
    await client.close();
  });

  it("文件不存在时 connect 报错", async () => {
    await expect(
      sqliteDialect.connect(path.join(dir, "ghost.db"))
    ).rejects.toThrow();
  });
});

describe("manager 集成：SQLite 建源 → 装配 → 提问链路", () => {
  it("零 manager 特例：经 DIALECTS 注册即全链路可用，且结构卡可生成", async () => {
    const configPath = path.join(dir, "datasources.json");
    const source: DbSourceConfig = {
      id: "lite",
      name: "本地 SQLite",
      kind: "db",
      dbType: "sqlite",
      connectionString: dbFile,
      enabled: true,
    };
    fs.writeFileSync(configPath, JSON.stringify({ sources: [source] }), "utf-8");
    const manager = createDatasourceManager({
      configPath,
      schemaCardsDir: path.join(dir, "cards"),
    });

    // 工具装配（进程内 MCP）+ execute_sql
    const tools = await manager.tools(source);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "lite_describe_table",
      "lite_execute_sql",
      "lite_list_tables",
    ]);
    const exec = tools.find((t) => t.name === "lite_execute_sql")!;
    const result = (await exec.call({
      sql: "SELECT count(*) AS c FROM orders",
    })) as { rows?: Record<string, unknown>[] };
    expect(Number(result.rows?.[0]?.c)).toBe(4);

    // 结构卡（Task-010 的能力对新方言天然生效）
    await manager.refreshSchemaCard("lite");
    const card = await manager.getSchemaCard("lite");
    expect(card).not.toBeNull();
    const orders = card!.card.tables.find((t) => t.name === "orders");
    expect(orders?.rowCount).toBe(4);
    expect(
      orders?.columns.find((c) => c.name === "status")?.topValues
    ).toContain("paid");

    await manager.close("lite");
  });
});
