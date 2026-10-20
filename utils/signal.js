import logger from "./logger.js";
import { store } from "../storage/index.js";
import { setApp } from "../core/registry.js";
import { SHUTDOWN_TIMEOUT } from "../config/index.js";

/**
 * 优雅停机：统一处理进程信号监听、资源关闭、超时保护
 * 模块级状态，进程内单例
 */
let registered = false;
let shuttingDown = false;

/**
 * 优雅停机资源关闭顺序：
 * 1. HTTP 服务 → 拒绝新连接
 * 2. 定时任务 → 停止调度，防止停机期间仍触发任务
 * 3. 缓存存储 → 关闭 Redis/内存
 * 4. 数据库连接 → 释放连接池
 * 5. 事件总线 → 清理监听器防内存泄漏
 */
async function doShutdown(chan) {
  const { dbManager, server, task, event } = chan;

  if (server) {
    try {
      // 先断开空闲 keep-alive 连接，避免 server.close 等待存量长连接拖满停机超时
      typeof server.closeIdleConnections === "function" && server.closeIdleConnections();
      await new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
      logger.info("[Chan] HTTP服务已停止接受新连接");
    } catch (e) {
      logger.warn(`[Chan] 关闭HTTP服务异常：${e.message}`);
    }
  }

  const errors = [];

  // 停止定时任务（同步操作，异常极少，单独捕获）
  if (task) {
    try { task.stopAll(); }
    catch (e) { errors.push({ type: "task", err: e.message }); }
  }

  try { await store.close(); }
  catch (e) { errors.push({ type: "store", err: e.message }); }

  if (dbManager) {
    const results = await dbManager.closeAll();
    results.filter(item => !item.success).forEach(item => errors.push({ type: `db:${item.name}`, err: item.error }));
  }

  // 清理事件总线全部监听器（防内存泄漏）
  if (event) {
    try { event.destroy(); }
    catch (e) { errors.push({ type: "event", err: e.message }); }
  }

  if (errors.length) logger.warn(`[Chan] 停机存在${errors.length}处资源关闭失败`, errors);
  setApp(null);
}

/** 注册进程信号监听 */
export function register(chan) {
  if (registered) {
    logger.warn("[Chan] 优雅停机已注册，跳过重复绑定");
    return;
  }
  registered = true;

  const shutdownTimeout = chan.config?.SHUTDOWN_TIMEOUT ?? SHUTDOWN_TIMEOUT;

  const handleSignal = async (signal) => {
    if (shuttingDown) {
      logger.error(`[Chan] 停机中重复接收信号 ${signal}，强制终止`);
      return process.exit(1);
    }
    shuttingDown = true;
    logger.info(`[Chan] 收到停机信号 ${signal}，开始优雅停机`);

    const exitTimer = setTimeout(() => {
      logger.error(`[Chan] 停机超时(${shutdownTimeout}ms)，强制退出`);
      process.exit(1);
    }, shutdownTimeout);

    try {
      await doShutdown(chan);
      logger.info("[Chan] 优雅停机完成");
      process.exit(0);
    } catch (err) {
      logger.error("[Chan] 停机异常", err);
      process.exit(1);
    } finally {
      clearTimeout(exitTimer);
    }
  };

  process.on("SIGTERM", () => void handleSignal("SIGTERM"));
  process.on("SIGINT", () => void handleSignal("SIGINT"));
  process.on("SIGQUIT", () => void handleSignal("SIGQUIT"));
}

/** 程序化触发停机（不退出进程） */
export async function shutdown(chan) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("[Chan] 开始程序化停机");
  await doShutdown(chan);
  logger.info("[Chan] 程序化停机完成");
}
