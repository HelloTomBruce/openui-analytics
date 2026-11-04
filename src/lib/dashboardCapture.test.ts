import { describe, it, expect } from "vitest";
import {
  captureDashboardQueries,
  type CapturedToolCall,
} from "./dashboardCapture";

/**
 * 活看板生成期捕获测试：直取数组件绑定、derived（计算列/合并/聚合）不绑定、
 * 查询候选提取（sql/tool/源归属/去重）、保守匹配与幂等 id。
 */

const SOURCES = [{ id: "pg1" }, { id: "gl1" }];

const CHANNEL_ROWS = [
  { channel: "TikTok Ads", deals: 186, leads: 4200 },
  { channel: "Google Ads", deals: 152, leads: 3800 },
  { channel: "线下展会", deals: 118, leads: 1100 },
];

function sqlCall(
  sourceId: string,
  sql: string,
  rows: Record<string, unknown>[] = CHANNEL_ROWS,
  extra: Partial<CapturedToolCall> = {}
): CapturedToolCall {
  return {
    toolCallId: "c1",
    state: "result",
    toolName: `${sourceId}_execute_sql`,
    args: { sql },
    result: { rows },
    ...extra,
  };
}

describe("captureDashboardQueries 直取数绑定", () => {
  it("列投影的直取数图表与全列表格绑定同一查询（q_ 前缀 id，sql payload 原文）", () => {
    const dsl = [
      'root = Root([chart, table])',
      'chart = AnalyticsChart("bar", "渠道成交", "副题", "channel", [{"channel":"TikTok Ads","deals":186},{"channel":"Google Ads","deals":152},{"channel":"线下展会","deals":118}], [{"key":"deals","label":"成交数"}])',
      'table = DataTable("渠道明细", [{"key":"channel","header":"渠道"},{"key":"deals","header":"成交数"}], [{"channel":"TikTok Ads","deals":186,"leads":4200},{"channel":"Google Ads","deals":152,"leads":3800},{"channel":"线下展会","deals":118,"leads":1100}])',
    ].join("\n");

    const res = captureDashboardQueries(dsl, [sqlCall("pg1", "SELECT * FROM deals")], SOURCES);

    expect(Object.keys(res.bindings)).toEqual(["chart", "table"]);
    expect(res.queries).toHaveLength(1);
    const q = res.queries[0];
    expect(q.id).toMatch(/^q_[0-9a-z]+$/);
    expect(q.sourceId).toBe("pg1");
    expect(q.kind).toBe("sql");
    expect(q.payload).toBe("SELECT * FROM deals");
    expect(res.bindings.chart).toBe(q.id);
    expect(res.bindings.table).toBe(q.id);
  });

  it("计算列组件（结果中不存在的字段键）判 derived 不进 bindings，也不产生查询", () => {
    // cac = leads/deals 是 LLM 计算列，查询结果没有该键
    const dsl = [
      'root = Root([derived])',
      'derived = AnalyticsChart("bar", "CAC", "副题", "channel", [{"channel":"TikTok Ads","cac":16.2},{"channel":"Google Ads","cac":19.5},{"channel":"线下展会","cac":28.4}], [])',
    ].join("\n");

    const res = captureDashboardQueries(dsl, [sqlCall("pg1", "SELECT ...")], SOURCES);
    expect(res.bindings).toEqual({});
    expect(res.queries).toEqual([]);
  });

  it("跨查询合并行的组件不绑定（无单一查询能覆盖全部行）", () => {
    const rowsA = [
      { channel: "A", deals: 1 },
      { channel: "B", deals: 2 },
    ];
    const rowsB = [
      { channel: "C", deals: 3 },
      { channel: "D", deals: 4 },
    ];
    const dsl = [
      'root = Root([merged])',
      'merged = AnalyticsChart("bar", "合并", "s", "channel", [{"channel":"A","deals":1},{"channel":"B","deals":2},{"channel":"C","deals":3}], [])',
    ].join("\n");

    const res = captureDashboardQueries(
      dsl,
      [sqlCall("pg1", "q-a", rowsA), sqlCall("pg1", "q-b", rowsB)],
      SOURCES
    );
    expect(res.bindings).toEqual({});
    expect(res.queries).toEqual([]);
  });

  it("单行组件对多行结果（LLM 聚合加工）判 derived；单行结果时绑定", () => {
    const single = [{ total: 42 }];
    const dsl = [
      'root = Root([one])',
      'one = DataTable("汇总", [{"key":"total","header":"合计"}], [{"total":42}])',
    ].join("\n");

    // 多行结果 → 不绑定
    const multi = captureDashboardQueries(dsl, [sqlCall("pg1", "SELECT ...")], SOURCES);
    expect(multi.bindings).toEqual({});

    // 单行结果 → 绑定
    const singleRes = captureDashboardQueries(
      dsl,
      [sqlCall("pg1", "SELECT sum(x) AS total FROM t", single)],
      SOURCES
    );
    expect(singleRes.bindings.one).toBeDefined();
    expect(singleRes.queries[0].payload).toBe("SELECT sum(x) AS total FROM t");
  });

  it("数值容忍数字字符串（DSL 字符串化的数字仍算直取数）；值不同的行不绑定", () => {
    const dsl = [
      'root = Root([chart])',
      'chart = AnalyticsChart("bar", "t", "s", "channel", [{"channel":"TikTok Ads","deals":"186"},{"channel":"Google Ads","deals":152}], [])',
    ].join("\n");

    const ok = captureDashboardQueries(dsl, [sqlCall("pg1", "SELECT 1")], SOURCES);
    expect(ok.bindings.chart).toBeDefined();

    const drifted = [
      'root = Root([chart])',
      'chart = AnalyticsChart("bar", "t", "s", "channel", [{"channel":"TikTok Ads","deals":999},{"channel":"Google Ads","deals":152}], [])',
    ].join("\n");
    const bad = captureDashboardQueries(drifted, [sqlCall("pg1", "SELECT 1")], SOURCES);
    expect(bad.bindings).toEqual({});
  });

  it("同一查询重复调用不产生歧义（按 id 去重），仍正确绑定", () => {
    const dsl = [
      'root = Root([chart])',
      'chart = AnalyticsChart("bar", "t", "s", "channel", [{"channel":"TikTok Ads","deals":186},{"channel":"Google Ads","deals":152}], [])',
    ].join("\n");
    const res = captureDashboardQueries(
      dsl,
      [sqlCall("pg1", "SELECT 1"), sqlCall("pg1", "SELECT 1", CHANNEL_ROWS, { toolCallId: "c2" })],
      SOURCES
    );
    expect(res.queries).toHaveLength(1);
    expect(res.bindings.chart).toBe(res.queries[0].id);
  });

  it("两个不同查询结果完全一致 → 歧义不绑定（宁缺勿错）", () => {
    const dsl = [
      'root = Root([chart])',
      'chart = AnalyticsChart("bar", "t", "s", "channel", [{"channel":"TikTok Ads","deals":186},{"channel":"Google Ads","deals":152}], [])',
    ].join("\n");
    const res = captureDashboardQueries(
      dsl,
      [sqlCall("pg1", "SELECT a"), sqlCall("gl1", "SELECT b", CHANNEL_ROWS)],
      SOURCES
    );
    expect(res.bindings).toEqual({});
  });

  it("行序打乱的直取数子集仍绑定（每行都能在结果中找到）", () => {
    const dsl = [
      'root = Root([chart])',
      'chart = AnalyticsChart("bar", "t", "s", "channel", [{"channel":"线下展会","deals":118},{"channel":"TikTok Ads","deals":186}], [])',
    ].join("\n");
    const res = captureDashboardQueries(dsl, [sqlCall("pg1", "SELECT 1")], SOURCES);
    expect(res.bindings.chart).toBeDefined();
  });
});

describe("captureDashboardQueries transform 推测（第二通道）", () => {
  // 明细粒度查询结果（month × channel）
  const DETAIL_ROWS = [
    { channel: "TikTok", month: "09", spend: 1000, leads: 50 },
    { channel: "TikTok", month: "10", spend: 1200, leads: 60 },
    { channel: "Google", month: "09", spend: 2000, leads: 80 },
    { channel: "Google", month: "10", spend: 800, leads: 20 },
  ];

  it("LLM 聚合+派生列组件：推测 transform 并绑定（bindings + transforms 同键）", () => {
    // 组件是 channel 粒度汇总 + cac=spend/leads（直取匹配必然失败）
    const dsl = [
      "root = Root([cac_chart])",
      'cac_chart = AnalyticsChart("bar", "渠道 CAC", "副题", "channel", [{"channel":"TikTok","spend":2200,"leads":110,"cac":20},{"channel":"Google","spend":2800,"leads":100,"cac":28}], [])',
    ].join("\n");

    const res = captureDashboardQueries(
      dsl,
      [sqlCall("pg1", "SELECT channel, month, spend, leads FROM ads", DETAIL_ROWS)],
      SOURCES
    );

    expect(res.bindings.cac_chart).toBeDefined();
    expect(res.queries).toHaveLength(1);
    const spec = res.transforms?.cac_chart;
    expect(spec).toBeDefined();
    expect(spec?.op).toBe("aggregate");
    expect(spec?.groupBy).toEqual(["channel"]);
    expect(spec?.metrics).toEqual({ spend: "sum", leads: "sum" });
    expect(spec?.compute).toEqual([{ field: "cac", expr: "spend / leads" }]);
  });

  it("数值对不上任何聚合（验证失败）：维持纯快照，不绑定", () => {
    const dsl = [
      "root = Root([fake])",
      'fake = AnalyticsChart("bar", "假汇总", "副题", "channel", [{"channel":"TikTok","spend":999,"leads":110},{"channel":"Google","spend":888,"leads":100}], [])',
    ].join("\n");

    const res = captureDashboardQueries(
      dsl,
      [sqlCall("pg1", "SELECT ...", DETAIL_ROWS)],
      SOURCES
    );
    expect(res.bindings).toEqual({});
    expect(res.transforms).toBeUndefined();
    expect(res.queries).toEqual([]);
  });

  it("直取匹配成功的组件不受影响（不产生 transforms）", () => {
    const dsl = [
      "root = Root([chart])",
      'chart = AnalyticsChart("bar", "渠道成交", "副题", "channel", [{"channel":"TikTok Ads","deals":186},{"channel":"Google Ads","deals":152},{"channel":"线下展会","deals":118}], [])',
    ].join("\n");

    const res = captureDashboardQueries(dsl, [sqlCall("pg1", "SELECT 1")], SOURCES);
    expect(res.bindings.chart).toBeDefined();
    expect(res.transforms).toBeUndefined();
  });
});

describe("captureDashboardQueries 查询候选提取", () => {
  const DSL_ONE_ROW = [
    'root = Root([table])',
    'table = DataTable("t", [{"key":"name","header":"名"}], [{"name":"r1"}])',
  ].join("\n");

  it("MCP 类工具 → kind=tool，payload 为 {tool,args} JSON", () => {
    const res = captureDashboardQueries(
      DSL_ONE_ROW,
      [
        {
          state: "result",
          toolName: "gl1_list_projects",
          args: { membership: true },
          result: [{ name: "r1" }],
        },
      ],
      SOURCES
    );
    expect(res.queries).toHaveLength(1);
    const q = res.queries[0];
    expect(q.kind).toBe("tool");
    expect(q.sourceId).toBe("gl1");
    expect(JSON.parse(q.payload)).toEqual({ tool: "list_projects", args: { membership: true } });
    expect(res.bindings.table).toBe(q.id);
  });

  it("顶层数组 / items 包裹的结果均可提取行", () => {
    const res = captureDashboardQueries(
      DSL_ONE_ROW,
      [
        { state: "result", toolName: "gl1_a", args: {}, result: [{ name: "r1" }] },
        { state: "result", toolName: "gl1_b", args: {}, result: { items: [{ name: "r1" }] } },
      ],
      SOURCES
    );
    // 两个不同 payload 的候选，但组件对两者构成并列歧义 → 不绑定（候选提取本身已生效）
    expect(res.bindings).toEqual({});
  });

  it("未归属启用源的工具（cross_source_link 等）与未完成调用不参与", () => {
    const res = captureDashboardQueries(
      DSL_ONE_ROW,
      [
        { state: "result", toolName: "cross_source_link", args: { zentao_project_id: "42" }, result: { confidence: "none" } },
        { state: "call", toolName: "pg1_execute_sql", args: { sql: "SELECT 1" } },
        { state: "result", toolName: "other_execute_sql", args: { sql: "SELECT 2" }, result: { rows: [{ name: "r1" }] } },
      ],
      SOURCES
    );
    expect(res.queries).toEqual([]);
    expect(res.bindings).toEqual({});
  });

  it("无行数组结果（list_tables）与 execute_sql 缺 sql 参数均不产生候选", () => {
    const res = captureDashboardQueries(
      DSL_ONE_ROW,
      [
        { state: "result", toolName: "pg1_list_tables", args: {}, result: [{ table: "t1" }] },
        { state: "result", toolName: "pg1_execute_sql", args: {}, result: { rows: [{ name: "r1" }] } },
        { state: "result", toolName: "pg1_execute_sql", args: { sql: "   " }, result: { rows: [{ name: "r1" }] } },
      ],
      SOURCES
    );
    expect(res.queries).toEqual([]);
    expect(res.bindings).toEqual({});
  });
});

describe("captureDashboardQueries 兼容与幂等", () => {
  it("无工具调用 / 非 DSL 文本 → 空结果不抛错（纯快照收藏路径）", () => {
    expect(captureDashboardQueries("root = Root([])", [], SOURCES)).toEqual({
      queries: [],
      bindings: {},
    });
    expect(captureDashboardQueries("不是 DSL", [sqlCall("pg1", "SELECT 1")], SOURCES)).toEqual({
      queries: [],
      bindings: {},
    });
  });

  it("同输入幂等（重复收藏不产生 id 漂移）；不同 payload 产生不同 id", () => {
    const dsl = [
      'root = Root([chart])',
      'chart = AnalyticsChart("bar", "t", "s", "channel", [{"channel":"TikTok Ads","deals":186},{"channel":"Google Ads","deals":152}], [])',
    ].join("\n");
    const a = captureDashboardQueries(dsl, [sqlCall("pg1", "SELECT x")], SOURCES);
    const b = captureDashboardQueries(dsl, [sqlCall("pg1", "SELECT x")], SOURCES);
    expect(a).toEqual(b);

    const c = captureDashboardQueries(dsl, [sqlCall("pg1", "SELECT y")], SOURCES);
    expect(c.queries[0].id).not.toBe(a.queries[0].id);
  });

  it("内联组件（无 statementId）与布局容器不参与绑定；嵌套在布局内的具名组件参与", () => {
    const dsl = [
      'root = Root([report])',
      'report = ReportLayout("标题", "副题", [], [chart], [], [])',
      'chart = AnalyticsChart("bar", "t", "s", "channel", [{"channel":"TikTok Ads","deals":186},{"channel":"Google Ads","deals":152}], [])',
    ].join("\n");
    const res = captureDashboardQueries(dsl, [sqlCall("pg1", "SELECT 1")], SOURCES);
    expect(res.bindings).toEqual({ chart: res.queries[0].id });
  });
});
