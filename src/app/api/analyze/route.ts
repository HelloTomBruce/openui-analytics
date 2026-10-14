import { createAnalyzeHandler } from "@openui-analytics/llm";
import { datasources } from "@/lib/datasources";

/** 薄壳：LLM 编排在 @openui-analytics/llm，数据源单例由应用注入 */
export const POST = createAnalyzeHandler({ datasources });
