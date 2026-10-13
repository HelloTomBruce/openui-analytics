import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { tool, jsonSchema, type CoreTool } from "ai";
import { connectHttpMcp } from "./httpMcp";
import { DIALECTS } from "./db/dialect";
import { createDbMcpServer } from "./db/dbMcpServer";
import { parseMcpToolResult } from "./parseToolResult";
import type { DynamicSourceConfig } from "./registry";

/**
 * 动态数据源装配器：按 source.kind 分派到 HTTP MCP 连接器或 DB 方言 MCP Server，
 * 并以「id + 完整配置」键控缓存连接——配置变更自动关闭旧连接重建，
 * 与 mcpClient 的 cachedGitLabEntry 同一策略。
 */

interface CacheEntry {
  key: string;
  tools: Record<string, CoreTool>;
  close: () => Promise<void>;
}

const sourceCache = new Map<string, CacheEntry>();

function configKey(source: DynamicSourceConfig): string {
  return source.kind === "http-mcp"
    ? JSON.stringify(["http-mcp", source.url, source.token ?? ""])
    : JSON.stringify(["db", source.dbType, source.connectionString]);
}

/** MCP listTools 结果 → AI SDK 工具集（工具定义以 MCP Server 为唯一事实来源）。
 *  注册名加 `<id>_` 前缀：动态源与内置源（如 postgres 的 list_tables 三件套）
 *  同契约同名时天然隔离，LLM 可按前缀明确选择目标源；MCP 侧调用仍用原始名。 */
function mountClientTools(
  client: Pick<Client, "listTools" | "callTool">,
  logPrefix: string,
  keyPrefix: string
): Promise<Record<string, CoreTool>> {
  return (async () => {
    const { tools } = await client.listTools();
    const aiTools: Record<string, CoreTool> = {};
    for (const mcpTool of tools) {
      aiTools[`${keyPrefix}${mcpTool.name}`] = tool({
        description: mcpTool.description || mcpTool.name,
        parameters: jsonSchema<Record<string, unknown>>(
          (mcpTool.inputSchema as Record<string, unknown>) || {
            type: "object",
          }
        ),
        execute: async (args) => {
          console.log(`[${logPrefix}] execute ${mcpTool.name}:`, args);
          const res = await client.callTool({
            name: mcpTool.name,
            arguments: args as Record<string, unknown>,
          });
          return parseMcpToolResult(res, `MCP tool ${mcpTool.name}`);
        },
      });
    }
    return aiTools;
  })();
}

async function buildHttpMcpTools(
  source: Extract<DynamicSourceConfig, { kind: "http-mcp" }>
): Promise<CacheEntry> {
  const headers: Record<string, string> = source.token
    ? { Authorization: `Bearer ${source.token}` }
    : {};
  const client = await connectHttpMcp(
    `openui-dynamic-${source.id}`,
    source.url,
    headers
  );
  const tools = await mountClientTools(
    client,
    `Dynamic ${source.id}`,
    `${source.id}_`
  );
  return {
    key: configKey(source),
    tools,
    close: async () => {
      try {
        await client.close();
      } catch {
        // 关闭失败不阻断
      }
    },
  };
}

async function buildDbTools(
  source: Extract<DynamicSourceConfig, { kind: "db" }>
): Promise<CacheEntry> {
  const dialect = DIALECTS[source.dbType];
  const dbClient = await dialect.connect(source.connectionString);
  const server = createDbMcpServer(dialect, dbClient, source.name);
  const mcpClient = new Client(
    { name: `openui-dynamic-${source.id}`, version: "1.0.0" },
    { capabilities: {} }
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  const tools = await mountClientTools(
    mcpClient,
    `Dynamic ${source.id}`,
    `${source.id}_`
  );
  return {
    key: configKey(source),
    tools,
    close: async () => {
      // 逐层关闭，任一失败不阻断其余
      for (const closeFn of [
        () => mcpClient.close(),
        () => server.close(),
        () => dbClient.close(),
      ]) {
        try {
          await closeFn();
        } catch {
          // ignore
        }
      }
    },
  };
}

/**
 * 取动态源工具集（键控缓存）。同 id 配置变化时关闭旧连接并重建。
 */
export async function getDynamicSourceTools(
  source: DynamicSourceConfig
): Promise<Record<string, CoreTool>> {
  const key = configKey(source);
  const cached = sourceCache.get(source.id);
  if (cached && cached.key === key) return cached.tools;

  if (cached) {
    sourceCache.delete(source.id);
    try {
      await cached.close();
    } catch {
      // ignore
    }
  }

  const entry =
    source.kind === "http-mcp"
      ? await buildHttpMcpTools(source)
      : await buildDbTools(source);
  sourceCache.set(source.id, entry);
  return entry.tools;
}

/**
 * 显式关闭某个动态源的缓存连接（配置删除/更新时由路由层调用）。
 * 未知 id 静默返回。
 */
export async function closeDynamicSource(id: string): Promise<void> {
  const entry = sourceCache.get(id);
  if (!entry) return;
  sourceCache.delete(id);
  try {
    await entry.close();
  } catch {
    // ignore
  }
}

/**
 * 合并工具集：同名工具后注册者跳过并告警（内置源优先，动态源按配置顺序）。
 */
export function mergeToolSets(
  target: Record<string, CoreTool>,
  incoming: Record<string, CoreTool>,
  sourceId: string
): void {
  for (const [name, t] of Object.entries(incoming)) {
    if (name in target) {
      console.warn(
        `[dynamicSources] 工具名冲突，跳过 ${name}（来自 ${sourceId}）`
      );
      continue;
    }
    target[name] = t;
  }
}
