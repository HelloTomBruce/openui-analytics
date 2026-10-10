"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { TrendingUp, Plus, Code2, Settings, RefreshCw } from "lucide-react";
import { DEFAULT_SANDBOX_CODE } from "@/lib/presetQueries";
import { useLlmSettings } from "@/hooks/useLlmSettings";
import { useSessionManager, type SetMessagesFn } from "@/hooks/useSessionManager";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { MessageList } from "@/components/chat/MessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { SettingsModal } from "@/components/chat/SettingsModal";
import { DevToolsPanel } from "@/components/chat/DevToolsPanel";
import { InsightBanner } from "@/components/chat/InsightBanner";

/**
 * 组合层：唯一接线点。
 * 状态在 useLlmSettings / useSessionManager 中管理，展示在 chat/ 下的专注子组件中。
 */
export default function ChatDashboard() {
  const [showRawLang, setShowRawLang] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
  const [devToolsCode, setDevToolsCode] = useState(DEFAULT_SANDBOX_CODE);

  const {
    showSettings,
    setShowSettings,
    apiKey,
    setApiKey,
    baseURL,
    setBaseURL,
    model,
    setModel,
    gitlabToken,
    setGitlabToken,
    gitlabUrl,
    setGitlabUrl,
    saveSettings,
    chatBody,
  } = useLlmSettings();

  // useChat 的 initialMessages 由 useSessionManager 提供，而会话切换又需要
  // useChat 的 setMessages —— 通过 ref 延迟注入打破构造顺序环（见 hook 注释）。
  const setMessagesRef = useRef<SetMessagesFn | null>(null);

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
    handleCreateNewChat,
    handleSelectSession,
    handleDeleteSession,
    handleStartRename,
    handleSaveRename,
    handleClearAllSessions,
  } = useSessionManager(setMessagesRef);

  const handleChatError = useCallback((err: Error) => {
    console.error("Chat error:", err);
  }, []);

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
    body: chatBody,
    onError: handleChatError,
    initialMessages,
    onFinish: (message) => {
      // 流式结束时保存
      saveCurrentSessionMessages([...messages, message]);
    },
  });

  useEffect(() => {
    setMessagesRef.current = setMessages;
  }, [setMessages]);

  const handleRendererAction = useCallback(
    (actionPrompt: string) => {
      append({ role: "user", content: actionPrompt });
    },
    [append]
  );

  const handleDevToolsAction = useCallback((msg: string) => {
    alert(`触发 Action: ${msg}`);
  }, []);

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
        onCancelEdit={() => setEditingSessionId(null)}
        onClearAllSessions={handleClearAllSessions}
        onPresetSelect={handleRendererAction}
        onOpenSettings={() => setShowSettings(true)}
        onOpenDevTools={() => setShowDevTools(true)}
        onToggleRawLang={() => setShowRawLang(!showRawLang)}
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
              onClick={() => setShowDevTools(true)}
              className="text-xs text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/50 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-purple-200 dark:border-purple-800"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>AST 沙箱</span>
            </button>
            <button
              onClick={() => setShowSettings(true)}
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

        <InsightBanner onAnalyze={handleRendererAction} />

        <MessageList
          messages={messages}
          status={status}
          isLoading={isLoading}
          error={error}
          showRawLang={showRawLang}
          onRendererAction={handleRendererAction}
          onReload={reload}
        />

        <ChatInput
          input={input}
          isLoading={isLoading}
          onChange={handleInputChange}
          onSubmit={handleSubmit}
        />
      </main>

      {showDevTools && (
        <DevToolsPanel
          code={devToolsCode}
          onCodeChange={setDevToolsCode}
          onAction={handleDevToolsAction}
          onClose={() => setShowDevTools(false)}
        />
      )}

      {showSettings && (
        <SettingsModal
          apiKey={apiKey}
          baseURL={baseURL}
          model={model}
          gitlabToken={gitlabToken}
          gitlabUrl={gitlabUrl}
          onApiKeyChange={setApiKey}
          onBaseURLChange={setBaseURL}
          onModelChange={setModel}
          onGitlabTokenChange={setGitlabToken}
          onGitlabUrlChange={setGitlabUrl}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
