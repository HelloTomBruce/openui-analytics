# 接入新数据源

所有数据源均为用户动态配置（config/datasources.json v3），三种类型同构支持增删改启停；每个会话可通过输入框上方「数据源」选择器勾选本会话可用子集（随请求体传给 /api/analyze 按需装配工具，工具名带 `<id>_` 前缀隔离）。

## 类型

- **HTTP MCP**：`{ id, name, kind: "http-mcp", url, token?, enabled }`，工具经 listTools 自动发现
- **数据库**：`{ id, name, kind: "db", dbType: "postgres"|"mysql", connectionString, enabled }`，工具契约 `execute_sql / list_tables / describe_table`，强制只读（黑名单+行数封顶+只读事务+5s 超时）
- **本地 CLI**：`{ id, name, kind: "stdio-cli", command, args?, enabled }`（如 `zentao mcp --read-only`），服务端拉起子进程完成 MCP 握手

## 三种配置方式

1. **设置界面**（推荐）：设置 →「数据源」→ 添加数据源（三选类型）；凭证只提交一次，回显仅脱敏形态
2. **管理 API**：`POST/GET /api/datasources`、`PATCH/DELETE /api/datasources/:id`（配置 `OPENUI_API_AUTH_TOKEN` 后需 Bearer 头）
3. **直接改 JSON**：改完重启；id 规则 `^[a-z][a-z0-9-]{0,31}$`

## v2 → v3 迁移（读时自动）

- `builtin.zentao-cli` 启用 → 自动种子 stdio-cli 源
- `builtin.gitlab-mcp` 启用且 env 有 `GITLAB_MCP_URL` → 种子 http-mcp 源
- `builtin.postgres`（演示库）→ 移除；其余 `sources[]` 原样保留

## 扩展数据库类型

新增 `packages/openui-datasources/src/connectors/db/xxxDialect.ts` 实现 `DbDialect` 接口 → 在 `DIALECTS` 注册表登记 → 包 `validateSourceConfig` 校验白名单与前端下拉同步。数据源配置/连接/请求已封装在 workspace 包 `packages/openui-datasources/`（门面 `createDatasourceManager`，统一入口 `@openui-analytics/datasources`）。

## 安全边界

- DB 源强制只读；stdio 命令执行与 DB 连接串同级信任（单租户自部署 + Bearer），建议收窄 `config/datasources.json` 文件权限
- GET 永不回传明文凭证；stdio 的 command/args 非机密可回传
