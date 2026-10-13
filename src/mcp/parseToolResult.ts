/**
 * MCP 工具调用结果的统一解析：错误透传、text 内容拼接、JSON 尝试解析。
 * mcpClient / zentaoMcpClient 共用，避免三处重复实现漂移。
 */

interface McpContentItem {
  type: string;
  text?: string;
}

export function parseMcpToolResult(res: unknown, toolLabel: string): unknown {
  // SDK 的 CallToolResult 是联合类型（含 toolResult 变体），此处按 content/isError 形态收窄
  const r = (res ?? {}) as { content?: unknown; isError?: boolean };
  const contentList = Array.isArray(r.content) ? (r.content as McpContentItem[]) : [];

  if (r.isError) {
    const errorText = contentList.map((c) => c.text || "").join("\n");
    throw new Error(errorText || `${toolLabel} execution failed`);
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
