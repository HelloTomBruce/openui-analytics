import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MethodologyModal } from "./MethodologyModal";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PAYLOAD = {
  cards: [
    {
      id: "trend",
      name: "趋势与同比环比",
      when: "指标随时间如何变化？",
      steps: ["按时间粒度聚合目标指标", "计算环比与同比变化率"],
      chartPairing: ["AnalyticsChart", "MetricCard"],
      source: "builtin",
    },
    {
      id: "trend-custom",
      name: "趋势分析（定制版）",
      when: "自定义口径的趋势怎么看？",
      steps: ["第一步"],
      chartPairing: ["AnalyticsChart"],
      source: "user",
    },
  ],
  counts: { builtin: 1, user: 1, overridden: 0 },
  skipped: [{ cardId: "broken.json", reason: "JSON 解析失败" }],
};

const fetchMock = vi.fn();

function renderModal(overrides?: Partial<Parameters<typeof MethodologyModal>[0]>) {
  const props = { open: true, onClose: vi.fn(), ...overrides };
  render(<MethodologyModal {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("MethodologyModal 方法论查看", () => {
  it("打开时拉取 /api/methodology 并渲染卡列表（名称/步骤/配对/来源徽章）", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, PAYLOAD));
    vi.stubGlobal("fetch", fetchMock);

    renderModal();

    expect(fetchMock).toHaveBeenCalledWith("/api/methodology");
    expect(
      await screen.findByText("趋势与同比环比")
    ).toBeInTheDocument();
    expect(screen.getByText("指标随时间如何变化？")).toBeInTheDocument();
    expect(screen.getByText("按时间粒度聚合目标指标")).toBeInTheDocument();
    expect(screen.getByText("MetricCard")).toBeInTheDocument();
    // 来源徽章：内置 / 自定义覆盖
    expect(screen.getByText("内置")).toBeInTheDocument();
    expect(screen.getByText("自定义覆盖")).toBeInTheDocument();
    // 跳过卡提示
    expect(screen.getByText(/1 张自定义卡被跳过/)).toBeInTheDocument();
  });

  it("open=false 不拉取、不渲染内容", () => {
    fetchMock.mockResolvedValue(jsonResponse(200, PAYLOAD));
    vi.stubGlobal("fetch", fetchMock);

    renderModal({ open: false });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText("趋势与同比环比")).not.toBeInTheDocument();
  });

  it("加载失败展示错误态，重试成功后恢复列表", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { error: "boom" }))
      .mockResolvedValueOnce(jsonResponse(200, PAYLOAD));
    vi.stubGlobal("fetch", fetchMock);

    renderModal();

    expect(await screen.findByText(/加载失败/)).toBeInTheDocument();
    expect(screen.queryByText("趋势与同比环比")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    expect(await screen.findByText("趋势与同比环比")).toBeInTheDocument();
  });

  it("响应缺 cards 字段视为格式错误", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { foo: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    renderModal();

    expect(await screen.findByText(/响应格式不正确/)).toBeInTheDocument();
  });
});
