/**
 * @openui-analytics/datasources 统一入口。
 * 主入口 client-safe（前端仅 import type）；ai 适配器走子路径
 * `@openui-analytics/datasources/adapters/ai`（optional peerDependency）。
 */
export * from "./config";
export * from "./manager";
export {
  FILE_SOURCE_MAX_BYTES,
  FILE_SOURCE_EXTENSIONS,
  isSupportedUpload,
  sanitizeTableName,
  type FileSourceManifest,
  type FileTableInfo,
  type FileSourceUpload,
} from "./connectors/file/fileStore";
