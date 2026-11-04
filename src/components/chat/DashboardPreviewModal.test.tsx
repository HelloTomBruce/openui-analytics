import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { DashboardPreviewModal, type PreviewRefreshResult } from "./DashboardPreviewModal";
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

vi.mock("@/lib/toast", () => ({ toast: vi.fn() }));

vi.mock("@/lib/dashboardSnapshot", () => ({
  downloadDashboardSnapshot: vi.fn(),
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

/** 活看板记录：带 queries + dataUpdatedAt，可一键刷新 */
const LIVE_RECORD: DashboardRecord = {
  ...RECORD,
  dsl: "root = Root([funnel, data = 42])",
  queries: [{ id: "q_abc123", sourceId: "src_zentao", kind: "sql", payload: "SELECT 1" }],
  dataUpdatedAt: Date.now() - 60_000,
};

function renderModal(overrides?: Partial<Parameters<typeof DashboardPreviewModal>[0]>) {
  const props = {
    dashboard: RECORD,
    onClose: vi.fn(),
    onReanalyze: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onAction: vi.fn(),
    onRefresh: vi.fn().mockResolvedValue({ ok: false, error: "未接线" }),
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
      // Radix Dialog 在 document 上监听 Esc
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(props.onClose).toHaveBeenCalledTimes(2);

    const { container } = render(<DashboardPreviewModal {...props} dashboard={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("导出快照：调用下载工具并成功 toast", async () => {
    const { downloadDashboardSnapshot } = await import("@/lib/dashboardSnapshot");
    vi.mocked(downloadDashboardSnapshot).mockResolvedValueOnce(undefined);
    renderModal();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "导出快照" }));
    });
    expect(downloadDashboardSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dash_ab12cd34" })
    );
    const { toast } = await import("@/lib/toast");
    expect(toast).toHaveBeenCalledWith("已导出快照", "success");
  });

  it("复制 DSL：写剪贴板并成功 toast；剪贴板失败走错误 toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderModal();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制 DSL" }));
    });
    expect(writeText).toHaveBeenCalledWith("root = Root([funnel])");
    const { toast } = await import("@/lib/toast");
    expect(toast).toHaveBeenCalledWith("已复制 DSL", "success");

    // 失败路径
    writeText.mockRejectedValueOnce(new Error("denied"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制 DSL" }));
    });
    expect(toast).toHaveBeenCalledWith("复制失败", "error");
  });
});

describe("DashboardPreviewModal 活看板刷新（P2-A）", () => {
  it("渲染数据时间戳；带 queries 的记录刷新按钮可点", () => {
    renderModal({ dashboard: LIVE_RECORD });
    expect(screen.getByText(/数据时间/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新数据" })).toBeEnabled();
  });

  it("无 queries 的旧快照：刷新按钮禁用 + 静态快照提示", () => {
    renderModal(); // RECORD 无 queries
    const btn = screen.getByRole("button", { name: "刷新数据" });
    expect(btn).toBeDisabled();
    // 旧快照无 dataUpdatedAt，不渲染数据时间；Hint 提示文案由 Radix Tooltip 悬浮渲染（jsdom 不弹），
    // 禁用态本身即旧快照兼容的可见信号
    expect(screen.queryByText(/数据时间/)).not.toBeInTheDocument();
  });

  it("点击刷新：loading 态（刷新中…/禁用），成功后恢复并 toast", async () => {
    let resolveRefresh!: (v: PreviewRefreshResult) => void;
    const onRefresh = vi.fn(
      () =>
        new Promise<PreviewRefreshResult>((resolve) => {
          resolveRefresh = resolve;
        })
    );
    const props = renderModal({ dashboard: LIVE_RECORD, onRefresh });

    fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    expect(onRefresh).toHaveBeenCalledWith("dash_ab12cd34");
    // pending：按钮进入 loading 态
    expect(screen.getByText("刷新中…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新数据" })).toBeDisabled();

    await act(async () => {
      resolveRefresh({ ok: true, record: LIVE_RECORD, stale: [] });
    });
    // 成功：恢复可点态并 toast
    expect(screen.getByRole("button", { name: "刷新数据" })).toBeEnabled();
    const { toast } = await import("@/lib/toast");
    expect(toast).toHaveBeenCalledWith("数据已刷新", "success");
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("部分组件 stale → 渲染过期徽标 + info toast；全部成功则无徽标", async () => {
    renderModal({
      dashboard: LIVE_RECORD,
      onRefresh: vi
        .fn()
        .mockResolvedValue({ ok: true, record: LIVE_RECORD, stale: ["chart-a"] }),
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    });
    expect(screen.getByTestId("stale-badge")).toHaveTextContent(
      "1 个组件数据过期"
    );
    const { toast } = await import("@/lib/toast");
    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining("1 个组件查询失败"),
      "info"
    );

    // 全部组件刷新成功：无徽标 + success toast
    cleanup();
    renderModal({
      dashboard: LIVE_RECORD,
      onRefresh: vi
        .fn()
        .mockResolvedValue({ ok: true, record: LIVE_RECORD, stale: [] }),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    });
    expect(screen.queryByTestId("stale-badge")).not.toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith("数据已刷新", "success");
  });

  it("刷新失败 → 错误 toast 透出归一文案", async () => {
    renderModal({
      dashboard: LIVE_RECORD,
      onRefresh: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "刷新失败：数据源连接失败（502）" }),
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    });
    const { toast } = await import("@/lib/toast");
    expect(toast).toHaveBeenCalledWith(
      "刷新失败：数据源连接失败（502）",
      "error"
    );
  });

  it("onRefresh 接线链路抛异常 → 兜底错误 toast，按钮恢复可点", async () => {
    renderModal({
      dashboard: LIVE_RECORD,
      onRefresh: vi.fn().mockRejectedValue(new Error("unexpected")),
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    });
    const { toast } = await import("@/lib/toast");
    expect(toast).toHaveBeenCalledWith("刷新失败，请稍后重试", "error");
    expect(screen.getByRole("button", { name: "刷新数据" })).toBeEnabled();
    expect(screen.queryByText("刷新中…")).not.toBeInTheDocument();
  });

  it("父层回写最新记录（新 dsl + 新 dataUpdatedAt）→ 渲染随 prop 更新", async () => {
    const fresh: DashboardRecord = {
      ...LIVE_RECORD,
      dsl: "root = Root([funnel, data = 99])",
      dataUpdatedAt: Date.now(),
    };
    const props = renderModal({
      dashboard: LIVE_RECORD,
      onRefresh: vi.fn().mockResolvedValue({ ok: true, record: fresh, stale: [] }),
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    });
    // 模拟父层 setPreviewDashboard(fresh) 回写
    cleanup();
    render(<DashboardPreviewModal {...props} dashboard={fresh} />);
    expect(screen.getByTestId("renderer")).toHaveTextContent("data = 99");
    expect(screen.getByText(/数据时间/)).toBeInTheDocument();
  });
});
