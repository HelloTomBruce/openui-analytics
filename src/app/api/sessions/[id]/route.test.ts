import { describe, it, expect, vi, afterEach } from "vitest";
import { GET, PUT, DELETE } from "./route";
import { sessionStore } from "@/lib/sessionStore";
import type { SessionRecord } from "@/lib/sessionStore";

/** 接缝 mock：路由层只验证协议/状态码/载荷形态，落盘行为由存储层单测覆盖 */
vi.mock("@/lib/sessionStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sessionStore")>();
  return {
    ...actual,
    sessionStore: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      getActiveId: vi.fn(),
      setActiveId: vi.fn(),
    },
  };
});

const RECORD: SessionRecord = {
  id: "sess_ab12cd34",
  title: "渠道 CAC 分析",
  createdAt: 100,
  updatedAt: 200,
  messages: [{ id: "m1", role: "user", content: "分析 CAC" }],
};

const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonRequest(body: unknown) {
  return new Request(`http://localhost:3006/api/sessions/${RECORD.id}`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/sessions/:id", () => {
  it("存在 → 200 + 完整记录", async () => {
    vi.mocked(sessionStore.get).mockResolvedValueOnce(RECORD);
    const res = await GET(new Request("http://localhost/"), paramsOf(RECORD.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.messages).toHaveLength(1);
  });

  it("不存在 → 404", async () => {
    vi.mocked(sessionStore.get).mockResolvedValueOnce(null);
    const res = await GET(
      new Request("http://localhost/"),
      paramsOf("sess_ffffffff")
    );
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/sessions/:id", () => {
  it("更新成功 → 200 + 摘要（不含 messages）", async () => {
    vi.mocked(sessionStore.update).mockResolvedValueOnce({
      ok: true,
      record: RECORD,
    });
    const res = await PUT(jsonRequest({ title: "改名" }), paramsOf(RECORD.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.session)).not.toContain("messages");
    expect(body.session.messageCount).toBe(1);
  });

  it("不存在 → 404；校验失败 → 400", async () => {
    vi.mocked(sessionStore.update).mockResolvedValueOnce({
      ok: false,
      status: 404,
      errors: ["会话不存在: sess_ffffffff"],
    });
    const missing = await PUT(
      jsonRequest({ title: "x" }),
      paramsOf("sess_ffffffff")
    );
    expect(missing.status).toBe(404);

    vi.mocked(sessionStore.update).mockResolvedValueOnce({
      ok: false,
      status: 400,
      errors: ["无可更新字段"],
    });
    const empty = await PUT(jsonRequest({}), paramsOf(RECORD.id));
    expect(empty.status).toBe(400);
  });
});

describe("DELETE /api/sessions/:id", () => {
  it("存在 → 204；不存在 → 404", async () => {
    vi.mocked(sessionStore.remove).mockResolvedValueOnce(true);
    const ok = await DELETE(
      new Request("http://localhost/", { method: "DELETE" }),
      paramsOf(RECORD.id)
    );
    expect(ok.status).toBe(204);

    vi.mocked(sessionStore.remove).mockResolvedValueOnce(false);
    const missing = await DELETE(
      new Request("http://localhost/", { method: "DELETE" }),
      paramsOf("sess_ffffffff")
    );
    expect(missing.status).toBe(404);
  });
});
