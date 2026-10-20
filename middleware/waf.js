import { getIp } from "../utils/ip.js";
import { checkKeywords, isIgnored } from "../security/checker.js";
import { filterXSS } from "../security/xss-filter.js";
import { createRateLimitMiddleware } from "../security/rate-limit.js";
import { CODE_BLOCKED } from "../response/code.js";
import logger from "../utils/logger.js";

const WAF_PATH_WHITELIST = [
  "/.well-known/appspecific/",
  "/.well-known/change-password",
  "/favicon.ico",
  "/robots.txt",
  "/llms.txt",
  "/sitemap.xml",
];

// waf 配置合法键集合：启动期校验，未知键打 warn，防配置漂移静默失效
const WAF_KNOWN_KEYS = new Set(["enabled", "rateLimit", "ignorePaths", "bodyXssPaths"]);

const TRUSTED_IPS = new Set(["127.0.0.1", "::1"]);

// URL/query 关键词检测只保留真正危险、几乎不会在正常 URL 中出现的攻击特征，
// 避免 ?debug=1、/internal/、/.well-known/、wget/scp/dd 等正常请求被误伤。
const URL_SCAN_CATEGORIES = ["sqlInjection", "xss", "pathTraversal", "encoding"];

/**
 * 判断本机回环可信IP：仅 127.0.0.1 / ::1 无条件放行 WAF 的 query 关键词检测与 XSS 净化。
 * 不再放行整个内网段（如 10.x、192.168.x、172.16-31.x），
 * 否则当 Nginx 部署在另一台内网机、Express 未解析 XFF 时，全站 WAF 会静默失效。
 */
const isTrustedIp = ip => {
  if (!ip) return false;
  return TRUSTED_IPS.has(ip);
};

/**
 * 路径白名单匹配
 */
const isWhitelistedPath = path => WAF_PATH_WHITELIST.some(p => path === p || path.startsWith(p));

/**
 * 覆盖Express5只读req.query
 */
const overrideQuery = (req, cleanQuery) => {
  Object.defineProperty(req, "query", {
    value: cleanQuery,
    writable: true,
    enumerable: true,
    configurable: true,
  });
};

/**
 * 统一 WAF 拦截响应
 */
const respondWaf = (res, status, msg, data) =>
  res.status(status).json({ code: CODE_BLOCKED, success: false, msg, data });

/**
 * 限流，返回是否已响应
 */
const runRateLimit = (rateLimit, req, res) =>
  new Promise(resolve => rateLimit(req, res, resolve)).then(() => res.headersSent);

/**
 * 前置WAF中间件（body前）
 */
const createWafMiddleware = wafConfig => {
  // ignorePaths 统一读 waf 层级（限流跳过 + 关键词检测跳过共用一份），
  // 不再从 rateLimit 子对象读取，避免两级同名配置断链静默失效
  const ignorePaths = Array.isArray(wafConfig.ignorePaths) ? wafConfig.ignorePaths : [];
  const rateLimit = createRateLimitMiddleware({ ...(wafConfig.rateLimit ?? {}), ignorePaths });

  // 启动期配置自检：未知键提示，防「配置写了但框架不认」的漂移
  for (const key of Object.keys(wafConfig ?? {})) {
    if (!WAF_KNOWN_KEYS.has(key)) {
      logger.warn(`[waf] 未识别的配置项 "${key}"，已忽略（合法键：${[...WAF_KNOWN_KEYS].join("/")}）`);
    }
  }

  return async (req, res, next) => {
    try {
      if (!wafConfig.enabled) return next();

      const clientIp = getIp(req);
      const path = req.path || "";
      const whitePath = isWhitelistedPath(path) || isIgnored(path, ignorePaths);

      // 可信IP直接放行，仅做query XSS过滤
      if (isTrustedIp(clientIp)) {
        if (req.query && Object.keys(req.query).length) overrideQuery(req, filterXSS(req.query));
        return next();
      }

      // 限流
      if (await runRateLimit(rateLimit, req, res)) return;

      // 白名单路径跳过关键词检测
      if (whitePath) {
        if (req.query && Object.keys(req.query).length) overrideQuery(req, filterXSS(req.query));
        return next();
      }

      // 路径+query拼接检测恶意关键词（仅保留真正危险分类，避免 debug/secret/internal/.env 等正常词误伤）
      let checkText = path;
      if (Object.keys(req.query ?? {}).length) {
        const queryStr = Object.entries(req.query).map(([k, v]) => `${k}=${v}`).join(" ");
        checkText += ` ${queryStr}`;
      }
      const hit = checkKeywords(checkText, { categories: URL_SCAN_CATEGORIES });
      if (hit) {
        const { keyword, category } = hit;
        logger.error(`[WAF拦截-URL] IP:${clientIp} Path:${path} Key:${keyword} Type:${category}`);
        // 仅当次拦截，不再累计封禁 IP（避免误报把整 IP 锁 30 分钟）
        return respondWaf(res, 403, "检测到非法内容，请求已被拦截");
      }

      // query XSS净化
      try {
        if (req.query && Object.keys(req.query).length) overrideQuery(req, filterXSS(req.query));
      } catch (e) {
        logger.error(`[WAF警告] query过滤失败 IP:${clientIp} Err:${e.message}`);
      }

      next();
    } catch (err) {
      logger.error(`[WAF前置异常] IP:${getIp(req)} Msg:${err.message}`, err.stack);
      return respondWaf(res, 403, "安全检查异常，请求被拒绝");
    }
  };
};

/**
 * Body层WAF中间件（body解析后）
 */
const createWafBodyMiddleware = wafConfig => {
  const ignorePaths = Array.isArray(wafConfig.ignorePaths) ? wafConfig.ignorePaths : [];
  // body XSS 白名单：仅这些路径前缀的请求体做 XSS 过滤；默认空 = 全部不过滤
  const bodyXssPaths = Array.isArray(wafConfig.bodyXssPaths) ? wafConfig.bodyXssPaths : [];
  return async (req, res, next) => {
    try {
      if (!wafConfig.enabled) return next();
      const path = req.path || "";
      if (isWhitelistedPath(path) || isIgnored(path, ignorePaths)) return next();

      const clientIp = getIp(req);
      const contentType = req.headers["content-type"]?.toLowerCase() || "";
      // 上传文件跳过body文本检测
      if (contentType.includes("multipart/form-data")) return next();
      // 空body直接放行
      if (!req.body || (typeof req.body === "object" && !Object.keys(req.body).length)) return next();

      // 请求体关键词拦截已移除：
      // 项目 DB 全部走 knex 参数化查询（天然防 SQL 注入），后端也无任何
      // 把用户输入交给 shell 执行的路径；而关键词扫描对留言/评论/注册等正常正文
      // 误报极高（drop / select / alert / onclick 等普通词都会被拦），代价远大于收益。
      // SQL 注入由参数化查询负责。

      // body XSS 过滤（按需开启）：默认不过滤任何接口的请求体。
      // 全局默认过滤会静默改写入库内容（剥离 style、转义 iframe/script 等），
      // 导致后台富文本编辑器的排版/特效无法保存。需要防护的接口
      // （如会员注册、留言、评论等公开 UGC 写入）由项目在 bodyXssPaths 里声明。
      if (bodyXssPaths.length && typeof req.body === "object" && isIgnored(path, bodyXssPaths)) {
        try {
          req.body = filterXSS(req.body);
        } catch (e) {
          logger.error(`[WAF警告] body过滤失败 IP:${clientIp} Err:${e.message}`);
        }
      }

      next();
    } catch (err) {
      logger.error(`[WAF Body异常] IP:${getIp(req)} Msg:${err.message}`);
      return respondWaf(res, 403, "安全检查异常，请求被拒绝");
    }
  };
};

/**
 * 注册WAF前置中间件（body前）
 */
export const waf = (app, config) => app.use(createWafMiddleware(config));

/**
 * 注册WAF Body中间件（body后）
 */
export const wafBody = (app, config) => app.use(createWafBodyMiddleware(config));
