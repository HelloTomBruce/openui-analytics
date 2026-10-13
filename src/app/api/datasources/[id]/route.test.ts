import { describe, it, expect, vi, afterEach } from "vitest";
import { PATCH, DELETE } from "./route";
import {
  upsertDynamicSource,
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

  it("内置源特例已移除：任意源 PATCH command 字段 200", async () => {
    vi.mocked(getDynamicSourceConfig).mockReturnValueOnce({
      id: "zc",
      name: "禅道",
      kind: "stdio-cli",
      command: "zentao",
      args: ["mcp", "--read-only"],
      enabled: true,
    });

    const res = await PATCH(
      new Request(`${BASE}/zc`, {
        method: "PATCH",
        body: JSON.stringify({ command: "zentao2" }),
      }),
      makeContext("zc")
    );
    expect(res.status).toBe(200);
    expect(upsertDynamicSource).toHaveBeenCalledWith(
      expect.objectContaining({ command: "zentao2", kind: "stdio-cli" })
    );
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

  it("不存在的源返回 404", async () => {
    vi.mocked(deleteDynamicSource).mockReturnValueOnce(false);
    const res = await DELETE(
      new Request(`${BASE}/nope`, { method: "DELETE" }),
      makeContext("nope")
    );
    expect(res.status).toBe(404);
  });
});
