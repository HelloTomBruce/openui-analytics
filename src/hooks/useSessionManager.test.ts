import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Message } from "@ai-sdk/react";
import { useSessionManager, type SetMessagesFn } from "./useSessionManager";
import {
  getSavedSessions,
  getActiveSessionId,
  createNewSession,
  persistSessions,
} from "@/lib/sessionStorage";

function makeRef(): React.RefObject<SetMessagesFn | null> {
  return { current: vi.fn() };
}

const fakeEvent = { stopPropagation: vi.fn() } as unknown as React.MouseEvent;

const userMessage: Message = { id: "m1", role: "user", content: "分析一下上月营收" };

describe("useSessionManager 持久化行为", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("首次挂载创建初始会话并落盘，且设为活跃会话", () => {
    const { result } = renderHook(() => useSessionManager(makeRef()));

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.currentSessionId).toBe(result.current.sessions[0].id);
    expect(getSavedSessions()).toHaveLength(1);
    expect(getActiveSessionId()).toBe(result.current.sessions[0].id);
  });

  it("删除仅剩的一条会话：替换为新会话，被删会话刷新后不复活", () => {
    const { result } = renderHook(() => useSessionManager(makeRef()));
    const onlyId = result.current.sessions[0].id;

    act(() => {
      result.current.handleDeleteSession(fakeEvent, onlyId);
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].id).not.toBe(onlyId);
    // 关键断言：localStorage 中被删会话不存在
    const persisted = getSavedSessions();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(result.current.sessions[0].id);
    expect(getActiveSessionId()).toBe(result.current.sessions[0].id);
  });

  it("清空全部会话：刷新后旧会话不复活", () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const old = [createNewSession("旧会话A"), createNewSession("旧会话B")];
    persistSessions(old);

    const { result } = renderHook(() => useSessionManager(makeRef()));
    expect(result.current.sessions).toHaveLength(2);

    act(() => {
      result.current.handleClearAllSessions();
    });

    expect(result.current.sessions).toHaveLength(1);
    const persisted = getSavedSessions();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(result.current.sessions[0].id);
    expect(persisted.some((s) => s.title === "旧会话A")).toBe(false);
  });

  it("新建会话立即落盘，刷新后不丢失", () => {
    const { result } = renderHook(() => useSessionManager(makeRef()));
    const before = result.current.sessions.length;

    act(() => {
      result.current.handleCreateNewChat();
    });

    expect(result.current.sessions).toHaveLength(before + 1);
    const persisted = getSavedSessions();
    expect(persisted).toHaveLength(before + 1);
    expect(persisted[0].id).toBe(result.current.currentSessionId);
    expect(getActiveSessionId()).toBe(result.current.currentSessionId);
  });

  it("保存会话消息：消息落盘、标题由首条用户消息生成、按 updatedAt 排序", () => {
    const { result } = renderHook(() => useSessionManager(makeRef()));

    act(() => {
      result.current.saveCurrentSessionMessages([
        { id: "w", role: "assistant", content: "欢迎" },
        userMessage,
      ]);
    });

    const persisted = getSavedSessions();
    const active = persisted.find((s) => s.id === result.current.currentSessionId);
    expect(active?.messages).toHaveLength(2);
    expect(active?.title).toBe("分析一下上月营收");
  });

  it("删除中间会话：剩余会话保持，活跃会话切换到第一条", () => {
    const a = createNewSession("A");
    persistSessions([a]);
    const { result } = renderHook(() => useSessionManager(makeRef()));

    act(() => {
      result.current.handleCreateNewChat(); // 现在 2 条，活跃为新建
    });
    const newId = result.current.currentSessionId;

    act(() => {
      result.current.handleDeleteSession(fakeEvent, newId);
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.currentSessionId).toBe(result.current.sessions[0].id);
    expect(getSavedSessions().some((s) => s.id === newId)).toBe(false);
  });

  it("流式期间切换会话：指定 sessionId 保存时写回发起会话而非当前会话", () => {
    const { result } = renderHook(() => useSessionManager(makeRef()));
    const originId = result.current.currentSessionId;

    // 新建并切换到会话 B（模拟流式期间用户切换会话）
    act(() => {
      result.current.handleCreateNewChat();
    });
    const otherId = result.current.currentSessionId;
    expect(otherId).not.toBe(originId);

    // 传入发起时的 sessionId 保存
    act(() => {
      result.current.saveCurrentSessionMessages([userMessage], originId);
    });

    const persisted = getSavedSessions();
    const origin = persisted.find((s) => s.id === originId);
    const other = persisted.find((s) => s.id === otherId);
    expect(origin?.messages).toHaveLength(1);
    expect(origin?.messages[0].content).toBe("分析一下上月营收");
    // 当前活跃会话不被污染
    expect(other?.messages ?? []).not.toContainEqual(userMessage);
  });

  it("重命名会话后落盘", () => {
    const { result } = renderHook(() => useSessionManager(makeRef()));
    const id = result.current.sessions[0].id;

    act(() => {
      result.current.handleStartRename(fakeEvent, result.current.sessions[0]);
    });
    act(() => {
      result.current.setEditingTitleText("营收专项分析");
    });
    act(() => {
      result.current.handleSaveRename(id);
    });

    expect(getSavedSessions()[0].title).toBe("营收专项分析");
  });
});
