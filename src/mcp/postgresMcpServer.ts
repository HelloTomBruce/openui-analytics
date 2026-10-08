import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  initDatabase,
  executeReadOnlySql,
  pool,
} from "@/lib/postgres";

/**
 * 创建并配置 PostgreSQL Analytics MCP Server
 */
export function createPostgresMcpServer() {
  const server = new Server(
    {
      name: "postgres-analytics-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // 1. 注册 MCP Resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "postgres://openui_analytics/schema",
          name: "PostgreSQL Database Schema",
          mimeType: "text/plain",
          description: "Database table list and metadata for openui_analytics",
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === "postgres://openui_analytics/schema") {
      await initDatabase();
      const res = await pool.query(`
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' 
          AND table_name IN ('channel_metrics', 'sales_rep_performance', 'monthly_trends')
        ORDER BY table_name, ordinal_position;
      `);
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(res.rows, null, 2),
          },
        ],
      };
    }
    throw new Error(`Resource not found: ${request.params.uri}`);
  });

  // 2. 注册 MCP Tools (按需调用，无需每次把 Schema 塞进 Prompt)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "list_tables",
          description: "获取数据库中所有可用于商业分析的业务数据表名称及描述",
          inputSchema: {
            type: "object",
            properties: {
              keyword: {
                type: "string",
                description: "可选的搜索关键词",
              },
            },
          },
        },
        {
          name: "describe_table",
          description: "按需查看指定数据表的列名、数据类型及字段含义，避免一次性加载全部 Schema",
          inputSchema: {
            type: "object",
            properties: {
              table_name: {
                type: "string",
                description: "数据表名，例如: channel_metrics, sales_rep_performance, monthly_trends",
              },
            },
            required: ["table_name"],
          },
        },
        {
          name: "execute_sql",
          description: "在 PostgreSQL 数据库中安全执行只读 SELECT 查询，用于指标聚合、同比环比计算与明细钻取。严格只读并施加行数限制保护。",
          inputSchema: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "标准的 PostgreSQL SELECT 查询，例如: SELECT channel, SUM(spend) as total_spend, AVG(cac) as avg_cac FROM channel_metrics GROUP BY channel",
              },
            },
            required: ["sql"],
          },
        },
      ],
    };
  });

  // 3. 执行 MCP Tool 调用
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    await initDatabase();
    const { name, arguments: args } = request.params;

    switch (name) {
      case "list_tables": {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify([
                {
                  table: "channel_metrics",
                  description: "各推广渠道月度投放与线索转化指标表",
                  columns: "channel (VARCHAR), month (VARCHAR 'YYYY-MM'), spend (NUMERIC), impressions (INT), clicks (INT), leads (INT), cac (NUMERIC), cvr (NUMERIC), roi (NUMERIC)",
                },
                {
                  table: "sales_rep_performance",
                  description: "销售团队各代表业绩与胜率表",
                  columns: "rep_name (VARCHAR), region (VARCHAR), target_revenue (NUMERIC), actual_revenue (NUMERIC), deals_closed (INT), win_rate (NUMERIC), month (VARCHAR)",
                },
                {
                  table: "monthly_trends",
                  description: "公司宏观月度总营收与成本趋势表",
                  columns: "month (VARCHAR 'YYYY-MM'), revenue (NUMERIC), marketing_cost (NUMERIC), new_leads (INT), paying_customers (INT)",
                },
              ]),
            },
          ],
        };
      }

      case "describe_table": {
        const tableName = (args?.table_name as string) || "";
        const res = await pool.query(
          `
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position;
        `,
          [tableName]
        );

        if (res.rows.length === 0) {
          return {
            isError: true,
            content: [{ type: "text", text: `未找到数据表: ${tableName}` }],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                table: tableName,
                columns: res.rows.map((c) => ({
                  column: c.column_name,
                  type: c.data_type,
                })),
              }),
            },
          ],
        };
      }

      case "execute_sql": {
        const sql = (args?.sql as string) || "";
        try {
          const result = await executeReadOnlySql(sql);
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
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}
