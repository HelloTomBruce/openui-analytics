import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tool, jsonSchema, type CoreTool } from "ai";

let cachedZentaoClient: Client | null = null;
let isConnecting = false;

interface McpContentItem {
  type: string;
  text?: string;
}

/**
 * 获取或创建连接到本地 ZenTao CLI MCP Server 的 Client
 */
export async function getZentaoMcpClient(): Promise<Client> {
  if (cachedZentaoClient) return cachedZentaoClient;
  if (isConnecting) {
    // 简单等待锁
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (cachedZentaoClient) return cachedZentaoClient;
  }

  isConnecting = true;
  try {
    const client = new Client(
      {
        name: "openui-zentao-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    const transport = new StdioClientTransport({
      command: "zentao",
      args: ["mcp", "--read-only"],
    });

    transport.onerror = (err) => {
      console.warn("[ZenTao MCP Transport Error]:", err);
      cachedZentaoClient = null;
    };

    transport.onclose = () => {
      console.log("[ZenTao MCP Transport Closed]");
      cachedZentaoClient = null;
    };

    await client.connect(transport);
    cachedZentaoClient = client;
    return client;
  } finally {
    isConnecting = false;
  }
}

/**
 * 动态发现并挂载 ZenTao MCP 工具至 Vercel AI SDK
 */
export async function getZentaoAiTools(): Promise<Record<string, CoreTool>> {
  try {
    const client = await getZentaoMcpClient();
    const { tools } = await client.listTools();
    const aiTools: Record<string, CoreTool> = {};

    for (const mcpTool of tools) {
      aiTools[mcpTool.name] = tool({
        description: `[ZenTao 禅道] ${mcpTool.description || mcpTool.name}`,
        parameters: jsonSchema<Record<string, unknown>>(
          (mcpTool.inputSchema as Record<string, unknown>) || { type: "object" }
        ),
        execute: async (args) => {
          console.log(`[ZenTao MCP Tool] execute ${mcpTool.name}:`, args);
          const res = await client.callTool({
            name: mcpTool.name,
            arguments: args,
          });

          const contentList = Array.isArray(res.content) ? (res.content as McpContentItem[]) : [];
          if (res.isError) {
            const errorText = contentList.map((c) => c.text || "").join("\n");
            throw new Error(errorText || `ZenTao tool ${mcpTool.name} execution failed`);
          }

          const textOutput = contentList
            .filter((c) => c.type === "text")
            .map((c) => c.text || "")
            .join("\n");

          try {
            return JSON.parse(textOutput);
          } catch {
            return textOutput;
          }
        },
      });
    }

    return aiTools;
  } catch (err) {
    console.warn("[ZenTao MCP] 未连接或执行失败，跳过禅道工具挂载:", err instanceof Error ? err.message : err);
    return {};
  }
}
