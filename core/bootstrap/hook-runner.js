import logger from "../../utils/logger.js";
import { describeError, errorExtraProps } from "../errors.js";
import { HOOK_TIMEOUT as DEFAULT_HOOK_TIMEOUT } from "../../config/index.js";

/**
 * 带超时限制执行钩子，超时则 reject 跳过该钩子，不阻塞后续启动
 * @param {Function} fn 钩子函数
 * @param {number} timeout 超时毫秒
 * @param {string} tag 钩子标识，用于日志
 * @returns {Promise<void>}
 */
async function runHookWithTimeout(fn, timeout, tag) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`钩子 ${tag} 执行超时(${timeout}ms)，已跳过`)),
      timeout
    );
  });
  try {
    await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 串行执行启动钩子，单钩子超时/报错不阻塞整体启动
 * 仅支持格式：{ name: string, fn: () => Promise<any> }
 * @param {object} chan 框架实例
 */
export async function runHooks(chan) {
  const { hooks = [], config = {} } = chan;
  if (!hooks.length) return;

  const hookTimeout = config.HOOK_TIMEOUT ?? DEFAULT_HOOK_TIMEOUT;

  for (let i = 0; i < hooks.length; i++) {
    const item = hooks[i];
    const seq = i + 1;
    // 支持两种格式：{ name, fn } 对象 或 纯函数（App.beforeStart 注册的是纯函数）
    let name, fn;
    if (typeof item === "function") {
      fn = item;
      name = null;
    } else if (item && typeof item === "object") {
      ({ name, fn } = item);
    }
    const hookTag = name || `hook#${seq}`;

    // 非法钩子直接跳过
    if (typeof fn !== "function") {
      logger.warn(`[ChanHook][${hookTag}] 第${seq}项钩子fn非函数，跳过`);
      continue;
    }

    try {
      await runHookWithTimeout(fn, hookTimeout, hookTag);
    } catch (err) {
      const errLog = describeError(err) + errorExtraProps(err);
      logger.error(`[ChanHook][${hookTag}] 第${seq}个钩子执行异常:\n${errLog}`, err);
    }
  }
}