"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Message } from "@ai-sdk/react";
import {
  ChatSession,
  getSavedSessions,
  persistSessions,
  getActiveSessionId,
  setActiveSessionId,
  createNewSession,
  generateSessionTitle,
  DEFAULT_WELCOME_MESSAGE,
} from "@/lib/sessionStorage";

export type SetMessagesFn = (messages: Message[]) => void;

/**
 * 会话管理：会话列表、活跃会话、增删改查与重命名。
 *
 * useChat 的 initialMessages 需要先由本 hook 提供，而会话切换又需要调用
 * useChat 的 setMessages —— 存在构造顺序环，因此通过 setMessagesRef 延迟注入：
 * ChatDashboard 先创建 ref 传给本 hook，useChat 返回后把 setMessages 写入 ref。
 * 所有 handler 仅在用户交互时触发，此时 ref 必定已就绪。
 */
export function useSessionManager(
  setMessagesRef: React.RefObject<SetMessagesFn | null>
) {
  // 会话列表与活跃会话一次性协同初始化，保证两者一致
  // （持久化副作用已下沉到下方 useEffect 单点完成）。
  // 注：本 hook 依赖 localStorage 惰性初始化，前提是入口 page.tsx 以
  // dynamic(ssr:false) 挂载 ChatDashboard，组件不参与 SSR，故无水合不一致；
  // 若未来改为 SSR 挂载，需改为「默认值 + mounted 后载入」模式。
  const [initialState] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = getSavedSessions();
      if (saved.length > 0) {
        const active = getActiveSessionId();
        const activeId =
          active && saved.some((s) => s.id === active) ? active : saved[0].id;
        return { sessions: saved, activeId };
      }
      const initial = createNewSession("营销获客与商业分析会话");
      return { sessions: [initial], activeId: initial.id };
    }
    return { sessions: [] as ChatSession[], activeId: "" };
  });

  const [sessions, setSessions] = useState<ChatSession[]>(initialState.sessions);
  const [currentSessionId, setCurrentSessionIdState] = useState<string>(initialState.activeId);

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitleText, setEditingTitleText] = useState("");

  const currentSessionIdRef = useRef(currentSessionId);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // 单点持久化：sessions / 活跃 id 的任何变更统一落盘，
  // 各 handler 不再需要（也不允许）各自调用 persistSessions。
  useEffect(() => {
    if (sessions.length > 0) persistSessions(sessions);
  }, [sessions]);
  useEffect(() => {
    if (currentSessionId) setActiveSessionId(currentSessionId);
  }, [currentSessionId]);

  // 保存消息列表到指定会话（缺省为当前活跃会话）。
  // 流式期间用户可能已切换会话，调用方应传入发起请求时的 sessionId，
  // 避免把 A 会话的内容写进 B 会话。
  const saveCurrentSessionMessages = useCallback(
    (newMessages: Message[], targetSessionId?: string) => {
      const activeId = targetSessionId ?? currentSessionIdRef.current;
      if (!activeId || newMessages.length === 0) return;

      setSessions((prevSessions) => {
        const sessionIndex = prevSessions.findIndex((s) => s.id === activeId);
        if (sessionIndex === -1) return prevSessions;

        const current = prevSessions[sessionIndex];
        let title = current.title;
        const firstUserMessage = newMessages.find((m) => m.role === "user");
        if (
          (title === "新建分析会话" ||
            title === "营销获客与商业分析会话" ||
            title === "新分析会话") &&
          firstUserMessage
        ) {
          title = generateSessionTitle(firstUserMessage.content);
        }

        const updatedSession: ChatSession = {
          ...current,
          title,
          updatedAt: Date.now(),
          messages: newMessages,
        };

        const nextSessions = [...prevSessions];
        nextSessions[sessionIndex] = updatedSession;
        nextSessions.sort((a, b) => b.updatedAt - a.updatedAt);
        return nextSessions;
      });
    },
    []
  );

  // 计算初始会话消息
  const initialMessages = useMemo(() => {
    if (typeof window !== "undefined") {
      const active = getActiveSessionId();
      const saved = getSavedSessions();
      const current = saved.find((s) => s.id === active) || saved[0];
      if (current && current.messages && current.messages.length > 0) {
        return current.messages;
      }
    }
    return [DEFAULT_WELCOME_MESSAGE];
  }, []);

  const setMessages = useCallback(
    (messages: Message[]) => setMessagesRef.current?.(messages),
    [setMessagesRef]
  );

  // 新建会话
  const handleCreateNewChat = useCallback(() => {
    const newSession = createNewSession();
    setSessions((prev) => [newSession, ...prev]);
    setCurrentSessionIdState(newSession.id);
    setMessages(newSession.messages);
  }, [setMessages]);

  // 切换会话
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      if (sessionId === currentSessionId) return;
      const target = sessions.find((s) => s.id === sessionId);
      if (!target) return;
      setCurrentSessionIdState(sessionId);
      setMessages(target.messages || [DEFAULT_WELCOME_MESSAGE]);
    },
    [currentSessionId, sessions, setMessages]
  );

  // 删除会话
  const handleDeleteSession = useCallback(
    (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      if (sessions.length <= 1) {
        const fresh = createNewSession("新分析会话");
        setSessions([fresh]);
        setCurrentSessionIdState(fresh.id);
        setMessages(fresh.messages);
        return;
      }

      const nextSessions = sessions.filter((s) => s.id !== sessionId);
      setSessions(nextSessions);

      if (currentSessionId === sessionId) {
        const nextActive = nextSessions[0];
        setCurrentSessionIdState(nextActive.id);
        setMessages(nextActive.messages || [DEFAULT_WELCOME_MESSAGE]);
      }
    },
    [sessions, currentSessionId, setMessages]
  );

  // 开始重命名会话
  const handleStartRename = (e: React.MouseEvent, session: ChatSession) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitleText(session.title);
  };

  // 确认保存重命名
  const handleSaveRename = (sessionId: string) => {
    if (!editingTitleText.trim()) {
      setEditingSessionId(null);
      return;
    }
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, title: editingTitleText.trim() } : s
      )
    );
    setEditingSessionId(null);
  };

  // 清空所有历史会话
  const handleClearAllSessions = () => {
    if (confirm("确定要清空全部历史会话记录吗？此操作不可逆。")) {
      const fresh = createNewSession("新分析会话");
      setSessions([fresh]);
      setCurrentSessionIdState(fresh.id);
      setMessages(fresh.messages);
    }
  };

  const activeSession = sessions.find((s) => s.id === currentSessionId);

  return {
    sessions,
    currentSessionId,
    activeSession,
    editingSessionId,
    editingTitleText,
    setEditingSessionId,
    setEditingTitleText,
    initialMessages,
    saveCurrentSessionMessages,
    handleCreateNewChat,
    handleSelectSession,
    handleDeleteSession,
    handleStartRename,
    handleSaveRename,
    handleClearAllSessions,
  };
}
