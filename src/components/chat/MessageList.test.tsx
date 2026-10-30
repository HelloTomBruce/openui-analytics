import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { Message } from "@ai-sdk/react";
import { extractOpenUI } from "@/lib/extractOpenUI";
import { toast } from "@/lib/toast";
import { MessageList } from "./MessageList";
import type { FavoriteResult } from "@/hooks/useDashboards";

vi.mock("@/lib/extractOpenUI", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extractOpenUI")>();
  return { ...actual, extractOpenUI: vi.fn(actual.extractOpenUI) };
});

vi.mock("@/lib/toast", () => ({ toast: vi.fn() }));

vi.mock("@/components/OpenUIRenderer", () => ({
  OpenUIRenderer: () => <div data-testid="renderer" />,
}));

const userMsg: Message = { id: "u1", role: "user", content: "分析营收" };
const aiMsg: Message = { id: "a1", role: "assistant", content: "结论如下" };

// AI SDK 运行时会在 data stream v1 上附加 toolInvocations（组件按可选字段读取）
function withTools(tools: Array<{ toolName: string; args?: Record<string, unknown> }>): Message[] {
  return [
    userMsg,
    {
      ...aiMsg,
      toolInvocations: tools.map((t, i) => ({
        toolCallId: `call-${i}`,
        toolName: t.toolName,
        args: t.args ?? {},
        state: "result",
        result: {},
      })),
    } as unknown as Message,
  ];
}

describe("MessageList 流式重渲染治理", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("动态源前缀工具归因到源名称，未匹配走通用兜底", () => {
    render(
      <MessageList
        messages={withTools([
          { toolName: "zhaobiao_list_tables" },
          { toolName: "execute_sql", args: { sql: "SELECT 1" } },
          { toolName: "zhaobiao_execute_sql", args: { sql: "SELECT 2" } },
        ])}
        status="ready"
        error={undefined}
        showRawLang={false}
        activeSources={[
          { id: "zhaobiao", name: "招标平台数据/" },
        ]}
        onRendererAction={vi.fn()}
        onReload={vi.fn()}
      />
    );

    expect(screen.getByText(/\[招标平台数据\/\] 调用: zhaobiao_list_tables/)).toBeInTheDocument();
    // 无前缀匹配走通用兜底；同契约动态源按前缀归因
    expect(screen.getByText(/\[MCP Tool\] 调用: execute_sql/)).toBeInTheDocument();
    expect(screen.getByText(/\[招标平台数据\/\] 执行 SQL: SELECT 2/)).toBeInTheDocument();
  });

  it("加载提示反映会话启用源，未提供时回落通用文案", () => {
    const base = {
      messages: [userMsg],
      status: "submitted" as const,
      error: undefined,
      showRawLang: false,
      onRendererAction: vi.fn(),
      onReload: vi.fn(),
    };

    const { rerender } = render(
      <MessageList {...base} activeSources={[{ id: "zhaobiao", name: "招标平台数据/" }]} />
    );
    expect(screen.getByText(/正在分析意图并连接.*招标平台数据\//)).toBeInTheDocument();

    rerender(<MessageList {...base} activeSources={undefined} />);
    expect(screen.getByText(/正在分析意图并连接已启用的数据源/)).toBeInTheDocument();
  });

  it("流式状态变化时，历史消息不重复执行内容提取（memo 生效）", () => {
    const props = {
      messages: [userMsg, aiMsg],
      status: "ready",
      error: undefined,
      showRawLang: false,
      onRendererAction: vi.fn(),
      onReload: vi.fn(),
    };

    const { rerender } = render(<MessageList {...props} />);
    expect(vi.mocked(extractOpenUI)).toHaveBeenCalledTimes(2);

    // 流式开始：仅最后一条消息的 isStreaming 变化
    rerender(<MessageList {...props} status="streaming" />);
    // user 消息 props 未变（memo 拦截）；ai 消息重渲染但 content 未变（useMemo 拦截）
    expect(vi.mocked(extractOpenUI)).toHaveBeenCalledTimes(2);
  });

  it("新消息到达时只为新消息执行提取", () => {
    const base = {
      messages: [userMsg, aiMsg],
      status: "ready",
      error: undefined,
      showRawLang: false,
      onRendererAction: vi.fn(),
      onReload: vi.fn(),
    };
    const { rerender } = render(<MessageList {...base} />);
    expect(vi.mocked(extractOpenUI)).toHaveBeenCalledTimes(2);

    const newMsg: Message = { id: "u2", role: "user", content: "再问一个" };
    rerender(<MessageList {...base} messages={[userMsg, aiMsg, newMsg]} />);
    expect(vi.mocked(extractOpenUI)).toHaveBeenCalledTimes(3);
  });
});

describe("MessageList 快捷滚动操作", () => {
  const base = {
    messages: [userMsg, aiMsg],
    status: "ready" as const,
    error: undefined,
    showRawLang: false,
    onRendererAction: vi.fn(),
    onReload: vi.fn(),
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /** mock 滚动容器布局属性（jsdom 不做布局，默认全 0） */
  function mockScrollMetrics(
    el: HTMLElement,
    metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }
  ) {
    Object.defineProperty(el, "scrollHeight", { value: metrics.scrollHeight, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: metrics.clientHeight, configurable: true });
    Object.defineProperty(el, "scrollTop", { value: metrics.scrollTop, configurable: true });
  }

  function getScrollContainer(container: HTMLElement): HTMLDivElement {
    const el = container.querySelector<HTMLDivElement>("[data-scroll-container]");
    if (!el) throw new Error("滚动容器未找到");
    return el;
  }

  it("短列表无溢出时不显示任何快捷滚动按钮", () => {
    const { container } = render(<MessageList {...base} />);
    const el = getScrollContainer(container);
    fireEvent.scroll(el); // 默认全 0：视为在底部

    expect(screen.queryByRole("button", { name: "回到底部" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "回到顶部" })).not.toBeInTheDocument();
  });

  it("位于顶部时仅显示回到底部，点击平滑滚动到底", () => {
    const { container } = render(<MessageList {...base} />);
    const el = getScrollContainer(container);
    el.scrollTo = vi.fn();
    mockScrollMetrics(el, { scrollHeight: 2000, clientHeight: 500, scrollTop: 0 });
    fireEvent.scroll(el);

    const btn = screen.getByRole("button", { name: "回到底部" });
    expect(screen.queryByRole("button", { name: "回到顶部" })).not.toBeInTheDocument();

    fireEvent.click(btn);
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "smooth" });
  });

  it("位于中部时顶/底两个按钮都显示", () => {
    const { container } = render(<MessageList {...base} />);
    const el = getScrollContainer(container);
    mockScrollMetrics(el, { scrollHeight: 2000, clientHeight: 500, scrollTop: 800 });
    fireEvent.scroll(el);

    expect(screen.getByRole("button", { name: "回到底部" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回到顶部" })).toBeInTheDocument();
  });

  it("位于底部时仅显示回到顶部，点击回到顶部", () => {
    const { container } = render(<MessageList {...base} />);
    const el = getScrollContainer(container);
    el.scrollTo = vi.fn();
    mockScrollMetrics(el, { scrollHeight: 2000, clientHeight: 500, scrollTop: 1500 });
    fireEvent.scroll(el);

    const btn = screen.getByRole("button", { name: "回到顶部" });
    expect(screen.queryByRole("button", { name: "回到底部" })).not.toBeInTheDocument();

    fireEvent.click(btn);
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});

describe("看板打印导出", () => {
  const dashboardMsg: Message = {
    id: "d1",
    role: "assistant",
    content: '结论如下\n```openui\n{"type":"Stack","children":[]}\n```',
  };

  const baseProps = {
    status: "ready" as const,
    error: undefined,
    showRawLang: false,
    activeSources: undefined,
    onRendererAction: vi.fn(),
    onReload: vi.fn(),
  };

  let printSpy: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    printSpy = vi.fn<() => void>();
    window.print = printSpy;
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove("print-mode");
    vi.clearAllMocks();
  });

  it("就绪看板显示导出按钮；点击后进入打印模式并调用 window.print", async () => {
    const { container } = render(
      <MessageList {...baseProps} messages={[userMsg, dashboardMsg]} />
    );

    const btn = screen.getByRole("button", { name: /导出 PDF/ });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);

    // 目标消息标记 + body 打印模式
    expect(document.body.classList.contains("print-mode")).toBe(true);
    const target = container.querySelector(".print-target");
    expect(target).not.toBeNull();
    expect(target?.className).toContain("print-message");

    // rAF 后触发浏览器打印
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
  });

  it("afterprint 后清理标记还原页面", async () => {
    const { container } = render(
      <MessageList {...baseProps} messages={[dashboardMsg]} />
    );
    fireEvent.click(screen.getByRole("button", { name: /导出 PDF/ }));
    expect(document.body.classList.contains("print-mode")).toBe(true);

    fireEvent(window, new Event("afterprint"));

    await waitFor(() => {
      expect(document.body.classList.contains("print-mode")).toBe(false);
      expect(container.querySelector(".print-target")).toBeNull();
    });
  });

  it("流式中的看板导出按钮禁用", () => {
    render(
      <MessageList
        {...baseProps}
        status="streaming"
        messages={[userMsg, dashboardMsg]}
      />
    );
    expect(screen.getByRole("button", { name: /导出 PDF/ })).toBeDisabled();
  });

  it("无看板的消息不显示导出按钮", () => {
    render(<MessageList {...baseProps} messages={[userMsg, aiMsg]} />);
    expect(
      screen.queryByRole("button", { name: /导出 PDF/ })
    ).not.toBeInTheDocument();
  });

  it("执行步骤与分析文字标记 no-print，仅看板本体导出", () => {
    const msgWithTools = {
      ...dashboardMsg,
      toolInvocations: [
        {
          toolCallId: "call-1",
          toolName: "pg_execute_sql",
          args: { sql: "SELECT 1" },
          state: "result",
          result: {},
        },
      ],
    } as unknown as Message;
    render(<MessageList {...baseProps} messages={[msgWithTools]} />);

    // 执行步骤（工具调用指示器）与分析文字均排除在打印范围外
    const toolBadge = screen
      .getByText(/\[MCP Tool\] 调用: pg_execute_sql/)
      .closest(".no-print");
    expect(toolBadge).not.toBeNull();
    const thinking = screen.getByText("结论如下").closest(".no-print");
    expect(thinking).not.toBeNull();
    // 看板本体（渲染器）不在 no-print 容器内
    expect(screen.getByTestId("renderer").closest(".no-print")).toBeNull();
  });
});

describe("看板收藏", () => {
  const boardMsg: Message = {
    id: "b1",
    role: "assistant",
    content: "分析结论\n```openui\nroot = Root([table])\n```",
  };

  const baseProps = {
    status: "ready" as const,
    error: undefined,
    showRawLang: false,
    activeSources: undefined,
    onRendererAction: vi.fn(),
    onReload: vi.fn(),
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("就绪看板显示收藏按钮；点击组装完整载荷（dsl/前文 prompt/origin.messageId）并成功 toast", async () => {
    const onFavorite = vi.fn<() => Promise<FavoriteResult>>(
      () => Promise.resolve({ ok: true })
    );
    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, boardMsg]}
        onFavoriteDashboard={onFavorite}
      />
    );

    const btn = screen.getByRole("button", { name: /收藏看板（消息 b1）/ });
    expect(btn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(onFavorite).toHaveBeenCalledWith({
      dsl: "root = Root([table])",
      prompt: "分析营收",
      sourceNames: undefined,
      origin: { messageId: "b1" },
    });
    expect(toast).toHaveBeenCalledWith("已收藏到看板库", "success");
  });

  it("已收藏（按 favoritedMessageIds 判定）显示实心态「已收藏」；再点仍调用（覆盖更新语义）", async () => {
    const onFavorite = vi.fn<() => Promise<FavoriteResult>>(
      () => Promise.resolve({ ok: true })
    );
    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, boardMsg]}
        favoritedMessageIds={new Set(["b1"])}
        onFavoriteDashboard={onFavorite}
      />
    );

    const btn = screen.getByRole("button", { name: /已收藏，点击覆盖更新/ });
    expect(btn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onFavorite).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("收藏已更新", "success");
  });

  it("收藏失败（如 413）→ toast 错误文案", async () => {
    const onFavorite = vi.fn<() => Promise<FavoriteResult>>(() =>
      Promise.resolve({ ok: false, error: "dsl 超过 2097152 字符上限（2MB）" })
    );
    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, boardMsg]}
        onFavoriteDashboard={onFavorite}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /收藏看板（消息 b1）/ }));
    });
    expect(toast).toHaveBeenCalledWith(
      "dsl 超过 2097152 字符上限（2MB）",
      "error"
    );
  });

  it("流式中的收藏按钮禁用", () => {
    render(
      <MessageList
        {...baseProps}
        status="streaming"
        messages={[userMsg, boardMsg]}
        onFavoriteDashboard={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /收藏看板（消息 b1）/ })
    ).toBeDisabled();
  });

  it("收藏进行中按钮禁用；完成后恢复并 toast", async () => {
    let resolveFavorite!: (v: FavoriteResult) => void;
    const deferred = new Promise<FavoriteResult>((r) => {
      resolveFavorite = r;
    });
    const onFavorite = vi.fn(() => deferred);
    render(
      <MessageList
        {...baseProps}
        messages={[userMsg, boardMsg]}
        onFavoriteDashboard={onFavorite}
      />
    );

    const btn = screen.getByRole("button", { name: /收藏看板（消息 b1）/ });
    await act(async () => {
      fireEvent.click(btn);
    });

    // 进行中：禁用（loading 态）
    await waitFor(() => expect(btn).toBeDisabled());

    await act(async () => {
      resolveFavorite({ ok: true });
    });
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(toast).toHaveBeenCalledWith("已收藏到看板库", "success");
  });

  it("未提供收藏回调时不显示收藏按钮", () => {
    render(<MessageList {...baseProps} messages={[userMsg, boardMsg]} />);
    expect(
      screen.queryByRole("button", { name: /收藏/ })
    ).not.toBeInTheDocument();
  });

  it("sourceNames 归档当前启用源名称", async () => {
    const onFavorite = vi.fn<() => Promise<FavoriteResult>>(
      () => Promise.resolve({ ok: true })
    );
    render(
      <MessageList
        {...baseProps}
        activeSources={[
          { id: "gitlab", name: "GitLab" },
          { id: "zentao", name: "禅道" },
        ]}
        messages={[userMsg, boardMsg]}
        onFavoriteDashboard={onFavorite}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /收藏看板（消息 b1）/ }));
    });
    expect(onFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ sourceNames: ["GitLab", "禅道"] })
    );
  });
});
