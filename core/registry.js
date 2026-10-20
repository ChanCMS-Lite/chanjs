/**
 * 全局单应用实例注册表
 * 全局仅维护单个Chan实例，多实例采用多进程方案
 */
let _current = null;

/** 设置全局应用实例 */
export function setApp(app) {
  _current = app;
}

/** 获取全局应用实例，未初始化返回null */
export function getApp() {
  return _current;
}

export default { setApp, getApp };