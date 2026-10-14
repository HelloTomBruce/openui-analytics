import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "./route";
import { datasources } from "@/lib/datasources";

// 接缝 mock：纯函数（validate/describe/mask）走真实包实现，IO（探活/读写配置）走 mock
vi.mock("@/lib/datasources", async () => {
  const { validateSourceConfig } = await import(
    "@openui-analytics/datasources"
  );
  return {
    datasources: {
      validate: vi.fn(validateSourceConfig),
      list: vi.fn(() => [
        { id: "pg-a", name: "PostgreSQL 分析库", kind: "db", dbType: "postgres", tools: [], enabled: true },
        { id: "zentao-cli", name: "禅道", kind: "stdio-cli", command: "zentao", tools: [], enabled: true },
        { id: "gitlab", name: "GitLab MCP", kind: "http-mcp", tools: [], enabled: true },
      ]),
      health: vi.fn(async () => ({ ok: true, latencyMs: 5 })),
      // 默认不存在（POST 新建的 409 判定依赖）；GET 用例内按需返回配置
      get: vi.fn(() => undefined),
      upsert: vi.fn(),
    },
  };
});

const BASE = "http://localhost:3006/api/datasources";

describe("GET /api/datasources", () => {
  beforeEach(() => {
    // GET 探活需要按 id 取回配置（原实现里探活内部自查找）
    vi.mocked(datasources.get).mockImplementation((id: string) => ({
      id,
      name: id,
      kind: "http-mcp" as const,
      url: "http://x/mcp",
      token: "",
      enabled: true,
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(datasources.get).mockImplementation(() => undefined);
  });

  it("返回所有数据源与健康状态", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources).toHaveLength(3);
    expect(body.health["pg-a"].ok).toBe(true);
    expect(body.health["zentao-cli"].ok).toBe(true);
  });

  it("动态源响应不泄露 token 明文与连接串密码", async () => {
    vi.mocked(datasources.list).mockReturnValueOnce([
      { id: "pg-a", name: "PostgreSQL 分析库", kind: "db", dbType: "postgres", tools: [], enabled: true },
      {
        id: "jira",
        name: "Jira MCP",
        kind: "http-mcp",
        tools: [],
        enabled: true,
        hasToken: true,
        maskedUrl: "http://10.0.0.1:6000/mcp",
      },
      {
        id: "mysql-a",
        name: "订单库",
        kind: "db",
        tools: [],
        enabled: true,
        dbType: "mysql",
        maskedConnectionString: "mysql://u:***@h:3306/db",
      },
    ]);

    const res = await GET();
    const raw = JSON.stringify(await res.json());

    expect(raw).not.toContain("glpat-secret");
    expect(raw).not.toContain("p@h");
    expect(raw).toContain("\"hasToken\":true");
    expect(raw).toContain("mysql://u:***@h:3306/db");
  });
});

describe("POST /api/datasources", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("合法 http-mcp 源创建成功，响应不泄露 token", async () => {
    const res = await POST(
      new Request(BASE, {
        method: "POST",
        body: JSON.stringify({
          id: "jira",
          name: "Jira MCP",
          kind: "http-mcp",
          url: "http://10.0.0.1:6000/mcp",
          token: "glpat-secret",
        }),
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.source).toMatchObject({
      id: "jira",
      kind: "http-mcp",
      hasToken: true,
      maskedUrl: "http://10.0.0.1:6000/mcp",
    });
    expect(JSON.stringify(body)).not.toContain("glpat-secret");
    expect(datasources.upsert).toHaveBeenCalledTimes(1);
  });

  it("合法 db 源创建成功，连接串脱敏返回", async () => {
    const res = await POST(
      new Request(BASE, {
        method: "POST",
        body: JSON.stringify({
          id: "mysql-a",
          name: "订单库",
          kind: "db",
          dbType: "mysql",
          connectionString: "mysql://u:p@h:3306/db",
        }),
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.source).toMatchObject({
      id: "mysql-a",
      dbType: "mysql",
      maskedConnectionString: "mysql://u:***@h:3306/db",
    });
    expect(JSON.stringify(body)).not.toContain(":p@h");
  });

  it("重复 id 返回 409", async () => {
    vi.mocked(datasources.get).mockReturnValueOnce({
      id: "jira",
      name: "已有",
      kind: "http-mcp",
      url: "http://x/mcp",
      token: "",
      enabled: true,
    });

    const res = await POST(
      new Request(BASE, {
        method: "POST",
        body: JSON.stringify({
          id: "jira",
          name: "Jira MCP",
          kind: "http-mcp",
          url: "http://10.0.0.1:6000/mcp",
        }),
      })
    );

    expect(res.status).toBe(409);
    expect(datasources.upsert).not.toHaveBeenCalled();
  });

  it("非法配置返回 400 与错误列表", async () => {
    const res = await POST(
      new Request(BASE, {
        method: "POST",
        body: JSON.stringify({ id: "BAD_ID", name: "", kind: "http-mcp" }),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.join(";")).toContain("id");
  });
});
