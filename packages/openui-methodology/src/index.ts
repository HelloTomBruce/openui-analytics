/**
 * @openui-analytics/methodology 统一入口。
 * 零运行时依赖的纯数据 + 纯函数包：方法卡契约、内置 10 卡、
 * 注册表（三级扩展单通道）与 prompt 渲染（预算硬上限）。
 */
export type { MethodCard } from "./types";
export { METHOD_ID_RE } from "./types";
export { builtinMethodCards } from "./cards";
export {
  createMethodLibrary,
  validateCards,
  filterCardShape,
  type MethodLibrary,
  type CardValidationIssue,
} from "./registry";
export {
  renderMethodIndex,
  renderCardDetail,
  INDEX_BUDGET_BYTES,
  DETAIL_BUDGET_BYTES,
} from "./render";
