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
      providerId="custom"
      apiKey="sk-test"
      baseURL="https://api.openai.com/v1"
      model="gpt-4o-mini"
      accessToken=""
      temperature="0.2"
      maxTokens=""
      protocol="openai"
      onProviderChange={vi.fn()}
      onApiKeyChange={vi.fn()}
      onBaseURLChange={vi.fn()}
      onModelChange={vi.fn()}
      onAccessTokenChange={vi.fn()}
      onTemperatureChange={vi.fn()}
      onMaxTokensChange={vi.fn()}
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
    const tab = screen.getByRole("tab", { name: "数据源" });
    // Radix Tabs 在 mousedown 激活（真实浏览器点击天然携带）
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.click(tab);

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

  it("焦点移入「数据源」tab 自动激活面板（Radix Tabs 自动激活模式）", () => {
    renderModal();
    // 注：Radix RovingFocus 的方向键导航在 jsdom 中不生效（真实浏览器正常），
    // 方向键移焦后由 onFocus 自动激活——此处直接验证该激活语义
    const tab = screen.getByRole("tab", { name: "数据源" });
    fireEvent.focus(tab);
    expect(
      screen.getByRole("button", { name: /添加数据源/ })
    ).toBeInTheDocument();
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

describe("SettingsModal Provider 预设", () => {
  it("Provider 下拉含全部预设与「自定义」", async () => {
    renderModal();

    // shadcn Select（Radix）：选项渲染在打开后的 listbox 弹层中
    const trigger = screen.getByLabelText(/Provider/);
    fireEvent.pointerDown(trigger, { pointerType: "mouse", button: 0 });
    fireEvent.click(trigger);
    // 内置精选 10 项（无网络环境目录拉取失败回退内置）+ 自定义
    const options = await screen.findAllByRole("option");
    expect(options.length).toBe(11);
    expect(
      screen.getByRole("option", { name: "Kimi（Moonshot）" })
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "自定义" })).toBeInTheDocument();
  });

  it("预设 Provider 时 Model 为手输输入框 + datalist 建议（非强约束下拉）", () => {
    renderModal({
      providerId: "deepseek",
      protocol: "openai",
      baseURL: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
    });
    const modelInput = screen.getByLabelText(
      /Model（手动输入/
    ) as HTMLInputElement;
    expect(modelInput.tagName).toBe("INPUT");
    expect(modelInput.value).toBe("deepseek-chat");
    expect(modelInput).toHaveAttribute("list", "settings-model-options");
    const datalist = document.getElementById(
      "settings-model-options"
    ) as HTMLDataListElement;
    const values = Array.from(datalist.options).map((o) => o.value);
    expect(values).toContain("deepseek-reasoner");
    expect(values).toContain("deepseek-chat");
  });

  it("自定义 Provider 时无 datalist，协议与 Base URL 直接展开可见", () => {
    renderModal({ providerId: "custom" });
    const modelInput = screen.getByLabelText(
      /Model（手动输入/
    ) as HTMLInputElement;
    expect(modelInput).not.toHaveAttribute("list");
    expect(
      document.getElementById("settings-model-options")
    ).not.toBeInTheDocument();
    // 自定义场景：协议与 Base URL 不藏在折叠区
    expect(screen.queryByText(/高级：协议与接口地址/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Base URL/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /OpenAI 兼容/i })).toBeChecked();
  });

  it("预设 Provider 时协议与 Base URL 收进高级折叠区，且字段存在", () => {
    renderModal({ providerId: "deepseek" });
    expect(screen.getByText(/高级：协议与接口地址/)).toBeInTheDocument();
    // 折叠区内字段仍在 DOM（details 未展开亦可查询）
    expect(screen.getByLabelText(/Base URL/i)).toBeInTheDocument();
  });

  it("API Key 占位符随 Provider 预设变化", () => {
    renderModal({ providerId: "deepseek" });
    expect(screen.getByLabelText("API Key")).toHaveAttribute(
      "placeholder",
      "platform.deepseek.com 获取 sk-..."
    );
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
