import fs from "fs";
import path from "path";
import serveFavicon from "serve-favicon";
import { Paths } from "../utils/paths.js";
import logger from "../utils/logger.js";

/**
 * 网站图标中间件，读取public目录favicon.ico
 * 文件不存在时静默跳过，不阻断启动
 * @param {express.Application} app Express实例
 */
export const favicon = app => {
  const icoPath = path.join(Paths.publicPath, "favicon.ico");
  if (!fs.existsSync(icoPath)) {
    logger.info("[Favicon] favicon.ico 不存在，跳过图标中间件");
    return;
  }
  app.use(serveFavicon(icoPath));
};