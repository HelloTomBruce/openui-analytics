import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FocusLayout } from "./FocusLayout";
import { ComparisonLayout } from "./ComparisonLayout";

// vitest 未开 globals，testing-library 的自动 cleanup 不会注册，需显式清理
afterEach(cleanup);

describe("FocusLayout 深钻模板", () => {
  it("渲染页头、主区、侧栏与底部明细", () => {
    render(
      <FocusLayout
        title="为什么 Q3 CAC 上升"
        subtitle="TikTok Ads 单渠道归因"
        main={<div>CAC 周趋势图</div>}
        side={<div>归因结论卡</div>}
        detail={<div>高成本计划明细表</div>}
      />
    );
    expect(screen.getByText("为什么 Q3 CAC 上升")).toBeInTheDocument();
    expect(screen.getByText("TikTok Ads 单渠道归因")).toBeInTheDocument();
    expect(screen.getByText("CAC 周趋势图")).toBeInTheDocument();
    expect(screen.getByText("归因结论卡")).toBeInTheDocument();
    expect(screen.getByText("高成本计划明细表")).toBeInTheDocument();
  });

  it("无侧栏时主区占满整行（不渲染 1/3 空列）", () => {
    render(<FocusLayout title="仅主图" main={<div>主图</div>} />);
    expect(screen.getByText("主图")).toBeInTheDocument();
    // 主区容器不携带 2/3 跨列类（占满 3 列）
    const mainCell = screen.getByText("主图").closest("div.lg\\:col-span-3");
    expect(mainCell).not.toBeNull();
  });

  it("完全无内容时不渲染页头占位", () => {
    const { container } = render(<FocusLayout main={null} />);
    expect(container.querySelector("h2")).toBeNull();
  });
});

describe("ComparisonLayout 对比模板", () => {
  it("渲染页头、左右栏标签与栏内容", () => {
    render(
      <ComparisonLayout
        title="TikTok vs Google 渠道效率对比"
        subtitle="2026 Q3 · 获客"
        leftLabel="TikTok Ads"
        left={<div>左栏指标</div>}
        rightLabel="Google Ads"
        right={<div>右栏指标</div>}
        verdict={<div>对比结论</div>}
      />
    );
    expect(screen.getByText("TikTok vs Google 渠道效率对比")).toBeInTheDocument();
    expect(screen.getByText("TikTok Ads")).toBeInTheDocument();
    expect(screen.getByText("Google Ads")).toBeInTheDocument();
    expect(screen.getByText("左栏指标")).toBeInTheDocument();
    expect(screen.getByText("右栏指标")).toBeInTheDocument();
    expect(screen.getByText("对比结论")).toBeInTheDocument();
  });

  it("标签缺失时降级为左右占位文案", () => {
    render(
      <ComparisonLayout left={<div>L</div>} right={<div>R</div>} />
    );
    expect(screen.getByText("左")).toBeInTheDocument();
    expect(screen.getByText("右")).toBeInTheDocument();
  });

  it("无结论区时不渲染占位", () => {
    render(
      <ComparisonLayout
        title="无结论对比"
        leftLabel="A"
        left={<div>A 内容</div>}
        rightLabel="B"
        right={<div>B 内容</div>}
      />
    );
    expect(screen.getByText("无结论对比")).toBeInTheDocument();
    expect(screen.queryByText("verdict")).toBeNull();
  });
});
