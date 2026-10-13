import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { DbDialect, DbDialectClient } from "./dialect";

/**
 * 创建动态 DB 源的进程内 MCP Server。
 * 工具契约与内置 postgres MCP 一致（execute_sql / list_tables / describe_table），
 * 目录查询走 information_schema；execute_sql 经方言 readOnlyQuery 强制只读。
 * 错误一律以 isError 内容返回，绝不抛出（与 postgresMcpServer 同策略）。
 */
export function createDbMcpServer(
  dialect: DbDialect,
  client: DbDialectClient,
  sourceName: string
): Server {
  const server = new Server(
    {
      name: `db-mcp-server-${sourceName}`,
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_tables",
        description: `列出 ${sourceName} 中可查询的数据表`,
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "describe_table",
        description: `查看 ${sourceName} 中某张表的列名与类型`,
        inputSchema: {
          type: "object",
          properties: {
            table_name: {
              type: "string",
              description: "数据表名，例如: \"orders\"",
            },
          },
          required: ["table_name"],
        },
      },
      {
        name: "execute_sql",
        description: `在 ${sourceName} 中安全执行只读 SELECT 查询，用于指标聚合与明细钻取。强制只读事务、5s 超时与行数封顶保护。`,
        inputSchema: {
          type: "object",
          properties: {
            sql: {
              type: "string",
              description: `标准的 ${dialect.dbType} SELECT 查询，例如: SELECT channel, SUM(amount) FROM orders GROUP BY channel`,
            },
          },
          required: ["sql"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "list_tables": {
        try {
          const tables = await dialect.listTables(client);
          return {
            content: [{ type: "text", text: JSON.stringify(tables) }],
          };
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [{ type: "text", text: `目录查询失败: ${errorMessage}` }],
          };
        }
      }

      case "describe_table": {
        const tableName = (args?.table_name as string) || "";
        try {
          const columns = await dialect.describeTable(client, tableName);
          if (columns.length === 0) {
            return {
              isError: true,
              content: [{ type: "text", text: `未找到数据表: ${tableName}` }],
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(columns) }],
          };
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [{ type: "text", text: `目录查询失败: ${errorMessage}` }],
          };
        }
      }

      case "execute_sql": {
        const sql = (args?.sql as string) || "";
        try {
          const result = await dialect.readOnlyQuery(client, sql);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  rowCount: result.rowCount,
                  rows: result.rows,
                }),
              },
            ],
          };
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [{ type: "text", text: `SQL 执行失败: ${errorMessage}` }],
          };
        }
      }

      default:
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
        };
    }
  });

  return server;
}
