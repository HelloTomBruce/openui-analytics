import type { Message } from "@ai-sdk/react";

/**
 * 将流式完成后的最终消息合并进消息列表（upsert）。
 *
 * onFinish 回调触发时，messages 状态可能已包含该消息（AI SDK 先 setMessages
 * 再触发回调），也可能尚未包含——按 id 去重，存在则替换、否则追加，
 * 避免重复消息或丢失多步工具调用产生的中间消息。
 */
export function upsertMessage(messages: Message[], finalMessage: Message): Message[] {
  const exists = messages.some((m) => m.id === finalMessage.id);
  if (exists) {
    return messages.map((m) => (m.id === finalMessage.id ? finalMessage : m));
  }
  return [...messages, finalMessage];
}
