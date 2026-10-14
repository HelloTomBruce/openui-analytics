"use client";

import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * 内容标识：变化时自动复位错误态。
   * 流式渲染的中间态解析失败可在后续 token 到达时自愈，
   * 避免一次错误永久卡在 fallback。
   */
  resetKey?: unknown;
  /** 自定义兜底 UI；缺省使用统一的如实错误提示 */
  fallback?: React.ReactNode;
  /** 组件名，用于日志与默认兜底文案 */
  name?: string;
}

/**
 * 共享错误边界（OpenUIRenderer 与 analytics 组件库统一使用）。
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    // 内容已更新：给新内容一次渲染机会（自愈）
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: Error) {
    console.warn(
      `[ErrorBoundary${this.props.name ? `: ${this.props.name}` : ""}]:`,
      error?.message || error
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-xl text-xs text-amber-700 dark:text-amber-400">
            ⚠️ {this.props.name ? `组件「${this.props.name}」` : "内容"}渲染失败（数据格式异常），将在新内容到达时自动重试。
          </div>
        )
      );
    }
    return this.props.children;
  }
}
