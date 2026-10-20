/**
 * HTML 处理工具
 * 提供 HTML 实体编解码、script标签深度转义、HTML文本提取图片URL功能
 */

/**
 * 标准 HTML 实体编码（适配 art-template {{ }} 插值输出）
 * @param {any} str 待转义文本
 * @returns {string}
 */
export function htmlEncode(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 深度危险标签二次转义（适配 art-template {{@ }} 原始输出防XSS）
 * 双重转义 script/iframe/object/embed/form 标签
 * @param {any} str 待处理HTML文本
 * @returns {string}
 */
export const escapeScript = (str) => {
  if (typeof str !== 'string') return '';
  // 一次性匹配所有危险开始/结束标签，统一替换为双重转义
  return str.replace(/<\/?(script|iframe|object|embed|form)\b[^>]*>/gi, (match) => {
    return match.replace(/</g, '&amp;lt;').replace(/>/g, '&amp;gt;');
  });
};

/**
 * HTML 实体解码
 * 支持：命名实体(amp/lt/gt/quot/apos/nbsp)、十进制数字实体、十六进制Unicode实体
 * @param {any} str 带实体编码的字符串
 * @returns {string}
 */
const NAMED_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };

export function htmlDecode(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, match => NAMED_ENTITIES[match])
    .replace(/&#x([0-9a-f]+);/gi, (_, hexStr) => {
      try { return String.fromCodePoint(parseInt(hexStr, 16)); }
      catch { return ''; }
    })
    .replace(/&#(\d+);/g, (_, decStr) => {
      try { return String.fromCodePoint(parseInt(decStr, 10)); }
      catch { return ''; }
    });
}

/**
 * 从HTML字符串中批量提取全部img标签src图片地址
 * @param {string} str 富文本/HTML源码
 * @returns {string[]}
 */
export function filterImgFromStr(str) {
  if (typeof str !== 'string' || str.trim() === '') return [];

  const imgReg = /<img\b[^>]*?(?:>|\/>)/gi;
  const srcReg = /src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

  const tagList = str.match(imgReg);
  if (!tagList) return [];

  return tagList
    .map(tag => tag.match(srcReg)?.[1]?.trim())
    .filter(Boolean);
}
