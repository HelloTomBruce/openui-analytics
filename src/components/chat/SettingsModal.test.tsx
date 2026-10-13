import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";

// mock /api/datasources：返回一个健康数据源，锁定「数据源」tab 状态渲染
const fetchMock = vi.fn().mockResolvedValue({
  json: async () => ({
    sources: [
      { id: "zentao", name: "ZenTao MCP", kind: "zentao-cli", tools: ["search_bugs"] },
    ],
    health: { zentao: { ok: true, latencyMs: 42 } },
  }),
});

function renderModal() {
  return render(
    <SettingsModal
      apiKey="sk-test"
      baseURL="https://api.openai.com/v1"
      model="gpt-4o-mini"
      gitlabToken="glpat-x"
      gitlabUrl="http://127.0.0.1:5002/mcp"
      accessToken=""
      temperature="0.2"
      onApiKeyChange={vi.fn()}
      onBaseURLChange={vi.fn()}
      onModelChange={vi.fn()}
      onGitlabTokenChange={vi.fn()}
      onGitlabUrlChange={vi.fn()}
      onAccessTokenChange={vi.fn()}
      onTemperatureChange={vi.fn()}
      onSave={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

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

  it("点击「数据源」tab 切换面板，展示 GitLab 配置与探活状态", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "数据源" }));

    expect(screen.getByLabelText(/GitLab MCP Endpoint/)).toHaveValue(
      "http://127.0.0.1:5002/mcp"
    );
    expect(screen.getByText("外部 GitLab MCP 配置")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("ZenTao MCP")).toBeInTheDocument();
      expect(screen.getByText("42ms")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("tab", { name: "数据源" })
    ).toHaveAttribute("aria-selected", "true");
  });

  it("键盘 ArrowRight 从模型配置切到数据源", () => {
    renderModal();
    fireEvent.keyDown(screen.getByRole("tab", { name: "模型配置" }), {
      key: "ArrowRight",
    });
    expect(screen.getByLabelText(/GitLab MCP Endpoint/)).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "数据源" })
    );
  });

  it("底部按钮触发 onClose / onSave", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(
      <SettingsModal
        apiKey=""
        baseURL=""
        model=""
        gitlabToken=""
        gitlabUrl=""
        accessToken=""
        temperature="0.2"
        onApiKeyChange={vi.fn()}
        onBaseURLChange={vi.fn()}
        onModelChange={vi.fn()}
        onGitlabTokenChange={vi.fn()}
        onGitlabUrlChange={vi.fn()}
        onAccessTokenChange={vi.fn()}
        onTemperatureChange={vi.fn()}
        onSave={onSave}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
