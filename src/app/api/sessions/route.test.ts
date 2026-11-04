import { describe, it, expect, vi, afterEach } from "vitest";
import { GET, POST, PUT } from "./route";
import { sessionStore, toSummary } from "@/lib/sessionStore";
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

function jsonRequest(body: unknown, method = "POST") {
  return new Request("http://localhost:3006/api/sessions", {
    method,
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/sessions", () => {
  it("返回摘要列表（不含 messages）与活跃指针", async () => {
    vi.mocked(sessionStore.list).mockResolvedValueOnce([toSummary(RECORD)]);
    vi.mocked(sessionStore.getActiveId).mockResolvedValueOnce(RECORD.id);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions[0].id).toBe(RECORD.id);
    expect(body.sessions[0].messageCount).toBe(1);
    expect(Object.keys(body.sessions[0])).not.toContain("messages");
    expect(body.activeId).toBe(RECORD.id);
  });
});

describe("POST /api/sessions", () => {
  it("新建成功 → 201 + 完整记录（含 messages）", async () => {
    vi.mocked(sessionStore.create).mockResolvedValueOnce({
      ok: true,
      record: RECORD,
    });
    const res = await POST(jsonRequest({ title: RECORD.title }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.session.id).toBe(RECORD.id);
    expect(body.session.messages).toHaveLength(1);
  });

  it("空请求体 → 以缺省参数创建（201）", async () => {
    vi.mocked(sessionStore.create).mockResolvedValueOnce({
      ok: true,
      record: RECORD,
    });
    const res = await POST(jsonRequest("not-json"));
    expect(res.status).toBe(201);
    expect(vi.mocked(sessionStore.create)).toHaveBeenCalledWith({});
  });

  it("存储层校验失败 → 400/413 透传", async () => {
    vi.mocked(sessionStore.create).mockResolvedValueOnce({
      ok: false,
      status: 413,
      errors: ["messages 超过 1000 条上限"],
    });
    const res = await POST(jsonRequest({ messages: [] }));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.errors[0]).toContain("1000");
  });
});

describe("PUT /api/sessions（活跃指针）", () => {
  it("设置活跃会话 → 200 回显", async () => {
    vi.mocked(sessionStore.setActiveId).mockResolvedValueOnce(true);
    const res = await PUT(jsonRequest({ activeId: RECORD.id }, "PUT"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeId).toBe(RECORD.id);
  });

  it("清除活跃会话（null）→ 200", async () => {
    vi.mocked(sessionStore.setActiveId).mockResolvedValueOnce(true);
    const res = await PUT(jsonRequest({ activeId: null }, "PUT"));
    expect(res.status).toBe(200);
  });

  it("activeId 形态非法 → 400；不存在 → 404", async () => {
    const bad = await PUT(jsonRequest({ activeId: 42 }, "PUT"));
    expect(bad.status).toBe(400);

    vi.mocked(sessionStore.setActiveId).mockResolvedValueOnce(false);
    const missing = await PUT(jsonRequest({ activeId: "sess_ffffffff" }, "PUT"));
    expect(missing.status).toBe(404);
  });
});
