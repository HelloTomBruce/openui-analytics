import fs from "node:fs/promises";
import path from "node:path";
import {
  CARD_STORE_MAX_BYTES,
  type SchemaCard,
} from "./card";

/**
 * Schema Card 落盘读写：data/schema-cards/<sourceId>.json（单源一卡）。
 * 容错哲学与 config.ts 一致：坏 JSON / 形态不符一律返回 null（触发惰性重建），
 * 写不入即从根上保持「卡可再生产」语义。
 */

const ID_RE = /^[\w-]+$/;

function isValidSourceId(id: string): boolean {
  return ID_RE.test(id) && id.length <= 100;
}

/** 形态校验：关键字段齐备才认，否则视为坏卡（null → 重建） */
function isSchemaCard(value: unknown): value is SchemaCard {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.sourceId === "string" &&
    typeof v.generatedAt === "number" &&
    (v.kind === "db-like" || v.kind === "mcp") &&
    Array.isArray(v.tables) &&
    typeof v.truncated === "boolean"
  );
}

/** 读卡：文件缺失/坏 JSON/形态不符 → null（调用方惰性重建） */
export async function readSchemaCard(
  dir: string,
  sourceId: string
): Promise<SchemaCard | null> {
  if (!isValidSourceId(sourceId)) return null;
  try {
    const raw = await fs.readFile(path.join(dir, `${sourceId}.json`), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return isSchemaCard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 写卡：序列化超 64KB 拒绝（构建侧预算失守时的最后防线，抛错暴露问题） */
export async function writeSchemaCard(
  dir: string,
  card: SchemaCard
): Promise<void> {
  if (!isValidSourceId(card.sourceId)) {
    throw new Error(`非法 sourceId: ${card.sourceId}`);
  }
  const text = JSON.stringify(card, null, 2);
  if (Buffer.byteLength(text, "utf-8") > CARD_STORE_MAX_BYTES) {
    throw new Error(
      `结构卡超过 ${CARD_STORE_MAX_BYTES} 字节上限（构建预算失守）: ${card.sourceId}`
    );
  }
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${card.sourceId}.json`), text, "utf-8");
}
