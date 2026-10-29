import { streamText, tool, jsonSchema, type CoreMessage, type CoreTool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  mergeToolSets,
  type ActiveSourceSummary,
  type DatasourceManager,
} from "@openui-analytics/datasources";
import { toAiTools } from "@openui-analytics/datasources/adapters/ai";
import { getOpenUISystemPrompt, getOpenUIPlanPrompt, getExecuteSystemPrompt } from "./prompt";
import { getCrossSourceLinks } from "./crossSourceMap";

export interface AnalyzeHandlerOptions {
  /** 应用持有的数据源单例（src/lib/datasources.ts），包不自建 */
  datasources: DatasourceManager;
}

export interface AnalyzeRequestBody {
  messages?: unknown[];
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number | string;
  sources?: string[];
  /** 接口协议：anthropic（如 Kimi Coding 的 /v1/messages）或缺省 openai 兼容（/chat/completions） */
  protocol?: "openai" | "anthropic";
  /**
   * 分析阶段（Plan-first 两阶段编排）：
   * - direct（缺省）：直接分析产出看板
   * - plan：规划确认阶段——仅探查表结构 + LIMIT 小样本，输出 PlanReviewCard 思路确认卡
   * - execute：执行阶段——按历史中已确认的规划产出完整看板
   */
  mode?: "direct" | "plan" | "execute";
  /** 历史透传字段（如 gitlabUrl/gitlabToken）被忽略的现状保持 */
  [key: string]: unknown;
}

/**
 * LLM 编排门面：注入数据源单例，返回可直接作为 Next POST 路由的处理函数。
 * 逻辑与原 app/api/analyze/route.ts 逐行等价（仅依赖来源改为注入）。
 */
export function createAnalyzeHandler(opts: AnalyzeHandlerOptions) {
  const { datasources } = opts;

  return async function POST(req: Request) {
    try {
      const {
        messages = [],
        apiKey: clientKey,
        baseURL: clientBaseURL,
        model: clientModel,
        temperature: clientTemperature,
        sources: clientSources,
        protocol: clientProtocol,
        mode: clientMode,
      } = (await req.json()) as AnalyzeRequestBody;

      const apiKey = clientKey || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
      const baseURL = clientBaseURL || process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || "https://api.openai.com/v1";
      const model = clientModel || process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4o-mini";
      // 温度由客户端设置页透传，钳制在 0–2，默认 0.2（数据分析场景）
      const parsedTemp = Number(clientTemperature);
      const temperature =
        Number.isFinite(parsedTemp) && clientTemperature !== undefined && clientTemperature !== ""
          ? Math.min(Math.max(parsedTemp, 0), 2)
          : 0.2;

      // 分析阶段归一化：非法值回落 direct，保持向后兼容
      const mode =
        clientMode === "plan" || clientMode === "execute" ? clientMode : "direct";

      console.log("[Analyze API Request]", { model, baseURL, protocol: clientProtocol ?? "openai", mode, hasApiKey: !!apiKey });

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

      // 协议分派：anthropic 端点（如 Kimi Coding，实际路径 /v1/messages，baseURL 自动补 /v1）
      // 或缺省 openai 兼容端点（/chat/completions，baseURL 去尾斜杠）
      const normalizedBase = baseURL.replace(/\/+$/, "");
      const anthropicBase = /\/v1$/.test(normalizedBase)
        ? normalizedBase
        : `${normalizedBase}/v1`;
      const languageModel =
        clientProtocol === "anthropic"
          ? createAnthropic({ apiKey, baseURL: anthropicBase })(model)
          : createOpenAI({ apiKey, baseURL: normalizedBase })(model);

      // 会话级数据源：请求 id ∩ 全局启用 ∩ 实际存在；未知 id 忽略并告警
      const activeSources = datasources.resolveActive(
        Array.isArray(clientSources) ? (clientSources as string[]) : undefined
      );

      // 按激活源装配工具（http-mcp / db / stdio-cli）；
      // 单一数据源失败时降级为空工具集而非拖垮整个请求
      const toolEntries: { id: string; tools: Promise<Record<string, CoreTool>> }[] =
        [];
      for (const s of activeSources) {
        const conf = datasources.get(s.id);
        if (!conf) continue;
        toolEntries.push({ id: s.id, tools: datasources.tools(conf).then(toAiTools) });
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

      // 按阶段分派系统提示词：plan → 规划变体（探查边界 + PlanReviewCard 契约）；
      // execute → base + 按已确认思路执行的增量约束；direct → base 直出看板
      const system =
        mode === "plan"
          ? getOpenUIPlanPrompt(summaries)
          : mode === "execute"
            ? getExecuteSystemPrompt(summaries)
            : getOpenUISystemPrompt(summaries);

      const result = streamText({
        model: languageModel,
        system,
        // 客户端消息体原样透传（与原实现一致，不做结构校验）
        messages: messages as CoreMessage[],
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
        // 规划阶段只需 schema 探查 + 小样本，步数预算收紧；执行/直出保持 10
        maxSteps: mode === "plan" ? 6 : 10,
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
  };
}
