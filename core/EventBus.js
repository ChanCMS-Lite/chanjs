import { EventEmitter } from "events";
import logger from "../utils/logger.js";

/**
 * 事件总线：基于 Node 内置 EventEmitter 的轻量封装。
 *
 * 全局实例 event 供中间件/定时任务/工具函数使用；
 * App 实例 this.event 指向同一全局实例；
 * 需要隔离时 new EventBus() 创建独立实例。
 *
 * @example
 * import { event } from "chanjs";
 * const off = event.on("user.login", (uid) => { ... });
 * event.emit("user.login", 1001);
 * off(); // 取消监听
 */
export class EventBus {
  constructor() {
    this._emitter = new EventEmitter();
    this._emitter.setMaxListeners(50);
  }

  /**
   * 注册监听器，返回取消函数
   * @param {string} event - 事件名
   * @param {(...args: any[]) => void} listener - 监听回调
   * @returns {() => void} 取消监听函数
   */
  on(event, listener) {
    this._emitter.on(event, listener);
    return () => this._emitter.off(event, listener);
  }

  /**
   * 只监听一次，触发后自动移除
   * @param {string} event - 事件名
   * @param {(...args: any[]) => void} listener - 监听回调
   */
  once(event, listener) {
    this._emitter.once(event, listener);
  }

  /**
   * 触发事件（同步逐个执行监听器，单个异常被隔离记录，不中断后续监听器）
   * @param {string} event - 事件名
   * @param {...any} args - 传递给监听器的参数
   * @returns {boolean} 是否存在监听器
   */
  emit(event, ...args) {
    const listeners = this._emitter.listeners(event);
    for (const fn of listeners) {
      try {
        fn(...args);
      } catch (err) {
        logger.error(`[EventBus] 监听器执行异常 event:${event}: ${err.message}`, err);
      }
    }
    return listeners.length > 0;
  }

  /**
   * 移除指定监听器
   * @param {string} event - 事件名
   * @param {Function} listener - 要移除的回调引用
   */
  off(event, listener) {
    this._emitter.off(event, listener);
  }

  /**
   * 移除某事件的全部监听器
   * @param {string} event - 事件名
   */
  removeAll(event) {
    this._emitter.removeAllListeners(event);
  }

  /**
   * 获取某事件的监听器数量
   * @param {string} event - 事件名
   * @returns {number}
   */
  count(event) {
    return this._emitter.listenerCount(event);
  }

  /**
   * 移除所有事件的全部监听器（优雅停机时调用，防内存泄漏）
   */
  destroy() {
    this._emitter.removeAllListeners();
  }
}

/** 全局共享实例：任何模块 import { event } from "chanjs" 即可用 */
export const event = new EventBus();

export default event;
