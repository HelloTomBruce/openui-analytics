import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { DatasourceSettings } from "./DatasourceSettings";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    json: async () => body,
  };
}

const SOURCES = [
  {
    id: "postgres",
    name: "PostgreSQL 分析库",
    kind: "postgres",
    tools: [],
    enabled: true,
    builtin: true,
  },
  {
    id: "gitlab-mcp",
    name: "GitLab MCP (外部)",
    kind: "gitlab-mcp",
    tools: [],
    enabled: true,
    builtin: true,
  },
  {
    id: "zentao-cli",
    name: "ZenTao 禅道 CLI MCP (本地)",
    kind: "zentao-cli",
    tools: [],
    enabled: false,
    builtin: true,
  },
  {
    id: "jira",
    name: "Jira MCP",
    kind: "http-mcp",
    tools: [],
    enabled: true,
    builtin: false,
    hasToken: true,
    maskedUrl: "http://10.0.0.1:6000/mcp",
  },
  {
    id: "mysql-a",
    name: "订单库",
    kind: "db",
    tools: [],
    enabled: true,
    builtin: false,
    dbType: "mysql",
    maskedConnectionString: "mysql://u:***@h:3306/db",
  },
];

const HEALTH = {
  postgres: { ok: true, latencyMs: 12 },
  "gitlab-mcp": { ok: true, latencyMs: 30 },
  "zentao-cli": { ok: false, latencyMs: 0, error: "down" },
  jira: { ok: true, latencyMs: 40 },
  "mysql-a": { ok: true, latencyMs: 8 },
};

function mockGetAll() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/datasources") && url.indexOf("/api/datasources/") === -1) {
      return jsonResponse({ sources: SOURCES, health: HEALTH });
    }
    return jsonResponse({ error: "unexpected" }, 500);
  });
}

function renderSettings() {
  return render(
    <DatasourceSettings
      gitlabUrl="http://127.0.0.1:5002/mcp"
      gitlabToken="glpat-old"
      onGitlabUrlChange={vi.fn()}
      onGitlabTokenChange={vi.fn()}
    />
  );
}

async function openCreateForm() {
  fireEvent.click(screen.getByRole("button", { name: /添加数据源/ }));
  await screen.findByLabelText(/ID/);
}

describe("DatasourceSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    mockGetAll();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("渲染内置源与动态源行：类型徽章 / 启停 / 编辑 / 删除", async () => {
    renderSettings();

    expect(await screen.findByText("PostgreSQL 分析库")).toBeInTheDocument();
    expect(screen.getByText("ZenTao 禅道 CLI MCP (本地)")).toBeInTheDocument();
    // 动态源类型徽章
    expect(screen.getByText("HTTP MCP")).toBeInTheDocument();
    expect(screen.getByText("MySQL")).toBeInTheDocument();
    // 编辑/删除仅动态源有
    expect(screen.getByRole("button", { name: /编辑 jira/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /删除 mysql-a/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /编辑 postgres/ })).not.toBeInTheDocument();
  });

  it("内置 gitlab-mcp 行可展开透传配置（Endpoint 与 Token）", async () => {
    renderSettings();

    expect(await screen.findByText("GitLab MCP (外部)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /配置 gitlab-mcp/ }));
    expect(screen.getByLabelText(/GitLab MCP Endpoint/)).toHaveValue(
      "http://127.0.0.1:5002/mcp"
    );
  });

  it("添加数据源：切到 db 类型出现连接串字段，提交 POST 携带完整 body", async () => {
    renderSettings();
    await openCreateForm();

    fireEvent.change(screen.getByLabelText(/ID/), { target: { value: "pg-b" } });
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: "报表库" } });
    fireEvent.click(screen.getByLabelText(/数据库连接/));
    await screen.findByLabelText(/连接串/);
    fireEvent.change(screen.getByLabelText(/数据库类型/), {
      target: { value: "postgres" },
    });
    fireEvent.change(screen.getByLabelText(/连接串/), {
      target: { value: "postgres://u:p@h:5432/reports" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/datasources" && c[1]?.method === "POST"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1].body as string);
      expect(body).toMatchObject({
        id: "pg-b",
        name: "报表库",
        kind: "db",
        dbType: "postgres",
        connectionString: "postgres://u:p@h:5432/reports",
      });
    });
  });

  it("编辑模式 token 留空提交时 PATCH body 不含 token 字段", async () => {
    renderSettings();
    await screen.findByText("Jira MCP");

    fireEvent.click(screen.getByRole("button", { name: /编辑 jira/ }));
    const urlInput = await screen.findByLabelText(/URL/);
    fireEvent.change(urlInput, { target: { value: "http://10.0.0.2:6000/mcp" } });
    // token 留空
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === "/api/datasources/jira" && c[1]?.method === "PATCH"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1].body as string);
      expect(body).toMatchObject({ url: "http://10.0.0.2:6000/mcp" });
      expect(body).not.toHaveProperty("token");
    });
  });

  it("启停 toggle 发送 PATCH {enabled}", async () => {
    renderSettings();
    await screen.findByText("订单库");

    fireEvent.click(screen.getByRole("button", { name: /启停 zentao-cli/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === "/api/datasources/zentao-cli" &&
          c[1]?.method === "PATCH"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1].body as string)).toEqual({ enabled: true });
    });
  });

  it("删除动态源发送 DELETE 并移除行", async () => {
    let deleted = false;
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleted = true;
        return { status: 204 };
      }
      return jsonResponse({
        sources: deleted ? SOURCES.filter((s) => s.id !== "jira") : SOURCES,
        health: HEALTH,
      });
    });
    renderSettings();
    await screen.findByText("Jira MCP");

    fireEvent.click(screen.getByRole("button", { name: /删除 jira/ }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(
        (c) => String(c[0]) === "/api/datasources/jira" && c[1]?.method === "DELETE"
      )).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByText("Jira MCP")).not.toBeInTheDocument();
    });
  });

  it("POST 400 时展示服务端错误列表", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        return jsonResponse({ errors: ["id 非法（需匹配 ^[a-z][a-z0-9-]{0,31}$）: \"BAD\""] }, 400);
      }
      if (url.includes("/api/datasources/")) return jsonResponse({ error: "" }, 500);
      return jsonResponse({ sources: SOURCES, health: HEALTH });
    });
    renderSettings();
    await openCreateForm();

    fireEvent.change(screen.getByLabelText(/ID/), { target: { value: "BAD" } });
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: "x" } });
    fireEvent.click(screen.getByLabelText(/HTTP MCP/));
    fireEvent.change(screen.getByLabelText(/URL/), { target: { value: "http://x/mcp" } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    expect(await screen.findByText(/id 非法/)).toBeInTheDocument();
  });
});
