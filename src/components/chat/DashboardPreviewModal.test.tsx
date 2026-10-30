import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { DashboardPreviewModal } from "./DashboardPreviewModal";
import type { DashboardRecord } from "@/lib/dashboardStore";

vi.mock("@/components/OpenUIRenderer", () => ({
  OpenUIRenderer: ({
    content,
    onAction,
  }: {
    content: string;
    onAction?: (p: string) => void;
  }) => (
    <div data-testid="renderer">
      <span>{content}</span>
      <button onClick={() => onAction?.("筛选: 华东大区")}>trigger-action</button>
    </div>
  ),
}));

const RECORD: DashboardRecord = {
  id: "dash_ab12cd34",
  title: "Bug 收敛漏斗",
  dsl: "root = Root([funnel])",
  prompt: "本迭代 Bug 收敛情况如何",
  sourceNames: ["GitLab", "禅道"],
  origin: { sessionId: "s1", messageId: "m1" },
  createdAt: 100,
  updatedAt: 200,
};

function renderModal(overrides?: Partial<Parameters<typeof DashboardPreviewModal>[0]>) {
  const props = {
    dashboard: RECORD,
    onClose: vi.fn(),
    onReanalyze: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onAction: vi.fn(),
    ...overrides,
  };
  render(<DashboardPreviewModal {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DashboardPreviewModal 只读预览", () => {
  it("渲染标题/元信息与快照 DSL；交互组件动作经 onAction 转发", () => {
    const props = renderModal();
    expect(screen.getByText("Bug 收敛漏斗")).toBeInTheDocument();
    expect(screen.getByText(/GitLab \/ 禅道/)).toBeInTheDocument();
    expect(screen.getByText(/原提问：本迭代 Bug 收敛情况如何/)).toBeInTheDocument();
    expect(screen.getByTestId("renderer")).toHaveTextContent("root = Root([funnel])");

    fireEvent.click(screen.getByRole("button", { name: "trigger-action" }));
    expect(props.onAction).toHaveBeenCalledWith("筛选: 华东大区");
  });

  it("重新分析按钮携带原始提问", () => {
    const props = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /重新分析/ }));
    expect(props.onReanalyze).toHaveBeenCalledWith("本迭代 Bug 收敛情况如何");
  });

  it("未记录 prompt 时重新分析按钮禁用", () => {
    renderModal({ dashboard: { ...RECORD, prompt: undefined } });
    expect(screen.getByRole("button", { name: /重新分析/ })).toBeDisabled();
  });

  it("行内重命名：编辑 → 回车保存调用 onRename", () => {
    const props = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "重命名看板" }));
    const input = screen.getByRole("textbox", { name: "看板标题" });
    fireEvent.change(input, { target: { value: "月度收敛报告" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onRename).toHaveBeenCalledWith("dash_ab12cd34", "月度收敛报告");
  });

  it("删除走行内二次确认", () => {
    const props = renderModal();
    const del = screen.getByRole("button", { name: "删除收藏" });
    fireEvent.click(del);
    expect(props.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(props.onDelete).toHaveBeenCalledWith("dash_ab12cd34");
  });

  it("Esc 与关闭按钮触发 onClose；null 记录不渲染", () => {
    const props = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(props.onClose).toHaveBeenCalledTimes(2);

    const { container } = render(<DashboardPreviewModal {...props} dashboard={null} />);
    expect(container.firstChild).toBeNull();
  });
});
