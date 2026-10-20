import fs from "fs";
import path from "path";
import i18next from "i18next";
import { Paths } from "../utils/paths.js";

const FALLBACK = "zh-CN";
const LOCALE_REGEX = /^[a-zA-Z_-]+$/;

/**
 * 初始化 i18n（基于 i18next）
 *
 * 启动时扫描 lang/ 目录，加载全部 locale 的 JSON 资源到内存。
 * 运行时通过 i18next.t("key") 查找，O(1) 复杂度，零 I/O 开销。
 *
 * @param {string} [locale="zh-CN"] - 默认语言
 * @returns {Promise<typeof i18next>} i18next 实例
 *
 * @example
 * // lang/zh-CN/common.json: { "user.welcome": "欢迎，{{name}}" }
 * i18next.t("user.welcome", { name: "张三" });  // → "欢迎，张三"
 */
export async function initLang(locale = FALLBACK) {
  const langDir = path.join(Paths.rootPath, "lang");
  /** @type {Record<string, Record<string, object>>} resources[locale][namespace] */
  const resources = {};

  if (fs.existsSync(langDir)) {
    for (const loc of fs.readdirSync(langDir)) {
      if (!LOCALE_REGEX.test(loc)) continue;
      const locDir = path.join(langDir, loc);
      if (!fs.statSync(locDir).isDirectory()) continue;

      resources[loc] = {};
      for (const file of fs.readdirSync(locDir).filter(f => f.endsWith(".json"))) {
        const ns = file.replace(".json", "");
        try {
          resources[loc][ns] = JSON.parse(fs.readFileSync(path.join(locDir, file), "utf-8"));
        } catch {
          // 单文件解析失败跳过，不阻断启动
        }
      }
    }
  }

  await i18next.init({
    lng: locale,
    fallbackLng: FALLBACK,
    resources,
    defaultNS: "common",
    interpolation: { escapeValue: false },  // 后端不转义
  });

  return i18next;
}

export default initLang;
