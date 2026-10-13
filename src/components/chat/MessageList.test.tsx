import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Message } from "@ai-sdk/react";
import { extractOpenUI } from "@/lib/extractOpenUI";
import { MessageList } from "./MessageList";

vi.mock("@/lib/extractOpenUI", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extractOpenUI")>();
  return { ...actual, extractOpenUI: vi.fn(actual.extractOpenUI) };
});

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

  it("动态源前缀工具归因到源名称，内置匹配不受影响", () => {
    render(
      <MessageList
        messages={withTools([
          { toolName: "zhaobiao_list_tables" },
          { toolName: "execute_sql", args: { sql: "SELECT 1" } },
        ])}
        status="ready"
        error={undefined}
        showRawLang={false}
        activeSources={[
          { id: "zhaobiao", name: "招标平台数据/" },
          { id: "postgres", name: "PostgreSQL 分析库" },
        ]}
        onRendererAction={vi.fn()}
        onReload={vi.fn()}
      />
    );

    expect(screen.getByText(/\[招标平台数据\/\] 调用: zhaobiao_list_tables/)).toBeInTheDocument();
    expect(screen.getByText(/\[PostgreSQL MCP\] 执行 SQL: SELECT 1/)).toBeInTheDocument();
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
