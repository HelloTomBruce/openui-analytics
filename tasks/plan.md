# 修复计划：openui-analytics 代码质量评审问题全量修复

## Overview

针对五维评审报告中的全部发现（3 Critical / 8 Required / 10+ Optional / Nits），分 6 个阶段修复。核心原则：**先修测试基础设施（安全网），再修数据丢失，然后安全，最后架构与性能**；每个任务保持 S/M 规模，独立可验证、可提交；重构与新行为分离。

## Architecture Decisions

- **测试环境修复走显式声明**：Node 专用测试文件用 `// @vitest-environment node` docblock，而非全局 environmentMatchGlobs —— 意图留在文件内，新文件默认 jsdom（多数测试是组件测试）。
- **会话持久化改为单点**：`createNewSession` 剥离 localStorage 副作用，`useSessionManager` 内用 `useEffect(() => persistSessions(sessions), [sessions])` 单点落盘 —— 消除"每个 handler 各自记得 persist"这类遗漏的根源。
- **SQL 守卫升级为纵深防御**：数据库层硬约束（只读事务 + statement_timeout）为主，关键字黑名单为辅 —— 黑名单天花板已在评审中证明。
- **CSV 导出收敛为一个共享工具**：`lib/csv.ts` 同时服务 DataTable 与 clientTools，消灭两处各自实现。
- **GitLab client 缓存键 = endpoint+token**：配置变更即换连接，旧 client 显式 close。

## Task List

### Phase 1: 测试基础设施（安全网先行）

- [ ] T1: 修复 vitest Node 环境污染（3 个套件 `No such built-in module: node:`）
- [ ] T2: 修复 React production 构建解析（`React.act is not a function`）
- [ ] T3: 清理 lint warning，确认 lint/typecheck/test 全绿

### Checkpoint: Phase 1
- [ ] `pnpm lint && pnpm typecheck && pnpm test` 全部通过（29/29）
- [ ] 守护测试恢复"重构行为锁定"能力

### Phase 2: 数据丢失与正确性

- [ ] T4: 会话持久化重构（createNewSession 副作用剥离 + 单点落盘）
- [ ] T5: MessageList 代码块提取修复（语言感知正则 + 提取可测纯函数）
- [ ] T6: onFinish 过期闭包 + 跨会话串写修复
- [ ] T7: FunnelChart 流失率标注错位修复
- [ ] T8: localStorage 状态 SSR 水合不一致修复

### Checkpoint: Phase 2
- [ ] 测试全绿；手工验证：新建/删除/清空会话刷新后状态正确
- [ ] 模型输出 ```sql 代码块按纯文本展示，不喂给 OpenUI 渲染器

### Phase 3: 安全加固

- [ ] T9: GitLab MCP client 缓存按 endpoint+token 键控，配置变更即生效
- [ ] T10: SQL 守卫纵深防御（只读事务 + statement_timeout + 黑名单补漏）
- [ ] T11: CSV 导出统一修复（转义/公式注入/Blob 下载）
- [ ] T12: GitLab token 传输从 URL query 改为自定义 header
- [ ] T13: analyze 路由凭证混用防护（客户端 baseURL 必须配对客户端 apiKey）
- [ ] T24: API 路由鉴权（env Bearer token + middleware 统一拦截，本地免配置）

### Checkpoint: Phase 3
- [ ] 注入测试用例全部被拒；修改 GitLab 设置无需重启即生效
- [ ] token 不出现在任何 URL 中

### Phase 4: 架构一致性与技术债

- [ ] T14: Postgres 工具动态发现统一 + 删除死代码 getOpenAIToolsFromMcp
- [ ] T15: prompt 示例与 zod schema 对齐（含 ContributionHeatmap 颜色、RadarChart series label/name）
- [ ] T16: 提取共享 parseArrayProp + analytics/index.tsx 补 'use client' + z.any 收敛
- [ ] T17: zentao client 连接锁改 Promise mutex + MCP 调用解析逻辑去重
- [ ] T18: ErrorBoundary 提取共享实现 + content 变化自动重置 + 如实文案
- [ ] T19: temperature 暴露为设置项（用户可调，服务端钳制 0–2，默认 0.2）

### Checkpoint: Phase 4
- [ ] 全量测试绿；`serverLibrary.prompt()` 输出示例通过自身 schema 校验（新增一致性测试）

### Phase 5: 性能

- [ ] T20: MessageItem 抽取 + React.memo + OpenUIRenderer memo（流式重渲染治理）
- [ ] T21: AnalyticsChart/DataTable 渲染期计算 useMemo 化
- [ ] T22: ChatDashboard 内联闭包与 MessageList 重复 props 小修

### Phase 6: 打磨（Nits 打包）

- [ ] T23: UI 修正包（GaugeProgress 上限、MetricCard 兜底、SessionListItem 负时间、Heatmap tooltip 裁剪、ReactiveSimulator 校验一致性、ChatSidebar 清空入口、InsightBanner dismissed 持久化、key={idx}、alert 替换评估）

### Checkpoint: 最终
- [ ] lint/typecheck/test/build 全绿
- [ ] 评审报告每条发现均有对应提交或明确的 Won't-fix 说明

## Risks and Mitigations

| 风险 | 影响 | 缓解 |
|---|---|---|
| T2 React act 根因未明（可能是 vitest 5 条件解析或 React 19.3 变更） | T2 卡住阻塞后续组件测试 | 先 30 分钟 spike：试 `test.env.NODE_ENV='development'`、resolve.conditions、降 jsdom 条件三招；仍不行则组件测试临时改 `environment: 'node'` + 手动 jsdom |
| T14 动态化后工具 description 变化影响 LLM 行为 | 分析质量回归 | 保留现有 description 文案逐字迁移到 MCP server 定义；prompt.test.ts 锁定 prompt 关键内容 |
| T4 持久化重构触碰多个 handler | 引入新的丢失路径 | 先写 sessionStorage/useSessionManager 行为测试（jsdom + localStorage mock）再改实现 |
| T10 只读事务依赖 DB 用户权限 | 本地 postgres 超级用户下只读事务仍有效，但 role 方案不可移植 | 只用事务级 `SET TRANSACTION READ ONLY` + `statement_timeout`，不要求新建 role；文档说明生产应配只读 role |
| T20 memo 化改变流式渲染时序 | UI 不更新 | 验收标准含手工流式冒烟：逐 token 渲染、工具指示器、最终看板均正常 |

## Open Questions（已决策）

- ✅ **Toast**：`alert()` 全部替换为自实现轻量 toast（模块级 pub/sub store + `<Toaster/>` 挂载于 ChatDashboard，clientTools 为非 React 函数故走 store 直发）。
- ✅ **Temperature**：暴露到设置页（localStorage + chatBody 透传，服务端钳制 0–2，默认 0.2），T19 扩大为设置链路改动。
- ✅ **有部署计划**：P3 追加 **T24: API 路由鉴权**（env 配置 Bearer token，未配置时保持本地开发免鉴权；middleware 统一拦截 /api/*；README 补部署章节）。

## Commit 计划

每任务一个 commit，信息遵循 `type: 中文描述` 的仓库现有惯例（feat/fix/refactor/test/chore）。Phase 1 单独一个分支合入以先恢复 CI 绿。
