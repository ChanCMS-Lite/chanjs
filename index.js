/**
 * chanjs 包入口
 *
 * 默认导出：Chan 应用主类
 *   import Chan from "chanjs";
 *   const chan = new Chan();
 *   await chan.start();
 *
 * 命名导出：
 *   import { Controller, Repository, Service, cache, Paths, loader, utils, getApp } from "chanjs";
 *   import { validate, validateAll } from "chanjs";  // zod 校验中间件
 *   import { AppError, NotFoundError, ValidationError } from "chanjs";  // 错误类
 *   import { event, EventBus, Task, initLang } from "chanjs";  // 基础设施
 *
 * 多实例：
 *   每个 Chan 实例持有独立 config/db/paths/dbManager（注册表管理），
 *   业务代码统一通过 getApp() 或 this.app（Controller/Service 内）访问当前实例。
 */

// ===================== 核心基础类 =====================
export { BaseComponent } from "./core/BaseComponent.js";
export { default as Controller } from "./core/Controller.js";
export { default as Repository } from "./core/Repository.js";
export { Service } from "./core/Service.js";
// 查询条件组装原语（通用搜索基建：URL 平铺参数 → knex 安全 where）
export { applyQuery, mapUrlFilters } from "./core/Repository.js";
export { escapeLike } from "./utils/escape.js";

// ===================== 基础设施（事件总线 / 定时任务 / i18n）=====================
export { EventBus, event } from "./core/EventBus.js";
export { default as Task } from "./core/Task.js";
export { initLang } from "./core/Lang.js";

// ===================== 错误体系 =====================
export {
  AppError, AuthError, TokenExpiredError, ForbiddenError,
  NotFoundError, ConflictError, ValidationError, ParamMissingError,
  BusinessError, RateLimitError, BlockedError, SystemError, ServiceBusyError,
  describeError, errorExtraProps, parseStack, isAppError, wrapDbError,
} from "./core/errors.js";

// ===================== 统一响应工具（纯函数，可复用于接口 / 定时任务 / RPC）=====================
export { success, fail, routeNotFound, serializeError, buildErrorHtml, respondError } from "./response/index.js";

// ===================== 业务状态码 =====================
export {
  CODE,
  getCodeMsg,
  CODE_OK,
  CODE_AUTH_FAILED,
  CODE_TOKEN_EXPIRED,
  CODE_FORBIDDEN,
  CODE_NOT_FOUND,
  CODE_CONFLICT,
  CODE_PARAM_INVALID,
  CODE_PARAM_MISSING,
  CODE_BUSINESS_FAIL,
  CODE_RATE_LIMIT,
  CODE_DEVICE_ERROR,
  CODE_BLOCKED,
  CODE_SYSTEM_ERROR,
  CODE_SERVICE_BUSY,
  CODE_DB_CONNECTION_ERROR,
  CODE_DB_ACCESS_DENIED,
  CODE_DB_OPERATION_TIMEOUT,
} from "./response/code.js";

// ===================== 安全工具 =====================
export { setToken, getToken, verifyToken, revokeToken } from "./security/jwt.js";
export { aesEncrypt, aesDecrypt } from "./security/sign.js";
export { createRateLimitMiddleware } from "./security/rate-limit.js";
export { filterXSS, checkKeywords } from "./security/index.js";

// ===================== 统一日志 =====================
export { default as logger } from "./utils/logger.js";

// ===================== 校验中间件 =====================
export { validate, validateAll } from "./middleware/validate.js";

// ===================== 应用实例（单实例）=====================
export { setApp, getApp } from "./core/registry.js";

// ===================== 命名空间导出（业务侧 router/service 使用）=====================
export * as loader from "./core/loader.js";
export * as utils from "./utils/index.js";

// ===================== 常用工具直接导出 =====================
export { cache, store } from "./storage/index.js";
export { Paths } from "./utils/paths.js";

// ===================== 默认导出应用主类 =====================
import Chan from "./core/App.js";
export default Chan;
