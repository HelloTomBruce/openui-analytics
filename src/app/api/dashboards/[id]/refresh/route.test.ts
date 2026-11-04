// @vitest-environment node
// importOriginal 会真实加载 dashboardRefresh → dbMcpServer → node:sqlite；
// Node 22 的 builtinModules 未列 sqlite，jsdom（vite client 环境）无法外置会打包失败
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import { dashboardStore } from "@/lib/dashboardStore";
import { refreshDashboard } from "@/lib/dashboardRefresh";
import type { DashboardRecord } from "@/lib/dashboardStore";

/** 接缝 mock：路由层只验证协议/状态码/降级映射；重放与落盘由引擎/存储层单测覆盖 */
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

vi.mock("@/lib/dashboardRefresh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dashboardRefresh")>();
  return { ...actual, refreshDashboard: vi.fn() };
});

vi.mock("@/lib/datasources", () => ({ datasources: {} }));

const RECORD: DashboardRecord = {
  id: "dash_ab12cd34",
  title: "渠道看板",
  dsl: "root = Root([chart])",
  queries: [{ id: "q_00af5f39", sourceId: "pg1", kind: "sql", payload: "SELECT 1" }],
  bindings: { chart: "q_00af5f39" },
  createdAt: 1,
  updatedAt: 2,
};

function callRoute(id: string) {
  return POST(new Request("http://localhost:3006/x", { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.mocked(dashboardStore.get).mockResolvedValue(RECORD);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/dashboards/[id]/refresh", () => {
  it("刷新成功（无 stale）→ 200 + 摘要 + 空 stale，且落盘携带新 dsl 与 dataUpdatedAt", async () => {
    vi.mocked(refreshDashboard).mockResolvedValueOnce({
      ok: true,
      dsl: "root = Root([chart]) // 新数据",
      stale: [],
    });
    vi.mocked(dashboardStore.update).mockResolvedValueOnce({
      ok: true,
      record: { ...RECORD, dsl: "root = Root([chart]) // 新数据" },
    });

    const res = await callRoute("dash_ab12cd34");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stale).toEqual([]);
    expect(body.dashboard.dsl).toBeUndefined(); // 摘要不含 dsl
    const updateArgs = vi.mocked(dashboardStore.update).mock.calls[0][1];
    expect(updateArgs.dsl).toContain("新数据");
    expect(typeof updateArgs.dataUpdatedAt).toBe("number");
  });

  it("部分 stale → 200 + stale 组件列表，不更新 dataUpdatedAt", async () => {
    vi.mocked(refreshDashboard).mockResolvedValueOnce({
      ok: true,
      dsl: "new dsl",
      stale: ["chart"],
    });
    vi.mocked(dashboardStore.update).mockResolvedValueOnce({
      ok: true,
      record: { ...RECORD, dsl: "new dsl" },
    });

    const res = await callRoute("dash_ab12cd34");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stale).toEqual(["chart"]);
    expect(vi.mocked(dashboardStore.update).mock.calls[0][1].dataUpdatedAt).toBeUndefined();
  });

  it("看板不存在 → 404，不触发刷新", async () => {
    vi.mocked(dashboardStore.get).mockResolvedValueOnce(null);
    const res = await callRoute("dash_00000000");
    expect(res.status).toBe(404);
    expect(refreshDashboard).not.toHaveBeenCalled();
  });

  it("v0.1 静态快照（无 queries）→ 400 只读提示", async () => {
    vi.mocked(refreshDashboard).mockResolvedValueOnce({
      ok: false,
      reason: "readonly",
      error: "该看板为静态快照（无查询绑定），不支持数据刷新",
    });
    const res = await callRoute("dash_ab12cd34");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("静态快照");
  });

  it("源不可用 → 502 + 重新分析引导文案", async () => {
    vi.mocked(refreshDashboard).mockResolvedValueOnce({
      ok: false,
      reason: "source-unavailable",
      error: "数据源不可用: pg1；建议基于原提问重新分析",
      sourceId: "pg1",
    });
    const res = await callRoute("dash_ab12cd34");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("重新分析");
  });

  it("全部查询重放失败（replay-failed）→ 502 且不落盘（原 dsl/dataUpdatedAt 保留）", async () => {
    vi.mocked(refreshDashboard).mockResolvedValueOnce({
      ok: false,
      reason: "replay-failed",
      error: "全部取数查询重放失败（源异常或查询已失效），看板数据保持原样；建议基于原提问重新分析",
    });
    const res = await callRoute("dash_ab12cd34");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("重新分析");
    expect(dashboardStore.update).not.toHaveBeenCalled();
  });

  it("DSL 解析失败 → 500 且不落盘", async () => {
    vi.mocked(refreshDashboard).mockResolvedValueOnce({
      ok: false,
      reason: "dsl-invalid",
      error: "看板 DSL 解析失败",
    });
    const res = await callRoute("dash_ab12cd34");
    expect(res.status).toBe(500);
    expect(dashboardStore.update).not.toHaveBeenCalled();
  });
});
