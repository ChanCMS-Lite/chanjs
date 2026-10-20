import logger from "../utils/logger.js";

// Redis固定常量统一管理，冻结防止修改
const REDIS_CONST = Object.freeze({
  DEFAULT_INCR_TTL: 60 * 1000,       // incr新建key默认过期时间 60s
  DEFAULT_CONNECT_TIMEOUT: 5000,     // 连接超时5秒
  DEFAULT_CMD_TIMEOUT: 1000,         // 单条命令执行超时1秒
  MAX_RETRY_TIMES: 3,                // 重连最大尝试次数
});
export const DEFAULT_INCR_TTL = REDIS_CONST.DEFAULT_INCR_TTL;

/**
 * Redis纯存储后端封装（基于ioredis）
 * 1. 懒加载连接：首次调用才创建客户端，启动不阻塞进程
 * 2. incr：先INCR，返回1（新建/过期重建）则补PEXPIRE，递增不刷新TTL，无竞态
 * 3. 自动序列化/反序列化JSON，普通字符串直接透传
 * 4. 关闭离线队列、单次请求仅重试1次，故障快速抛出供上层降级
 */
class RedisBackend {
  /**
   * @param {Object} cfg Redis连接配置 host/port/password/db/超时/重连策略
   */
  constructor(cfg = {}) {
    this.cfg = cfg;          // 连接配置缓存
    this.client = null;      // ioredis实例
    this.initTask = null;    // 连接初始化Promise，防止并发重复建连
  }

  /**
   * 内部工具：懒加载获取Redis客户端，连接失败抛出异常
   * 外部store适配层可调用，去掉#私有标识解决跨文件访问报错
   */
  async _getClient() {
    // 已有客户端直接返回
    if (this.client) return this.client;
    // 正在初始化，等待初始化Promise
    if (this.initTask) return this.initTask;

    // 开始异步初始化连接
    this.initTask = (async () => {
      // 动态导入ioredis，避免未安装Redis依赖时报启动错误
      const { default: Redis } = await import("ioredis");
      const client = new Redis({
        host: this.cfg.host ?? "127.0.0.1",
        port: this.cfg.port ?? 6379,
        password: this.cfg.password || undefined,
        db: this.cfg.db ?? 0,
        connectTimeout: this.cfg.connectTimeout ?? REDIS_CONST.DEFAULT_CONNECT_TIMEOUT,
        commandTimeout: this.cfg.commandTimeout ?? REDIS_CONST.DEFAULT_CMD_TIMEOUT,
        lazyConnect: true,                  // 实例化不立即连接，手动connect
        maxRetriesPerRequest: 1,            // 单条命令失败仅重试1次
        enableOfflineQueue: false,           // 断连后不堆积请求，直接报错
        retryStrategy: this.cfg.retryStrategy ?? ((times) => {
          // 超过最大重试次数返回null，停止重连
          if (times > REDIS_CONST.MAX_RETRY_TIMES) return null;
          // 重试间隔阶梯增长，最大1秒
          return Math.min(times * 200, 1000);
        }),
      });

      // 连接事件监听，打印日志
      client
        .on("error", err => logger.error("[Redis] 连接异常", err.message))
        .on("connect", () => logger.info(`[Redis] 已连接 ${this.cfg.host}:${this.cfg.port}`))
        .on("reconnecting", () => logger.info("[Redis] 正在重连"));

      // 手动发起连接
      await client.connect();
      this.client = client;
      return client;
    })();

    try {
      return await this.initTask;
    } catch (err) {
      // 连接失败清空缓存，下次调用重新初始化
      this.client = null;
      this.initTask = null;
      throw new Error(`Redis连接失败: ${err.message}`);
    }
  }

  /**
   * 读取缓存
   * @param {string} key 缓存键名
   * @returns {any|null} 解析后数据，不存在返回null
   */
  async get(key) {
    const cli = await this._getClient();
    const raw = await cli.get(key);
    if (raw === null) return null;
    try {
      // JSON字符串自动解析
      return JSON.parse(raw);
    } catch {
      // 普通字符串直接返回
      return raw;
    }
  }

  /**
   * 写入缓存
   * @param {string} key 键名
   * @param {any} val 存储值
   * @param {number} ttlMs 过期毫秒，<=0永久存储
   * @returns {boolean} 固定返回true
   */
  async set(key, val, ttlMs = 60000) {
    const cli = await this._getClient();
    const data = typeof val === "string" ? val : JSON.stringify(val);
    if (ttlMs > 0) {
      await cli.set(key, data, "PX", ttlMs);
    } else {
      await cli.set(key, data);
    }
    return true;
  }

  /**
   * 删除key
   * @param {string} key 键名
   * @returns {boolean} 是否删除成功
   */
  async del(key) {
    const cli = await this._getClient();
    const cnt = await cli.del(key);
    return cnt > 0;
  }

  /**
   * 自增计数，新建key使用全局默认TTL
   * Lua 脚本保证 INCR + PEXPIRE 原子性，避免崩溃窗口内 key 无 TTL 内存泄漏
   * 递增不刷新TTL，仅首次（count===1）设置过期
   * @param {string} key 计数key
   * @returns {number} 当前计数值
   */
  async incr(key) {
    const cli = await this._getClient();
    return cli.eval(
      "local c=redis.call('INCR',KEYS[1]);if c==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1])end;return c",
      1, key, REDIS_CONST.DEFAULT_INCR_TTL
    );
  }

  /**
   * 限流专用自增，自定义新建key过期时间（Lua 原子操作）
   * @param {string} key 计数key
   * @param {number} ttlMs 窗口过期时间
   * @returns {number} 当前计数值
   */
  async incrAndExpire(key, ttlMs) {
    const cli = await this._getClient();
    return cli.eval(
      "local c=redis.call('INCR',KEYS[1]);if c==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1])end;return c",
      1, key, ttlMs
    );
  }

  /**
   * 批量限流自增（IP+UID 双维度一次往返）
   * 单条 Lua 脚本内完成全部 key 的 INCR+PEXPIRE，原子且省 RTT；
   * 空字符串 key 跳过（占位用），返回数组与传入 keys 一一对应
   * @param {string[]} keys 计数key数组
   * @param {number} ttlMs 窗口过期时间
   * @returns {Promise<number[]>} 与 keys 顺序对应的计数值数组
   */
  async incrAndExpireBatch(keys, ttlMs) {
    const cli = await this._getClient();
    const script = `
      local r = {}
      for i, k in ipairs(KEYS) do
        if k ~= '' then
          local c = redis.call('INCR', k)
          if c == 1 then redis.call('PEXPIRE', k, ARGV[1]) end
          r[i] = c
        else
          r[i] = 0
        end
      end
      return r
    `;
    return cli.eval(script, keys.length, ...keys, ttlMs);
  }

  /**
   * 判断key是否存在
   * @param {string} key 键名
   * @returns {boolean} true存在 / false不存在
   */
  async exists(key) {
    const cli = await this._getClient();
    const res = await cli.exists(key);
    return res === 1;
  }

  /**
   * 主动刷新key过期时间
   * @param {string} key 键名
   * @param {number} ttlMs 新过期毫秒
   * @returns {number} redis原生返回值
   */
  async expire(key, ttlMs) {
    const cli = await this._getClient();
    return cli.pexpire(key, ttlMs);
  }

  /**
   * 关闭Redis连接，清空实例缓存
   */
  async close() {
    if (!this.client) return;
    await this.client.quit();
    this.client = null;
    this.initTask = null;
  }

  /**
   * 获取客户端连接状态，用于上层诊断监控
   * @returns {'idle'|'ready'|'connecting'|'closed'}
   */
  getStatus() {
    if (!this.client) return "idle";
    return this.client.status ?? "unknown";
  }
}

export default RedisBackend;