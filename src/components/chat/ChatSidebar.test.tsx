import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ChatSidebar } from "./ChatSidebar";
import type { DashboardSummary } from "@/lib/dashboardStore";

const baseProps = {
  sessions: [],
  currentSessionId: "s1",
  editingSessionId: null,
  editingTitleText: "",
  apiKey: "",
  model: "gpt-4o-mini",
  showRawLang: false,
  dashboards: [] as DashboardSummary[],
  onPreviewDashboard: vi.fn(),
  onReanalyzeDashboard: vi.fn(),
  onRenameDashboard: vi.fn(),
  onDeleteDashboard: vi.fn(),
  onCreateNewChat: vi.fn(),
  onSelectSession: vi.fn(),
  onStartRename: vi.fn(),
  onSaveRename: vi.fn(),
  onDeleteSession: vi.fn(),
  onEditTitleChange: vi.fn(),
  onCancelEdit: vi.fn(),
  onClearAllSessions: vi.fn(),
  onPresetSelect: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenDevTools: vi.fn(),
  onToggleRawLang: vi.fn(),
};

const SUMMARY: DashboardSummary = {
  id: "dash_ab12cd34",
  title: "Bug 收敛漏斗",
  prompt: "本迭代 Bug 收敛情况如何",
  sourceNames: ["GitLab"],
  origin: { sessionId: "s1", messageId: "m1" },
  createdAt: 100,
  updatedAt: 200,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function switchToDashboards() {
  fireEvent.click(screen.getByRole("button", { name: /看板 \(0\)|看板 \(\d+\)/ }));
}

describe("ChatSidebar 看板库 tab", () => {
  it("三个 tab 渲染且默认在历史", () => {
    render(<ChatSidebar {...baseProps} />);
    expect(screen.getByRole("button", { name: /历史 \(0\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /看板 \(0\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /推荐/ })).toBeInTheDocument();
    // 默认历史视图：看不到看板库空态文案
    expect(screen.queryByText(/还没有收藏的看板/)).not.toBeInTheDocument();
  });

  it("空态引导文案", () => {
    render(<ChatSidebar {...baseProps} />);
    switchToDashboards();
    expect(screen.getByText(/还没有收藏的看板/)).toBeInTheDocument();
  });

  it("列表项展示标题/prompt 摘要/源名称；点击条目触发预览", () => {
    const props = { ...baseProps, dashboards: [SUMMARY] };
    render(<ChatSidebar {...props} />);
    switchToDashboards();

    expect(screen.getByText("Bug 收敛漏斗")).toBeInTheDocument();
    expect(screen.getByText("本迭代 Bug 收敛情况如何")).toBeInTheDocument();
    expect(screen.getByText(/GitLab/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Bug 收敛漏斗"));
    expect(props.onPreviewDashboard).toHaveBeenCalledWith("dash_ab12cd34");
  });

  it("重新分析按钮携带 prompt 且不冒泡触发预览", () => {
    const props = { ...baseProps, dashboards: [SUMMARY] };
    render(<ChatSidebar {...props} />);
    switchToDashboards();

    fireEvent.click(screen.getByRole("button", { name: /重新分析 Bug 收敛漏斗/ }));
    expect(props.onReanalyzeDashboard).toHaveBeenCalledWith(
      "本迭代 Bug 收敛情况如何"
    );
    expect(props.onPreviewDashboard).not.toHaveBeenCalled();
  });

  it("无 prompt 的条目重新分析按钮禁用", () => {
    const props = {
      ...baseProps,
      dashboards: [{ ...SUMMARY, prompt: undefined }],
    };
    render(<ChatSidebar {...props} />);
    switchToDashboards();
    expect(
      screen.getByRole("button", { name: /重新分析 Bug 收敛漏斗/ })
    ).toBeDisabled();
  });

  it("行内重命名：编辑 → 保存调用 onRenameDashboard", () => {
    const props = { ...baseProps, dashboards: [SUMMARY] };
    render(<ChatSidebar {...props} />);
    switchToDashboards();

    fireEvent.click(screen.getByRole("button", { name: /重命名看板 Bug 收敛漏斗/ }));
    const input = screen.getByRole("textbox", { name: /重命名看板 Bug 收敛漏斗/ });
    fireEvent.change(input, { target: { value: "月度报告" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onRenameDashboard).toHaveBeenCalledWith(
      "dash_ab12cd34",
      "月度报告"
    );
  });

  it("删除走行内二次确认，且不冒泡", () => {
    const props = { ...baseProps, dashboards: [SUMMARY] };
    render(<ChatSidebar {...props} />);
    switchToDashboards();

    fireEvent.click(screen.getByRole("button", { name: /删除看板 Bug 收敛漏斗/ }));
    expect(props.onDeleteDashboard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(props.onDeleteDashboard).toHaveBeenCalledWith("dash_ab12cd34");
    expect(props.onPreviewDashboard).not.toHaveBeenCalled();
  });
});
