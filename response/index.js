/**
 * response 模块聚合导出
 * 对外暴露：success / fail / routeNotFound / serializeError
 */
export {
  success,
  fail,
  routeNotFound,
  serializeError,
  buildErrorHtml,
  respondError,
} from "./response.js";

// CODE 字典对外暴露（业务侧 common.CODE 需要）
export { CODE } from "./code.js";
