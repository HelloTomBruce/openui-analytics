import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// 只 mock useTriggerAction（Renderer 上下文外为 undefined → 按钮禁用），
// defineComponent 等其余导出走原实现
vi.mock("@openuidev/react-lang", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openuidev/react-lang")>();
  return {
    ...actual,
    useTriggerAction: vi.fn(),
  };
});

import { useTriggerAction } from "@openuidev/react-lang";
import { PlanReviewCard } from "./PlanReviewCard";

// vitest 未开 globals，testing-library 的自动 cleanup 不会注册，需显式清理
afterEach(cleanup);

const STEPS = [
  { title: "拉取近 90 天渠道明细", detail: "按渠道聚合花费/线索/成交", chart: "DataTable" },
  { title: "计算 CAC 与转化率", chart: "MetricCard" },
];

const CLARIFICATIONS = [
  { question: "CAC 口径是否含人力成本？", options: ["仅投放花费", "投放+人力"], default: "仅投放花费" },
  { question: "分析周期？", options: ["近 90 天", "本季度"], default: "近 90 天" },
];

function setupTrigger() {
  // 签名对齐真实 useTriggerAction（首参 userMessage: string），否则 mock.calls 类型为空元组
  const triggerAction = vi.fn(async (userMessage: string) => {
    void userMessage; // 仅为签名对齐与消除未使用告警，不消费参数
  });
  vi.mocked(useTriggerAction).mockReturnValue(triggerAction);
  return triggerAction;
}

describe("PlanReviewCard 规划确认卡", () => {
  it("渲染标题/问题复述/数据基础/分步思路/澄清问题与默认假设", () => {
    setupTrigger();
    render(
      <PlanReviewCard
        title="渠道 CAC 分析思路确认"
        question="各渠道获客成本对比"
        sources={["postgres: marketing.leads", "采样验证: status 枚举"]}
        steps={STEPS}
        clarifications={CLARIFICATIONS}
      />
    );

    expect(screen.getByText("渠道 CAC 分析思路确认")).toBeInTheDocument();
    expect(screen.getByText("你的问题：各渠道获客成本对比")).toBeInTheDocument();
    expect(screen.getByText("postgres: marketing.leads")).toBeInTheDocument();
    // 步骤标题（序号在独立圆徽内）
    expect(screen.getByText("拉取近 90 天渠道明细")).toBeInTheDocument();
    expect(screen.getByText("计算 CAC 与转化率")).toBeInTheDocument();
    expect(screen.getByText("📊 DataTable")).toBeInTheDocument();
    expect(screen.getByText("📊 MetricCard")).toBeInTheDocument();
    expect(screen.getByText("1. CAC 口径是否含人力成本？")).toBeInTheDocument();
    expect(screen.getByText("默认假设：仅投放花费")).toBeInTheDocument();
    // 确认按钮默认文案
    expect(screen.getByRole("button", { name: /按此思路开始分析/ })).toBeEnabled();
  });

  it("点选澄清选项后确认：注入消息含选择结果与未答复默认假设说明", async () => {
    const triggerAction = setupTrigger();
    render(<PlanReviewCard steps={STEPS} clarifications={CLARIFICATIONS} />);

    // 第 1 题选择「投放+人力」，第 2 题不选（走默认）
    fireEvent.click(screen.getByText("投放+人力", { selector: "button" }));
    fireEvent.click(screen.getByRole("button", { name: /按此思路开始分析/ }));

    await waitFor(() => expect(triggerAction).toHaveBeenCalledTimes(1));
    const msg = triggerAction.mock.calls[0][0];
    expect(msg).toContain("请按上述已确认的分析思路开始执行");
    expect(msg).toContain("「CAC 口径是否含人力成本？」选择：投放+人力");
    expect(msg).toContain("未答复的 1 个澄清问题按其默认假设执行");
  });

  it("全部澄清均已点选时：不再出现「未答复」说明", async () => {
    const triggerAction = setupTrigger();
    render(<PlanReviewCard steps={STEPS} clarifications={CLARIFICATIONS} />);

    fireEvent.click(screen.getByText("投放+人力", { selector: "button" }));
    fireEvent.click(screen.getByText("本季度", { selector: "button" }));
    fireEvent.click(screen.getByRole("button", { name: /按此思路开始分析/ }));

    await waitFor(() => expect(triggerAction).toHaveBeenCalledTimes(1));
    const msg = triggerAction.mock.calls[0][0];
    expect(msg).toContain("「分析周期？」选择：本季度");
    expect(msg).not.toContain("未答复");
  });

  it("steps 传 JSON 字符串（LLM 输出容错）也能渲染步骤清单", () => {
    setupTrigger();
    render(
      <PlanReviewCard
        title="规划"
        steps={JSON.stringify(STEPS) as unknown as typeof STEPS}
      />
    );
    expect(screen.getByText("计算 CAC 与转化率")).toBeInTheDocument();
  });

  it("无 Renderer 上下文（useTriggerAction 为 undefined）时确认按钮禁用不抛错", () => {
    vi.mocked(useTriggerAction).mockReturnValue(undefined as never);
    render(<PlanReviewCard steps={STEPS} />);
    expect(screen.getByRole("button", { name: /按此思路开始分析/ })).toBeDisabled();
  });
});
