import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "./route";
import { listDataSources, checkDataSourceHealth } from "@/mcp/registry";

vi.mock("@/mcp/registry", () => ({
  listDataSources: vi.fn(() => [
    { id: "postgres", name: "PostgreSQL 分析库", kind: "postgres", tools: [] },
    { id: "gitlab-mcp", name: "GitLab MCP (外部)", kind: "gitlab-mcp", tools: [] },
    { id: "zentao-cli", name: "ZenTao 禅道 CLI MCP (本地)", kind: "zentao-cli", tools: [] },
  ]),
  checkDataSourceHealth: vi.fn(async () => ({ ok: true, latencyMs: 5 })),
}));

describe("GET /api/datasources", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("返回所有数据源与健康状态", async () => {
    const res = await GET(new Request("http://localhost:3006/api/datasources"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources).toHaveLength(3);
    expect(body.health.postgres.ok).toBe(true);
    expect(body.health["gitlab-mcp"].ok).toBe(true);
  });

  it("gitlab-mcp 探活透传 query 中的 gitlabUrl 与 gitlabToken", async () => {
    const url =
      "http://localhost:3006/api/datasources?gitlabUrl=" +
      encodeURIComponent("http://10.0.0.9:5002/mcp") +
      "&gitlabToken=glpat-test";
    await GET(new Request(url));

    expect(checkDataSourceHealth).toHaveBeenCalledWith("gitlab-mcp", {
      gitlabUrl: "http://10.0.0.9:5002/mcp",
      gitlabToken: "glpat-test",
    });
    // 其他源不携带 gitlab 配置
    expect(checkDataSourceHealth).toHaveBeenCalledWith("postgres", undefined);
  });
});
