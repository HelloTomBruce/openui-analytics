import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Hint } from "./hint";

afterEach(cleanup);

function renderHint() {
  return render(
    <Hint label="提示文案">
      <button aria-label="目标按钮">OK</button>
    </Hint>
  );
}

describe("Hint（title 属性替代）", () => {
  it("默认不渲染 tooltip 内容", () => {
    renderHint();
    expect(document.querySelector("[data-slot=tooltip-content]")).toBeNull();
  });

  it("鼠标移入触发器弹出提示，移出关闭", () => {
    renderHint();
    const btn = screen.getByRole("button", { name: "目标按钮" });

    fireEvent.mouseEnter(btn);
    expect(screen.getByText("提示文案")).toBeInTheDocument();

    fireEvent.mouseLeave(btn);
    expect(screen.queryByText("提示文案")).not.toBeInTheDocument();
  });

  it("程序化 focus（非 :focus-visible）不弹出提示——Dialog 初始聚焦场景", () => {
    renderHint();
    const btn = screen.getByRole("button", { name: "目标按钮" });
    // jsdom 中 fireEvent.focus 不满足 :focus-visible（无键盘交互痕迹）
    fireEvent.focus(btn);
    expect(screen.queryByText("提示文案")).not.toBeInTheDocument();
  });

  it("blur 关闭已打开的提示", () => {
    renderHint();
    const btn = screen.getByRole("button", { name: "目标按钮" });
    fireEvent.mouseEnter(btn);
    expect(screen.getByText("提示文案")).toBeInTheDocument();
    fireEvent.blur(btn);
    expect(screen.queryByText("提示文案")).not.toBeInTheDocument();
  });
});
