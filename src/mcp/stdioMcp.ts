import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * stdio CLI 数据源连接器：按用户配置的 command + args 拉起子进程并完成 MCP 握手。
 * 不做缓存——键控缓存由 dynamicSources 持有（与其他 kind 同策略）。
 */
export async function connectStdioMcp(
  clientName: string,
  command: string,
  args: string[] = []
): Promise<Client> {
  const client = new Client(
    { name: clientName, version: "1.0.0" },
    { capabilities: {} }
  );
  const transport = new StdioClientTransport({ command, args });
  await client.connect(transport);
  return client;
}

/**
 * 真实握手探活：spawn → initialize(listTools) → close。
 * 无论成败都关闭连接，避免探活进程残留。
 */
export async function probeStdioCli(
  command: string,
  args: string[] = []
): Promise<void> {
  const client = await connectStdioMcp("openui-stdio-probe", command, args);
  try {
    await client.listTools();
  } finally {
    await client.close().catch(() => {});
  }
}
