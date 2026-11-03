/**
 * LLM Provider 预设目录（前端配置体验层）。
 *
 * 数据精选自社区目录 models.dev（https://models.dev/api.json）：
 * 每条预设固化「协议 + baseURL + 常用模型列表」，用户只需选 Provider、选 Model、填 API Key。
 * 服务端 /api/analyze 的 apiKey/baseURL/model/protocol 契约不变，本目录仅做默认值填充。
 */

export type LlmProtocol = "openai" | "anthropic";

export interface LlmProviderPreset {
  /** 稳定 id，持久化于 localStorage openui_llm_provider */
  id: string;
  /** 展示名 */
  name: string;
  /** 接口协议：anthropic（/v1/messages）或 openai 兼容（/chat/completions） */
  protocol: LlmProtocol;
  /** 默认 baseURL（服务端会做 /v1 规范化） */
  baseURL: string;
  /** 默认模型 */
  defaultModel: string;
  /** 常用模型列表（下拉选项；含 defaultModel） */
  models: string[];
  /** API Key 获取提示（占位符/说明用） */
  keyHint: string;
}

export const CUSTOM_PROVIDER_ID = "custom";

export const LLM_PROVIDER_PRESETS: LlmProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai",
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini"],
    keyHint: "platform.openai.com 获取 sk-...",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    protocol: "anthropic",
    baseURL: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-5",
    models: [
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
      "claude-opus-4-1",
      "claude-3-7-sonnet-latest",
    ],
    keyHint: "console.anthropic.com 获取 sk-ant-...",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai",
    baseURL: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    keyHint: "platform.deepseek.com 获取 sk-...",
  },
  {
    id: "moonshot",
    name: "Kimi（Moonshot）",
    protocol: "openai",
    baseURL: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-latest",
    models: ["kimi-latest", "kimi-k2-0905-preview", "moonshot-v1-32k"],
    keyHint: "platform.moonshot.cn 获取 sk-...",
  },
  {
    id: "qwen",
    name: "Qwen（阿里 DashScope 兼容模式）",
    protocol: "openai",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    models: ["qwen-plus", "qwen-max", "qwen-turbo", "qwen3-coder-plus"],
    keyHint: "bailian.console.aliyun.com 获取 sk-...",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    protocol: "openai",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4.5",
    models: ["glm-4.5", "glm-4.5-air", "glm-4-plus", "glm-4-flash"],
    keyHint: "open.bigmodel.cn 获取",
  },
  {
    id: "minimax",
    name: "MiniMax",
    protocol: "openai",
    baseURL: "https://api.minimax.chat/v1",
    defaultModel: "MiniMax-M2",
    models: ["MiniMax-M2", "MiniMax-Text-01", "abab6.5s-chat"],
    keyHint: "platform.minimaxi.com 获取",
  },
  {
    id: "xai",
    name: "xAI Grok",
    protocol: "openai",
    baseURL: "https://api.x.ai/v1",
    defaultModel: "grok-4",
    models: ["grok-4", "grok-4-fast", "grok-3", "grok-3-mini"],
    keyHint: "console.x.ai 获取 xai-...",
  },
  {
    id: "openrouter",
    name: "OpenRouter（聚合）",
    protocol: "openai",
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    models: [
      "openai/gpt-4o-mini",
      "anthropic/claude-sonnet-4.5",
      "deepseek/deepseek-chat",
      "google/gemini-2.5-flash",
    ],
    keyHint: "openrouter.ai 获取 sk-or-...",
  },
  {
    id: "ollama",
    name: "Ollama（本地）",
    protocol: "openai",
    baseURL: "http://127.0.0.1:11434/v1",
    defaultModel: "qwen3:8b",
    models: ["qwen3:8b", "llama3.1:8b", "deepseek-r1:8b"],
    keyHint: "本地无需 Key，可任意填写",
  },
];

// ---------------------------------------------------------------------------
// 动态目录（models.dev）：拉取全量 provider 目录，内置精选兜底
// ---------------------------------------------------------------------------

const CATALOG_URL = "https://models.dev/api.json";
const CATALOG_CACHE_KEY = "openui_llm_provider_catalog";
/** 缓存有效期 24h：命中直接用，过期后台刷新，失败回退缓存/内置 */
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
/** datalist 模型建议上限（超大列表截断，仅作提示用） */
const MODEL_SUGGESTION_CAP = 100;

/** 合并后的当前目录：内置精选优先（保留中文名/默认模型/Key 提示），目录补全模型并追加其余 provider */
let dynamicPresets: LlmProviderPreset[] | null = null;

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * models.dev api.json → LlmProviderPreset[]。
 * 只保留本应用 apiKey+baseURL 模式可接入的条目：
 * - npm 为 openai-compatible / openai / anthropic 系（排除 Bedrock/Azure/Vertex 等专有认证）
 * - 带静态 api baseURL（排除含 ${...} 模板变量的）
 */
export function convertCatalog(raw: unknown): LlmProviderPreset[] {
  if (!raw || typeof raw !== "object") return [];
  const presets: LlmProviderPreset[] = [];
  for (const p of Object.values(raw as Record<string, Record<string, unknown>>)) {
    const npm = typeof p.npm === "string" ? p.npm : "";
    const api = typeof p.api === "string" ? p.api : "";
    if (!/openai|anthropic/.test(npm)) continue;
    if (!api || api.includes("${")) continue;
    const models = Object.entries(
      (p.models as Record<string, { status?: string }>) ?? {}
    )
      .filter(([, m]) => m && m.status !== "deprecated")
      .map(([id]) => id)
      .slice(0, MODEL_SUGGESTION_CAP);
    presets.push({
      id: String(p.id ?? ""),
      name: String(p.name ?? p.id ?? ""),
      protocol: npm.includes("anthropic") ? "anthropic" : "openai",
      baseURL: api,
      defaultModel: models[0] ?? "",
      models,
      keyHint: "在 Provider 官网获取 API Key",
    });
  }
  return presets.filter((p) => p.id && p.baseURL);
}

/** 内置精选 + 动态目录按 baseURL 去重合并：内置条目保留元信息，模型取并集 */
export function mergePresets(catalog: LlmProviderPreset[]): LlmProviderPreset[] {
  const merged = LLM_PROVIDER_PRESETS.map((builtin) => {
    const hit = catalog.find(
      (c) => normalizeBase(c.baseURL) === normalizeBase(builtin.baseURL)
    );
    if (!hit) return builtin;
    const models = [
      ...new Set([builtin.defaultModel, ...builtin.models, ...hit.models]),
    ];
    return { ...builtin, models };
  });
  const builtinBaseUrls = new Set(
    LLM_PROVIDER_PRESETS.map((p) => normalizeBase(p.baseURL))
  );
  const rest = catalog
    .filter((c) => !builtinBaseUrls.has(normalizeBase(c.baseURL)))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...merged, ...rest];
}

/** 读取本地缓存目录（未过期且结构合法才返回，存的是转换后的精简目录） */
function readCatalogCache(): LlmProviderPreset[] | null {
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fetchedAt: number; catalog: LlmProviderPreset[] };
    if (Date.now() - parsed.fetchedAt > CATALOG_TTL_MS) return null;
    const catalog = parsed.catalog;
    if (!Array.isArray(catalog) || !catalog.length) return null;
    if (!catalog.every((p) => p && p.id && p.baseURL)) return null;
    return catalog;
  } catch {
    return null;
  }
}

/**
 * 确保 Provider 目录就绪：缓存命中→立即返回并后台刷新；否则拉取 models.dev。
 * 任何失败静默回退内置精选（目录是纯体验层，不阻塞配置）。
 */
export async function ensureProviderCatalog(): Promise<LlmProviderPreset[]> {
  if (dynamicPresets) return dynamicPresets;
  const cached = typeof window !== "undefined" ? readCatalogCache() : null;
  if (cached) {
    dynamicPresets = mergePresets(cached);
    // 缓存后台静默刷新，不等待
    void refreshCatalog().catch(() => {});
    return dynamicPresets;
  }
  return refreshCatalog();
}

async function refreshCatalog(): Promise<LlmProviderPreset[]> {
  try {
    const res = await fetch(CATALOG_URL);
    if (!res.ok) throw new Error(`catalog http ${res.status}`);
    const raw = await res.json();
    const catalog = convertCatalog(raw);
    if (!catalog.length) throw new Error("catalog empty");
    dynamicPresets = mergePresets(catalog);
    try {
      localStorage.setItem(
        CATALOG_CACHE_KEY,
        JSON.stringify({ fetchedAt: Date.now(), catalog })
      );
    } catch {
      /* 缓存写入失败（如配额）不影响目录使用 */
    }
    return dynamicPresets;
  } catch {
    // 拉取失败：保持缓存/内置
    return (dynamicPresets ??= mergePresets([]));
  }
}

/** 当前可用目录（动态未就绪时为内置精选） */
export function currentPresets(): LlmProviderPreset[] {
  return dynamicPresets ?? LLM_PROVIDER_PRESETS;
}

/** 全部下拉选项（含「自定义」收尾） */
export function providerOptions(): { id: string; name: string }[] {
  return [
    ...currentPresets().map(({ id, name }) => ({ id, name })),
    { id: CUSTOM_PROVIDER_ID, name: "自定义" },
  ];
}

export function findPreset(id: string): LlmProviderPreset | undefined {
  return currentPresets().find((p) => p.id === id);
}

/** 按已存 baseURL 反推 Provider（老用户迁移）：去尾斜杠精确匹配，匹配不到返回 custom */
export function inferProviderByBaseURL(baseURL: string): string {
  const normalized = normalizeBase(baseURL);
  if (!normalized) return "openai";
  const hit = currentPresets().find(
    (p) => normalizeBase(p.baseURL) === normalized
  );
  return hit ? hit.id : CUSTOM_PROVIDER_ID;
}
