import { describe, it, expect, beforeEach } from "vitest";
import {
  generateSessionTitle,
  createNewSession,
  DEFAULT_WELCOME_MESSAGE,
  setSessionEnabledSources,
  getSavedSessions,
  persistSessions,
} from "./sessionStorage";

describe("generateSessionTitle", () => {
  it("过滤【】前缀并返回主体内容", () => {
    expect(generateSessionTitle("【报表】分析上季度 CAC 趋势")).toBe(
      "分析上季度 CAC 趋势"
    );
  });

  it("超过 20 字时截断并追加省略号", () => {
    const long = "这是一个非常非常长的用户首条消息内容肯定超过二十个字符";
    const title = generateSessionTitle(long);
    expect(title.length).toBe(23); // 20 字 + "..."
    expect(title.endsWith("...")).toBe(true);
  });

  it("空内容返回默认标题", () => {
    expect(generateSessionTitle("")).toBe("新分析会话");
  });
});

describe("createNewSession", () => {
  it("创建包含欢迎消息且 id 以 session_ 开头的会话", () => {
    const session = createNewSession();
    expect(session.id.startsWith("session_")).toBe(true);
    expect(session.messages).toContainEqual(DEFAULT_WELCOME_MESSAGE);
  });
});

describe("setSessionEnabledSources", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("写入指定会话的 enabledSources 并可读回", () => {
    const session = createNewSession("测试会话");
    persistSessions([session]);

    setSessionEnabledSources(session.id, ["postgres", "jira"]);

    const saved = getSavedSessions();
    expect(saved[0].enabledSources).toEqual(["postgres", "jira"]);
  });

  it("传 undefined 恢复全选语义（删除字段）", () => {
    const session = createNewSession("测试会话");
    session.enabledSources = ["postgres"];
    persistSessions([session]);

    setSessionEnabledSources(session.id, undefined);

    const saved = getSavedSessions();
    expect(saved[0].enabledSources).toBeUndefined();
  });

  it("未知会话 id 不抛错不改数据", () => {
    const session = createNewSession("测试会话");
    persistSessions([session]);

    expect(() => setSessionEnabledSources("nope", ["a"])).not.toThrow();
    expect(getSavedSessions()).toHaveLength(1);
  });
});
