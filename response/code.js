/**
 * 业务状态码统一规范：与HTTP状态码解耦，0为成功，分段划分错误域
 */

// 业务码-默认提示文案映射
export const CODE = Object.freeze({
  // 成功
  0: "操作成功",
  // 1xxx 通用业务错误
  1001: "认证失败",
  1002: "令牌已过期",
  1003: "权限不足",
  1004: "资源不存在",
  1005: "资源已存在",
  1006: "参数无效",
  1007: "参数缺失",
  1008: "业务处理失败",
  1009: "请求过于频繁",
  1010: "登录设备异常",
  1011: "访问已被限制",
  // 5xxx 系统错误
  5001: "系统内部错误",
  5002: "服务繁忙，请稍后再试",
  // 6xxx 数据库错误
  6001: "数据库连接失败",
  6002: "数据库访问被拒绝",
  6003: "存在关联数据，操作失败",
  6004: "数据库字段错误",
  6005: "数据重复，违反唯一性约束",
  6006: "目标表不存在",
  6007: "数据库操作超时",
  6008: "数据库语法错误，请检查查询语句",
  6009: "数据库连接已关闭，请重试",
});

// 语义化常量（框架内直接引用，避免硬编码数字）
export const CODE_OK = 0;
export const CODE_AUTH_FAILED = 1001;
export const CODE_TOKEN_EXPIRED = 1002;
export const CODE_FORBIDDEN = 1003;
export const CODE_NOT_FOUND = 1004;
export const CODE_CONFLICT = 1005;
export const CODE_PARAM_INVALID = 1006;
export const CODE_PARAM_MISSING = 1007;
export const CODE_BUSINESS_FAIL = 1008;
export const CODE_RATE_LIMIT = 1009;
export const CODE_DEVICE_ERROR = 1010;
export const CODE_BLOCKED = 1011;
export const CODE_SYSTEM_ERROR = 5001;
export const CODE_SERVICE_BUSY = 5002;
export const CODE_DB_CONNECTION_ERROR = 6001;
export const CODE_DB_ACCESS_DENIED = 6002;
export const CODE_DB_OPERATION_TIMEOUT = 6007;

/**
 * 根据业务码获取默认提示文案
 * @param {number} code 业务状态码
 * @param {string} [fallback="操作失败"] 兜底文案
 * @returns {string}
 */
export const getCodeMsg = (code, fallback = "操作失败") => CODE[code] ?? fallback;
