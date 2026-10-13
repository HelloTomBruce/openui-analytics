import { streamText, tool, jsonSchema, type CoreTool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { getOpenUISystemPrompt } from "@/lib/prompt";
import { getCrossSourceLinks } from "@/lib/crossSourceMap";
import {
  readDatasourcesConfig,
  resolveActiveSources,
  getDynamicSourceConfig,
  type ActiveSourceSummary,
} from "@/mcp/registry";
import { getDynamicSourceTools, mergeToolSets } from "@/mcp/dynamicSources";

export async function POST(req: Request) {
  try {
    const {
      messages = [],
      apiKey: clientKey,
      baseURL: clientBaseURL,
      model: clientModel,
      temperature: clientTemperature,
      sources: clientSources,
    } = await req.json();

    const apiKey = clientKey || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
    const baseURL = clientBaseURL || process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || "https://api.openai.com/v1";
    const model = clientModel || process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4o-mini";
    // 温度由客户端设置页透传，钳制在 0–2，默认 0.2（数据分析场景）
    const parsedTemp = Number(clientTemperature);
    const temperature =
      Number.isFinite(parsedTemp) && clientTemperature !== undefined && clientTemperature !== ""
        ? Math.min(Math.max(parsedTemp, 0), 2)
        : 0.2;

    console.log("[Analyze API Request]", { model, baseURL, hasApiKey: !!apiKey });

    // 安全约束：客户端自带 baseURL 时必须同时自带 apiKey。
    // 否则服务端会拿着 env 中的真实 Key 去请求客户端指定的任意 URL —— 凭证外泄通道。
    if (clientBaseURL && !clientKey) {
      return Response.json(
        { error: "自定义 baseURL 时必须同时提供 apiKey（不允许与服务端环境凭证混用）" },
        { status: 400 }
      );
    }

    // 当未配置 Key 时，返回合规的 Data Stream 协议响应
    if (!apiKey) {
      const msg = `⚠️ 请先在右上角「设置」中配置您的 API Key。\n\n\`\`\`openui\nInsightBox(type="warning", title="未检测到 LLM API Key", content="请点击右上角「设置」进入「模型配置」输入 API Key，开启由 Vercel AI SDK 与多数据源 MCP（内置 + 动态配置）驱动的流式数据分析看板。")\n\`\`\``;
      const dataStreamChunk = `0:${JSON.stringify(msg)}\nd:{"finishReason":"stop","usage":{"promptTokens":0,"completionTokens":0}}\n`;

      return new Response(dataStreamChunk, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "x-vercel-ai-data-stream": "v1",
        },
      });
    }

    const openai = createOpenAI({
      apiKey,
      baseURL: baseURL.replace(/\/+$/, ""),
    });

    // 会话级数据源：请求 id ∩ 全局启用 ∩ 实际存在；未知 id 忽略并告警
    const cfg = readDatasourcesConfig();
    const activeSources = resolveActiveSources(
      Array.isArray(clientSources) ? (clientSources as string[]) : undefined,
      cfg
    );

    // 按激活源装配工具：内置三源 + 动态源（http-mcp / db）；
    // 单一数据源失败时降级为空工具集而非拖垮整个请求
    const toolEntries: { id: string; tools: Promise<Record<string, CoreTool>> }[] =
      [];
    for (const s of activeSources) {
      const conf = getDynamicSourceConfig(s.id);
      if (!conf) continue;
      toolEntries.push({ id: s.id, tools: getDynamicSourceTools(conf) });
    }

    const settledResults = await Promise.allSettled(
      toolEntries.map((e) => e.tools)
    );
    const loadedTools: Record<string, CoreTool> = {};
    settledResults.forEach((r, i) => {
      if (r.status === "rejected") {
        console.warn(
          `[Analyze API] ${toolEntries[i].id} 工具加载失败，降级为空工具集:`,
          r.reason
        );
        return;
      }
      mergeToolSets(loadedTools, r.value, toolEntries[i].id);
    });

    // prompt 数据源清单：动态源写入实际装载到的工具名
    const summaries: ActiveSourceSummary[] = activeSources.map((s) => {
      const idx = toolEntries.findIndex((e) => e.id === s.id);
      const settled = idx >= 0 ? settledResults[idx] : undefined;
      return settled?.status === "fulfilled"
        ? { ...s, tools: Object.keys(settled.value) }
        : s;
    });

    const result = streamText({
      model: openai(model),
      system: getOpenUISystemPrompt(summaries),
      messages,
      temperature,
      tools: {
        ...loadedTools,
        cross_source_link: tool({
          description: "查询禅道项目与 GitLab 仓库的关联映射，用于跨源联合分析（迭代进度 × 代码活跃度）。映射缺失时返回 confidence=none，此时应提示用户补充映射，不得编造关联结果。",
          parameters: jsonSchema<{ zentao_project_id: string }>({
            type: "object",
            properties: {
              zentao_project_id: {
                type: "string",
                description: "禅道项目 ID，例如: \"42\"",
              },
            },
            required: ["zentao_project_id"],
          }),
          execute: async ({ zentao_project_id }) => {
            console.log("[Vercel AI SDK -> CrossSource] cross_source_link:", zentao_project_id);
            return getCrossSourceLinks(zentao_project_id);
          },
        }),
      },
      maxSteps: 10,
      onStepFinish({ stepType, toolCalls, text, finishReason }) {
        console.log(`[Vercel AI SDK Step Finish] type=${stepType}, finishReason=${finishReason}, toolCalls=${toolCalls?.length || 0}, textLength=${text?.length || 0}`);
      },
    });

    return result.toDataStreamResponse({
      getErrorMessage: (err: unknown) => {
        console.error("[AI SDK Stream Error]:", err);
        return err instanceof Error ? err.message : String(err);
      },
    });
  } catch (err: unknown) {
    console.error("Vercel AI SDK Route error:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      `3:${JSON.stringify(errorMessage)}\n`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "x-vercel-ai-data-stream": "v1",
        },
      }
    );
  }
}
