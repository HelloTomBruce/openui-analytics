import type { Message } from "@ai-sdk/react";

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

const STORAGE_SESSIONS_KEY = "openui_chat_sessions_v1";
const STORAGE_CURRENT_SESSION_ID_KEY = "openui_current_session_id_v1";

export const DEFAULT_WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "👋 你好！我是基于 **Vercel AI SDK**、**OpenUI 完整生态规范** 与 **PostgreSQL + GitLab + 禅道（ZenTao）MCP** 构建的对话式数据分析助手。\n\n本系统已深度集成：\n- ⚡ **响应式状态与本地毫秒试算 (Reactive State)**\n- 🛠️ **前端客户端工具直连 (Client Tool Provider)**\n- 📋 **动作流编排与落地清单 (Action Pipelines)**\n- 🔗 **禅道 × GitLab 跨源联合分析 (Cross-Source Insights)**\n- 🔍 **开发者 AST 实时调试检查台 (OpenUI DevTools)**\n- 📊 **流式全链路可观测性 (Observability Metrics)**",
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
 * 创建一个全新会话
 */
export function createNewSession(customTitle?: string): ChatSession {
  const now = Date.now();
  const newSession: ChatSession = {
    id: `session_${now}_${Math.random().toString(36).substring(2, 7)}`,
    title: customTitle || "新建分析会话",
    createdAt: now,
    updatedAt: now,
    messages: [DEFAULT_WELCOME_MESSAGE],
  };

  const currentSessions = getSavedSessions();
  persistSessions([newSession, ...currentSessions]);
  setActiveSessionId(newSession.id);
  return newSession;
}
