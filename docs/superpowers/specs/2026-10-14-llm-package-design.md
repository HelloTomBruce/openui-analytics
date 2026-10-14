# LLM 编排独立包（llm package）设计规格

日期：2026-10-14 ｜ 状态：已批准（对话中逐节确认）
前置：数据源独立包（2026-10-14-datasource-package-design.md）已实现并合入 main

## 目标

把 `/api/analyze` 的 LLM 编排（模型配置解析、安全约束、工具装配、streamText、错误序列化）与提示词资产（prompt / serverLibrary / 跨源映射）收敛为 workspace 子包 `@openui-analytics/llm`，对外只暴露 `createAnalyzeHandler` 门面；路由文件变薄壳，前端零改动。

## 已批准的决策

1. **边界：方案 A——仅服务端编排**。前端 hook（useLlmSettings / useChat / extractOpenUI / messages）留在应用（React 绑定、组合根）
2. **依赖注入**：handler 通过 `createAnalyzeHandler({ datasources })` 接收应用持有的 manager 单例，包不自建、不读应用配置；测试直接注入 fake——现有 `vi.mock("@/lib/datasources")` 接缝随之消失
3. **框架无关签名**：`(req: Request) => Promise<Response>`，与 Next 路由签名天然一致，薄壳零适配

## 设计

### 1. 包结构与依赖

```
packages/openui-llm/
├─ package.json   # deps: ai, @ai-sdk/openai, @openuidev/lang-core, zod,
│                 #      @openui-analytics/datasources(workspace:*)
│                 # devDeps: typescript, vitest, @types/node（同 datasources 包模式）
├─ tsconfig.json / vitest.config.ts   # 直引源码、node 环境、无构建
└─ src/
   ├─ index.ts           # 唯一门面：createAnalyzeHandler + AnalyzeHandlerOptions + AnalyzeRequestBody
   ├─ handler.ts         # 原 app/api/analyze/route.ts 主体（150 行，逻辑逐行照搬）
   ├─ prompt.ts          # 原 src/lib/prompt.ts（getOpenUISystemPrompt / promptExample）
   ├─ serverLibrary.ts   # 原 src/lib/serverLibrary.ts（OpenUI 组件规范）
   ├─ crossSourceMap.ts  # 原 src/lib/crossSourceMap.ts（读 config/cross-source-map.json，cwd 相对，维持现状）
   ├─ handler.test.ts    # 原 analyze/route.test.ts（11 用例，mock 接缝改依赖注入）
   ├─ prompt.test.ts     # 原 lib/prompt.test.ts
   └─ promptExamples.test.ts  # 原同名（prompt↔schema 一致性守护）
```

- **依赖划分**（已核实使用方）：`ai`、`@ai-sdk/openai`、`@openuidev/lang-core` 仅被迁移文件使用 → 从 root 移除、随包走；`zod` 双栖（包内 serverLibrary 用、应用 analytics/index.tsx 仍用）；`@ai-sdk/react` 留 root（前端 9 文件使用）
- exports：`{ ".": "./src/index.ts" }`；prompt/serverLibrary/crossSourceMap 为内部件不单独导出

### 2. 公共 API

```ts
export interface AnalyzeHandlerOptions {
  datasources: DatasourceManager;   // 来自 @openui-analytics/datasources
}

/** 工厂：注入数据源单例，返回可直接作为 Next POST 路由的处理函数 */
export function createAnalyzeHandler(
  opts: AnalyzeHandlerOptions
): (req: Request) => Promise<Response>;

export interface AnalyzeRequestBody {   // 现请求体的类型化（messages/apiKey/baseURL/model/temperature/sources）
  messages?: unknown[];
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number | string;
  sources?: string[];
  [key: string]: unknown;   // 透传未知字段（gitlabUrl 等历史字段被忽略的现状保持）
}
```

- handler 内部逻辑与现 route 完全一致：env/客户端配置解析（clientKey → OPENAI_API_KEY/LLM_API_KEY；baseURL 去尾斜杠）、**baseURL 必须配对 apiKey 的安全约束**、无 key 合规降级流、温度钳制 0–2（默认 0.2）、`datasources.resolveActive/get/tools → toAiTools → mergeToolSets`、`cross_source_link` 常挂、`getErrorMessage` 错误序列化、`3:` 前缀兜底
- 请求体与响应流协议零变化（前端零感知）

### 3. 应用侧迁移

| 消费方 | 改动 |
| --- | --- |
| `app/api/analyze/route.ts` | 150 行 → 薄壳：`export const POST = createAnalyzeHandler({ datasources })`（~5 行）+ 一个薄壳冒烟测试（无 key 请求返回合规降级流） |
| `src/lib/prompt.ts` / `serverLibrary.ts` / `crossSourceMap.ts` / 三个对应测试 | 整体删除（入包） |
| `src/lib/datasources.ts` | 不变 |
| 前端全部 | 零改动 |
| root `package.json` | 移除 `ai`、`@ai-sdk/openai`、`@openuidev/lang-core`；新增 `@openui-analytics/llm: workspace:*` |

### 4. 测试与质量门

- `handler.test.ts`：11 个既有用例断言语义零改动；差异点仅两处——① 不再 `vi.mock("@/lib/datasources")`，改为构造注入 fake manager（`tools` 为 vi.fn，其余真实现/临时配置文件）；② import 从 `./route` 改 `createAnalyzeHandler(...)`
- `prompt.test.ts` / `promptExamples.test.ts`：仅改 import 路径
- 质量门：每任务 `pnpm typecheck && pnpm lint && pnpm test` 全绿；收尾 `pnpm build` + 手动冒烟（无 key 降级 / baseURL 无 key 拒绝 / 有 key 出看板）+ `graphify update .`

### 5. 明确不做

- 不动前端 hook 与 @ai-sdk/react 的应用内使用
- 不动请求体/响应流协议
- 不动数据源包与 `config/datasources.json`；`config/cross-source-map.json` 仍 cwd 相对读取
- 不发 npm、无构建产物、无版本策略

## 迁移映射

| 现文件 | 去向 |
| --- | --- |
| `src/app/api/analyze/route.ts`（主体） | `packages/openui-llm/src/handler.ts` |
| `src/app/api/analyze/route.test.ts` | `packages/openui-llm/src/handler.test.ts` |
| `src/lib/prompt.ts` + `prompt.test.ts` | `packages/openui-llm/src/prompt.ts` + 同名测试 |
| `src/lib/serverLibrary.ts` | `packages/openui-llm/src/serverLibrary.ts` |
| `src/lib/crossSourceMap.ts` | `packages/openui-llm/src/crossSourceMap.ts` |
| `src/lib/promptExamples.test.ts` | `packages/openui-llm/src/promptExamples.test.ts` |
