/**
 * 获取客户端真实 IP（Express 专用）
 * 前置要求：App 已配置 app.set('trust proxy', <上游代理IP/CIDR列表>)，Express 自动解析真实客户端 IP。
 *   注意：trust proxy 必须精确声明真实上游代理（如 loopback / 10.0.0.0/8），切勿设为 true，
 *   否则攻击者可伪造 X-Forwarded-For 伪装成内网 IP 绕过 WAF。
 * IP 信任优先级（防头部伪造，层级严格限制）：
 *   1. cf-connecting-ip（仅同时满足 CF_ENABLED=true + 请求携带 cf-ray 请求头，才可信，避免伪造CF头）
 *   2. Express 内置解析 req.ip（已融合代理链路，最稳妥通用）
 *   3. 兜底默认值 0.0.0.0
 * 额外处理：IPv6 映射IPv4、IPv6本地回环统一转为标准IPv4格式
 * @param {import('express').Request} req Express 请求对象
 * @returns {string} 客户端IP地址
 */
export function getIp(req) {
  // 1. Cloudflare 源IP（双重校验环境变量+cf-ray头，防止恶意伪造CF头部）
  if (process.env.CF_ENABLED === 'true' && req?.headers?.['cf-ray']) {
    const cfIp = req.headers['cf-connecting-ip']
      ?.split(',')[0]?.trim();
    if (cfIp) return cfIp;
  }

  // 2. Express 自动解析后的标准IP
  if (typeof req?.ip === 'string' && req.ip.trim()) {
    const ip = req.ip.trim()
      .replace(/^::ffff:/, '')  // IPv6映射IPv4
      .replace(/^::1$/, '127.0.0.1');  // IPv6本地回环
    return ip;
  }

  // 兜底未知IP
  return '0.0.0.0';
}