import { describe, it, expect, vi, afterEach } from "vitest";
import { PATCH, DELETE } from "./route";
import {
  upsertDynamicSource,
  setBuiltinEnabled,
  deleteDynamicSource,
  getDynamicSourceConfig,
} from "@/mcp/registry";
import { closeDynamicSource } from "@/mcp/dynamicSources";

vi.mock("@/mcp/registry", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/mcp/registry")
  >();
  return {
    ...actual,
    upsertDynamicSource: vi.fn(),
    setBuiltinEnabled: vi.fn(),
    deleteDynamicSource: vi.fn(() => true),
    getDynamicSourceConfig: vi.fn(() => undefined),
  };
});

vi.mock("@/mcp/dynamicSources", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/mcp/dynamicSources")
  >();
  return {
    ...actual,
    closeDynamicSource: vi.fn(async () => {}),
  };
});

const BASE = "http://localhost:3006/api/datasources";

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const EXISTING_HTTP = {
  id: "jira",
  name: "Jira MCP",
  kind: "http-mcp" as const,
  url: "http://10.0.0.1:6000/mcp",
  token: "glpat-old",
  enabled: true,
};

describe("PATCH /api/datasources/:id", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("动态源更新 name 并回写", async () => {
    vi.mocked(getDynamicSourceConfig).mockReturnValueOnce({ ...EXISTING_HTTP });

    const res = await PATCH(
      new Request(`${BASE}/jira`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Jira MCP 2" }),
      }),
      makeContext("jira")
    );

    expect(res.status).toBe(200);
    expect(upsertDynamicSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: "jira", name: "Jira MCP 2" })
    );
  });

  it("token 不传时保留旧值", async () => {
    vi.mocked(getDynamicSourceConfig).mockReturnValueOnce({ ...EXISTING_HTTP });

    await PATCH(
      new Request(`${BASE}/jira`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      }),
      makeContext("jira")
    );

    expect(upsertDynamicSource).toHaveBeenCalledWith(
      expect.objectContaining({ token: "glpat-old", enabled: false })
    );
  });

  it("显式传空 token 清空凭证", async () => {
    vi.mocked(getDynamicSourceConfig).mockReturnValueOnce({ ...EXISTING_HTTP });

    await PATCH(
      new Request(`${BASE}/jira`, {
        method: "PATCH",
        body: JSON.stringify({ token: "" }),
      }),
      makeContext("jira")
    );

    expect(upsertDynamicSource).toHaveBeenCalledWith(
      expect.objectContaining({ token: "" })
    );
  });

  it("内置源仅接受 enabled，其余字段 400", async () => {
    const res = await PATCH(
      new Request(`${BASE}/postgres`, {
        method: "PATCH",
        body: JSON.stringify({ url: "http://x" }),
      }),
      makeContext("postgres")
    );
    expect(res.status).toBe(400);

    const okRes = await PATCH(
      new Request(`${BASE}/postgres`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      }),
      makeContext("postgres")
    );
    expect(okRes.status).toBe(200);
    expect(setBuiltinEnabled).toHaveBeenCalledWith("postgres", false);
  });

  it("更新成功后关闭旧连接以触发重建", async () => {
    vi.mocked(getDynamicSourceConfig).mockReturnValueOnce({ ...EXISTING_HTTP });

    await PATCH(
      new Request(`${BASE}/jira`, {
        method: "PATCH",
        body: JSON.stringify({ url: "http://10.0.0.2:6000/mcp" }),
      }),
      makeContext("jira")
    );

    expect(closeDynamicSource).toHaveBeenCalledWith("jira");
  });

  it("不存在的源返回 404", async () => {
    const res = await PATCH(
      new Request(`${BASE}/nope`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      }),
      makeContext("nope")
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/datasources/:id", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("删除动态源并关闭其连接", async () => {
    const res = await DELETE(
      new Request(`${BASE}/jira`, { method: "DELETE" }),
      makeContext("jira")
    );

    expect(res.status).toBe(204);
    expect(deleteDynamicSource).toHaveBeenCalledWith("jira");
    expect(closeDynamicSource).toHaveBeenCalledWith("jira");
  });

  it("内置源返回 405", async () => {
    const res = await DELETE(
      new Request(`${BASE}/postgres`, { method: "DELETE" }),
      makeContext("postgres")
    );
    expect(res.status).toBe(405);
    expect(deleteDynamicSource).not.toHaveBeenCalled();
  });

  it("不存在的源返回 404", async () => {
    vi.mocked(deleteDynamicSource).mockReturnValueOnce(false);
    const res = await DELETE(
      new Request(`${BASE}/nope`, { method: "DELETE" }),
      makeContext("nope")
    );
    expect(res.status).toBe(404);
  });
});
