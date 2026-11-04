"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Message } from "@ai-sdk/react";
import type {
  SessionRecord,
  SessionSummary,
} from "@/lib/sessionStore";
import {
  fetchSession,
  createSessionApi,
  updateSessionApi,
  deleteSessionApi,
  setActiveSessionApi,
  forkSessionApi,
  ensureSessionsReady,
} from "@/lib/sessionApi";
import {
  DEFAULT_WELCOME_MESSAGE,
  generateSessionTitle,
} from "@/lib/sessionStorage";
import { toast } from "@/lib/toast";

export type SetMessagesFn = (messages: Message[]) => void;

/** 这些标题视为「未命名」，首条用户消息到达时自动按内容生成标题 */
const DEFAULT_TITLES = new Set([
  "新建分析会话",
  "营销获客与商业分析会话",
  "新分析会话",
]);

/** 完整记录 → 列表摘要（与服务端 toSummary 同规则；服务端模块含 node:fs 不可客户端引入） */
function toSummaryLocal(record: SessionRecord): SessionSummary {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.enabledSources !== undefined
      ? { enabledSources: record.enabledSources }
      : {}),
    ...(record.planMode !== undefined ? { planMode: record.planMode } : {}),
    messageCount: record.messages.length,
  };
}

function sortSummaries(list: SessionSummary[]): SessionSummary[] {
  return [...list].sort(
    (a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt
  );
}

/**
 * 会话管理（v2：服务端为唯一数据源，无 localStorage 缓存）。
 *
 * - 首次挂载 bootstrap：迁移旧 localStorage 会话 → 拉列表 → 拉活跃会话全文
 * - 完整 messages 只保存在运行期内存缓存（messagesCacheRef），页面刷新即弃
 * - 写操作乐观更新本地状态，后台同步服务端；失败 toast 提示（不回滚，
 *   下次刷新以服务端为准自愈）
 * - useChat 构造顺序环解法不变：setMessages 延迟注册（registerSetMessages），
 *   bootstrap/切换会话拿到完整消息后经它同步进消息流
 */
export function useSessionManager() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionIdState] = useState<string>("");
  // bootstrap 完成前 ChatDashboard 显示加载态（会话数据未到，禁止输入）
  const [loaded, setLoaded] = useState(false);

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitleText, setEditingTitleText] = useState("");

  // 运行期完整消息缓存（非持久化）：切换会话免重复拉取
  const messagesCacheRef = useRef(new Map<string, SessionRecord["messages"]>());

  // useChat 的 setMessages 延迟注册（构造顺序环）：切换/新建会话时同步消息列表
  const setMessagesRef = useRef<SetMessagesFn | null>(null);
  const registerSetMessages = useCallback((fn: SetMessagesFn) => {
    setMessagesRef.current = fn;
  }, []);
  const setMessages = useCallback(
    (messages: Message[]) => setMessagesRef.current?.(messages),
    []
  );

  // 最新消息快照：onFinish 保存与数据源锁定判定需要流式期间的最新 messages
  const messagesRef = useRef<Message[]>([]);
  const syncMessages = useCallback((messages: Message[]) => {
    messagesRef.current = messages;
  }, []);
  const getMessages = useCallback(() => messagesRef.current, []);

  const currentSessionIdRef = useRef(currentSessionId);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // 会话切换竞态守卫：快速连点时只应用最后一次切换拉到的消息
  const switchSeqRef = useRef(0);

  // sessions 的最新快照（异步回调内读取，避免闭包过期）
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  /** 拉完整会话（缓存命中直接返回）；竞态守卫由调用方配合 switchSeq 使用 */
  const loadSessionRecord = useCallback(
    async (id: string): Promise<SessionRecord | null> => {
      const cached = messagesCacheRef.current.get(id);
      if (cached) {
        return {
          id,
          title: "",
          createdAt: 0,
          updatedAt: 0,
          messages: cached,
        };
      }
      const record = await fetchSession(id);
      if (record) messagesCacheRef.current.set(record.id, record.messages);
      return record;
    },
    []
  );

  // ========== bootstrap：幂等就绪（迁移+空库创建）→ 活跃会话全文（仅首挂载执行） ==========
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // ensureSessionsReady：并发/StrictMode 双调用共享在途 Promise，副作用只执行一次
        const ready = await ensureSessionsReady({
          title: "营销获客与商业分析会话",
          messages: [
            DEFAULT_WELCOME_MESSAGE,
          ] as unknown as SessionRecord["messages"],
        });
        if (!ready) {
          toast("会话服务不可用，请检查服务后刷新", "error");
          return;
        }
        const { list, created } = ready;
        if (created) messagesCacheRef.current.set(created.id, created.messages);

        if (cancelled) return;
        const targetId =
          list.activeId && list.sessions.some((s) => s.id === list.activeId)
            ? list.activeId
            : list.sessions[0].id;

        setSessions(list.sessions);
        setCurrentSessionIdState(targetId);
        currentSessionIdRef.current = targetId;
        if (targetId !== list.activeId) void setActiveSessionApi(targetId);

        const record = await loadSessionRecord(targetId);
        if (cancelled) return;
        if (record) {
          setMessages(record.messages as unknown as Message[]);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ========== 写操作（乐观更新 + 后台同步服务端） ==========

  /**
   * 保存消息列表到指定会话（缺省为当前活跃会话）。
   * 流式期间用户可能已切换会话，调用方应传入发起请求时的 sessionId，
   * 避免把 A 会话的内容写进 B 会话。
   */
  const saveCurrentSessionMessages = useCallback(
    (newMessages: Message[], targetSessionId?: string) => {
      const activeId = targetSessionId ?? currentSessionIdRef.current;
      if (!activeId || newMessages.length === 0) return;

      // 标题推导（本地乐观更新与提交服务端的口径一致）
      const summary = sessionsRef.current.find((s) => s.id === activeId);
      const firstUser = newMessages.find((m) => m.role === "user");
      const nextTitle =
        summary && DEFAULT_TITLES.has(summary.title) && firstUser
          ? generateSessionTitle(firstUser.content)
          : undefined;

      // 本地缓存与列表摘要乐观更新
      messagesCacheRef.current.set(
        activeId,
        newMessages as unknown as SessionRecord["messages"]
      );
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === activeId);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = {
          ...prev[idx],
          ...(nextTitle ? { title: nextTitle } : {}),
          updatedAt: Date.now(),
          messageCount: newMessages.length,
        };
        return sortSummaries(next);
      });

      // 后台同步服务端
      void updateSessionApi(activeId, {
        messages: newMessages as unknown as SessionRecord["messages"],
        ...(nextTitle ? { title: nextTitle } : {}),
      }).then((ok) => {
        if (!ok) toast("会话保存失败，刷新后以服务端内容为准", "error");
      });
    },
    []
  );

  // 新建会话
  const handleCreateNewChat = useCallback(async () => {
    const created = await createSessionApi({
      title: "新建分析会话",
      messages: [DEFAULT_WELCOME_MESSAGE] as unknown as SessionRecord["messages"],
    });
    if (!created) {
      toast("新建会话失败", "error");
      return;
    }
    messagesCacheRef.current.set(created.id, created.messages);
    setSessions((prev) => sortSummaries([toSummaryLocal(created), ...prev]));
    setCurrentSessionIdState(created.id);
    switchSeqRef.current++;
    setMessages(created.messages as unknown as Message[]);
    void setActiveSessionApi(created.id);
  }, [setMessages]);

  // 切换会话（竞态守卫：快速连点只应用最后一次）
  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === currentSessionIdRef.current) return;
      const seq = ++switchSeqRef.current;
      setCurrentSessionIdState(sessionId);
      currentSessionIdRef.current = sessionId;
      void setActiveSessionApi(sessionId);

      const record = await loadSessionRecord(sessionId);
      if (seq !== switchSeqRef.current) return; // 已被更新的切换取代
      if (record) {
        setMessages(record.messages as unknown as Message[]);
      } else {
        toast("会话加载失败", "error");
      }
    },
    [loadSessionRecord, setMessages]
  );

  // 删除会话
  const handleDeleteSession = useCallback(
    async (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      const remaining = sessionsRef.current.filter((s) => s.id !== sessionId);
      const wasCurrent = currentSessionIdRef.current === sessionId;

      // 仅剩一条时：删除后立刻新建空白会话（保证列表永不为空）
      if (remaining.length === 0) {
        const ok = await deleteSessionApi(sessionId);
        if (!ok) {
          toast("删除会话失败", "error");
          return;
        }
        messagesCacheRef.current.delete(sessionId);
        const created = await createSessionApi({
          title: "新分析会话",
          messages: [DEFAULT_WELCOME_MESSAGE] as unknown as SessionRecord["messages"],
        });
        if (!created) {
          setSessions([]);
          toast("删除成功，但新建会话失败，请刷新", "error");
          return;
        }
        messagesCacheRef.current.set(created.id, created.messages);
        setSessions([toSummaryLocal(created)]);
        setCurrentSessionIdState(created.id);
        switchSeqRef.current++;
        setMessages(created.messages as unknown as Message[]);
        void setActiveSessionApi(created.id);
        return;
      }

      const ok = await deleteSessionApi(sessionId);
      if (!ok) {
        toast("删除会话失败", "error");
        return;
      }
      messagesCacheRef.current.delete(sessionId);
      setSessions(sortSummaries(remaining));

      if (wasCurrent) {
        const next = sortSummaries(remaining)[0];
        setCurrentSessionIdState(next.id);
        switchSeqRef.current++;
        void setActiveSessionApi(next.id);
        const record = await loadSessionRecord(next.id);
        if (record) setMessages(record.messages as unknown as Message[]);
      }
    },
    [loadSessionRecord, setMessages]
  );

  // 开始重命名会话
  const handleStartRename = useCallback(
    (e: React.MouseEvent, session: SessionSummary) => {
      e.stopPropagation();
      setEditingSessionId(session.id);
      setEditingTitleText(session.title);
    },
    []
  );

  // 确认保存重命名
  const handleSaveRename = useCallback((sessionId: string) => {
    setEditingTitleText((text) => {
      const trimmed = text.trim();
      if (trimmed) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, title: trimmed } : s))
        );
        void updateSessionApi(sessionId, { title: trimmed }).then((ok) => {
          if (!ok) toast("重命名保存失败", "error");
        });
      }
      return text;
    });
    setEditingSessionId(null);
  }, []);

  // 清空所有历史会话
  const handleClearAllSessions = useCallback(async () => {
    if (!confirm("确定要清空全部历史会话记录吗？此操作不可逆。")) return;
    const all = sessionsRef.current;
    const results = await Promise.all(all.map((s) => deleteSessionApi(s.id)));
    if (results.some((ok) => !ok)) {
      toast("部分会话删除失败，请刷新后重试", "error");
    }
    messagesCacheRef.current.clear();
    const created = await createSessionApi({
      title: "新分析会话",
      messages: [DEFAULT_WELCOME_MESSAGE] as unknown as SessionRecord["messages"],
    });
    if (!created) {
      setSessions([]);
      toast("新建会话失败，请刷新", "error");
      return;
    }
    messagesCacheRef.current.set(created.id, created.messages);
    setSessions([toSummaryLocal(created)]);
    setCurrentSessionIdState(created.id);
    switchSeqRef.current++;
    setMessages(created.messages as unknown as Message[]);
    void setActiveSessionApi(created.id);
  }, [setMessages]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId),
    [sessions, currentSessionId]
  );

  // 先出思路（Plan-first）：随会话持久化在服务端，undefined = 默认开
  const planMode = activeSession?.planMode ?? true;
  const setPlanMode = useCallback(
    (value: boolean) => {
      const id = currentSessionIdRef.current;
      if (!id) return;
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, planMode: value } : s))
      );
      void updateSessionApi(id, { planMode: value }).then((ok) => {
        if (!ok) toast("「先出思路」设置保存失败", "error");
      });
    },
    []
  );

  // 分叉：从某条消息复制前缀历史生成新会话并切换过去
  const forkSession = useCallback(
    async (messageId: string) => {
      const sourceId = currentSessionIdRef.current;
      if (!sourceId) return;
      const created = await forkSessionApi(sourceId, messageId);
      if (!created) {
        toast("分叉失败", "error");
        return;
      }
      messagesCacheRef.current.set(created.id, created.messages);
      setSessions((prev) => sortSummaries([toSummaryLocal(created), ...prev]));
      setCurrentSessionIdState(created.id);
      switchSeqRef.current++;
      setMessages(created.messages as unknown as Message[]);
      void setActiveSessionApi(created.id);
      toast("已分叉为新会话", "success");
    },
    [setMessages]
  );

  // 回滚重问：截断到某条用户消息之前（该消息内容返回给调用方填入输入框），
  // 上下文元数据一并清除（历史已变，旧锚点/摘要失效）。
  // 返回被回滚消息的内容；消息不存在或不是用户消息返回 null。
  const rewindSession = useCallback(
    (messageId: string): string | null => {
      const activeId = currentSessionIdRef.current;
      if (!activeId) return null;
      const messages = messagesRef.current;
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx === -1 || messages[idx].role !== "user") return null;

      const truncated = messages.slice(0, idx);
      const rewound = messages[idx];
      messagesCacheRef.current.set(
        activeId,
        truncated as unknown as SessionRecord["messages"]
      );
      setSessions((prev) => {
        const i = prev.findIndex((s) => s.id === activeId);
        if (i === -1) return prev;
        const next = [...prev];
        next[i] = {
          ...prev[i],
          updatedAt: Date.now(),
          messageCount: truncated.length,
        };
        return sortSummaries(next);
      });
      setMessages(truncated);
      void updateSessionApi(activeId, {
        messages: truncated as unknown as SessionRecord["messages"],
        context: null, // 历史已变：重置 token 锚点与摘要缓存
      }).then((ok) => {
        if (!ok) toast("回滚保存失败，刷新后以服务端内容为准", "error");
      });
      return rewound.content;
    },
    [setMessages]
  );

  // 更新会话的数据源选择（undefined = 全选，线上以 null 清除）
  const updateSessionSources = useCallback(
    (sessionId: string, ids: string[] | undefined) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const copy = { ...s };
          if (ids === undefined) delete copy.enabledSources;
          else copy.enabledSources = ids;
          return copy;
        })
      );
      void updateSessionApi(sessionId, {
        enabledSources: ids ?? null,
      }).then((ok) => {
        if (!ok) toast("数据源设置保存失败", "error");
      });
    },
    []
  );

  return {
    sessions,
    currentSessionId,
    activeSession,
    loaded,
    editingSessionId,
    editingTitleText,
    setEditingSessionId,
    setEditingTitleText,
    saveCurrentSessionMessages,
    updateSessionSources,
    registerSetMessages,
    syncMessages,
    getMessages,
    handleCreateNewChat,
    handleSelectSession,
    handleDeleteSession,
    handleStartRename,
    handleSaveRename,
    handleClearAllSessions,
    forkSession,
    rewindSession,
    planMode,
    setPlanMode,
  };
}
