import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SettingsModal, type SettingsModalProps } from "./SettingsModal";

// mock /api/datasources：返回一个健康数据源，锁定「数据源」tab 状态渲染
const fetchMock = vi.fn().mockResolvedValue({
  json: async () => ({
    sources: [
      { id: "zentao", name: "ZenTao MCP", kind: "zentao-cli", tools: ["search_bugs"] },
    ],
    health: { zentao: { ok: true, latencyMs: 42 } },
  }),
});

function renderModal(props: Partial<SettingsModalProps> = {}) {
  return render(
    <SettingsModal
      apiKey="sk-test"
      baseURL="https://api.openai.com/v1"
      model="gpt-4o-mini"
      accessToken=""
      temperature="0.2"
      protocol="openai"
      onApiKeyChange={vi.fn()}
      onBaseURLChange={vi.fn()}
      onModelChange={vi.fn()}
      onAccessTokenChange={vi.fn()}
      onTemperatureChange={vi.fn()}
      onProtocolChange={vi.fn()}
      onSave={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  );
}

afterEach(cleanup);

describe("SettingsModal tab 布局", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("标题为「设置」，含模型配置 / 数据源两个 tab", () => {
    renderModal();
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "模型配置" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "数据源" })).toBeInTheDocument();
  });

  it("默认展示模型配置面板，数据源内容不渲染", () => {
    renderModal();
    expect(screen.getByRole("tabpanel", { name: "模型配置" })).toBeInTheDocument();
    expect(screen.getByLabelText("API Key")).toHaveValue("sk-test");
    expect(screen.queryByLabelText(/GitLab MCP Endpoint/)).not.toBeInTheDocument();
  });

  it("点击「数据源」tab 切换面板，展示数据源列表与探活状态", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "数据源" }));

    // 数据源列表由 DatasourceSettings 经 /api/datasources 渲染（mock 返回 ZenTao MCP）
    await waitFor(() => {
      expect(screen.getByText("ZenTao MCP")).toBeInTheDocument();
      expect(screen.getByText("42ms")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /添加数据源/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "数据源" })
    ).toHaveAttribute("aria-selected", "true");
  });

  it("键盘 ArrowRight 从模型配置切到数据源", () => {
    renderModal();
    fireEvent.keyDown(screen.getByRole("tab", { name: "模型配置" }), {
      key: "ArrowRight",
    });
    expect(
      screen.getByRole("button", { name: /添加数据源/ })
    ).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "数据源" })
    );
  });

  it("底部按钮触发 onClose / onSave", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    renderModal({ onSave, onClose });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsModal 协议类型", () => {
  it("默认选中 OpenAI 兼容，baseURL 占位符为 OpenAI 形态", () => {
    renderModal();

    const openaiBtn = screen.getByRole("radio", { name: /OpenAI 兼容/i });
    const anthropicBtn = screen.getByRole("radio", { name: /Anthropic/i });
    expect(openaiBtn).toBeChecked();
    expect(anthropicBtn).not.toBeChecked();
    expect(screen.getByLabelText(/Base URL/i)).toHaveAttribute(
      "placeholder",
      "https://api.openai.com/v1"
    );
  });

  it("点击 Anthropic 调用 onProtocolChange('anthropic')，占位符随 protocol 切换为 Anthropic 形态", () => {
    const onProtocolChange = vi.fn();
    renderModal({ onProtocolChange });

    fireEvent.click(screen.getByRole("radio", { name: /Anthropic/i }));

    expect(onProtocolChange).toHaveBeenCalledWith("anthropic");

    // 受控组件：以 protocol="anthropic" 重渲染后占位符切换
    cleanup();
    renderModal({ protocol: "anthropic" });
    expect(screen.getByLabelText(/Base URL/i)).toHaveAttribute(
      "placeholder",
      "https://api.kimi.com/coding"
    );
  });
});
