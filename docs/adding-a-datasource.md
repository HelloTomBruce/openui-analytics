# 接入新数据源

OpenUI Analytics 的数据源分「内置源」与「动态源」，均支持全局启停；每个会话可再从中勾选本会话可用的子集（输入框上方「数据源」选择器，`ChatSession.enabledSources`，随请求体传给 `/api/analyze` 按需装配工具）。

## 方式一：设置界面（推荐）

设置 →「数据源」tab：

1. **内置源**（PostgreSQL / GitLab MCP / ZenTao CLI）：行内启停开关；GitLab 行可展开配置 Endpoint / Private Token（存于浏览器 localStorage，随请求头透传，不落服务端）。
2. **添加动态源**：
   - **HTTP MCP**：填 `ID`、名称、`URL`（如 `http://127.0.0.1:6000/mcp`）、可选 Bearer Token。工具在连接时经 `listTools` 自动发现挂载。
   - **数据库连接**：选数据库类型（PostgreSQL / MySQL）+ 连接串（如 `mysql://user:pass@host:3306/db`）。工具契约为 `execute_sql` / `list_tables` / `describe_table`。
3. 凭证只在创建/更新时提交一次，后续 GET 只返回 `hasToken` 与脱敏连接串，**永不回传明文**。

## 方式二：管理 API

所有 `/api/*` 在服务端配置 `OPENUI_API_AUTH_TOKEN` 时需 `Authorization: Bearer <token>`：

```bash
# 新增
curl -X POST http://localhost:3006/api/datasources \
  -H 'Content-Type: application/json' \
  -d '{"id":"jira-mcp","name":"Jira MCP","kind":"http-mcp","url":"http://127.0.0.1:6000/mcp","token":"xxx"}'

# 启停（内置源仅接受 enabled）
curl -X PATCH http://localhost:3006/api/datasources/jira-mcp \
  -H 'Content-Type: application/json' -d '{"enabled":false}'

# 删除（动态源；内置源返回 405）
curl -X DELETE http://localhost:3006/api/datasources/jira-mcp

# 列表 + 探活（含脱敏描述符）
curl http://localhost:3006/api/datasources
```

## 方式三：直接改配置文件（改完重启）

`config/datasources.json`（v2 schema，原子写由系统保证；手改时请保持 JSON 合法）：

```json
{
  "builtin": {
    "postgres": { "enabled": true },
    "gitlab-mcp": { "enabled": true },
    "zentao-cli": { "enabled": true }
  },
  "sources": [
    { "id": "jira-mcp", "name": "Jira MCP", "kind": "http-mcp",
      "url": "http://127.0.0.1:6000/mcp", "token": "", "enabled": true },
    { "id": "mysql-orders", "name": "订单库", "kind": "db",
      "dbType": "mysql", "connectionString": "mysql://u:p@h:3306/db", "enabled": true }
  ]
}
```

- id 规则：`^[a-z][a-z0-9-]{0,31}$`，不得与内置 id（`postgres` / `gitlab-mcp` / `zentao-cli`）冲突。
- 旧版 v1 格式（无 `builtin`、源无 `enabled`）读入时自动迁移，无需手工转换。

## 扩展新的数据库类型（方言）

数据库源经进程内方言适配器挂载（`src/mcp/db/`），扩展步骤：

1. 新建 `src/mcp/db/xxxDialect.ts`，实现 `DbDialect` 接口（`connect` / `listTables` / `describeTable` / `readOnlyQuery` / `ping`），驱动惰性 import，缺依赖时给出安装提示。
2. 在 `src/mcp/db/dialect.ts` 的 `DIALECTS` 注册表登记。
3. 在 `src/mcp/registry.ts` 的 `dbType` 校验白名单加入新类型，前端下拉（`DatasourceSettings.tsx`）同步选项。

## 安全边界

- **数据库源强制只读**：词法黑名单（单语句、仅 SELECT/WITH、危险关键字）+ 行数封顶（200）+ 只读事务 + 5s 超时，双数据库一致（`assertReadOnlySql` 复用）。
- **配置文件含明文凭证**（token / 连接串）：与 env、`config/cross-source-map.json` 同级信任模型，单租户自部署；建议对 `config/datasources.json` 收窄文件权限。
- **URL 不做内网黑名单**：本地 MCP（127.0.0.1）是核心场景，依赖部署层访问控制（Bearer / 网络隔离）保护。
- **GET 永不回传明文凭证**；写 API 全部经 middleware Bearer 鉴权。
