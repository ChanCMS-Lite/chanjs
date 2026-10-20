import express from "express";
import DatabaseManager from "./Database.js";
import { setApp } from "./registry.js";
import { Paths } from "../utils/paths.js";
import { loadConfig } from "./loader.js";
import { store } from "../storage/index.js";
import logger from "../utils/logger.js";
import { AppError, describeError, errorExtraProps } from "./errors.js";
import { register as registerShutdown, shutdown as runShutdown } from "../utils/signal.js";
import { registerCoreMiddleware } from "./bootstrap/middleware.js";
import { loadModuleRouter, loadCommonRouter } from "./bootstrap/router-loader.js";
import { registerErrorHandler } from "./bootstrap/error-handler.js";
import { log } from "../middleware/log.js";
import { runHooks } from "./bootstrap/hook-runner.js";
import { loadDotEnv } from "../config/index.js";
import { event } from "./EventBus.js";
import { initLang } from "./Lang.js";
import Task from "./Task.js";

// 初始化环境变量
loadDotEnv();

/**
 * Chan 应用核心类
 *
 * 聚合框架基础设施：
 * - app/router：Express 实例与路由
 * - dbManager：多连接数据库管理
 * - event：全局事件总线（EventBus 单例）
 * - task：定时任务管理器
 * - lang：i18next 实例（启动时初始化）
 */
export default class Chan {
  constructor() {
    this.app = express();
    this.router = express.Router();
    this.dbManager = new DatabaseManager();

    this.config = null;
    this.paths = Paths;
    this.db = null;
    this.hooks = [];

    // 框架基础设施（全局共享）事件总线单例，任意模块 import { event } from "chanjs" 即同一实例
    this.event = event; 
    // 定时任务管理器，停机时由 signal.js 调用 stopAll()
    this.task = new Task();      
    // i18next 实例，启动流程中初始化
    this.lang = null;            
    // HTTP 服务实例，启动后赋值
    this.server = null;
  }

  /** 完整启动流程 */
  async start() {
    await this.#loadConfig();
    logger.info("[Chan] 配置加载完成");

    await this.#initLang();
    logger.info("[Chan] i18n 初始化完成");

    await this.#initStore();
    logger.info("[Chan] 缓存初始化完成");

    await this.#loadDb();
    logger.info("[Chan] 数据库加载完成");

    setApp(this);
    logger.info("[Chan] 全局应用实例注册完成");

    await this.#regCoreMiddleware();
    logger.info("[Chan] 核心中间件注册完成");

    this.#setupApp();
    log(this.app);   // 访问日志中间件：框架内置，业务侧无感（早于 #mountRouter 以正确计时整请求）
    await this.#loadRoutes();
    this.#mountRouter();
    logger.info("[Chan] 路由加载挂载完成");

    this.#regErrHandler();
    logger.info("[Chan] 全局错误中间件注册完成");

    await this.#runHooks();
    logger.info("[Chan] 启动钩子全部执行完毕");
  }

  /** 注册启动前置钩子 */
  beforeStart(fn) {
    if (typeof fn !== "function") {
      throw new AppError("PARAM_INVALID", "beforeStart 参数必须为函数", 400);
    }
    this.hooks.push(fn);
  }

  /** 执行优雅停机流程 */
  async shutdown() {
    await runShutdown(this);
  }

  /**
   * 启动 HTTP 监听服务
   * @param {(port: number) => void} cb 启动成功回调
   */
  run(cb) {
    const port = Number(this.config.PORT) || 3000;
    this.server = this.app.listen(port, () => {
      logger.info(`[Chan] HTTP服务启动，监听端口：${port}`);
      cb?.(port);
    });
    this.server.on("error", (err) => {
      logger.error(`[Chan] HTTP服务启动失败: ${err.message}`, err);
    });
    registerShutdown(this);
  }

  async #loadConfig() {
    this.config = await loadConfig();
  }

  /**
   * 初始化 i18n
   * - 默认语言：优先配置 LOCALE，否则回退 zh-CN
   * - 失败不阻断启动，降级为仅支持默认语言
   */
  async #initLang() {
    const locale = this.config?.LOCALE || "zh-CN";
    try {
      this.lang = await initLang(locale);
    } catch (err) {
      logger.warn(`[Chan] i18n 初始化失败，降级默认语言：${err.message}`);
    }
  }

  async #initStore() {
    const cfg = this.config;
    try {
      await store.init({
        REDIS_ENABLED: !!cfg?.REDIS_ENABLED,
        REDIS: cfg?.REDIS ?? {}
      });
      if (!cfg?.REDIS_ENABLED) logger.info("[Store] Redis未开启，使用内存缓存");
    } catch (err) {
      logger.warn("[Store] Redis连接失败，自动降级内存缓存");
      logger.error(`[Store] 异常信息：${describeError(err)}${errorExtraProps(err)}`, err);
    }
  }

  async #loadDb() {
    const dbList = this.config?.db ?? [];
    if (!Array.isArray(dbList) || dbList.length === 0) return;

    for (const [idx, dbCfg] of dbList.entries()) {
      const dbKey = dbCfg.key ?? String(idx);
      let conn;
      try {
        conn = await this.dbManager.add(dbKey, dbCfg, { isDefault: idx === 0 });
        // 首个成功连接即作为默认 this.db，避免 idx===0 失败时 this.db 恒为 null
        if (!this.db) this.db = conn;
      } catch (err) {
        logger.error(`[DB] 数据库[${dbKey}]初始化失败：${describeError(err)}${errorExtraProps(err)}`, err);
        continue;
      }

      const ok = await this.dbManager.ping(dbKey);
      ok
        ? logger.info(`[DB] 数据库[${dbKey}]连接正常`)
        : logger.error(`[DB] ⚠️ 数据库[${dbKey}]连通性校验失败，请检查库服务、账号配置`);
    }
    logger.info(`[DB] 数据库初始化结束，共配置${dbList.length}个连接`);
  }

  async #regCoreMiddleware() {
    await registerCoreMiddleware(this);
  }

  /**
   * 配置 Express trust proxy
   * 默认只信任本机回环；生产环境通过 TRUSTED_PROXIES 注入真实上游代理
   * 切勿使用 true（信任任意来源）
   */
  #setupApp() {
    const env = process.env.TRUSTED_PROXIES;
    const trustedProxies = env ? env.split(",").map(s => s.trim()).filter(Boolean) : ["loopback"];
    this.app.set("trust proxy", trustedProxies);
  }

  async #loadRoutes() {
    await loadModuleRouter(this);
    await loadCommonRouter(this);
  }

  #mountRouter() {
    this.app.use(this.router);
  }

  #regErrHandler() {
    registerErrorHandler(this);
  }

  async #runHooks() {
    await runHooks(this);
  }
}
