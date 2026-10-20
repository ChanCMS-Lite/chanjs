/**
 * 时间格式化工具
 */
const TIME_TOKENS = [
  [/Y{2,4}/, 'getFullYear'],
  [/M{2}/, 'getMonth', 1],
  [/D{2}/, 'getDate'],
  [/H{2}/, 'getHours'],
  [/m{2}/, 'getMinutes'],
  [/s{2}/, 'getSeconds'],
];

const pad = (n, len = 2) => String(n).padStart(len, "0");

/**
 * 格式化时间戳为指定格式
 * @param {number|string|Date} timestamp 时间戳/日期字符串/Date 对象
 * @param {string} [format='YYYY-MM-DD HH:mm:ss'] 输出格式
 * @returns {string}
 */
export function formatTime(timestamp, format = 'YYYY-MM-DD HH:mm:ss') {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return String(timestamp ?? '');
  return format.replace(/Y{2,4}|M{2}|D{2}|H{2}|m{2}|s{2}/g, m => {
    for (const [re, fn, off = 0] of TIME_TOKENS) {
      if (re.test(m)) return pad(date[fn]() + off, m.length);
    }
    return m;
  });
}

/**
 * 格式化对象/数组中的日期字段
 * @param {Object|Array<Object>} data
 * @param {string[]} fields 需要格式化的字段名数组
 * @returns {Object|Array<Object>}
 */
export function formatDateFields(data, fields) {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(item => formatDateFields(item, fields));
  if (!Array.isArray(fields) || !fields.length) return data;
  const result = { ...data };
  for (const field of fields) {
    if (result[field]) result[field] = formatTime(result[field]);
  }
  return result;
}
