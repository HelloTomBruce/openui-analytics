import { describe, it, expect } from "vitest";
import type { Message } from "@ai-sdk/react";
import { upsertMessage } from "./messages";

const msg = (id: string, content: string): Message => ({
  id,
  role: "assistant",
  content,
});

describe("upsertMessage", () => {
  it("最终消息不在列表中时追加", () => {
    const base = [msg("a", "步骤一"), msg("b", "步骤二")];
    const next = upsertMessage(base, msg("c", "最终看板"));
    expect(next).toHaveLength(3);
    expect(next[2].id).toBe("c");
  });

  it("最终消息已在列表中时按 id 替换，不产生重复", () => {
    const base = [msg("a", "旧内容"), msg("b", "中间消息")];
    const next = upsertMessage(base, msg("a", "新内容"));
    expect(next).toHaveLength(2);
    expect(next[0].content).toBe("新内容");
    expect(next[1].id).toBe("b");
  });

  it("空列表直接返回单条", () => {
    expect(upsertMessage([], msg("a", "x"))).toHaveLength(1);
  });

  it("不修改原数组（不可变更新）", () => {
    const base = [msg("a", "x")];
    upsertMessage(base, msg("b", "y"));
    expect(base).toHaveLength(1);
  });
});
