// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadUserMethodCards,
  createAppMethodology,
} from "./methodologyLoader";
import {
  builtinMethodCards,
  renderMethodIndex,
  renderCardDetail,
} from "@openui-analytics/methodology";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "methodology-loader-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeCard(file: string, content: unknown): void {
  fs.writeFileSync(path.join(dir, file), JSON.stringify(content), "utf-8");
}

const GOOD_CARD = {
  id: "retail-gmv",
  name: "GMV 分解分析",
  when: "电商 GMV 为何变化？流量×转化×客单哪个因子贡献大",
  steps: ["按渠道拆解 GMV = 流量 × 转化率 × 客单价", "计算各因子贡献率排序"],
  chartPairing: ["AnalyticsChart", "MetricCard"],
  executeGuidance: "Decompose GMV multiplicatively into traffic × CVR × AOV and rank factor contributions.",
};

describe("loadUserMethodCards", () => {
  it("目录不存在 → 零卡不报错（正常态）", () => {
    const { cards, skipped } = loadUserMethodCards(path.join(dir, "ghost"));
    expect(cards).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("单卡对象与卡数组两种文件形态都装载；空目录零卡", () => {
    writeCard("single.json", GOOD_CARD);
    writeCard("batch.json", [
      { ...GOOD_CARD, id: "batch-a", name: "批量卡A" },
      { ...GOOD_CARD, id: "batch-b", name: "批量卡B" },
    ]);
    const { cards, skipped } = loadUserMethodCards(dir);
    expect(cards.map((c) => c.id).sort()).toEqual([
      "batch-a",
      "batch-b",
      "retail-gmv",
    ]);
    expect(skipped).toEqual([]);
  });

  it("坏 JSON 跳过并 warn，不拖垮其余卡加载", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fs.writeFileSync(path.join(dir, "broken.json"), "{oops", "utf-8");
    writeCard("good.json", GOOD_CARD);

    const { cards, skipped } = loadUserMethodCards(dir);
    expect(cards).toHaveLength(1);
    expect(skipped[0].cardId).toBe("broken.json");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("broken.json")
    );
  });

  it("形态不完整卡（缺 steps/非法 id）跳过并 warn", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeCard("shapeless.json", { id: "x", name: "缺字段" });

    const { cards, skipped } = loadUserMethodCards(dir);
    expect(cards).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("形态不完整"));
  });
});

describe("createAppMethodology（三级扩展链路）", () => {
  it("内置 + 用户卡合并：新 id 进库、同 id 覆盖内置", () => {
    writeCard("extra.json", GOOD_CARD);
    writeCard("override.json", {
      ...GOOD_CARD,
      id: "trend",
      name: "定制趋势法",
    });

    const { library, skipped } = createAppMethodology(dir);
    expect(skipped).toEqual([]);
    // 新 id 可检索且详情可渲染
    expect(library.find("retail-gmv")?.name).toBe("GMV 分解分析");
    expect(renderCardDetail(library.find("retail-gmv")!)).toContain(
      "### Method retail-gmv"
    );
    // 同 id 覆盖内置
    expect(library.find("trend")?.name).toBe("定制趋势法");
    expect(library.find("trend")?.when).not.toBe(
      builtinMethodCards.find((c) => c.id === "trend")?.when
    );
    // 覆盖在索引渲染中立即可见（11 卡超 1KB 预算会截断尾部，断言头部条目）
    expect(renderMethodIndex(library.cards)).toContain("- trend: 定制趋势法");
  });

  it("零用户卡：纯内置库（与 handler 缺省等价）", () => {
    const { library } = createAppMethodology(dir);
    expect(library.cards.map((c) => c.id)).toEqual(
      builtinMethodCards.map((c) => c.id)
    );
  });
});
