"use client";

import React from "react";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * 组件级渲染守卫：单个组件数据异常不拖垮整个看板。
 * 统一走共享 ErrorBoundary（如实报错文案；组件 props 不变时保持错误态，
 * 不做自动复位——相同 props 重试必然再次失败，复位只会造成渲染循环）。
 */
export function ComponentSafeWrapper({ children, name }: { children: React.ReactNode; name: string }) {
  return <ErrorBoundary name={name}>{children}</ErrorBoundary>;
}
