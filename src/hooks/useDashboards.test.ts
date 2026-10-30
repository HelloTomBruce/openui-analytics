import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useDashboards } from "./useDashboards";
import { ACCESS_TOKEN_STORAGE_KEY } from "@/lib/auth";

/** 路由式 fetch mock：按 method 分发到 /api/dashboards 的各端点 */
function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SUMMARY = {
  id: "dash_ab12cd34",
  title: "Bug 收敛漏斗",
  prompt: "本迭代 Bug 收敛情况",
  sourceNames: ["GitLab"],
  origin: { sessionId: "s1", messageId: "m1" },
  createdAt: 100,
  updatedAt: 200,
};

const fetchMock = vi.fn();

function installRouter(routes: {
  get?: Response;
  post?: Response;
  put?: Response;
  del?: Response;
}) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (!url.includes("/api/dashboards")) return jsonResponse(404, {});
    if (method === "POST") return routes.post ?? jsonResponse(201, { dashboard: SUMMARY });
    if (method === "PUT") return routes.put ?? jsonResponse(200, { dashboard: SUMMARY });
    if (method === "DELETE") return routes.del ?? new Response(null, { status: 204 });
    return routes.get ?? jsonResponse(200, { dashboards: [SUMMARY] });
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("useDashboards", () => {
  it("挂载即拉取列表；配置令牌后请求携带 Authorization", async () => {
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, "secret-token");
    installRouter({});

    const { result } = renderHook(() => useDashboards());
    await act(async () => {});

    expect(result.current.summaries).toEqual([SUMMARY]);
    expect(result.current.loaded).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/dashboards");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer secret-token"
    );
  });

  it("favorite 成功（201）→ ok 并自动刷新列表", async () => {
    installRouter({});
    const { result } = renderHook(() => useDashboards());
    await act(async () => {});

    const getCallsBefore = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method !== "POST"
    ).length;

    let res!: { ok: boolean };
    await act(async () => {
      res = await result.current.favorite({
        dsl: "root = Root([])",
        prompt: "p",
        origin: { messageId: "m1" },
      });
    });
    expect(res.ok).toBe(true);

    // POST 后触发了一次刷新 GET
    const getCallsAfter = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method !== "POST"
    ).length;
    expect(getCallsAfter).toBe(getCallsBefore + 1);

    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    ) as [string, RequestInit];
    expect(JSON.parse(postCall[1].body as string)).toEqual({
      dsl: "root = Root([])",
      prompt: "p",
      origin: { messageId: "m1" },
    });
  });

  it("favorite 失败（413）→ 返回服务端 errors 拼接文案", async () => {
    installRouter({
      post: jsonResponse(413, { errors: ["dsl 超过 2097152 字符上限（2MB）"] }),
    });
    const { result } = renderHook(() => useDashboards());
    await act(async () => {});

    let res!: { ok: boolean; error?: string };
    await act(async () => {
      res = await result.current.favorite({ dsl: "x" });
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("2MB");
  });

  it("favorite 网络异常 → 兜底文案", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fetchMock.mockRejectedValueOnce(new Error("offline")); // 首次 GET + POST 都失败
    const { result } = renderHook(() => useDashboards());
    await act(async () => {});

    let res!: { ok: boolean; error?: string };
    await act(async () => {
      res = await result.current.favorite({ dsl: "x" });
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("收藏失败：网络错误");
  });

  it("rename / remove 成功返回 true；失败返回 false", async () => {
    installRouter({});
    const { result } = renderHook(() => useDashboards());
    await act(async () => {});

    let ok!: boolean;
    await act(async () => {
      ok = await result.current.rename("dash_ab12cd34", "新名字");
    });
    expect(ok).toBe(true);

    await act(async () => {
      ok = await result.current.remove("dash_ab12cd34");
    });
    expect(ok).toBe(true);

    // 失败路径：全部端点改 500
    installRouter({
      get: jsonResponse(500, {}),
      put: jsonResponse(500, {}),
      del: jsonResponse(500, {}),
    });
    await act(async () => {
      ok = await result.current.rename("dash_ab12cd34", "x");
    });
    expect(ok).toBe(false);
    await act(async () => {
      ok = await result.current.remove("dash_ab12cd34");
    });
    expect(ok).toBe(false);
  });

  it("列表接口 500 → 静默降级：summaries 空、loaded 仍为 true", async () => {
    installRouter({ get: jsonResponse(500, {}) });
    const { result } = renderHook(() => useDashboards());
    await act(async () => {});
    expect(result.current.summaries).toEqual([]);
    expect(result.current.loaded).toBe(true);
  });
});
