import "@testing-library/jest-dom/vitest";

// Radix UI（Slider/Select/Dialog 等）依赖的浏览器 API 在 jsdom 中缺失，统一 mock
// （node 环境的测试没有 DOM，守卫跳过）
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
}

if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ||= (() => false) as typeof Element.prototype.hasPointerCapture;
  Element.prototype.releasePointerCapture ||= (() => {}) as typeof Element.prototype.releasePointerCapture;
  Element.prototype.scrollIntoView ||= (() => {}) as typeof Element.prototype.scrollIntoView;
}
