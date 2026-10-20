import cors from "cors";

/**
 * CORS跨域中间件，内置安全默认值
 * @param {express.Application} app Express实例
 * @param {cors.CorsOptions} [_cors={}] 自定义跨域配置
 * 默认安全策略：禁止跨域、仅GET/POST、不携带Cookie
 */
export const Cors = (app, _cors = {}) => {
  const safeOptions = {
    origin: _cors.origin ?? false,
    methods: _cors.methods ?? ["GET", "POST"],
    allowedHeaders: _cors.allowedHeaders ?? ["Content-Type", "Authorization"],
    // credentials 用 getter 包裹：每次请求实时求值（支持 _cors.credentials 本身为 getter，
    // 例如随 originList 在 "*" 与具体域名白名单间动态切换）。
    // 背景：W3C 规定 ACAO:* 与 ACAC:true 不能同时出现（CSRF 风险），故当 originList 为 "*"
    // （全放行）时必须 credentials=false；具体域名白名单时 credentials=true（跨域携带 Cookie）。
    get credentials() { return !!_cors.credentials; },
    maxAge: _cors.maxAge ?? 600,
  };
  app.use(cors(safeOptions));
};