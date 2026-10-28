import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatasourceManager } from "./manager";
import type { FileSourceConfig } from "./config";

/**
 * 文件源端到端：真实 DuckDB + 真实 MCP 装配（不经 mock），
 * 验证 ingest → tools → callTool(execute_sql) → 覆盖重传全链路。
 */

let rootDir: string;
let configPath: string;
let filesDir: string;
let manager: ReturnType<typeof createDatasourceManager>;

const SOURCE: FileSourceConfig = {
  id: "csv1",
  name: "销售表",
  kind: "file",
  enabled: true,
};

const CSV_V1 = Buffer.from("city,amount\n北京,100\n上海,250\n", "utf-8");
const CSV_V2 = Buffer.from("product,qty\napple,3\npear,5\nbanana,2\n", "utf-8");

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "manager-file-"));
  configPath = path.join(rootDir, "datasources.json");
  filesDir = path.join(rootDir, "files");
  fs.writeFileSync(configPath, JSON.stringify({ sources: [SOURCE] }), "utf-8");
  manager = createDatasourceManager({ configPath, filesDir });
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe("manager: 文件源", () => {
  it("ingest → tools → execute_sql 全链路", async () => {
    const manifest = await manager.ingestFiles("csv1", [
      { name: "sales.csv", data: CSV_V1 },
    ]);
    expect(manifest.tables[0].table).toBe("sales");

    const tools = await manager.tools(SOURCE);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "csv1_describe_table",
      "csv1_execute_sql",
      "csv1_list_tables",
    ]);

    const exec = tools.find((t) => t.name === "csv1_execute_sql")!;
    const result = (await exec.call({
      sql: "SELECT sum(amount) AS total FROM sales",
    })) as { rows?: Record<string, unknown>[] };
    expect(result.rows).toEqual([{ total: 350 }]);
  });

  it("未上传时 connect 报「尚未上传文件」，health 探针同语义", async () => {
    await expect(manager.connect(SOURCE)).rejects.toThrow("尚未上传文件");
    const health = await manager.health(SOURCE);
    expect(health.ok).toBe(false);
    expect(health.error).toContain("尚未上传文件");
  });

  it("上传后 health 探针通过", async () => {
    await manager.ingestFiles("csv1", [{ name: "s.csv", data: CSV_V1 }]);
    const health = await manager.health(SOURCE);
    expect(health.ok).toBe(true);
  });

  it("重新上传使旧连接失效：新表立即可查，旧表消失", async () => {
    await manager.ingestFiles("csv1", [{ name: "v1.csv", data: CSV_V1 }]);
    const tools1 = await manager.tools(SOURCE);
    const exec1 = tools1.find((t) => t.name === "csv1_execute_sql")!;
    const r1 = (await exec1.call({ sql: "SELECT count(*) AS c FROM v1" })) as {
      rows?: Record<string, unknown>[];
    };
    expect(r1.rows).toEqual([{ c: 2 }]);

    await manager.ingestFiles("csv1", [{ name: "v2.csv", data: CSV_V2 }]);

    // 旧工具绑定持有的连接已被 ingest 关闭，重新取工具走新库
    const tools2 = await manager.tools(SOURCE);
    const exec2 = tools2.find((t) => t.name === "csv1_execute_sql")!;
    const r2 = (await exec2.call({
      sql: "SELECT sum(qty) AS total FROM v2",
    })) as { rows?: Record<string, unknown>[] };
    expect(r2.rows).toEqual([{ total: 10 }]);

    await expect(
      exec2.call({ sql: "SELECT * FROM v1" })
    ).rejects.toThrow(/v1|does not exist|Table/i);
  });

  it("非文件源调用 ingestFiles 报错", async () => {
    manager.upsert({
      id: "web1",
      name: "HTTP",
      kind: "http-mcp",
      url: "http://example.com/mcp",
      enabled: true,
    });
    await expect(
      manager.ingestFiles("web1", [{ name: "a.csv", data: CSV_V1 }])
    ).rejects.toThrow("不是文件类型");
  });

  it("ingestFiles 对不存在的数据源报错", async () => {
    await expect(
      manager.ingestFiles("ghost", [{ name: "a.csv", data: CSV_V1 }])
    ).rejects.toThrow("数据源不存在");
  });

  it("并发上传串行化：staging 不互相摧毁，最终状态为最后完成者", async () => {
    const csvA = Buffer.from("a,b\n1,2\n", "utf-8");
    const csvB = Buffer.from("x,y\n3,4\n", "utf-8");
    // 同源并发：无串行化时共享 staging 目录会互相 rm/竞态交换
    const [m1, m2] = await Promise.all([
      manager.ingestFiles("csv1", [{ name: "aaa.csv", data: csvA }]),
      manager.ingestFiles("csv1", [{ name: "bbb.csv", data: csvB }]),
    ]);
    // 两次都成功（串行排队），最终 manifest 是其中一次完整构建
    expect(m1.tables).toHaveLength(1);
    expect(m2.tables).toHaveLength(1);
    const final = await manager.filesManifest("csv1");
    expect(final?.tables).toHaveLength(1);
    expect(["aaa", "bbb"]).toContain(final?.tables[0].table);
    // 库与 manifest 一致可查
    const tools = await manager.tools(SOURCE);
    const exec = tools.find((t) => t.name === "csv1_execute_sql")!;
    const r = (await exec.call({
      sql: `SELECT count(*) AS c FROM ${final!.tables[0].table}`,
    })) as { rows?: Record<string, unknown>[] };
    expect(r.rows).toEqual([{ c: 1 }]);
  });

  it("removeFiles 清理落盘内容", async () => {
    await manager.ingestFiles("csv1", [{ name: "s.csv", data: CSV_V1 }]);
    expect(fs.existsSync(path.join(filesDir, "csv1"))).toBe(true);
    await manager.close("csv1");
    await manager.removeFiles("csv1");
    expect(fs.existsSync(path.join(filesDir, "csv1"))).toBe(false);
  });

  it("describe/resolveActive 同构：file 源带 DB 工具契约", () => {
    const descriptor = manager.list().find((s) => s.id === "csv1");
    expect(descriptor).toMatchObject({
      kind: "file",
      tools: ["execute_sql", "list_tables", "describe_table"],
    });
    const active = manager.resolveActive(["csv1"]);
    expect(active[0]).toMatchObject({
      id: "csv1",
      kind: "file",
      tools: ["execute_sql", "list_tables", "describe_table"],
    });
  });
});
