# 接入新数据源

OpenUI Analytics 的数据源分为「内置源」（PostgreSQL / GitLab / ZenTao）与「扩展源」。扩展有两条路径，按需求选择：

## 路径一：声明式（HTTP MCP，零代码）

适用于已有运行中的 HTTP MCP Server（如 Jira MCP、企业内部数据网关）。

1. 编辑 `config/datasources.json`：

```json
{
  "sources": [
    {
      "id": "jira-mcp",
      "name": "Jira MCP (外部)",
      "kind": "http-mcp",
      "url": "http://127.0.0.1:6000/mcp",
      "tools": ["jira_*"]
    }
  ]
}
```

2. 重启服务。新数据源会出现在设置页的「数据源状态」面板中（健康检查为 URL 可达性探测）。

3. **注意**：声明式注册只让数据源「可见可探活」。要让 LLM 真正调用其工具，目前仍需在 `src/app/api/analyze/route.ts` 中合并工具（见路径二的步骤 3），并参考路径二在 prompt 中登记。

> 后续迭代方向：声明式源的工具自动挂载（连接 url → listTools → 注册），当前版本未实现。

## 路径二：命令式（本地 CLI / SDK，约 30 行）

适用于需要自定义认证、stdio 拉起本地进程（如 `zentao mcp --read-only`）、或结果需要预处理的场景。

以 Jira 为例：

1. **复制模板**：`src/mcp/templateMcpClient.ts.example` → `src/mcp/jiraMcpClient.ts`，实现 `getJiraAiTools()`（模板内是完整可用的 HTTP MCP 实现，改名字与 endpoint 即可）。

2. **在 route.ts 注册**（`src/app/api/analyze/route.ts`）：

```typescript
const [gitlabResult, zentaoResult, jiraResult] = await Promise.allSettled([
  getGitLabAiTools(clientGitLabUrl, clientGitLabToken),
  getZentaoAiTools(),
  getJiraAiTools(),
]);
// ...jiraTools 合并进 tools，失败降级为空对象
```

3. **在 prompt 登记**（`src/lib/prompt.ts` 的 Data Access 章节），描述 `jira_*` 工具族的用途，模型才会主动调用。

## 示例：MySQL 数据源

MySQL 没有现成 MCP server 时，最简单的办法是复用 PostgreSQL 的模式：

1. 参考 `src/lib/postgres.ts` 写一个 `mysql.ts`（`mysql2` 驱动 + 同款 `assertReadOnlySql` 只读守卫）。
2. 参考 `src/mcp/postgresMcpServer.ts` 包一层 MCP server 并在 `route.ts` 注册 `execute_mysql` 工具。
3. 在 `src/mcp/registry.ts` 的 `BUILTIN_SOURCES` 中登记（或在 datasources.json 声明）。

## 检查清单

- [ ] 工具加载失败时返回空工具集（`Promise.allSettled` 降级语义）
- [ ] prompt 的 Data Access 章节已登记新工具族
- [ ] 注册表（registry）中可见并有健康探针
- [ ] 只读约束：任何 SQL 类工具必须经过只读守卫
