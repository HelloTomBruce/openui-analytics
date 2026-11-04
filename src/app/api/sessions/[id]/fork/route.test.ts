import { describe, it, expect, vi, afterEach } from "vitest";
import { POST } from "./route";
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

const SOURCE: SessionRecord = {
  id: "sess_ab12cd34",
  title: "CAC 分析",
  createdAt: 100,
  updatedAt: 200,
  enabledSources: ["postgres"],
  messages: [
    { id: "m1", role: "user", content: "分析 CAC" },
    { id: "m2", role: "assistant", content: "思路…" },
    { id: "m3", role: "user", content: "确认" },
  ],
};

const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

function forkRequest(body: unknown) {
  return new Request(`http://localhost:3006/api/sessions/${SOURCE.id}/fork`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/sessions/:id/fork", () => {
  it("分叉成功 → 201 + 前缀历史 + 标题后缀 + 继承数据源", async () => {
    vi.mocked(sessionStore.get).mockResolvedValueOnce(SOURCE);
    const created: SessionRecord = {
      ...SOURCE,
      id: "sess_00000002",
      title: "CAC 分析（分叉）",
      messages: SOURCE.messages.slice(0, 2),
    };
    vi.mocked(sessionStore.create).mockResolvedValueOnce({
      ok: true,
      record: created,
    });

    const res = await POST(forkRequest({ uptoMessageId: "m2" }), paramsOf(SOURCE.id));
    expect(res.status).toBe(201);
    expect(vi.mocked(sessionStore.create)).toHaveBeenCalledWith({
      title: "CAC 分析（分叉）",
      messages: SOURCE.messages.slice(0, 2), // 含分叉点消息
      enabledSources: ["postgres"],
    });
    const body = await res.json();
    expect(body.session.id).toBe("sess_00000002");
    expect(body.session.messages).toHaveLength(2);
  });

  it("消息 id 不存在 → 400；缺 uptoMessageId → 400；会话不存在 → 404", async () => {
    vi.mocked(sessionStore.get).mockResolvedValueOnce(SOURCE);
    const badMsg = await POST(
      forkRequest({ uptoMessageId: "nope" }),
      paramsOf(SOURCE.id)
    );
    expect(badMsg.status).toBe(400);

    vi.mocked(sessionStore.get).mockResolvedValueOnce(SOURCE);
    const missing = await POST(forkRequest({}), paramsOf(SOURCE.id));
    expect(missing.status).toBe(400);

    vi.mocked(sessionStore.get).mockResolvedValueOnce(null);
    const noSession = await POST(
      forkRequest({ uptoMessageId: "m1" }),
      paramsOf("sess_ffffffff")
    );
    expect(noSession.status).toBe(404);
  });
});
