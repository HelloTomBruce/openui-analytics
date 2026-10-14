/**
 * @openui-analytics/datasources 统一入口。
 * 主入口 client-safe（前端仅 import type）；ai 适配器走子路径
 * `@openui-analytics/datasources/adapters/ai`（optional peerDependency）。
 */
export * from "./config";
export * from "./manager";
