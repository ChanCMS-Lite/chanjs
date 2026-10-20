import fs from "fs";
import path from "path";
import { Paths } from "../utils/paths.js";
import { BaseComponent } from "./BaseComponent.js";
import { importFile } from "./loader.js";
import logger from "../utils/logger.js";

const NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * 组件容器：按需动态加载 controller/service 组件（组合模式）
 * 继承 BaseComponent 获得 app/config/db 访问，额外提供组件加载能力
 */
export class Container extends BaseComponent {
  constructor(type = "service") {
    super();
    this._componentCache = new Map();
    this._type = type;
    this._baseDir = Paths.modulesPath;
  }

  /**
   * 按需获取组件实例
   * - 成功：永久缓存（进程生命周期内不失效）
   * - 缺失：不缓存，每次实时探测，文件新增后立即感知
   * - 跨模块/跨类型：默认取本容器类型（controller/service），可传 type 覆盖，
   *   例如 Controller 里取其他模块的 Service：await this.get("book", "Book", "service")
   * @param {string} moduleName - 模块名
   * @param {string} fileName - 组件文件名（不含 .js）
   * @param {("controller"|"service")} [type=this._type] - 组件类型，默认本容器类型
   * @returns {Promise<object|null>}
   */
  async get(moduleName, fileName, type = this._type) {
    const cacheKey = `${type}.${moduleName}.${fileName}`;
    const hit = this._componentCache.get(cacheKey);

    // 命中成功缓存，直接返回
    if (hit) return hit;

    // 未命中，实时加载
    let instance;
    try {
      instance = await this._loadFile(moduleName, fileName, type);
    } catch (err) {
      logger.error(`[Container] 加载组件失败 ${moduleName}/${fileName}: ${err.message}`);
      instance = null;
    }

    if (instance) {
      // 成功才缓存，永久有效
      this._componentCache.set(cacheKey, instance);
    } else {
      logger.info(`[Container] ${moduleName}/${type}/${fileName}.js 不存在`);
    }
    return instance;
  }

  /** 手动清除指定组件缓存 */
  invalidate(moduleName, fileName, type = this._type) {
    this._componentCache.delete(`${type}.${moduleName}.${fileName}`);
  }

  /** 清除全部缓存 */
  invalidateAll() {
    this._componentCache.clear();
  }

  /**
   * 物理加载文件、导入模块、安全校验
   *
   * 职责分层（组件加载唯一核心）：
   * 1. 本方法只做「用户输入校验」（模块/文件名白名单 + 路径越界）与「存在性探测」
   * 2. 文件导入统一委托 loader.importFile（access + pathToFileURL + default 提取 + IO 错误日志），
   *    与 loadController/loadConfig 共享同一原语，避免两套导入实现行为漂移
   * @private
   */
  async _loadFile(moduleName, fileName, type = this._type) {
    if (!NAME_REGEX.test(moduleName) || !NAME_REGEX.test(fileName) || !NAME_REGEX.test(type)) {
      throw new Error(`非法名称 ${moduleName}/${fileName}`);
    }

    const filePath = path.resolve(this._baseDir, moduleName, type, `${fileName}.js`);
    const rel = path.relative(this._baseDir, filePath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`路径越界: ${filePath}`);
    }

    // 存在性是预期内路径（按需探测），静默返回 null 交给 get 打 info 日志
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      return null;
    }

    // 项目约定组件必须是实例对象（export default new XxxService()）；
    // 只导出类/函数的文件视为无效组件，不缓存不报错（与 loadController 的过滤口径一致）
    const mod = await importFile(filePath);
    return mod && typeof mod === "object" ? mod : null;
  }
}

export default Container;
