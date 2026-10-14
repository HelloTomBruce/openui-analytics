/**
 * MCP 工具调用结果的统一解析：错误透传、text 内容拼接、JSON 尝试解析。
 * manager 工具绑定与 ai 适配器共用，避免重复实现漂移。
 */

/** 解析产物：JSON 值（对象/数组/标量）或未解析的原始文本 */
export type McpParsedResult =
  | string
  | number
  | boolean
  | null
  | McpParsedResult[]
  | { [key: string]: McpParsedResult };

interface McpContentItem {
  type: string;
  text?: string;
}

export function parseMcpToolResult(
  res: unknown,
  toolLabel: string
): McpParsedResult {
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
