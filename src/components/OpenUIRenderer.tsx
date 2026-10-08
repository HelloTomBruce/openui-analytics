"use client";

import React from "react";
import { Renderer } from "@openuidev/react-lang";
import { analyticsLibrary } from "@/components/analytics";

interface OpenUIRendererProps {
  content: string;
  isStreaming?: boolean;
  onAction?: (actionPrompt: string) => void;
}

/**
 * OpenUI 官方声明式组件视觉渲染器
 */
export const OpenUIRenderer: React.FC<OpenUIRendererProps> = ({
  content,
  isStreaming = false,
  onAction,
}) => {
  if (!content || !content.trim()) return null;

  return (
    <div className="w-full">
      <Renderer
        library={analyticsLibrary}
        response={content}
        isStreaming={isStreaming}
        onAction={(event: unknown) => {
          if (onAction) {
            const ev = event as { humanFriendlyMessage?: string; userMessage?: string } | string | undefined;
            let message = "";
            if (typeof ev === "string") {
              message = ev;
            } else if (ev && typeof ev === "object") {
              message = ev.humanFriendlyMessage || ev.userMessage || JSON.stringify(ev);
            }
            if (message) {
              onAction(message);
            }
          }
        }}
      />
    </div>
  );
};
