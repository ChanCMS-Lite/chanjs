import { BaseComponent } from "./BaseComponent.js";
import logger from "../utils/logger.js";
import {
  CODE_OK,
  CODE_NOT_FOUND,
  CODE_PARAM_INVALID,
  CODE_PARAM_MISSING,
} from "../response/code.js";

// 合法标识符：列名或「表别名.列名」（join 查询需显式前缀消歧，如 p.price）
const SORT_FIELD_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/;
const OPERATORS = { $like:'like', $gt:'>', $gte:'>=', $lt:'<', $lte:'<=', $ne:'<>' };

/**
 * 分页/分页相关保留字，不可能是合法的 WHERE 过滤列。
 * 某些 controller 会把整个 req.query（含 pageSize/current/page）透传给 Repository.query，
 * 若不加拦截会被 applyQuery 当成过滤字段拼进 SQL（如 `where pageSize = '20'`），
 * 既报错又泄露分页语义。统一在此剥离，避免每个接口各自兜底。
 */
const PAGINATION_KEYS = new Set(['current', 'page', 'pageNum', 'pageSize', 'limit', 'offset']);

/** 查询条件是否存在至少一个合法字段 */
const hasValidQueryField = query =>
  Object.keys(query).some(f => SORT_FIELD_REGEX.test(f));

/**
 * 查询条件全部非法时 fail-closed 拒绝（与 del/update 防御一致），
 * 避免 applyQuery 静默丢弃全部字段后退化成「无 WHERE 全表查询」导致数据泄露。
 * @returns {null | {success:false,code:number,msg:string,data:{}}} 校验通过返回 null，否则返回错误体
 */
const guardInvalidQuery = query => {
  if (query && Object.keys(query).length && !hasValidQueryField(query)) {
    return { success: false, code: CODE_PARAM_INVALID, msg: "查询条件非法", data: {} };
  }
  return null;
};

/**
 * 拼接查询条件，支持操作符/等值/数组in
 * @param {import('knex').Knex.QueryBuilder} dbQuery
 * @param {object} query
 * @returns {import('knex').Knex.QueryBuilder}
 */
function applyQuery(dbQuery, query) {
  for (const [field, val] of Object.entries(query)) {
    if (PAGINATION_KEYS.has(field)) continue; // 分页参数不是过滤列，直接跳过
    if (!SORT_FIELD_REGEX.test(field)) {
      logger.warn(`[Repository] 非法查询字段：${field}`);
      continue;
    }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const ops = Object.keys(val);
      if (ops.length && ops.every(k => k in OPERATORS || k === '$in' || k === '$null' || k === '$notNull')) {
        for (const [op, operand] of Object.entries(val)) {
          if (op === '$in') {
            dbQuery = dbQuery.whereIn(field, Array.isArray(operand) ? operand : [operand]);
          } else if (OPERATORS[op]) {
            dbQuery = dbQuery.where(field, OPERATORS[op], operand);
          } else if (op === '$null') {
            operand ? dbQuery.whereNull(field) : dbQuery.whereNotNull(field);
          } else if (op === '$notNull') {
            dbQuery.whereNotNull(field);
          }
        }
        continue;
      }
    }
    Array.isArray(val) ? dbQuery.whereIn(field, val) : dbQuery.where(field, val);
  }
  return dbQuery;
}

/**
 * URL 平铺查询参数 → applyQuery 条件对象（通用搜索基建）
 *
 * @param {object} query - 平铺查询参数（如 req.query），值为字符串/数字
 * @param {Object<string, Function>} fieldMap - 筛选字段白名单映射表：
 *   { urlParam: (value) => 条件片段 | null }
 *   - 仅声明的参数会进入查询，未声明的一律忽略（防任意列注入）
 *   - 转换函数负责类型收敛与 like 转义（utils.escapeLike），返回 null/undefined 表示无效值，忽略
 * @returns {object} 条件对象，可直接交给 applyQuery 拼接 knex where
 *
 * @example
 * const FILTERS = {
 *   keyword: v => ({ title: { $like: `%${escapeLike(v)}%` } }),
 *   price_min: v => Number.isFinite(Number(v)) ? { price: { $gte: Number(v) } } : null,
 * };
 * mapUrlFilters({ keyword: "液压", price_min: "100" }, FILTERS);
 * // → { title: { $like: "%液压%" }, price: { $gte: 100 } }
 */
function mapUrlFilters(query, fieldMap) {
  const filter = {};
  for (const [key, map] of Object.entries(fieldMap || {})) {
    const raw = query?.[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    let piece;
    try {
      piece = map(String(raw).trim());
    } catch {
      continue; // 转换函数异常视为无效参数，静默忽略（面向用户输入，前台容错）
    }
    if (!piece || typeof piece !== "object") continue;
    for (const [field, cond] of Object.entries(piece)) {
      const prev = filter[field];
      // 同字段多操作符深合并（如 price 的 $gte 与 $lte 共存成区间）
      if (
        prev && typeof prev === "object" && !Array.isArray(prev) &&
        cond && typeof cond === "object" && !Array.isArray(cond)
      ) {
        filter[field] = { ...prev, ...cond };
      } else {
        filter[field] = cond;
      }
    }
  }
  return filter;
}

/**
 * 应用字段白名单 + 排序白名单到 query
 * @param {import('knex').Knex.QueryBuilder} q
 * @param {string[]} fields
 * @param {object} sort
 * @returns {import('knex').Knex.QueryBuilder}
 */
function applySelectAndSort(q, fields, sort) {
  if (fields.length) {
    const safeFields = fields.filter(f => SORT_FIELD_REGEX.test(f) || f === '*');
    if (safeFields.length) q = q.select(safeFields);
  }
  if (sort && typeof sort === 'object') {
    for (const [field, dir] of Object.entries(sort)) {
      if (!SORT_FIELD_REGEX.test(field)) {
        logger.warn(`[Repository] 非法排序字段：${field}`);
        continue;
      }
      const d = ['asc','desc'].includes(String(dir).toLowerCase()) ? dir.toLowerCase() : 'asc';
      q = q.orderBy(field, d);
    }
  }
  return q;
}

/**
 * 数据访问基类，封装通用CRUD操作
 * 继承 BaseComponent 获得 app/config/db 快捷访问，不绑定组件加载职责
 * 防御设计：所有入口统一经 _guard 校验「数据库可用性 + 查询条件合法性」，
 * 再进入 SQL 构造层，避免各方法重复书写 `_checkDB + guardInvalidQuery` 样板。
 */
class Repository extends BaseComponent {
  constructor(table=null, dbName=null, opts={}) {
    super();
    this.tableName = table;
    this._dbName = dbName;
    this._customDb = null;
    this._dateFields = Array.isArray(opts.dateFields) ? opts.dateFields : [];
    // join() 联表白名单：声明后 joinTable 必须在列，防未来某处把用户输入透传成任意表读取；
    // 未声明保持原行为（仅正则格式校验），存量业务零破坏
    this._allowJoinTables = Array.isArray(opts.allowJoinTables) ? opts.allowJoinTables : null;
    typeof this.on === 'function' && this.on();
  }

  /** 动态获取数据库连接（支持多库：指定 dbName 时取对应连接，否则取默认） */
  get db() {
    if (this._dbName) {
      this._customDb ??= this.app?.dbManager?.get(this._dbName);
      return this._customDb;
    }
    return this.app?.db ?? null;
  }

  /** 分页配置快捷读取 */
  get limit() { return this.config?.LIMIT_MAX || 300; }

  /** 前置数据库校验 */
  _checkDB() {
    if (!this.db) throw new Error("Database connection not available");
  }

  /**
   * 写操作 WHERE 防御（fail-closed）：条件字段全部非法时拒绝执行。
   * 被丢弃的条件会让 del/update 退化为无 WHERE 的全表操作，统一在此拦截。
   * @param {object} query WHERE 条件
   * @returns {{success:false,code:number,msg:string,data:{}}|null} 非法返回错误体（调用方应 return），合法返回 null
   */
  #assertValidWhere(query) {
    if (!Object.keys(query).some(f => SORT_FIELD_REGEX.test(f))) {
      return { success: false, code: CODE_PARAM_INVALID, msg: "操作条件非法", data: {} };
    }
    return null;
  }

  /** 当前连接的数据库客户端类型（knex client：mysql2 / pg / better-sqlite3 ...） */
  get _clientType() {
    return this.db?.client?.config?.client || "";
  }

  /** PostgreSQL 的 INSERT 默认不回传自增主键，必须显式 RETURNING 才能拿到 insertId */
  get _needReturning() {
    const c = this._clientType;
    return c === "pg" || c === "postgres" || c === "pg-query-stream";
  }

  /**
   * 统一防御守卫：数据库可用性 + 查询条件合法性（fail-closed）。
   * 查询/统计/存在性等方法的入口统一先过此守卫，替代各方法开头的 `_checkDB()+guardInvalidQuery()` 重复样板。
   * 空 query（如 {}）合法放行；仅 db 不可用时直接抛异常，保证后端配置错误尽早暴露。
   * @param {object} [opts={}]
   * @param {object} [opts.query={}] 查询条件；为空对象或缺省时仅校验数据库连接
   * @returns {null | {success:false,code:number,msg:string,data:object}} 校验通过返回 null，否则返回错误体（调用方应 return 该值）
   */
  _guard({ query = {} } = {}) {
    this._checkDB();
    return guardInvalidQuery(query);
  }

  /** 统一构建查询实例（子类可重写以扩展过滤逻辑） */
  _buildBaseQuery({ query = {}, sort = {}, fields = [] } = {}) {
    this._checkDB();
    let q = this.db(this.tableName);
    if (Object.keys(query).length) q = applyQuery(q, query);
    return applySelectAndSort(q, fields, sort);
  }

  /** 工具：日期字段自动转Date */
  #formatDate(data) {
    if (!data || typeof data !== 'object' || !this._dateFields.length) return data;
    const row = {...data};
    for (const k of this._dateFields) {
      if (typeof row[k] === 'string') {
        const dt = new Date(row[k]);
        !isNaN(dt.getTime()) && (row[k] = dt);
      }
    }
    return row;
  }

  /** 查询全部，默认上限1000条 */
  async all({ query={}, sort={}, fields=[], limit=1000 }={}) {
    const err = this._guard({ query });
    if (err) return err;
    const list = await this._buildBaseQuery({query,sort,fields}).limit(limit);
    return { success:true, code:CODE_OK, msg:"查询成功", data: list };
  }

  /** 分页偏移查询 */
  async find({ query={}, sort={}, fields=[], limit, offset }={}) {
    const err = this._guard({ query });
    if (err) return err;
    let q = this._buildBaseQuery({query,sort,fields});
    typeof offset === 'number' && (q = q.offset(offset));
    typeof limit === 'number' && (q = q.limit(limit));
    return { success:true, code:CODE_OK, msg:"查询成功", data: await q };
  }

  /** 查询单条记录 */
  async findOne({ query={}, fields=[] }={}) {
    const err = this._guard({ query });
    if (err) return err;
    const row = await this._buildBaseQuery({query,fields}).first();
    if (!row) return { success:false, code:CODE_NOT_FOUND, msg:"记录不存在", data:null };
    return { success:true, code:CODE_OK, msg:"查询成功", data: row };
  }

  /** 根据ID查询单条 */
  async findById(id, { fields=[] }={}) {
    return this.findOne({ query:{id}, fields });
  }

  /** 单条插入 */
  async insert(data={}) {
    this._checkDB();
    if (!Object.keys(data).length) return { success:false, code:CODE_PARAM_MISSING, msg:"参数缺失", data:{} };
    const query = this.db(this.tableName).insert(this.#formatDate(data));
    if (this._needReturning) query.returning("id"); // pg 需 RETURNING 才有 insertId；mysql/sqlite 的 res[0] 天然是自增 id
    const raw = await query;
    const insertId = this._needReturning ? (raw[0]?.id ?? raw[0]) : raw[0]; // pg returning 返回 [{id:N}]
    return { success:true, code:CODE_OK, msg:"插入成功", data:{ insertId, affectedRows:1 } };
  }

  /** 批量插入 */
  async insertMany(records=[]) {
    this._checkDB();
    if (!records.length) return { success:false, code:CODE_PARAM_MISSING, msg:"参数缺失", data:{} };
    const list = records.map(r => this.#formatDate(r));
    const query = this.db(this.tableName).insert(list);
    if (this._needReturning) query.returning("id");
    const raw = await query;
    const insertId = this._needReturning ? (raw[0]?.id ?? raw[0]) : raw[0];
    return { success:true, code:CODE_OK, msg:"批量插入成功", data:{ insertId, affectedRows:records.length } };
  }

  /** 条件删除 */
  async del(query={}) {
    this._checkDB();
    if (!Object.keys(query).length) return { success:false, code:CODE_PARAM_MISSING, msg:"参数缺失", data:{} };
    // 防御纵深：条件字段全部非法（会被 applyQuery 静默丢弃）时，
    // 会生成不带 WHERE 的全表删除，fail-closed 拒绝执行。
    const invalid = this.#assertValidWhere(query);
    if (invalid) return invalid;
    const rows = await applyQuery(this.db(this.tableName), query).del();
    return { success:true, code:CODE_OK, msg:"删除成功", data:{ affectedRows:rows } };
  }

  /** 根据ID删除单条 */
  async delById(id) {
    return this.del({ id });
  }

  /** ID数组批量删除 */
  async delMany(ids=[]) {
    this._checkDB();
    if (!ids.length) return { success:false, code:CODE_PARAM_MISSING, msg:"参数缺失", data:{} };
    const rows = await this.db(this.tableName).whereIn('id', ids).del();
    return { success:true, code:CODE_OK, msg:"删除成功", data:{ affectedRows:rows } };
  }

  /**
   * 更新内部原语（私有方法）：子类无法覆写。
   * 业务 Service 普遍以扁平 body 形状覆写 update(body)，若框架内部走多态的 this.update，
   * {query,data} 会被子类签名解构致 id=undefined、更新静默失效。
   * 框架内部路径必须走本私有方法，杜绝该类命名冲突。
   */
  async #updateRaw(query, data) {
    this._checkDB();
    if (!query || !data || !Object.keys(query).length || !Object.keys(data).length) {
      return { success:false, code:CODE_PARAM_INVALID, msg:"参数无效", data:{} };
    }
    // 防御纵深：与 del 同理，条件字段全部非法时会生成无 WHERE 的全表更新，fail-closed 拒绝。
    const invalid = this.#assertValidWhere(query);
    if (invalid) return invalid;
    const rows = await applyQuery(this.db(this.tableName), query).update(this.#formatDate(data));
    return { success:true, code:CODE_OK, msg:"更新成功", data:{ affectedRows:rows } };
  }

  /** 按条件更新记录 */
  async update({ query, data }={}) {
    return this.#updateRaw(query, data);
  }

  /** 根据ID更新，返回更新后完整数据；失败不再被忽略，直接透传错误体 */
  async updateById(id, data={}) {
    if (!id || !Object.keys(data).length) return { success:false, code:CODE_PARAM_INVALID, msg:"参数无效", data:{} };
    const res = await this.#updateRaw({ id }, data);
    if (!res.success) return res;
    return this.findById(id);
  }

  /** 事务批量更新，失败自动回滚 */
  async updateMany(updates=[]) {
    this._checkDB();
    if (!Array.isArray(updates) || !updates.length) {
      return { success:false, code:CODE_PARAM_MISSING, msg:"参数缺失", data:{} };
    }
    for (const item of updates) {
      if (!item.query || !Object.keys(item.query).length) {
        return { success:false, code:CODE_PARAM_INVALID, msg:"批量更新条件不能为空", data:{} };
      }
      // 防御纵深：与 del/update 同口径，条件字段全部非法时 fail-closed 拒绝，
      // 避免生成无 WHERE 的全表更新
      const invalid = this.#assertValidWhere(item.query);
      if (invalid) return invalid;
    }
    const trx = await this.db.transaction();
    let total = 0;
    try {
      // 与单条 update 同口径：条件统一过 applyQuery（操作符解析 + 非法字段过滤），不再裸用 knex where
      for (const { query, data } of updates) {
        const row = await applyQuery(trx(this.tableName), query).update(this.#formatDate(data));
        row === 0 && logger.info(`[Repository] updateMany无匹配行 ${JSON.stringify(query)}`);
        total += row;
      }
      await trx.commit();
      return { success:true, code:CODE_OK, msg:"批量更新成功", data:{ affectedRows:total } };
    } catch (err) {
      await trx.rollback().catch(e => logger.error("[Repository] 事务回滚失败", e.message));
      logger.error("[Repository] 批量更新异常", err.message);
      throw err;
    }
  }

  /**
   * 分页查询核心实现
   * 私有方法，避免 query/list 子类重写时发生互相递归
   * @param {object} params 分页参数
   * @returns {Promise<{success:boolean,code:number,msg:string,data:object}>}
   */
  async _doPaginate({ current=1, pageSize=10, query={}, sort={}, field=[] }={}) {
    const err = this._guard({ query });
    if (err) return err;
    // 页码边界保护：current<=0 会生成负 offset 让 MySQL 直接语法报错
    const currentPage = Math.max(1, Math.floor(Number(current) || 1));
    const size = Math.min(Math.max(pageSize, 1), this.limit);
    const offset = (currentPage - 1) * size;
    const countQ = applyQuery(this.db(this.tableName), query);
    const [totalRow, list] = await Promise.all([
      countQ.count("* as total").first(),
      this._buildBaseQuery({query,sort,fields:field}).offset(offset).limit(size)
    ]);
    const total = Number(totalRow?.total ?? 0);
    return {
      success:true,
      code:CODE_OK,
      msg:"查询成功",
      data: {
        list,
        total,
        current: currentPage,
        pageSize: size,
        totalPages: Math.ceil(total / size)
      }
    };
  }

  /** 标准分页查询 */
  async query(params={}) {
    return this._doPaginate(params);
  }

  /**
   * 基于游标的深分页查询（keyset pagination），替代 offset 深分页。
   *
   * 适用场景：大表（数万行+）且需翻到很后面的分页。
   * offset 深分页痛点：`LIMIT 100000, 20` 需先扫描并丢弃前 10 万行，越深越慢；
   * keyset 直接用 `WHERE id > 上一页最后一条的 id ORDER BY id LIMIT 20` 精准定位，与页码无关，常数级耗时。
   *
   * 返回体不依赖 offset/totalPages，浏览器端用「加载更多」或「下一页」+ nextCursor 驱动。
   *
   * @param {object} [params]
   * @param {object} [params.query={}] 过滤条件（同 query()）
   * @param {number} [params.pageSize=20] 每页条数（受 this.limit 上限约束）
   * @param {string} [params.cursorField='id'] 游标字段，须为稳定唯一且可排序的列（默认主键 id；也支持 created_at 等，但注意并列值会导致漏数据）
   * @param {string|number|null} [params.cursorValue=null] 上一页最后一条的 cursorField 值；null 表示首页
   * @param {'asc'|'desc'} [params.direction='desc'] 排序方向（取新纪录通常 desc）
   * @param {string[]} [params.fields=[]] 白名单字段
   * @returns {Promise<{success:boolean,code:number,msg:string,data:{list:Array,nextCursor:number|string|null,hasMore:boolean,cursorField:string}}>}
   *
   * @example
   * // 首页（取最新 20 条）
   * const p1 = await repo.cursorPage({ query:{cid:5}, pageSize:20, direction:'desc' });
   * const nextCursor = p1.data.nextCursor;
   * // 下一页（携带上一页末尾游标，常数级耗时，即使翻到第 1 万页也一样快）
   * const p2 = await repo.cursorPage({ query:{cid:5}, pageSize:20, direction:'desc', cursorValue:nextCursor });
   */
  async cursorPage({ query={}, pageSize=20, cursorField='id', cursorValue=null, direction='desc', fields=[] }={}) {
    const err = this._guard({ query });
    if (err) return err;
    // 游标字段与方向必须白名单校验，防 SQL 注入（排序字段会被直接拼进 ORDER BY）
    if (!SORT_FIELD_REGEX.test(cursorField)) {
      logger.warn(`[Repository] 非法游标字段：${cursorField}`);
      return { success:false, code:CODE_PARAM_INVALID, msg:"非法排序字段", data:null };
    }
    const dir = String(direction).toLowerCase() === 'asc' ? 'asc' : 'desc';
    const size = Math.min(Math.max(Number(pageSize) || 1, 1), this.limit);

    let q = this._buildBaseQuery({ query, sort: { [cursorField]: dir }, fields });
    // 游标定位：大于/小于上一页末尾的游标值，天然避免重复与跳跃
    if (cursorValue !== null && cursorValue !== undefined && cursorValue !== "") {
      q = dir === 'asc' ? q.where(cursorField, '>', cursorValue) : q.where(cursorField, '<', cursorValue);
    }
    const list = await q.limit(size);

    const last = list.length ? list[list.length - 1] : null;
    const nextCursor = last ? last[cursorField] : null;
    // 恰好取满 size 条时无法确定是否还有更多（边界处需多取一条判断更严谨，这里退化为 hasMore=满页）
    const hasMore = list.length === size;
    return { success:true, code:CODE_OK, msg:"查询成功", data:{ list, nextCursor, hasMore, cursorField } };
  }

  /** 统计符合条件记录行数 */
  async count(query={}) {
    const err = this._guard({ query });
    if (err) return err;
    const res = await applyQuery(this.db(this.tableName), query).count("* as total").first();
    return { success:true, code:CODE_OK, msg:"统计成功", data:{ count: Number(res?.total ?? 0) } };
  }

  /** 判断查询条件下记录是否存在 */
  async exists(query={}) {
    const err = this._guard({ query });
    if (err) return err;
    const row = await applyQuery(this.db(this.tableName), query).first();
    return { success:true, code:CODE_OK, msg:"检查成功", data:{ exists: !!row } };
  }

  /** 联表join查询 */
  async join({ joinTable, localField, foreignField, fields=[], query={}, sort={} }) {
    this._checkDB();
    if (!SORT_FIELD_REGEX.test(joinTable) || !SORT_FIELD_REGEX.test(localField) || !SORT_FIELD_REGEX.test(foreignField)) {
      logger.warn(`[Repository] 非法联表/字段：${joinTable}/${localField}/${foreignField}`);
      return { success: false, code: CODE_PARAM_INVALID, msg: "非法联表或字段", data: null };
    }
    // 表白名单校验（构造时声明 allowJoinTables 才启用）
    if (this._allowJoinTables && !this._allowJoinTables.includes(joinTable)) {
      logger.warn(`[Repository] 联表不在白名单：${joinTable}`);
      return { success: false, code: CODE_PARAM_INVALID, msg: "非法联表", data: null };
    }
    const err = this._guard({ query });
    if (err) return err;
    const select = fields.length
      ? fields.filter(f => SORT_FIELD_REGEX.test(f) || f === '*')
      : [`${this.tableName}.*`];
    let q = this.db(this.tableName)
      .join(joinTable, `${this.tableName}.${localField}`, '=', `${joinTable}.${foreignField}`)
      .select(select);
    q = applyQuery(q, query);
    q = applySelectAndSort(q, [], sort);
    return { success:true, code:CODE_OK, msg:"查询成功", data: await q };
  }

  /** 统计表总数量 + 今日新增数量（今日列探测失败降级为 0，不阻断总数统计） */
  async stats() {
    this._checkDB();
    const createKey = this._dateFields.find(f => /created_at|createdAt/.test(f)) || "created_at";
    const totalRes = await this.db(this.tableName).count('* as count').first();
    let today = 0;
    try {
      const todayStart = new Date();
      todayStart.setHours(0,0,0,0);
      const todayRes = await this.db(this.tableName)
        .where(createKey, '>=', todayStart).count('* as count').first();
      today = Number(todayRes?.count || 0);
    } catch (err) {
      // 表无 created_at 列等情况：跳过今日统计而非整体报错
      logger.warn(`[Repository] stats 今日统计失败（表 ${this.tableName} 列 ${createKey}?）：${err.message}`);
    }
    return {
      success:true,
      code:CODE_OK,
      msg:"统计成功",
      data: {
        total: Number(totalRes?.count || 0),
        today
      }
    };
  }
}

// 查询条件组装原语（业务 service 可直接组合使用，不必继承 Repository）
export { applyQuery, mapUrlFilters };

export default Repository;