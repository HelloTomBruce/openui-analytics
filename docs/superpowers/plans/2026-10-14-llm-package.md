# LLM 编排独立包（llm package）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 把 `/api/analyze` 的 LLM 编排与提示词资产抽成 workspace 子包 `@openui-analytics/llm`，对外只暴露 `createAnalyzeHandler({ datasources })`；路由变薄壳、前端零改动、请求/响应协议零变化。

**架构：** 依赖注入门面（`(req: Request) => Promise<Response>`，与 Next 路由签名一致）；prompt/serverLibrary/crossSourceMap 为包内部件；llm → datasources 单向依赖（workspace:\*）。

**技术栈：** pnpm workspace、TypeScript（bundler resolution）、vitest 5 projects、Next 16 Turbopack（自动转译 workspace 包，已验证模式）。

**规格：** `docs/superpowers/specs/2026-10-14-llm-package-design.md`（执行者两份都读）

## 全局约束

- 包名 `@openui-analytics/llm`，位于 `packages/openui-llm/`，主入口 `src/index.ts`，无构建直引源码
- 迁移不改行为：11 个 handler 用例 + prompt 两测试文件断言语义零改动；允许改 import/接缝形态
- 请求体（messages/apiKey/baseURL/model/temperature/sources）与 data stream 响应协议不变；前端零改动
- `config/cross-source-map.json` 维持 cwd 相对读取，不注入
- 依赖划分（已核实）：`ai`、`@ai-sdk/openai`、`@openuidev/lang-core` 仅迁移文件使用 → root 移除；`zod` 双栖；`@ai-sdk/react` 留 root（peer 仅 react+zod，不含 ai）
- pnpm-workspace.yaml 已含 `packages/*`，无需改动
- 每任务 `pnpm typecheck && pnpm lint && pnpm test` 全绿再 commit

## 审查重点（Review Focus）

规格未明说、最可能伤到使用者的失败模式，及钉住它的既有测试（随迁，标注任务）：

1. **凭证外泄通道**：客户端 baseURL 不带 apiKey 时必须 400 拒绝（不得拿服务端 env key 打客户端指定 URL）→ 任务 2「客户端提供 baseURL 但未提供 apiKey 时拒绝」
2. **无 key 体验**：未配置 key 时不得裸 500，必须返回合规 data stream 引导设置 → 任务 2 同名用例 + 任务 3 薄壳冒烟
3. **单源失败放大**：某数据源工具加载失败必须降级空工具集，不得拖垮整个请求 → 任务 2「动态源工具加载失败时降级为空工具集并正常流式响应」
4. **温度越界**：客户端温度钳制 0–2、缺省 0.2 → 任务 2「temperature 越界时钳制」
5. **prompt 教坏模型**：few-shot 示例必须能通过 serverLibrary 的解析与 zod 校验 → 任务 1 promptExamples.test 随迁

---

### 任务 1：包骨架 + 提示词资产迁移

**文件：**
- 创建：`packages/openui-llm/package.json`（deps: `@openuidev/lang-core`、`zod`、`@openui-analytics/datasources: workspace:*`；devDeps: typescript/vitest/@types/node；exports `.` → `src/index.ts`）
- 创建：`packages/openui-llm/tsconfig.json`、`vitest.config.ts`（照抄 `packages/openui-datasources/` 同名文件）
- 创建：`packages/openui-llm/src/prompt.ts|serverLibrary.ts|crossSourceMap.ts`（源：`src/lib/` 同名三文件，原样迁）
- 创建：`packages/openui-llm/src/prompt.test.ts|promptExamples.test.ts`（源：`src/lib/` 同名，仅改 import 路径）
- 创建：`packages/openui-llm/src/index.ts`（本任务仅 re-export prompt 资产占位，任务 2 补 handler 导出）
- 修改：root `package.json` 增 `"@openui-analytics/llm": "workspace:*"`

- [ ] **步骤 1：骨架与链接**（package.json/tsconfig/vitest.config/index.ts 占位；`pnpm install` 确认链接）
- [ ] **步骤 2：三文件 + 两测试原样搬运**（相对 import 不变；`prompt.ts` 的 `@openui-analytics/datasources` 类型导入已可用）
- [ ] **步骤 3：跑包测试**：`cd packages/openui-llm && pnpm vitest run` 预期 prompt 两文件全 PASS；随后 root 三门全绿（应用侧文件未动）
- [ ] **步骤 4：Commit** `refactor(llm): 包骨架与提示词资产迁移`

### 任务 2：`handler.ts` 门面 + 测试随迁

**文件：**
- 创建：`packages/openui-llm/src/handler.ts`（源：`src/app/api/analyze/route.ts` L1-150 主体逐行照搬；包装为 `createAnalyzeHandler(opts: { datasources: DatasourceManager })`，内部 `@/lib/datasources` 与 `@/mcp` 类 import 全部改由 `opts.datasources` / `@openui-analytics/datasources[/adapters/ai]` 取）
- 创建：`packages/openui-llm/src/handler.test.ts`（源：`src/app/api/analyze/route.test.ts` 11 用例；删除 `vi.mock("@/lib/datasources")`，改为工厂内建真 manager（临时配置文件）+ `tools: vi.fn(async () => [])` 覆写注入；`vi.mock("ai")`/`vi.mock("@ai-sdk/openai")` 保留；import `createAnalyzeHandler`）
- 修改：`packages/openui-llm/src/index.ts`（补 `export { createAnalyzeHandler }` 与 `AnalyzeHandlerOptions`/`AnalyzeRequestBody` 类型）；`package.json` deps 增 `ai`、`@ai-sdk/openai`

- [ ] **步骤 1：先迁测试（RED）**：handler.test.ts 就位后 `pnpm vitest run` 预期 FAIL（`createAnalyzeHandler` 不存在）
- [ ] **步骤 2：实现 handler.ts**：配置解析（clientKey→env 兜底、baseURL 去尾斜杠）、baseURL+apiKey 配对校验、无 key 降级流、温度钳制、`datasources.resolveActive/get/tools→toAiTools→mergeToolSets`、`cross_source_link` 常挂、`getErrorMessage` 序列化与 `3:` 兜底——全部逐行照搬
- [ ] **步骤 3：GREEN + root 三门**：包内 11+prompt 用例全 PASS；root 全绿（应用 route 未动）
- [ ] **步骤 4：Commit** `refactor(llm): analyze 编排迁移为 createAnalyzeHandler 门面`

### 任务 3：应用切换 + 依赖收编

**文件：**
- 修改：`src/app/api/analyze/route.ts` → 薄壳（`export const POST = createAnalyzeHandler({ datasources })`，~5 行）
- 创建：`src/app/api/analyze/route.test.ts`（薄壳冒烟：无 key POST → 200 + `x-vercel-ai-data-stream: v1` + 文案含「设置」）
- 删除：`src/lib/prompt.ts|serverLibrary.ts|crossSourceMap.ts|prompt.test.ts|promptExamples.test.ts`
- 修改：root `package.json` 移除 `ai`、`@ai-sdk/openai`、`@openuidev/lang-core`

- [ ] **步骤 1：薄壳 + 冒烟测试（先写测试看 RED：旧 route 仍在时新断言通过与否对照）→ 切换 → GREEN**
- [ ] **步骤 2：`git rm` 五个迁移源；`grep -rn 'from "ai"\|@ai-sdk/openai\|@openuidev/lang-core\|lib/prompt\|serverLibrary\|crossSourceMap' src/` 确认零残留**
- [ ] **步骤 3：root 依赖移除 + `pnpm install` + 全量门 + `pnpm build`**（Turbopack 自动转译两个 workspace 包）
- [ ] **步骤 4：Commit** `refactor(llm): 应用切换至 llm 包，删除迁移源`

### 任务 4：冒烟、文档与图谱

- [ ] **步骤 1：README「架构」段落补一句 workspace 包结构（datasources + llm 两包职责）；commit**
- [ ] **步骤 2：dev 冒烟**：①无 key POST /api/analyze 返回合规降级流 ②`GET /api/datasources` 正常（跨包集成未破坏）③有 key 场景用户配合验证出看板；异常回对应任务修
- [ ] **步骤 3：`graphify update .`；核对 4 个 commit；汇报**
