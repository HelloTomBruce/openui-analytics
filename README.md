# OpenUI Analytics

对话式生成 UI 数据分析看板：用自然语言提问，由 LLM 编排 **PostgreSQL / GitLab / 禅道 / 文件（CSV·Excel → DuckDB）** 多路数据源取数，流式生成 **OpenUI Lang** 声明式看板（KPI 卡、漏斗、热力图、雷达图、预算模拟器等）并实时渲染。

## 架构

```text
┌──────────────────────────────────────────────────────────────┐
│ Browser (Next.js 16 / React 19)                              │
│  ChatDashboard (组合层)                                       │
│   ├─ chat/ChatSidebar    会话管理 + 预设场景                  │
│   ├─ chat/MessageList    消息流 + 工具调用指示 + OpenUI 渲染  │
│   ├─ chat/ChatInput / SettingsModal / DevToolsPanel          │
│   └─ hooks/useLlmSettings + useSessionManager                │
└──────────────┬───────────────────────────────────────────────┘
               │ POST /api/analyze (Data Stream Protocol v1)
               ▼
┌──────────────────────────────────────────────────────────────┐
│ Route Handler: streamText (Vercel AI SDK)                    │
│  system prompt: OpenUI 组件规范 + 数据源使用指引             │
│  tools:                                                      │
│   ├─ execute_sql / list_tables / describe_table ──► 本地 MCP │──► PostgreSQL (只读守卫)
│   ├─ gitlab_* ──► 外部 GitLab MCP Server                     │──► GitLab 工程数据
│   └─ zentao_* ──► 本地 ZenTao CLI MCP                        │──► 禅道项目/Bug/工时
└──────────────────────────────────────────────────────────────┘
               │ 模型输出 ```openui 代码块
               ▼
        OpenUIRenderer 流式渐进渲染为可交互看板
```

**Workspace 包结构**：能力已抽为三个私有子包——`packages/openui-datasources`（`@openui-analytics/datasources`：数据源配置/连接/工具装配，门面 `createDatasourceManager`）、`packages/openui-llm`（`@openui-analytics/llm`：LLM 编排与提示词资产，门面 `createAnalyzeHandler`，依赖注入数据源单例）与 `packages/openui-components`（`@openui-analytics/components`：OpenUI 规范展示组件库，按 layout/metrics/charts/data/insight/timeline/interaction 分类，聚合为 `analyticsLibrary` 交给 `<Renderer>` 渲染）；应用侧 `src/` 只保留路由薄壳、前端 UI 与共享层。

## 快速开始

```bash
pnpm install
pnpm dev        # http://localhost:3006
```

打开页面后，点击右上角「设置」填入 LLM API Key 即可开始（也可通过环境变量预置）。

### 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `OPENAI_API_KEY` / `LLM_API_KEY` | LLM API Key（也可在页面设置中配置） | 无 |
| `OPENAI_BASE_URL` / `LLM_BASE_URL` | OpenAI 兼容接口地址 | `https://api.openai.com/v1` |
| `OPENAI_MODEL` / `LLM_MODEL` | 模型名 | `gpt-4o-mini` |
| `PGUSER` / `PGHOST` / `PGDATABASE` / `PGPASSWORD` / `PGPORT` | 分析库连接（缺表时自动建表并写入示例数据） | 本机 `openui_analytics` 库 |
| 动态 DB 源（设置中配置） | `dbType` 四选：postgres / mysql / **sqlite** / **clickhouse**。sqlite 连接串为数据库文件路径（可带 `sqlite:` 前缀）；clickhouse 为 `http(s)://[user[:pass]@]host:8123[/database]`。全部只读双保险（词法守卫 + 引擎级只读） | — |
| GitLab MCP Endpoint / Token | 在页面「设置」中配置，存于浏览器 localStorage | `http://127.0.0.1:5002/mcp` |
| `OPENUI_API_AUTH_TOKEN` | 部署模式的 API 鉴权令牌；配置后所有 `/api/*` 请求须携带 `Authorization: Bearer <token>`（页面「设置 → 访问令牌」），未配置则本地免鉴权 | 无 |

禅道数据源依赖本机已登录的 `zentao` CLI（`zentao mcp --read-only`），无需额外配置。

### 自定义分析方法卡

分析方法论库内置 10 张通用方法卡（趋势/帕累托/漏斗/RFM/同期群/异常检测/归因/目标差距/排名/分布）。把自定义卡放入 `data/methodology/*.json`（单卡对象或卡数组，字段见 `MethodCard` 契约）即可扩展或覆盖（同 id 覆盖内置），重启生效；坏文件跳过并告警，不影响启动。

## 活看板（数据刷新）

收藏看板不只是静态快照：生成期捕获的取数查询（`queries`/`bindings`）随收藏落盘，收藏库中的看板可在**预览弹窗一键刷新数据**——服务端按序重放查询并回填组件数值，**全程零 LLM 调用**（不走「重新分析」的整轮模型往返，贵与漂移问题都不存在）。

- **派生变换（transform）**：直取匹配失败的组件，捕获引擎会尝试把「LLM 加工」推测为**确定性变换 spec**（封闭算子：aggregate/groupBy+sum/avg/count/min/max、受限四则派生列、sort、limit），并用查询结果重算与组件实际数据做**一致性验证**——验证通过才绑定落盘（`transforms` 随收藏保存），刷新时服务端重放查询后按 spec 重算回填；验证不过维持纯快照降级（宁缺勿错）
- **可刷新率约束（prompt 层）**：系统提示词强制聚合下推 SQL（GROUP BY/SUM/AVG 在 SQL 内完成）、数据组件赋值命名变量、组件行原样复用查询结果——大多数看板因此直接命中直取绑定
- **入口**：看板预览头部「刷新数据」按钮；刷新中按钮进入 loading 态，成功后组件数值与「数据时间」时间戳同步更新
- **数据时间戳**：预览头部与侧栏收藏列表均展示 `dataUpdatedAt`（最近一次刷新成功时间），数据新鲜度一眼可见
- **旧快照兼容**：v0.1 无 `queries` 字段的静态快照刷新按钮禁用（提示走「重新分析」），永不报错
- **降级语义**：单个查询失败 → 该组件保留旧数据并显示「⚠ N 个组件数据过期」徽标；**全部查询失败**（或数据源不可用）→ 刷新整体失败并给出归一错误提示，原 dsl/时间戳原样保留不落盘；只有全部组件刷新成功才更新 `dataUpdatedAt`
- **安全边界**：`kind:"tool"` 查询在服务端经**只读白名单**复核后才重放（db 读工具 / 读语义工具名 / 禅道只读 action），写语义工具一律拒绝——queries 来自不可信的客户端落盘数据，刷新端点不提供任何写能力
- **实现**：`src/lib/dashboardRefresh.ts` + `POST /api/dashboards/[id]/refresh` + `useDashboards.refreshOne(id)`；sql 查询走只读守卫，tool 查询走只读白名单 + MCP callTool

## 会话存储

会话（消息历史、数据源选择、标题）持久化在**服务端** `data/sessions/`（单会话单 JSON 文件，原子写入），前端不再使用 localStorage 缓存——换浏览器、清缓存会话不丢，多浏览器可见同一份会话。接口：`GET/POST/PUT /api/sessions`（列表摘要 + 活跃指针 / 新建 / 设活跃）与 `GET/PUT/DELETE /api/sessions/:id`（详情含消息全文 / 局部更新 / 删除）。旧版本 localStorage 中的会话会在首次加载时**一次性自动迁移**到服务端（保留标题、消息与时间戳），迁移成功后旧键清除。

### 会话操作：分叉与回滚

- **分叉**：任意消息下方的「分叉」按钮把「到此为止」的对话复制为新会话（继承数据源选择，上下文计量独立），适合从某个中间结论探索不同追问方向，原会话不受影响
- **回滚重问**：用户消息下方的「回滚重问」截断该消息之后的全部对话，消息内容回填输入框供修订后重发；上下文治理的 token 锚点与摘要缓存随之重置

## 上下文治理（投影式压缩）

长会话不会撑爆模型窗口，也不会丢历史——**存储层永远保存完整会话，压缩只作用于「发往模型的投影」**：

- **token 计量**：每次响应的实测 `usage.promptTokens` 回写会话元数据作为锚点；锚点后新增消息用字符启发式估算，误差逐轮自校正
- **触发**：估算 prompt > `min(窗口 × 0.7, 窗口 − maxTokens − 8k)` 时启动（窗口按模型名查表，或由客户端 hint 提供）
- **第一道 tool-result pruning**：保留窗口（窗口 × 25% 的最近消息）以外的工具结果替换为 `[已裁剪: 工具名]` 占位符；用户消息与 PlanReviewCard 天然豁免
- **第二道 LLM 摘要**：pruning 后仍超阈值时，把旧历史压缩为摘要注入 system prompt（同模型、≤2k token 输出），摘要缓存在会话元数据中增量复用
- **用量条**：输入框上方实时显示 `实测 promptTokens / 模型窗口` 百分比（>70% 黄、>90% 红）

## 先出思路（Plan-first，默认开启）

新问题默认先进入规划阶段：AI 只做表结构探查与小样本验证，输出 **PlanReviewCard** 思路确认卡（方法、步骤、数据源、澄清问题）；你确认（或直接回复补充意见）后才产出完整看板。输入框左下角的「先出思路」开关可逐会话关闭，**选择持久化在服务端会话中**——切换会话、换浏览器均保留各自偏好；预设场景为保持一键直达仍直出看板。

## 常用命令

```bash
pnpm dev          # 开发（端口 3006）
pnpm test         # Vitest 单元测试
pnpm run lint     # ESLint
pnpm run typecheck# tsc --noEmit
pnpm run build    # 生产构建
```

## 安全说明

- `execute_sql` 仅允许 `SELECT` / `WITH` 只读查询，禁止多语句与 DDL/DML 关键字，默认追加 `LIMIT 200`；执行层强制只读事务 + 5s `statement_timeout` 作为硬约束。
- 任一 MCP 数据源加载失败时自动降级为空工具集，不会拖垮整个分析请求。
- 凭证边界：客户端在「LLM 设置」中自定义 baseURL 时必须同时提供自己的 apiKey，服务端不会用环境变量中的 Key 去请求客户端指定的 URL（防凭证外泄）。GitLab token 通过自定义请求头传递，不进入 URL。

### 部署注意事项

本项目默认面向本地单机使用。部署到共享环境前请务必：

1. 配置 `OPENUI_API_AUTH_TOKEN` 启用 API 鉴权（见环境变量章节）；
2. 为 PostgreSQL 连接使用**只读角色**（应用层守卫之外的第二道防线）；
3. 限制可访问的 GitLab MCP endpoint 范围（SSRF 面）；
4. `data/` 目录含敏感数据副本：`data/schema-cards/`（表结构/取值分布画像）与 `data/files/`、`data/dashboards/`（数据快照与 DSL）——部署环境请收紧目录权限，并知悉这些文件**不经过任何鉴权**即可被本机进程读取。
