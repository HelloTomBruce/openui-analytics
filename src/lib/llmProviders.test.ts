import { describe, it, expect, beforeEach } from "vitest";
import {
  convertCatalog,
  mergePresets,
  LLM_PROVIDER_PRESETS,
  CUSTOM_PROVIDER_ID,
  inferProviderByBaseURL,
} from "./llmProviders";

const CATALOG_FIXTURE = {
  zhipuai: {
    id: "zhipuai",
    name: "Zhipu AI",
    npm: "@ai-sdk/openai-compatible",
    api: "https://open.bigmodel.cn/api/paas/v4",
    env: ["ZHIPU_API_KEY"],
    models: {
      "glm-4.7": { id: "glm-4.7", status: undefined },
      "glm-4-flash": { id: "glm-4-flash" },
      "glm-4-old": { id: "glm-4-old", status: "deprecated" },
    },
  },
  "zhipuai-coding-plan": {
    id: "zhipuai-coding-plan",
    name: "Zhipu AI Coding Plan",
    npm: "@ai-sdk/openai-compatible",
    api: "https://open.bigmodel.cn/api/coding/paas/v4",
    env: ["ZHIPU_API_KEY"],
    models: { "glm-4.7": { id: "glm-4.7" } },
  },
  "minimax-cn": {
    id: "minimax-cn",
    name: "MiniMax (minimax.cn)",
    npm: "@ai-sdk/anthropic",
    api: "https://api.minimax.cn/anthropic/v1",
    models: { "MiniMax-M3": { id: "MiniMax-M3" } },
  },
  // 应被排除：专有认证 / 模板变量 URL / 缺 baseURL
  "amazon-bedrock": {
    id: "amazon-bedrock",
    name: "Amazon Bedrock",
    npm: "@ai-sdk/amazon-bedrock",
    models: {},
  },
  databricks: {
    id: "databricks",
    name: "Databricks",
    npm: "@ai-sdk/openai-compatible",
    api: "https://${DATABRICKS_HOST}/ai-gateway/v1",
    models: {},
  },
};

describe("convertCatalog", () => {
  it("转换为预设：协议按 npm 推断，排除 deprecated 模型", () => {
    const presets = convertCatalog(CATALOG_FIXTURE);
    const ids = presets.map((p) => p.id);
    expect(ids).toContain("zhipuai");
    expect(ids).toContain("zhipuai-coding-plan");
    expect(ids).toContain("minimax-cn");
    expect(ids).not.toContain("amazon-bedrock");
    expect(ids).not.toContain("databricks");

    const zhipu = presets.find((p) => p.id === "zhipuai")!;
    expect(zhipu.protocol).toBe("openai");
    expect(zhipu.models).toEqual(["glm-4.7", "glm-4-flash"]);
    expect(zhipu.defaultModel).toBe("glm-4.7");

    const minimax = presets.find((p) => p.id === "minimax-cn")!;
    expect(minimax.protocol).toBe("anthropic");
  });

  it("非对象输入返回空数组", () => {
    expect(convertCatalog(null)).toEqual([]);
    expect(convertCatalog("x")).toEqual([]);
  });
});

describe("mergePresets", () => {
  beforeEach(() => {
    // mergePresets 是纯函数，无模块状态依赖
  });

  it("内置条目优先保留元信息，模型与目录并集；目录新增条目按名排序追加", () => {
    const merged = mergePresets(convertCatalog(CATALOG_FIXTURE));
    // 内置智谱条目（baseURL 相同）合并目录模型
    const zhipu = merged.find(
      (p) => p.baseURL === "https://open.bigmodel.cn/api/paas/v4"
    )!;
    expect(zhipu.id).toBe("zhipu");
    expect(zhipu.name).toBe("智谱 GLM"); // 内置中文名优先
    expect(zhipu.models).toContain("glm-4.7"); // 目录模型并入
    expect(zhipu.models).toContain("glm-4.5"); // 内置模型保留

    // 目录独有条目追加（coding plan / minimax-cn anthropic）
    expect(merged.some((p) => p.id === "zhipuai-coding-plan")).toBe(true);
    expect(merged.some((p) => p.id === "minimax-cn")).toBe(true);
    // 内置 ollama（目录无对应）原样保留
    expect(merged.some((p) => p.id === "ollama")).toBe(true);
  });

  it("空目录时等价内置精选", () => {
    expect(mergePresets([])).toEqual(LLM_PROVIDER_PRESETS);
  });
});

describe("inferProviderByBaseURL", () => {
  it("匹配内置与目录条目，匹配不到返回 custom", () => {
    expect(inferProviderByBaseURL("https://api.deepseek.com/v1/")).toBe(
      "deepseek"
    );
    expect(inferProviderByBaseURL("http://my-gw.local/v1")).toBe(
      CUSTOM_PROVIDER_ID
    );
  });
});
