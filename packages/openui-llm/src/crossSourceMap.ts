import fs from "node:fs";
import path from "node:path";

/**
 * 禅道项目 ↔ GitLab 仓库映射配置。
 * 配置文件：config/cross-source-map.json（可手工编辑，见文件内 _comment 说明）。
 * 任何读取/解析失败都降级为 confidence: "none"，绝不抛错拖垮分析请求。
 */

export interface CrossSourceLink {
  gitlabProject: string | null;
  confidence: "mapped" | "none";
  zentaoProjectName?: string;
}

interface MappingEntry {
  zentaoProjectId: string;
  zentaoProjectName?: string;
  gitlabProject: string;
}

const DEFAULT_CONFIG_PATH = path.join(
  process.cwd(),
  "config",
  "cross-source-map.json"
);

let cache: MappingEntry[] | null = null;
let cachePath = DEFAULT_CONFIG_PATH;

function load(configPath: string): MappingEntry[] {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { mappings?: unknown }).mappings)
    ) {
      return (parsed as { mappings: MappingEntry[] }).mappings;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * 查询某个禅道项目对应的 GitLab 仓库映射。
 */
export function getCrossSourceLinks(zentaoProjectId: string): CrossSourceLink {
  if (cache === null) {
    cache = load(cachePath);
  }
  const hit = cache.find((m) => m.zentaoProjectId === zentaoProjectId);
  if (hit) {
    return {
      gitlabProject: hit.gitlabProject,
      confidence: "mapped",
      zentaoProjectName: hit.zentaoProjectName,
    };
  }
  return { gitlabProject: null, confidence: "none" };
}

/**
 * 重新加载映射配置（配置变更后调用；测试可传入临时路径）。
 */
export function reloadCrossSourceMap(
  configPath: string = DEFAULT_CONFIG_PATH
): void {
  cachePath = configPath;
  cache = load(cachePath);
}
