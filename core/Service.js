/**
 * Service 基类 - 纯业务逻辑层（无表绑定、无 CRUD 方法）
 * 业务子类注入多个 Repository 做跨表事务编排
 */
import { Container } from "./Container.js";

export class Service extends Container {
  constructor() {
    super('service');
  }
}