# 数据源统一化（去 builtin）设计规格

日期：2026-10-13 ｜ 状态：已批准（对话中逐节确认）
前置：动态数据源配置（2026-10-13-dynamic-datasources-design.md）已实现

## 目标

取消「内置源」概念：所有数据源（含原 PostgreSQL 演示库、GitLab、禅道）一律为用户动态配置的普通源，配置文件不再有 `builtin` 段。

## 已批准的三项决策

1. **禅道 → 新增动态类型 `stdio-cli`**：用户配 command + args（如 `zentao mcp --read-only`），服务端经 SDK StdioClientTransport 拉起子进程
2. **演示 PostgreSQL → 移除（空配置起步）**：删演示库/自动播种/预设场景的数据依赖；预设与欢迎语改通用表述
3. **GitLab → 凭证迁服务端存储**：作为普通 http-mcp 源；浏览器 localStorage 透传机制删除

## 设计

### 1. 配置模型 v3

```jsonc
{ "sources": [
    { "id": "zentao", "name": "禅道", "kind": "stdio-cli", "command": "zentao", "args": ["mcp", "--read-only"], "enabled": true },
    { "id": "gitlab", "name": "GitLab", "kind": "http-mcp", "url": "...", "token": "", "enabled": true },
    { "id": "zhaobiao", "name": "招标平台数据/", "kind": "db", "dbType": "mysql", "connectionString": "...", "enabled": true }
] }
```

- v2→v3 读时迁移：`builtin.zentao-cli` 启用 → 种子 `{id:"zentao-cli", kind:"stdio-cli", command:"zentao", args:["mcp","--read-only"]}`；`builtin.gitlab-mcp` 启用且 env 有 `GITLAB_MCP_URL` → 种子 http-mcp 源（token 取 `GITLAB_TOKEN||GITLAB_API_KEY`，env 缺 url 则不种）；`builtin.postgres` → 丢弃；既有 `sources[]` 原样保留
- kind：`http-mcp | db | stdio-cli`；stdio-cli 校验：command 非空字符串、args 为字符串数组（可省）
- 描述符删除 `builtin` 字段与内置 kind；全部源同构（可增删改启停，DELETE 无 405 特例）

### 2. 删除清单

- `src/lib/postgres.ts`：pool / initDatabase 播种 / executeReadOnlySql —— `assertReadOnlySql` 与 `enforceRowLimit` 迁至 `src/mcp/db/dialect.ts`（方言共享防护）
- `src/mcp/postgresMcpServer.ts`、`src/mcp/mcpClient.ts`、`src/mcp/zentaoMcpClient.ts` 整删（通用能力已在 httpMcp/dynamicSources/dbMcpServer）
- registry：`BUILTIN_SOURCES`、三类内置探针、`BUILTIN_SOURCE_IDS`；GET 路由 `x-gitlab-*` 头透传；analyze body 的 gitlabUrl/gitlabToken 字段；`useLlmSettings` 的 GitLab localStorage 字段

### 3. stdio-cli 加载与探活

- `dynamicSources` 增加 stdio 分派：`StdioClientTransport({command, args})`（SDK `client/stdio.js`）→ listTools → `<id>_` 前缀挂载；缓存键 = JSON([command, args])，配置变更重建
- 探活 = 真实握手：spawn → initialize → close，3s 超时
- 安全：命令执行配置与 DB 连接串同级信任（单租户自部署 + Bearer），规格与文档明示

### 4. UI

- 「添加数据源」kind 三选（HTTP MCP / 数据库连接 / 本地 CLI）；本地 CLI 表单 = 命令 + 空格分隔参数；徽标含「本地 CLI」
- DatasourceSettings 零 props 自包含；删除内置行、GitLab 行内展开、启停/删除特例；SourcePicker 去「内置」标注；MessageList 徽标统一 `<id>_` 前缀归因（删固定三源分支）

### 5. prompt 全动态

- `getOpenUISystemPrompt(activeSources)` 参数必填；「Data Access」段完全由激活源生成（名称/kind/dbType/工具清单）
- `cross_source_link` 工具保留常挂；联合分析指引改通用表述（映射语义不变）

### 6. 演示依赖清理

- `presetQueries` 预设改通用示例；`DEFAULT_WELCOME_MESSAGE` 与 InsightBanner 去演示库表述，引导「设置 → 数据源」

## 明确不做

- stdio 源的命令白名单/沙箱（信任模型同 DB 连接串）
- 旧 localStorage GitLab 凭证向服务端的自动迁移（env 种子除外）
- 演示数据集的任何保留形式
