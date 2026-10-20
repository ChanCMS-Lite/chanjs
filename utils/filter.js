/**
 * 从对象数组批量筛选指定字段，返回全新数组与全新对象，不修改原始入参数据
 * @example
 *   filterFields([{ id: 1, name: '张三', age: 25 }], ['id', 'name'])
 *   // [{ id: 1, name: '张三' }]
 * @param {Array<Object>} data 原始对象数组
 * @param {string[]} fields 需要保留的字段名列表
 * @returns {Array<Object>} 仅包含指定字段的新对象数组
 */
export function filterFields(data, fields) {
  // 校验数组参数，非数组直接返回空数组
  if (!Array.isArray(data)) return [];
  // 字段列表非数组/空数组直接返回空对象数组
  if (!Array.isArray(fields) || fields.length === 0) return data.map(() => ({}));

  return data.map((item) => {
    // 当前项不是普通对象，返回空对象规避取值报错
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return {};
    }
    const filtered = {};
    for (const field of fields) {
      // 跳过非字符串字段名，避免异常key
      if (typeof field !== "string") continue;
      // 使用原型方法，防止item重写hasOwnProperty造成原型污染漏洞
      if (Object.prototype.hasOwnProperty.call(item, field)) {
        filtered[field] = item[field];
      }
    }
    return filtered;
  });
}