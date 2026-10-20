import { randomBytes } from "crypto";
import pinoHttp from "pino-http";
import { root } from "../utils/logger.js";
import { getIp } from "../utils/ip.js";

// 静态资源：不记日志、不种 cookie
const STATIC = /\.(ico|png|jpe?g|gif|svg|css|js|mjs|woff2?|ttf|eot|map|webp|avif)([?#].*)?$/;

// 一行访问日志：ip=1.2.3.4 sid=xx GET /url 200 13ms
// 框架保持通用：只记框架自己能产生的身份（ip + sid），业务身份（uid 等）与框架无关
const line = (req, res, ms) =>
  [
    `ip=${getIp(req)}`,
    req.sid && `sid=${req.sid}`,
    req.method,
    req.originalUrl || req.url,
    res.statusCode,
    `${ms ?? 0}ms`,
  ]
    .filter(Boolean)
    .join(" ");

// 访问日志：pino-http 官方中间件接管（监听 finish、算耗时、挂 req.log）
// 额外只做 pino-http 不管的一件事：匿名访客 _sid（首访种 30 天 httpOnly cookie，之后按浏览器归人）
export function log(app) {
  app.use((req, res, next) => {
    req.skipLog = STATIC.test(req.originalUrl || req.url);
    if (!req.skipLog) {
      const hasSid = Boolean(req.cookies?._sid);
      req.sid = hasSid ? req.cookies._sid : randomBytes(8).toString("hex");
      // 仅首访无 _sid 时种 cookie（避免每个响应都带 Set-Cookie 头）
      if (!hasSid) {
        res.cookie("_sid", req.sid, { maxAge: 30 * 24 * 3600 * 1000, httpOnly: true, sameSite: "lax" });
      }
    }
    next();
  });

  app.use(
    pinoHttp({
      logger: root,
      autoLogging: { ignore: (req) => req.skipLog },
      customSuccessMessage: line,
      customErrorMessage: (req, res, err, ms) => `${line(req, res, ms)} ${err?.message || ""}`.trim(),
    }),
  );
}
