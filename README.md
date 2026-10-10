# OpenUI Analytics

对话式生成 UI 数据分析看板：用自然语言提问，由 LLM 编排 **PostgreSQL / GitLab / 禅道（ZenTao）** 三路 MCP 数据源取数，流式生成 **OpenUI Lang** 声明式看板（KPI 卡、漏斗、热力图、雷达图、预算模拟器等）并实时渲染。

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

详细设计见 [docs/architecture.md](docs/architecture.md)。

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
| GitLab MCP Endpoint / Token | 在页面「设置」中配置，存于浏览器 localStorage | `http://127.0.0.1:5002/mcp` |

禅道数据源依赖本机已登录的 `zentao` CLI（`zentao mcp --read-only`），无需额外配置。

## 常用命令

```bash
pnpm dev          # 开发（端口 3006）
pnpm test         # Vitest 单元测试
pnpm run lint     # ESLint
pnpm run typecheck# tsc --noEmit
pnpm run build    # 生产构建
```

## 安全说明

- `execute_sql` 仅允许 `SELECT` / `WITH` 只读查询，禁止多语句与 DDL/DML 关键字，默认追加 `LIMIT 200`。
- 任一 MCP 数据源加载失败时自动降级为空工具集，不会拖垮整个分析请求。
