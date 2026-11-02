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
// Schema Card：类型与渲染为 client-safe（含 node:fs 的 store 不走主入口，
// 服务端经子路径 @openui-analytics/datasources/schema/store 引入）
export {
  type SchemaCard,
  type SchemaCardTable,
  type SchemaCardColumn,
  type SchemaCardToolSummary,
  type RawTableProfile,
  CARD_RENDER_BUDGET_BYTES,
  CARD_STORE_MAX_BYTES,
  LOW_CARDINALITY_THRESHOLD,
  renderCardForPrompt,
} from "./schema/card";
