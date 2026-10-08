import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { tool, jsonSchema, type CoreTool } from "ai";
import { createPostgresMcpServer } from "./postgresMcpServer";

let cachedClient: Client | null = null;
let cachedGitLabClient: Client | null = null;

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
 * 通过 MCP 协议调用 PostgreSQL 工具
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

/**
 * 获取或创建连接到外部 GitLab MCP Server 的 Client
 */
export async function getGitLabMcpClient(
  endpoint = process.env.GITLAB_MCP_URL || "http://127.0.0.1:5002/mcp",
  token = process.env.GITLAB_TOKEN || process.env.GITLAB_API_KEY || ""
): Promise<Client> {
  if (cachedGitLabClient) return cachedGitLabClient;

  const client = new Client(
    {
      name: "openui-gitlab-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  const headers: Record<string, string> = {};
  if (token) {
    headers["Private-Token"] = token;
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    // 优先采用 Streamable HTTP Transport
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: {
        headers,
      },
    });
    await client.connect(transport);
    cachedGitLabClient = client;
    return client;
  } catch {
    // 降级尝试标准 SSE Transport
    const sseTransport = new SSEClientTransport(new URL(endpoint), {
      requestInit: {
        headers,
      },
    });
    await client.connect(sseTransport);
    cachedGitLabClient = client;
    return client;
  }
}

/**
 * 动态发现并挂载 GitLab MCP 工具至 Vercel AI SDK
 */
export async function getGitLabAiTools(
  endpoint?: string,
  token?: string
): Promise<Record<string, CoreTool>> {
  try {
    const client = await getGitLabMcpClient(endpoint, token);
    const { tools } = await client.listTools();
    const aiTools: Record<string, CoreTool> = {};

    for (const mcpTool of tools) {
      aiTools[`gitlab_${mcpTool.name}`] = tool({
        description: `[GitLab MCP] ${mcpTool.description || mcpTool.name}`,
        parameters: jsonSchema<Record<string, unknown>>(
          (mcpTool.inputSchema as Record<string, unknown>) || { type: "object" }
        ),
        execute: async (args) => {
          console.log(`[GitLab MCP Tool] execute gitlab_${mcpTool.name}:`, args);
          const res = await client.callTool({
            name: mcpTool.name,
            arguments: args,
          });
          const contentList = Array.isArray(res.content) ? (res.content as McpContentItem[]) : [];
          if (res.isError) {
            const errorText = contentList.map((c) => c.text || "").join("\n");
            throw new Error(errorText || `GitLab tool ${mcpTool.name} execution failed`);
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
    console.warn("[GitLab MCP] 未连接或未授权，跳过外部 GitLab 工具挂载:", err instanceof Error ? err.message : err);
    return {};
  }
}
