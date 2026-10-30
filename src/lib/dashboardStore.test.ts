// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDashboardStore,
  deriveDashboardTitle,
  DASHBOARD_DSL_MAX,
  type DashboardRecord,
} from "./dashboardStore";

let dir: string;
let store: ReturnType<typeof createDashboardStore>;

const LONG_PROMPT = "本迭代各项目的 Bug 收敛情况如何？请按严重度分析并给出收敛漏斗";

function seedRecord(overrides: Partial<DashboardRecord>): DashboardRecord {
  return {
    id: "dash_00000001",
    title: "种子看板",
    dsl: "root = Root([])",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboards-"));
  store = createDashboardStore({ dir });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("upsert 收藏/覆盖收藏", () => {
  it("新建：生成 id、落盘单文件、缺省标题按 prompt 20 字截断", async () => {
    const verdict = await store.upsert({
      dsl: "root = Root([table])",
      prompt: LONG_PROMPT,
      sourceNames: ["GitLab", "禅道"],
      origin: { sessionId: "s1", messageId: "m1" },
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;

    expect(verdict.record.id).toMatch(/^dash_[0-9a-f]{8}$/);
    const expectedTitle = `${LONG_PROMPT.slice(0, 20)}...`;
    expect(verdict.record.title).toBe(expectedTitle);
    expect(verdict.record.sourceNames).toEqual(["GitLab", "禅道"]);

    // 落盘验证：目录内单 JSON 文件，可回读
    const files = fs.readdirSync(dir);
    expect(files).toEqual([`${verdict.record.id}.json`]);
    const got = await store.get(verdict.record.id);
    expect(got?.dsl).toBe("root = Root([table])");
  });

  it("显式 title 优先于 prompt 推导", async () => {
    const verdict = await store.upsert({
      dsl: "root = Root([])",
      prompt: LONG_PROMPT,
      title: "收敛漏斗月报",
    });
    expect(verdict.ok && verdict.record.title).toBe("收敛漏斗月报");
  });

  it("无 prompt 无 title → 兜底「未命名看板」", async () => {
    const verdict = await store.upsert({ dsl: "root = Root([])" });
    expect(verdict.ok && verdict.record.title).toBe("未命名看板");
  });

  it("重复收藏同 origin.messageId：保 id/createdAt/已重命名标题，覆盖 dsl", async () => {
    const first = await store.upsert({
      dsl: "root = Root([v1])",
      prompt: "p",
      origin: { messageId: "m1" },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // 用户先重命名
    const renamed = await store.update(first.record.id, { title: "我的月报" });
    expect(renamed.ok && renamed.record.title).toBe("我的月报");

    const second = await store.upsert({
      dsl: "root = Root([v2])",
      prompt: "p",
      origin: { messageId: "m1" },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.record.id).toBe(first.record.id);
    expect(second.record.createdAt).toBe(first.record.createdAt);
    expect(second.record.title).toBe("我的月报");
    expect(second.record.updatedAt).toBeGreaterThanOrEqual(
      first.record.updatedAt
    );

    // 目录内仍只有一条
    const list = await store.list();
    expect(list).toHaveLength(1);
    const got = await store.get(first.record.id);
    expect(got?.dsl).toBe("root = Root([v2])");
  });

  it("不同 messageId 各自成条", async () => {
    await store.upsert({ dsl: "a", origin: { messageId: "m1" } });
    await store.upsert({ dsl: "b", origin: { messageId: "m2" } });
    expect(await store.list()).toHaveLength(2);
  });

  it("校验：dsl 缺失/空 400；超限 413；字段形态错误 400", async () => {
    const missing = await store.upsert({ prompt: "p" });
    expect(missing).toMatchObject({ ok: false, status: 400 });

    const empty = await store.upsert({ dsl: "   " });
    expect(empty).toMatchObject({ ok: false, status: 400 });

    const oversized = await store.upsert({ dsl: "x".repeat(DASHBOARD_DSL_MAX + 1) });
    expect(oversized).toMatchObject({ ok: false, status: 413 });

    const badShape = await store.upsert({
      dsl: "ok",
      title: 123,
      sourceNames: "not-array",
      origin: "bad",
    });
    expect(badShape).toMatchObject({ ok: false, status: 400 });
    if (!badShape.ok) expect(badShape.errors.length).toBeGreaterThanOrEqual(3);

    const notObject = await store.upsert(
      "nope" as unknown as Parameters<typeof store.upsert>[0]
    );
    expect(notObject).toMatchObject({ ok: false, status: 400 });
  });
});

describe("list / get 容错", () => {
  it("列表按 updatedAt 降序；坏 JSON 与缺字段文件静默跳过", async () => {
    fs.writeFileSync(
      path.join(dir, "newer.json"),
      JSON.stringify(seedRecord({ id: "dash_00000002", updatedAt: 2000 })),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(dir, "older.json"),
      JSON.stringify(seedRecord({ id: "dash_00000003", updatedAt: 1000 })),
      "utf-8"
    );
    fs.writeFileSync(path.join(dir, "broken.json"), "{not json", "utf-8");
    fs.writeFileSync(
      path.join(dir, "shapeless.json"),
      JSON.stringify({ id: "dash_00000004", nope: true }),
      "utf-8"
    );

    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual(["dash_00000002", "dash_00000003"]);
    // 摘要不含 dsl
    expect(Object.keys(list[0])).not.toContain("dsl");
    expect(await store.get("dash_00000004")).toBeNull();
  });

  it("get：未知 id / 非法 id（路径穿越）一律 null 且不抛错", async () => {
    expect(await store.get("dash_deadbeef")).toBeNull();
    expect(await store.get("../../etc/passwd")).toBeNull();
    expect(await store.get("dash_UPSERCASE")).toBeNull();
  });
});

describe("update / remove", () => {
  it("重命名与覆盖 dsl；无字段 400；未知 404", async () => {
    const created = await store.upsert({ dsl: "v1", prompt: "p" });
    if (!created.ok) throw new Error("seed failed");
    const { id } = created.record;

    const renamed = await store.update(id, { title: "新名字" });
    expect(renamed.ok && renamed.record.title).toBe("新名字");
    expect(renamed.ok && renamed.record.dsl).toBe("v1");

    const updated = await store.update(id, { dsl: "v2" });
    expect(updated.ok && updated.record.dsl).toBe("v2");
    expect(updated.ok && updated.record.title).toBe("新名字");

    const none = await store.update(id, {});
    expect(none).toMatchObject({ ok: false, status: 400 });

    const ghost = await store.update("dash_ffffffff", { title: "x" });
    expect(ghost).toMatchObject({ ok: false, status: 404 });

    const oversize = await store.update(id, {
      dsl: "y".repeat(DASHBOARD_DSL_MAX + 1),
    });
    expect(oversize).toMatchObject({ ok: false, status: 413 });
  });

  it("remove：成功 true 后列表为空；重复删除 false", async () => {
    const created = await store.upsert({ dsl: "v1" });
    if (!created.ok) throw new Error("seed failed");
    expect(await store.remove(created.record.id)).toBe(true);
    expect(await store.list()).toHaveLength(0);
    expect(await store.remove(created.record.id)).toBe(false);
  });
});

describe("deriveDashboardTitle 与 generateSessionTitle 规则对齐", () => {
  it("markdown 记号与【】前缀剔除、20 字截断", () => {
    expect(deriveDashboardTitle("**加粗**普通")).toBe("加粗普通");
    expect(deriveDashboardTitle("【标签】正文标题")).toBe("正文标题");
    expect(deriveDashboardTitle(LONG_PROMPT)).toBe(
      `${LONG_PROMPT.slice(0, 20)}...`
    );
    expect(deriveDashboardTitle("")).toBeNull();
    expect(deriveDashboardTitle(undefined)).toBeNull();
  });
});
