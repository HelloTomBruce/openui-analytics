"use client";

import { useMemo, useState } from "react";
import { ACCESS_TOKEN_STORAGE_KEY, authHeaders } from "@/lib/auth";

const STORAGE_KEYS = {
  apiKey: "openui_llm_api_key",
  baseURL: "openui_llm_base_url",
  model: "openui_llm_model",
  temperature: "openui_llm_temperature",
  protocol: "openui_llm_protocol",
} as const;

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TEMPERATURE = "0.2";
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
  // 接口协议：openai 兼容（/chat/completions）或 anthropic（/v1/messages，如 Kimi Coding）
  const [protocol, setProtocol] = useState<"openai" | "anthropic">(() =>
    readStored(STORAGE_KEYS.protocol, DEFAULT_PROTOCOL) === "anthropic"
      ? "anthropic"
      : "openai"
  );

  const saveSettings = () => {
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
    localStorage.setItem(STORAGE_KEYS.baseURL, baseURL);
    localStorage.setItem(STORAGE_KEYS.model, model);
    localStorage.setItem(STORAGE_KEYS.temperature, temperature);
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
      protocol,
    }),
    [apiKey, baseURL, model, temperature, protocol]
  );

  return {
    showSettings,
    setShowSettings,
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
    protocol,
    setProtocol,
    authHeaders,
    saveSettings,
    chatBody,
  };
}
