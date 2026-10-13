import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  toast,
  dismissToast,
  subscribeToasts,
  getToastsSnapshot,
} from "./toast";

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 清空残留
    for (const t of getToastsSnapshot()) dismissToast(t.id);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("toast() 推送消息并通知订阅者", () => {
    const listener = vi.fn();
    const unsub = subscribeToasts(listener);

    toast("导出成功", "success");

    expect(getToastsSnapshot()).toHaveLength(1);
    expect(getToastsSnapshot()[0]).toMatchObject({ kind: "success", message: "导出成功" });
    expect(listener).toHaveBeenCalled();
    unsub();
  });

  it("多条 toast 堆叠，dismissToast 移除指定项", () => {
    toast("第一条");
    toast("第二条", "error");
    expect(getToastsSnapshot()).toHaveLength(2);

    dismissToast(getToastsSnapshot()[0].id);
    expect(getToastsSnapshot()).toHaveLength(1);
    expect(getToastsSnapshot()[0].message).toBe("第二条");
  });

  it("3 秒后自动消隐", () => {
    toast("自动消失");
    expect(getToastsSnapshot()).toHaveLength(1);

    vi.advanceTimersByTime(3100);
    expect(getToastsSnapshot()).toHaveLength(0);
  });

  it("退订后不再收到通知", () => {
    const listener = vi.fn();
    const unsub = subscribeToasts(listener);
    unsub();
    toast("静默");
    expect(listener).not.toHaveBeenCalled();
  });
});
