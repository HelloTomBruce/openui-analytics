import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPostgresMcpServer } from "./postgresMcpServer";

let cachedClient: Client | null = null;

/**
 * 获取或创建已连接的 PostgreSQL MCP Client
 */
export async function getPostgresMcpClient(): Promise<Client> {
  if (cachedClient) return cachedClient;

  const server = createPostgresMcpServer();
  const client = new Client(
    {
      name: "openui-analytics-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  cachedClient = client;
  return client;
}

interface McpContentItem {
  type: string;
  text?: string;
}

/**
 * 从 MCP Server 获取转换后的 OpenAI / LLM 标准 Function Tools 列表
 */
export async function getOpenAIToolsFromMcp(): Promise<Array<{
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: unknown;
  };
}>> {
  const client = await getPostgresMcpClient();
  const result = await client.listTools();

  return result.tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

/**
 * 通过 MCP 协议调用工具
 */
export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const client = await getPostgresMcpClient();
  const res = await client.callTool({
    name,
    arguments: args,
  });

  const contentList = Array.isArray(res.content) ? (res.content as McpContentItem[]) : [];

  if (res.isError) {
    const errorText = contentList.map((c) => c.text || "").join("\n");
    throw new Error(errorText || "MCP tool execution failed");
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
}
