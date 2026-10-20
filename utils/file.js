/**
 * 文件系统操作工具
 * 提供安全的文件读写/删除/目录扫描功能（内置路径穿越防御）
 */
import path from "path";
import fs from "fs";
import logger from "./logger.js";

/**
 * 路径安全校验：禁止越界项目根目录
 * @param {string} inputPath
 * @returns {string|null} 合法返回绝对路径，非法返回null
 */
export function safePath(inputPath) {
  if (!inputPath || typeof inputPath !== "string") return null;
  const fullPath = path.resolve(process.cwd(), inputPath);
  const rel = path.relative(process.cwd(), fullPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return fullPath;
}

/**
 * 删除文件
 * @param {string} filePath 相对于项目根目录的文件路径
 * @returns {boolean}
 */
export function delImg(filePath) {
  const fullPath = safePath(filePath);
  if (!fullPath) {
    logger.error("[delImg] 非法路径/路径越界:", filePath);
    return false;
  }
  try {
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      return true;
    }
    return false;
  } catch (err) {
    logger.error("[delImg] 删除文件异常", fullPath, err.message);
    return false;
  }
}

/**
 * 读取文本文件内容
 * @param {string} filePath
 * @returns {string} utf8 文件文本内容
 * @throws 非法路径或文件不存在时抛异常
 */
export function readFileContent(filePath) {
  const fullPath = safePath(filePath);
  if (!fullPath) throw new Error(`[readFileContent] 拒绝不安全/越界路径: ${filePath}`);
  if (!fs.existsSync(fullPath)) throw new Error("文件不存在");
  if (!fs.statSync(fullPath).isFile()) throw new Error("目标路径不是文件");
  return fs.readFileSync(fullPath, "utf-8");
}

/**
 * 保存/覆写文件，不存在目录自动递归创建
 * @param {string} filePath
 * @param {string} content
 * @throws 非法路径时抛异常
 */
export function saveFileContent(filePath, content) {
  const fullPath = safePath(filePath);
  if (!fullPath) throw new Error(`[saveFileContent] 拒绝不安全/越界路径: ${filePath}`);
  const dirPath = path.dirname(fullPath);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

/**
 * 获取指定目录下一级文件夹名称列表（过滤隐藏目录）
 * @param {string} folderPath
 * @returns {string[]}
 */
export function getFolders(folderPath) {
  const fullPath = safePath(folderPath);
  if (!fullPath) {
    logger.error("[getFolders] 非法路径/路径越界:", folderPath);
    return [];
  }
  try {
    if (!fs.existsSync(fullPath)) return [];
    return fs.readdirSync(fullPath)
      .filter(name => !name.startsWith(".") && fs.statSync(path.join(fullPath, name)).isDirectory());
  } catch (err) {
    logger.error("[getFolders] 读取目录异常", fullPath, err.message);
    return [];
  }
}

/**
 * 同步获取目录下一级全部 .html 文件名称
 * @param {string} folderPath
 * @returns {string[]}
 */
export function getHtmlFilesSync(folderPath) {
  const fullPath = safePath(folderPath);
  if (!fullPath) {
    logger.error("[getHtmlFilesSync] 非法路径/路径越界:", folderPath);
    return [];
  }
  try {
    if (!fs.existsSync(fullPath)) return [];
    return fs.readdirSync(fullPath)
      .filter(name => fs.statSync(path.join(fullPath, name)).isFile() && path.extname(name).toLowerCase() === ".html");
  } catch (err) {
    logger.error("[getHtmlFilesSync] 读取目录异常", fullPath, err.message);
    return [];
  }
}
