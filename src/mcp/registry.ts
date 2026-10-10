import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pool } from "@/lib/postgres";
import { getGitLabMcpClient } from "./mcpClient";

/**
 * 数据源注册表：内置三源的描述符与健康检查。
 * 所有健康检查带 3s 超时，任何失败都返回 { ok: false, error }，绝不抛错。
 *
 * 声明式扩展：config/datasources.json 中可声明额外的 HTTP MCP 数据源
 * （{ id, name, kind: "http-mcp", url }），零代码接入，见 docs/adding-a-datasource.md。
 */

export interface DataSourceDescriptor {
  id: string;
  name: string;
  kind: "postgres" | "gitlab-mcp" | "zentao-cli" | "http-mcp";
  tools: string[];
  url?: string;
}

export interface HealthResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

const BUILTIN_SOURCES: DataSourceDescriptor[] = [
  {
    id: "postgres",
    name: "PostgreSQL 分析库",
    kind: "postgres",
    tools: ["execute_sql", "list_tables", "describe_table"],
  },
  {
    id: "gitlab-mcp",
    name: "GitLab MCP (外部)",
    kind: "gitlab-mcp",
    tools: ["gitlab_*"],
  },
  {
    id: "zentao-cli",
    name: "ZenTao 禅道 CLI MCP (本地)",
    kind: "zentao-cli",
    tools: ["zentao_*"],
  },
];

const HEALTH_TIMEOUT_MS = 3000;

const DEFAULT_DATASOURCES_PATH = path.join(
  process.cwd(),
  "config",
  "datasources.json"
);

interface DeclarativeSource {
  id: string;
  name: string;
  kind: "http-mcp";
  url: string;
  tools?: string[];
}

let declarativeCache: DeclarativeSource[] | null = null;
let declarativePath = DEFAULT_DATASOURCES_PATH;

function loadDeclarative(configPath: string): DeclarativeSource[] {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { sources?: unknown }).sources)
    ) {
      return (parsed as { sources: DeclarativeSource[] }).sources;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * 重新加载声明式数据源配置（配置变更后调用；测试可传入临时路径）。
 */
export function reloadDataSources(
  configPath: string = DEFAULT_DATASOURCES_PATH
): void {
  declarativePath = configPath;
  declarativeCache = loadDeclarative(declarativePath);
}

export function listDataSources(): DataSourceDescriptor[] {
  if (declarativeCache === null) {
    declarativeCache = loadDeclarative(declarativePath);
  }
  const extra: DataSourceDescriptor[] = declarativeCache.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    url: s.url,
    tools: s.tools ?? [`${s.id}_*`],
  }));
  return [...BUILTIN_SOURCES, ...extra];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`健康检查超时（>${ms}ms）`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function probePostgres(): Promise<void> {
  await pool.query("SELECT 1");
}

async function probeGitLabMcp(): Promise<void> {
  const client = await getGitLabMcpClient();
  await client.listTools();
}

function probeZentaoCli(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("zentao", ["--help"], { timeout: HEALTH_TIMEOUT_MS }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

const PROBES: Record<string, () => Promise<void>> = {
  postgres: probePostgres,
  "gitlab-mcp": probeGitLabMcp,
  "zentao-cli": probeZentaoCli,
};

async function probeHttpMcp(url: string): Promise<void> {
  const res = await fetch(url, { method: "GET" });
  // MCP endpoint 可能对裸 GET 返回 4xx，但只要服务可达即视为存活
  if (res.status >= 500) {
    throw new Error(`HTTP ${res.status}`);
  }
}

export async function checkDataSourceHealth(id: string): Promise<HealthResult> {
  const probe = PROBES[id];
  const startedAt = Date.now();
  if (!probe) {
    // 声明式 http-mcp 数据源：对声明的 url 做可达性探测
    const declarative = listDataSources().find(
      (s) => s.id === id && s.kind === "http-mcp"
    );
    if (!declarative?.url) {
      return { ok: false, latencyMs: 0, error: "unknown datasource" };
    }
    try {
      await withTimeout(probeHttpMcp(declarative.url), HEALTH_TIMEOUT_MS);
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  try {
    await withTimeout(probe(), HEALTH_TIMEOUT_MS);
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
