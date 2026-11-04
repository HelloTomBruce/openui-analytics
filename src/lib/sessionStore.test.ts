// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createSessionStore,
  validateSessionFields,
  SESSION_MESSAGES_MAX,
} from "./sessionStore";

let dir: string;
let store: ReturnType<typeof createSessionStore>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sessions-"));
  store = createSessionStore({ dir });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function seedMessages() {
  return [
    { id: "m1", role: "user", content: "分析各渠道 CAC" },
    { id: "m2", role: "assistant", content: "```openui\nroot = Root([])\n```" },
  ];
}

describe("create 新建会话", () => {
  it("缺省入参：生成 sess_ id、缺省标题、空消息，原子落盘可回读", async () => {
    const verdict = await store.create({});
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;

    expect(verdict.record.id).toMatch(/^sess_[0-9a-f]{8}$/);
    expect(verdict.record.title).toBe("新建分析会话");
    expect(verdict.record.messages).toEqual([]);

    // 落盘验证：单 JSON 文件，无临时文件残留（原子写）
    const files = fs.readdirSync(dir);
    expect(files).toEqual([`${verdict.record.id}.json`]);
    const got = await store.get(verdict.record.id);
    expect(got?.id).toBe(verdict.record.id);
  });

  it("迁移场景：显式 createdAt/updatedAt 被保留", async () => {
    const verdict = await store.create({
      title: "旧会话",
      messages: seedMessages(),
      createdAt: 1000,
      updatedAt: 2000,
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.record.createdAt).toBe(1000);
    expect(verdict.record.updatedAt).toBe(2000);
  });

  it("enabledSources 与 context 元数据随创建落盘", async () => {
    const verdict = await store.create({
      enabledSources: ["postgres", "zentao"],
      context: { lastPromptTokens: 12345 },
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.record.enabledSources).toEqual(["postgres", "zentao"]);
    expect(verdict.record.context?.lastPromptTokens).toBe(12345);
  });
});

describe("list 摘要列表", () => {
  it("摘要不含 messages 且带 messageCount，按 updatedAt 降序", async () => {
    await store.create({ title: "旧", updatedAt: 1000 });
    await store.create({ title: "新", messages: seedMessages(), updatedAt: 3000 });
    const list = await store.list();
    expect(list.map((s) => s.title)).toEqual(["新", "旧"]);
    expect(Object.keys(list[0])).not.toContain("messages");
    expect(list[0].messageCount).toBe(2);
  });

  it("坏 JSON 与形态不符的文件静默跳过", async () => {
    await store.create({ title: "好" });
    fs.writeFileSync(path.join(dir, "sess_badbee01.json"), "not-json");
    fs.writeFileSync(
      path.join(dir, "sess_badbee02.json"),
      JSON.stringify({ id: "sess_badbee02" })
    );
    // 非 sess_ 前缀文件不参与扫描
    fs.writeFileSync(path.join(dir, "random.json"), "{}");
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("好");
  });
});

describe("get 详情", () => {
  it("未知 id / 非法 id（路径穿越形态）返回 null", async () => {
    expect(await store.get("sess_ffffffff")).toBeNull();
    expect(await store.get("../etc/passwd")).toBeNull();
    expect(await store.get("session_legacy_123")).toBeNull();
  });
});

describe("update 局部更新", () => {
  it("title / messages 整体替换，updatedAt 前移", async () => {
    const created = await store.create({ createdAt: 1000, updatedAt: 1000 });
    if (!created.ok) throw new Error("seed failed");
    const verdict = await store.update(created.record.id, {
      title: "改名",
      messages: seedMessages(),
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.record.title).toBe("改名");
    expect(verdict.record.messages).toHaveLength(2);
    expect(verdict.record.updatedAt).toBeGreaterThan(1000);
  });

  it("enabledSources: 数组设置、null 清除恢复全选语义", async () => {
    const created = await store.create({ enabledSources: ["postgres"] });
    if (!created.ok) throw new Error("seed failed");
    const id = created.record.id;

    const setRes = await store.update(id, { enabledSources: ["zentao"] });
    expect(setRes.ok && setRes.record.enabledSources).toEqual(["zentao"]);

    const cleared = await store.update(id, { enabledSources: null });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect("enabledSources" in cleared.record).toBe(false);
    }
    // 落盘后的记录同样无此字段
    const got = await store.get(id);
    expect(got && "enabledSources" in got).toBe(false);
  });

  it("context 增量合并；context:null 整体清除", async () => {
    const created = await store.create({
      context: { lastPromptTokens: 100, summary: "旧摘要" },
    });
    if (!created.ok) throw new Error("seed failed");
    const id = created.record.id;

    // 增量合并：只更新锚点，summary 保留
    const merged = await store.update(id, { context: { lastPromptTokens: 200 } });
    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect(merged.record.context?.lastPromptTokens).toBe(200);
      expect(merged.record.context?.summary).toBe("旧摘要");
    }

    const cleared = await store.update(id, { context: null });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect("context" in cleared.record).toBe(false);
  });

  it("无可更新字段 → 400；不存在 → 404", async () => {
    const created = await store.create({});
    if (!created.ok) throw new Error("seed failed");
    const empty = await store.update(created.record.id, {});
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.status).toBe(400);

    const missing = await store.update("sess_ffffffff", { title: "x" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(404);
  });
});

describe("remove 删除", () => {
  it("删除存在会话返回 true；重复删除返回 false", async () => {
    const created = await store.create({});
    if (!created.ok) throw new Error("seed failed");
    expect(await store.remove(created.record.id)).toBe(true);
    expect(await store.remove(created.record.id)).toBe(false);
  });

  it("删除活跃会话时活跃指针一并清除", async () => {
    const created = await store.create({});
    if (!created.ok) throw new Error("seed failed");
    await store.setActiveId(created.record.id);
    await store.remove(created.record.id);
    expect(await store.getActiveId()).toBeNull();
  });
});

describe("活跃会话指针", () => {
  it("set/get 往返；null 清除；指向不存在会话返回 false", async () => {
    expect(await store.getActiveId()).toBeNull();

    const created = await store.create({});
    if (!created.ok) throw new Error("seed failed");
    expect(await store.setActiveId(created.record.id)).toBe(true);
    expect(await store.getActiveId()).toBe(created.record.id);

    expect(await store.setActiveId("sess_ffffffff")).toBe(false);
    expect(await store.setActiveId("../evil")).toBe(false);

    expect(await store.setActiveId(null)).toBe(true);
    expect(await store.getActiveId()).toBeNull();
  });

  it("meta 文件不参与会话列表扫描", async () => {
    const created = await store.create({});
    if (!created.ok) throw new Error("seed failed");
    await store.setActiveId(created.record.id);
    expect(fs.readdirSync(dir)).toContain("_meta.json");
    const list = await store.list();
    expect(list).toHaveLength(1);
  });
});

describe("planMode 字段", () => {
  it("创建/更新设置 planMode；null 恢复默认（删除字段）", async () => {
    const created = await store.create({ planMode: false });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.record.planMode).toBe(false);
    const id = created.record.id;

    // 摘要携带 planMode
    const list = await store.list();
    expect(list.find((s) => s.id === id)?.planMode).toBe(false);

    const on = await store.update(id, { planMode: true });
    expect(on.ok && on.record.planMode).toBe(true);

    const cleared = await store.update(id, { planMode: null });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect("planMode" in cleared.record).toBe(false);
    const got = await store.get(id);
    expect(got && "planMode" in got).toBe(false);
  });

  it("planMode 非布尔 → 400", () => {
    const verdict = validateSessionFields({ planMode: "yes" });
    expect(verdict.ok).toBe(false);
  });
});

describe("validateSessionFields 校验边界", () => {
  it("非对象请求体 → 400", () => {
    const verdict = validateSessionFields("nope");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.status).toBe(400);
  });

  it("消息缺锚点字段 → 400", () => {
    const verdict = validateSessionFields({
      messages: [{ content: "没有 id 和 role" }],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.errors[0]).toContain("messages[0].id");
    }
  });

  it("消息条数超限 → 413", () => {
    const messages = Array.from({ length: SESSION_MESSAGES_MAX + 1 }, (_, i) => ({
      id: `m${i}`,
      role: "user",
      content: "x",
    }));
    const verdict = validateSessionFields({ messages });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.status).toBe(413);
  });

  it("enabledSources 非法源 id → 400；空数组归一为清除语义", () => {
    const bad = validateSessionFields({ enabledSources: ["Bad ID!"] });
    expect(bad.ok).toBe(false);

    const empty = validateSessionFields({ enabledSources: [] });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value.enabledSources).toBeNull();
  });

  it("context 字段形态校验", () => {
    const bad = validateSessionFields({ context: { lastPromptTokens: -1 } });
    expect(bad.ok).toBe(false);

    const good = validateSessionFields({
      context: { lastPromptTokens: 5000, summaryUptoMessageId: "m9" },
    });
    expect(good.ok).toBe(true);
  });

  it("消息的 AI SDK 扩展字段（parts/toolInvocations）原样透传", async () => {
    const withParts = {
      id: "m1",
      role: "assistant",
      content: "",
      parts: [{ type: "tool-invocation", toolInvocation: { toolName: "execute_sql" } }],
      annotations: [{ type: "usage" }],
    };
    const verdict = await store.create({ messages: [withParts] });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    const got = await store.get(verdict.record.id);
    expect(got?.messages[0]).toEqual(withParts);
  });
});
