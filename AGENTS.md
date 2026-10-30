<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 产品文档先行（DocMind 契约）

本项目的产品文档维护在 **DocMind MCP** 的 `openui-analytics` 项目（本地目录 `/Users/zhangbei/code/prd/openui-analytics`）。它是所有迭代与修改的基石：**先更新文档，再改代码；文档与代码必须保持一致**。

### 强制工作流（任何代码修改前必须执行）

1. **定位节点**：按下方映射表找到受影响的 DocMind 节点；不确定时用 `DocMind_search_requirements("关键词")` 全局搜索。
2. **先更新文档**：把目标行为/新需求写入对应节点（`DocMind_update_node`）；新增功能先 `DocMind_add_node` 建节点再写需求。
3. **标记状态**：文档定稿待实现 → 节点状态置 `todo`；开始编码 → 置 `in_progress`。
4. **再改代码**：严格按更新后的文档实现。
5. **收尾**：测试通过后将节点置 `done`，并运行 `graphify update .` 同步知识图谱。删除/废弃功能时同步更新或删除对应节点（`DocMind_delete_node`）。

**禁止**：只改代码不更新文档；节点内容仍是旧行为描述时就宣称任务完成。

### 节点 ↔ 代码映射

| 代码位置 | DocMind 节点 |
| --- | --- |
| `packages/openui-components/src/**` | 看板组件库规范 |
| `packages/openui-datasources/src/**` | 动态数据源管理；新增内置数据源 → 数据源体系 下对应子节点 |
| `packages/openui-datasources/src/schema/**` | 数据源接入强化（P1-A Schema Card） |
| `packages/openui-llm/src/**` | 对话式分析与看板生成（编排与提示词） |
| `packages/openui-llm/src/methodology/**` | 个性化场景分析（P1 方法论库） |
| `src/app/api/analyze/**` | API 接口（/api/analyze 段） |
| `src/app/api/datasources/**` | API 接口 + 数据源管理 |
| `src/app/api/dashboards/**` | 看板留存与分享（收藏夹与快照） |
| `src/components/chat/**`、`src/hooks/**` | 功能模块 下对应子节点 |
| `src/lib/dashboardStore.ts` | 看板留存与分享（收藏夹与快照） |
| `src/lib/presetQueries.ts` | 核心用户流程（预设场景段）、DevTools 调试面板 |
| 环境变量 / 鉴权 / 部署配置 | 安全与部署 |

一次改动横跨多个节点时，全部更新后再动代码。
