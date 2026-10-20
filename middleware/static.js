import express from "express";
import { safePath } from "../utils/file.js";
import logger from "../utils/logger.js";

/**
 * 批量挂载静态资源中间件，内置目录安全校验
 * @param {express.Application} app Express实例
 * @param {Array<{prefix:string;dir:string;maxAge?:number;immutable?:boolean}>} statics 静态目录配置数组
 *        immutable:true 输出 Cache-Control: max-age=..., immutable —— 仅用于构建期带内容 hash 的产物目录
 */
export const staticMw = async (app, statics) => {
  if (!Array.isArray(statics) || !statics.length) return;
  statics.forEach(({ prefix, dir, maxAge, immutable }) => {
    if (!safePath(dir)) {
      logger.error(`[Static] 不安全目录拦截：${dir}`);
      return;
    }
    app.use(prefix, express.static(dir, {
      maxAge: maxAge ?? 0,
      dotfiles: "deny",
      ...(immutable ? { immutable: true } : {}),
    }));
  });
};