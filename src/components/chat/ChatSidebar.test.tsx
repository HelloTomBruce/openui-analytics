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
  onExportDashboard: vi.fn(),
  onImportDashboard: vi.fn(),
  onCreateNewChat: vi.fn(),
  onSelectSession: vi.fn(),
  onStartRename: vi.fn(),
  onSaveRename: vi.fn(),
  onDeleteSession: vi.fn(),
  onEditTitleChange: vi.fn(),
  onCancelEdit: vi.fn(),
  onClearAllSessions: vi.fn(),
  onPresetSelect: vi.fn(),
  onToggleRawLang: vi.fn(),
  onOpenMethodology: vi.fn(),
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

  /** 打开看板卡片的「...」菜单（其余操作均收纳其中） */
  function openItemMenu() {
    fireEvent.click(
      screen.getByRole("button", { name: /看板 Bug 收敛漏斗 更多操作/ })
    );
  }

  it("重新分析收纳在菜单中：携带 prompt 且不冒泡触发预览", () => {
    const props = { ...baseProps, dashboards: [SUMMARY] };
    render(<ChatSidebar {...props} />);
    switchToDashboards();

    openItemMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /重新分析 Bug 收敛漏斗/ }));
    expect(props.onReanalyzeDashboard).toHaveBeenCalledWith(
      "本迭代 Bug 收敛情况如何"
    );
    expect(props.onPreviewDashboard).not.toHaveBeenCalled();
  });

  it("无 prompt 的条目菜单中重新分析禁用", () => {
    const props = {
      ...baseProps,
      dashboards: [{ ...SUMMARY, prompt: undefined }],
    };
    render(<ChatSidebar {...props} />);
    switchToDashboards();
    openItemMenu();
    expect(
      screen.getByRole("menuitem", { name: /重新分析 Bug 收敛漏斗/ })
    ).toBeDisabled();
  });

  it("行内重命名：菜单进入编辑 → 保存调用 onRenameDashboard", () => {
    const props = { ...baseProps, dashboards: [SUMMARY] };
    render(<ChatSidebar {...props} />);
    switchToDashboards();

    openItemMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /重命名看板 Bug 收敛漏斗/ }));
    const input = screen.getByRole("textbox", { name: /重命名看板 Bug 收敛漏斗/ });
    fireEvent.change(input, { target: { value: "月度报告" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onRenameDashboard).toHaveBeenCalledWith(
      "dash_ab12cd34",
      "月度报告"
    );
  });

  it("删除在菜单内二次确认，且不冒泡", () => {
    const props = { ...baseProps, dashboards: [SUMMARY] };
    render(<ChatSidebar {...props} />);
    switchToDashboards();

    openItemMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /删除看板 Bug 收敛漏斗/ }));
    expect(props.onDeleteDashboard).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("menuitem", { name: /确认删除看板 Bug 收敛漏斗/ })
    );
    expect(props.onDeleteDashboard).toHaveBeenCalledWith("dash_ab12cd34");
    expect(props.onPreviewDashboard).not.toHaveBeenCalled();
  });

  it("条目导出收纳在菜单中：触发 onExportDashboard 且不冒泡", () => {
    const props = { ...baseProps, dashboards: [SUMMARY] };
    render(<ChatSidebar {...props} />);
    switchToDashboards();

    openItemMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /导出看板 Bug 收敛漏斗/ }));
    expect(props.onExportDashboard).toHaveBeenCalledWith("dash_ab12cd34");
    expect(props.onPreviewDashboard).not.toHaveBeenCalled();
  });

  it("菜单交互：菜单外点击关闭；Escape 关闭；确认态随关闭复位", () => {
    const props = { ...baseProps, dashboards: [SUMMARY] };
    render(<ChatSidebar {...props} />);
    switchToDashboards();

    // 打开菜单 → 菜单外点击关闭
    openItemMenu();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // 再次打开 → Escape 关闭
    openItemMenu();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // 删除确认态随菜单关闭复位（重开后仍是「删除收藏」而非「确认删除」）
    openItemMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /删除看板 Bug 收敛漏斗/ }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    openItemMenu();
    expect(
      screen.getByRole("menuitem", { name: /删除看板 Bug 收敛漏斗/ })
    ).toBeInTheDocument();
    expect(props.onDeleteDashboard).not.toHaveBeenCalled();
  });

  it("导入：选择文件后回调 onImportDashboard，且可重复选择同一文件", () => {
    const props = { ...baseProps };
    render(<ChatSidebar {...props} />);
    switchToDashboards();

    const input = screen.getByLabelText("导入看板快照文件");
    const file = new File([JSON.stringify({ dsl: "root = Root([])" })], "a.openui.json", {
      type: "application/json",
    });
    fireEvent.change(input, { target: { files: [file] } });
    expect(props.onImportDashboard).toHaveBeenCalledWith(file);
    // value 被清空：同一文件可再次触发
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { files: [file] } });
    expect(props.onImportDashboard).toHaveBeenCalledTimes(2);
  });
});

describe("ChatSidebar 底部功能栏", () => {
  it("「分析方法论」按钮触发 onOpenMethodology", () => {
    const props = { ...baseProps };
    render(<ChatSidebar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "分析方法论" }));
    expect(props.onOpenMethodology).toHaveBeenCalledTimes(1);
  });
});
