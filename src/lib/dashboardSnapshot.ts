/**
 * 看板快照文件（.openui.json）导出/导入/文件名工具。
 * 快照 = 单条收藏记录的完整 JSON；导入时 origin 置空（视为手动导入，不与消息挂钩）。
 */
// 仅取类型（编译期擦除，不把 server-only 存储层打进客户端包）
import type { DashboardRecord } from "./dashboardStore";

export const SNAPSHOT_EXTENSION = ".openui.json";

/** 下载文件名：标题清洗（非法字符/连续下划线/长度），兜底「未命名看板」 */
export function snapshotFilename(title: string): string {
  const cleaned = (title || "")
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${cleaned || "未命名看板"}${SNAPSHOT_EXTENSION}`;
}

export interface SnapshotInput {
  dsl: string;
  title?: string;
  prompt?: string;
  sourceNames?: string[];
}

/**
 * 解析并校验快照文本：JSON 可解析 + dsl 非空字符串。
 * 可选字段（title/prompt/sourceNames）做形态收敛，服务端仍会二次校验（含 2MB 上限）。
 */
export function parseDashboardSnapshot(
  text: string
): { ok: true; value: SnapshotInput } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "快照文件不是有效的 JSON" };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return { ok: false, error: "快照内容必须是 JSON 对象" };
  }
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.dsl !== "string" || rec.dsl.trim().length === 0) {
    return { ok: false, error: "快照缺少非空的 dsl 字段" };
  }
  return {
    ok: true,
    value: {
      dsl: rec.dsl,
      ...(typeof rec.title === "string" && rec.title.trim()
        ? { title: rec.title.trim() }
        : {}),
      ...(typeof rec.prompt === "string" && rec.prompt
        ? { prompt: rec.prompt }
        : {}),
      ...(Array.isArray(rec.sourceNames)
        ? { sourceNames: rec.sourceNames.map(String) }
        : {}),
    },
  };
}

/** 触发浏览器下载：Blob + 隐形锚点（无第三方依赖） */
export async function downloadDashboardSnapshot(
  record: DashboardRecord
): Promise<void> {
  const blob = new Blob([JSON.stringify(record, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = snapshotFilename(record.title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
