import { describe, it, expect, vi, afterEach } from "vitest";
import { GET, POST } from "./route";
import { dashboardStore } from "@/lib/dashboardStore";
import type { DashboardRecord } from "@/lib/dashboardStore";

/** 接缝 mock：路由层只验证协议/状态码/载荷形态，落盘行为由存储层单测覆盖 */
vi.mock("@/lib/dashboardStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dashboardStore")>();
  return {
    ...actual,
    dashboardStore: {
      list: vi.fn(),
      upsert: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
  };
});

const RECORD: DashboardRecord = {
  id: "dash_ab12cd34",
  title: "Bug 收敛漏斗",
  dsl: "root = Root([funnel])",
  prompt: "本迭代 Bug 收敛情况",
  sourceNames: ["GitLab"],
  origin: { sessionId: "s1", messageId: "m1" },
  createdAt: 100,
  updatedAt: 200,
};

function jsonRequest(body: unknown) {
  return new Request("http://localhost:3006/api/dashboards", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dashboards", () => {
  it("返回摘要列表（不含 dsl）", async () => {
    const { toSummary } = await import("@/lib/dashboardStore");
    vi.mocked(dashboardStore.list).mockResolvedValueOnce([toSummary(RECORD)]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dashboards[0].id).toBe("dash_ab12cd34");
    expect(Object.keys(body.dashboards[0])).not.toContain("dsl");
  });
});

describe("POST /api/dashboards", () => {
  it("收藏成功 → 201 + 摘要（不含 dsl）", async () => {
    vi.mocked(dashboardStore.upsert).mockResolvedValueOnce({
      ok: true,
      record: RECORD,
    });
    const res = await POST(
      jsonRequest({ dsl: RECORD.dsl, prompt: RECORD.prompt })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.dashboard.id).toBe("dash_ab12cd34");
    expect(Object.keys(body.dashboard)).not.toContain("dsl");
    expect(vi.mocked(dashboardStore.upsert)).toHaveBeenCalledWith({
      dsl: RECORD.dsl,
      prompt: RECORD.prompt,
    });
  });

  it("dsl 缺失 → 400 + errors", async () => {
    vi.mocked(dashboardStore.upsert).mockResolvedValueOnce({
      ok: false,
      status: 400,
      errors: ["dsl 不能为空"],
    });
    const res = await POST(jsonRequest({ prompt: "p" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors).toContain("dsl 不能为空");
  });

  it("dsl 超限 → 413", async () => {
    vi.mocked(dashboardStore.upsert).mockResolvedValueOnce({
      ok: false,
      status: 413,
      errors: ["dsl 超过 2097152 字符上限（2MB）"],
    });
    const res = await POST(jsonRequest({ dsl: "x".repeat(10) }));
    expect(res.status).toBe(413);
  });

  it("非 JSON 请求体 → 400（原样透传给存储层校验）", async () => {
    vi.mocked(dashboardStore.upsert).mockResolvedValueOnce({
      ok: false,
      status: 400,
      errors: ["请求体必须是 JSON 对象"],
    });
    const res = await POST(jsonRequest("not-json"));
    expect(res.status).toBe(400);
  });
});
