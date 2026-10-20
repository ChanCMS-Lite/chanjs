/**
 * 单Map实现LRU+惰性TTL过期清理，对齐Redis incr行为，限流专用内存存储
 * 特性：访问刷新LRU、自增不续期、批量惰性清理、容量淘汰
 */
const CACHE_CONST = Object.freeze({
  DEFAULT_MAX_SIZE: 100000,
  DEFAULT_TTL: 5 * 60 * 1000,
  DEFAULT_INCR_TTL: 60 * 1000,
  CLEANUP_INTERVAL: 10 * 1000,
  CLEANUP_BATCH_LIMIT: 1000,
});

export const DEFAULT_INCR_TTL = CACHE_CONST.DEFAULT_INCR_TTL;

class Cache {
  /**
   * @param {{maxSize?: number; defaultTTL?: number}} opts
   */
  constructor(opts = {}) {
    this.map = new Map();
    this.maxSize = opts.maxSize ?? CACHE_CONST.DEFAULT_MAX_SIZE;
    this.defaultTTL = opts.defaultTTL ?? CACHE_CONST.DEFAULT_TTL;
    this._lastCleanup = Date.now();
    this._cleanupInterval = CACHE_CONST.CLEANUP_INTERVAL;
  }

  /** 写入缓存；ttl<=0 视为永久存储（与 redis.set 行为对齐） */
  set(key, value, ttl = this.defaultTTL) {
    this._maybeCleanup();
    if (this.map.size >= this.maxSize && !this.map.has(key)) this._evictLRU();
    this.map.delete(key);
    const expireAt = ttl > 0 ? Date.now() + ttl : Infinity;
    this.map.set(key, { value, expireAt });
  }

  /** 读取，刷新LRU顺序 */
  get(key) {
    const item = this._touch(key);
    return item ? item.value : null;
  }

  /** 存在性校验，命中同样刷新LRU */
  has(key) { return !!this._touch(key); }

  del = key => this.map.delete(key);
  clear = () => this.map.clear();
  size() { return this.map.size; }

  /**
   * 按 key 前缀批量删除（解耦调用方对 cache.map 内部结构的依赖）
   * 先收集匹配 key 再统一删除，避免迭代中改 Map 的行为差异。
   * @param {string} prefix - key 前缀（如 "web:" / "home:"）
   * @returns {number} 实际删除的 key 数量
   */
  clearByPrefix(prefix) {
    if (typeof prefix !== "string" || prefix === "") return 0;
    const toDelete = [];
    for (const key of this.map.keys()) {
      if (typeof key === "string" && key.startsWith(prefix)) toDelete.push(key);
    }
    let count = 0;
    for (const key of toDelete) {
      if (this.map.delete(key)) count++;
    }
    return count;
  }

  /** 访问并刷新LRU，过期项自动清理（单次 delete+set 维护 Map 插入序） */
  _touch(key) {
    const item = this.map.get(key);
    if (!item) return null;
    if (Date.now() > item.expireAt) {
      this.map.delete(key);
      return null;
    }
    // 利用 Map 插入序特性：delete+set 将 key 移至末尾（最近访问）
    this.map.delete(key);
    this.map.set(key, item);
    return item;
  }

  /** 自增，新建key使用默认incrTTL，存量不续期TTL */
  incr(key, ttlMs = CACHE_CONST.DEFAULT_INCR_TTL) {
    this._maybeCleanup();
    return this._incrInternal(key, ttlMs, false);
  }

  /** 自增并刷新过期时间（限流专用） */
  incrAndExpire(key, ttlMs) {
    this._maybeCleanup();
    return this._incrInternal(key, ttlMs, true);
  }

  /**
   * 批量限流自增，与 Redis 后端 incrAndExpireBatch 接口对齐
   * 内存操作无网络往返，顺序执行即可；空字符串 key 跳过返回 0
   * @param {string[]} keys 计数key数组
   * @param {number} ttlMs 窗口过期时间
   * @returns {number[]} 与 keys 顺序对应的计数值数组
   */
  incrAndExpireBatch(keys, ttlMs) {
    return keys.map(k => (k === "" ? 0 : this.incrAndExpire(k, ttlMs)));
  }

  _incrInternal(key, ttlMs, refreshTTL) {
    const now = Date.now();
    const item = this.map.get(key);
    if (!item || now > item.expireAt) {
      if (this.map.size >= this.maxSize && !this.map.has(key)) this._evictLRU();
      this.map.set(key, { value: 1, expireAt: now + ttlMs });
      return 1;
    }
    item.value = (Number.isFinite(item.value) ? item.value : 0) + 1;
    if (refreshTTL) item.expireAt = now + ttlMs;
    return item.value;
  }

  /** 主动刷新指定key过期时间 */
  expire(key, ttlMs) {
    const item = this.map.get(key);
    if (!item || Date.now() > item.expireAt) return false;
    item.expireAt = Date.now() + ttlMs;
    return true;
  }

  /** LRU淘汰：删除最久未访问key（Map 头部即最早插入） */
  _evictLRU() {
    if (this.map.size < this.maxSize) return;
    const oldest = this.map.keys().next().value;
    if (oldest !== undefined) this.map.delete(oldest);
  }

  /** 惰性批量清理：间隔10s一次，单次最多清理1000条防阻塞事件循环 */
  _maybeCleanup() {
    const now = Date.now();
    if (now - this._lastCleanup < this._cleanupInterval) return;
    this._lastCleanup = now;
    let count = 0;
    for (const [k, v] of this.map) {
      if (now > v.expireAt) this.map.delete(k);
      if (++count >= CACHE_CONST.CLEANUP_BATCH_LIMIT) break;
    }
  }
}

// 全局单例实例
export const cache = new Cache();
export default Cache;