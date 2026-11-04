/**
 * 查询行提取与组件行属性映射（纯 isomorphic，零依赖）。
 *
 * 从 dashboardCapture 拆出：刷新端（server-only 链路）只需要这两个纯函数，
 * 不应经 dashboardCapture 间接引入 react-lang / components 的 React 运行时
 * （RSC 环境无 createContext，刷新路由会 500）。
 */

/** 持行数组的组件属性：组件类型 → 行数组所在 prop 名（捕获与刷新回填共用） */
export const ROW_PROP_BY_TYPE: Record<string, string> = {
  DataTable: "data",
  AnalyticsChart: "data",
  RadarChart: "data",
  ContributionHeatmap: "data",
  FunnelChart: "stages",
  ActivityTimeline: "items",
  ActionPlanCard: "actions",
};

/** 查询行提取（刷新重放复用）：组件类型对应行数组 prop 名，未知类型返回 undefined */
export function rowPropFor(typeName: string): string | undefined {
  return ROW_PROP_BY_TYPE[typeName];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 从工具结果中提取「记录行数组」（刷新重放复用）：
 * 顶层数组，或常见包裹键（rows/data/items/list/records/results）下的数组。
 * 其余形态（标量/嵌套/非对象元素）返回 null——无法与组件行匹配。
 */
export function extractQueryRows(
  result: unknown
): Record<string, unknown>[] | null {
  const asRows = (v: unknown): Record<string, unknown>[] | null =>
    Array.isArray(v) && v.length > 0 && v.every(isPlainObject)
      ? (v as Record<string, unknown>[])
      : null;
  if (Array.isArray(result)) return asRows(result);
  if (isPlainObject(result)) {
    for (const key of ["rows", "data", "items", "list", "records", "results"]) {
      if (Array.isArray(result[key])) {
        const rows = asRows(result[key]);
        if (rows) return rows;
      }
    }
  }
  return null;
}
