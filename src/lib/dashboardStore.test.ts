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
import { captureDashboardQueries } from "./dashboardCapture";

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

describe("transforms 派生变换绑定", () => {
  const QUERIES = [
    { id: "q_abc12345", sourceId: "pg1", kind: "sql" as const, payload: "SELECT 1" },
  ];
  const SPEC = {
    op: "aggregate" as const,
    groupBy: ["channel"],
    metrics: { spend: "sum" },
    compute: [{ field: "cac", expr: "spend / leads" }],
  };

  it("合法 transforms 随收藏落盘并回读；摘要携带", async () => {
    const verdict = await store.upsert({
      dsl: "root = Root([t])",
      queries: QUERIES,
      bindings: { cac_chart: "q_abc12345" },
      transforms: { cac_chart: SPEC },
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    const got = await store.get(verdict.record.id);
    expect(got?.transforms?.cac_chart).toEqual(SPEC);
    const list = await store.list();
    expect(list[0].transforms?.cac_chart).toEqual(SPEC);
  });

  it("transforms 键无对应 bindings → 400；非法 spec → 400", async () => {
    const orphan = await store.upsert({
      dsl: "root = Root([t])",
      queries: QUERIES,
      bindings: { other: "q_abc12345" },
      transforms: { cac_chart: SPEC },
    });
    expect(orphan.ok).toBe(false);
    if (!orphan.ok) expect(orphan.errors[0]).toContain("bindings");

    const badSpec = await store.upsert({
      dsl: "root = Root([t])",
      queries: QUERIES,
      bindings: { cac_chart: "q_abc12345" },
      transforms: { cac_chart: { op: "join" } },
    });
    expect(badSpec.ok).toBe(false);
  });

  it("重新捕获未提供 transforms 时旧变换过期清除", async () => {
    const first = await store.upsert({
      dsl: "root = Root([t])",
      queries: QUERIES,
      bindings: { cac_chart: "q_abc12345" },
      transforms: { cac_chart: SPEC },
      origin: { messageId: "m1" },
    });
    if (!first.ok) throw new Error("seed failed");

    // 同消息再次收藏：新捕获无 transforms（直取绑定），旧变换应被清除
    const second = await store.upsert({
      dsl: "root = Root([t])",
      queries: QUERIES,
      bindings: { cac_chart: "q_abc12345" },
      origin: { messageId: "m1" },
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect("transforms" in second.record).toBe(false);
    }
  });
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

describe("活看板字段（P2-A：queries/bindings/dataUpdatedAt）", () => {
  const queries = [
    {
      id: "q_00af5f39",
      sourceId: "pg1",
      kind: "sql" as const,
      payload: "SELECT channel, deals FROM deals",
    },
  ];

  it("收藏携带合法 queries/bindings：落盘回读完整，dataUpdatedAt 缺省置当前时间", async () => {
    const before = Date.now();
    const verdict = await store.upsert({
      dsl: "root = Root([chart])",
      prompt: "p",
      origin: { messageId: "m1" },
      queries,
      bindings: { chart: "q_00af5f39" },
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;

    expect(verdict.record.queries).toEqual(queries);
    expect(verdict.record.bindings).toEqual({ chart: "q_00af5f39" });
    expect(verdict.record.dataUpdatedAt).toBeGreaterThanOrEqual(before);

    const got = await store.get(verdict.record.id);
    expect(got?.queries).toEqual(queries);
    expect(got?.bindings).toEqual({ chart: "q_00af5f39" });
    expect(got?.dataUpdatedAt).toBe(verdict.record.dataUpdatedAt);

    // 摘要含活看板字段（预览徽标等 UI 数据）
    const summary = (await store.list())[0];
    expect(summary.queries).toEqual(queries);
    expect(summary.dataUpdatedAt).toBe(verdict.record.dataUpdatedAt);
  });

  it("校验：id 前缀/sourceId/kind/payload 形态、重复 id、bindings 键值与悬空引用 400", async () => {
    const cases: Array<Record<string, unknown>> = [
      { dsl: "x", queries: [{ ...queries[0], id: "nope" }], bindings: {} },
      { dsl: "x", queries: [{ ...queries[0], sourceId: "PG_1" }] },
      { dsl: "x", queries: [{ ...queries[0], kind: "script" }] },
      { dsl: "x", queries: [{ ...queries[0], payload: "  " }] },
      {
        dsl: "x",
        queries: [queries[0], { ...queries[0], payload: "SELECT 2" }],
      },
      { dsl: "x", queries, bindings: { "bad-key!": "q_00af5f39" } },
      { dsl: "x", queries, bindings: { chart: "q_missing" } },
      { dsl: "x", bindings: { chart: "q_00af5f39" } }, // 无 queries
      { dsl: "x", queries: "nope" },
      { dsl: "x", queries, bindings: [1, 2] },
      { dsl: "x", dataUpdatedAt: "yesterday" },
    ];
    for (const body of cases) {
      const res = await store.upsert(body);
      expect(res).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("覆盖收藏（同 messageId）：捕获结果整体替换；空数组清空旧 queries/bindings/dataUpdatedAt", async () => {
    const first = await store.upsert({
      dsl: "root = Root([chart])",
      origin: { messageId: "m1" },
      queries,
      bindings: { chart: "q_00af5f39" },
    });
    if (!first.ok) throw new Error("seed failed");
    expect(first.record.dataUpdatedAt).toBeDefined();

    // 新捕获（不同查询）
    const nextQueries = [
      { id: "q_11111111", sourceId: "pg1", kind: "sql" as const, payload: "SELECT 2" },
    ];
    const second = await store.upsert({
      dsl: "root = Root([chart])",
      origin: { messageId: "m1" },
      queries: nextQueries,
      bindings: { chart: "q_11111111" },
    });
    expect(second.ok && second.record.queries).toEqual(nextQueries);
    expect(second.ok && second.record.bindings).toEqual({ chart: "q_11111111" });

    // 再收藏为纯快照（queries 显式空数组）→ 活看板字段全部清除
    const third = await store.upsert({
      dsl: "root = Root([])",
      origin: { messageId: "m1" },
      queries: [],
    });
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.record.queries).toBeUndefined();
    expect(third.record.bindings).toBeUndefined();
    expect(third.record.dataUpdatedAt).toBeUndefined();
  });

  it("未提供活看板字段的覆盖收藏：保留旧记录的 queries/bindings（纯 dsl 更新不动绑定）", async () => {
    const first = await store.upsert({
      dsl: "root = Root([chart])",
      origin: { messageId: "m1" },
      queries,
      bindings: { chart: "q_00af5f39" },
    });
    if (!first.ok) throw new Error("seed failed");
    const second = await store.upsert({
      dsl: "root = Root([chart, insight])",
      origin: { messageId: "m1" },
    });
    expect(second.ok && second.record.queries).toEqual(queries);
    expect(second.ok && second.record.bindings).toEqual({
      chart: "q_00af5f39",
    });
  });

  it("update 局部更新：可单独清 queries；bindings 悬空引用（合并后）拒绝", async () => {
    const created = await store.upsert({
      dsl: "root = Root([chart])",
      origin: { messageId: "m1" },
      queries,
      bindings: { chart: "q_00af5f39" },
    });
    if (!created.ok) throw new Error("seed failed");
    const { id } = created.record;

    // 悬空引用：update 只改 bindings 指向不存在的 query
    const bad = await store.update(id, { bindings: { chart: "q_ghost" } });
    expect(bad).toMatchObject({ ok: false, status: 400 });

    // 清空 queries → bindings 随之清空（合并语义），dataUpdatedAt 一并清除
    const cleared = await store.update(id, { queries: [] });
    expect(cleared.ok && cleared.record.queries).toBeUndefined();
    expect(cleared.ok && cleared.record.bindings).toBeUndefined();
    expect(cleared.ok && cleared.record.dataUpdatedAt).toBeUndefined();
  });

  it("v0.1 旧记录（无 queries 字段）读取走只读路径不报错；导入落库不带活看板字段", async () => {
    // 旧版本落盘文件：只有 v0.1 字段
    fs.writeFileSync(
      path.join(dir, "dash_00000009.json"),
      JSON.stringify(
        seedRecord({
          id: "dash_00000009",
          origin: { messageId: "old-1" },
        })
      ),
      "utf-8"
    );
    const got = await store.get("dash_00000009");
    expect(got).not.toBeNull();
    expect(got?.queries).toBeUndefined();
    expect(got?.bindings).toBeUndefined();
    expect(got?.dataUpdatedAt).toBeUndefined();
    expect((await store.list()).map((s) => s.id)).toContain("dash_00000009");

    // 模拟旧快照导入（无 queries/bindings 字段）→ 正常入库
    const imported = await store.upsert({
      dsl: "root = Root([])",
      title: "旧快照导入",
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.record.queries).toBeUndefined();
    expect(imported.record.bindings).toBeUndefined();
    expect(imported.record.dataUpdatedAt).toBeUndefined();
  });

  it("跨层集成（完成定义全链路）：execute 记录 → 捕获 → 入库 → 回读，derived 不进 bindings", async () => {
    const dsl = [
      'root = Root([chart, table, derived])',
      'chart = AnalyticsChart("bar", "t", "s", "channel", [{"channel":"TikTok Ads","deals":186},{"channel":"Google Ads","deals":152}], [])',
      'table = DataTable("明细", [], [{"channel":"TikTok Ads","deals":186},{"channel":"Google Ads","deals":152}])',
      'derived = AnalyticsChart("bar", "CAC", "s", "channel", [{"channel":"TikTok Ads","cac":16.2},{"channel":"Google Ads","cac":19.5}], [])',
    ].join("\n");
    const toolCalls = [
      {
        toolCallId: "call-1",
        state: "result",
        toolName: "pg1_execute_sql",
        args: { sql: "SELECT channel, deals FROM deals" },
        result: {
          rows: [
            { channel: "TikTok Ads", deals: 186 },
            { channel: "Google Ads", deals: 152 },
          ],
        },
      },
      {
        toolCallId: "call-2",
        state: "result",
        toolName: "cross_source_link",
        args: { zentao_project_id: "42" },
        result: { confidence: "none" },
      },
    ];

    // 客户端捕获（MessageList 同款调用）→ 入库载荷
    const capture = captureDashboardQueries(
      dsl,
      toolCalls,
      [{ id: "pg1" }, { id: "gl1" }]
    );
    expect(Object.keys(capture.bindings)).toEqual(["chart", "table"]);

    const verdict = await store.upsert({
      dsl,
      origin: { messageId: "m-live" },
      queries: capture.queries,
      bindings: capture.bindings,
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;

    // 服务端回读：queries 合法（q_ 前缀/sql payload）、bindings 只含直取数组件
    const got = await store.get(verdict.record.id);
    expect(got?.queries).toHaveLength(1);
    expect(got?.queries?.[0]).toMatchObject({
      sourceId: "pg1",
      kind: "sql",
      payload: "SELECT channel, deals FROM deals",
    });
    expect(got?.queries?.[0].id).toMatch(/^q_[0-9a-z]+$/);
    expect(got?.bindings).toEqual({
      chart: got?.queries?.[0].id,
      table: got?.queries?.[0].id,
    });
    expect(got?.bindings).not.toHaveProperty("derived");
    expect(got?.dataUpdatedAt).toBeGreaterThan(0);
  });
});
