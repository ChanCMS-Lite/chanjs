/**
 * 声明式参数校验中间件（基于 zod）
 * 在 Controller 上定义 static rules，框架自动校验 req.body/req.query/req.params
 */
import { ValidationError } from "../core/errors.js";

/**
 * 写回校验结果：Express 5 的 req.query 为只读 getter，直接赋值会静默失败，
 * 需用 defineProperty 定义自有属性遮蔽原型 getter。
 * @private
 */
function setValidated(req, source, value) {
  if (source === 'query') {
    Object.defineProperty(req, 'query', {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    req[source] = value;
  }
}

/**
 * 创建 zod 校验中间件
 * @param {import('zod').ZodSchema} schema - zod schema
 * @param {"body"|"query"|"params"} [source='body'] - 校验来源
 * @returns {Function} Express 中间件
 *
 * @example
 * // 在 Controller 上定义 rules
 * class ArticleController extends Controller {
 *   static rules = {
 *     create: z.object({ title: z.string().min(1), content: z.string() }),
 *   };
 * }
 *
 * // router 中使用
 * router.post('/create', validate(ArticleController.rules.create), ctrl.create.bind(ctrl));
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const fields = result.error.issues?.map(i => i.path.join('.')) || [];
      const msg = result.error.issues?.map(i => i.message).join('; ') || '参数校验失败';
      const err = new ValidationError(msg, fields);
      return next(err);
    }
    // 使用 setValidated 统一处理，解决 Express 5 req.query 只读问题
    setValidated(req, source, result.data);
    // 同时设置 req.validated 作为统一访问点（向后兼容）
    req.validated = result.data;
    next();
  };
}

/**
 * 批量校验多个来源
 * @param {Object} schemas - { body?, query?, params? } 各来源的 zod schema
 * @returns {Function} Express 中间件
 */
export function validateAll(schemas) {
  const aggregated = {};
  return (req, res, next) => {
    for (const [source, schema] of Object.entries(schemas)) {
      if (!schema) continue;
      const result = schema.safeParse(req[source]);
      if (!result.success) {
        const fields = result.error.issues?.map(i => `${source}.${i.path.join('.')}`) || [];
        const msg = result.error.issues?.map(i => i.message).join('; ') || '参数校验失败';
        const err = new ValidationError(msg, fields);
        return next(err);
      }
      setValidated(req, source, result.data);
      aggregated[source] = result.data;
    }
    // 聚合多来源校验结果，避免用单一来源覆盖已校验数据
    req.validated = aggregated;
    next();
  };
}