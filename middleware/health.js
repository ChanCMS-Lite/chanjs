import logger from "../utils/logger.js";
import { store } from "../storage/index.js";

/**
 * 内置健康检查端点（默认开启）
 *
 * 设计：浅模式零 IO —— 只读进程内已有状态（运行时长 / DB 健康缓存 / 存储层诊断），
 * 不做实时 ping，可被监控系统高频探活而不打数据库。
 * DB 健康缓存由 error-handler 在真实查询成功/失败时维护（markUp/markDown）。
 *
 * 配置（config/index.js）：
 *   health: { enabled: true, path: '/health' }   // 默认值；enabled:false 可整体关闭，path 可改路径
 *
 * HTTP 状态码：健康 → 200；degraded（含内部异常）→ 503。
 *   —— 探针/负载均衡据此摘除故障实例，故 degraded 必须体现为 503。
 *   —— enabled:false 时注册的是透传中间件（不是不注册），保证 app.use() 始终拿到函数。
 *
 * 响应示例：
 *   { "success":true, "code":0, "msg":"ok", "data":{
 *       "status":"ok",            // ok=全部连接健康；degraded=有连接标记为不可用
 *       "uptime":12345,
 *       "db":[{ "name":"default", "healthy":true }],
 *       "store":{ "mode":"memory", ... }
 *   } }
 *   degraded 时：HTTP 503 + { "success":false, "code":5001, "msg":"degraded", ... }
 */

const DEFAULT_PATH = "/health";

export const health = (chan, opts = {}) => {
  // 关闭时必须返回「合法中间件」，不能 return undefined：
  // 调用方 core/bootstrap/middleware.js 是无条件 app.use(health(chan, cfg.health ?? {}))，
  // 返回 undefined 会让 Express 抛 `TypeError: app.use() requires a middleware function`，
  // 且发生在启动阶段 → 进程直接退出（配置项反而变成崩溃开关）。
  if (opts.enabled === false) return (req, res, next) => next();
  const path = opts.path || DEFAULT_PATH;
  const startedAt = Date.now();

  return (req, res, next) => {
    if (req.path !== path) return next();
    try {
      const db = chan.dbManager?.healthSnapshot?.() ?? [];
      const degraded = db.some(d => !d.healthy);
      // 状态码必须反映真实健康度：degraded → 503。
      // 旧实现恒 200，探针/负载均衡无法据此摘除故障实例（degraded 形同无效）。
      res.status(degraded ? 503 : 200).json({
        success: !degraded,
        code: degraded ? 5001 : 0,
        msg: degraded ? "degraded" : "ok",
        data: {
          status: degraded ? "degraded" : "ok",
          uptime: Math.floor((Date.now() - startedAt) / 1000),
          db,
          store: store.getInfo?.() ?? null,
        },
      });
    } catch (err) {
      logger.error(`[Health] 健康检查异常：${err.message}`);
      // 内部异常同样按「不可用」上报，不再伪装成 200
      res.status(503).json({
        success: false,
        code: 5001,
        msg: "degraded",
        data: { status: "degraded", uptime: Math.floor((Date.now() - startedAt) / 1000), db: [], store: null },
      });
    }
  };
};
