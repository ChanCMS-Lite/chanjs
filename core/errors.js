import {
  CODE_AUTH_FAILED, CODE_TOKEN_EXPIRED, CODE_FORBIDDEN, CODE_NOT_FOUND,
  CODE_CONFLICT, CODE_PARAM_INVALID, CODE_PARAM_MISSING, CODE_BUSINESS_FAIL,
  CODE_RATE_LIMIT, CODE_BLOCKED, CODE_SYSTEM_ERROR, CODE_SERVICE_BUSY,
  CODE_DB_CONNECTION_ERROR, CODE_DB_ACCESS_DENIED, CODE_DB_OPERATION_TIMEOUT,
} from "../response/code.js";

/** 全局错误配置中心 */
const ERROR_CONFIG = {
  AuthError:         { code: CODE_AUTH_FAILED,           httpStatus: 401, defaultMsg: '认证失败' },
  TokenExpiredError: { code: CODE_TOKEN_EXPIRED,         httpStatus: 401, defaultMsg: '令牌已过期' },
  ForbiddenError:    { code: CODE_FORBIDDEN,             httpStatus: 403, defaultMsg: '权限不足' },
  NotFoundError:     { code: CODE_NOT_FOUND,             httpStatus: 404, defaultMsg: '资源不存在' },
  ConflictError:     { code: CODE_CONFLICT,              httpStatus: 409, defaultMsg: '资源已存在' },
  ValidationError:   { code: CODE_PARAM_INVALID,         httpStatus: 422, defaultMsg: '参数无效', extraProps: ['fields'] },
  ParamMissingError: { code: CODE_PARAM_MISSING,         httpStatus: 400, defaultMsg: '参数缺失' },
  BusinessError:     { code: CODE_BUSINESS_FAIL,         httpStatus: 400, defaultMsg: '业务处理失败' },
  RateLimitError:    { code: CODE_RATE_LIMIT,            httpStatus: 429, defaultMsg: '请求过于频繁', extraProps: ['retryAfter'] },
  BlockedError:      { code: CODE_BLOCKED,               httpStatus: 403, defaultMsg: '访问已被限制', extraProps: ['retryAfter'] },
  SystemError:       { code: CODE_SYSTEM_ERROR,          httpStatus: 500, defaultMsg: '系统内部错误' },
  ServiceBusyError:  { code: CODE_SERVICE_BUSY,          httpStatus: 503, defaultMsg: '服务繁忙' },
  DbConnectionError: { code: CODE_DB_CONNECTION_ERROR,   httpStatus: 503, defaultMsg: '数据库连接失败' },
  DbAccessDeniedError:{ code: CODE_DB_ACCESS_DENIED,     httpStatus: 503, defaultMsg: '数据库访问被拒绝' },
  DbTimeoutError:    { code: CODE_DB_OPERATION_TIMEOUT,  httpStatus: 503, defaultMsg: '数据库操作超时' },
};

const MAX_RECURSIVE_DEPTH = 10;

/**
 * 业务错误基类
 */
export class AppError extends Error {
  /**
   * @param {number} code 业务码
   * @param {string} msg 提示文案
   * @param {number} httpStatus HTTP状态码
   * @param {Error|unknown} [cause] 底层原始错误
   */
  constructor(code, msg, httpStatus = 400, cause = null) {
    super(msg, { cause });
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.meta = {};
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
  }

  /** 自定义序列化 */
  toJSON() {
    const json = { name: this.name, message: this.message, code: this.code, httpStatus: this.httpStatus };
    for (const key of Object.getOwnPropertyNames(this)) {
      const val = this[key];
      if (val === undefined || val === null) continue;
      if (typeof val === 'function' || typeof val === 'symbol') continue;
      json[key] = val;
    }
    return json;
  }
}

/** 动态生成业务错误 Class */
function createErrorClass(className) {
  const cfg = ERROR_CONFIG[className];
  if (!cfg) throw new Error(`错误类型[${className}]未在ERROR_CONFIG中配置`);

  return class extends AppError {
    constructor(msgOrOpts, ...rest) {
      // 支持两种调用方式：
      //   new XxxError("消息")
      //   new XxxError({ msg: "消息", cause: err, ...extraProps })
      let opts;
      if (msgOrOpts && typeof msgOrOpts === 'object') {
        opts = msgOrOpts;
      } else {
        opts = { msg: msgOrOpts };
        // 将 extraProps 按顺序映射到 rest 参数
        if (cfg.extraProps) {
          cfg.extraProps.forEach((key, i) => {
            if (rest[i] !== undefined) opts[key] = rest[i];
          });
          // extraProps 之后的参数视为 cause
          const causeIdx = cfg.extraProps.length;
          if (rest[causeIdx] !== undefined) opts.cause = rest[causeIdx];
        } else if (rest[0] !== undefined) {
          opts.cause = rest[0];
        }
      }

      super(cfg.code, opts.msg ?? cfg.defaultMsg, cfg.httpStatus, opts.cause ?? null);
      this.name = className;
      // 挂载额外属性（如 fields / retryAfter）
      for (const [k, v] of Object.entries(opts)) {
        if (k !== 'msg' && k !== 'cause' && v !== undefined) this[k] = v;
      }
    }
  };
}

// 业务错误类导出
export const AuthError          = createErrorClass('AuthError');
export const TokenExpiredError  = createErrorClass('TokenExpiredError');
export const ForbiddenError     = createErrorClass('ForbiddenError');
export const NotFoundError      = createErrorClass('NotFoundError');
export const ConflictError      = createErrorClass('ConflictError');
export const ValidationError    = createErrorClass('ValidationError');
export const ParamMissingError  = createErrorClass('ParamMissingError');
export const BusinessError      = createErrorClass('BusinessError');
export const RateLimitError     = createErrorClass('RateLimitError');
export const BlockedError       = createErrorClass('BlockedError');
export const SystemError        = createErrorClass('SystemError');
export const ServiceBusyError   = createErrorClass('ServiceBusyError');
export const DbConnectionError  = createErrorClass('DbConnectionError');
export const DbAccessDeniedError= createErrorClass('DbAccessDeniedError');
export const DbTimeoutError     = createErrorClass('DbTimeoutError');

/**
 * 提取错误自定义附加属性，用于日志打印
 */
export function errorExtraProps(err) {
  if (!err || !(err instanceof Error)) return "";
  const parts = [];
  for (const k of Object.getOwnPropertyNames(err)) {
    if (k === "message" || k === "stack" || k === "name" || k === "cause" || k === "constructor") continue;
    const val = err[k];
    if (typeof val === 'function' || typeof val === 'symbol') continue;
    try {
      parts.push(`${k}=${typeof val === "string" ? val : JSON.stringify(val)}`);
    } catch {
      parts.push(`${k}=[unserializable]`);
    }
  }
  return parts.length ? ` | ${parts.join("; ")}` : "";
}

/**
 * 递归解析完整可读错误信息，内置递归深度限制防栈溢出
 */
export function describeError(err, depth = 0) {
  if (!err) return "未知错误";
  if (depth >= MAX_RECURSIVE_DEPTH) return `[递归深度超限(${MAX_RECURSIVE_DEPTH})，停止解析]`;

  // 聚合错误批量展开子错误
  if (err instanceof AggregateError && Array.isArray(err.errors) && err.errors.length) {
    const reasons = err.errors
      .map((e, i) => `    [${i + 1}] ${describeError(e, depth + 1)}`)
      .join("\n");
    return `聚合错误(AggregateError)共${err.errors.length}个原因：\n${reasons}`;
  }

  const baseMsg = err.message || String(err);
  let hint = baseMsg;

  // 数据库/网络错误智能提示
  if (/ECONNREFUSED/.test(baseMsg)) {
    hint = `数据库连接被拒绝(ECONNREFUSED) — 检查数据库服务、地址端口配置: ${baseMsg}`;
  } else if (/ENOTFOUND|EAI_AGAIN/.test(baseMsg)) {
    hint = `数据库域名解析失败 — 检查DB_HOST环境变量: ${baseMsg}`;
  } else if (/ECONNRESET|PROTOCOL_CONNECTION_LOST|ETIMEDOUT/.test(baseMsg)) {
    hint = `数据库连接中断/超时 — 检查服务状态、连接池上限: ${baseMsg}`;
  }

  const causeText = err.cause
    ? err.cause instanceof Error
      ? ` | cause: ${describeError(err.cause, depth + 1)}`
      : ` | cause: ${String(err.cause)}`
    : "";

  return `${hint}${causeText}${errorExtraProps(err)}`;
}

/** 全局判断业务错误 */
export function isAppError(err) {
  return err instanceof AppError;
}

/**
 * 判断是否为数据库连接类错误（code + message 双重检测）
 */
const CONNECTION_CODES = new Set([
  "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT",
  "ECONNRESET", "PROTOCOL_CONNECTION_LOST", "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
]);
const CONNECTION_KEYWORDS = [
  "econnrefused", "enotfound", "eai_again", "etimedout", "econnreset",
  "connection lost", "connection closed", "pool is full", "too many connections",
  "closed unexpectedly", "connect timeout", "handshake timeout",
];

function isDbConnectionError(err) {
  if (CONNECTION_CODES.has(err?.code)) return true;
  const msg = String(err?.message || "").toLowerCase();
  return CONNECTION_KEYWORDS.some(kw => msg.includes(kw));
}

/**
 * DB / 底层异常统一拦截器：转换为框架标准 AppError 子类
 * @param {Error} err
 * @returns {AppError}
 */
export function wrapDbError(err) {
  if (isAppError(err)) return err;

  // 聚合错误（mysql2 批量操作）提取首个真实原因
  let e = err;
  if (err instanceof AggregateError && Array.isArray(err.errors) && err.errors.length) {
    e = err.errors.find(x => x instanceof Error) ?? err.errors[0];
  }

  if (isDbConnectionError(e)) return new DbConnectionError("数据库连接失败，请稍后重试", err);

  // 模板/视图渲染错误：Express 的 res.render 找不到模板时抛出
  const errMsg = String(e?.message || "").toLowerCase();
  if (errMsg.includes("failed to lookup view") || errMsg.includes("no default engine")) {
    return new SystemError("模板渲染异常：" + (e?.message || "视图文件不存在"), err);
  }

  const driverCode = e?.code;
  switch (driverCode) {
    case "ER_DUP_ENTRY":
    case "23505":
      return new ConflictError("数据已存在", err);
    case "ER_ACCESS_DENIED_ERROR":
      return new DbAccessDeniedError("数据库访问被拒绝", err);
    case "ER_NO_SUCH_TABLE":
      return new SystemError("数据表不存在", err);
    case "ER_BAD_FIELD_ERROR":
      return new ParamMissingError("数据库字段错误", err);
    case "ER_ROW_IS_REFERENCED_2":
      return new ConflictError("存在关联数据，操作失败", err);
    default:
      return new SystemError("数据操作异常", err);
  }
}

/** 解析 V8 堆栈，提取报错文件、行号 */
export function parseStack(stack) {
  if (!stack || typeof stack !== "string") {
    return { message: "无堆栈信息", file: "-", line: "-" };
  }
  const lines = stack.split("\n").filter(Boolean);
  const message = lines[0];
  const traceLine = lines[1] ?? "";
  const match = traceLine.match(/\(([^:]+):(\d+):\d+\)/) || traceLine.match(/at\s+([^:]+):(\d+):\d+/);
  if (match) return { message, file: match[1], line: match[2] };
  return { message, file: traceLine.trim(), line: "-" };
}
