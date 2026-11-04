// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { refreshDashboard, type RefreshGateway } from "./dashboardRefresh";
import { createParser } from "@openuidev/react-lang";
import { serverLibrary } from "@openui-analytics/llm/serverLibrary";
import type { DashboardRecord } from "./dashboardStore";
import type { DynamicSourceConfig, McpConnection } from "@openui-analytics/datasources";

/**
 * 活看板刷新引擎测试：SQL/工具重放、数据回填、降级语义（单查询 stale /
 * 源不可用整体失败 / 旧快照只读 / 非只读 SQL 拒绝 / 零 LLM 断言）。
 */

const parser = createParser(serverLibrary.toJSONSchema(), "Root");

function seedRecord(overrides: Partial<DashboardRecord>): DashboardRecord {
  return {
    id: "dash_ab12cd34",
    title: "渠道看板",
    dsl: [
      'root = Root([chart, table])',
      'chart = AnalyticsChart("bar", "t", "s", "channel", [{"channel":"A","deals":1},{"channel":"B","deals":2}], [])',
      'table = DataTable("明细", [], [{"channel":"A","deals":1},{"channel":"B","deals":2}])',
    ].join("\n"),
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

const QUERY_SQL = {
  id: "q_00af5f39",
  sourceId: "pg1",
  kind: "sql" as const,
  payload: "SELECT channel, deals FROM deals",
};

/** MCP callTool 结果信封：真实通道（dbMcpServer/远程 MCP）返回 content text JSON */
function mcpResult(payload: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

type CallToolFn = (name: string, args: Record<string, unknown>) => Promise<unknown>;
type CallToolMock = ReturnType<typeof vi.fn<CallToolFn>>;

function makeGateway(opts: {
  sources?: string[];
  callTool?: CallToolFn;
  connectError?: boolean;
}): RefreshGateway & { callToolMock: CallToolMock } {
  const impl: CallToolFn =
    opts.callTool ??
    (async () =>
      mcpResult({
        rows: [
          { channel: "A", deals: 11 },
          { channel: "B", deals: 22 },
        ],
      }));
  const callToolMock = vi.fn(impl);
  const source = (id: string): DynamicSourceConfig => ({
    id,
    name: id,
    kind: "db",
    dbType: "postgres",
    connectionString: "postgres://localhost/x",
    enabled: true,
  });
  const sources = new Set(opts.sources ?? ["pg1"]);
  return {
    callToolMock,
    get: (id: string) => (sources.has(id) ? source(id) : undefined),
    connect: opts.connectError
      ? vi.fn(async () => {
          throw new Error("connection refused");
        })
      : vi.fn(async (): Promise<McpConnection> => ({
          callTool: callToolMock,
          listTools: async () => [],
          close: async () => {},
        })),
  };
}

async function parseDataAt(dsl: string, statementId: string): Promise<unknown[]> {
  const result = parser.parse(dsl);
  const found: unknown[] = [];
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const node = value as { type?: unknown; statementId?: unknown; props?: unknown };
    if (node.type === "element" && node.statementId === statementId && node.props) {
      found.push((node.props as Record<string, unknown>).data);
    }
    for (const v of Object.values((node.props ?? {}) as Record<string, unknown>)) walk(v);
    if (Array.isArray(value)) for (const v of value) walk(v);
  };
  walk(result.root);
  return found[0] as unknown[];
}

describe("refreshDashboard 刷新成功", () => {
  it("SQL 重放成功：绑定组件数据回填新值，stale 为空，全程仅 get/connect/callTool（零 LLM）", async () => {
    const gateway = makeGateway({});
    const record = seedRecord({
      queries: [QUERY_SQL],
      bindings: { chart: QUERY_SQL.id, table: QUERY_SQL.id },
    });

    const verdict = await refreshDashboard(record, gateway);

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.stale).toEqual([]);
    // 新数据已写入组件
    expect(await parseDataAt(verdict.dsl, "chart")).toEqual([
      { channel: "A", deals: 11 },
      { channel: "B", deals: 22 },
    ]);
    expect(await parseDataAt(verdict.dsl, "table")).toEqual([
      { channel: "A", deals: 11 },
      { channel: "B", deals: 22 },
    ]);
    // 零 LLM 断言：网关交互只有源管理通道（get/connect/callTool），无 analyze 类调用
    expect(gateway.connect).toHaveBeenCalledTimes(1);
    expect(gateway.callToolMock).toHaveBeenCalledWith("execute_sql", {
      sql: QUERY_SQL.payload,
    });
    const allCalls = gateway.callToolMock.mock.calls.map((c) => c[0]);
    expect(allCalls.every((name) => typeof name === "string" && !name.includes("analyze"))).toBe(true);
    // 序列化产物可重新解析
    expect(parser.parse(verdict.dsl).meta.errors).toEqual([]);
  });

  it("transform 绑定：重放明细后按 spec 重算（聚合+派生列）再回填", async () => {
    // 网关返回月度明细；组件绑定了 channel 粒度聚合 + cac=spend/leads 的变换
    const gateway = makeGateway({
      callTool: async () =>
        mcpResult({
          rows: [
            { channel: "TikTok", month: "11", spend: 2000, leads: 100 },
            { channel: "TikTok", month: "12", spend: 2000, leads: 100 },
            { channel: "Google", month: "11", spend: 3000, leads: 60 },
          ],
        }),
    });
    const record = seedRecord({
      dsl: [
        "root = Root([cac_chart])",
        'cac_chart = AnalyticsChart("bar", "渠道 CAC", "s", "channel", [{"channel":"TikTok","spend":2200,"leads":110,"cac":20},{"channel":"Google","spend":2800,"leads":100,"cac":28}], [])',
      ].join("\n"),
      queries: [QUERY_SQL],
      bindings: { cac_chart: QUERY_SQL.id },
      transforms: {
        cac_chart: {
          op: "aggregate",
          groupBy: ["channel"],
          metrics: { spend: "sum", leads: "sum" },
          compute: [{ field: "cac", expr: "spend / leads" }],
          sort: { key: "cac", desc: false },
        },
      },
    });

    const verdict = await refreshDashboard(record, gateway);

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.stale).toEqual([]);
    // 重算结果：TikTok spend=4000/leads=200/cac=20，Google spend=3000/leads=60/cac=50
    expect(await parseDataAt(verdict.dsl, "cac_chart")).toEqual([
      { channel: "TikTok", spend: 4000, leads: 200, cac: 20 },
      { channel: "Google", spend: 3000, leads: 60, cac: 50 },
    ]);
  });

  it("transform spec 落盘异常（被篡改）：组件按 stale 降级保留旧数据", async () => {
    const gateway = makeGateway({});
    const record = seedRecord({
      queries: [QUERY_SQL],
      bindings: { chart: QUERY_SQL.id },
      transforms: {
        chart: { op: "join" } as never, // 非法 spec（篡改场景）
      },
    });

    const verdict = await refreshDashboard(record, gateway);

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.stale).toEqual(["chart"]);
    // 旧数据保留（未被重算覆盖）
    expect(await parseDataAt(verdict.dsl, "chart")).toEqual([
      { channel: "A", deals: 1 },
      { channel: "B", deals: 2 },
    ]);
  });

  it("tool 重放：payload JSON 解析出 tool/args 传给 callTool", async () => {
    const callTool = vi.fn(async () => mcpResult([{ name: "r1", value: 9 }]));
    const gateway = makeGateway({ sources: ["gl1"], callTool });
    const q = { id: "q_aabbccdd", sourceId: "gl1", kind: "tool" as const, payload: '{"tool":"list_projects","args":{"membership":true}}' };
    const record = seedRecord({
      dsl: 'root = Root([t])\nt = DataTable("x", [], [{"name":"r1","value":0}])',
      queries: [q],
      bindings: { t: q.id },
    });

    const verdict = await refreshDashboard(record, gateway);
    expect(verdict.ok && verdict.stale).toEqual([]);
    expect(callTool).toHaveBeenCalledWith("list_projects", { membership: true });
    expect(verdict.ok && (await parseDataAt(verdict.dsl, "t"))).toEqual([
      { name: "r1", value: 9 },
    ]);
  });

  it("tool 白名单（安全边界）：写语义工具拒绝重放且不触达源，组件 stale", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const callTool = vi.fn(async () => mcpResult([]));
      const gateway = makeGateway({ sources: ["zt1"], callTool });
      // 禅道工具带写动作（action=delete）：args.action 不在只读集合 → 拒绝
      const qWrite = {
        id: "q_11111111",
        sourceId: "zt1",
        kind: "tool" as const,
        payload: '{"tool":"zentao_bug","args":{"action":"delete","id":1}}',
      };
      // 非白名单前缀的任意工具名 → 拒绝
      const qArbitrary = {
        id: "q_22222222",
        sourceId: "zt1",
        kind: "tool" as const,
        payload: '{"tool":"upload_artifact","args":{}}',
      };
      const record = seedRecord({
        queries: [qWrite, qArbitrary],
        bindings: { chart: qWrite.id, table: qArbitrary.id },
      });

      const verdict = await refreshDashboard(record, gateway);
      expect(verdict).toMatchObject({ ok: false, reason: "replay-failed" });
      expect(callTool).not.toHaveBeenCalled(); // 白名单层拦截，未触达源
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("不在只读白名单")
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("禅道只读动作放行：zentao_bug action=list 可重放", async () => {
    const callTool = vi.fn(async () => mcpResult([{ id: 1, title: "bug1" }]));
    const gateway = makeGateway({ sources: ["zt1"], callTool });
    const q = {
      id: "q_33333333",
      sourceId: "zt1",
      kind: "tool" as const,
      payload: '{"tool":"zentao_bug","args":{"action":"list","product":1}}',
    };
    const record = seedRecord({
      dsl: 'root = Root([t])\nt = DataTable("x", [], [{"id":0,"title":""}])',
      queries: [q],
      bindings: { t: q.id },
    });

    const verdict = await refreshDashboard(record, gateway);
    expect(verdict.ok && verdict.stale).toEqual([]);
    expect(callTool).toHaveBeenCalledWith("zentao_bug", { action: "list", product: 1 });
  });

  it("全部查询重放失败 → replay-failed 整体失败（不产出可落盘 DSL）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const callTool = vi.fn(async () => {
        throw new Error("connection reset");
      });
      const gateway = makeGateway({ callTool });
      const record = seedRecord({
        queries: [QUERY_SQL],
        bindings: { chart: QUERY_SQL.id, table: QUERY_SQL.id },
      });

      const verdict = await refreshDashboard(record, gateway);
      expect(verdict).toMatchObject({
        ok: false,
        reason: "replay-failed",
      });
      if (!verdict.ok && verdict.reason === "replay-failed") {
        expect(verdict.error).toContain("重新分析");
      }
      // 失败逐条留痕（不再静默吞掉基础设施错误）
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("重放失败"),
        expect.anything()
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("refreshDashboard 降级语义", () => {
  it("单查询失败：该查询绑定组件 stale 保留旧数据，其余组件正常刷新", async () => {
    const callTool = vi.fn(async (_name: string, args: { sql?: string }) => {
      if (args.sql?.includes("FROM deals")) {
        throw new Error("column \"channel\" does not exist"); // schema 漂移
      }
      return mcpResult({
        rows: [{ channel: "A", deals: 11 }, { channel: "B", deals: 22 }],
      });
    });
    const gateway = makeGateway({ callTool });
    const qOk = { ...QUERY_SQL, id: "q_11111111", payload: "SELECT 1" };
    const record = seedRecord({
      queries: [QUERY_SQL, qOk],
      bindings: { chart: QUERY_SQL.id, table: qOk.id },
    });

    const verdict = await refreshDashboard(record, gateway);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.stale).toEqual(["chart"]);
    // 失败组件保留旧数据
    expect(await parseDataAt(verdict.dsl, "chart")).toEqual([
      { channel: "A", deals: 1 },
      { channel: "B", deals: 2 },
    ]);
    // 成功组件拿到新数据
    expect(await parseDataAt(verdict.dsl, "table")).toEqual([
      { channel: "A", deals: 11 },
      { channel: "B", deals: 22 },
    ]);
  });

  it("非只读 SQL（捕获期被篡改的 payload）：词法守卫拒绝，未触达源；唯一查询失败 → replay-failed", async () => {
    const gateway = makeGateway({});
    const q = { ...QUERY_SQL, payload: "DELETE FROM deals" };
    const record = seedRecord({ queries: [q], bindings: { chart: q.id, table: q.id } });

    const verdict = await refreshDashboard(record, gateway);
    // 唯一查询被守卫拒绝 = 全部失败 → 整体失败（不产出可落盘 DSL）
    expect(verdict).toMatchObject({ ok: false, reason: "replay-failed" });
    expect(gateway.callToolMock).not.toHaveBeenCalled(); // 词法层就拦截，未触达源

    // 多查询场景下守卫拒绝只影响绑定组件（部分 stale 降级仍成立）
    const qOk = { ...QUERY_SQL, id: "q_44444444", payload: "SELECT 1" };
    const verdictPartial = await refreshDashboard(
      seedRecord({ queries: [q, qOk], bindings: { chart: q.id, table: qOk.id } }),
      gateway
    );
    expect(verdictPartial.ok && verdictPartial.stale).toEqual(["chart"]);
  });

  it("源不存在 → source-unavailable 整体失败；源停用同理", async () => {
    const record = seedRecord({ queries: [QUERY_SQL], bindings: { chart: QUERY_SQL.id } });

    const missing = await refreshDashboard(record, makeGateway({ sources: [] }));
    expect(missing).toMatchObject({ ok: false, reason: "source-unavailable", sourceId: "pg1" });
    if (!missing.ok && missing.reason === "source-unavailable") {
      expect(missing.error).toContain("重新分析");
    }

    // 停用源
    const gateway = makeGateway({});
    const disabled = await refreshDashboard(
      record,
      Object.assign({}, gateway, {
        get: (id: string) => ({ id, name: id, kind: "db" as const, dbType: "postgres" as const, connectionString: "x", enabled: false }),
      })
    );
    expect(disabled).toMatchObject({ ok: false, reason: "source-unavailable" });
  });

  it("连接失败 → source-unavailable 整体失败", async () => {
    const record = seedRecord({ queries: [QUERY_SQL], bindings: { chart: QUERY_SQL.id } });
    const verdict = await refreshDashboard(record, makeGateway({ connectError: true }));
    expect(verdict).toMatchObject({ ok: false, reason: "source-unavailable", sourceId: "pg1" });
  });

  it("v0.1 旧快照（无 queries）→ readonly，不触达任何源", async () => {
    const gateway = makeGateway({});
    const verdict = await refreshDashboard(seedRecord({}), gateway);
    expect(verdict).toMatchObject({ ok: false, reason: "readonly" });
    expect(gateway.connect).not.toHaveBeenCalled();
  });

  it("DSL 解析失败 → dsl-invalid，不回填", async () => {
    const record = seedRecord({
      dsl: "这不是合法 DSL",
      queries: [QUERY_SQL],
      bindings: { chart: QUERY_SQL.id },
    });
    const verdict = await refreshDashboard(record, makeGateway({}));
    expect(verdict).toMatchObject({ ok: false, reason: "dsl-invalid" });
  });
});
