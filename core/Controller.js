import { success, fail } from "../response/response.js";
import Container from "./Container.js";

/**
 * 控制器基类，继承组件容器，内置统一成功/失败响应封装
 * 响应结构 { success, code, msg, data }
 * 错误码规范：0成功 / 1xxx业务 / 5xxx系统 / 6xxx数据库
 */
export default class Controller extends Container {
  constructor() {
    super("controller");
  }

  /**
   * 成功返回，默认code=0
   * @param {{data?: any, msg?: string}} opts
   */
  success({ data, msg = "操作成功" } = {}) {
    return success({ data: data ?? {}, msg });
  }

  /**
   * 失败返回，传字符串直接作为提示文案，默认code=1008
   * @param {string | {msg?: string, code?: number}} opts
   */
  fail(opts = {}) {
    return typeof opts === "string" ? fail({ msg: opts }) : fail(opts);
  }
}