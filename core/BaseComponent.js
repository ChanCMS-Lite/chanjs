import { getApp } from "./registry.js";

/**
 * 轻量基础组件类：提供 app / config / db 快捷访问
 * Controller / Service / Repository 统一继承此类，
 * 不再强制绑定组件加载（Container）职责。
 */
export class BaseComponent {
  /** 获取全局应用实例 */
  get app() { return getApp(); }

  /**
   * 全局配置快捷访问
   * 业务 Controller/Service/Repository 大量使用 `this.config.xxx` 读取配置项
   * 统一从 app.config 取，未初始化时返回空对象避免 undefined.xxx 报错
   */
  get config() {
    return this.app?.config ?? {};
  }

  /** 数据库连接快捷访问（默认连接） */
  get db() {
    return this.app?.db ?? null;
  }
}

export default BaseComponent;
