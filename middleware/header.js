/**
 * 品牌响应头中间件：隐藏原生 Express 标识，统一输出 ChanCMS。
 *
 * 注：安全响应头（X-Content-Type-Options / HSTS / Referrer-Policy /
 * Permissions-Policy / CSP 等）属于宿主业务策略，不在框架层默认设置——
 * 由各项目的 security-headers 中间件统一收敛（本项目见 app/middleware/security-headers.js）。
 * 尤其 CSP frame-ancestors 一旦在框架写死 'self'，会与需要被第三方
 * iframe 嵌入的宿主业务直接冲突，故不在此声明。
 */
export const header = (app, opts = {}) => {
  const appName = opts.APP_NAME || "ChanCMS";
  const appVer = opts.APP_VERSION || "";
  const poweredBy = appVer ? `${appName}/${appVer}` : appName;
  // 静态资源在核心链第 3 步即被接住、到不了本中间件，Express 会默认补
  // X-Powered-By: Express 泄露技术栈——先禁用默认注入，品牌头只由下方显式设置
  app.disable("x-powered-by");

  app.use((_, res, next) => {
    res.setHeader("X-Powered-By", poweredBy);
    next();
  });
};
