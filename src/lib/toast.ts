"use client";

/**
 * 轻量 toast：模块级 pub/sub store。
 * clientTools 等非 React 上下文可直接调用 toast()；
 * <Toaster/> 组件订阅渲染，自动 3s 消隐。
 */

export type ToastKind = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = () => void;

let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();
let seq = 0;

const TOAST_DURATION_MS = 3000;

function emit() {
  for (const l of listeners) l();
}

export function toast(message: string, kind: ToastKind = "info"): void {
  const item: ToastItem = { id: ++seq, kind, message };
  toasts = [...toasts, item];
  emit();
  setTimeout(() => dismissToast(item.id), TOAST_DURATION_MS);
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToastsSnapshot(): ToastItem[] {
  return toasts;
}
