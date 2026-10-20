import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { Paths } from "../utils/paths.js";
import logger from "../utils/logger.js";

const BOUND_SYMBOL = Symbol("chanjs:bound");
const JS_SUFFIX = /\.js$/i;

/**
 * 动态导入文件，捕获常见IO异常
 * @param {string} filepath
 * @returns {Promise<any|null>}
 */
export async function importFile(filepath) {
  if (!filepath || typeof filepath !== "string") {
    logger.error("[Loader] 文件路径非法");
    return null;
  }
  try {
    await fsp.access(filepath);
    const mod = await import(pathToFileURL(filepath).href);
    return mod.default ?? mod;
  } catch (err) {
    // 详情必须拼进 msg 本身：logger 的 messageFormat 仅输出 msg 字段，第二参数会被 pino-pretty 忽略导致错误原因丢失
    if (err.code === "ENOENT") logger.error(`[Loader] 文件不存在: ${filepath}`);
    else if (err.code === "EACCES") logger.error(`[Loader] 无访问权限: ${filepath}`);
    else logger.error(`[Loader] 导入失败 ${filepath}: ${err?.message || err}`);
    return null;
  }
}

/**
 * 加载根配置 index.js
 */
export async function loadConfig() {
  const cfg = await importFile(path.join(Paths.configPath, "index.js"));
  return cfg ?? {};
}

/**
 * 加载指定模块全部Controller，自动绑定实例方法防this丢失
 * @param {string} moduleName
 * @returns {Record<string, any>}
 */
export async function loadController(moduleName) {
  const ctrlDir = path.join(Paths.modulesPath, moduleName, "controller");
  const ctrlMap = {};

  if (!fs.existsSync(ctrlDir)) {
    logger.error(`[Loader] 控制器目录不存在: ${ctrlDir}`);
    return ctrlMap;
  }

  const jsFiles = fs.readdirSync(ctrlDir).filter(f => JS_SUFFIX.test(f));
  for (const file of jsFiles) {
    const filePath = path.join(ctrlDir, file);
    const ctrlName = file.replace(JS_SUFFIX, "");
    const inst = await importFile(filePath);
    if (!inst || typeof inst !== "object") continue;

    // 原型方法批量bind，幂等标记避免重复绑定
    // 遍历整条原型链（含父类继承的方法）：子类方法定义在自身原型、父类模板方法定义在父类原型，
    // 只 bind 直接原型会导致继承方法 this 丢失（Express 非点调用时 this=undefined）。
    // 必须用 getOwnPropertyDescriptor 取 value：BaseComponent 的 app/config/db 是 getter-only，
    // 其中 db 返回 knex 实例（typeof 为 function），直接 inst[key] 会触发 getter 且赋值只读属性抛错。
    let proto = Object.getPrototypeOf(inst);
    while (proto && proto !== Object.prototype) {
      Object.getOwnPropertyNames(proto).forEach(key => {
        if (key === "constructor") return;
        const desc = Object.getOwnPropertyDescriptor(proto, key);
        // 只 bind 数据方法（value 为函数）；getter/setter 访问器跳过
        if (!desc || typeof desc.value !== "function") return;
        const fn = desc.value;
        if (fn[BOUND_SYMBOL]) return;
        const boundFn = fn.bind(inst);
        Object.defineProperty(boundFn, BOUND_SYMBOL, {
          value: true, enumerable: false, writable: false, configurable: false
        });
        inst[key] = boundFn;
      });
      proto = Object.getPrototypeOf(proto);
    }

    ctrlMap[ctrlName] = inst;
  }
  return ctrlMap;
}