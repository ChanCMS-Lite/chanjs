import logger from "./logger.js";
import dns from "dns";
import { promisify } from "util";

const dnsLookup = promisify(dns.lookup);
const DEFAULT_TIMEOUT = 10000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
/** 重定向跳数上限（逐跳重新过 SSRF 校验） */
const MAX_REDIRECTS = 5;

/** IPv4 私网/回环段 */
const IPV4_PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0$)/;
/** IPv6 私网/链路本地前缀 */
const IPV6_PRIVATE = /^(::1$|fc|fd|fe80:)/i;

/** 判断 IP 是否指向私网/回环（含 IPv4-mapped IPv6） */
function isPrivateIp(ip) {
  if (!ip) return true;
  const v = ip.toLowerCase();
  if (v === "127.0.0.1" || v === "::1") return true;
  if (IPV4_PRIVATE.test(v)) return true;
  const m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return IPV4_PRIVATE.test(m[1]);
  return IPV6_PRIVATE.test(v);
}

/** SSRF 防护：协议白名单 + 主机名解析后 IP 二次校验 */
async function isPrivateUrl(urlStr) {
  let u;
  try { u = new URL(urlStr.trim()); }
  catch { return true; }
  if (!["http:", "https:"].includes(u.protocol)) return true;
  const host = u.hostname.toLowerCase();
  if (!host || host === "localhost") return true;
  if (/^[\d.:a-f]+$/i.test(host)) return isPrivateIp(host);
  try { return isPrivateIp((await dnsLookup(host)).address); }
  catch { return true; }
}

/**
 * HTTP 请求封装：超时/重试/SSRF 防护/大小限制
 * 支持 JSON 和原始数据（Buffer/文本）两种模式
 *
 * SSRF 防护是「逐跳」的：redirect 固定为 "manual"，重定向不自动跟随，
 * 每一跳（含 302/301/307/308 的目标）都重新做协议白名单 + DNS 解析后 IP 校验，
 * 跳数上限 MAX_REDIRECTS。调用方无法通过 options 覆盖 redirect。
 *
 * @param {string} url - 请求地址
 * @param {Object} [options={}] - 请求配置
 * @param {number} [options.timeout=10000] - 超时时间(ms)
 * @param {number} [options.retry=0] - 重试次数
 * @param {boolean} [options.parseJson=true] - 是否 JSON.parse 响应
 * @param {string} [options.responseType] - "arraybuffer" 返回 Buffer
 * @param {number} [options.maxResponseBytes] - 最大响应字节数
 * @returns {Promise<{success:boolean,data:any,error?:string}>}
 */
export async function request(url, options = {}) {
  const rawUrl = String(url ?? "").trim();
  if (!rawUrl) return { success: false, error: "url不能为空" };

  const {
    timeout = DEFAULT_TIMEOUT,
    retry = 0,
    parseJson = true,
    responseType,
    maxResponseBytes = MAX_RESPONSE_BYTES,
    ...rest
  } = options;

  // SSRF 防护（首跳；重定向目标在下方请求循环内逐跳校验）
  if (await isPrivateUrl(rawUrl)) {
    return { success: false, error: `SSRF防护拦截：${rawUrl}` };
  }

  // 构建 fetch 选项
  const fetchOpts = {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    ...rest
  };

  // body 序列化
  if (fetchOpts.body && typeof fetchOpts.body !== "string") {
    try {
      fetchOpts.body = JSON.stringify(fetchOpts.body);
    } catch (err) {
      return { success: false, error: `请求体JSON序列化失败: ${err.message}` };
    }
  }

  // 重试循环
  for (let attempt = 0; attempt <= retry; attempt++) {
    const controller = new AbortController();
    const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;

    try {
      // 重定向逐跳处理：redirect:"manual" 让 fetch 不自动跟随，由本循环接管，
      // 并对「每一跳」重新做 SSRF 校验。
      // 旧实现未设 redirect（默认 "follow"）且只校验了首个 URL ——
      // 公网地址返回 302 指向 127.0.0.1 / 169.254.169.254 即可绕过防护。
      // 注意：redirect 放在 ...fetchOpts 之后，调用方无法覆盖该安全约束。
      let currentUrl = rawUrl;
      let res;
      for (let hop = 0; ; hop++) {
        if (hop > MAX_REDIRECTS) {
          if (timer) clearTimeout(timer);
          return { success: false, error: `重定向次数超过上限(${MAX_REDIRECTS})：${rawUrl}` };
        }
        res = await fetch(currentUrl, { ...fetchOpts, redirect: "manual", signal: controller.signal });
        // 非 3xx 即最终响应
        if (!(res.status >= 300 && res.status < 400)) break;

        const loc = res.headers.get("location");
        // 释放重定向响应体，避免 socket 泄漏
        try { await res.body?.cancel(); } catch { /* 已关闭则忽略 */ }
        if (!loc) {
          if (timer) clearTimeout(timer);
          return { success: false, error: `HTTP ${res.status} 重定向缺少 Location 头` };
        }
        let next;
        try {
          next = new URL(loc, currentUrl).href; // 相对路径按当前 URL 补全
        } catch {
          if (timer) clearTimeout(timer);
          return { success: false, error: `重定向地址非法：${loc}` };
        }
        // 关键：重定向目标必须重新过一遍 SSRF 校验（协议白名单 + DNS 解析后 IP 判定）
        if (await isPrivateUrl(next)) {
          if (timer) clearTimeout(timer);
          return { success: false, error: `SSRF防护拦截（重定向目标）：${next}` };
        }
        currentUrl = next;
      }
      if (timer) clearTimeout(timer);

      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status} ${res.statusText}` };
      }

      // 根据 responseType 决定如何读取响应
      let data;
      if (responseType === "arraybuffer") {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > maxResponseBytes) {
          return { success: false, error: `响应超限 ${buf.length} > ${maxResponseBytes}` };
        }
        data = buf;
      } else {
        const text = await res.text();
        if (text.length > maxResponseBytes) {
          return { success: false, error: `响应超限 ${text.length} > ${maxResponseBytes}` };
        }
        data = parseJson ? JSON.parse(text) : text;
      }

      return { success: true, data };
    } catch (err) {
      if (timer) clearTimeout(timer);

      if (err.name === "AbortError") {
        return { success: false, error: `请求超时 ${timeout}ms` };
      }

      if (attempt < retry) {
        logger.warn(`[Request] 第${attempt + 1}次请求失败，剩余重试${retry - attempt}次 msg:${err.message}`);
        continue;
      }

      return { success: false, error: err.message };
    }
  }

  return { success: false, error: "请求失败" };
}
