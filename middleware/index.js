/**
 * middleware 模块聚合导出
 *
 * 说明：响应压缩（compress）已从框架移除——生产环境由 Nginx gzip 统一处理，
 * 无需在 Node 层重复实现。
 */
export { Cors } from "./cors.js";
export { body } from "./body.js";
export { cookie } from "./cookie.js";
export { favicon } from "./favicon.js";
export { header } from "./header.js";
export { staticMw } from "./static.js";
export { template } from "./template.js";
export { waf, wafBody } from "./waf.js";
export { log } from "./log.js";
export { health } from "./health.js";
