import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useChat } from "@ai-sdk/react";
import ChatDashboard from "../ChatDashboard";
import { DEFAULT_WELCOME_MESSAGE, createNewSession } from "@/lib/sessionStorage";

// mock useChat：返回固定消息列表，避免真实网络流
vi.mock("@ai-sdk/react", () => ({
  useChat: vi.fn(() => ({
    messages: [DEFAULT_WELCOME_MESSAGE],
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
  })),
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
