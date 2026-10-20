import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { Paths } from "../utils/paths.js";

/**
 * 框架运行默认常量
 * 1. 优雅停机强制退出超时(ms)
 * 2. 请求体最大限制
 * 3. 单条 beforeStart 启动钩子超时阈值(ms)
 * 4. 数据库慢查询阈值(ms)，超过则记 warn 日志
 */

export const SHUTDOWN_TIMEOUT = 5000;

export const BODY_LIMIT = "10mb";

export const HOOK_TIMEOUT = 10000;

export const SLOW_THRESHOLD = 200;

/**
 * @description {string}
 * @description 环境文件加载工具 获取当前生效的环境文件名
 * 优先级：进程自定义ENV_FILE > NODE_ENV区分dev/prd
 */
export function getEnvFilePath() {
  return process.env.ENV_FILE || (process.env.NODE_ENV === "dev" ? ".env.dev" : ".env.prd");
}

/**
 * @description {void}
 * @description 环境文件加载工具 加载对应环境env文件，文件不存在静默跳过，不阻断启动
 */
export function loadDotEnv() {
  const envName = getEnvFilePath();
  const envPath = path.resolve(Paths.rootPath, envName);

  // 文件存在才加载，不存在直接跳过
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}
