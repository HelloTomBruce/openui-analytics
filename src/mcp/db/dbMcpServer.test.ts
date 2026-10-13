// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DIALECTS } from "./dialect";
import type { DbDialect, DbDialectClient } from "./dialect";
import { createDbMcpServer } from "./dbMcpServer";

interface FakeScript {
  match: RegExp;
  rows: Record<string, unknown>[];
}

function makeFakeClient(scripts: FakeScript[] = []) {
  const calls: string[] = [];
  const client: DbDialectClient = {
    async query(sql) {
      calls.push(sql);
      const hit = scripts.find((s) => s.match.test(sql));
      return {
        rows: hit ? hit.rows : [],
        rowCount: hit ? hit.rows.length : 0,
      };
    },
    async close() {},
  };
  return { client, calls };
}

async function connectServer(dialect: DbDialect, client: DbDialectClient) {
  const server = createDbMcpServer(dialect, client, "测试库");
  const mcpClient = new Client(
    { name: "test-db-client", version: "1.0.0" },
    { capabilities: {} }
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return mcpClient;
}

function resultText(res: { content: Array<{ type: string; text?: string }> }): string {
  return (res.content[0] as { text: string }).text ?? "";
}

describe("dbMcpServer 工具契约与只读防护", () => {
  it("ListTools 暴露 execute_sql / list_tables / describe_table", async () => {
    const { client } = makeFakeClient();
    const mcp = await connectServer(DIALECTS.postgres, client);
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "describe_table",
      "execute_sql",
      "list_tables",
    ]);
  });

  it("execute_sql 拒绝分号多语句", async () => {
    const { client } = makeFakeClient();
    const mcp = await connectServer(DIALECTS.postgres, client);
    const res = await mcp.callTool({
      name: "execute_sql",
      arguments: { sql: "select 1; drop table x" },
    });
    expect(res.isError).toBe(true);
    expect(resultText(res as never)).toContain("安全限制");
  });

  it("execute_sql 拒绝注释内嵌的写指令", async () => {
    const { client } = makeFakeClient();
    const mcp = await connectServer(DIALECTS.postgres, client);
    const res = await mcp.callTool({
      name: "execute_sql",
      arguments: { sql: "SELECT 1 -- c\ndrop table x" },
    });
    expect(res.isError).toBe(true);
    expect(resultText(res as never)).toContain("安全限制");
  });

  it("execute_sql 拒绝非 SELECT/WITH 开头", async () => {
    const { client } = makeFakeClient();
    const mcp = await connectServer(DIALECTS.postgres, client);
    const res = await mcp.callTool({
      name: "execute_sql",
      arguments: { sql: "UPDATE t SET x = 1" },
    });
    expect(res.isError).toBe(true);
    expect(resultText(res as never)).toContain("安全限制");
  });

  it("execute_sql 成功时强制只读事务、超时与行数封顶（postgres 方言）", async () => {
    const { client, calls } = makeFakeClient();
    const mcp = await connectServer(DIALECTS.postgres, client);
    const res = await mcp.callTool({
      name: "execute_sql",
      arguments: { sql: "select * from t" },
    });
    expect(res.isError).not.toBe(true); // 空 rows 也是成功查询
    expect(calls[0]).toBe("BEGIN READ ONLY");
    expect(calls).toContain("SET LOCAL statement_timeout = '5s'");
    expect(
      calls.some((c) => /select \* from t[\s\S]*LIMIT 200/i.test(c))
    ).toBe(true);
    expect(calls[calls.length - 1]).toBe("COMMIT");
  });

  it("mysql 方言只读包裹使用 READ ONLY 事务与 max_execution_time", async () => {
    const { client, calls } = makeFakeClient();
    await DIALECTS.mysql.readOnlyQuery(client, "select 1");
    expect(calls).toContain("START TRANSACTION READ ONLY");
    expect(calls).toContain("SET SESSION max_execution_time=5000");
    expect(calls.some((c) => /select 1[\s\S]*LIMIT 200/i.test(c))).toBe(true);
    expect(calls[calls.length - 1]).toBe("COMMIT");
  });

  it("list_tables 走 information_schema 目录查询", async () => {
    const { client, calls } = makeFakeClient([
      { match: /information_schema\.tables/i, rows: [{ table: "orders" }] },
    ]);
    const mcp = await connectServer(DIALECTS.postgres, client);
    const res = await mcp.callTool({ name: "list_tables", arguments: {} });
    expect(calls.some((c) => /information_schema\.tables/i.test(c))).toBe(true);
    const payload = JSON.parse(resultText(res as never));
    expect(payload).toEqual([{ table: "orders" }]);
  });

  it("describe_table 缺表返回 isError 与未找到提示", async () => {
    const { client } = makeFakeClient();
    const mcp = await connectServer(DIALECTS.postgres, client);
    const res = await mcp.callTool({
      name: "describe_table",
      arguments: { table_name: "nope" },
    });
    expect(res.isError).toBe(true);
    expect(resultText(res as never)).toContain("未找到数据表");
  });

  it("ping 通过 SELECT 1 探活", async () => {
    const { client, calls } = makeFakeClient();
    await DIALECTS.postgres.ping(client);
    expect(calls).toContain("SELECT 1");
  });
});
