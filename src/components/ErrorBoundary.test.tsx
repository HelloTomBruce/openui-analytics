import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Bomb({ boom }: { boom: boolean }) {
  if (boom) throw new Error("boom");
  return <div>渲染成功</div>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // 屏蔽 React 错误边界的预期 console 噪音
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("子组件抛错时显示如实 fallback", () => {
    render(
      <ErrorBoundary name="TestComp">
        <Bomb boom />
      </ErrorBoundary>
    );
    expect(screen.getByText(/渲染失败/)).toBeInTheDocument();
    expect(screen.getByText(/TestComp/)).toBeInTheDocument();
  });

  it("resetKey 变化后自动复位并恢复渲染（流式自愈）", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="chunk-1">
        <Bomb boom />
      </ErrorBoundary>
    );
    expect(screen.getByText(/渲染失败/)).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="chunk-2">
        <Bomb boom={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText("渲染成功")).toBeInTheDocument();
  });

  it("resetKey 不变时保持错误态，不误复位", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="same">
        <Bomb boom />
      </ErrorBoundary>
    );

    rerender(
      <ErrorBoundary resetKey="same">
        <Bomb boom={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText(/渲染失败/)).toBeInTheDocument();
  });
});
