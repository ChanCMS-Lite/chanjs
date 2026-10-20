import { CODE_OK, CODE_BUSINESS_FAIL, CODE_NOT_FOUND, CODE_SYSTEM_ERROR, getCodeMsg } from "./code.js";
import { isAppError } from "../core/errors.js";
import { htmlEncode } from "../utils/html.js";

/**
 * 统一响应序列化工具（纯函数：无 IO、无日志、无环境判断、无 DB 感知）
 * 仅做数据格式化，可复用于定时任务 / RPC / 接口返回，与全局错误处理器解耦
 */
export const success = ({ data = {}, msg = getCodeMsg(CODE_OK) } = {}) => ({
  success: true, code: CODE_OK, msg, data,
});

export const fail = ({ msg = getCodeMsg(CODE_BUSINESS_FAIL), data = {}, code = CODE_BUSINESS_FAIL } = {}) => ({
  success: false, code, msg, data,
});

/** 404 路由不存在专用返回体 */
export const routeNotFound = req => ({
  success: false,
  code: CODE_NOT_FOUND,
  msg: "请求的资源不存在",
  data: { path: req.originalUrl || req.url, method: req.method },
});

/**
 * 统一错误序列化格式化（纯函数）
 * - 业务错误（AppError 体系）：提取 code / msg + 自定义扩展字段
 * - 系统 / 未知错误：生产环境强制脱敏，仅 exposeDetail=true 时附带堆栈
 */
export function serializeError(err, exposeDetail = false) {
  if (isAppError(err)) {
    const result = { success: false, code: err.code, msg: err.message };
    const extra = {};
    // 框架内部字段永远不外泄；stack/cause(可能含SQL) 仅 dev(exposeDetail=true) 时附带
    const NEVER_EXPOSE = new Set(["code", "message", "name", "meta", "httpStatus"]);
    const SENSITIVE = new Set(["stack", "cause"]);
    for (const key of Object.getOwnPropertyNames(err)) {
      if (NEVER_EXPOSE.has(key)) continue;
      if (SENSITIVE.has(key) && !exposeDetail) continue; // 生产环境不泄露堆栈/根因(SQL)
      const val = err[key];
      if (val === undefined || val === null) continue;
      if (typeof val === "function" || typeof val === "symbol") continue;
      try { extra[key] = val && typeof val === "object" && !Array.isArray(val) ? JSON.stringify(val) : val; }
      catch { extra[key] = "[unserializable]"; }
    }
    if (Object.keys(extra).length > 0) result.data = extra;
    return result;
  }

  // 原生未知系统错误：生产环境强制脱敏，不泄露 SQL / 堆栈 / 根因
  return {
    success: false,
    code: CODE_SYSTEM_ERROR,
    // 生产环境不暴露原始 message（可能含 SQL 片段），仅 dev 透出
    msg: exposeDetail ? (err?.message || "系统内部错误") : "系统内部错误",
    ...(exposeDetail && err?.stack ? { data: { stack: err.stack } } : {}),
  };
}

// =================== HTML 错误页（纯函数，无模板引擎依赖） ===================

/**
 * 框架内置兜底错误HTML页面
 */
export function buildErrorHtml(status, errorMsg, code, req) {
  const url = htmlEncode(req.originalUrl || req.url);
  const method = htmlEncode(req.method);
  const msg = htmlEncode(errorMsg || "服务器内部错误");
  const codeText = htmlEncode(code ? String(code) : `HTTP_${status}`);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${status} 服务异常</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;background:#f5f7fa;color:#2c3e50;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.box{max-width:620px;width:100%;background:#fff;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.06);padding:40px 32px;}
.code{font-size:64px;font-weight:700;line-height:1;color:#1677ff;margin-bottom:8px;text-align:center}
.title{font-size:18px;font-weight:600;margin-bottom:12px;color:rgba(0,0,0,0.88);text-align:center}
.msg{font-size:14px;color:#262626;line-height:1.6;margin-bottom:20px;word-break:break-all;background: #fafafa;padding: 20px;border-radius: 8px;}
.url{font-size:14px;color:#434343;margin-bottom:24px;word-break:break-all}
</style>
</head>
<body>
<div class="box">
  <div class="code">${status}</div>
  <div class="title">服务异常</div>
  <div class="msg">${msg}</div>
  <div class="url">请求地址：${method} ${url}</div>
  <div class="url">错误码：${codeText}</div>
</div>
</body>
</html>`;
}

/**
 * 统一错误响应出口（HTML / JSON 自动分流）
 * - API 请求（XHR、Accept 优先 json）→ 一律返回 JSON
 * - 浏览器页面请求（Accept 优先 html）→ 渲染内置 HTML 错误页
 */
export function respondError(res, req, { httpStatus = 500, code = 500, msg = "服务器内部错误", data = null } = {}) {
  const wantsJson = req && (req.xhr || req.accepts?.(["json", "html"]) === "json");
  if (!wantsJson && req?.accepts?.("html")) {
    return res.status(httpStatus).type("html").send(buildErrorHtml(httpStatus, msg, code, req));
  }
  return res.status(httpStatus).json({ success: false, code, msg, data });
}
