// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getOpenUISystemPrompt } from "./prompt";
import type { ActiveSourceSummary } from "@/mcp/registry";

describe("getOpenUISystemPrompt 动态数据源段", () => {
  it("无参时保留三内置源与跨源映射段（守护现有行为）", () => {
    const prompt = getOpenUISystemPrompt();
    expect(prompt).toContain("PostgreSQL Analytics Database");
    expect(prompt).toContain("GitLab Repository");
    expect(prompt).toContain("ZenTao 禅道");
    expect(prompt).toContain("cross_source_link");
  });

  it("仅激活动态源时过滤未激活内置段并列出动态源", () => {
    const active: ActiveSourceSummary[] = [
      {
        id: "mysql-orders",
        name: "订单库",
        kind: "db",
        dbType: "mysql",
        tools: ["execute_sql"],
      },
    ];

    const prompt = getOpenUISystemPrompt(active);

    expect(prompt).toContain("订单库");
    expect(prompt).toContain("execute_sql");
    expect(prompt).not.toContain("ZenTao 禅道");
    expect(prompt).not.toContain("PostgreSQL Analytics Database");
    // cross_source_link 工具常挂，说明段保留
    expect(prompt).toContain("cross_source_link");
  });
});
