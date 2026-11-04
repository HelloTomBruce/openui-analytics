import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Message } from "@ai-sdk/react";
import { useSessionManager } from "./useSessionManager";
import {
  installSessionServer,
  makeSessionRecord,
  type SessionServer,
} from "@/test/mockSessionApi";

const fakeEvent = { stopPropagation: vi.fn() } as unknown as React.MouseEvent;

const userMessage: Message = { id: "m1", role: "user", content: "分析一下上月营收" };

let server: SessionServer;

async function renderLoaded() {
  const utils = renderHook(() => useSessionManager());
  await waitFor(() => expect(utils.result.current.loaded).toBe(true));
  return utils;
}

beforeEach(() => {
  localStorage.clear();
  server = installSessionServer();
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bootstrap 初始化", () => {
  it("空库：创建初始会话（含欢迎语）、设为活跃、loaded 置位", async () => {
    const { result } = await renderLoaded();

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].title).toBe("营销获客与商业分析会话");
    expect(result.current.currentSessionId).toBe(result.current.sessions[0].id);
    expect(server.activeId).toBe(result.current.sessions[0].id);
    expect(server.records.size).toBe(1);
  });

  it("已有会话：载入列表；活跃指针失效时回落到首条并回写服务端", async () => {
    const old = makeSessionRecord({ title: "旧", updatedAt: 1000 });
    const recent = makeSessionRecord({ title: "新", updatedAt: 3000 });
    server.seed([old, recent], "sess_deadbeef"); // 失效指针

    const { result } = await renderLoaded();

    expect(result.current.sessions.map((s) => s.title)).toEqual(["新", "旧"]);
    expect(result.current.currentSessionId).toBe(recent.id);
    await waitFor(() => expect(server.activeId).toBe(recent.id));
  });

  it("旧 localStorage 会话一次性迁移：保留标题/消息/时间戳，旧键清除", async () => {
    localStorage.setItem(
      "openui_chat_sessions_v1",
      JSON.stringify([
        {
          id: "session_1000_abc",
          title: "遗留会话",
          createdAt: 1000,
          updatedAt: 2000,
          messages: [userMessage],
          enabledSources: ["postgres"],
        },
      ])
    );
    localStorage.setItem("openui_current_session_id_v1", "session_1000_abc");

    const { result } = await renderLoaded();

    expect(result.current.sessions).toHaveLength(1);
    const migrated = [...server.records.values()][0];
    expect(migrated.title).toBe("遗留会话");
    expect(migrated.messages).toHaveLength(1);
    expect(migrated.createdAt).toBe(1000);
    expect(migrated.updatedAt).toBe(2000);
    expect(migrated.enabledSources).toEqual(["postgres"]);
    expect(server.activeId).toBe(migrated.id);
    // 旧键已清除
    expect(localStorage.getItem("openui_chat_sessions_v1")).toBeNull();
    expect(localStorage.getItem("openui_current_session_id_v1")).toBeNull();
  });

  it("迁移幂等：服务端已有同指纹会话时跳过，不产生重复（双标签页场景）", async () => {
    // 模拟另一标签页已完成迁移：服务端已有同 title+createdAt+消息数 的会话
    server.seed([
      makeSessionRecord({
        title: "遗留会话",
        createdAt: 1000,
        updatedAt: 2000,
        messages: [userMessage],
      }),
    ]);
    localStorage.setItem(
      "openui_chat_sessions_v1",
      JSON.stringify([
        {
          id: "session_1000_abc",
          title: "遗留会话",
          createdAt: 1000,
          updatedAt: 2000,
          messages: [userMessage],
        },
      ])
    );

    const { result } = await renderLoaded();

    expect(result.current.sessions).toHaveLength(1); // 无重复
    expect(server.records.size).toBe(1);
    // 旧键同样清除（迁移视为已完成）
    expect(localStorage.getItem("openui_chat_sessions_v1")).toBeNull();
  });

  it("并发 bootstrap（StrictMode 双调用）：初始会话只创建一次", async () => {
    const a = renderHook(() => useSessionManager());
    const b = renderHook(() => useSessionManager());
    await waitFor(() => {
      expect(a.result.current.loaded).toBe(true);
      expect(b.result.current.loaded).toBe(true);
    });

    const titles = [...server.records.values()].map((r) => r.title);
    expect(titles).toEqual(["营销获客与商业分析会话"]);
  });
});

describe("会话增删改", () => {
  it("新建会话：落服务端、设为活跃、同步消息列表", async () => {
    const setMessages = vi.fn();
    const { result } = await renderLoaded();
    act(() => result.current.registerSetMessages(setMessages));
    const before = result.current.sessions.length;

    await act(async () => {
      await result.current.handleCreateNewChat();
    });

    expect(result.current.sessions).toHaveLength(before + 1);
    expect(result.current.currentSessionId).toBe(result.current.sessions[0].id);
    expect(server.activeId).toBe(result.current.currentSessionId);
    expect(setMessages).toHaveBeenCalled();
  });

  it("删除仅剩的一条会话：替换为新会话，被删会话不复活", async () => {
    const { result } = await renderLoaded();
    const onlyId = result.current.sessions[0].id;

    await act(async () => {
      await result.current.handleDeleteSession(fakeEvent, onlyId);
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].id).not.toBe(onlyId);
    expect(server.records.has(onlyId)).toBe(false);
    expect(server.records.has(result.current.sessions[0].id)).toBe(true);
  });

  it("删除中间会话：活跃会话切换到第一条", async () => {
    const { result } = await renderLoaded();
    await act(async () => {
      await result.current.handleCreateNewChat();
    });
    const newId = result.current.currentSessionId;

    await act(async () => {
      await result.current.handleDeleteSession(fakeEvent, newId);
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.currentSessionId).toBe(result.current.sessions[0].id);
    expect(server.records.has(newId)).toBe(false);
  });

  it("清空全部会话：旧会话不复活", async () => {
    const { result } = await renderLoaded();
    await act(async () => {
      await result.current.handleCreateNewChat();
    });
    expect(server.records.size).toBe(2);

    await act(async () => {
      await result.current.handleClearAllSessions();
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(server.records.size).toBe(1);
    expect([...server.records.values()][0].title).toBe("新分析会话");
  });

  it("重命名会话后落盘服务端", async () => {
    const { result } = await renderLoaded();
    const id = result.current.sessions[0].id;

    act(() => result.current.handleStartRename(fakeEvent, result.current.sessions[0]));
    act(() => result.current.setEditingTitleText("营收专项分析"));
    act(() => result.current.handleSaveRename(id));

    expect(result.current.sessions[0].title).toBe("营收专项分析");
    await waitFor(() =>
      expect(server.records.get(id)?.title).toBe("营收专项分析")
    );
  });
});

describe("消息保存", () => {
  it("保存消息：写回服务端、标题由首条用户消息生成、列表按 updatedAt 排序", async () => {
    const { result } = await renderLoaded();
    const id = result.current.currentSessionId;

    act(() => {
      result.current.saveCurrentSessionMessages([
        { id: "w", role: "assistant", content: "欢迎" },
        userMessage,
      ]);
    });

    expect(result.current.sessions[0].title).toBe("分析一下上月营收");
    await waitFor(() => {
      const record = server.records.get(id);
      expect(record?.messages).toHaveLength(2);
      expect(record?.title).toBe("分析一下上月营收");
    });
  });

  it("流式期间切换会话：指定 sessionId 保存时写回发起会话而非当前会话", async () => {
    const { result } = await renderLoaded();
    const originId = result.current.currentSessionId;

    await act(async () => {
      await result.current.handleCreateNewChat();
    });
    const otherId = result.current.currentSessionId;
    expect(otherId).not.toBe(originId);

    act(() => {
      result.current.saveCurrentSessionMessages([userMessage], originId);
    });

    await waitFor(() => {
      expect(server.records.get(originId)?.messages).toHaveLength(1);
    });
    expect(server.records.get(originId)?.messages[0]).toMatchObject({
      content: "分析一下上月营收",
    });
    expect(server.records.get(otherId)?.messages ?? []).not.toContainEqual(
      userMessage
    );
  });
});

describe("数据源选择", () => {
  it("updateSessionSources：设置与恢复全选（null 清除）", async () => {
    const { result } = await renderLoaded();
    const id = result.current.currentSessionId;

    act(() => result.current.updateSessionSources(id, ["postgres"]));
    expect(result.current.activeSession?.enabledSources).toEqual(["postgres"]);
    await waitFor(() =>
      expect(server.records.get(id)?.enabledSources).toEqual(["postgres"])
    );

    act(() => result.current.updateSessionSources(id, undefined));
    expect(result.current.activeSession?.enabledSources).toBeUndefined();
    await waitFor(() =>
      expect(server.records.get(id)?.enabledSources).toBeUndefined()
    );
  });
});

describe("先出思路（planMode）", () => {
  it("默认开（无 planMode 字段的会话视为 true）", async () => {
    const { result } = await renderLoaded();
    expect(result.current.planMode).toBe(true);
  });

  it("setPlanMode：乐观更新 + 持久化到服务端，随会话恢复", async () => {
    const { result } = await renderLoaded();
    const id = result.current.currentSessionId;

    act(() => result.current.setPlanMode(false));
    expect(result.current.planMode).toBe(false);
    await waitFor(() =>
      expect(server.records.get(id)?.planMode).toBe(false)
    );

    act(() => result.current.setPlanMode(true));
    await waitFor(() =>
      expect(server.records.get(id)?.planMode).toBe(true)
    );
  });

  it("切换会话后 planMode 跟随目标会话", async () => {
    const a = makeSessionRecord({ title: "A", updatedAt: 1000, planMode: false });
    const b = makeSessionRecord({ title: "B", updatedAt: 3000 }); // 默认开
    server.seed([a, b], b.id);
    const { result } = await renderLoaded();
    expect(result.current.planMode).toBe(true); // B 默认开

    await act(async () => {
      await result.current.handleSelectSession(a.id);
    });
    expect(result.current.planMode).toBe(false); // A 显式关闭
  });
});

describe("fork / rewind", () => {
  it("forkSession：分叉点前缀历史生成新会话并切换，继承数据源", async () => {
    const seeded = makeSessionRecord({
      title: "CAC 分析",
      enabledSources: ["postgres"],
      messages: [
        { id: "m1", role: "user", content: "分析 CAC" },
        { id: "m2", role: "assistant", content: "思路" },
        { id: "m3", role: "user", content: "确认" },
      ],
    });
    server.seed([seeded], seeded.id);
    const setMessages = vi.fn();
    const { result } = await renderLoaded();
    act(() => result.current.registerSetMessages(setMessages));

    await act(async () => {
      await result.current.forkSession("m2");
    });

    // 新会话在列表首位且成为活跃会话
    expect(result.current.sessions[0].title).toBe("CAC 分析（分叉）");
    expect(result.current.currentSessionId).toBe(result.current.sessions[0].id);
    const forked = server.records.get(result.current.currentSessionId);
    expect(forked?.messages).toHaveLength(2); // 含分叉点 m2
    expect(forked?.enabledSources).toEqual(["postgres"]);
    expect(server.activeId).toBe(result.current.currentSessionId);
    expect(setMessages).toHaveBeenCalled();
    // 原会话不受影响
    expect(server.records.get(seeded.id)?.messages).toHaveLength(3);
  });

  it("rewindSession：截断到该用户消息前、返回内容、上下文元数据清除", async () => {
    const seeded = makeSessionRecord({
      title: "分析会话",
      messages: [
        { id: "m1", role: "user", content: "第一个问题" },
        { id: "m2", role: "assistant", content: "回答一" },
        { id: "m3", role: "user", content: "第二个问题" },
        { id: "m4", role: "assistant", content: "回答二" },
      ],
      context: { lastPromptTokens: 5000, summary: "旧摘要" },
    });
    server.seed([seeded], seeded.id);
    const setMessages = vi.fn();
    const { result } = await renderLoaded();
    act(() => result.current.registerSetMessages(setMessages));
    // 模拟 useChat 同步：当前消息 = 服务端历史
    act(() =>
      result.current.syncMessages(
        seeded.messages as unknown as Message[]
      )
    );

    let rewound: string | null = null;
    act(() => {
      rewound = result.current.rewindSession("m3");
    });

    expect(rewound).toBe("第二个问题");
    expect(setMessages).toHaveBeenLastCalledWith(
      seeded.messages.slice(0, 2)
    );
    await waitFor(() => {
      const record = server.records.get(seeded.id);
      expect(record?.messages).toHaveLength(2);
    });
    // 上下文元数据已请求清除（mock 服务端未实现 context 清除语义，验证请求发出即可：
    // 真实服务端 sessionStore.update(context:null) 行为由存储层单测覆盖）
    const putCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        (args) =>
          String(args[0]) === `/api/sessions/${seeded.id}` &&
          (args[1] as RequestInit)?.method === "PUT"
      );
    expect(putCalls.length).toBeGreaterThan(0);
    expect(String((putCalls.at(-1)?.[1] as RequestInit).body)).toContain(
      '"context":null'
    );
  });

  it("rewindSession：非用户消息返回 null 且不改动", async () => {
    const seeded = makeSessionRecord({
      messages: [
        { id: "m1", role: "user", content: "问题" },
        { id: "m2", role: "assistant", content: "回答" },
      ],
    });
    server.seed([seeded], seeded.id);
    const { result } = await renderLoaded();
    act(() =>
      result.current.syncMessages(seeded.messages as unknown as Message[])
    );

    let rewound: string | null = "x";
    act(() => {
      rewound = result.current.rewindSession("m2");
    });
    expect(rewound).toBeNull();
    expect(server.records.get(seeded.id)?.messages).toHaveLength(2);
  });
});

describe("会话切换与消息快照", () => {
  it("切换会话拉取全文并同步消息流；再次切换命中内存缓存", async () => {
    const a = makeSessionRecord({
      title: "A",
      updatedAt: 1000,
      messages: [userMessage],
    });
    const b = makeSessionRecord({
      title: "B",
      updatedAt: 3000,
      messages: [{ id: "mb", role: "assistant", content: "B 的历史" }],
    });
    server.seed([a, b], b.id);
    const { result } = await renderLoaded();
    expect(result.current.currentSessionId).toBe(b.id);

    const setMessages = vi.fn();
    act(() => result.current.registerSetMessages(setMessages));
    const fetchMock = vi.mocked(fetch);
    const detailFetchCount = () =>
      fetchMock.mock.calls.filter((args) =>
        String(args[0]).match(/\/api\/sessions\/sess_[0-9a-f]+$/)
      ).length;

    // 切到 A：拉全文并同步消息流
    await act(async () => {
      await result.current.handleSelectSession(a.id);
    });
    expect(setMessages).toHaveBeenLastCalledWith([userMessage]);
    expect(server.activeId).toBe(a.id);
    const detailAfterFirstSwitch = detailFetchCount();
    expect(detailAfterFirstSwitch).toBeGreaterThan(0);

    // 切回 B 再切回 A：均命中缓存，不再产生新的详情拉取
    await act(async () => {
      await result.current.handleSelectSession(b.id);
    });
    await act(async () => {
      await result.current.handleSelectSession(a.id);
    });
    expect(detailFetchCount()).toBe(detailAfterFirstSwitch);
    expect(setMessages).toHaveBeenLastCalledWith([userMessage]);
  });

  it("syncMessages/getMessages 读写最新消息快照（供锁定判定与 onFinish）", async () => {
    const { result } = await renderLoaded();
    const msgs: Message[] = [
      { id: "w", role: "assistant", content: "欢迎" },
      userMessage,
    ];
    act(() => result.current.syncMessages(msgs));
    expect(result.current.getMessages()).toEqual(msgs);
  });
});
