"use client";

import { useCallback, useEffect, useState } from "react";
import type { DataSourceDescriptor, HealthResult } from "@/mcp/registry";
import { authHeaders } from "@/lib/auth";

/**
 * 数据源列表与 CRUD 的客户端 hook。
 * GET 透传 localStorage 中的 GitLab 配置（与原 SettingsModal 探活行为一致）；
 * 所有写操作带 authHeaders()（middleware 部署鉴权）。
 */

function datasourceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeaders(),
  };
  return headers;
}

interface MutationResult {
  ok: boolean;
  errors?: string[];
}

async function requestDatasources(
  url: string,
  init?: RequestInit
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(url, { ...init, headers: datasourceHeaders() });
  let body: Record<string, unknown> | null = null;
  if (res.status !== 204) {
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      body = null;
    }
  }
  return { status: res.status, body };
}

function extractErrors(
  body: Record<string, unknown> | null,
  fallback: string
): string[] {
  if (!body) return [fallback];
  if (Array.isArray(body.errors)) return body.errors.map(String);
  if (typeof body.error === "string") return [body.error];
  return [fallback];
}

interface DatasourceListPayload {
  sources: DataSourceDescriptor[];
  health: Record<string, HealthResult>;
}

async function fetchDatasourceList(): Promise<DatasourceListPayload | null> {
  try {
    const { body } = await requestDatasources("/api/datasources");
    if (body && Array.isArray(body.sources)) {
      return {
        sources: body.sources as DataSourceDescriptor[],
        health: (body.health as Record<string, HealthResult>) ?? {},
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 模块级快照（stale-while-revalidate）：
 * GET /api/datasources 会对每个源做实时健康探测（慢源秒级超时），
 * 且 ChatDashboard 顶层已拉取同一列表——缓存上一次结果，
 * 让设置弹窗/选择器重新挂载时立即渲染旧数据，后台再刷新健康状态。
 */
let snapshot: DatasourceListPayload | null = null;

/** 活跃 hook 实例集合：任一实例拉到新数据即广播，其余实例（如底部计数）实时同步 */
const listeners = new Set<(data: DatasourceListPayload) => void>();

function publishData(data: DatasourceListPayload): void {
  snapshot = data;
  listeners.forEach((apply) => apply(data));
}

/** 仅测试用：隔离模块级缓存 */
export function resetDatasourceCacheForTests(): void {
  snapshot = null;
  listeners.clear();
}

/** 轻量列表 hook：会话选择器（SourcePicker）与设置面板共用 */
export function useDatasourceList() {
  // lazy initializer：命中缓存时首帧即有数据，不产生挂载级联渲染
  const [sources, setSources] = useState<DataSourceDescriptor[]>(
    () => snapshot?.sources ?? []
  );
  const [health, setHealth] = useState<Record<string, HealthResult>>(
    () => snapshot?.health ?? {}
  );
  const [loading, setLoading] = useState(() => snapshot === null);
  const [refreshing, setRefreshing] = useState(true);

  const apply = useCallback((data: DatasourceListPayload) => {
    setSources(data.sources);
    setHealth(data.health);
    setLoading(false);
    setRefreshing(false);
  }, []);

  // 订阅广播：设置面板增删改后的 refresh、其它实例的初始拉取，都会同步到本实例
  useEffect(() => {
    listeners.add(apply);
    return () => {
      listeners.delete(apply);
    };
  }, [apply]);

  // 初始加载：setState 只发生在 promise 回调中，避免 effect 内同步 setState 级联渲染
  useEffect(() => {
    let cancelled = false;
    fetchDatasourceList().then((data) => {
      if (cancelled) return;
      if (data) {
        publishData(data);
      } else {
        setLoading(false);
        setRefreshing(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const data = await fetchDatasourceList();
    if (data) {
      publishData(data);
    } else {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  return { sources, health, loading, refreshing, refresh };
}

/** 完整 CRUD hook：设置面板「数据源」tab 使用 */
export function useDatasources() {
  const list = useDatasourceList();

  const createSource = useCallback(
    async (input: Record<string, unknown>): Promise<MutationResult> => {
      const { status, body } = await requestDatasources("/api/datasources", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (status === 201) {
        await list.refresh();
        return { ok: true };
      }
      return { ok: false, errors: extractErrors(body, "创建失败") };
    },
    [list]
  );

  const updateSource = useCallback(
    async (
      id: string,
      patch: Record<string, unknown>
    ): Promise<MutationResult> => {
      const { status, body } = await requestDatasources(
        `/api/datasources/${id}`,
        { method: "PATCH", body: JSON.stringify(patch) }
      );
      if (status === 200) {
        await list.refresh();
        return { ok: true };
      }
      return { ok: false, errors: extractErrors(body, "更新失败") };
    },
    [list]
  );

  const removeSource = useCallback(
    async (id: string): Promise<void> => {
      await requestDatasources(`/api/datasources/${id}`, { method: "DELETE" });
      await list.refresh();
    },
    [list]
  );

  return { ...list, createSource, updateSource, removeSource };
}
