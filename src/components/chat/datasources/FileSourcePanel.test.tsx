import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { FileSourcePanel } from "./FileSourcePanel";
import { resetDatasourceCacheForTests } from "./useDatasources";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return { status, json: async () => body };
}

const MANIFEST = {
  files: [{ name: "sales.csv", size: 100, uploadedAt: "2026-01-01T00:00:00Z" }],
  tables: [
    {
      table: "sales",
      fromFile: "sales.csv",
      rowCount: 42,
      columns: [
        { name: "city", type: "VARCHAR" },
        { name: "amount", type: "BIGINT" },
      ],
    },
  ],
  ingestedAt: "2026-01-01T00:00:00Z",
};

describe("FileSourcePanel", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDatasourceCacheForTests();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // 默认：列表健康刷新与 manifest 均成功
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/file") && !url.includes("method")) {
        return jsonResponse({ manifest: MANIFEST });
      }
      return jsonResponse({ sources: [], health: {} });
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("渲染 manifest 表清单（行数/列数/来源文件）", async () => {
    render(<FileSourcePanel sourceId="sales" />);

    expect(await screen.findByText("sales")).toBeInTheDocument();
    expect(screen.getByText(/42 行 · 2 列/)).toBeInTheDocument();
    expect(screen.getByText(/sales\.csv/)).toBeInTheDocument();
    expect(screen.getByText(/重新上传（将完全覆盖现有表）/)).toBeInTheDocument();
  });

  it("未上传时显示空态与上传引导", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ manifest: null })
    );
    render(<FileSourcePanel sourceId="empty" />);

    expect(await screen.findByText("尚未上传文件")).toBeInTheDocument();
    expect(screen.getByText(/上传 \.csv \/ \.xlsx（≤50MB）/)).toBeInTheDocument();
  });

  it("选择文件后 POST multipart 并刷新 manifest", async () => {
    render(<FileSourcePanel sourceId="sales" />);
    await screen.findByText("sales");

    const newManifest = {
      ...MANIFEST,
      tables: [{ ...MANIFEST.tables[0], table: "v2", rowCount: 7 }],
    };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init) => {
      const url = String(input);
      if (url.endsWith("/file") && init?.method === "POST") {
        return jsonResponse({ manifest: newManifest }, 201);
      }
      if (url.endsWith("/file")) return jsonResponse({ manifest: MANIFEST });
      return jsonResponse({ sources: [], health: {} });
    });

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(["a,b\n1,2\n"], "v2.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => String(c[0]).endsWith("/file") && c[1]?.method === "POST"
      );
      expect(call).toBeTruthy();
      // multipart：body 为 FormData 且不手动设置 Content-Type
      expect(call![1].body).toBeInstanceOf(FormData);
      const headers = (call![1].headers ?? {}) as Record<string, string>;
      expect(headers["Content-Type"]).toBeUndefined();
    });
    expect(await screen.findByText("v2")).toBeInTheDocument();
  });

  it("上传失败展示服务端错误", async () => {
    render(<FileSourcePanel sourceId="sales" />);
    await screen.findByText("sales");

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init) => {
      const url = String(input);
      if (url.endsWith("/file") && init?.method === "POST") {
        return jsonResponse({ error: "Excel 解析失败: bad.xlsx" }, 400);
      }
      if (url.endsWith("/file")) return jsonResponse({ manifest: MANIFEST });
      return jsonResponse({ sources: [], health: {} });
    });

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "bad.xlsx")] },
    });

    expect(
      await screen.findByText(/Excel 解析失败: bad\.xlsx/)
    ).toBeInTheDocument();
  });
});
