import pino from "pino";
import pretty from "pino-pretty";

// 本地时间 yyyy-mm-dd HH:mm:ss.l（pino 默认给 UTC 的 ISO 串，带 T/Z 不好读，这里直接格式化好）
const p = (n, w = 2) => String(n).padStart(w, "0");
const timestamp = () => {
  const d = new Date();
  const t = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  return `,"time":"${t}"`;
};

// 输出格式：时间 + 空格 + 正文（pino-pretty 默认模板是 [time]: msg，方括号和冒号去不掉，
// 故忽略 time 字段、改由 messageFormat 把时间拼在行首）
const root = pino(
  { level: (process.env.LOG_LEVEL || "info").trim(), base: null, timestamp },
  pretty({
    colorize: false,
    ignore: "pid,hostname,level,time,req,res,responseTime,reqId",
    messageFormat: "{time} {msg}",
  }),
);

/**
 * 附加参数序列化：error/warn 的第二参（Error/对象）拼进消息本身。
 *
 * 背景：pino-pretty 的 messageFormat 字符串模板只渲染 msg 字段，
 * 「logger.error(msg, err)」的 err 会被整体丢弃（连堆栈都不输出）。
 * 在封装层统一序列化，保证文档承诺的「第二参数自动解析堆栈」真实生效。
 * @param {unknown[]} args error/warn 的除消息外全部参数
 * @returns {string} 可读文本（Error 优先 stack，对象 JSON，其余 String）
 */
function serializeExtra(args) {
  return args
    .map(v => {
      if (v == null) return "";
      if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
      if (typeof v === "object") {
        try { return JSON.stringify(v); } catch { return String(v); }
      }
      return String(v);
    })
    .filter(Boolean)
    .join(" ");
}

/**
 * 统一日志门面：与文档用法对齐（logger.error("xx", err) 自动带出堆栈）
 * 全部级别统一将附加参数序列化进 msg（pino-pretty messageFormat 只渲染 msg 字段，
 * 任何直接透传的第二参都会被丢弃），保证 info("xx", obj) 与 error 行为一致
 */
const logger = {
  info(msg, ...extra) {
    extra.length ? root.info(`${msg} ${serializeExtra(extra)}`) : root.info(msg);
  },
  debug: root.debug.bind(root),
  trace: root.trace.bind(root),
  fatal: root.fatal.bind(root),
  child: root.child.bind(root),
  warn(msg, ...extra) {
    extra.length ? root.warn(`${msg} ${serializeExtra(extra)}`) : root.warn(msg);
  },
  error(msg, ...extra) {
    extra.length ? root.error(`${msg} ${serializeExtra(extra)}`) : root.error(msg);
  },
};

export { root };
export default logger;
