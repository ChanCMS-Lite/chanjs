import cron from "node-cron";
import logger from "../utils/logger.js";

const NAME_REGEX = /^[a-zA-Z0-9_-]{1,50}$/;

/**
 * 定时任务管理器：基于 node-cron 封装。
 *
 * - cron 表达式校验，非法表达式跳过注册并告警，不阻断应用启动
 * - 回调异常自动捕获并记录日志，不会导致进程崩溃
 * - 优雅停机时调用 stopAll() 清理全部定时器
 *
 * @example
 * chan.task.add("clear-log", "0 3 * * *", async () => {
 *   await chan.db.raw("DELETE FROM logs WHERE created_at < NOW() - INTERVAL 7 DAY");
 * });
 */
export class Task {
  constructor() {
    /** @type {Map<string, import("node-cron").ScheduledTask>} */
    this._tasks = new Map();
  }

  /**
   * 注册定时任务
   *
   * 校验失败（任务名非法 / cron 表达式非法 / 任务已存在 / 回调非函数）
   * 仅打印 error 日志并返回 null，不抛异常、不阻断应用启动。
   *
   * @param {string} name - 任务名（唯一标识）
   * @param {string} expr - cron 表达式（5 段，如 "0 3 * * *"）
   * @param {(task: Task) => Promise<void>|void} fn - 任务回调
   * @param {{ start?: boolean, timezone?: string }} [opts] - 选项
   * @returns {import("node-cron").ScheduledTask|null} 任务实例，校验失败返回 null
   */
  add(name, expr, fn, { start = true, timezone } = {}) {
    if (!NAME_REGEX.test(name)) {
      logger.error(`[Task] 注册失败，非法任务名: ${name}，已跳过`);
      return null;
    }
    if (!cron.validate(expr)) {
      logger.error(`[Task] 注册失败，任务 ${name} 非法 cron 表达式: ${expr}，已跳过`);
      return null;
    }
    if (this._tasks.has(name)) {
      logger.error(`[Task] 注册失败，任务已存在: ${name}，已跳过`);
      return null;
    }
    if (typeof fn !== "function") {
      logger.error(`[Task] 注册失败，任务 ${name} 回调必须为函数，已跳过`);
      return null;
    }

    const task = cron.schedule(expr, async () => {
      const t0 = Date.now();
      try {
        await fn(this);
        logger.info(`[Task] ${name} 完成 (${Date.now() - t0}ms)`);
      } catch (err) {
        // 捕获异常防进程崩溃，记录日志供排查
        logger.error(`[Task] ${name} 异常: ${err.message}`, err);
      }
    }, { timezone });

    if (!start) task.stop();
    this._tasks.set(name, task);
    return task;
  }

  /** 启动指定任务 */
  start(name) { this._tasks.get(name)?.start(); }

  /** 停止指定任务 */
  stop(name) { this._tasks.get(name)?.stop(); }

  /** 获取全部任务名列表 */
  list() { return [...this._tasks.keys()]; }

  /** 优雅停机：停止全部任务并清空注册表 */
  stopAll() {
    for (const task of this._tasks.values()) task.stop();
    this._tasks.clear();
    logger.info("[Task] 全部定时任务已停止");
  }
}

export default Task;
