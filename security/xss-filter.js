import xss from "xss";

// 以 xss 库默认白名单为底（覆盖 a/p/div/section/video/audio/table 等常规标签），
// 所有标签放行 style / class / id —— 保留排版与样式，过滤不再「太严格」；
// 另补 iframe（src 仅 https），用于合法的视频外链嵌入。
const whiteList = xss.getDefaultWhiteList();
for (const tag of Object.keys(whiteList)) {
  whiteList[tag] = [...new Set([...(whiteList[tag] ?? []), "style", "class", "id"])];
}
whiteList.iframe = ["src", "width", "height", "frameborder", "allow", "allowfullscreen", "style", "class", "id"];

// 自定义过滤：只拦真正危险的内容
const filter = new xss.FilterXSS({
  whiteList,
  onTagAttr: (tag, name, value) => {
    // on* 事件属性（onclick/onerror/onload 等）
    if (name.startsWith("on")) return "";
    // javascript: / vbscript: 协议
    if ((name === "href" || name === "src") && /^\s*(javascript|vbscript):/i.test(value)) return "";
    // iframe src 仅允许 https 外链
    if (tag === "iframe" && name === "src" && !/^https:\/\//i.test(value)) return "";
  },
  // 白名单外标签（如 <script>）转义为纯文本保留，内容不丢、不可执行
  stripIgnoreTag: false,
});

/**
 * 递归深度过滤对象/数组/字符串XSS，WeakSet防循环引用栈溢出
 * 策略：宽白名单 —— 保留 style/class/id 与常规标签，仅剥离脚本执行能力
 *（on* 事件、javascript:/vbscript: 协议、非 https 的 iframe、<script> 实体）。
 * @param {any} data 待清洗数据
 * @param {WeakSet} [visited] 循环引用标记缓存
 * @returns {any} 清洗后数据
 */
export const filterXSS = (data, visited) => {
  // 字符串直接过滤
  if (typeof data === "string") return filter.process(data);

  // 数组遍历递归
  if (Array.isArray(data)) return data.map(item => filterXSS(item, visited));

  // 普通对象处理，循环引用截断
  if (data && typeof data === "object") {
    const vis = visited ?? new WeakSet();
    if (vis.has(data)) return {};
    vis.add(data);

    const target = {};
    for (const key of Object.keys(data)) {
      target[key] = filterXSS(data[key], vis);
    }
    return target;
  }

  // number / boolean / null / undefined 直接原值返回
  return data;
};
