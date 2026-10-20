import artTemplate from "art-template";
import dayjs from "dayjs";
import { createRequire } from "module";
import relativeTime from "dayjs/plugin/relativeTime.js";
import "dayjs/locale/zh-cn.js";
import { marked } from "marked";
import logger from "../utils/logger.js";

const require = createRequire(import.meta.url);

// 初始化日期工具
dayjs.extend(relativeTime);
dayjs.locale("zh-cn");
// 关闭模板原生NodeJS语法，安全隔离
artTemplate.defaults.native = false;

/**
 * 日期格式化
 * @param {Date|string|number} date
 * @param {string} format
 * @returns {string}
 */
artTemplate.defaults.imports.dateFormat = (date, format) => {
  if (!date) return "";
  const d = dayjs(["string", "number", "object"].includes(typeof date) ? date : null);
  return d.isValid() ? d.format(format) : "";
};

/**
 * 相对时间（刚刚/几分钟前）
 * @param {Date|string|number} date
 * @returns {string}
 */
artTemplate.defaults.imports.timeAgo = date => {
  if (!date) return "";
  const d = dayjs(date);
  return d.isValid() ? d.fromNow() : "";
};

/**
 * 字符串截断
 * @param {string} str
 * @param {number} [length=10]
 * @returns {string}
 */
artTemplate.defaults.imports.truncate = (str, length = 10) =>
  str?.length > length ? `${str.slice(0, length)}...` : str || "";

/**
 * 安全序列化JSON，防原型污染
 * @param {any} obj
 * @param {string[]} [keys] 指定输出字段
 * @returns {string}
 */
artTemplate.defaults.imports.safeStringify = (obj, keys) => {
  if (!obj) return "null";
  if (Array.isArray(keys) && keys.length) {
    const filtered = {};
    keys.forEach(k => {
      if (Object.prototype.hasOwnProperty.call(obj, k)) filtered[k] = obj[k];
    });
    return JSON.stringify(filtered, null, 2);
  }
  return JSON.stringify(obj, null, 2);
};

/**
 * 获取对象key列表
 * @param {object} obj
 * @param {string} [separator="\n"]
 * @returns {string}
 */
artTemplate.defaults.imports.objKeys = (obj, separator = "\n") =>
  typeof obj === "object" && obj ? Object.keys(obj).join(separator) : "";

/**
 * Markdown渲染 + XSS过滤
 * @param {string} content
 * @param {"md"|"rich"} [editorType="rich"]
 * @param {0|1} [allowScript=0] 1=信任内容不做XSS过滤
 * @returns {string}
 */
artTemplate.defaults.imports.renderContent = (content, editorType = "rich", allowScript = 0) => {
  if (typeof content !== "string") return content || "";
  let html = content;

  if (editorType === "md") {
    try {
      // marked v4+ 支持异步扩展，返回 string | Promise<string>
      // 同步场景下直接取结果；若返回 Promise 则降级为空字符串
      const result = marked.parse(content);
      html = typeof result === "string" ? result : "";
    } catch (e) {
      logger.error(`[renderContent] MD解析失败: ${e.message}`);
    }
  }

  // 正文 XSS 已在后台保存时统一 sanitize（sanitizeRichText），
  // 此处不再二次转义，避免破坏第三方嵌入（B站 iframe）与自定义 class 样式。
  return html;
};

/**
 * art-template模板引擎中间件
 * @param {express.Application} app
 * @param {{views:string[],NODE_ENV:string}} config
 */
export const template = (app, config) => {
  const { views, NODE_ENV } = config;
  const isProduction = ["production", "prd"].includes(NODE_ENV);
  logger.info("模板缓存开启:", isProduction);

  app.set("view options", {
    debug: !isProduction,
    cache: isProduction,
    minimize: true,
  });
  app.set("view engine", "html");
  app.set("views", [...views]);

  try {
    app.engine(".html", require("express-art-template"));
  } catch (err) {
    logger.error(`[template] 模板引擎加载失败，启用降级渲染: ${err.message}`);
    app.engine(".html", (path, _, cb) => cb(null, `<pre>模板降级: ${path}</pre>`));
  }
};