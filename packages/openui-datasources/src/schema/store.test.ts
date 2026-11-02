import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSchemaCard, writeSchemaCard } from "./store";
import { buildSchemaCard, CARD_STORE_MAX_BYTES, type SchemaCard } from "./card";

let dir: string;

const CARD: SchemaCard = buildSchemaCard({
  sourceId: "pg_main",
  generatedAt: 1000,
  profiles: [
    {
      name: "orders",
      rowCount: 10,
      columns: [{ column: "id", type: "int" }],
    },
  ],
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-cards-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("schema store", () => {
  it("写读往返：自动建目录、字段完整", async () => {
    await writeSchemaCard(dir, CARD);
    const got = await readSchemaCard(dir, "pg_main");
    expect(got).toEqual(CARD);
    expect(fs.existsSync(path.join(dir, "pg_main.json"))).toBe(true);
  });

  it("坏 JSON / 形态不符 / 文件缺失 → null（触发惰性重建语义）", async () => {
    fs.writeFileSync(path.join(dir, "broken.json"), "{not json", "utf-8");
    expect(await readSchemaCard(dir, "broken")).toBeNull();

    fs.writeFileSync(
      path.join(dir, "shapeless.json"),
      JSON.stringify({ sourceId: "shapeless" }),
      "utf-8"
    );
    expect(await readSchemaCard(dir, "shapeless")).toBeNull();

    expect(await readSchemaCard(dir, "ghost")).toBeNull();
  });

  it("非法 sourceId（路径穿越）读返回 null、写抛错", async () => {
    expect(await readSchemaCard(dir, "../../etc/passwd")).toBeNull();
    await expect(
      writeSchemaCard(dir, { ...CARD, sourceId: "../evil" })
    ).rejects.toThrow("非法 sourceId");
  });

  it("序列化超 64KB 拒绝写入（构建预算失守的最后防线）", async () => {
    const huge: SchemaCard = {
      ...CARD,
      toolSummaries: [
        { name: "x".repeat(CARD_STORE_MAX_BYTES), description: "溢出" },
      ],
    };
    // 绕过 buildSchemaCard 的预算收敛直接构造超限卡
    await expect(writeSchemaCard(dir, huge)).rejects.toThrow("字节上限");
  });
});
