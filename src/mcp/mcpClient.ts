import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { tool, jsonSchema, type CoreTool } from "ai";
import { createPostgresMcpServer } from "./postgresMcpServer";

let cachedClient: Client | null = null;
// GitLab 客户端按「endpoint+token」键控缓存：用户在设置页修改配置后
// 必须立即生效（键变化时关闭旧连接重建），且不同配置之间绝不串用连接。
let cachedGitLabEntry: { key: string; client: Client } | null = null;

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
 * 动态发现 PostgreSQL MCP 工具并挂载至 Vercel AI SDK。
 * 与 GitLab/ZenTao 同一 pattern：工具定义以 MCP Server 为唯一事实来源，
 * 路由层不再手写重复包装。
 */
export async function getPostgresAiTools(): Promise<Record<string, CoreTool>> {
  const client = await getPostgresMcpClient();
  const { tools } = await client.listTools();
  const aiTools: Record<string, CoreTool> = {};

  for (const mcpTool of tools) {
    aiTools[mcpTool.name] = tool({
      description: mcpTool.description || mcpTool.name,
      parameters: jsonSchema<Record<string, unknown>>(
        (mcpTool.inputSchema as Record<string, unknown>) || { type: "object" }
      ),
      execute: async (args) => {
        console.log(`[PostgreSQL MCP Tool] execute ${mcpTool.name}:`, args);
        return callMcpTool(mcpTool.name, args);
      },
    });
  }

  return aiTools;
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
  const cacheKey = `${endpoint}::${token}`;
  if (cachedGitLabEntry?.key === cacheKey) return cachedGitLabEntry.client;

  // 配置已变化：先关闭旧连接，避免泄漏与跨配置串用
  if (cachedGitLabEntry) {
    const stale = cachedGitLabEntry.client;
    cachedGitLabEntry = null;
    try {
      await stale.close();
    } catch {
      // 旧连接关闭失败不阻断新连接建立
    }
  }

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
    cachedGitLabEntry = { key: cacheKey, client };
    return client;
  } catch {
    // 降级尝试标准 SSE Transport
    const sseTransport = new SSEClientTransport(new URL(endpoint), {
      requestInit: {
        headers,
      },
    });
    await client.connect(sseTransport);
    cachedGitLabEntry = { key: cacheKey, client };
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
