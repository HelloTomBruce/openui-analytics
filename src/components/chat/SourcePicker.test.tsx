import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SourcePicker } from "./SourcePicker";

const SOURCES = [
  { id: "postgres", name: "PostgreSQL 分析库", enabled: true, builtin: true },
  { id: "jira", name: "Jira MCP", enabled: true, builtin: false },
  { id: "off-one", name: "已停用源", enabled: false, builtin: false },
  { id: "mysql-a", name: "订单库", enabled: true, builtin: false },
];

describe("SourcePicker", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("仅渲染启用源，selected 为 undefined 时全选", () => {
    render(<SourcePicker sources={SOURCES} selected={undefined} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /数据源/ }));

    expect(screen.getByLabelText("PostgreSQL 分析库")).toBeChecked();
    expect(screen.getByLabelText("Jira MCP")).toBeChecked();
    expect(screen.getByLabelText("订单库")).toBeChecked();
    expect(screen.queryByLabelText("已停用源")).not.toBeInTheDocument();
    // 计数：3/3
    expect(screen.getByRole("button", { name: /数据源/ }).textContent).toContain("3/3");
  });

  it("selected 指定部分源时仅勾选对应项", () => {
    render(<SourcePicker sources={SOURCES} selected={["postgres"]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /数据源/ }));

    expect(screen.getByLabelText("PostgreSQL 分析库")).toBeChecked();
    expect(screen.getByLabelText("Jira MCP")).not.toBeChecked();
  });

  it("勾选/取消触发 onChange 且保持源顺序", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SourcePicker sources={SOURCES} selected={undefined} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole("button", { name: /数据源/ }));

    // 取消 Jira：undefined 全选基础上得到 [postgres, mysql-a]
    fireEvent.click(screen.getByLabelText("Jira MCP"));
    expect(onChange).toHaveBeenLastCalledWith(["postgres", "mysql-a"]);

    // 受控更新后重新勾选 Jira：恢复全量列表
    rerender(
      <SourcePicker sources={SOURCES} selected={["postgres", "mysql-a"]} onChange={onChange} />
    );
    fireEvent.click(screen.getByLabelText("Jira MCP"));
    expect(onChange).toHaveBeenLastCalledWith(["postgres", "jira", "mysql-a"]);
  });

  it("部分勾选状态下取消一项得到剩余子集", () => {
    const onChange = vi.fn();
    render(
      <SourcePicker sources={SOURCES} selected={["postgres"]} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole("button", { name: /数据源/ }));

    fireEvent.click(screen.getByLabelText("PostgreSQL 分析库"));

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("selected 空数组时全部未勾选，计数 0/3", () => {
    render(<SourcePicker sources={SOURCES} selected={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /数据源/ }));

    expect(screen.getByLabelText("PostgreSQL 分析库")).not.toBeChecked();
    expect(screen.getByRole("button", { name: /数据源/ }).textContent).toContain("0/3");
  });
});
