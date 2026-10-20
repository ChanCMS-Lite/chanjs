import { KEYWORD_RULES, keywordRegexCache, SORTED_CATEGORIES } from "./keywords.js";

/**
 * Body 扫描时应跳过的分类：这些规则主要描述 URL/路径/文件特征
 * （如 secret/debug/metadata/setup 等英文词、.env/.git 后缀、wholeWord 代码特征），
 * 在正文（评论/文章/会员资料）里极易误杀正常内容，而真实攻击已由
 * sqlInjection / xss / commandInjection / pathTraversal 覆盖。
 */
const BODY_EXCLUDED_CATEGORIES = [
  "wholeWord",
  "extensions",
  "directories",
  "sensitiveIdentifiers",
  "encoding",
];

/**
 * 恶意关键词检测：单次遍历分类列表，利用捕获组直接定位命中关键词
 * @param {string} fullText 待检测文本
 * @param {{scope?: 'body'|'url', categories?: string[]}} [options]
 *   - scope='body' 时跳过路径/文件特征类规则，降低正文误报；
 *   - categories 显式指定要扫描的分类（用于 URL 场景，只保留真正危险分类，避免正常词误伤）；
 *   - 二者都不传则扫描全部分类。
 * @returns {{category: string; keyword: string}|null}
 */
export const checkKeywords = (fullText, { scope, categories } = {}) => {
  const text = fullText?.trim();
  if (!text) return null;

  const cats = Array.isArray(categories)
    ? categories
    : (scope === 'body'
      ? SORTED_CATEGORIES.filter(c => !BODY_EXCLUDED_CATEGORIES.includes(c))
      : SORTED_CATEGORIES);

  for (const cat of cats) {
    const re = keywordRegexCache[cat]?.merged;
    if (!re) continue;
    const match = re.exec(text);
    if (!match) continue;
    // capture[0]是整体匹配，capture[1..]是每个关键词的捕获组
    const idx = match.findIndex((g, i) => i > 0 && g);
    return { category: cat, keyword: KEYWORD_RULES[cat][idx - 1] };
  }
  return null;
};

/**
 * 路径忽略校验：大小写不敏感、自动去除末尾斜杠，支持精确/前缀匹配
 * @param {string} path 当前请求路径
 * @param {string[]} ignorePaths 忽略路径列表
 * @returns {boolean}
 */
export const isIgnored = (path, ignorePaths) => {
  if (!path || !Array.isArray(ignorePaths) || !ignorePaths.length) return false;
  const target = path.trim().toLowerCase().replace(/\/$/, "");
  return ignorePaths.some(raw => {
    const rule = raw.trim().toLowerCase().replace(/\/$/, "");
    return target === rule || target.startsWith(`${rule}/`);
  });
};
