/**
 * 活看板刷新引擎（P2-A 第二步）：查询重放 + 数据回填，全程零 LLM 调用。
 *
 * server-only：经 datasource 网关连接源重放（sqlGuard 只读守卫 + dbMcpServer
 * 引擎级只读/超时/行数封顶自动继承）；DSL 解析/序列化用 serverLibrary（与
 * prompt schema 同源），保证回填后的 dsl 仍可被前端渲染器解析。
 *
 * 网关注入（RefreshGateway）使重放逻辑可单测；应用侧路由传 datasources 单例。
 * 设计见 DocMind「看板留存与分享」M3b 段。
 */
import type {
  DynamicSourceConfig,
  McpConnection,
} from "@openui-analytics/datasources";
import { assertReadOnlySql } from "@openui-analytics/datasources/sqlGuard";
import { parseMcpToolResult } from "@openui-analytics/datasources/parseToolResult";
import { createParser } from "@openuidev/react-lang";
import {
  jsonToOpenUI,
  serverLibrary,
} from "@openui-analytics/llm/serverLibrary";
import { extractQueryRows, rowPropFor } from "./dashboardCapture";
import type { DashboardRecord, DashboardQuery } from "./dashboardStore";

/** 数据源网关（datasource manager 的结构子集，便于测试注入） */
export interface RefreshGateway {
  get(id: string): DynamicSourceConfig | undefined;
  connect(source: DynamicSourceConfig): Promise<McpConnection>;
}

export type RefreshVerdict =
  | { ok: true; dsl: string; stale: string[] }
  | {
      ok: false;
      reason: "readonly" | "dsl-invalid" | "replay-failed";
      error: string;
    }
  | {
      ok: false;
      reason: "source-unavailable";
      error: string;
      sourceId: string;
    };

/** 解析器单例：schema 与 prompt/前端渲染器同源 */
const parser = createParser(serverLibrary.toJSONSchema(), "Root");

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 服务端只读重放白名单（安全边界）：queries 落盘自不可信的客户端工具调用记录，
 * 重放前必须在服务端复核「该工具确实是只读的」，否则刷新端点会退化为
 * 零 LLM 的写操作原语（被篡改的落盘记录可直接触发任意工具调用）。
 * - db 类网关读工具：天然只读
 * - 读语义工具名（get/list/search/... 前缀）：GitLab 等 http-mcp 的只读面
 * - 禅道 CLI 工具（zentao_*）：工具本身带写动作，按 args.action 放行只读动作
 * 未命中白名单 → 该查询拒绝重放（组件 stale），并留告警日志。
 */
const READONLY_GATEWAY_TOOLS = new Set(["execute_sql", "list_tables", "describe_table"]);
const READONLY_TOOL_PREFIX =
  /^(get|list|search|describe|my|read|fetch|find|diff|blame|health|help|version|whoami|mr_discussions)/;
const READONLY_ZENTAO_ACTIONS = new Set(["list", "get", "modules", "search", "profile"]);
const READONLY_ZENTAO_TOOLS = new Set(["zentao_my", "zentao_profile"]);

function isReplayableTool(tool: string, args: Record<string, unknown>): boolean {
  if (READONLY_GATEWAY_TOOLS.has(tool)) return true;
  if (tool.startsWith("zentao_")) {
    if (READONLY_ZENTAO_TOOLS.has(tool)) return true;
    const action = args.action;
    return typeof action === "string" && READONLY_ZENTAO_ACTIONS.has(action);
  }
  return READONLY_TOOL_PREFIX.test(tool);
}

/**
 * 单查询重放：成功返回行数组，失败返回 null（调用方按 stale 降级）。
 * - kind=sql：词法守卫快失败 + dbMcpServer execute_sql（只读事务/超时/行封顶）
 * - kind=tool：payload {tool,args} JSON → 只读白名单复核 → 同源连接 callTool
 * 失败不静默：服务端 console.warn 留痕（基础设施故障与「无数据」必须可区分）。
 */
async function replayQuery(
  query: DashboardQuery,
  conn: McpConnection
): Promise<Record<string, unknown>[] | null> {
  try {
    if (query.kind === "sql") {
      assertReadOnlySql(query.payload);
      const res = await conn.callTool("execute_sql", { sql: query.payload });
      return extractQueryRows(parseMcpToolResult(res, `刷新重放 ${query.id}`));
    }
    const parsed: unknown = JSON.parse(query.payload);
    if (
      !isPlainObject(parsed) ||
      typeof parsed.tool !== "string" ||
      !parsed.tool
    ) {
      console.warn(`[dashboardRefresh] 查询 ${query.id} payload 非法，跳过重放`);
      return null;
    }
    const args = isPlainObject(parsed.args) ? parsed.args : {};
    // 只读白名单复核：未命中 → 拒绝重放（不触达源），组件按 stale 降级
    if (!isReplayableTool(parsed.tool, args)) {
      console.warn(
        `[dashboardRefresh] 查询 ${query.id} 工具 "${parsed.tool}" 不在只读白名单，拒绝重放`
      );
      return null;
    }
    const res = await conn.callTool(parsed.tool, args);
    return extractQueryRows(parseMcpToolResult(res, `刷新重放 ${query.id}`));
  } catch (err: unknown) {
    console.warn(
      `[dashboardRefresh] 查询 ${query.id} 重放失败:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

interface ElementLike {
  type?: unknown;
  statementId?: unknown;
  typeName?: unknown;
  props?: unknown;
}

/** 递归遍历元素树，按 bindings 回填行数组；返回仍过期（未刷新成功）的组件 */
function backfillElements(
  root: unknown,
  bindings: Record<string, string>,
  rowsByQueryId: Map<string, Record<string, unknown>[] | null>
): string[] {
  const stale: string[] = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const node = value as ElementLike;
    if (node.type === "element") {
      const statementId =
        typeof node.statementId === "string" ? node.statementId : undefined;
      if (statementId && Object.prototype.hasOwnProperty.call(bindings, statementId)) {
        const queryId = bindings[statementId];
        const rows = rowsByQueryId.get(queryId);
        const prop =
          typeof node.typeName === "string" ? rowPropFor(node.typeName) : undefined;
        if (
          rows &&
          prop &&
          isPlainObject(node.props) &&
          Array.isArray(node.props[prop])
        ) {
          node.props[prop] = rows;
        } else {
          // 查询重放失败 / 组件类型不持行数组 / prop 形态异常 → 该组件保留旧数据
          stale.push(statementId);
        }
      }
    }
    // 深入 props 与数组容器寻找子组件节点
    if (isPlainObject(node.props)) {
      for (const v of Object.values(node.props)) walk(v);
    } else if (Array.isArray(value)) {
      for (const v of value) walk(v);
    }
  };
  walk(root);
  return stale;
}

/**
 * 刷新主入口：重放 record.queries → 回填 dsl 组件 → 序列化新 dsl。
 * - record 无 queries（v0.1 旧快照）→ readonly
 * - 源不存在/停用/连接失败 → source-unavailable（整体失败，调用方附重新分析引导）
 * - 单查询失败仅影响其绑定组件（stale），其余组件正常刷新
 */
export async function refreshDashboard(
  record: DashboardRecord,
  gateway: RefreshGateway
): Promise<RefreshVerdict> {
  const queries = record.queries;
  if (!queries || queries.length === 0) {
    return {
      ok: false,
      reason: "readonly",
      error: "该看板为静态快照（无查询绑定），不支持数据刷新；可基于原提问重新分析生成可刷新看板",
    };
  }

  // 源预检：任一查询的源缺失/停用 → 整体失败（不做部分刷新的半吊子状态）
  const sourceIds = [...new Set(queries.map((q) => q.sourceId))];
  for (const sourceId of sourceIds) {
    const conf = gateway.get(sourceId);
    if (!conf || conf.enabled === false) {
      return {
        ok: false,
        reason: "source-unavailable",
        error: `数据源不可用: ${sourceId}（不存在或已停用）；建议基于原提问重新分析`,
        sourceId,
      };
    }
  }

  // 按源分组重放：同源共用一条连接；连接失败 = 源不可用（整体失败）
  const rowsByQueryId = new Map<string, Record<string, unknown>[] | null>();
  const connections = new Map<string, McpConnection>();
  try {
    for (const sourceId of sourceIds) {
      const conf = gateway.get(sourceId) as DynamicSourceConfig;
      let conn: McpConnection;
      try {
        conn = await gateway.connect(conf);
      } catch {
        return {
          ok: false,
          reason: "source-unavailable",
          error: `数据源连接失败: ${sourceId}；建议基于原提问重新分析`,
          sourceId,
        };
      }
      connections.set(sourceId, conn);
    }
    for (const query of queries) {
      const conn = connections.get(query.sourceId) as McpConnection;
      rowsByQueryId.set(query.id, await replayQuery(query, conn));
    }
  } finally {
    // 刷新用连接来自 manager 缓存（getOrConnectEntry 语义），生命周期归 manager
    // 管理，这里不主动 close——避免打断其他并发使用者
  }

  // 全部查询重放失败：无任何新数据可回填，落盘只会带来无意义的 DSL 重写
  // （解析/序列化归一可能静默改动字节）→ 整体失败，保留原记录不动
  const allFailed = queries.every((q) => rowsByQueryId.get(q.id) === null);
  if (allFailed) {
    return {
      ok: false,
      reason: "replay-failed",
      error: "全部取数查询重放失败（源异常或查询已失效），看板数据保持原样；建议基于原提问重新分析",
    };
  }

  // 回填：解析 → 按 bindings 替换行数组 → 重序列化
  let parsed: ReturnType<typeof parser.parse>;
  try {
    parsed = parser.parse(record.dsl);
  } catch {
    return {
      ok: false,
      reason: "dsl-invalid",
      error: "看板 DSL 解析失败，无法回填数据；建议重新分析",
    };
  }
  if (!parsed.root) {
    return {
      ok: false,
      reason: "dsl-invalid",
      error: "看板 DSL 解析失败，无法回填数据；建议重新分析",
    };
  }

  const stale = backfillElements(parsed.root, record.bindings ?? {}, rowsByQueryId);
  let dsl: string;
  try {
    dsl = jsonToOpenUI(parsed.root, serverLibrary);
  } catch {
    return {
      ok: false,
      reason: "dsl-invalid",
      error: "看板 DSL 序列化失败，无法回填数据；建议重新分析",
    };
  }

  return { ok: true, dsl, stale };
}
