"use client";

import { useMemo, useState } from "react";

const STORAGE_KEYS = {
  apiKey: "openui_llm_api_key",
  baseURL: "openui_llm_base_url",
  model: "openui_llm_model",
  gitlabToken: "openui_gitlab_token",
  gitlabUrl: "openui_gitlab_url",
} as const;

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_GITLAB_URL = "http://127.0.0.1:5002/mcp";

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
  const [gitlabToken, setGitlabToken] = useState(() =>
    readStored(STORAGE_KEYS.gitlabToken, "")
  );
  const [gitlabUrl, setGitlabUrl] = useState(() =>
    readStored(STORAGE_KEYS.gitlabUrl, DEFAULT_GITLAB_URL)
  );

  const saveSettings = () => {
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
    localStorage.setItem(STORAGE_KEYS.baseURL, baseURL);
    localStorage.setItem(STORAGE_KEYS.model, model);
    localStorage.setItem(STORAGE_KEYS.gitlabToken, gitlabToken);
    localStorage.setItem(STORAGE_KEYS.gitlabUrl, gitlabUrl);
    setShowSettings(false);
  };

  const chatBody = useMemo(
    () => ({
      apiKey: apiKey.trim() || undefined,
      baseURL: baseURL.trim() || undefined,
      model: model.trim() || undefined,
      gitlabToken: gitlabToken.trim() || undefined,
      gitlabUrl: gitlabUrl.trim() || undefined,
    }),
    [apiKey, baseURL, model, gitlabToken, gitlabUrl]
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
    gitlabToken,
    setGitlabToken,
    gitlabUrl,
    setGitlabUrl,
    saveSettings,
    chatBody,
  };
}
