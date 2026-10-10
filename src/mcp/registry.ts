import { execFile } from "node:child_process";
import { pool } from "@/lib/postgres";
import { getGitLabMcpClient } from "./mcpClient";

/**
 * 数据源注册表：内置三源的描述符与健康检查。
 * 所有健康检查带 3s 超时，任何失败都返回 { ok: false, error }，绝不抛错。
 */

export interface DataSourceDescriptor {
  id: string;
  name: string;
  kind: "postgres" | "gitlab-mcp" | "zentao-cli";
  tools: string[];
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

export function listDataSources(): DataSourceDescriptor[] {
  return BUILTIN_SOURCES;
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

export async function checkDataSourceHealth(id: string): Promise<HealthResult> {
  const probe = PROBES[id];
  if (!probe) {
    return { ok: false, latencyMs: 0, error: "unknown datasource" };
  }
  const startedAt = Date.now();
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
