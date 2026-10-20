import {
  Cors, body, cookie, favicon, header,
  staticMw, template, waf, wafBody, log,
} from "../../middleware/index.js";
import { health } from "../../middleware/health.js";
import { BODY_LIMIT } from "../../config/index.js";

/**
 * 注册核心中间件（顺序固化：不可随意调整）
 * WAF 前置 → 健康检查 → Favicon → 静态 → CORS → Cookie → Body 解析 → WAF Body 检查 → 日志 → 模板 → 响应头
 * @param {object} chan 框架实例
 */
export async function registerCoreMiddleware(chan) {
  const { app, config: cfg } = chan;

  // 1. WAF 前置（IP/封禁/限流/路径与 query 检查，不依赖请求体）
  await waf(app, cfg.waf ?? { enabled: false });
  // 1.5 健康检查端点（默认开启，config.health = {enabled,path} 可调；浅模式零 IO）
  app.use(health(chan, cfg.health ?? {}));
  // 2. Favicon
  favicon(app);
  // 3. 静态资源
  staticMw(app, cfg.statics ?? []);
  // 3.5 CORS（前移到 body 之前：OPTIONS 预检无需等待 body 解析即返回；
  //      WAF 拦截预检时响应也能携带 CORS 头，浏览器报错不再误导排障）
  Cors(app, cfg.cors ?? {});
  // 4. Cookie
  cookie(app, cfg.cookieKey);
  // 5. 请求体解析
  body(app, cfg.BODY_LIMIT ?? BODY_LIMIT);
  // 5.1 WAF Body 检查（须在 body 解析之后）
  wafBody(app, cfg.waf ?? { enabled: false });
  // 7. 请求日志
  log(app, cfg.logger ?? {});
  // 8. 模板渲染（NODE_ENV 兜底 production：与「默认生产口径」约束一致，生产默认开启模板缓存）
  template(app, { views: cfg.views ?? [], NODE_ENV: cfg.NODE_ENV ?? "production" });
  // 9. 响应头
  header(app, { APP_NAME: cfg.APP_NAME ?? "ChanCMS", APP_VERSION: cfg.APP_VERSION ?? "1.0.0" });
}
