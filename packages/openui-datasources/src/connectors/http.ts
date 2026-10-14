import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

/**
 * 通用 HTTP MCP 连接器：优先 Streamable HTTP Transport，失败降级标准 SSE。
 * 不做缓存——键控缓存由调用方（getGitLabMcpClient / dynamicSources）持有，
 * 保证「配置变更关闭旧连接」的策略归一。
 */
export async function connectHttpMcp(
  clientName: string,
  url: string,
  headers: Record<string, string>
): Promise<Client> {
  const client = new Client(
    {
      name: clientName,
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  try {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers,
      },
    });
    await client.connect(transport);
    return client;
  } catch {
    const sseTransport = new SSEClientTransport(new URL(url), {
      requestInit: {
        headers,
      },
    });
    await client.connect(sseTransport);
    return client;
  }
}
