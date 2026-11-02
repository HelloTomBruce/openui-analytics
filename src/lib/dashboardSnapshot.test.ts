// download 依赖 DOM（Blob/URL/document），本文件走默认 jsdom 环境（注意勿在首行写环境 pragma）
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseDashboardSnapshot,
  snapshotFilename,
  downloadDashboardSnapshot,
  SNAPSHOT_EXTENSION,
} from "./dashboardSnapshot";
import type { DashboardRecord } from "./dashboardStore";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("snapshotFilename", () => {
  it("正常标题拼接扩展名（空白归一为下划线，跨平台安全）", () => {
    expect(snapshotFilename("Bug 收敛漏斗")).toBe(
      `Bug_收敛漏斗${SNAPSHOT_EXTENSION}`
    );
  });

  it("非法字符与空白清洗为下划线；空标题兜底", () => {
    expect(snapshotFilename("月报/2026:Q1 *重点?")).toBe(
      `月报_2026_Q1_重点${SNAPSHOT_EXTENSION}`
    );
    expect(snapshotFilename("")).toBe(`未命名看板${SNAPSHOT_EXTENSION}`);
    expect(snapshotFilename("   ")).toBe(`未命名看板${SNAPSHOT_EXTENSION}`);
  });
});

describe("parseDashboardSnapshot", () => {
  it("完整快照解析：dsl + 可选字段收敛", () => {
    const verdict = parseDashboardSnapshot(
      JSON.stringify({
        id: "dash_ab12cd34",
        title: "月报",
        dsl: "root = Root([table])",
        prompt: "分析营收",
        sourceNames: ["GitLab", "禅道"],
        origin: { messageId: "m1" },
        createdAt: 1,
        updatedAt: 2,
      })
    );
    expect(verdict).toEqual({
      ok: true,
      value: {
        dsl: "root = Root([table])",
        title: "月报",
        prompt: "分析营收",
        sourceNames: ["GitLab", "禅道"],
      },
    });
  });

  it("坏文件逐一报错：非 JSON / 非对象 / 缺 dsl / dsl 空白", () => {
    expect(parseDashboardSnapshot("{not json").ok).toBe(false);
    expect(parseDashboardSnapshot("[1,2]").ok).toBe(false);
    expect(parseDashboardSnapshot('"string"').ok).toBe(false);
    expect(parseDashboardSnapshot(JSON.stringify({ title: "x" })).ok).toBe(
      false
    );
    expect(parseDashboardSnapshot(JSON.stringify({ dsl: "  " })).ok).toBe(false);

    const bad = parseDashboardSnapshot("{oops");
    if (!bad.ok) expect(bad.error).toContain("JSON");
  });

  it("缺省可选字段不产生空串/空数组字段", () => {
    const verdict = parseDashboardSnapshot(
      JSON.stringify({ dsl: "root = Root([])" })
    );
    expect(verdict).toEqual({ ok: true, value: { dsl: "root = Root([])" } });
  });
});

describe("downloadDashboardSnapshot", () => {
  const RECORD: DashboardRecord = {
    id: "dash_ab12cd34",
    title: "Bug 收敛漏斗",
    dsl: "root = Root([funnel])",
    createdAt: 100,
    updatedAt: 200,
  };

  it("生成 Blob 下载并清理 objectURL；文件名与内容正确", async () => {
    const createObjectURL = vi.fn((blob: Blob) => {
      void blob;
      return "blob:mock-url";
    });
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      configurable: true,
    });

    let capturedDownload = "";
    let capturedHref = "";
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        capturedDownload = this.download;
        capturedHref = this.href;
      });

    await downloadDashboardSnapshot(RECORD);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/json");
    const text = await blob.text();
    expect(JSON.parse(text).dsl).toBe("root = Root([funnel])");

    expect(capturedDownload).toBe(`Bug_收敛漏斗${SNAPSHOT_EXTENSION}`);
    expect(capturedHref).toBe("blob:mock-url");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});
