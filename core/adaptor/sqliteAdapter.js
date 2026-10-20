// sqliteAdapter.js
// 基于 Node 22 内置 node:sqlite（DatabaseSync）实现的 knex SQLite 适配器，零第三方依赖。
// 仅替换底层连接与执行层，SQL 编译/方言完全复用 knex 自带的 SQLite 驱动，
// 因此与官方 client:"sqlite3" 产出的 SQL 一致，只是不依赖 sqlite3 npm 包。
//
// 挂载方式：config 中 sqlite 分支填写纯字符串 client:"sqlite" 即可，
// 由 Database.js 在初始化连接时按类型自动映射到本适配器，业务侧无需 import。
import { createRequire } from "module";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
// 复用 knex 内置 SQLite 方言（SQL 编译器 / schema 编译器 / 事务 / DDL）
const Client_SQLite = require("knex/lib/dialects/sqlite3/index.js");

/**
 * node:sqlite 的绑定值约束较小，这里统一规范化再绑定：
 * - undefined -> null（跳过绑定会报错）
 * - boolean   -> 0/1（SQLite 无 bool 类型）
 * - Date      -> ISO 字符串（极少数未格式化兜底）
 */
function toSqliteValue(value) {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** 归一化位置参数与具名参数两种绑定形态 */
function normalizeBindings(bindings) {
  if (bindings == null) return [];
  if (Array.isArray(bindings)) return bindings.map(toSqliteValue);
  if (typeof bindings === "object") return Object.values(bindings).map(toSqliteValue);
  return bindings;
}

class SqliteAdapter extends Client_SQLite {
  // 官方客户端 _driver() 会 require("sqlite3")，这里改为静态标志，
  // 避免任何路径触发未安装的 sqlite3 包（本项目不缓存驱动实例）。
  _driver() {
    return { OPEN_READWRITE: 0x00000002, OPEN_CREATE: 0x00000004 };
  }

  // 用内置 node:sqlite 同步打开连接（knex 接受同步返回值）
  acquireRawConnection() {
    const filename = this.connectionSettings?.filename || ":memory:";
    const conn = new DatabaseSync(filename);
    // 与官方 sqlite3 客户端默认口径一致，关闭外键强制以免种子/迁移级联约束影响
    try {
      conn.exec("PRAGMA foreign_keys = OFF");
    } catch {
      /* 忽略 */
    }
    return conn;
  }

  async destroyRawConnection(connection) {
    try {
      connection.close();
    } catch {
      /* 忽略 */
    }
  }

  // 核心：用 node:sqlite 同步 API 执行 knex 编译好的 SQL。
  // knex 的 SQLite 编译器产出 `?` 占位 + 数组绑定，与 node:sqlite 完全兼容。
  // 说明：StatementSync 由 Node GC 自动回收，无需（在 v22 亦无）finalize 方法。
  _query(connection, obj) {
    if (!obj.sql) throw new Error("The query is empty");

    const bindings = normalizeBindings(obj.bindings);
    const useRun = ["insert", "update"].includes(obj.method)
      ? !obj.returning
      : ["del", "counter"].includes(obj.method);

    const stmt = connection.prepare(obj.sql);
    try {
      if (useRun) {
        const info = stmt.run(...bindings);
        obj.context = {
          lastID: Number(info.lastInsertRowid ?? 0),
          changes: info.changes ?? 0,
        };
      } else {
        obj.response = stmt.all(...bindings);
      }
    } catch (err) {
      err.message = `[sqlite-node] 执行失败: ${err.message} | SQL: ${obj.sql}`;
      throw err;
    }

    return Promise.resolve(obj);
  }

  validateConnection(connection) {
    return !!connection;
  }
}

Object.assign(SqliteAdapter.prototype, {
  dialect: "sqlite3",
  driverName: "sqlite3-node",
});

export default SqliteAdapter;