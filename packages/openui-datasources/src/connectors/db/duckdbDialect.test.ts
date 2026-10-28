import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { duckdbDialect } from "./duckdbDialect";
import type { DbDialectClient } from "./dialect";

let dir: string;
let dbPath: string;
let client: DbDialectClient;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "duckdialect-"));
  dbPath = path.join(dir, "t.duckdb");
  // 读写实例建种子数据后关闭，方言始终以只读模式接入
  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();
  await conn.run(
    "CREATE TABLE t(id INTEGER, name VARCHAR, amount BIGINT); INSERT INTO t VALUES (1, 'a', 100), (2, 'b', 200)"
  );
  conn.closeSync();
  instance.closeSync();
  client = await duckdbDialect.connect(dbPath);
});

afterEach(async () => {
  await client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("duckdbDialect", () => {
  it("listTables / describeTable 走 information_schema", async () => {
    const tables = await duckdbDialect.listTables(client);
    expect(tables).toEqual([{ table: "t" }]);
    const cols = await duckdbDialect.describeTable(client, "t");
    expect(cols.map((c) => c.column)).toEqual(["id", "name", "amount"]);
  });

  it("BIGINT 归一化为 Number（JSON 可序列化）", async () => {
    const res = await duckdbDialect.readOnlyQuery(
      client,
      "SELECT sum(amount) AS total FROM t"
    );
    expect(res.rows).toEqual([{ total: 300 }]);
    expect(() => JSON.stringify(res.rows)).not.toThrow();
  });

  it("只读防护：拒绝写操作（词法层）", async () => {
    await expect(
      duckdbDialect.readOnlyQuery(client, "DROP TABLE t")
    ).rejects.toThrow("安全限制");
    await expect(
      duckdbDialect.readOnlyQuery(client, "DELETE FROM t WHERE id = 1")
    ).rejects.toThrow("安全限制");
  });

  it("引擎层 READ_ONLY：绕过词法层也无法写", async () => {
    await expect(
      client.query("CREATE TABLE evil(a INTEGER)")
    ).rejects.toThrow();
  });

  it("安全回归：表函数文件系统访问被禁用（read_csv_auto/glob/read_parquet）", async () => {
    // SELECT 开头且不含黑名单关键字，词法层必然放行；防线在引擎层
    await expect(
      duckdbDialect.readOnlyQuery(
        client,
        "SELECT * FROM read_csv_auto('/etc/hosts')"
      )
    ).rejects.toThrow(/Permission|disabled|File system/i);
    await expect(
      duckdbDialect.readOnlyQuery(client, "SELECT * FROM glob('/etc/*')")
    ).rejects.toThrow(/Permission|disabled|File system/i);
    await expect(
      duckdbDialect.readOnlyQuery(client, "SELECT * FROM read_parquet('/tmp/x.parquet')")
    ).rejects.toThrow(/Permission|disabled|File system/i);
  });

  it("禁用文件系统后库内表查询不受影响", async () => {
    const res = await duckdbDialect.readOnlyQuery(
      client,
      "SELECT name FROM t WHERE id = 1"
    );
    expect(res.rows).toEqual([{ name: "a" }]);
  });

  it("行数封顶：无 LIMIT 自动补 LIMIT 200", async () => {
    const res = await duckdbDialect.readOnlyQuery(
      client,
      "SELECT * FROM range(0, 500) t(i)"
    );
    expect(res.rows).toHaveLength(200);
  });

  it("ping 正常", async () => {
    await expect(duckdbDialect.ping(client)).resolves.toBeUndefined();
  });

  it("库文件不存在时 connect 报错", async () => {
    await expect(
      duckdbDialect.connect(path.join(dir, "ghost.duckdb"))
    ).rejects.toThrow();
  });
});
