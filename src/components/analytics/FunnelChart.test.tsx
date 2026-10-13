import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FunnelChart } from "./FunnelChart";

// vitest 未开 globals，testing-library 的自动 cleanup 不会注册，需显式清理
afterEach(cleanup);

describe("FunnelChart 流失率标注", () => {
  it("阶段间连接线展示「当前 → 下一阶段」的流失率", () => {
    render(
      <FunnelChart
        stages={[
          { name: "曝光", value: 100 },
          { name: "点击", value: 80 },
          { name: "转化", value: 40 },
        ]}
      />
    );
    // 100→80 流失 20%，80→40 流失 50%
    expect(screen.getByText("流失率: ~20%")).toBeInTheDocument();
    expect(screen.getByText("流失率: ~50%")).toBeInTheDocument();
  });

  it("末阶段不渲染连接线", () => {
    render(
      <FunnelChart
        stages={[
          { name: "曝光", value: 100 },
          { name: "转化", value: 50 },
        ]}
      />
    );
    // 两个阶段之间只应有一条连接线（限定叶子 span，避免父容器 textContent 重复命中）
    expect(screen.getAllByText("流失率: ~50%", { selector: "span" })).toHaveLength(1);
  });

  it("当前阶段值为 0 时不产生 NaN/Infinity", () => {
    render(
      <FunnelChart
        stages={[
          { name: "曝光", value: 0 },
          { name: "转化", value: 50 },
        ]}
      />
    );
    expect(screen.getByText("流失率: ~0%")).toBeInTheDocument();
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  });
});
