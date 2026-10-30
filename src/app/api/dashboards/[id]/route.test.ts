import { describe, it, expect, vi, afterEach } from "vitest";
import { GET, PUT, DELETE } from "./route";
import { dashboardStore } from "@/lib/dashboardStore";
import type { DashboardRecord } from "@/lib/dashboardStore";

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
  createdAt: 100,
  updatedAt: 200,
};

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(method: string, body?: unknown) {
  return new Request(`http://localhost:3006/api/dashboards/dash_ab12cd34`, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dashboards/:id", () => {
  it("存在 → 200 + 完整记录（含 dsl）", async () => {
    vi.mocked(dashboardStore.get).mockResolvedValueOnce(RECORD);
    const res = await GET(
      jsonRequest("GET"),
      makeContext("dash_ab12cd34")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dashboard.dsl).toBe("root = Root([funnel])");
  });

  it("不存在 → 404", async () => {
    vi.mocked(dashboardStore.get).mockResolvedValueOnce(null);
    const res = await GET(jsonRequest("GET"), makeContext("dash_deadbeef"));
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/dashboards/:id", () => {
  it("重命名 → 200 + 摘要", async () => {
    vi.mocked(dashboardStore.update).mockResolvedValueOnce({
      ok: true,
      record: { ...RECORD, title: "新名字", updatedAt: 300 },
    });
    const res = await PUT(
      jsonRequest("PUT", { title: "新名字" }),
      makeContext("dash_ab12cd34")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dashboard.title).toBe("新名字");
    expect(Object.keys(body.dashboard)).not.toContain("dsl");
    expect(vi.mocked(dashboardStore.update)).toHaveBeenCalledWith(
      "dash_ab12cd34",
      { title: "新名字" }
    );
  });

  it("不存在 → 404；无字段 → 400；超限 → 413", async () => {
    vi.mocked(dashboardStore.update).mockResolvedValueOnce({
      ok: false,
      status: 404,
      errors: ["看板不存在: dash_deadbeef"],
    });
    expect(
      (await PUT(jsonRequest("PUT", { title: "x" }), makeContext("dash_deadbeef"))).status
    ).toBe(404);

    vi.mocked(dashboardStore.update).mockResolvedValueOnce({
      ok: false,
      status: 400,
      errors: ["无可更新字段"],
    });
    expect(
      (await PUT(jsonRequest("PUT", {}), makeContext("dash_ab12cd34"))).status
    ).toBe(400);

    vi.mocked(dashboardStore.update).mockResolvedValueOnce({
      ok: false,
      status: 413,
      errors: ["dsl 超过 2097152 字符上限（2MB）"],
    });
    expect(
      (await PUT(jsonRequest("PUT", { dsl: "x" }), makeContext("dash_ab12cd34"))).status
    ).toBe(413);
  });
});

describe("DELETE /api/dashboards/:id", () => {
  it("成功 → 204 无载荷", async () => {
    vi.mocked(dashboardStore.remove).mockResolvedValueOnce(true);
    const res = await DELETE(
      jsonRequest("DELETE"),
      makeContext("dash_ab12cd34")
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("不存在 → 404", async () => {
    vi.mocked(dashboardStore.remove).mockResolvedValueOnce(false);
    const res = await DELETE(jsonRequest("DELETE"), makeContext("dash_deadbeef"));
    expect(res.status).toBe(404);
  });
});
