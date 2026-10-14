// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// pg：Pool.query 若被直接调用即抛错——只读事务必须走 connect() 拿到的专用连接
const sharedClientCalls: string[] = [];
const sharedClient = {
  query: vi.fn(async (sql: string) => {
    sharedClientCalls.push(sql);
    return { rows: [], rowCount: 0 };
  }),
  release: vi.fn(),
};

vi.mock("pg", () => ({
  // 用 function 而非箭头函数，保证可被 new 调用（构造函数返回对象时以对象为准）
  Pool: vi.fn().mockImplementation(function () {
    return {
      connect: async () => sharedClient,
      query: async () => {
        throw new Error("必须走专用连接（pool.connect 的 client）");
      },
      end: async () => {},
    };
  }),
}));

// mysql2：记录 query(sql, params) 的参数透传（泛型签名供 mock.calls 取参，实现零参数）
type MysqlPoolQuery = (
  sql: string,
  params?: unknown[]
) => Promise<unknown[]>;
const mysqlPoolQuery = vi.fn<MysqlPoolQuery>(
  async () => [[{ table: "orders" }]] as unknown[]
);

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn(() => ({
    query: mysqlPoolQuery,
    end: async () => {},
  })),
}));

import { Pool } from "pg";
import { createPool } from "mysql2/promise";
import { postgresDialect } from "./postgresDialect";
import { mysqlDialect } from "./mysqlDialect";

describe("postgresDialect 连接层（真实 Pool 语义守护）", () => {
  beforeEach(() => {
    sharedClientCalls.length = 0;
    vi.clearAllMocks();
  });

  it("readOnlyQuery 的四步全部落在同一专用连接上", async () => {
    const conn = await postgresDialect.connect("postgres://u:p@h:5432/db");
    await postgresDialect.readOnlyQuery(conn, "select 1");

    expect(sharedClientCalls).toEqual([
      "BEGIN READ ONLY",
      "SET LOCAL statement_timeout = '5s'",
      expect.stringMatching(/^select 1/i),
      "COMMIT",
    ]);
  });

  it("close 释放专用连接并关闭池", async () => {
    const conn = await postgresDialect.connect("postgres://u:p@h:5432/db");
    await conn.close();

    expect(sharedClient.release).toHaveBeenCalled();
    expect(vi.mocked(Pool).mock.results[0]?.value.end).toBeTruthy();
  });
});

describe("mysqlDialect 连接层（真实 pool 语义守护）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listTables 的 SQL 用反引号转义保留字别名", async () => {
    const conn = await mysqlDialect.connect("mysql://u:p@h:3306/db");
    await mysqlDialect.listTables(conn);

    expect(mysqlPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("AS `table`")
    );
  });

  it("describeTable 的 ? 占位符参数被透传给 pool.query", async () => {
    const conn = await mysqlDialect.connect("mysql://u:p@h:3306/db");
    await mysqlDialect.describeTable(conn, "orders");

    expect(mysqlPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("table_name = ?"),
      ["orders"]
    );
  });

  it("describeTable 的保留字别名同样反引号转义", async () => {
    const conn = await mysqlDialect.connect("mysql://u:p@h:3306/db");
    await mysqlDialect.describeTable(conn, "orders");

    const sql = String(mysqlPoolQuery.mock.calls[0]?.[0]);
    expect(sql).toContain("AS `column`");
    expect(sql).toContain("AS `type`");
  });

  it("ping 走 SELECT 1", async () => {
    const conn = await mysqlDialect.connect("mysql://u:p@h:3306/db");
    await mysqlDialect.ping(conn);

    expect(mysqlPoolQuery).toHaveBeenCalledWith("SELECT 1");
  });

  it("createPool 收到连接串与连接上限", async () => {
    await mysqlDialect.connect("mysql://u:p@h:3306/db");
    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: "mysql://u:p@h:3306/db",
        connectionLimit: 2,
      })
    );
  });
});
