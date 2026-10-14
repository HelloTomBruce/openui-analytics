import type { Message } from "@ai-sdk/react";

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  /** 会话启用的数据源 id；undefined = 全选（跟随全局启用项） */
  enabledSources?: string[];
}

const STORAGE_SESSIONS_KEY = "openui_chat_sessions_v1";
const STORAGE_CURRENT_SESSION_ID_KEY = "openui_current_session_id_v1";

export const DEFAULT_WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "👋 你好！我是基于 **Vercel AI SDK**、**OpenUI 完整生态规范** 与 **动态配置的多数据源 MCP 生态（HTTP MCP / 数据库 / 本地 CLI）** 构建的对话式数据分析助手。在「设置 → 数据源」添加你的数据源后即可开始分析。\n\n本系统已深度集成：\n- ⚡ **响应式状态与本地毫秒试算 (Reactive State)**\n- 🛠️ **前端客户端工具直连 (Client Tool Provider)**\n- 📋 **动作流编排与落地清单 (Action Pipelines)**\n- 🔗 **禅道 × GitLab 跨源联合分析 (Cross-Source Insights)**\n- 🔍 **开发者 AST 实时调试检查台 (OpenUI DevTools)**\n- 📊 **流式全链路可观测性 (Observability Metrics)**",
};

/**
 * 读取所有历史会话
 */
export function getSavedSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return [];
  } catch (err) {
    console.error("Failed to load sessions from localStorage:", err);
    return [];
  }
}

/**
 * 写入保存所有会话
 */
export function persistSessions(sessions: ChatSession[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_SESSIONS_KEY, JSON.stringify(sessions));
  } catch (err) {
    console.error("Failed to save sessions to localStorage:", err);
  }
}

/**
 * 获取当前活跃会话 ID
 */
export function getActiveSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_CURRENT_SESSION_ID_KEY);
}

/**
 * 设置当前活跃会话 ID
 */
export function setActiveSessionId(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_CURRENT_SESSION_ID_KEY, id);
}

/**
 * 根据首条用户消息生成直观简洁的会话标题
 */
export function generateSessionTitle(firstUserContent: string): string {
  if (!firstUserContent) return "新分析会话";
  // 过滤掉 markdown 或前缀标签
  const clean = firstUserContent
    .replace(/[#*`_~]/g, "")
    .replace(/^【.*?】/, "")
    .trim();
  if (!clean) return "新分析会话";
  return clean.length > 20 ? `${clean.slice(0, 20)}...` : clean;
}

/**
 * 纯函数：返回带（或去掉）enabledSources 的会话副本；undefined 删除字段恢复全选语义。
 * useSessionManager 与存储层写入共用，保证两处语义一致。
 */
export function applyEnabledSources(
  session: ChatSession,
  ids: string[] | undefined
): ChatSession {
  const copy = { ...session };
  if (ids === undefined) {
    delete copy.enabledSources;
    return copy;
  }
  copy.enabledSources = ids;
  return copy;
}

/**
 * 存储层写入指定会话的 enabledSources（undefined 恢复全选）；未知 id 静默返回。
 */
export function setSessionEnabledSources(
  sessionId: string,
  ids: string[] | undefined
): void {
  if (typeof window === "undefined") return;
  const sessions = getSavedSessions();
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) return;
  sessions[idx] = applyEnabledSources(sessions[idx], ids);
  persistSessions(sessions);
}

/**
 * 创建一个全新会话（纯工厂函数，不做持久化）。
 * 持久化由 useSessionManager 的 useEffect 单点完成，
 * 避免"每个操作各自记得落盘"造成的清空/删除后数据复活问题。
 */
export function createNewSession(customTitle?: string): ChatSession {
  const now = Date.now();
  return {
    id: `session_${now}_${Math.random().toString(36).substring(2, 7)}`,
    title: customTitle || "新建分析会话",
    createdAt: now,
    updatedAt: now,
    messages: [DEFAULT_WELCOME_MESSAGE],
  };
}
