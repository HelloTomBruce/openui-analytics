# 数据源独立包（datasources package）设计规格

日期：2026-10-14 ｜ 状态：已批准（对话中逐节确认）
前置：数据源统一化（2026-10-13-datasource-unification-design.md）已实现

## 目标

把 `src/mcp/` 的三层职责——配置模型与读写（registry）、连接管理（dynamicSources + 三种连接器）、工具装配与请求（mountClientTools / parseToolResult）——收敛为独立 workspace 包 `@openui-analytics/datasources`，对外只暴露一个门面 API；应用侧不感知 kind 分派、连接缓存、方言细节。

## 已批准的决策

1. **形态：本仓库 pnpm workspace 子包**（`packages/openui-datasources`，`workspace:*` 依赖），不发 npm
2. **SDK 解耦：方案 3** —— 核心零 LLM 概念（配置/连接/请求均为 MCP 原语）；Vercel AI SDK 适配器作为包内可选模块 `adapters/ai.ts`（optional peerDependency `ai`）
3. **无构建直引源码**：`exports` 指向 `src/index.ts`，不做 ESM/CJS 双构建

## 设计

### 1. 包结构与入口

```
packages/openui-datasources/
├─ package.json          # name: @openui-analytics/datasources；deps: @modelcontextprotocol/sdk, pg, mysql2
├─ tsconfig.json         # 独立、strict；moduleResolution bundler
├─ vitest.config.ts      # 包内测试（node 环境）
└─ src/
   ├─ index.ts           # 主入口：createDatasourceManager + 全部类型（client-safe；前端仅 import type）
   ├─ config.ts          # 配置模型 v3 + normalize/validate + v2→v3 读时迁移 + 原子读写 + 脱敏（原 registry 配置半区）
   ├─ manager.ts         # 门面实现：实例级连接缓存/重建 + kind 分派 + 健康探测 + resolveActive（原 dynamicSources + registry 探活半区）
   ├─ connectors/
   │  ├─ http.ts         # 原 httpMcp.ts（StreamableHTTP + SSE 回退）
   │  ├─ stdio.ts        # 原 stdioMcp.ts（子进程握手 + probeStdioCli）
   │  └─ db/             # dialect.ts + postgresDialect.ts + mysqlDialect.ts + dbMcpServer.ts（原样迁）
   ├─ parseToolResult.ts # 原样迁
   └─ adapters/ai.ts     # toAiTools(bindings) → Record<string, CoreTool>（原 mountClientTools 的 ai 侧）
```

- `pnpm-workspace.yaml` 增加 `packages: ["packages/*"]`
- Next 16 Turbopack 自动转译 pnpm workspace 包（已核实官方文档），无需 `transpilePackages`；若 build 报未编译则补加——列入实现计划验证步骤
- **依赖划分**：`@modelcontextprotocol/sdk`、`pg`、`mysql2` 随包走；`zod` 仅应用侧使用（analytics/index.tsx、serverLibrary.ts），**不迁移**；`dotenv` 无 src 内使用，不动；`ai` 为 optional peerDependency

### 2. 公共 API（门面）

```ts
export function createDatasourceManager(opts: {
  configPath: string;            // 必填：配置文件路径由应用注入，包不内置业务目录
}): DatasourceManager;

export interface DatasourceManager {
  // —— 配置层 ——
  readConfig(): DatasourcesConfig;                  // 文件缺失/损坏→空配置；v2 自动迁移
  writeConfig(c: DatasourcesConfig): void;          // tmp+rename 原子写
  validate(s: DynamicSourceConfig): ValidateResult; // id/URL/command 等规则
  upsert(s: DynamicSourceConfig): DatasourcesConfig;
  delete(id: string): DatasourcesConfig;
  get(id: string): DynamicSourceConfig | undefined;
  list(): DataSourceDescriptor[];                   // 脱敏描述符，永不回传明文凭证
  // —— 连接与请求层（SDK 无关）——
  connect(s: DynamicSourceConfig): Promise<McpConnection>;  // { listTools, callTool, close }，键控缓存
  tools(s: DynamicSourceConfig): Promise<McpToolBinding[]>; // 工具名带 `<id>_` 前缀
  close(id: string): Promise<void>;                        // 关闭缓存连接，未知 id 静默
  health(s: DynamicSourceConfig): Promise<HealthResult>;   // 真实握手，3s 超时
  resolveActive(ids: string[]): ActiveSourceSummary[];     // 未知/未启用 id 告警并跳过
}

// adapters/ai.ts
export function toAiTools(bindings: McpToolBinding[]): Record<string, CoreTool>;
```

- 原 `mountClientTools` 拆两半：MCP 侧（listTools/callTool 绑定 + 前缀命名）进 `manager.tools()`；`ai` 侧（`tool()` + `jsonSchema()` 包装 + 结果解析）进 `toAiTools()`
- 现模块级全局缓存（`sourceCache` / `configCache` / `declarativePath`）改为**实例级私有状态**；`reloadDataSources()` 全局重置口删除，测试直接 new 实例

### 3. 应用侧迁移（6 个消费方）

| 消费方 | 改动 |
| --- | --- |
| `src/lib/datasources.ts`（新增） | 三行：`export const datasources = createDatasourceManager({ configPath: <现 DEFAULT_DATASOURCES_PATH 逻辑> })` |
| `app/api/datasources/route.ts` + `[id]/route.ts` | import 改为 `@/lib/datasources` 与包门面；行为不变 |
| `app/api/analyze/route.ts` | `datasources.readConfig()/resolveActive()/get()/tools()` + `toAiTools()` + `mergeToolSets()`（包导出） |
| `src/lib/prompt.ts` | 仅改 import 路径（`ActiveSourceSummary` 类型随包） |
| `components/chat/datasources/` 两文件 | 仅改 import 路径（`import type`，编译期擦除，不影响浏览器包体） |
| `src/mcp/` 目录 | 整体删除，不留转发 shim |

- `mergeToolSets`（同名冲突跳过告警）无 LLM 概念 → 随包导出
- `app/package.json` 加 `"@openui-analytics/datasources": "workspace:*"`，移除已随包走的三依赖

### 4. 测试与质量门

- 5 个测试文件（registry / dynamicSources / httpMcp / db 三个）随代码迁入包内，断言原样通过 = 无回归证据
- root `vitest.config.ts` 改用 `test.projects: [".", "packages/*"]` 纳管子包（vitest 5 语法；`vitest.workspace.ts` 已废弃）：根自身作为 project 保留应用测试，包内测试用 node 环境不依赖 jsdom；`pnpm test` 仍一条命令跑全部
- 质量门：`pnpm typecheck && pnpm lint && pnpm test` 全绿；`pnpm build` 成功；手动冒烟：dev 起服务 → 数据源 CRUD/启停 → analyze 出看板
- 收尾跑 `graphify update .` 刷新知识图谱

### 5. 明确不做

- 不发 npm、无版本策略/CHANGELOG（workspace 私有）
- 不改 `config/datasources.json` 格式与位置（仍由应用注入路径）
- 不动 `crossSourceMap`、`prompt.ts` 内容逻辑、前端 UI 组件
- 不做 stdio 命令白名单/沙箱（信任模型不变）

## 迁移映射

| 现文件 | 去向 |
| --- | --- |
| `src/mcp/registry.ts`（配置半区：类型/normalize/迁移/读写/校验/脱敏） | `src/config.ts` |
| `src/mcp/registry.ts`（探活半区 + describe/resolveActive） | `src/manager.ts` |
| `src/mcp/dynamicSources.ts` | `src/manager.ts`（缓存与分派）+ `adapters/ai.ts`（ai 包装） |
| `src/mcp/httpMcp.ts` → `src/connectors/http.ts`；`stdioMcp.ts` → `connectors/stdio.ts`；`db/*` → `connectors/db/*`；`parseToolResult.ts` 原位 | 同名职责不变 |
