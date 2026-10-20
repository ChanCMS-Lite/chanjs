import knex from "knex";
import logger from "../utils/logger.js";

const DEFAULT_NAME = "default";
const DEFAULT_SLOW_THRESHOLD = 200;  // 慢查询阈值（ms），可运行时调整

/**
 * 自定义 dialect 别名 → 客户端类（异步工厂）。
 * config 中 client 只写字符串（如 "sqlite"），由框架在此按类型自动挂载驱动，
 * 业务侧无需 import 客户端实现。
 * 必须动态 import：sqlite 适配器依赖内建模块 node:sqlite（Node 22+），
 * 静态引入会在 ESM 加载期解析导致低版本 Node 连 mysql/pg 也无法启动。
 */
const CUSTOM_CLIENTS = Object.freeze({
  sqlite: () => import("./adaptor/sqliteAdapter.js").then((m) => m.default),
});

/** 把配置中的方言字符串解析为 knex 客户端类（按需加载；无匹配则原样返回） */
async function resolveClient(config) {
  if (config && typeof config.client === "string") {
    const loader = CUSTOM_CLIENTS[config.client];
    if (loader) {
      const Client = await loader();
      return { ...config, client: Client };
    }
  }
  return config;
}

/**
 * 多 Knex 连接管理器：统一管理连接、心跳、批量销毁、慢查询监控。
 *
 * - 连接注册：首个连接或 isDefault=true 自动设为默认
 * - 健康缓存：error-handler 实时更新，鉴权层廉价区分「未登录」与「库挂了」
 * - 慢查询：监听 knex query 事件，超过阈值记 warn 日志（含 SQL 与耗时）
 * - 错误监控：监听 query-error 事件，记录失败 SQL 便于排查
 */
class DatabaseManager {
  constructor() {
    /** @type {Map<string, import("knex").Knex>} */
    this._connections = new Map();
    this._defaultName = DEFAULT_NAME;
    /** 健康缓存：运行时由 error-handler 实时更新 */
    this._health = new Map();
    /** 慢查询阈值（ms），超过则记 warn 日志 */
    this._slowThreshold = DEFAULT_SLOW_THRESHOLD;
  }

  /**
   * 设置慢查询阈值（运行时动态调整）
   * @param {number} ms - 阈值毫秒数
   */
  setSlowThreshold(ms) {
    if (typeof ms === "number" && ms > 0) this._slowThreshold = ms;
  }

  /**
   * 添加数据库连接，首个连接 / isDefault=true 自动设为默认
   * @param {string} name - 连接标识
   * @param {object} config - Knex 配置
   * @param {{isDefault?: boolean}} [opts]
   * @returns {Promise<import("knex").Knex>}
   */
  async add(name, config, { isDefault = false } = {}) {
    const conn = knex(await resolveClient(config));
    this._connections.set(name, conn);
    if (isDefault || this._connections.size === 1) this._defaultName = name;

    // 挂载慢查询与错误监控（按连接隔离，互不影响）
    this._attachMonitoring(name, conn);
    return conn;
  }

  /**
   * 挂载 knex 事件监控
   * - query: 记录 SQL 执行起点（键用 __knexQueryUid 查询唯一 ID，避免同连接串行查询互相覆盖）
   * - query-response: 计算耗时，超阈值记慢查询日志
   * - query-error: 记录失败 SQL 与错误信息
   * @private
   */
  _attachMonitoring(name, conn) {
    const startTimes = new Map();
    // 容量保护：异常路径下残留的计时起点累积到上限即清空，防 Map 无界增长
    const MAX_PENDING = 5000;

    conn.on("query", (data) => {
      if (startTimes.size >= MAX_PENDING) startTimes.clear();
      startTimes.set(data.__knexQueryUid, Date.now());
    });

    conn.on("query-response", (_response, data) => {
      const startedAt = startTimes.get(data.__knexQueryUid);
      if (!startedAt) return;
      startTimes.delete(data.__knexQueryUid);

      const elapsed = Date.now() - startedAt;
      if (elapsed >= this._slowThreshold) {
        logger.warn(`[Database] 慢查询 ${name} ${elapsed}ms: ${data.sql}`);
      }
    });

    conn.on("query-error", (err, data) => {
      startTimes.delete(data?.__knexQueryUid);
      logger.error(`[Database] 查询失败 ${name}: ${data?.sql || ""}`, err);
    });
  }

  /**
   * 获取指定连接，不存在抛异常
   * @param {string} [name=this._defaultName]
   * @returns {import("knex").Knex}
   */
  get(name = this._defaultName) {
    const conn = this._connections.get(name);
    if (!conn) throw new Error(`Database connection "${name}" not found`);
    return conn;
  }

  /** 批量关闭全部连接，单个失败不阻断其他 */
  async closeAll() {
    const results = [];
    for (const [name, conn] of this._connections) {
      try {
        await conn.destroy();
        results.push({ name, success: true });
      } catch (err) {
        results.push({ name, success: false, error: err.message });
        logger.error(`[Database] 关闭连接 ${name} 失败`, err);
      }
    }
    this._connections.clear();
    logger.info(`[Database] 全部连接关闭完成，总计 ${results.length} 个`);
    return results;
  }

  /**
   * 心跳探测，SELECT 1 校验连通性（启动时 + 运行时按需调用）
   * @param {string} [name=this._defaultName]
   * @returns {boolean}
   */
  async ping(name = this._defaultName) {
    const conn = this._connections.get(name);
    if (!conn) {
      this._health.set(name, false);
      return false;
    }
    try {
      await conn.raw("SELECT 1");
      this._health.set(name, true);
      return true;
    } catch (err) {
      this._health.set(name, false);
      logger.error(`[Database] ping ${name} 连通校验失败`, err);
      return false;
    }
  }

  /** 运行时主动标记连接不可用（error-handler 捕获 DB 异常时调用） */
  markDown(name = this._defaultName) {
    this._health.set(name, false);
  }

  /** 运行时标记连接恢复可用（error-handler 捕获业务成功响应时调用） */
  markUp(name = this._defaultName) {
    this._health.set(name, true);
  }

  /**
   * 健康快照（/health 端点用）：读缓存状态，不做实时 IO
   * @returns {{name:string, healthy:boolean}[]}
   */
  healthSnapshot() {
    return [...this._connections.keys()].map(name => ({
      name,
      healthy: this._health.get(name) ?? false,
    }));
  }
}

export default DatabaseManager;
