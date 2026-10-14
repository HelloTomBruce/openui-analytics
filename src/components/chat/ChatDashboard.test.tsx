import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useChat } from "@ai-sdk/react";
import ChatDashboard from "../ChatDashboard";
import { DEFAULT_WELCOME_MESSAGE, createNewSession } from "@/lib/sessionStorage";

// useChat mock 构造器：vi.mock 工厂被提升到文件顶部，只能引用 vi.hoisted 产物与导入值（惰性求值）
const buildUseChatResult = vi.hoisted(
  () =>
    (messages: unknown[]) => ({
      messages,
      setMessages: vi.fn(),
      input: "",
      handleInputChange: vi.fn(),
      handleSubmit: vi.fn((e?: { preventDefault?: () => void }) =>
        e?.preventDefault?.()
      ),
      status: "ready",
      append: vi.fn(),
      isLoading: false,
      error: undefined,
      reload: vi.fn(),
    })
);
const defaultUseChatResult = () => buildUseChatResult([DEFAULT_WELCOME_MESSAGE]);

// mock useChat：默认返回欢迎消息，避免真实网络流
vi.mock("@ai-sdk/react", () => ({
  useChat: vi.fn(() => buildUseChatResult([DEFAULT_WELCOME_MESSAGE])),
}));

// mock OpenUIRenderer：守护测试关注外壳结构，不加载 openui 渲染生态
vi.mock("@/components/OpenUIRenderer", () => ({
  OpenUIRenderer: ({ content }: { content: string }) => (
    <div data-testid="openui-renderer">{content}</div>
  ),
}));

describe("ChatDashboard 守护测试（重构行为锁定）", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleErrorSpy.mockRestore();
    vi.mocked(useChat).mockImplementation(defaultUseChatResult as never);
  });

  it("渲染欢迎消息文本", () => {
    render(<ChatDashboard />);
    expect(
      screen.getByText(/对话式数据分析助手/, { exact: false })
    ).toBeInTheDocument();
  });

  it("渲染侧边栏新建会话按钮与设置入口", () => {
    render(<ChatDashboard />);
    expect(screen.getByText("新建对话会话")).toBeInTheDocument();
    expect(screen.getByTitle("配置大模型与 MCP")).toBeInTheDocument();
  });

  it("useChat body 透传当前会话 enabledSources", () => {
    const session = createNewSession("带数据源会话");
    session.enabledSources = ["postgres"];
    localStorage.setItem("openui_chat_sessions_v1", JSON.stringify([session]));
    localStorage.setItem("openui_current_session_id_v1", session.id);

    render(<ChatDashboard />);

    const config = vi.mocked(useChat).mock.calls.at(-1)?.[0] as {
      body?: { sources?: string[] };
    };
    expect(config?.body?.sources).toEqual(["postgres"]);
    expect(config?.body).not.toHaveProperty("gitlabUrl");
    expect(config?.body).not.toHaveProperty("gitlabToken");
  });

  it("会话开始后（已有用户消息）数据源选择器锁定为只读", async () => {
    // 会话已有对话内容：锁定数据源选择。
    // 有状态 mock：setMessages 真正更新 messages，新建会话后可验证解锁
    const state: { messages: unknown[] } = {
      messages: [
        DEFAULT_WELCOME_MESSAGE,
        { id: "u1", role: "user", content: "分析销售额" },
      ],
    };
    vi.mocked(useChat).mockImplementation(
      () =>
        ({
          ...defaultUseChatResult(),
          setMessages: vi.fn((m: unknown[]) => {
            state.messages = m;
          }),
          get messages() {
            return state.messages;
          },
        }) as never
    );
    // 数据源列表可用，验证勾选框被禁用而非列表为空
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        json: async () => ({
          sources: [
            { id: "postgres", name: "PostgreSQL 分析库", enabled: true },
            { id: "jira", name: "Jira MCP", enabled: true },
          ],
          health: {},
        }),
      }))
    );
    try {
      render(<ChatDashboard />);
      fireEvent.click(screen.getByRole("button", { name: /数据源/ }));

      const cb = await screen.findByLabelText("Jira MCP");
      expect(cb).toBeDisabled();
      expect(screen.getByText(/已锁定/)).toBeInTheDocument();
      // 新建会话（仅欢迎消息）应解锁
      fireEvent.click(screen.getByText("新建对话会话"));
      const cbFresh = await screen.findByLabelText("Jira MCP");
      expect(cbFresh).not.toBeDisabled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("首次渲染无 React 错误 / hydration 告警", () => {
    render(<ChatDashboard />);
    const reactErrors = consoleErrorSpy.mock.calls.filter((args: unknown[]) =>
      args.some(
        (a: unknown) =>
          typeof a === "string" &&
          (a.includes("Hydrat") ||
            a.includes("hydrat") ||
            a.includes("did not match") ||
            a.includes("Error:"))
      )
    );
    expect(reactErrors).toEqual([]);
  });
});
