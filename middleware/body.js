import express from "express";

/**
 * @description 请求体解析中间件，支持 JSON/URL-XML
 * 安全限制：请求体上限、参数数量防攻击，支持嵌套对象
 * @param {express.Application} app Express实例
 * @param {string} [bodyLimit='10mb'] 请求体大小限制
 */
export function body(app, bodyLimit = '10mb') {
  app.use(express.raw({ type: "application/xml", limit: bodyLimit }));
  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({
    extended: true,
    limit: bodyLimit,
    parameterLimit: 100,
  }));
}