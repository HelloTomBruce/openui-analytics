import { createAnalyzeHandler } from "@openui-analytics/llm";
import { datasources } from "@/lib/datasources";
import { createAppMethodology } from "@/lib/methodologyLoader";

/**
 * 薄壳：LLM 编排在 @openui-analytics/llm，数据源单例与方法论库由应用注入。
 * 方法论库 = 内置 10 卡 + data/methodology/*.json 用户卡（启动加载一次，坏卡跳过不阻塞）。
 */
export const POST = createAnalyzeHandler({
  datasources,
  methodology: createAppMethodology().library,
});
