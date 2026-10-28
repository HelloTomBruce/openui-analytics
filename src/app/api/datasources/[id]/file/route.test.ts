// @vitest-environment node
// multipart 解析依赖 undici 原生 FormData/Request，jsdom 环境下 formData() 会挂起
import { describe, it, expect, vi, afterEach } from "vitest";
import { POST, GET } from "./route";
import { datasources } from "@/lib/datasources";

/** 接缝 mock：路由层只验证协议与校验逻辑，灌库走 mock */
vi.mock("@/lib/datasources", () => ({
  datasources: {
    get: vi.fn(() => undefined),
    ingestFiles: vi.fn(),
    filesManifest: vi.fn(),
  },
}));

const BASE = "http://localhost:3006/api/datasources";

const FILE_SOURCE = {
  id: "sales",
  name: "销售表",
  kind: "file" as const,
  enabled: true,
};

const DB_SOURCE = {
  id: "pg1",
  name: "PG",
  kind: "db" as const,
  dbType: "postgres" as const,
  connectionString: "postgres://u:p@h:5432/db",
  enabled: true,
};

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function uploadRequest(
  id: string,
  files: { name: string; data: Uint8Array<ArrayBuffer> }[]
) {
  const form = new FormData();
  for (const f of files) {
    form.append("files", new File([f.data], f.name));
  }
  return new Request(`${BASE}/${id}/file`, { method: "POST", body: form });
}

const CSV = new TextEncoder().encode("city,amount\n北京,100\n");

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/datasources/:id/file", () => {
  it("成功上传：解析 multipart 并调用 ingestFiles，201 返回 manifest", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...FILE_SOURCE });
    const manifest = {
      files: [{ name: "s.csv", size: 20, uploadedAt: "t" }],
      tables: [{ table: "s", fromFile: "s.csv", rowCount: 1, columns: [] }],
      ingestedAt: "t",
    };
    vi.mocked(datasources.ingestFiles).mockResolvedValueOnce(manifest);

    const res = await POST(
      uploadRequest("sales", [{ name: "s.csv", data: CSV }]),
      makeContext("sales")
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.manifest.tables[0].table).toBe("s");
    expect(vi.mocked(datasources.ingestFiles)).toHaveBeenCalledWith("sales", [
      { name: "s.csv", data: expect.any(Buffer) },
    ]);
  });

  it("数据源不存在 → 404", async () => {
    const res = await POST(
      uploadRequest("ghost", [{ name: "s.csv", data: CSV }]),
      makeContext("ghost")
    );
    expect(res.status).toBe(404);
  });

  it("非 file 源 → 400", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...DB_SOURCE });
    const res = await POST(
      uploadRequest("pg1", [{ name: "s.csv", data: CSV }]),
      makeContext("pg1")
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("不是文件类型");
  });

  it("不支持的扩展名 → 400", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...FILE_SOURCE });
    const res = await POST(
      uploadRequest("sales", [{ name: "s.txt", data: CSV }]),
      makeContext("sales")
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("不支持的文件类型");
  });

  it("超过 50MB → 413", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...FILE_SOURCE });
    const big = new File([new Uint8Array(51 * 1024 * 1024)], "big.csv");
    const form = new FormData();
    form.append("files", big);
    const res = await POST(
      new Request(`${BASE}/sales/file`, { method: "POST", body: form }),
      makeContext("sales")
    );
    expect(res.status).toBe(413);
  });

  it("伪装 xlsx（无 ZIP 头）→ 400", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...FILE_SOURCE });
    const res = await POST(
      uploadRequest("sales", [{ name: "fake.xlsx", data: CSV }]),
      makeContext("sales")
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("ZIP");
  });

  it("二进制伪装 csv（含 NUL）→ 400", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...FILE_SOURCE });
    const res = await POST(
      uploadRequest("sales", [
        { name: "fake.csv", data: new Uint8Array([0x41, 0x00, 0x42]) },
      ]),
      makeContext("sales")
    );
    expect(res.status).toBe(400);
  });

  it("缺少 files 字段 → 400", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...FILE_SOURCE });
    const res = await POST(
      new Request(`${BASE}/sales/file`, {
        method: "POST",
        body: new FormData(),
      }),
      makeContext("sales")
    );
    expect(res.status).toBe(400);
  });

  it("灌库失败（坏文件）→ 400 + 错误信息", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...FILE_SOURCE });
    vi.mocked(datasources.ingestFiles).mockRejectedValueOnce(
      new Error("Excel 解析失败: bad.xlsx")
    );
    const zipHead = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    const res = await POST(
      uploadRequest("sales", [{ name: "bad.xlsx", data: zipHead }]),
      makeContext("sales")
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Excel 解析失败");
  });
});

describe("GET /api/datasources/:id/file", () => {
  it("返回 manifest（未上传为 null）", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({ ...FILE_SOURCE });
    vi.mocked(datasources.filesManifest).mockResolvedValueOnce(null);
    const res = await GET(
      new Request(`${BASE}/sales/file`),
      makeContext("sales")
    );
    expect(res.status).toBe(200);
    expect((await res.json()).manifest).toBeNull();
  });

  it("数据源不存在 → 404", async () => {
    const res = await GET(
      new Request(`${BASE}/ghost/file`),
      makeContext("ghost")
    );
    expect(res.status).toBe(404);
  });
});
