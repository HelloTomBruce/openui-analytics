import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tool, jsonSchema, type CoreTool } from "ai";
import { parseMcpToolResult } from "./parseToolResult";

let cachedZentaoClient: Client | null = null;
// 连接中的共享 Promise：并发调用复用同一次连接过程，替代「sleep 500ms 赌运气」的假锁
let connectingPromise: Promise<Client> | null = null;

/**
 * 获取或创建连接到本地 ZenTao CLI MCP Server 的 Client
 */
export function getZentaoMcpClient(): Promise<Client> {
  if (cachedZentaoClient) return Promise.resolve(cachedZentaoClient);

  if (!connectingPromise) {
    connectingPromise = (async () => {
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
    })().finally(() => {
      connectingPromise = null;
    });
  }

  return connectingPromise;
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
          return parseMcpToolResult(res, `ZenTao tool ${mcpTool.name}`);
        },
      });
    }

    return aiTools;
  } catch (err) {
    console.warn("[ZenTao MCP] 未连接或执行失败，跳过禅道工具挂载:", err instanceof Error ? err.message : err);
    return {};
  }
}
