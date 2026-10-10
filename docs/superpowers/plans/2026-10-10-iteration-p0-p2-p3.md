# 迭代路线图 P0+P2+P3 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 openui-analytics 从 demo 级提升为可维护工具：拆分 990 行巨石组件、补齐测试与文档（P0）；把数据智能从"营销获客单源演示"升级为"禅道+GitLab 跨源研发效能分析"并支持主动洞察（P2）；建立可扩展的数据源接入体系（P3）。

**架构：** 保持现有"Next.js Route Handler + Vercel AI SDK streamText + MCP 工具 → ```openui 代码块 → 前端声明式渲染"主链路不变。P0 只做结构性拆分不改行为；P2 通过 prompt 工程 + 跨源映射配置实现联合分析，主动洞察走独立 cron 路由；P3 用注册表模式收口数据源配置。

**技术栈：** Next.js 16 / React 19 / Vercel AI SDK 4.x / @modelcontextprotocol/sdk / Vitest / TypeScript 5。

**规格：** 本计划即规格（来源：2026-10-10 项目现状评审，P0/P2/P3 方向已经确认）。

## 全局约束

- 包管理器固定 pnpm@12.10.1；Node 20（CI 已固定）。
- 每个任务完成后 `pnpm run lint && pnpm run typecheck` 必须通过，CI（`.github/workflows`）不得变红。
- 现有 AI SDK 版本锁定（`ai@4.1.54`, `@ai-sdk/react@1.1.20`），Data Stream Protocol v1 响应格式（`0:`/`3:`/`d:` 前缀）不可破坏。
- P0 拆分必须是纯重构：不改变任何用户可见行为、不改变 localStorage 的 key（`openui_chat_sessions_v1` 等）。
- 所有新增 SQL 仍受 `src/lib/postgres.ts` 只读守卫约束。

## 审查重点（Review Focus）

1. **拆分后 hydration mismatch**：`ChatDashboard` 多个 `useState(() => ...)` 惰性初始化读取 localStorage，抽到子组件/hook 后若时序变化会出现 SSR/客户端不一致 → 任务 3 的测试钉住"首渲染不报错且 hydration 无 warning"。
2. **prompt 示例更换导致旧预设失效**：`PRESET_QUERIES` 与 `DEFAULT_SANDBOX_CODE`（ChatDashboard.tsx:49/58）全是营销场景，只改 prompt.ts 不改前端会让用户点预设得到错位结果 → 任务 5 要求三者同 commit 修改。
3. **跨源 join 键不匹配**：禅道项目名与 GitLab 项目路径通常不一致，模型硬 join 必失败 → 任务 6 用显式映射表 + prompt 降级指引，测试覆盖"映射缺失时不报错、给出提示"。
4. **MCP 断连拖垮整个请求**：`Promise.all([getGitLabAiTools, getZentaoAiTools])`（route.ts）任一 reject 会导致 500 分支 → 任务 2 补降级测试，任务 6 顺带确认 `Promise.allSettled` 语义。
5. **主动洞察 cron 在无 LLM Key 环境下空转**：洞察路由必须复用 analyze 的"未配置 Key 时返回合规 data stream"降级模式 → 任务 7 测试钉住该行为。

---

## 阶段 P0：工程化补课（任务 1–4）

### 任务 1：测试基建落地

**文件：**
- 创建：`vitest.config.ts`、`src/test/setup.ts`
- 修改：`package.json`（scripts + devDependencies）、`.github/workflows/ci.yml`
- 测试：`src/lib/sessionStorage.test.ts`（首个冒烟测试）

- [ ] **步骤 1：安装依赖**

```bash
pnpm add -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **步骤 2：创建 `vitest.config.ts`**，jsdom 环境，`src/test/setup.ts` 引入 `@testing-library/jest-dom`；`package.json` 增加 `"test": "vitest run"`。

- [ ] **步骤 3：编写冒烟测试 `src/lib/sessionStorage.test.ts`**

测试名与断言：
- `generateSessionTitle("【报表】分析上季度 CAC 趋势")` 返回 `"分析上季度 CAC 趋势"`（过滤 markdown 与【】前缀）
- 输入超过 20 字时截断并追加 `"..."`
- `createNewSession()` 返回的 session 含 `DEFAULT_WELCOME_MESSAGE` 且 id 以 `session_` 开头（jsdom 提供 localStorage）

- [ ] **步骤 4：运行 `pnpm test` 确认通过；`pnpm run typecheck` 通过。**

- [ ] **步骤 5：CI 加一步 `pnpm test`（置于 typecheck 之后），Commit。**

```bash
git add vitest.config.ts src/test/setup.ts src/lib/sessionStorage.test.ts package.json pnpm-lock.yaml .github/workflows/ci.yml
git commit -m "test: 引入 Vitest 测试基建并接入 CI"
```

### 任务 2：核心服务端逻辑单测 + MCP 断连降级加固

**文件：**
- 修改：`src/lib/postgres.ts`（导出只读校验函数）、`src/app/api/analyze/route.ts`
- 测试：`src/lib/postgres.test.ts`、`src/app/api/analyze/route.test.ts`

- [ ] **步骤 1：编写失败测试 `src/lib/postgres.test.ts`**

从 `postgres.ts:130` 附近提取 `assertReadOnlySql(sql: string): void` 并导出。断言：
- `assertReadOnlySql("SELECT 1")` 与 `assertReadOnlySql("WITH x AS (SELECT 1) SELECT * FROM x")` 不抛错
- `"DELETE FROM users"`、`"INSERT INTO t VALUES (1)"`、`"DROP TABLE t"`、前导空白/注释后跟 DELETE 均抛出包含 `"安全限制"` 的错误

- [ ] **步骤 2：运行确认 FAIL（函数未导出）→ 实现提取（不改校验逻辑本身）→ 确认 PASS。**

- [ ] **步骤 3：编写 `route.test.ts`**：mock `callMcpTool` / `getGitLabAiTools` / `getZentaoAiTools`，断言：
- 无 apiKey 时返回 200 + `x-vercel-ai-data-stream: v1` header + 正文含 `未检测到 LLM API Key`
- `getGitLabAiTools` reject 时路由不抛 500（当前 `Promise.all` 行为）——**此测试当前应失败**

- [ ] **步骤 4：将 route.ts 的 `Promise.all` 改为 `Promise.allSettled`**，失败源降级为空工具集并 `console.warn`；重跑测试全 PASS。

- [ ] **步骤 5：Commit**

```bash
git add src/lib/postgres.ts src/lib/postgres.test.ts src/app/api/analyze/route.ts src/app/api/analyze/route.test.ts
git commit -m "test+fix: 只读 SQL 守卫单测与 MCP 工具加载断连降级"
```

### 任务 3：拆分 ChatDashboard.tsx（纯重构）

**文件：**
- 创建：
  - `src/components/chat/ChatSidebar.tsx`（Logo/新建会话/Tab/历史列表/预设列表/底部状态栏，原 349–579 行 JSX）
  - `src/components/chat/SessionListItem.tsx`（单个会话项 + 悬浮操作 + 重命名内联编辑）
  - `src/components/chat/MessageList.tsx`（消息滚动区 + 工具调用指示器 + thinking 卡片，原 627–787 行）
  - `src/components/chat/ChatInput.tsx`（底部输入框，原 788–818 行）
  - `src/components/chat/SettingsModal.tsx`（LLM 设置模态框，原 872 行起）
  - `src/components/chat/DevToolsPanel.tsx`（AST 调试工作台，原 819–871 行）
  - `src/hooks/useSessionManager.ts`（sessions/currentSessionId/增删改查/重命名，245–325 行的 handlers）
  - `src/hooks/useLlmSettings.ts`（apiKey/baseURL/model/gitlabToken/gitlabUrl 状态 + saveSettings）
  - `src/lib/presetQueries.ts`（导出 `PRESET_QUERIES` 与 `DEFAULT_SANDBOX_CODE`，供组件与测试复用）
- 修改：`src/components/ChatDashboard.tsx`（瘦身为组合层，目标 ≤ 250 行，保留 useChat 接线）
- 测试：`src/components/chat/ChatDashboard.test.tsx`

- [ ] **步骤 1：先写守护测试 `ChatDashboard.test.tsx`**（在拆分前对现有组件跑通）：

mock `@ai-sdk/react` 的 `useChat` 返回固定 messages。断言：
- 渲染出欢迎消息文本 `对话式数据分析助手`
- 渲染出侧边栏"新建会话"按钮与设置入口
- 首次渲染无 hydration warning（`console.error` 不被调用——用 vi.spyOn 捕获 React 的 hydrate 报错）

运行确认 PASS（绿锁重构）。

- [ ] **步骤 2：按依赖顺序提取**——先 `presetQueries.ts` 与两个 hooks（无 JSX，最易验证），再叶子组件（SessionListItem → ChatInput → SettingsModal → DevToolsPanel），最后 ChatSidebar 与 MessageList。每提取一个就跑一次守护测试 + lint + typecheck。

props 签名约定：所有子组件只接 primitive/回调 props，不直接 import hooks 内部状态；`ChatDashboard` 是唯一接线点。

- [ ] **步骤 3：确认 `ChatDashboard.tsx` ≤ 250 行，守护测试仍 PASS，`pnpm run build` 通过。**

- [ ] **步骤 4：Commit（一次提取一个 commit 或整体一个 commit 均可，但守护测试必须全程绿）**

```bash
git add src/components/chat/ src/hooks/ src/lib/presetQueries.ts src/components/ChatDashboard.tsx
git commit -m "refactor: 拆分 ChatDashboard 巨石组件为组合层 + 专注子组件"
```

### 任务 4：真实 README 与架构文档

**文件：**
- 重写：`README.md`
- 创建：`docs/architecture.md`

- [ ] **步骤 1：README 包含**：项目定位一句话、架构图（ASCII：Chat → /api/analyze → 3×MCP → openui 渲染）、快速开始（env 变量表：`OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL`/`DATABASE_URL`/GitLab 相关）、`pnpm dev -p 3006`、测试/lint/typecheck 命令。

- [ ] **步骤 2：`docs/architecture.md` 包含**：Data Stream Protocol v1 响应格式说明、MCP 工具注册链路（route.ts → mcpClient/zentaoMcpClient → AI SDK tools）、openui 组件清单表（15 个组件及用途，从 prompt.ts 提取）、只读 SQL 守卫说明。

- [ ] **步骤 3：Commit**

```bash
git add README.md docs/architecture.md
git commit -m "docs: 重写 README 并补充架构文档"
```

---

## 阶段 P2：数据智能深化（任务 5–7）

### 任务 5：prompt 示例与前端预设切换为研发效能场景

**文件：**
- 修改：`src/lib/prompt.ts`（examples 数组）、`src/lib/presetQueries.ts`、`src/lib/sessionStorage.ts`（DEFAULT_WELCOME_MESSAGE）
- 测试：`src/lib/prompt.test.ts`

- [ ] **步骤 1：编写 `prompt.test.ts`** 失败测试：
- `getOpenUISystemPrompt()` 返回值包含 `zentao_bug` 与 `gitlab` 字样
- 返回值不包含 `"TikTok Ads 实时预算与投产测试器"`（旧营销示例已移除）
- 返回值包含新示例标识 `"迭代缺陷收敛漏斗"`

- [ ] **步骤 2：重写 prompt.ts 的 examples**：换为研发效能场景——zentao_bug（按严重程度聚合）+ zentao_task（工时消耗）+ gitlab commit 活跃度 → FunnelChart（需求生命周期）+ ContributionHeatmap（提交热力）+ RadarChart（成员负载）+ ActionPlanCard。数据行用真实感的禅道字段名（severity/assignedTo/status）。

- [ ] **步骤 3：同 commit 更新 `presetQueries.ts`**：预设问题换为 4 个研发效能问题（如"本迭代各项目 bug 收敛情况如何"）；`DEFAULT_SANDBOX_CODE` 同步换为研发效能示例；欢迎语特性清单补"禅道 × GitLab 跨源分析"。

- [ ] **步骤 4：`pnpm test` + typecheck 通过；手动 `pnpm dev` 发一条预设问题确认模型产出研发效能看板（人工验收）。**

- [ ] **步骤 5：Commit**

```bash
git add src/lib/prompt.ts src/lib/prompt.test.ts src/lib/presetQueries.ts src/lib/sessionStorage.ts
git commit -m "feat(prompt): 示例与预设切换为禅道+GitLab 研发效能场景"
```

### 任务 6：跨源联合分析（禅道 × GitLab 关联）

**文件：**
- 创建：`src/lib/crossSourceMap.ts`（禅道项目 ↔ GitLab 项目映射配置 + 查询函数）、`config/cross-source-map.json`（可手编辑的映射文件，含注释示例）
- 修改：`src/lib/prompt.ts`（追加联合分析章节）、`src/app/api/analyze/route.ts`（注册新工具）
- 测试：`src/lib/crossSourceMap.test.ts`

- [ ] **步骤 1：编写失败测试 `crossSourceMap.test.ts`**：

`getCrossSourceLinks(zentaoProjectId: string): { gitlabProject: string | null; confidence: "mapped" | "none" }`
- 映射命中时返回配置的 gitlab 项目路径与 `"mapped"`
- 映射缺失时返回 `{ gitlabProject: null, confidence: "none" }` 且**不抛错**
- 配置文件不存在/JSON 损坏时同样降级为 `"none"`

- [ ] **步骤 2：实现 `crossSourceMap.ts`**：服务端 `fs.readFileSync` 读取 `config/cross-source-map.json`（启动时加载 + 缓存，提供 `reloadCrossSourceMap()`）。

- [ ] **步骤 3：route.ts 注册新 AI 工具 `cross_source_link`**：description 为"查询禅道项目与 GitLab 仓库的关联映射，用于跨源联合分析"；execute 调用 `getCrossSourceLinks`。

- [ ] **步骤 4：prompt.ts 追加章节**：联合分析指引——"当问题同时涉及项目进度与代码活动时，先用 `cross_source_link` 查映射；`confidence=none` 时在 InsightBox 中提示用户到 `config/cross-source-map.json` 补映射，不得编造 join 结果。"给出联合分析输出范式（ActivityTimeline 混合 commit + 禅道状态流转事件）。

- [ ] **步骤 5：测试 PASS + typecheck 通过，Commit。**

```bash
git add src/lib/crossSourceMap.ts src/lib/crossSourceMap.test.ts config/cross-source-map.json src/lib/prompt.ts src/app/api/analyze/route.ts
git commit -m "feat: 禅道×GitLab 跨源映射工具与联合分析 prompt 指引"
```

### 任务 7：主动洞察（定时异常扫描）

**文件：**
- 创建：`src/app/api/insights/route.ts`（GET 触发扫描）、`src/lib/insights.ts`（异常检测纯函数）、`src/components/chat/InsightBanner.tsx`（会话顶部展示）
- 修改：`src/components/ChatDashboard.tsx`（挂载 banner + 手动刷新按钮）
- 测试：`src/lib/insights.test.ts`、`src/app/api/insights/route.test.ts`

- [ ] **步骤 1：编写失败测试 `insights.test.ts`**：

`detectAnomalies(metrics: MetricSnapshot[]): Insight[]`，其中 `MetricSnapshot = { metric: string; current: number; baseline: number }`：
- 环比偏差 > 30% 产出 `{ level: "warning", ... }`，> 50% 产出 `{ level: "critical", ... }`
- 偏差 ≤ 30% 不产出
- 空数组输入返回空数组

- [ ] **步骤 2：实现 `insights.ts` 纯函数 → 测试 PASS。**

- [ ] **步骤 3：`/api/insights/route.ts`**：调用 execute_sql 拉取关键指标（bug 新增数、任务延期数、MR 合入数）环比快照 → `detectAnomalies` → 返回 JSON `{ insights: Insight[], generatedAt: string }`。**审查重点第 5 条**：无 LLM Key / DB 不可达时返回 200 + `{ insights: [], error: "..." }`，绝不 500。对应 `route.test.ts` 钉住该降级。

- [ ] **步骤 4：`InsightBanner.tsx`**：进入会话时 fetch 一次，有 critical/warning 时展示可折叠横幅（复用 InsightBox 视觉），提供"刷新"与"展开分析"（点击把洞察作为用户消息发给 useChat）。

- [ ] **步骤 5：测试 + typecheck + 手动验收，Commit。**

```bash
git add src/app/api/insights/route.ts src/lib/insights.ts src/lib/insights.test.ts src/components/chat/InsightBanner.tsx src/components/ChatDashboard.tsx
git commit -m "feat: 研发效能指标异常主动洞察与横幅提醒"
```

---

## 阶段 P3：生态扩展（任务 8–9）

### 任务 8：数据源注册表与健康检查

**文件：**
- 创建：`src/mcp/registry.ts`（数据源描述符注册表）、`src/app/api/datasources/route.ts`（GET 返回各源状态）
- 修改：`src/components/chat/SettingsModal.tsx`（新增"数据源"分区展示状态灯）
- 测试：`src/mcp/registry.test.ts`

- [ ] **步骤 1：编写失败测试 `registry.test.ts`**：

`listDataSources(): DataSourceDescriptor[]`，`DataSourceDescriptor = { id: string; name: string; kind: "postgres" | "gitlab-mcp" | "zentao-cli"; tools: string[] }`
- 默认返回 3 个内置源（postgres / gitlab / zentao），id 稳定
- `checkDataSourceHealth(id)` 对未知 id 返回 `{ ok: false, error: "unknown datasource" }`

- [ ] **步骤 2：实现 `registry.ts`**：内置三源描述符；`checkDataSourceHealth` 分别执行——postgres 跑 `SELECT 1`、gitlab 调 list tools、zentao 跑 CLI `--help` 探活，全部带 3s 超时与 try/catch。

- [ ] **步骤 3：`/api/datasources/route.ts` 返回 `{ sources: [...], health: { [id]: { ok, latencyMs, error? } } }`。**

- [ ] **步骤 4：SettingsModal 加"数据源状态"分区**：每源一行状态灯（绿/红）+ 延迟 + 错误 tooltip；进入设置时 lazy fetch。

- [ ] **步骤 5：测试 + typecheck，Commit。**

```bash
git add src/mcp/registry.ts src/mcp/registry.test.ts src/app/api/datasources/route.ts src/components/chat/SettingsModal.tsx
git commit -m "feat: 数据源注册表与设置页健康状态面板"
```

### 任务 9：新数据源接入模板与文档

**文件：**
- 创建：`docs/adding-a-datasource.md`、`src/mcp/templateMcpClient.ts.example`
- 修改：`docs/architecture.md`（补数据源扩展章节）、`src/mcp/registry.ts`（支持从 `config/datasources.json` 读取声明式 HTTP MCP 源）

- [ ] **步骤 1：编写失败测试**：`registry.test.ts` 新增——`config/datasources.json` 中存在合法声明（`{ id, name, kind: "http-mcp", url }`）时 `listDataSources()` 将其并入列表；JSON 损坏时忽略并仅返回内置 3 源。

- [ ] **步骤 2：实现声明式扩展读取 → 测试 PASS。**

- [ ] **步骤 3：写 `docs/adding-a-datasource.md`**：两条路径——① 声明式（HTTP MCP，零代码，改 json 即可）；② 命令式（复制 `templateMcpClient.ts.example`，实现 `getXxxAiTools()`，在 route.ts 注册，约 30 行）。以 Jira 与 MySQL 为示例。

- [ ] **步骤 4：测试 + typecheck，Commit。**

```bash
git add docs/adding-a-datasource.md src/mcp/templateMcpClient.ts.example src/mcp/registry.ts src/mcp/registry.test.ts docs/architecture.md config/datasources.json
git commit -m "feat: 声明式数据源扩展与接入指南文档"
```

---

## 执行顺序与依赖

```text
P0: 任务1(测试基建) → 任务2(服务端单测) → 任务3(拆分,依赖守护测试) → 任务4(文档)
P2: 任务5(prompt切换) → 任务6(跨源,依赖任务2的降级修复) → 任务7(主动洞察,依赖任务3拆分后的挂载点)
P3: 任务8(注册表) → 任务9(声明式扩展)
```

P0 必须先行（任务 3 的拆分是任务 7 的前置）；P2 与 P3 可并行。
