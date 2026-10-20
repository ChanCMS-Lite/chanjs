import fs from "fs";
import path from "path";
import { Router } from "express";
import { importFile } from "../loader.js";
import logger from "../../utils/logger.js";

/**
 * 加载路由公共逻辑：导入并执行路由注册函数
 * @param {string} filePath 路由文件完整路径
 * @param {object} app Express实例
 * @param {object} router 顶层路由
 * @param {object} config 全局配置
 */
async function registerRouterFile(filePath, app, router, config) {
  if (!fs.existsSync(filePath)) return;
  try {
    const register = await importFile(filePath);
    if (typeof register === "function") {
      await register(app, router, config);
    }
  } catch (err) {
    // 详情必须拼进 msg 本身：logger 的 messageFormat 仅输出 msg 字段，第二参数会被 pino-pretty 忽略导致错误原因丢失
    logger.error(`[RouterLoader] 路由文件加载失败: ${filePath}\n${err?.stack || err}`);
  }
}

/**
 * 统计 Express 全局路由栈层数（用于检测模块是否真的挂载了路由）
 * Express 5 的 app.router 为 Router 实例，stack 可访问；异常环境返回 null 跳过检测
 */
function countAppLayers(app) {
  try {
    return app?.router?.stack?.length ?? null;
  } catch {
    return null;
  }
}

/**
 * 加载 modules 业务模块路由，按配置顺序挂载
 * 顺序完全遵循 config.modules 声明顺序（框架不再隐式重排），
 * 含动态兜底路由的模块（如 web）应自行在配置中放在末位。
 * @param {object} chan 框架实例
 */
export async function loadModuleRouter(chan) {
  const { paths, config, app, router } = chan;
  const modulesDir = paths.modulesPath;
  if (!fs.existsSync(modulesDir)) return;

  const moduleNames = config.modules ?? [];
  for (const name of moduleNames) {
    const routeFile = path.join(modulesDir, name, "router.js");
    // 每个模块使用独立的子 Router 实例，防止模块内 router.use(auth()) 等无路径前缀
    // 的中间件污染全局，导致未匹配路径（如 404）被提前拦截成鉴权错误。
    const subRouter = Router();
    const layersBefore = countAppLayers(app);
    await registerRouterFile(routeFile, app, subRouter, config);
    // 挂载责任在模块作者（app.use(prefix, router)），但静默失效代价太高：
    // 注册前后全局路由栈无增长即视为忘挂载，启动期直接告警。
    const layersAfter = countAppLayers(app);
    if (layersBefore !== null && layersAfter !== null && layersAfter === layersBefore) {
      logger.warn(`[RouterLoader] 模块 "${name}" 未向 app 注册任何路由（缺少 app.use(prefix, router)?），该模块路由未生效`);
    }
  }
}

/**
 * 加载项目根公共路由 router.js
 * @param {object} chan 框架实例
 */
export async function loadCommonRouter(chan) {
  const { paths, app, router, config } = chan;
  const commonRouteFile = path.join(paths.appPath, "router.js");
  await registerRouterFile(commonRouteFile, app, router, config);
}