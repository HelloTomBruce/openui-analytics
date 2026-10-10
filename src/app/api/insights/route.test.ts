import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "./route";
import { callMcpTool } from "@/mcp/mcpClient";

vi.mock("@/mcp/mcpClient", () => ({
  callMcpTool: vi.fn(),
}));

describe("GET /api/insights", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("环比异常时返回检测到的洞察", async () => {
    vi.mocked(callMcpTool).mockResolvedValue({
      rows: [
        { month: "2026-09", revenue: 4850000, marketing_cost: 82000, new_leads: 1975, paying_customers: 260 },
        { month: "2026-08", revenue: 4380000, marketing_cost: 49700, new_leads: 1610, paying_customers: 215 },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generatedAt).toBeTruthy();
    // marketing_cost 49700 → 82000 为 +65%，应产出 critical
    const marketingInsight = body.insights.find(
      (i: { metric: string }) => i.metric === "营销成本"
    );
    expect(marketingInsight).toBeDefined();
    expect(marketingInsight.level).toBe("critical");
  });

  it("数据源失败时返回 200 + 空洞察 + error，绝不 500", async () => {
    vi.mocked(callMcpTool).mockRejectedValue(new Error("connection refused"));

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insights).toEqual([]);
    expect(body.error).toContain("connection refused");
  });

  it("数据不足两期时返回空洞察且不报错", async () => {
    vi.mocked(callMcpTool).mockResolvedValue({ rows: [] });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insights).toEqual([]);
    expect(body.error).toBeUndefined();
  });
});
