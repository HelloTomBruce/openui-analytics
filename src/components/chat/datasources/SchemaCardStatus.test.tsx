import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { SchemaCardStatus } from "./SchemaCardStatus";
import { toast } from "@/lib/toast";

vi.mock("@/lib/toast", () => ({ toast: vi.fn() }));

const fetchMock = vi.fn();

function cardResponse(generatedAt: number, stale = false) {
  return new Response(
    JSON.stringify({ card: { sourceId: "pg1" }, generatedAt, stale }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

// 组件轮询间隔 800ms（真实计时器）：fake timers 会让 findByText 的 waitFor 永不推进
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("SchemaCardStatus", () => {
  it("有卡：显示生成时间；未建卡（404）：显示未生成引导", async () => {
    fetchMock.mockResolvedValueOnce(cardResponse(Date.now() - 60_000));
    render(<SchemaCardStatus sourceId="pg1" />);
    expect(await screen.findByText(/结构卡 · 生成于/)).toBeInTheDocument();

    cleanup();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "尚未生成", pending: true }), {
        status: 404,
      })
    );
    render(<SchemaCardStatus sourceId="pg2" />);
    expect(
      await screen.findByText(/结构卡：未生成（首次分析时自动生成）/)
    ).toBeInTheDocument();
  });

  it("刷新：POST 202 → 轮询至时间戳更新 → 成功 toast", async () => {
    const t0 = Date.now() - 60_000;
    const t1 = Date.now();
    // 初始 GET → 旧卡
    fetchMock.mockResolvedValueOnce(cardResponse(t0));
    render(<SchemaCardStatus sourceId="pg1" />);
    await screen.findByText(/结构卡 · 生成于/);

    // POST refresh → 202；轮询第一次仍旧卡(stale)，第二次新卡
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: true }), { status: 202 })
      )
      .mockResolvedValueOnce(cardResponse(t0, true))
      .mockResolvedValueOnce(cardResponse(t1, false));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "刷新结构卡 pg1" }));
    });
    expect(toast).toHaveBeenCalledWith("结构卡重建已开始", "info");

    // 轮询真实推进（800ms × 2）
    await waitFor(
      () => expect(toast).toHaveBeenCalledWith("结构卡已更新", "success"),
      { timeout: 5000, interval: 100 }
    );

    const calls = fetchMock.mock.calls.map((c) => [
      String(c[0]),
      (c[1] as RequestInit | undefined)?.method ?? "GET",
    ]);
    expect(calls.filter(([, m]) => m === "POST")).toEqual([
      ["/api/datasources/pg1/schema-card/refresh", "POST"],
    ]);
  }, 10000);

  it("POST 失败 → 错误 toast，不进入轮询", async () => {
    fetchMock
      .mockResolvedValueOnce(cardResponse(Date.now()))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "x" }), { status: 500 })
      );
    render(<SchemaCardStatus sourceId="pg1" />);
    await screen.findByText(/结构卡 · 生成于/);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "刷新结构卡 pg1" }));
    });
    expect(toast).toHaveBeenCalledWith("重建请求失败", "error");
  });
});
