import jwt from "jsonwebtoken";
import { store } from "../storage/store.js";
import logger from "../utils/logger.js";

const REVOKED_KEY_PREFIX = "jwt:revoked:";
const ALLOWED_ALGORITHMS = ["HS256"];

const JWT_ERR_MSG = {
  TokenExpiredError: "令牌已过期",
  JsonWebTokenError: "无效的令牌",
  default: "令牌验证失败",
};

/**
 * 黑名单校验失败策略配置
 * failOpen=true（默认）：存储异常时放行（优先可用性）
 * failOpen=false：存储异常时拦截（优先安全性，适用于金融/权限敏感场景）
 * 可通过环境变量 JWT_REVOCATION_FAIL_CLOSE=true 全局切换为 fail-close
 */
const IS_FAIL_CLOSE = process.env.JWT_REVOCATION_FAIL_CLOSE === "true";

/**
 * 校验token是否在黑名单
 * fail-close 模式：存储异常视为已注销（拦截）
 * fail-open  模式：存储异常视为未注销（放行）
 */
const isTokenRevoked = async token => {
  if (!token) return false;
  try {
    return !!await store.get(`${REVOKED_KEY_PREFIX}${token}`);
  } catch (err) {
    if (IS_FAIL_CLOSE) {
      logger.warn(`[JWT] 黑名单查询异常，fail-close 拦截：${err.message}`);
      return true;
    }
    logger.warn(`[JWT] 黑名单查询异常，fail-open 放行：${err.message}`);
    return false;
  }
};

/**
 * 签发JWT令牌
 * @param {object} data 载荷数据
 * @param {string} secretKey 签名密钥
 * @param {string} [expire='7d'] 有效期
 * @returns {string|null}
 */
export const setToken = (data = {}, secretKey, expire = "7d") => {
  if (!secretKey) {
    logger.error("[安全错误] JWT_SECRET 未配置");
    return null;
  }
  try {
    return jwt.sign(data, secretKey, { algorithm: "HS256", expiresIn: expire });
  } catch (err) {
    logger.error("令牌生成失败", err.message);
    return null;
  }
};

/**
 * 校验并解析JWT，先校验黑名单
 * @param {string} token
 * @param {string} secretKey
 * @returns {Promise<{valid:boolean, reason:string, payload?:object, error?:Error}>}
 */
export const verifyToken = async (token, secretKey) => {
  if (!secretKey) return { valid: false, reason: "missing_secret" };
  if (!token) return { valid: false, reason: "missing" };

  // 先验签（无效/过期/伪造 token 不查 Redis）
  let payload;
  try {
    payload = await new Promise((resolve, reject) => {
      jwt.verify(token, secretKey, { algorithms: ALLOWED_ALGORITHMS }, (err, decoded) => {
        err ? reject(err) : resolve(decoded);
      });
    });
  } catch (err) {
    const reason = err.name === "TokenExpiredError" ? "expired" : "invalid";
    logger.error(JWT_ERR_MSG[err.name] ?? JWT_ERR_MSG.default, err.message);
    return { valid: false, reason, error: err };
  }

  // 签名合法后再查黑名单
  if (await isTokenRevoked(token)) {
    logger.error("[安全拦截] 令牌已注销");
    return { valid: false, reason: "revoked" };
  }
  return { valid: true, reason: "ok", payload };
};

/**
 * 校验并解析JWT，成功返回载荷
 */
export const getToken = async (token, secretKey) => {
  const { valid, payload } = await verifyToken(token, secretKey);
  return valid ? payload : null;
};

/**
 * 注销令牌，加入黑名单
 * @param {string} token
 * @param {number} ttl 令牌剩余有效毫秒数
 * @returns {Promise<boolean>}
 */
export const revokeToken = async (token, ttl) => {
  if (!token) return false;
  if (!ttl || ttl <= 0) {
    logger.info("[JWT] token 已过期或无剩余有效期，无需注销");
    return true;
  }
  try {
    await store.set(`${REVOKED_KEY_PREFIX}${token}`, 1, ttl);
    return true;
  } catch (err) {
    logger.error("令牌注销失败", err.message);
    return false;
  }
};
