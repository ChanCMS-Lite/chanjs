import cookieParser from "cookie-parser";
import logger from "../utils/logger.js";

/**
 * Cookie解析中间件，支持签名校验
 *
 * 职责边界：本中间件只负责「解析」（含签名校验）；「写入侧」的安全属性
 * （httpOnly / sameSite / secure / maxAge）由业务写入时的 res.cookie(name, value, opts)
 * 决定，框架不越俎代庖。业务侧统一在 app/common/auth-cookie.js 收口：
 * sameSite=prd:strict / dev:lax，secure 可配，httpOnly=false 为统一登录态方案的已确认权衡。
 * @param {express.Application} app Express实例
 * @param {string} [cookieKey] Cookie签名密钥
 */
export const cookie = (app, cookieKey) => {
  !cookieKey && logger.warn("[Cookie] 未配置签名密钥，Cookie无法加密签名");
  app.use(cookieParser(cookieKey));
};