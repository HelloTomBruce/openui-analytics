# 任务清单：openui-analytics 质量修复

> 计划背景与风险见 `tasks/plan.md`。每任务一个 commit；完成即勾。

## Phase 1: 测试基础设施

### Task 1: 修复 vitest Node 环境污染
**Description:** 全局 `environment: "jsdom"` 导致 import `node:fs`/`node:child_process` 的三个套件报 `No such built-in module: node:`。
**Acceptance criteria:**
- [ ] `crossSourceMap.test.ts`、`registry.test.ts`、`analyze/route.test.ts` 三个套件全部运行并通过
- [ ] 组件测试仍跑在 jsdom
**Verification:** `./node_modules/.bin/vitest run` 无 suite 级失败
**Dependencies:** None
**Files:** `src/lib/crossSourceMap.test.ts`、`src/mcp/registry.test.ts`、`src/app/api/analyze/route.test.ts`（各加 `// @vitest-environment node` docblock）
**Size:** XS

### Task 2: 修复 React production 构建解析（React.act）
**Description:** 组件测试加载了 `react-dom-test-utils.production.js`，`React.act` 不存在。排查 vitest 条件解析，确保测试环境拿到 React development 构建。
**Acceptance criteria:**
- [ ] `ChatDashboard.test.tsx` 3 个用例通过
- [ ] 不引入 `IS_REACT_ACT_ENVIRONMENT` 之类的临时 hack 而掩盖根因（除非确认是官方推荐方式）
**Verification:** `vitest run src/components` 全绿
**Dependencies:** None（可与 T1 并行）
**Files:** `vitest.config.ts`（或 `src/test/setup.ts`）
**Size:** S（含 spike）

### Task 3: 清理 lint warning 并确认三门全绿
**Acceptance criteria:**
- [ ] 删除 `src/app/api/datasources/route.test.ts:3` 未使用的 `listDataSources` import
- [ ] `pnpm lint`、`pnpm typecheck`、`pnpm test` 均 0 错误 0 warning
**Dependencies:** T1, T2
**Files:** `src/app/api/datasources/route.test.ts`
**Size:** XS

## Checkpoint 1：三门全绿（29/29），CI 恢复可信

## Phase 2: 数据丢失与正确性

### Task 4: 会话持久化重构
**Description:** `createNewSession()` 内部隐藏持久化副作用导致：清空全部/删除最后一条后被删数据复活。改为纯工厂函数；`useSessionManager` 用 `useEffect(() => persistSessions(sessions), [sessions])` 单点落盘；activeId 单独同步。
**Acceptance criteria:**
- [ ] 清空全部 → 刷新 → 只剩 1 个新会话
- [ ] 删除仅剩的 1 条 → 刷新 → 只剩替换后的新会话
- [ ] 新建会话 → 刷新 → 新会话存在且为活跃会话
- [ ] 新增 sessionStorage/useSessionManager 行为测试（jsdom + localStorage）
- [ ] setState updater 内不再做 persist 副作用
**Verification:** 新增测试通过 + 手工刷新验证
**Dependencies:** T3
**Files:** `src/lib/sessionStorage.ts`、`src/hooks/useSessionManager.ts`、新增测试
**Size:** M

### Task 5: MessageList 代码块语言感知提取
**Description:** 正则 `(?:openui)?` 可匹配空串导致 ```sql 等代码块被吞入渲染器。提取逻辑抽为 `lib/extractOpenUI.ts` 纯函数：带语言捕获，仅 `openui`/裸围栏进渲染器，其余语言保留在正文。
**Acceptance criteria:**
- [ ] ```sql / ```json 代码块原样展示在正文，不进 OpenUIRenderer
- [ ] 裸 ``` 与 ```openui 仍进渲染器
- [ ] 未闭合（流式中）代码块行为不变
- [ ] 纯函数单元测试覆盖以上分支
**Dependencies:** T3
**Files:** `src/components/chat/MessageList.tsx`、新增 `src/lib/extractOpenUI.ts` + 测试
**Size:** S

### Task 6: onFinish 过期闭包与跨会话串写
**Description:** `saveCurrentSessionMessages([...messages, message])` 用快照 messages，丢多步工具中间消息；流式中切换会话会写入错误会话。引入 messagesRef 读最新值；保存时校验发起请求时的 sessionId。
**Acceptance criteria:**
- [ ] 多步工具调用后所有 assistant 消息均落盘
- [ ] 流式期间切换会话，内容写回发起时的会话
**Dependencies:** T4（同文件）
**Files:** `src/components/ChatDashboard.tsx`、`src/hooks/useSessionManager.ts`
**Size:** S

### Task 7: FunnelChart 流失率错位
**Description:** 连接线渲染在阶段 idx 下方，流失率却按 idx-1→idx 计算。改为计算 idx→idx+1 的流失并标注于两者之间。
**Acceptance criteria:**
- [ ] 第 1 阶段下方显示 1→2 的真实流失率，末阶段无连接线
- [ ] 上一阶段值为 0 时不显示 Infinity/NaN
**Dependencies:** T2（组件测试）
**Files:** `src/components/analytics/FunnelChart.tsx`
**Size:** XS

### Task 8: localStorage 状态水合修复
**Description:** `typeof window` 惰性初始化导致服务端渲染空、客户端水合出 localStorage 值，hydration mismatch。改为服务端安全默认值 + mounted 后 useEffect 载入（或 useSyncExternalStore）。
**Acceptance criteria:**
- [ ] 首次加载 console 无 hydration 告警（恢复后的守护用例验证）
- [ ] 刷新后会话列表/设置仍正确恢复
**Dependencies:** T2, T4（同文件）
**Files:** `src/hooks/useSessionManager.ts`、`src/hooks/useLlmSettings.ts`
**Size:** M

## Checkpoint 2：测试全绿 + 手工验证会话 CRUD 刷新一致性、SQL 代码块纯文本展示

## Phase 3: 安全加固

### Task 9: GitLab client 缓存键控
**Description:** `cachedGitLabClient` 单例忽略后续 endpoint/token。缓存键改为 endpoint+token；键变化时关闭旧 client；探针与实际调用行为一致。
**Acceptance criteria:**
- [ ] 设置页改 GitLab URL/token 后无需重启即生效（健康探针 + 实际工具调用）
- [ ] 不同配置不串用同一连接
- [ ] registry.test.ts 覆盖缓存键变更场景
**Dependencies:** T1
**Files:** `src/mcp/mcpClient.ts`、`src/mcp/registry.ts`、`src/mcp/registry.test.ts`
**Size:** M

### Task 10: SQL 守卫纵深防御
**Description:** ①`executeReadOnlySql` 改用显式事务：`BEGIN; SET TRANSACTION READ ONLY; SET LOCAL statement_timeout='5s'`；②黑名单补 `into`、`pg_sleep`、`pg_terminate_backend`、`pg_cancel_backend`、`for update/share`、`set`、`listen/notify`、`prepare/execute`；③LIMIT 判断改用词法级检测（忽略字符串字面量/注释）。
**Acceptance criteria:**
- [ ] 新增测试：`SELECT ... INTO`、`pg_sleep`、CTE 内写操作、`FOR UPDATE`、字面量含 "limit" 的查询全部被拒或正确封顶
- [ ] 现有 8 个守卫用例继续通过
**Dependencies:** T1
**Files:** `src/lib/postgres.ts`、`src/lib/postgres.test.ts`
**Size:** M

### Task 11: CSV 导出统一修复
**Description:** 新建 `src/lib/csv.ts`：引号转义（`"`→`""`）、公式注入前缀防护（`=+-@` 前补 `'`）、Blob + URL.createObjectURL 下载。DataTable 与 clientTools 均改用之。
**Acceptance criteria:**
- [ ] 含 `"`、`#`、`,`、换行、`=cmd` 前缀的数据导出后格式正确
- [ ] 单测覆盖转义与注入防护
**Dependencies:** None
**Files:** 新增 `src/lib/csv.ts` + 测试、`src/components/analytics/DataTable.tsx`、`src/lib/clientTools.ts`
**Size:** S

### Task 12: token 传输改 header
**Description:** `/api/datasources` 的 gitlabUrl/gitlabToken 从 query 改为自定义 header（`x-gitlab-url`/`x-gitlab-token`），SettingsModal 同步改。
**Acceptance criteria:**
- [ ] token 不出现在 URL；route.test.ts 更新并通过
**Dependencies:** T1
**Files:** `src/app/api/datasources/route.ts`、`src/components/chat/SettingsModal.tsx`、route.test.ts
**Size:** S

### Task 13: analyze 路由凭证混用防护
**Description:** 客户端提供 baseURL 但未提供 apiKey 时，禁止回落到服务端 env key（凭证外泄通道）；显式拒绝并提示。README 补部署安全说明。
**Acceptance criteria:**
- [ ] baseURL 无 apiKey → 400/引导提示，绝不用 env key 请求客户端 URL
- [ ] route.test.ts 覆盖该场景
**Dependencies:** T1
**Files:** `src/app/api/analyze/route.ts`、route.test.ts、`README.md`
**Size:** S

## Checkpoint 3：注入用例全拒；GitLab 配置热生效；URL 无 token

## Phase 4: 架构一致性

### Task 14: Postgres 工具动态化 + 死代码清理
**Description:** analyze 路由的 3 个手写 Postgres 工具包装改为经内存 MCP client `listTools()` 动态生成（与 gitlab/zentao 同 pattern）；删除无人调用的 `getOpenAIToolsFromMcp`。description 文案逐字保留。
**Acceptance criteria:**
- [ ] 路由不再手写 execute_sql/list_tables/describe_table 包装
- [ ] 工具 description 与现网逐字一致（prompt 回归测试锁定）
- [ ] `getOpenAIToolsFromMcp` 删除
**Dependencies:** T13（同文件）
**Files:** `src/app/api/analyze/route.ts`、`src/mcp/mcpClient.ts`、route.test.ts
**Size:** M

### Task 15: prompt 示例与 schema 对齐
**Description:** 修复 prompt.ts 示例中 ContributionHeatmap 颜色 `"#3b82f6"`（schema 仅 green/blue/purple）、RadarChart series `label`（schema 为 `name`）；新增一致性测试：示例中的组件调用参数能被 serverLibrary zod schema 校验通过。
**Acceptance criteria:**
- [ ] 新增 prompt-schema 一致性测试通过
- [ ] prompt.test.ts 现有用例不回归
**Dependencies:** None
**Files:** `src/lib/prompt.ts`、新增一致性测试
**Size:** S

### Task 16: 共享 parseArrayProp + z.any 收敛 + 'use client'
**Description:** 提取 7 处重复的"字符串则 JSON.parse→过滤"防御逻辑为共享工具；analytics/index.tsx 顶部加 `'use client'`；data/stages/actions 等 schema 从 `z.any()` 收敛为宽松有形状的 schema。
**Acceptance criteria:**
- [ ] 重复防御逻辑单点化，各组件行为不变
- [ ] index.tsx 可被 server component import 不炸
- [ ] schema 变更不破坏 T15 一致性测试
**Dependencies:** T15
**Files:** `src/components/analytics/index.tsx` + 6 个组件、新增 `src/lib/parseProp.ts`（或并入 utils）
**Size:** M

### Task 17: zentao 连接锁与 MCP 解析去重
**Description:** `isConnecting`+sleep 假锁改为共享 Promise mutex；mcpClient 与 zentaoMcpClient 的 content 解析逻辑提取公共函数。
**Acceptance criteria:**
- [ ] 并发调用 getZentaoMcpClient 只建立一个连接（测试断言）
**Dependencies:** T14（共享 mcpClient）
**Files:** `src/mcp/zentaoMcpClient.ts`、`src/mcp/mcpClient.ts`
**Size:** S

### Task 18: ErrorBoundary 共享 + 自动重置
**Description:** 提取共享 ErrorBoundary；content/children 变化时自动复位（key 或 getDerivedStateFromProps）；fallback 文案如实说明渲染失败并提供重试。
**Acceptance criteria:**
- [ ] 流式中间态解析失败后，内容合法时自动恢复渲染
- [ ] 两处重复实现合并为一个
**Dependencies:** T5（MessageList 改后）
**Files:** 新增 `src/components/ErrorBoundary.tsx`、`src/components/OpenUIRenderer.tsx`、`src/components/analytics/index.tsx`
**Size:** S

### Task 19: temperature 设置项（用户可调）
**Description:** 已决策：暴露到设置页。`useLlmSettings` 新增 temperature 字段（localStorage + chatBody 透传）；SettingsModal 加滑块/数字输入；analyze 路由采用客户端值并钳制 0–2，默认 0.2（原硬编码 1）。
**Acceptance criteria:**
- [ ] 设置页可调 temperature，刷新后保持
- [ ] 服务端钳制越界值；未提供时默认 0.2
- [ ] route.test.ts 覆盖钳制与默认值
**Dependencies:** T12（同改 SettingsModal 传输层）
**Files:** `src/hooks/useLlmSettings.ts`、`src/components/chat/SettingsModal.tsx`、`src/app/api/analyze/route.ts`、route.test.ts
**Size:** M

### Task 24: API 路由鉴权（部署前置）
**Description:** 已决策：有部署计划。新增 `middleware.ts`：当 env `OPENUI_API_AUTH_TOKEN` 配置时，`/api/*` 请求须带 `Authorization: Bearer <token>`，否则 401；未配置时放行（本地开发免鉴权）。前端 useLlmSettings 增加可选访问令牌字段并在所有 fetch 中附带。README 补部署安全章节。
**Acceptance criteria:**
- [ ] 配置 token 后无 Authorization 的 /api/* 请求返回 401
- [ ] 未配置 token 时行为与现状一致
- [ ] 中间件单测覆盖两种模式
**Dependencies:** T12（传输层已就位）
**Files:** 新增 `src/middleware.ts`、`src/hooks/useLlmSettings.ts`、route tests、`README.md`
**Size:** M

## Checkpoint 4：全绿 + prompt 一致性测试锁定示例质量

## Phase 5: 性能

### Task 20: 流式重渲染治理
**Description:** 抽取 `MessageItem` 并 `React.memo`；OpenUIRenderer 包 memo；正则提取结果 useMemo。验收含手工流式冒烟。
**Dependencies:** T5, T18
**Files:** `src/components/chat/MessageList.tsx`（拆 MessageItem）、`src/components/OpenUIRenderer.tsx`
**Size:** M

### Task 21: 渲染期计算 useMemo 化
**Description:** AnalyticsChart 的 series/data 派生、DataTable 的 filter+sort 改 useMemo。
**Dependencies:** T16
**Files:** `src/components/analytics/AnalyticsChart.tsx`、`src/components/analytics/DataTable.tsx`
**Size:** S

### Task 22: ChatDashboard 小修
**Description:** 内联闭包改 useCallback（配合 memo）；MessageList 的 status/isLoading 去重。
**Dependencies:** T20
**Files:** `src/components/ChatDashboard.tsx`、`src/components/chat/MessageList.tsx`
**Size:** XS

## Phase 6: 打磨

### Task 23: Toast 组件 + UI 修正包（Nits 合批）
**Description:** 已决策：alert 全部替换为自实现轻量 toast。先实现 `lib/toast.ts`（模块级 pub/sub store，非 React 可直发）+ `components/Toaster.tsx`（挂载于 ChatDashboard，自动消隐）；clientTools 三处 alert、DevToolsPanel 的 alert 全部迁移。随后 Nits 合批：GaugeProgress 无效上限清理；MetricCard object 兜底改 "-"；SessionListItem 负时间钳制；ContributionHeatmap tooltip 裁剪修复；ReactiveSimulator 滑块上限与校验一致（200000 vs 100万）+ 客单价可配；ChatSidebar 恰剩 1 条时也可清空；InsightBanner dismissed 持久化 + handleRefresh unmount 保护；ChatSidebar `key={idx}` 改稳定 key。
**Acceptance criteria:**
- [ ] 全项目无 alert() 残留（grep 验证）
- [ ] toast 成功/错误两态，3s 自动消隐，多条堆叠
- [ ] 上述 Nit 每点逐一验证；视觉无回归
**Dependencies:** Phase 5
**Files:** 新增 `src/lib/toast.ts` + `src/components/Toaster.tsx`、`src/lib/clientTools.ts`、`src/components/chat/DevToolsPanel.tsx`、对应各组件文件
**Size:** M

## Final Checkpoint
- [ ] lint / typecheck / test / build 全绿
- [ ] 评审报告每条发现均有 commit 或 Won't-fix 说明
