// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "./route";
import { POST } from "./refresh/route";
import { datasources } from "@/lib/datasources";

vi.mock("@/lib/datasources", () => ({
  datasources: {
    get: vi.fn(),
    getSchemaCard: vi.fn(),
    refreshSchemaCard: vi.fn(),
  },
}));

const SOURCE = {
  id: "pg1",
  name: "PG",
  kind: "db" as const,
  dbType: "postgres" as const,
  connectionString: "postgres://u:p@h:5432/db",
  enabled: true,
};

const CARD = {
  sourceId: "pg1",
  generatedAt: 1761811200000,
  kind: "db-like" as const,
  truncated: false,
  tables: [{ name: "orders", rowCount: 10, columns: [] }],
};

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/datasources/:id/schema-card", () => {
  it("有卡 → 200 + 卡全文 + generatedAt + stale", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce(SOURCE);
    vi.mocked(datasources.getSchemaCard).mockResolvedValueOnce({
      card: CARD,
      stale: false,
    });
    const res = await GET(new Request("http://localhost"), makeContext("pg1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.card.tables[0].name).toBe("orders");
    expect(body.generatedAt).toBe(1761811200000);
    expect(body.stale).toBe(false);
  });

  it("源不存在 → 404", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce(undefined);
    const res = await GET(new Request("http://localhost"), makeContext("ghost"));
    expect(res.status).toBe(404);
  });

  it("未建卡 → 404 + pending 标记", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce(SOURCE);
    vi.mocked(datasources.getSchemaCard).mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost"), makeContext("pg1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.pending).toBe(true);
  });
});

describe("POST /api/datasources/:id/schema-card/refresh", () => {
  it("手动刷新 → 202 且触发后台重建", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce(SOURCE);
    vi.mocked(datasources.refreshSchemaCard).mockReturnValueOnce(
      Promise.resolve()
    );
    const res = await POST(new Request("http://localhost", { method: "POST" }), makeContext("pg1"));
    expect(res.status).toBe(202);
    expect(datasources.refreshSchemaCard).toHaveBeenCalledWith("pg1");
  });

  it("源不存在 → 404；重建失败不回传错误（后台语义）", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce(undefined);
    const res404 = await POST(
      new Request("http://localhost", { method: "POST" }),
      makeContext("ghost")
    );
    expect(res404.status).toBe(404);

    vi.mocked(datasources.get).mockReturnValueOnce(SOURCE);
    vi.mocked(datasources.refreshSchemaCard).mockReturnValueOnce(
      Promise.reject(new Error("build failed"))
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(
      new Request("http://localhost", { method: "POST" }),
      makeContext("pg1")
    );
    expect(res.status).toBe(202);
    // 让 rejection 传播一拍，确认被 catch 且不抛出
    await new Promise((r) => setTimeout(r, 0));
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
