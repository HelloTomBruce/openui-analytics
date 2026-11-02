// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  getOpenUISystemPrompt,
  getOpenUIPlanPrompt,
  getExecuteSystemPrompt,
} from "./prompt";
import type { ActiveSourceSummary } from "@openui-analytics/datasources";

const ACTIVE: ActiveSourceSummary[] = [
  {
    id: "mysql-orders",
    name: "订单库",
    kind: "db",
    dbType: "mysql",
    tools: ["mysql-orders_execute_sql", "mysql-orders_list_tables"],
  },
  {
    id: "zentao-cli",
    name: "禅道",
    kind: "stdio-cli",
    tools: ["zentao-cli_zentao_bug"],
  },
];

describe("getOpenUISystemPrompt 全动态数据源段", () => {
  it("Data Access 段完全由激活源生成：源名/kind/工具 + 跨源映射保留", () => {
    const prompt = getOpenUISystemPrompt(ACTIVE);

    expect(prompt).toContain("订单库");
    expect(prompt).toContain("mysql-orders_execute_sql");
    expect(prompt).toContain("禅道");
    expect(prompt).toContain("zentao-cli_zentao_bug");
    expect(prompt).toContain("cross_source_link");
    // 无内置静态段残留
    expect(prompt).not.toContain("PostgreSQL Analytics Database");
    expect(prompt).not.toContain("GitLab Repository");
  });

  it("空源列表仍生成可用 prompt（仅跨源映射说明）", () => {
    const prompt = getOpenUISystemPrompt([]);
    expect(prompt).toContain("cross_source_link");
    expect(prompt).not.toContain("PostgreSQL Analytics Database");
  });
});

describe("getOpenUIPlanPrompt 规划模式提示词", () => {
  it("复用动态数据源段，并含规划契约与探查边界", () => {
    const prompt = getOpenUIPlanPrompt(ACTIVE);

    // 动态数据源段照常生成
    expect(prompt).toContain("订单库");
    expect(prompt).toContain("mysql-orders_list_tables");
    expect(prompt).toContain("cross_source_link");
    // 规划模式标识与输出契约
    expect(prompt).toContain("Planning Mode");
    expect(prompt).toContain("PlanReviewCard");
    expect(prompt).toContain("LIMIT");
    // 严禁直出看板的约束
    expect(prompt).toContain("NOT producing the final dashboard");
  });
});

describe("getExecuteSystemPrompt 执行模式提示词", () => {
  it("base 提示词完整保留 + 执行增量约束追加", () => {
    const prompt = getExecuteSystemPrompt(ACTIVE);
    const base = getOpenUISystemPrompt(ACTIVE);

    // base 全量保留（组件规范/数据源段/跨源规则）
    expect(prompt).toContain(base);
    // 执行增量约束
    expect(prompt).toContain("Confirmed Plan Execution Mode");
    expect(prompt).toContain("REVISED PlanReviewCard");
  });
});

describe("Schema Card 摘要注入（三模式）", () => {
  const DIGEST = "### 数据源 mysql-orders 结构卡（生成于 2026-11-02 10:30）\n- orders（约 1,234 行）：status text(3 值: paid/shipped/refunded)";

  it("direct / plan / execute 三种模式都携带同一结构卡段", () => {
    expect(getOpenUISystemPrompt(ACTIVE, DIGEST)).toContain(DIGEST);
    expect(getOpenUIPlanPrompt(ACTIVE, DIGEST)).toContain(DIGEST);
    expect(getExecuteSystemPrompt(ACTIVE, DIGEST)).toContain(DIGEST);
  });

  it("注入段带「优先复用卡」引导语；缺省不注入（向后兼容）", () => {
    const withCard = getOpenUISystemPrompt(ACTIVE, DIGEST);
    expect(withCard).toContain("Schema Cards");
    expect(withCard).toContain("Prefer them over calling list_tables/describe_table");

    const without = getOpenUISystemPrompt(ACTIVE);
    expect(without).not.toContain("Schema Cards");
    expect(without).not.toContain("结构卡");
  });
});

describe("结构卡预算常量守护（防回归快照）", () => {
  it("datasources 包预算常量与 handler 总量预算符合契约", async () => {
    const {
      CARD_RENDER_BUDGET_BYTES,
      CARD_STORE_MAX_BYTES,
      LOW_CARDINALITY_THRESHOLD,
    } = await import("@openui-analytics/datasources");
    const { SCHEMA_DIGEST_TOTAL_BUDGET_BYTES } = await import("./handler");

    // 契约快照：单卡渲染 ≤2KB；落盘 ≤64KB；总量 ≤8KB；低基数阈值 50
    expect({
      perCardRender: CARD_RENDER_BUDGET_BYTES,
      storeMax: CARD_STORE_MAX_BYTES,
      totalDigest: SCHEMA_DIGEST_TOTAL_BUDGET_BYTES,
      lowCardinality: LOW_CARDINALITY_THRESHOLD,
    }).toMatchInlineSnapshot(`
      {
        "lowCardinality": 50,
        "perCardRender": 2048,
        "storeMax": 65536,
        "totalDigest": 8192,
      }
    `);
  });
});

describe("方法论注入（三模式）", () => {
  const INDEX = "## Analysis Method Index (pick by the question's intent):\n- trend: 趋势与同比环比 — 指标随时间如何变化";
  const DETAILS = "### Method pareto · 构成与帕累托\nCharts: AnalyticsChart + MetricGrid";

  it("direct / plan 携带方法索引与选法引导；execute 携带详情与遵循指令", () => {
    const direct = getOpenUISystemPrompt(ACTIVE, undefined, INDEX);
    expect(direct).toContain("Analysis Method Index");
    expect(direct).toContain("NAME them in the dashboard title");

    const plan = getOpenUIPlanPrompt(ACTIVE, undefined, INDEX);
    expect(plan).toContain("Analysis Method Index");
    expect(plan).toContain("Method Selection");
    expect(plan).toContain("1-2 methods");

    const exec = getExecuteSystemPrompt(ACTIVE, undefined, DETAILS);
    expect(exec).toContain("### Method pareto");
    expect(exec).toContain("follow their detailed guidance strictly");
    // execute 不重复注入索引（按需详情替代全量索引）
    expect(exec).not.toContain("Analysis Method Index");
  });

  it("缺省不注入（向后兼容）", () => {
    expect(getOpenUISystemPrompt(ACTIVE)).not.toContain("Analysis Method Index");
    expect(getOpenUIPlanPrompt(ACTIVE)).not.toContain("Method Selection");
    expect(getExecuteSystemPrompt(ACTIVE)).not.toContain("Method pareto");
  });

  it("索引预算常量契约快照（methodology 包）", async () => {
    const {
      INDEX_BUDGET_BYTES,
      DETAIL_BUDGET_BYTES,
      renderMethodIndex,
      builtinMethodCards,
    } = await import("@openui-analytics/methodology");
    expect({
      index: INDEX_BUDGET_BYTES,
      detail: DETAIL_BUDGET_BYTES,
    }).toMatchInlineSnapshot(`
      {
        "detail": 600,
        "index": 1024,
      }
    `);
    // 内置 10 卡索引实渲染在预算内
    const text = renderMethodIndex(builtinMethodCards);
    expect(Buffer.byteLength(text, "utf-8")).toBeLessThanOrEqual(INDEX_BUDGET_BYTES);
  });
});

describe("模式语义隔离（回归：direct 引导语泄漏进 plan 造成矛盾指令）", () => {
  const INDEX = "## Analysis Method Index (pick by the question's intent):\n- trend: 趋势与同比环比 — 指标随时间如何变化";

  it("plan prompt 不含「写进看板标题」等 direct 专属措辞", () => {
    const plan = getOpenUIPlanPrompt(ACTIVE, undefined, INDEX);
    expect(plan).not.toContain("dashboard title");
    expect(plan).not.toContain("NAME them in the dashboard");
    // plan 的选法指令指向 PlanReviewCard
    expect(plan).toContain("PlanReviewCard title or a step's detail");
  });

  it("direct prompt 保留方法命名引导（看板标题/洞察）", () => {
    const direct = getOpenUISystemPrompt(ACTIVE, undefined, INDEX);
    expect(direct).toContain("NAME them in the dashboard title or insights");
  });
});
