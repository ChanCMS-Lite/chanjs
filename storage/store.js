import { cache, DEFAULT_INCR_TTL } from "./cache.js";
import RedisBackend from "./redis.js";
import logger from "../utils/logger.js";

export { DEFAULT_INCR_TTL };

// Redis 故障日志防抖间隔：避免高频失败时刷屏
const FALLBACK_LOG_COOLDOWN = 1000;
// 熔断触发阈值：Redis 连续失败次数达到此值进入熔断
const CIRCUIT_THRESHOLD = 5;
// 熔断冷却时长：熔断开启后此段时间内所有请求直接走内存
const CIRCUIT_COOLDOWN = 30000;

/**
 * 内存缓存适配器
 * 内部 LRU Cache 是同步方法，对外统一包装为 Promise/async 风格，
 * 保持与 RedisAdapter 接口形状一致，让 Store 内部用同一套 _safeExec 调度。
 */
class MemoryAdapter {
  constructor(instance = cache) { this._cache = instance; }

  /** 读取缓存值，无值返回 null */
  get(key) { return this._cache.get(key); }

  /**
   * 写入缓存
   * @param {string} key 键
   * @param {*} val 值
   * @param {number} [ttlMs=60000] 过期时间（毫秒）
   * @returns {boolean} 写入成功
   */
  set(key, val, ttlMs = 60000) { this._cache.set(key, val, ttlMs); return true; }

  /** 删除指定 key */
  del(key) { return this._cache.del(key); }

  /** 原子自增；新 key 起始值 1 */
  incr(key) { return this._cache.incr(key); }

  /**
   * 原子自增并自动设置 TTL（限流场景专用）
   * @param {string} key 键
   * @param {number} ttlMs 过期时间（毫秒）
   */
  incrAndExpire(key, ttlMs) { return this._cache.incrAndExpire(key, ttlMs); }

  /**
   * 批量限流自增（IP+UID 双维度一次完成），与 Redis 后端接口对齐
   * @param {string[]} keys 键数组
   * @param {number} ttlMs 过期时间（毫秒）
   * @returns {number[]} 与 keys 顺序对应的计数值
   */
  incrAndExpireBatch(keys, ttlMs) { return this._cache.incrAndExpireBatch(keys, ttlMs); }

  /** 判断 key 是否存在 */
  exists(key) { return this._cache.has(key); }

  /**
   * 给已存在的 key 设置过期时间
   * @returns {boolean} key 不存在时返回 false
   */
  expire(key, ttlMs) { return this._cache.expire(key, ttlMs); }

  /** 获取当前缓存条目数 */
  size() { return this._cache.size(); }

  /** 清空所有缓存 */
  clear() { this._cache.clear(); }
}

/**
 * 存储统一适配层（项目全局唯一入口）
 *
 * 设计目标：
 *   1. 业务侧无需关心底层是 Redis 还是内存，统一调用 store.xxx()
 *   2. Redis 故障时自动降级到内存，熔断保护避免雪崩
 *   3. 接口形状与 Redis 客户端保持一致，零业务侵入
 *
 * 降级策略：
 *   - Redis 不可用 → 启动时直接走内存（useRedis=false）
 *   - Redis 运行时挂掉 → 连续失败 5 次触发熔断，30s 冷却期内全部走内存
 *   - 冷却期过后自动尝试 Redis，成功则关闭熔断，失败则续期
 *
 * 兜底语义：所有方法失败时返回安全默认值（null/false/0），不抛异常上抛
 */
class Store {
  constructor() {
    this.memory = new MemoryAdapter();
    this.redis = null;
    this.useRedis = false;
    this._initialized = false;
    this._lastFallbackLog = 0;
    // 熔断状态机：broken=是否熔断中 / failures=连续失败计数 / lastFailAt=最近失败时间戳
    this._circuit = { broken: false, failures: 0, lastFailAt: 0 };
  }

  /**
   * 初始化存储后端
   * @param {object} [cfg={}] 配置
   * @param {boolean} [cfg.REDIS_ENABLED] 是否启用 Redis
   * @param {object} [cfg.REDIS] Redis 连接配置（host/port/password/db 等）
   */
  async init(cfg = {}) {
    if (this._initialized) return;
    this._initialized = true;

    if (!cfg.REDIS_ENABLED) {
      logger.info("[Store] 运行内存存储模式（10w容量TTL-LRU）");
      return;
    }

    this.redis = new RedisBackend(cfg.REDIS ?? {});
    try {
      await this.redis._getClient();
      this.useRedis = true;
      logger.info("[Store] 已启用Redis分布式存储后端");
    } catch (err) {
      logger.warn(`[Store] Redis连接失败，自动降级内存：${err.message}`);
      this.useRedis = false;
      this.redis = null;
    }
  }

  /**
   * 内部统一调度：优先 Redis，异常自动切换内存
   * @param {string} method 适配器方法名
   * @param {Array} args 参数数组
   * @param {*} fallbackVal Redis + 内存全部失败时的兜底返回值
   * @returns {Promise<*>}
   */
  async _safeExec(method, args, fallbackVal) {
    // 1. 未启用 Redis → 直接走内存
    if (!this.useRedis) return this.memory[method](...args);

    // 2. 熔断中且冷却期未过 → 直接走内存，避免对死掉的 Redis 持续重试
    if (this._circuit.broken && Date.now() - this._circuit.lastFailAt < CIRCUIT_COOLDOWN) {
      return this.memory[method](...args);
    }

    // 3. 正常路径：尝试 Redis
    try {
      const result = await this.redis[method](...args);
      // 成功后重置熔断状态
      this._circuit.failures = 0;
      if (this._circuit.broken) {
        this._circuit.broken = false;
        logger.info("[Store] Redis 已恢复，熔断关闭");
      }
      return result;
    } catch (err) {
      // 4. Redis 调用失败：累计失败次数，必要时触发熔断
      this._printFallbackLog(method, err);
      this._circuit.failures++;
      this._circuit.lastFailAt = Date.now();
      if (this._circuit.failures >= CIRCUIT_THRESHOLD && !this._circuit.broken) {
        this._circuit.broken = true;
        logger.warn(`[Store] Redis 连续失败${this._circuit.failures}次，触发熔断：${CIRCUIT_COOLDOWN}ms 后自动重试`);
      }
      // 5. 内存兜底：再失败则返回安全默认值，不抛异常
      try { return await this.memory[method](...args); }
      catch (memErr) {
        logger.error(`[Store] 内存兜底调用${method}失败：${memErr.message}`);
        return fallbackVal;
      }
    }
  }

  /**
   * 打印降级日志（防抖）
   * 高频失败场景下避免日志被刷爆，1s 内只打一次
   */
  _printFallbackLog(method, err) {
    const now = Date.now();
    if (now - this._lastFallbackLog < FALLBACK_LOG_COOLDOWN) return;
    this._lastFallbackLog = now;
    logger.warn(`[Store] Redis ${method} 请求异常，临时切换内存：${err.message}`);
  }

  // ===================== 统一对外 API =====================
  // 业务侧统一通过 store.xxx() 调用，底层后端透明

  /** 读取缓存；无值或异常返回 null */
  get(key) { return this._safeExec("get", [key], null); }

  /**
   * 写入缓存
   * @param {string} key
   * @param {*} val
   * @param {number} [ttlMs=60000] 过期毫秒数
   * @returns {Promise<boolean>}
   */
  set(key, val, ttlMs = 60000) { return this._safeExec("set", [key, val, ttlMs], false); }

  /** 删除指定 key；不存在或异常返回 false */
  del(key) { return this._safeExec("del", [key], false); }

  /** 原子自增；首次返回 1，异常返回 0 */
  incr(key) { return this._safeExec("incr", [key], 0); }

  /**
   * 原子自增并设置 TTL（限流/计数场景专用）
   * @param {string} key
   * @param {number} ttlMs
   * @returns {Promise<number>}
   */
  incrAndExpire(key, ttlMs) { return this._safeExec("incrAndExpire", [key, ttlMs], 0); }

  /**
   * 批量限流自增：Redis 模式下单条 Lua 完成全部 key（一次往返、原子），
   * 内存模式顺序执行。keys 中空字符串为占位跳过，返回 0。
   * @param {string[]} keys 计数键数组
   * @param {number} ttlMs 窗口过期毫秒
   * @returns {Promise<number[]>}
   */
  incrAndExpireBatch(keys, ttlMs) { return this._safeExec("incrAndExpireBatch", [keys, ttlMs], keys.map(() => 0)); }

  /** 判断 key 是否存在；异常返回 false */
  exists(key) { return this._safeExec("exists", [key], false); }

  /**
   * 给已存在 key 设置过期时间
   * @param {string} key
   * @param {number} ttlMs
   * @returns {Promise<boolean>}
   */
  expire(key, ttlMs) { return this._safeExec("expire", [key, ttlMs], false); }

  /**
   * 获取诊断信息（健康检查/监控上报用）
   * @returns {{mode: string, memorySize: number, redisConnected: boolean, circuitOpen: boolean}}
   */
  getInfo() {
    let mode = "memory";
    if (this.useRedis) mode = this._circuit.broken ? "memory(fallback:redis熔断)" : "redis";
    return {
      mode,
      memorySize: this.memory.size(),
      redisConnected: this.useRedis && this.redis?.getStatus() === "ready",
      circuitOpen: this._circuit.broken,
    };
  }

  /**
   * 关闭并释放资源（优雅停机时调用）
   * Redis 异常不阻断，内存缓存直接清空
   */
  async close() {
    if (this.redis) {
      try { await this.redis.close(); }
      catch (e) { logger.warn(`[Store] Redis关闭异常：${e.message}`); }
    }
    this.memory.clear();
  }
}

// 全局单例：业务侧统一通过 `import { store } from "chanjs"` 访问
export const store = new Store();
export default Store;
