import { routeNotFound, serializeError, respondError } from "../../response/index.js";
import { CODE_NOT_FOUND, CODE_CONFLICT, CODE_BUSINESS_FAIL } from "../../response/code.js";
import {
  AppError, isAppError, parseStack, describeError, wrapDbError,
} from "../errors.js";
import logger from "../../utils/logger.js";

// 仅这些业务码明确经过了 DB 查询（如查无记录、唯一冲突、业务处理失败），
// 才推断 DB 已恢复；鉴权(401/403)/参数(422)/限流(429) 等不查库的错误不触发 markUp
const DB_RECOVERY_CODES = new Set([CODE_NOT_FOUND, CODE_CONFLICT, CODE_BUSINESS_FAIL]);

// 安全开关：是否对外暴露 SQL / 堆栈等详情
const EXPOSE_ERR_DETAIL = process.env.EXPOSE_ERR_DETAIL === "true";
const IS_PROD = ["prd", "prod", "production"].includes(process.env.NODE_ENV || "dev");

/**
 * 注册全局异常兜底中间件（ChanJS底层框架）
 * @description
 * 唯一统一错误出口，职责收敛为：日志 / 环境鉴权 / HTTP状态 / 脱敏，全项目所有报错只打印一次。
 * 1. 404 兜底：路由未匹配时返回标准 404 JSON（须在业务路由之后注册）
 * 2. 全局异常捕获：DB/底层异常经 wrapDbError 归类为友好 AppError，
 *    响应层 serializeError 零 DB 感知，换数据库不用改响应代码
 * 3. 区分浏览器HTML / API JSON：HTML返回框架内置静态错误页，接口返回标准JSON
 * 4. 双重安全校验：EXPOSE_ERR_DETAIL && (!生产环境 || 携带合法Debug令牌)，生产误开也不泄露堆栈/SQL
 * @param {object} chan 框架核心实例 { app: Express }
 */
export function registerErrorHandler(chan) {
  const { app, config } = chan;

  // ============ 404 兜底（路由未匹配） ============
  // 使用 respondError 做 HTML/JSON 分流：页面请求返回框架内置 HTML 错误页，
  // 接口请求返回标准 JSON；避免浏览器直接访问不存在路径时看到一段 JSON 文本。
  app.use((req, res) => {
    const notFound = routeNotFound(req);
    respondError(res, req, {
      httpStatus: 404,
      code: notFound.code,
      msg: notFound.msg,
      data: notFound.data,
    });
  });

  // ============ 全局异常统一出口 ============
  app.use((err, req, res, next) => {
    // 响应头已发送，转交Express默认错误处理
    if (res.headersSent) return next(err);

    // DB / 底层异常下沉转换：非业务错误先归类为友好 AppError
    if (!isAppError(err)) err = wrapDbError(err);

    // 连接类故障实时标记：后续未登录请求可直接返回「数据库未连接」，
    // 而非伪装成 token 缺失（详见 auth 中间件 isDown 短路）。
    // 仅认结构化信号：wrapDbError 已把连接拒绝/超时/中断等统一归类为 6xxx AppError，
    // 不再做错误消息正则匹配，避免文案改动导致健康状态失真。
    const isDbDown = isAppError(err) && err.code >= 6000;
    if (isDbDown) {
      chan.dbManager?.markDown?.();
    } else if (isAppError(err) && DB_RECOVERY_CODES.has(err.code)) {
      // 仅明确经过 DB 查询的业务错误（查无记录/唯一冲突/业务失败）才推断 DB 已恢复，
      // 鉴权/参数/限流等不查库的错误不触发 markUp，避免误标
      chan.dbManager?.markUp?.();
    }

    const httpStatus = isAppError(err) ? err.httpStatus : 500;
    const stackInfo = parseStack(err.stack);
    // 全链路追踪信息（requestId 需业务/框架注入 req.id 或 x-request-id 头）
    const requestId = req.headers["x-request-id"] || req.id || "-";
    const userId = req.user?.id ?? "-";

    // 日志分级：业务错误 4xx → warn，系统错误 5xx → error（唯一打印点，杜绝重复刷屏）
    // pino 的日志方法依赖 this，不能解引用后裸调（会抛 TypeError 把真实业务错误掩盖成 500），
    // 必须用箭头函数包一层保住 this
    const logFn = httpStatus < 500 ? (msg) => logger.warn(msg) : (msg) => logger.error(msg);
    logFn(JSON.stringify({
      type: err.name || "UnknownError",
      message: describeError(err), // 递归解析 cause 根因，支持 AggregateError
      file: stackInfo.file,
      line: stackInfo.line,
      requestId,
      method: req.method,
      url: req.originalUrl,
      userId,
    }));

    // 双重安全校验：生产环境即使环境变量开了，也必须携带合法 Debug Token 才暴露堆栈/SQL
    const exposeDetail = EXPOSE_ERR_DETAIL && (!IS_PROD || req.headers["x-debug-token"] === process.env.DEBUG_TOKEN);

    if (isAppError(err)) {
      // 统一通过 respondError 做 HTML/JSON 分流（复用 response 层纯函数，消除重复逻辑）
      const serialized = serializeError(err, exposeDetail);
      return respondError(res, req, {
        httpStatus,
        code: serialized.code,
        msg: serialized.msg,
        data: serialized.data ?? null,
      });
    }

    // 兆底分支（理论上 wrapDbError 已转 AppError，这里防万一）
    respondError(res, req, { httpStatus: 500, code: 500, msg: "服务器内部错误" });
  });
}
