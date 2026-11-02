import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseClickhouseUrl, clickhouseDialect } from "./clickhouseDialect";
import type { DbDialectClient } from "./dialect";

/**
 * ClickHouse 方言：无真实服务器，mock @clickhouse/client 验证
 * URL 解析 / 封装传参（readonly、命名参数）/ 目录映射 / 词法守卫。
 */

const createClientMock = vi.fn();
const queryMock = vi.fn();

vi.mock("@clickhouse/client", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

/** 构造 JSON result 的 thenable 形态（对齐 rs.json() 用法） */
function jsonResult<T>(payload: T) {
  return { json: async () => payload };
}

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockReturnValue({
    query: queryMock,
    close: vi.fn(async () => {}),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseClickhouseUrl", () => {
  it("userinfo 凭证 + 路径库名", () => {
    const p = parseClickhouseUrl("http://admin:secret@ch.example:8123/analytics");
    expect(p).toEqual({
      url: "http://ch.example:8123",
      username: "admin",
      password: "secret",
      database: "analytics",
    });
  });

  it("query 参数凭证 + 缺省 default 用户", () => {
    const p1 = parseClickhouseUrl("https://ch.example:8443/?user=ro&password=p");
    expect(p1.username).toBe("ro");
    expect(p1.password).toBe("p");
    expect(p1.database).toBeUndefined();

    const p2 = parseClickhouseUrl("http://ch.example:8123");
    expect(p2.username).toBe("default");
    expect(p2.password).toBe("");
  });
});

describe("clickhouseDialect 契约（mock client）", () => {
  const CONN = "http://default:@ch.example:8123/analytics";

  async function connect(): Promise<DbDialectClient> {
    queryMock.mockResolvedValueOnce(
      jsonResult({ data: [{ one: 1 }], rows: 1 })
    );
    return clickhouseDialect.connect(CONN);
  }

  it("connect 传参正确 + fail-fast ping", async () => {
    await connect();
    expect(createClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://ch.example:8123",
        username: "default",
        database: "analytics",
      })
    );
    // fail-fast SELECT 1
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: "SELECT 1 AS one" })
    );
  });

  it("connect 失败（ping 报错）向上抛出", async () => {
    queryMock.mockRejectedValueOnce(new Error("Connect timeout"));
    await expect(clickhouseDialect.connect(CONN)).rejects.toThrow(
      "Connect timeout"
    );
  });

  it("query 封装：JSON 格式 + 引擎级 readonly=1 + 命名参数", async () => {
    const client = await connect();
    queryMock.mockResolvedValueOnce(
      jsonResult({ data: [{ a: 1 }, { a: 2 }], rows: 2 })
    );
    const res = await client.query("SELECT {p0: String} AS a", ["x"]);
    expect(res.rowCount).toBe(2);
    expect(queryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: "SELECT {p0: String} AS a",
        query_params: { p0: "x" },
        clickhouse_settings: { readonly: "1" },
      })
    );
  });

  it("listTables 走 SHOW TABLES 并映射 name → table", async () => {
    const client = await connect();
    queryMock.mockResolvedValueOnce(
      jsonResult({ data: [{ name: "events" }, { name: "users" }], rows: 2 })
    );
    const tables = await clickhouseDialect.listTables(client);
    expect(tables).toEqual([{ table: "events" }, { table: "users" }]);
    expect(queryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "SHOW TABLES" })
    );
  });

  it("describeTable：白名单插值 + name/type 映射；非法表名拒绝", async () => {
    const client = await connect();
    queryMock.mockResolvedValueOnce(
      jsonResult({
        data: [{ name: "event_time", type: "DateTime" }],
        rows: 1,
      })
    );
    const cols = await clickhouseDialect.describeTable(client, "events");
    expect(cols).toEqual([{ column: "event_time", type: "DateTime" }]);
    expect(queryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'DESCRIBE TABLE "events"' })
    );

    await expect(
      clickhouseDialect.describeTable(client, 'events"; DROP TABLE x--')
    ).rejects.toThrow("非法表名");
  });

  it("readOnlyQuery 词法守卫：写语句/多语句拒绝，SELECT 放行", async () => {
    const client = await connect();
    await expect(
      clickhouseDialect.readOnlyQuery(client, "DROP TABLE events")
    ).rejects.toThrow("安全限制");
    await expect(
      clickhouseDialect.readOnlyQuery(client, "SELECT 1; SELECT 2")
    ).rejects.toThrow("安全限制");

    queryMock.mockResolvedValueOnce(jsonResult({ data: [], rows: 0 }));
    await clickhouseDialect.readOnlyQuery(client, "SELECT * FROM events");
    // 自动追加行数封顶 LIMIT
    expect(queryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: expect.stringContaining("LIMIT") })
    );
  });

  it("连接串协议校验：非 http(s) URL 拒绝", async () => {
    await expect(clickhouseDialect.connect("ch.example:8123")).rejects.toThrow(
      "http(s):// URL"
    );
  });
});
