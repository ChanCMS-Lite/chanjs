/**
 * 分页工具函数
 * 输出无 ul/li 的干净 HTML：普通页码直接用 <a>，当前页/禁用/省略号用 <span class="current|disabled|ellipsis">
 * 样式由项目 CSS（如 .blince-pagination）统一维护，不依赖 Tailwind 等第三方框架
 */

/**
 * 解析页码：非数字/0/负数统一回落 1，防 NaN 或负数穿透进 SQL LIMIT/OFFSET
 * （?page=abc 这类脏值若直接 parseInt 后进查询，NaN 会让 knex LIMIT 报错）
 * @param {*} value 页码来源（req.query / req.params 原始值）
 * @returns {number} 至少为 1 的整数页码
 */
export function parsePage(value) {
  return Math.max(1, parseInt(value, 10) || 1);
}

/**
 * 解析每页条数：非数字回落 fallback，并钳制 [1, max] 区间防大值拖垮 DB
 * @param {*} value pageSize 来源（req.query / req.params 原始值）
 * @param {number} [fallback=10] 非法/缺省时的默认条数
 * @param {number} [max=100] 上限（来自公开 query 的值必须有上限）
 * @returns {number} 钳制后的整数条数
 */
export function parsePageSize(value, fallback = 10, max = 100) {
  return Math.min(Math.max(parseInt(value, 10) || fallback, 1), max);
}

/**
 * 渲染 query 式分页 HTML（?current=N，保留筛选参数）
 * 与 pages() 的分工：pages() 面向 /list-2.html 路径式分页（SEO 静态 URL，带省略号）；
 * 本函数面向带筛选条件的列表页——URLSearchParams 自动编码参数，天然防注入
 * @param {Object} opts
 * @param {string} opts.baseUrl 基础路径（如 /blog.html）
 * @param {Object} [opts.query] 当前 URL query 对象，翻页时原样保留（剔除 current）
 * @param {number} opts.total 总记录数
 * @param {number} [opts.pageSize=10] 每页条数
 * @param {number} [opts.current=1] 当前页码
 * @param {string} [opts.unit="篇"] 统计文案量词（篇/家/条…）
 * @param {number} [opts.window=2] 当前页前后各显示页数（窗口共 2*window+1 页）
 * @returns {string} 总页数 ≤1 时返回空串
 */
export function pageHtml({ baseUrl, query, total, pageSize = 10, current = 1, unit = "篇", window = 2 }) {
  total = parseInt(total) || 0;
  current = parsePage(current);
  pageSize = parsePageSize(pageSize);
  const totalPage = Math.max(1, Math.ceil(total / pageSize));
  if (totalPage <= 1) return "";

  const base = new URLSearchParams();
  Object.entries(query || {}).forEach(([k, v]) => {
    if (k === "current" || v === undefined || v === null || v === "") return;
    base.set(k, v);
  });
  const link = (n) => {
    const p = new URLSearchParams(base);
    if (n > 1) p.set("current", n);
    const s = p.toString();
    return `${baseUrl}${s ? "?" + s : ""}`;
  };
  const pageLink = (n) =>
    n === current ? `<span class="current">${n}</span>` : `<a href="${link(n)}">${n}</a>`;

  let html = "";
  if (current > 1) html += `<a href="${link(current - 1)}">上一页</a>`;
  let start = Math.max(1, current - window);
  let end = Math.min(totalPage, start + window * 2);
  start = Math.max(1, end - window * 2);
  for (let i = start; i <= end; i++) html += pageLink(i);
  if (current < totalPage) html += `<a href="${link(current + 1)}">下一页</a>`;
  html += `<span class="disabled">共 ${total} ${unit} / ${totalPage} 页</span>`;
  return html;
}

/**
 * 渲染分页HTML
 * @param {number} current 当前页码
 * @param {number} total 总记录数
 * @param {number} pageSize 每页大小
 * @param {string} href 链接基础路径
 * @param {string} [query=''] 查询参数字符串
 * @returns {string}
 */
export function pages(current, total, pageSize, href, query = '') {
  current = Math.max(1, parseInt(current) || 1);
  total = parseInt(total) || 0;
  pageSize = parseInt(pageSize) || 10;

  const totalPage = Math.ceil(total / pageSize);
  if (totalPage <= 1) return '';
  if (current > totalPage) current = totalPage;

  const pageLink = (i, text) => i === current
    ? `<span class="current">${text || i}</span>`
    : `<a href="${href}${i}.html${query}">${text || i}</a>`;
  const navLink = (i, text) => i
    ? pageLink(i, text)
    : `<span class="disabled">${text}</span>`;
  const ellipsis = () => `<span class="ellipsis">...</span>`;
  const items = [];

  // 上一页
  items.push(navLink(current - 1, "上一页"));

  // 页码
  if (totalPage <= 7) {
    for (let i = 1; i <= totalPage; i++) items.push(pageLink(i));
  } else if (current <= 4) {
    for (let i = 1; i <= 5; i++) items.push(pageLink(i));
    items.push(ellipsis(), pageLink(totalPage));
  } else if (current >= totalPage - 3) {
    items.push(pageLink(1), ellipsis());
    for (let i = totalPage - 4; i <= totalPage; i++) items.push(pageLink(i));
  } else {
    items.push(pageLink(1), ellipsis());
    for (let i = current - 1; i <= current + 1; i++) items.push(pageLink(i));
    items.push(ellipsis(), pageLink(totalPage));
  }

  // 下一页
  items.push(navLink(current + 1, "下一页"));

  return items.join("");
}
