"use client";

import React, { useRef } from "react";
import { Renderer } from "@openuidev/react-lang";
import { analyticsLibrary } from "@/components/analytics";
import { clientTools } from "@/lib/clientTools";
import { Activity, CheckCircle2, Loader2 } from "lucide-react";

interface OpenUIRendererProps {
  content: string;
  isStreaming?: boolean;
  onAction?: (actionPrompt: string) => void;
  showObservabilityBadge?: boolean;
}

class SafeErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn("[OpenUIRenderer ErrorBoundary]:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg text-xs text-amber-800 dark:text-amber-200">
            ⚠️ 动态仪表盘渲染解析中，请稍候...
          </div>
        )
      );
    }
    return this.props.children;
  }
}

/**
 * OpenUI 官方声明式组件视觉渲染器
 * 集成：
 * 1. Client-Side ToolProvider (客户端本地工具)
 * 2. Observability Metrics (静态只读指标，零状态副作用)
 * 3. 流式渐进式 Loading 指示条
 * 4. Error Boundary (全链路安全边界)
 */
export const OpenUIRenderer: React.FC<OpenUIRendererProps> = ({
  content,
  isStreaming = false,
  onAction,
  showObservabilityBadge = true,
}) => {
  const onActionRef = useRef(onAction);
  React.useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  const handleAction = React.useCallback((event: unknown) => {
    const handler = onActionRef.current;
    if (handler) {
      const ev = event as { humanFriendlyMessage?: string; userMessage?: string } | string | undefined;
      let message = "";
      if (typeof ev === "string") {
        message = ev;
      } else if (ev && typeof ev === "object") {
        message = ev.humanFriendlyMessage || ev.userMessage || JSON.stringify(ev);
      }
      if (message) {
        handler(message);
      }
    }
  }, []);

  const handleError = React.useCallback((errors: unknown) => {
    if (errors && Array.isArray(errors) && errors.length > 0) {
      console.warn("[OpenUI Lang Parser/Render Notice]:", errors);
    }
  }, []);

  if (!content || !content.trim()) return null;

  return (
    <SafeErrorBoundary>
      <div className="w-full space-y-3">
        {/* 流式生成进行中的 Loading 状态条 */}
        {isStreaming && (
          <div className="flex items-center justify-between px-3 py-2 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/50 rounded-lg text-xs text-blue-600 dark:text-blue-400">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="font-medium">大模型正在实时流式构建 OpenUI 视觉组件与计算图表...</span>
            </div>
            <span className="text-[10px] bg-blue-100 dark:bg-blue-900/60 px-2 py-0.5 rounded-full font-mono">
              Live Streaming
            </span>
          </div>
        )}

        <Renderer
          library={analyticsLibrary}
          response={content}
          isStreaming={isStreaming}
          toolProvider={clientTools}
          publishObservability={false}
          onError={handleError}
          onAction={handleAction}
        />

        {/* 流式完成后的只读指标展示 (纯静态计算，无 setState 副作用) */}
        {showObservabilityBadge && !isStreaming && (
          <div className="pt-2 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 font-mono border-t border-slate-100 dark:border-slate-800/60">
            <div className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-emerald-500" />
              <span>AST 字符: {content.length}</span>
              <span>•</span>
              <span>Visual Components: Active</span>
            </div>
            <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-3 h-3" />
              <span>Client Tools Ready</span>
            </div>
          </div>
        )}
      </div>
    </SafeErrorBoundary>
  );
};
