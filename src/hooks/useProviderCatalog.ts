"use client";

import { useEffect, useState } from "react";
import {
  currentPresets,
  ensureProviderCatalog,
  type LlmProviderPreset,
} from "@/lib/llmProviders";

/**
 * Provider 目录状态：初始为内置精选（同步可用），
 * 挂载后异步拉取 models.dev 全量目录并合并刷新。
 * 拉取失败静默保持内置，不阻塞配置流程。
 */
export function useProviderCatalog(): {
  presets: LlmProviderPreset[];
  loading: boolean;
} {
  const [presets, setPresets] = useState<LlmProviderPreset[]>(currentPresets);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    ensureProviderCatalog()
      .then((merged) => {
        if (alive) setPresets(merged);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { presets, loading };
}
