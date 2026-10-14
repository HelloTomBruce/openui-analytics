# 数据源统一化（去 builtin）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 取消内置源概念——PostgreSQL 演示库移除、GitLab 凭证迁服务端、禅道变为 stdio-cli 动态类型，所有数据源同构 CRUD。

**架构：** 配置模型 v3（无 builtin 段，kind = http-mcp | db | stdio-cli，v2 读时迁移种子）；通用加载器补 stdio 分派（SDK StdioClientTransport）；prompt Data Access 段完全由激活源生成；前端三 kind 同构表单。

**技术栈：** 不变（Next 16.4 / AI SDK 4 / MCP SDK / vitest）。

**规格：** `docs/superpowers/specs/2026-10-13-datasource-unification-design.md`（执行者必读）。

## 全局约束

- 每任务完成时 `npm run typecheck`、`npm run lint` 零输出；测试 `npx vitest run <文件>`；全量 `npm test`
- 删除导出前先全仓 grep 消费方，全部随任务迁移（不留死引用）
- `git grep -n "BUILTIN_SOURCE_IDS\|builtin:"` 在任务 1 结束时仅允许命中迁移代码与测试
- 中文 conventional commits；`docs/superpowers/`、`graphify-out/` 不提交
- 凭证（token/connectionString）永不回传明文；stdio 的 command/args 非机密可回传
- StdioClientTransport 导入路径以 `node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js` 实际存在为准（先确认再写）

## 审查重点（Review Focus）

1. **用户现有 v2 配置迁移完整性**：builtin + zhaobiao 的真实配置读入后，zhaobiao 原样保留、zentao-cli 种子存在、postgres 消失、gitlab 仅在 env 有 `GITLAB_MCP_URL` 时种子 → 任务 1 测试
2. **删除 builtin 后的残留引用**：`BUILTIN_SOURCE_IDS` / `builtin:` / `getPostgresAiTools` / `getZentaoAiTools` / `getGitLabAiTools` 等任何残留都会编译红 → 任务 1 以 typecheck 零输出为证据
3. **stdio 探活进程泄漏**：探活握手后必须 close（即使 listTools 失败）→ 任务 1 测试断言 close 被调
4. **stdio 参数空格解析**：表单 "a  b"（多空格）→ args ["a","b"]，空串过滤 → 任务 2 表单测试
5. **前端旧契约残留白屏**：SettingsModal 仍收 gitlab props / UI 读 `source.builtin` 字段 → 任务 2 守护测试 + typecheck

---

### 任务 1：服务端统一化（配置 v3 + stdio + 删内置）

**文件：**
- 修改：`src/mcp/registry.ts`（v3 模型/迁移/探活/resolveActiveSources）、`src/mcp/dynamicSources.ts`（stdio 分派）、`src/mcp/db/dialect.ts`（吸收 SQL 防护）、`src/app/api/datasources/route.ts`（GET 去 gitlab 头）、`src/app/api/datasources/[id]/route.ts`（去特例）、`src/app/api/analyze/route.ts`（全动态装配）、`src/lib/prompt.ts`（必填参数全动态段）、`config/datasources.json`（v3）
- 删除：`src/lib/postgres.ts`、`src/mcp/postgresMcpServer.ts`、`src/mcp/mcpClient.ts`、`src/mcp/zentaoMcpClient.ts` 及各自测试
- 测试：`src/mcp/registry.test.ts`、`src/mcp/dynamicSources.test.ts`、`src/app/api/analyze/route.test.ts`、`src/lib/prompt.test.ts`、`src/app/api/datasources/*` 测试同步改

- [ ] **步骤 1：确认 stdio transport 路径 + grep 消费方**

`ls node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js`；`git grep -ln "@/lib/postgres\|postgresMcpServer\|@/mcp/mcpClient\|zentaoMcpClient" src`（消费方清单进账本）。

- [ ] **步骤 2：编写失败的测试（核心断言）**

```ts
// registry.test.ts「配置模型 v3」
// 迁移：v2 文件（builtin 三源 + sources[zhaobiao]）读入 →
//   sources 深度包含 zhaobiao 原样、{id:"zentao-cli",kind:"stdio-cli",command:"zentao",args:["mcp","--read-only"],enabled:true}；
//   无任何 kind:"postgres"/"gitlab-mcp" 条目（gitlab env 未设）
// gitlab 条件种子：vi.stubEnv("GITLAB_MCP_URL","http://x/mcp") + enabled:true → 种子含 url/token(env GITLAB_TOKEN)
// 校验：stdio-cli {id:"s1",command:"zentao",args:["mcp"],enabled} ok；command 空/args 含非字符串 → ok:false
// 描述符：stdio 源 {kind:"stdio-cli",command:"zentao",tools:[],enabled:true}，无 builtin 字段
// resolveActiveSources(undefined,cfg) → 全部启用源；listDataSources 无 builtin 字段输出
// checkDataSourceHealth：stdio 源 → probeStdioCli 被调（vi.mock ./stdioMcp），close 在失败路径也被调

// dynamicSources.test.ts「stdio 分派」
// getDynamicSourceTools(stdio 源) → StdioClientTransport 以 {command,args} 构造、listTools 映射 <id>_ 前缀工具
// 缓存：同 id 改 args → 旧 client.close 被调

// dialects.test.ts：guardReadOnlySql 从新家导入后既有防护断言不变（迁移守护）

// analyze/route.test.ts：删除 gitlab loader 断言；sources:["zhaobiao"] → 仅 getDynamicSourceTools 被调；
//   body 带 gitlabUrl 字段被忽略不报错；system prompt 含源名不含 "PostgreSQL Analytics Database"（无该源时）

// prompt.test.ts：getOpenUISystemPrompt(必填) — 全动态段含源名与工具；cross_source_link 保留；无参调用为类型错（tsc 担责）

// datasources [id]/route.test.ts：DELETE 任意源 204；PATCH stdio 源 {command} 200；无 405 用例
// route.test.ts：GET 不再读 x-gitlab-* 头（checkDataSourceHealth 不带 gitlab opts）
```

- [ ] **步骤 3：运行验证失败** — `npx vitest run src/mcp src/app/api src/lib/prompt.test.ts`，新用例 FAIL

- [ ] **步骤 4：实现**

- `dialect.ts`：迁入 `assertReadOnlySql` / `enforceRowLimit`（逐字搬移），`guardReadOnlySql` 不变；dialect 两个文件与 dialects.test 改从本地导入
- `registry.ts` v3：`StdioCliSourceConfig`、`DatasourcesConfig{sources}`、`DynamicSourceConfig` 三态联合；`migrateToV3`（v2 builtin 种子规则照规格 §1）；`validateDynamicSourceConfig` 增 stdio 分支（command 非空、args 过滤空串后字符串数组）；`describeDynamicSource` stdio → `{kind:"stdio-cli",command,tools:[]}`；`DataSourceDescriptor` 删 `builtin`；删 `BUILTIN_SOURCES`/`setBuiltinEnabled`/`BUILTIN_SOURCE_IDS`/内置探针；`checkDataSourceHealth` 三分支：http-mcp fetch / db dialect / stdio `probeStdioCli`；`resolveActiveSources` 全动态
- 新 `src/mcp/stdioMcp.ts`：`export async function connectStdioMcp(clientName, command, args): Promise<Client>`（StdioClientTransport）；`export async function probeStdioCli(command, args): Promise<void>`（connect → listTools → close，finally close）
- `dynamicSources.ts`：`buildStdioTools`（configKey 含 command+args；close 走 client.close）
- 删除四个文件与测试；`datasources/route.ts` GET 去 gitlab 头；`[id]/route.ts` 去 BUILTIN 分支（DELETE 统一 204/404；PATCH 统一 merge：name/enabled/url/token/connectionString/command/args）
- `analyze/route.ts`：body 只取 `sources`；装载全走 `getDynamicSourceConfig + getDynamicSourceTools`；summaries 统一；cross_source_link 保留
- `prompt.ts`：参数必填；删 `BUILTIN_SECTION_TEXT`；dataAccessSection 全生成（每源一行：名称/kind/dbType/工具）+ cross-source 段 + 联合分析指引通用化
- `config/datasources.json` 提交迁移后的 v3（zentao-cli 种子 + 用户 zhaobiao）

- [ ] **步骤 5：验证通过** — 新用例 PASS；`git grep -n "BUILTIN_SOURCE_IDS\|getPostgresAiTools\|getZentaoAiTools\|getGitLabAiTools" src` 零命中；`npm run typecheck && npm run lint` 零输出；`npm test` 全绿（前端因 `source.builtin` 残留若有红，属任务 2 范围的用例随本步最小修正断言不修正组件）

- [ ] **步骤 6：Commit** — `git add -A src config && git commit -m "refactor!: 数据源统一化——配置 v3 去 builtin、stdio-cli 动态类型、演示库移除、prompt 全动态"`

---

### 任务 2：前端无内置化

**文件：**
- 修改：`src/components/chat/datasources/DatasourceSettings.tsx`（零 props + 三 kind）、`src/components/chat/datasources/useDatasources.ts`（去 gitlab 头）、`src/components/chat/SettingsModal.tsx`（去 4 props）、`src/hooks/useLlmSettings.ts`（去 GitLab 字段）、`src/components/chat/SourcePicker.tsx`（去 builtin 标注）、`src/components/chat/MessageList.tsx`（徽标纯前缀归因）、`src/components/ChatDashboard.tsx`（去 gitlab 接线）
- 测试：对应 *.test.tsx 同步

- [ ] **步骤 1：编写失败的测试**

```tsx
// DatasourceSettings：渲染无 props；kind 三选（HTTP MCP / 数据库连接 / 本地 CLI）；
//   切本地 CLI → 出现「命令」「参数」输入；提交 POST body {kind:"stdio-cli",command:"zentao",args:["mcp","--read-only"]}
//   参数输入 "mcp  --read-only "（多空格+尾空格）→ args 恰为 ["mcp","--read-only"]
//   stdio 源行徽标「本地 CLI」；编辑 stdio 提交 PATCH 含 command/args
// SettingsModal：渲染不再要求 gitlab props（4 props 删除后既有测试改）
// SourcePicker：无「内置」标注
// MessageList：badge 纯 activeSources 前缀归因 + 通用兜底（删 PostgreSQL MCP/ZenTao/GitLab 固定分支断言）
// ChatDashboard 守护：useChat body 不含 gitlabUrl/gitlabToken
```

- [ ] **步骤 2：验证失败** — `npx vitest run src/components src/hooks`

- [ ] **步骤 3：实现**（照测试；DatasourceSettings 表单 FormState 增 command/args 字段；kindBadge 映射增 stdio-cli）

- [ ] **步骤 4：验证通过 + typecheck/lint + npm test 全绿**

- [ ] **步骤 5：Commit** — `git commit -m "refactor!: 前端数据源同构化——三 kind 表单、去内置行与 GitLab 透传 UI"`

---

### 任务 3：预设清理、文档、回归与冒烟

**文件：**
- 修改：`src/lib/presetQueries.ts`（通用示例）、`src/lib/sessionStorage.ts`（欢迎语）、`src/components/chat/InsightBanner.tsx`（如有演示库表述）、`docs/adding-a-datasource.md`（v3 重写）

- [ ] **步骤 1：编写失败测试** — presetQueries 无 "CAC"/"channel_metrics" 字样、含「数据源」引导；欢迎语含「设置 → 数据源」不含「内置」
- [ ] **步骤 2：验证失败 → 实现 → 验证通过**（InsightBanner 文案人工核对后最小改）
- [ ] **步骤 3：docs v3 重写**（三 kind 配置方式 / v2→v3 迁移说明 / stdio 安全边界）
- [ ] **步骤 4：全量回归** — `npm run typecheck && npm run lint && npm test` 全绿；`graphify update .`
- [ ] **步骤 5：dev 冒烟** — GET 列表（zentao-cli 种子 + zhaobiao，无 postgres）；POST stdio 源（若本机有 zentao CLI 则探活绿，否则红属预期）；PATCH/DELETE 全通；analyze 带 sources 正常装配
- [ ] **步骤 6：Commit** — `git commit -m "docs/chore: 预设与欢迎语去演示依赖，数据源指南 v3"`

---

## 自检记录

- 规格覆盖：§1→T1、§2→T1、§3→T1、§4→T2、§5→T1(prompt)/T3(预设)、§6→T3；遗漏：无
- 审查重点 5 条落在 T1×3 / T2×2 测试步骤
- 类型一致性：`StdioCliSourceConfig`/`DatasourcesConfig{sources}`（T1）→ T2 表单消费；`ActiveSourceSummary.kind` 三态 → prompt/前端徽标；`describeDynamicSource` stdio 分支 → API/UI
- 比例：签名与断言为主，无函数体照抄
