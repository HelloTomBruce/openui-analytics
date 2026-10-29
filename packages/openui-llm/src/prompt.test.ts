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
