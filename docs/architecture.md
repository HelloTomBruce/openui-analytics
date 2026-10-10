# 架构文档

## 主链路

```text
用户输入 ─► ChatDashboard(useChat) ─► POST /api/analyze ─► streamText(LLM)
                                                        │
              ┌─────────────────────────────────────────┤
              ▼              ▼                          ▼
        PostgreSQL MCP   GitLab MCP              ZenTao CLI MCP
        (本地, 只读)      (外部 HTTP)             (本机 zentao CLI)
              │              │                          │
              └──────────────┴──────────┬───────────────┘
                                        ▼
              模型合成分析 + 输出 ```openui 代码块
                                        ▼
              OpenUIRenderer 流式渐进渲染（SafeErrorBoundary 兜底）
```

## Data Stream Protocol v1

`/api/analyze` 返回 `x-vercel-ai-data-stream: v1` 的文本流，前端由 `useChat`（@ai-sdk/react）消费。帧格式：

| 前缀 | 含义 | 本项目中的使用 |
| --- | --- | ---------------- |
| `0:<json-string>` | 文本增量 | 正文与 ```openui 代码块 |
| `3:<json-string>` | 错误消息 | 路由级异常降级（不返回 500，错误随流下发） |
| `d:{...}` | 流结束 + usage | 未配置 API Key 时的合规降级响应 |

注意：路由的 catch 分支同样返回 200 + `3:` 帧，**不要用 HTTP 状态码判断失败**。

## MCP 工具注册链路

`route.ts` 中 `streamText({ tools })` 的工具来源：

1. **内置三件套**（`execute_sql` / `list_tables` / `describe_table`）：AI SDK `tool()` 包装，execute 内调用 `callMcpTool()`（`src/mcp/mcpClient.ts`）转发到本地 PostgreSQL MCP server（`src/mcp/postgresMcpServer.ts`）。
2. **gitlab_\***：`getGitLabAiTools(url, token)` 连接外部 MCP server，用 `tool()` 逐个包装其 listTools 结果。
3. **zentao_\***：`getZentaoAiTools()` 通过 stdio 拉起 `zentao mcp --read-only`，同样包装为 AI SDK 工具。

**降级语义**：三路工具用 `Promise.allSettled` 加载，单源失败降级为空工具集并 `console.warn`，请求继续。

## 只读 SQL 守卫

`src/lib/postgres.ts` 的 `assertReadOnlySql(sql)`：

1. 去除尾部分号后，**禁止任何残留分号**（防多语句注入）；
2. 必须以 `SELECT` / `WITH` 开头（前导空白、注释均无法绕过，因为 `startsWith` 校验的是 trim 后的完整串）；
3. 关键字黑名单：`drop/delete/update/insert/alter/truncate/create/grant/revoke/exec/execute/call/copy`；
4. 无 `LIMIT` 时自动追加 `LIMIT 200`。

## OpenUI 组件清单

模型通过 system prompt（`src/lib/prompt.ts`）获得以下声明式组件，前端在 `src/components/analytics/` 实现：

| 组件 | 用途 |
| --- | --- |
| MetricCard / MetricGrid | KPI 指标卡与 2-4 列网格容器 |
| AnalyticsChart | Bar / Line / Area / Pie 图表（Recharts） |
| DataTable | 可搜索/排序/导出的明细表 |
| InsightBox | tip / info / warning / success 提示框 |
| AnalyticsFilterBar | 交互式钻取/重查询表单 |
| FunnelChart | 转化漏斗 / 需求生命周期漏斗 |
| GaugeProgress | 目标达成度进度条 |
| ActionPlanCard | 行动建议清单（含优先级徽章） |
| ActivityTimeline | 事件/commit/MR/里程碑时间线 |
| RadarChart | 多维能力/负载评估雷达图 |
| ContributionHeatmap | 提交/任务密度热力图 |
| ReactiveSimulator | 本地毫秒级响应式预算模拟器 |
| ActionButton | 可触发的客户端动作按钮 |

## 前端组件结构

```text
ChatDashboard.tsx            组合层（唯一接线点，useChat 在此）
├─ hooks/useLlmSettings      LLM/GitLab 配置状态 + localStorage 持久化
├─ hooks/useSessionManager   会话 CRUD（setMessages 经 ref 延迟注入，见 hook 注释）
└─ components/chat/
   ├─ ChatSidebar            历史/预设 Tab、搜索、底部状态栏
   ├─ SessionListItem        会话项（重命名/删除悬浮操作）
   ├─ MessageList            消息流、工具调用指示器、openui 提取与渲染
   ├─ ChatInput              底部输入框
   ├─ SettingsModal          LLM 设置模态框
   └─ DevToolsPanel          OpenUI AST 实时调试沙箱
```
