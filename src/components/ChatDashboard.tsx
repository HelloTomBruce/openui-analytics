"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { TrendingUp, Plus, Code2, Settings, RefreshCw } from "lucide-react";
import { DEFAULT_SANDBOX_CODE } from "@/lib/presetQueries";
import { upsertMessage } from "@/lib/messages";
import { useLlmSettings } from "@/hooks/useLlmSettings";
import { useSessionManager } from "@/hooks/useSessionManager";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { MessageList } from "@/components/chat/MessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { SourcePicker } from "@/components/chat/SourcePicker";
import { useDatasourceList } from "@/components/chat/datasources/useDatasources";
import { SettingsModal } from "@/components/chat/SettingsModal";
import { DevToolsPanel } from "@/components/chat/DevToolsPanel";
import { Toaster } from "@/components/Toaster";
import { toast } from "@/lib/toast";

/**
 * 组合层：唯一接线点。
 * 状态在 useLlmSettings / useSessionManager 中管理，展示在 chat/ 下的专注子组件中。
 */
export default function ChatDashboard() {
  const [showRawLang, setShowRawLang] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
  const [devToolsCode, setDevToolsCode] = useState(DEFAULT_SANDBOX_CODE);
  // Plan-first：新问题先出分析思路（默认关）；「先出思路」开关
  const [planMode, setPlanMode] = useState(false);

  const {
    showSettings,
    setShowSettings,
    apiKey,
    setApiKey,
    baseURL,
    setBaseURL,
    model,
    setModel,
    accessToken,
    setAccessToken,
    temperature,
    setTemperature,
    protocol,
    setProtocol,
    authHeaders,
    saveSettings,
    chatBody,
  } = useLlmSettings();

  // useChat 的 initialMessages 由 useSessionManager 提供，而会话切换又需要
  // useChat 的 setMessages —— 通过 registerSetMessages 延迟注入打破构造顺序环（见 hook 注释）。
  // 发起请求时的会话 id：流式期间用户可能切换会话，onFinish 须写回发起会话
  const streamingSessionIdRef = useRef<string | null>(null);

  const {
    sessions,
    currentSessionId,
    activeSession,
    editingSessionId,
    editingTitleText,
    setEditingSessionId,
    setEditingTitleText,
    initialMessages,
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
  } = useSessionManager();

  const handleChatError = useCallback((err: Error) => {
    console.error("Chat error:", err);
  }, []);

  // 会话级数据源：列表来自 /api/datasources，勾选集写入当前会话并随请求体透传
  const { sources: allDatasources } = useDatasourceList();
  const enabledPickerSources = useMemo(
    () => allDatasources.filter((s) => s.enabled !== false),
    [allDatasources]
  );
  const handleSourcesChange = useCallback(
    (ids: string[]) => {
      if (!currentSessionId) return;
      // 会话开始后锁定：上下文已建立在既有源上，中途改动会造成工具归因不一致
      if (getMessages().some((m) => m.role === "user")) return;
      const allIds = enabledPickerSources.map((s) => s.id);
      const isFullSelection =
        ids.length === allIds.length && allIds.every((id) => ids.includes(id));
      // 全选恢复 undefined 语义：后续新增源自动纳入本会话
      updateSessionSources(currentSessionId, isFullSelection ? undefined : ids);
    },
    [currentSessionId, enabledPickerSources, updateSessionSources, getMessages]
  );
  const chatBodyWithSources = useMemo(
    () => ({ ...chatBody, sources: activeSession?.enabledSources }),
    [chatBody, activeSession?.enabledSources]
  );
  // 当前会话实际启用的源（名称+id）：驱动加载提示与工具归因展示；useMemo 保 MessageItem memo 生效
  const sessionSources = useMemo(() => {
    const sel = activeSession?.enabledSources;
    const list = sel
      ? enabledPickerSources.filter((s) => sel.includes(s.id))
      : enabledPickerSources;
    return list.map((s) => ({ id: s.id, name: s.name }));
  }, [enabledPickerSources, activeSession?.enabledSources]);

  // 使用 Next.js 官方 Vercel AI SDK 的 useChat Hook
  const {
    messages,
    setMessages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    append,
    isLoading,
    error,
    reload,
  } = useChat({
    api: "/api/analyze",
    body: chatBodyWithSources,
    headers: authHeaders(),
    onError: handleChatError,
    initialMessages,
    onFinish: (message) => {
      // 流式结束时保存：用 getMessages() 读取最新列表（含多步工具调用的中间消息），
      // upsert 防止与 AI SDK 已合入的最终消息重复；写回发起请求时的会话。
      saveCurrentSessionMessages(
        upsertMessage(getMessages(), message),
        streamingSessionIdRef.current ?? undefined
      );
    },
  });

  // useChat 就绪后注入 setMessages 与最新消息快照（均由 useSessionManager 内部持有）
  useEffect(() => {
    registerSetMessages(setMessages);
  }, [setMessages, registerSetMessages]);
  useEffect(() => {
    syncMessages(messages);
  }, [messages, syncMessages]);

  // 会话开始（存在用户消息）即锁定数据源选择：仅初始会话（只有欢迎语）可勾选
  const sourcesLocked = messages.some((m) => m.role === "user");

  // Plan-first 状态机：最近一条 assistant 消息含 PlanReviewCard ⇒ 规划待确认，
  // 下一条消息（打字答复或确认按钮注入）按 execute 发送；否则开关开启时按 plan；
  // 都不满足则不带 mode（direct，向后兼容）。会话切换/刷新后由消息历史自然恢复。
  const awaitingPlanConfirm = useMemo(() => {
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    return Boolean(
      lastAssistant &&
        /PlanReviewCard\s*\(/.test(String(lastAssistant.content ?? ""))
    );
  }, [messages]);

  const nextModeBody = useCallback((): { mode?: "plan" | "execute" } => {
    if (awaitingPlanConfirm) return { mode: "execute" };
    if (planMode) return { mode: "plan" };
    return {};
  }, [awaitingPlanConfirm, planMode]);

  // 提交/追加消息时记录发起会话，供 onFinish 定向保存
  const handleChatSubmit = useCallback(
    (e?: React.FormEvent<HTMLFormElement>) => {
      streamingSessionIdRef.current = currentSessionId;
      handleSubmit(e, { body: nextModeBody() });
    },
    [handleSubmit, currentSessionId, nextModeBody]
  );

  const handleRendererAction = useCallback(
    (actionPrompt: string) => {
      streamingSessionIdRef.current = currentSessionId;
      append({ role: "user", content: actionPrompt }, { body: nextModeBody() });
    },
    [append, currentSessionId, nextModeBody]
  );

  // 预设场景方向已明确，始终直出看板：不进规划模式，也不受待确认规划影响
  const handlePresetSelect = useCallback(
    (msg: string) => {
      streamingSessionIdRef.current = currentSessionId;
      append({ role: "user", content: msg });
    },
    [append, currentSessionId]
  );

  const handleDevToolsAction = useCallback((msg: string) => {
    toast(`触发 Action: ${msg}`, "info");
  }, []);

  // 稳定回调：配合子组件 memo 化，避免每次渲染传递新闭包
  const handleToggleRawLang = useCallback(() => setShowRawLang((v) => !v), []);
  const handleOpenSettings = useCallback(() => setShowSettings(true), [setShowSettings]);
  const handleOpenDevTools = useCallback(() => setShowDevTools(true), []);
  const handleCloseDevTools = useCallback(() => setShowDevTools(false), []);
  const handleCloseSettings = useCallback(() => setShowSettings(false), [setShowSettings]);
  const handleCancelRename = useCallback(() => setEditingSessionId(null), [setEditingSessionId]);

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans overflow-hidden">
      <ChatSidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        editingSessionId={editingSessionId}
        editingTitleText={editingTitleText}
        apiKey={apiKey}
        model={model}
        showRawLang={showRawLang}
        onCreateNewChat={handleCreateNewChat}
        onSelectSession={handleSelectSession}
        onStartRename={handleStartRename}
        onSaveRename={handleSaveRename}
        onDeleteSession={handleDeleteSession}
        onEditTitleChange={setEditingTitleText}
        onClearAllSessions={handleClearAllSessions}
        onPresetSelect={handlePresetSelect}
        onOpenSettings={handleOpenSettings}
        onOpenDevTools={handleOpenDevTools}
        onToggleRawLang={handleToggleRawLang}
        onCancelEdit={handleCancelRename}
      />

      {/* 主对话工作区 */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* 顶部标题栏 */}
        <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 text-sm font-medium min-w-0">
            <TrendingUp className="w-4 h-4 text-blue-500 shrink-0" />
            <span className="font-semibold truncate max-w-md">
              {activeSession?.title || "OpenUI 对话式数据分析看板"}
            </span>
            {apiKey && (
              <span className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 px-2 py-0.5 rounded-full font-semibold border border-emerald-200 dark:border-emerald-800 shrink-0">
                AI: {model}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateNewChat}
              className="text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新对话</span>
            </button>
            <button
              onClick={handleOpenDevTools}
              className="text-xs text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/50 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-purple-200 dark:border-purple-800"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>AST 沙箱</span>
            </button>
            <button
              onClick={handleOpenSettings}
              className="text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>设置</span>
            </button>
            <button
              onClick={() => window.location.reload()}
              className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1 p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
              title="刷新页面"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        <MessageList
          messages={messages}
          status={status}
          error={error}
          showRawLang={showRawLang}
          activeSources={sessionSources}
          onRendererAction={handleRendererAction}
          onReload={reload}
        />

        <SourcePicker
          sources={enabledPickerSources}
          selected={activeSession?.enabledSources}
          onChange={handleSourcesChange}
          disabled={sourcesLocked}
        />

        <ChatInput
          input={input}
          isLoading={isLoading}
          planMode={planMode}
          // AI SDK 的 handleInputChange 只读 e.target.value，事件源类型安全收敛到 textarea
          onChange={(e) => handleInputChange(e as unknown as React.ChangeEvent<HTMLInputElement>)}
          onSubmit={handleChatSubmit}
          onPlanModeChange={setPlanMode}
        />
      </main>

      {showDevTools && (
        <DevToolsPanel
          code={devToolsCode}
          onCodeChange={setDevToolsCode}
          onAction={handleDevToolsAction}
          onClose={handleCloseDevTools}
        />
      )}

      {showSettings && (
        <SettingsModal
          apiKey={apiKey}
          baseURL={baseURL}
          model={model}
          accessToken={accessToken}
          temperature={temperature}
          protocol={protocol}
          onApiKeyChange={setApiKey}
          onBaseURLChange={setBaseURL}
          onModelChange={setModel}
          onAccessTokenChange={setAccessToken}
          onTemperatureChange={setTemperature}
          onProtocolChange={setProtocol}
          onSave={saveSettings}
          onClose={handleCloseSettings}
        />
      )}

      <Toaster />
    </div>
  );
}
