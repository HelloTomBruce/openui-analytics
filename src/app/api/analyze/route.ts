import { createAnalyzeHandler } from "@openui-analytics/llm";
import { datasources } from "@/lib/datasources";
import { createAppMethodology } from "@/lib/methodologyLoader";
import { sessionStore } from "@/lib/sessionStore";

/**
 * 薄壳：LLM 编排在 @openui-analytics/llm，数据源单例与方法论库由应用注入。
 * 方法论库 = 内置 10 卡 + data/methodology/*.json 用户卡（启动加载一次，坏卡跳过不阻塞）。
 * sessions：上下文治理的会话元数据存取（token 锚点与摘要缓存，增量合并语义）。
 */
export const POST = createAnalyzeHandler({
  datasources,
  methodology: createAppMethodology().library,
  sessions: {
    async getContext(sessionId) {
      const record = await sessionStore.get(sessionId);
      return record?.context;
    },
    async updateContext(sessionId, patch) {
      await sessionStore.update(sessionId, { context: patch });
    },
  },
});
