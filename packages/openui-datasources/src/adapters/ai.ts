import { tool, jsonSchema, type CoreTool } from "ai";
import type { McpToolBinding } from "../manager";

/**
 * 可选适配器：把 SDK 无关的工具绑定包装为 Vercel AI SDK CoreTool。
 * 工具定义以 MCP Server 为唯一事实来源；注册名已带 `<id>_` 前缀（manager 侧完成）。
 */
export function toAiTools(
  bindings: McpToolBinding[]
): Record<string, CoreTool> {
  const aiTools: Record<string, CoreTool> = {};
  for (const binding of bindings) {
    aiTools[binding.name] = tool({
      description: binding.description || binding.originalName,
      parameters: jsonSchema<Record<string, unknown>>(
        (binding.inputSchema as Record<string, unknown>) || {
          type: "object",
        }
      ),
      execute: async (args) =>
        binding.call(args as Record<string, unknown>),
    });
  }
  return aiTools;
}
