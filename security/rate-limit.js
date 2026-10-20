import { isIgnored } from "./checker.js";
import { getIp } from "../utils/ip.js";
import { store } from "../storage/store.js";
import { CODE_RATE_LIMIT } from "../response/code.js";
import logger from "../utils/logger.js";

const TIME_UNIT = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
const DEFAULT_MAX = 60;
const DEFAULT_WINDOW_MS = 60 * 1000;
const KEY_PREFIX = "ratelimit:";

/**
 * 解析限流时间窗口，支持数字毫秒 / 1s/1m/1h/1d 字符串
 */
const parseWindowMs = time => {
  if (typeof time === "number") return time;
  if (typeof time !== "string") return DEFAULT_WINDOW_MS;
  const m = time.match(/^(\d+)([smhd])$/);
  return m ? Number(m[1]) * TIME_UNIT[m[2]] : DEFAULT_WINDOW_MS;
};

/**
 * 限流拦截响应
 */
const deny = (res, retryAfter, msg) =>
  res.status(429).json({ success: false, code: CODE_RATE_LIMIT, msg, data: { retryAfter } });

/**
 * 生成IP+UID双维度限流中间件
 */
export const createRateLimitMiddleware = cfg => {
  const windowMs = parseWindowMs(cfg?.windowMs);
  const max = cfg?.max ?? DEFAULT_MAX;
  const ignorePaths = cfg?.ignorePaths ?? [];

  return async (req, res, next) => {
    try {
      if (isIgnored(req.path, ignorePaths)) return next();

      const ip = getIp(req) || "unknown";
      const uid = req.user?.uid;
      const ipKey = `${KEY_PREFIX}ip:${ip}`;
      // 空字符串为占位 key（批量接口跳过），Redis 模式下单条 Lua 完成双维度计数，一次往返
      const uidKey = uid ? `${KEY_PREFIX}uid:${uid}` : "";

      // 计数自增（批量原子完成限流判定，存储异常 fail-close 拦截）
      const [ipCount, uidCount] = await store.incrAndExpireBatch([ipKey, uidKey], windowMs);

      if (ipCount > max || uidCount > max) {
        const dim = ipCount > max ? "IP" : "UID";
        logger.error(`[WAF限流] path:${req.path} dim:${dim} ipCnt:${ipCount}/${max} uidCnt:${uidCount}/${max} ip:${ip} uid:${uid ?? "-"}`);
        return deny(res, Math.ceil(windowMs / 1000), "请求过于频繁，请稍后重试");
      }
      next();
    } catch (err) {
      logger.error(`[WAF限流异常] path:${req.path} err:${err.message}`);
      // fail-close：存储异常直接拦截
      return res.status(429).json({ success: false, code: CODE_RATE_LIMIT, msg: "限流服务暂时不可用" });
    }
  };
};
