# 数据源独立包（datasource package）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 把 `src/mcp/` 三层职责（配置/连接/请求）抽成 workspace 子包 `@openui-analytics/datasources`，对外只暴露 `createDatasourceManager` 门面 + 可选 `ai` 适配器，应用侧 6 个消费方切换后删除 `src/mcp/`。

**架构：** pnpm workspace 单包直引源码（无构建）；核心零 LLM 概念（MCP 原语：connect/tools/health），Vercel AI SDK 适配在 `adapters/ai.ts`（optional peer）。原模块级全局缓存改为 manager 实例私有状态。

**技术栈：** pnpm workspace、TypeScript（bundler resolution）、vitest 5（`test.projects`）、Next 16 Turbopack（自动转译 workspace 包，已核实文档，无需 `transpilePackages`；若 build 报未转译再补）。

**规格：** `docs/superpowers/specs/2026-10-14-datasource-package-design.md`（执行者两份都读）

## 全局约束

- 包名 `@openui-analytics/datasources`，位于 `packages/openui-datasources/`，主入口指向 `src/index.ts`（无 dist 构建）
- 迁移不改行为：既有测试断言原样通过是「无回归」的唯一证据；允许改 import 路径与调用点形态，不允许改断言语义
- 配置文件仍为应用侧 `config/datasources.json`（v3 格式不变），路径由应用注入，包不内置业务目录
- `configPath` 为 `createDatasourceManager` 必填项
- 包依赖：`@modelcontextprotocol/sdk`、`pg`、`mysql2`；`ai` 为 optional peerDependency；`zod` 不迁移（仅应用侧使用）
- GET/描述符永不回传明文凭证（maskUrl/maskConnectionString 行为不变；stdio 的 command/args 可回传）
- 删除 `src/mcp/` 时不留转发 shim
- 每个任务结束时 `pnpm typecheck && pnpm lint && pnpm test` 全绿再 commit（任务 1–3 期间 root 测试因 `src/mcp` 仍在而保持绿；vitest projects 切换放在任务 4）

## 审查重点（Review Focus）

规格未明说、但最可能伤到使用者的失败模式，及钉住它的测试（全部为既有用例随迁，标注所属任务）：

1. **配置文件缺失/损坏/v3 合法** 三态都必须返回可用配置而非崩溃 → 任务 1 `config.test.ts`「文件缺失/损坏/v3 合法文件均返回可用配置」
2. **v2→v3 迁移种子边界**：postgres 演示库必须丢弃；env 无 `GITLAB_MCP_URL` 不种子；gitlab 停用不种子 → 任务 1 `config.test.ts` 三个迁移用例
3. **同 id 配置变更**（token/url/连接串变了）必须关旧连接重建，不得复用陈旧连接 → 任务 3 `manager.test.ts`（自 `dynamicSources.test.ts` 缓存键控用例随迁）
4. **明文凭证泄露通道**：describe/list 输出只有脱敏形态（maskedUrl/maskedConnectionString/hasToken）→ 任务 1 `config.test.ts` mask 用例 + 任务 3 `manager.test.ts` 描述符用例（stdio 暴露 command、无 builtin 字段）
5. **工具名冲突**：不同源同名工具必须跳过并告警，不得静默覆盖 → 任务 3 `manager.test.ts`（自 `dynamicSources.test.ts` mergeToolSets 用例随迁）

---

### 任务 1：包骨架 + 配置层 `config.ts`

**文件：**
- 修改：`pnpm-workspace.yaml`（增加 `packages: ["packages/*"]` 段，保留 allowBuilds）
- 创建：`packages/openui-datasources/package.json`
- 创建：`packages/openui-datasources/tsconfig.json`（strict、`moduleResolution: "bundler"`、include `src/**/*`）
- 创建：`packages/openui-datasources/vitest.config.ts`（node 环境、include `src/**/*.test.ts`）
- 创建：`packages/openui-datasources/src/config.ts`（源：`src/mcp/registry.ts` L13–353 的配置半区）
- 创建：`packages/openui-datasources/src/config.test.ts`（源：`src/mcp/registry.test.ts` describe「配置模型 v3（无 builtin）」L53–207 整块）

- [ ] **步骤 1：建分支与骨架**

`git checkout -b refactor/datasource-package`。`package.json` 关键字段：`name`/`version: 0.1.0`/`private: true`/`type: module`；`exports: { ".": "./src/index.ts" }`（index.ts 本任务先建空转发文件，任务 3 补全）；deps 为 `@modelcontextprotocol/sdk`、`pg`、`mysql2`（版本照抄 root package.json）；`peerDependencies: { "ai": "*" }` + `peerDependenciesMeta.ai.optional: true`。root `package.json` 增加 `"@openui-analytics/datasources": "workspace:*"`。跑 `pnpm install` 确认链接成功。

- [ ] **步骤 2：迁移配置层为纯函数**

把 registry.ts 配置半区迁为**无模块级可变状态**的纯函数（类型 `HttpMcpSourceConfig/DbSourceConfig/StdioCliSourceConfig/DynamicSourceConfig/DatasourcesConfig` 与 `ValidateResult` 一并在此导出；`ZENTAO_SEED`/`normalizeSourceEntry`/`migrateConfig` 保持私有）：

```ts
export function loadConfigFile(path: string): DatasourcesConfig;                    // 原 readDatasourcesConfig 的载入逻辑，v2→v3 迁移在此
export function writeConfigFile(path: string, config: DatasourcesConfig): void;     // tmp+rename 原子写
export function validateSourceConfig(s: DynamicSourceConfig): ValidateResult;       // 原 validateDynamicSourceConfig
export function upsertSource(config: DatasourcesConfig, s: DynamicSourceConfig): DatasourcesConfig;   // 纯：读改分离，不再自带 IO
export function deleteSource(config: DatasourcesConfig, id: string): DatasourcesConfig;
export function maskUrl(url: string): string;
export function maskConnectionString(conn: string): string;
```

校验规则、种子逻辑、原子写实现逐行照搬原文件，只做「去全局状态」的签名改造。`reloadDataSources`/`declarativePath`/`configCache` 全局不再存在。

- [ ] **步骤 3：迁移配置测试并适配调用点**

`config.test.ts` 迁入 L53–207 用例：文件 IO 用例改为 `loadConfigFile(tmpPath)`/`writeConfigFile(tmpPath, ...)` 直调；upsert/delete 用例改为 `upsertSource(read 的 config, s)` 两步组合。**断言语义零改动**（含三个 v2 迁移种子用例、原子写无 tmp 残留、mask 行为）。

- [ ] **步骤 4：跑包测试与全量门**

运行：`pnpm vitest run --root packages/openui-datasources`（或 `cd packages/openui-datasources && pnpm vitest run`）
预期：config.test.ts 全部 PASS。随后 root `pnpm typecheck && pnpm lint && pnpm test` 全绿（src/mcp 原文件与测试仍在）。

- [ ] **步骤 5：Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml packages/
git commit -m "refactor(datasources): 包骨架与配置层迁移为纯函数"
```

### 任务 2：连接器原样迁移 `connectors/`

**文件：**
- 创建：`packages/openui-datasources/src/connectors/http.ts`（源：`src/mcp/httpMcp.ts` + `httpMcp.test.ts`）
- 创建：`packages/openui-datasources/src/connectors/stdio.ts`（源：`src/mcp/stdioMcp.ts`）
- 创建：`packages/openui-datasources/src/connectors/db/dialect.ts|postgresDialect.ts|mysqlDialect.ts|dbMcpServer.ts`（源：`src/mcp/db/` 四文件 + 三个 test）
- 创建：`packages/openui-datasources/src/parseToolResult.ts`（源：原文件）

- [ ] **步骤 1：搬运与改 import**

七个源文件 + 四个测试文件复制到新位置，仅改相对 import 路径（如 `./db/dialect` → `./dialect`），导出名全部保持不变（`connectHttpMcp`/`connectStdioMcp`/`probeStdioCli`/`DbDialect`/`DIALECTS`/`createDbMcpServer`/`assertReadOnlySql`/`enforceRowLimit`/`guardReadOnlySql`/`parseMcpToolResult`）。

- [ ] **步骤 2：跑连接器测试**

运行：`cd packages/openui-datasources && pnpm vitest run`
预期：connectors/db 与 http 测试全 PASS（若 http 远程用例依赖 `TEST_DYNAMIC_HTTP` env 门控则照原样 skip）。

- [ ] **步骤 3：Commit**

```bash
git add packages/
git commit -m "refactor(datasources): http/stdio/db 连接器原样迁移"
```

### 任务 3：门面 `manager.ts` + 适配器 `adapters/ai.ts` + 完整入口

**文件：**
- 创建：`packages/openui-datasources/src/manager.ts`（源：registry.ts L353–488 描述/探活/resolveActive 半区 + dynamicSources.ts 全部缓存/分派逻辑）
- 创建：`packages/openui-datasources/src/adapters/ai.ts`（源：dynamicSources.ts `mountClientTools` 的 ai 包装半区）
- 修改：`packages/openui-datasources/src/index.ts`（补全导出）
- 创建：`packages/openui-datasources/src/manager.test.ts`（源：`registry.test.ts` L209 起三个 describe + `dynamicSources.test.ts` 全部用例）
- 修改：`packages/openui-datasources/package.json`（exports 增加 `"./adapters/ai": "./src/adapters/ai.ts"`）

- [ ] **步骤 1：定义连接与工具绑定类型（manager.ts 导出）**

```ts
export interface McpConnection {
  listTools(): Promise<{ name: string; description?: string; inputSchema?: unknown }[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}
export interface McpToolBinding {
  name: string;               // 注册名，已带 `<id>_` 前缀
  originalName: string;       // MCP 侧原始名
  description?: string;
  inputSchema?: unknown;
  call(args: Record<string, unknown>): Promise<unknown>;   // 内部已做 parseMcpToolResult
}
```

- [ ] **步骤 2：实现门面**

```ts
export function createDatasourceManager(opts: { configPath: string }): DatasourceManager;

export interface DatasourceManager {
  readConfig(): DatasourcesConfig;                            // 委托 loadConfigFile（实例缓存首次结果）
  writeConfig(c: DatasourcesConfig): void;                    // 委托 writeConfigFile 并同步实例缓存
  validate(s: DynamicSourceConfig): ValidateResult;
  upsert(s: DynamicSourceConfig): DatasourcesConfig;          // read→upsertSource→writeConfig
  delete(id: string): DatasourcesConfig;
  get(id: string): DynamicSourceConfig | undefined;
  list(): DataSourceDescriptor[];                             // 迁移 describeDynamicSource/listDataSources，脱敏
  connect(s: DynamicSourceConfig): Promise<McpConnection>;    // kind 分派：http→connectHttpMcp 包装；stdio→connectStdioMcp 包装；db→createDbMcpServer+InMemoryTransport
  tools(s: DynamicSourceConfig): Promise<McpToolBinding[]>;   // connect（键控缓存）+ listTools + 前缀绑定；配置变更关旧连接重建
  close(id: string): Promise<void>;                           // 未知 id 静默
  health(s: DynamicSourceConfig): Promise<HealthResult>;      // 迁移 checkDataSourceHealth 原逻辑（stdio→probeStdioCli 真实握手、3s 超时）
  resolveActive(ids: string[]): ActiveSourceSummary[];        // 迁移 resolveActiveSources（未知/未启用告警跳过）
}
export function mergeToolSets(target: Record<string, unknown>, incoming: Record<string, unknown>, sourceId: string): void;  // 原逻辑：同名跳过+console.warn
```

`DataSourceDescriptor`/`HealthResult`/`ActiveSourceSummary` 类型从 registry.ts 原样迁入本文件导出。缓存：实例私有 `Map<id, { key, connection }>`，`configKey` 逻辑照搬。

- [ ] **步骤 3：实现 ai 适配器**

```ts
import { tool, jsonSchema, type CoreTool } from "ai";
export function toAiTools(bindings: McpToolBinding[]): Record<string, CoreTool>;
```

用 `tool({ description, inputSchema: jsonSchema(binding.inputSchema), execute: (args) => binding.call(args) })` 包装——即原 `mountClientTools` 的 ai 半区；MCP 结果解析（parseMcpToolResult）留在 manager 侧 binding.call 里。

- [ ] **步骤 4：补全 index.ts 并迁移门面测试**

index.ts 导出：config.ts 全部导出 + manager.ts 全部导出（`DatasourceManager`/`createDatasourceManager`/`mergeToolSets`/`McpConnection`/`McpToolBinding`/`DataSourceDescriptor`/`HealthResult`/`ActiveSourceSummary`）。不导出 adapters/ai。

manager.test.ts：registry.test.ts 的「listDataSources 描述符」「resolveActiveSources」「checkDataSourceHealth」三个 describe + dynamicSources.test.ts 全部用例迁入；调用点改为 `const m = createDatasourceManager({ configPath: tmp })` 后走方法（探活用例保持 vi.mock `probeStdioCli` 原样）；断言语义零改动（含审查重点 3/4/5 的钉子）。

- [ ] **步骤 5：跑包测试与全量门**

运行：`cd packages/openui-datasources && pnpm vitest run`
预期：全部 PASS。root `pnpm typecheck && pnpm lint && pnpm test` 全绿。

- [ ] **步骤 6：Commit**

```bash
git add packages/
git commit -m "refactor(datasources): manager 门面 + ai 适配器 + 统一入口"
```

### 任务 4：应用侧切换 + 删除 `src/mcp/` + root 配置

**文件：**
- 创建：`src/lib/datasources.ts`
- 修改：`src/app/api/datasources/route.ts`、`src/app/api/datasources/[id]/route.ts`、`src/app/api/analyze/route.ts`、`src/lib/prompt.ts`、`src/components/chat/datasources/DatasourceSettings.tsx`、`src/components/chat/datasources/useDatasources.ts`
- 修改：`package.json`（移除 `@modelcontextprotocol/sdk`/`pg`/`mysql2`）、`vitest.config.ts`（`test.projects`）
- 删除：`src/mcp/`（全部 10 源文件 + 5 测试）

- [ ] **步骤 1：应用单例**

```ts
// src/lib/datasources.ts —— 三行，路径逻辑照搬原 DEFAULT_DATASOURCES_PATH
import path from "node:path";
import { createDatasourceManager } from "@openui-analytics/datasources";
export const datasources = createDatasourceManager({ configPath: path.join(process.cwd(), "config", "datasources.json") });
```

- [ ] **步骤 2：切换 6 个消费方**

两个 datasources 路由与 analyze 路由改用 `datasources.xxx()`；analyze 的工具装配改为 `datasources.tools(s)` → `toAiTools()`（import 自 `@openui-analytics/datasources/adapters/ai`）+ `mergeToolSets()`（自主入口）。`prompt.ts` 与前端两文件只改类型 import 路径（`import type { ActiveSourceSummary } from "@openui-analytics/datasources"` 等）。路由对外行为、响应 JSON 形态零变化。

- [ ] **步骤 3：删除 src/mcp 与依赖收编**

`git rm -r src/mcp`。`grep -rn "from \"@/mcp\|from \"@modelcontextprotocol\|from \"pg\"\|from \"mysql2\"" src/` 确认仅剩包内引用后，root package.json 移除三个依赖，`pnpm install`。

- [ ] **步骤 4：vitest projects 切换**

root `vitest.config.ts` 增加 `test.projects: [".", "packages/*"]`（保留现有 alias/environment/setupFiles 于根 project）。运行 `pnpm test` 预期：根应用测试 + 包测试全部 PASS，`src/mcp` 用例消失。

- [ ] **步骤 5：全量质量门**

运行：`pnpm typecheck && pnpm lint && pnpm test && pnpm build`
预期：全绿；若 build 报包未转译（Turbopack 应自动处理），在 next.config.ts 加 `transpilePackages: ["@openui-analytics/datasources"]` 再跑。

- [ ] **步骤 6：Commit**

```bash
git add -A
git commit -m "refactor(datasources): 应用切换至独立包，删除 src/mcp"
```

### 任务 5：文档、冒烟与图谱

**文件：**
- 修改：`docs/adding-a-datasource.md`（`src/mcp/db/xxxDialect.ts` → `packages/openui-datasources/src/connectors/db/xxxDialect.ts`）
- 修改：`README.md` 架构图（如提及 mcp 路径则同步，措辞从简）

- [ ] **步骤 1：更新文档并 commit**

- [ ] **步骤 2：冒烟（需人工配合）**

`pnpm dev` → ①`GET/POST/PATCH/DELETE /api/datasources` 全链路（curl 即可）②前端设置页增删启停一个 stdio 源 ③无 LLM key 时 `POST /api/analyze` 返回合规提示流（有 key 则验证出看板）。异常则回到对应任务修复。

- [ ] **步骤 3：收尾**

`graphify update .` 刷新图谱；最终 `git log --oneline` 核对 5 个 commit；向用户汇报。
