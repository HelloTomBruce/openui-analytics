import { streamText, tool, jsonSchema } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { getOpenUISystemPrompt } from "@/lib/prompt";
import { callMcpTool } from "@/mcp/mcpClient";

export async function POST(req: Request) {
  try {
    const {
      messages = [],
      apiKey: clientKey,
      baseURL: clientBaseURL,
      model: clientModel,
    } = await req.json();

    const apiKey = clientKey || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
    const baseURL = clientBaseURL || process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || "https://api.openai.com/v1";
    const model = clientModel || process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4o-mini";

    // 当未配置 Key 时，返回合规的 Data Stream 协议响应
    if (!apiKey) {
      const msg = `⚠️ 请先在右上角「LLM 设置」中配置您的 API Key。\n\n\`\`\`openui\nInsightBox(type="warning", title="未检测到 LLM API Key", content="请点击右上角「LLM 设置」输入 API Key，开启由 Vercel AI SDK + PostgreSQL MCP 驱动的流式数据分析看板。")\n\`\`\``;
      const dataStreamChunk = `0:${JSON.stringify(msg)}\nd:{"finishReason":"stop","usage":{"promptTokens":0,"completionTokens":0}}\n`;

      return new Response(dataStreamChunk, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "x-vercel-ai-data-stream": "v1",
        },
      });
    }

    const openai = createOpenAI({
      apiKey,
      baseURL: baseURL.replace(/\/+$/, ""),
    });

    const result = streamText({
      model: openai(model),
      system: getOpenUISystemPrompt(),
      messages,
      temperature: 0.1,
      tools: {
        execute_sql: tool({
          description: "在 PostgreSQL 数据库中安全执行只读 SELECT 查询以获取指标数据",
          parameters: jsonSchema<{ sql: string }>({
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "标准的 PostgreSQL SELECT 查询，例如: SELECT channel, AVG(cac) FROM channel_metrics GROUP BY channel",
              },
            },
            required: ["sql"],
          }),
          execute: async ({ sql }) => {
            console.log("[Vercel AI SDK -> MCP Tool] execute_sql:", sql);
            return await callMcpTool("execute_sql", { sql });
          },
        }),
        list_tables: tool({
          description: "获取数据库中所有可用于商业分析的业务数据表名称及描述",
          parameters: jsonSchema<{ keyword?: string }>({
            type: "object",
            properties: {
              keyword: {
                type: "string",
                description: "可选的表名或业务主题过滤关键词",
              },
            },
          }),
          execute: async () => {
            console.log("[Vercel AI SDK -> MCP Tool] list_tables");
            return await callMcpTool("list_tables", {});
          },
        }),
        describe_table: tool({
          description: "按需查看指定数据表的列名和字段类型",
          parameters: jsonSchema<{ table_name: string }>({
            type: "object",
            properties: {
              table_name: {
                type: "string",
                description: "数据表名，例如: channel_metrics, sales_rep_performance, monthly_trends",
              },
            },
            required: ["table_name"],
          }),
          execute: async ({ table_name }) => {
            console.log("[Vercel AI SDK -> MCP Tool] describe_table:", table_name);
            return await callMcpTool("describe_table", { table_name });
          },
        }),
      },
      maxSteps: 5,
    });

    return result.toDataStreamResponse({
      getErrorMessage: (err: unknown) => {
        console.error("[AI SDK Stream Error]:", err);
        return err instanceof Error ? err.message : String(err);
      },
    });
  } catch (err: unknown) {
    console.error("Vercel AI SDK Route error:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      `3:${JSON.stringify(errorMessage)}\n`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "x-vercel-ai-data-stream": "v1",
        },
      }
    );
  }
}
