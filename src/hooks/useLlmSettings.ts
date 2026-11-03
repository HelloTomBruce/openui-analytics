"use client";

import { useMemo, useState } from "react";
import { ACCESS_TOKEN_STORAGE_KEY, authHeaders } from "@/lib/auth";
import {
  findPreset,
  inferProviderByBaseURL,
} from "@/lib/llmProviders";

const STORAGE_KEYS = {
  provider: "openui_llm_provider",
  apiKey: "openui_llm_api_key",
  baseURL: "openui_llm_base_url",
  model: "openui_llm_model",
  temperature: "openui_llm_temperature",
  maxTokens: "openui_llm_max_tokens",
  protocol: "openui_llm_protocol",
} as const;

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TEMPERATURE = "0.2";
// 留空 → 服务端默认 16384（Anthropic 协议端点必须显式带 max_tokens，避免 finishReason=length 静默截断）
const DEFAULT_MAX_TOKENS = "";
const DEFAULT_PROTOCOL = "openai";

function readStored(key: string, fallback: string): string {
  if (typeof window !== "undefined") {
    return localStorage.getItem(key) || fallback;
  }
  return fallback;
}

/**
 * LLM / GitLab MCP 配置状态管理：惰性读取 localStorage，提供保存与 useChat body。
 */
export function useLlmSettings() {
  const [showSettings, setShowSettings] = useState(false);
  // Provider 预设：未存储时按已存 baseURL 反推（老用户配置无损迁移）
  const [providerId, setProviderId] = useState(() =>
    readStored(STORAGE_KEYS.provider, "") || inferProviderByBaseURL(
      readStored(STORAGE_KEYS.baseURL, DEFAULT_BASE_URL)
    )
  );
  const [apiKey, setApiKey] = useState(() => readStored(STORAGE_KEYS.apiKey, ""));
  const [baseURL, setBaseURL] = useState(() =>
    readStored(STORAGE_KEYS.baseURL, DEFAULT_BASE_URL)
  );
  const [model, setModel] = useState(() => readStored(STORAGE_KEYS.model, DEFAULT_MODEL));
  // 部署模式访问令牌（对应服务端 OPENUI_API_AUTH_TOKEN；本地未配置时留空）
  const [accessToken, setAccessToken] = useState(() =>
    readStored(ACCESS_TOKEN_STORAGE_KEY, "")
  );
  const [temperature, setTemperature] = useState(() =>
    readStored(STORAGE_KEYS.temperature, DEFAULT_TEMPERATURE)
  );
  // 最大输出 tokens：留空走服务端默认；推理型模型建议 32768+
  const [maxTokens, setMaxTokens] = useState(() =>
    readStored(STORAGE_KEYS.maxTokens, DEFAULT_MAX_TOKENS)
  );
  // 接口协议：openai 兼容（/chat/completions）或 anthropic（/v1/messages，如 Kimi Coding）
  const [protocol, setProtocol] = useState<"openai" | "anthropic">(() =>
    readStored(STORAGE_KEYS.protocol, DEFAULT_PROTOCOL) === "anthropic"
      ? "anthropic"
      : "openai"
  );

  /**
   * 选择 Provider 预设：联动填充协议 / baseURL / 默认模型。
   * 自定义（custom）不动现有值，回退自由输入形态。
   */
  const applyProvider = (id: string) => {
    setProviderId(id);
    const preset = findPreset(id);
    if (preset) {
      setBaseURL(preset.baseURL);
      setProtocol(preset.protocol);
      setModel(preset.defaultModel);
    }
  };

  const saveSettings = () => {
    localStorage.setItem(STORAGE_KEYS.provider, providerId);
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
    localStorage.setItem(STORAGE_KEYS.baseURL, baseURL);
    localStorage.setItem(STORAGE_KEYS.model, model);
    localStorage.setItem(STORAGE_KEYS.temperature, temperature);
    localStorage.setItem(STORAGE_KEYS.maxTokens, maxTokens);
    localStorage.setItem(STORAGE_KEYS.protocol, protocol);
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken);
    setShowSettings(false);
  };

  const chatBody = useMemo(
    () => ({
      apiKey: apiKey.trim() || undefined,
      baseURL: baseURL.trim() || undefined,
      model: model.trim() || undefined,
      temperature: temperature.trim() || undefined,
      maxTokens: maxTokens.trim() || undefined,
      protocol,
    }),
    [apiKey, baseURL, model, temperature, maxTokens, protocol]
  );

  return {
    showSettings,
    setShowSettings,
    providerId,
    applyProvider,
    apiKey,
    setApiKey,
    baseURL,
    setBaseURL,
    model,
    setModel,
    accessToken,
    setAccessToken,
    temperature,
    setTemperature,
    maxTokens,
    setMaxTokens,
    protocol,
    setProtocol,
    authHeaders,
    saveSettings,
    chatBody,
  };
}
