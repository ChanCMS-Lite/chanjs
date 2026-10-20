import logger from "./logger.js";

/**
 * 通用数据解析工具集
 */

/**
 * 将对象数组转换成键值映射对象
 * 适用于数据库配置列表、字典列表快速转map读取
 * @param {Array<Object>} arr - 原始对象数组
 * @param {string} [keyField="config_key"] - 映射key取自item的哪个字段
 * @param {string} [valueField="config_value"] - 映射value取自item的哪个字段
 * @returns {Record<string, any>} 键值映射对象
 */
export const arrToObj = (arr, keyField = "config_key", valueField = "config_value") => {
  if (!Array.isArray(arr)) {
    logger.error("[arrToObj] 参数类型错误：输入必须为数组", arr);
    return {};
  }
  return arr.reduce((result, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return result;
    const mapKey = item[keyField];
    const mapVal = item[valueField];
    if (mapKey !== undefined && mapVal !== undefined) result[mapKey] = mapVal;
    return result;
  }, {});
};

/**
 * 根据 slug / ID 匹配分类，返回分类完整数据与分类ID
 * @param {string | number} py - 检索条件：slug 字符串 / 数字ID
 * @param {Array<Object>} source - 分类数据源数组
 * @returns {{ cate: Object, id: string|number }}
 */
export function getChildrenId(py, source) {
  if (!Array.isArray(source)) {
    logger.warn("[getChildrenId] 数据源source不是数组", source);
    return { cate: {}, id: "" };
  }
  const cate = source.find(item => item && typeof item === "object" && (item.slug === py || item.id === py)) || {};
  return { cate, id: cate.id ?? "" };
}