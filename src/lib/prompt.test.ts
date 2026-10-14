// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getOpenUISystemPrompt } from "./prompt";
import type { ActiveSourceSummary } from "@openui-analytics/datasources";

describe("getOpenUISystemPrompt 全动态数据源段", () => {
  it("Data Access 段完全由激活源生成：源名/kind/工具 + 跨源映射保留", () => {
    const active: ActiveSourceSummary[] = [
      {
        id: "mysql-orders",
        name: "订单库",
        kind: "db",
        dbType: "mysql",
        tools: ["mysql-orders_execute_sql"],
      },
      {
        id: "zentao-cli",
        name: "禅道",
        kind: "stdio-cli",
        tools: ["zentao-cli_zentao_bug"],
      },
    ];

    const prompt = getOpenUISystemPrompt(active);

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
