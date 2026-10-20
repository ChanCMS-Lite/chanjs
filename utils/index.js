/**
 * 工具聚合层
 *
 * 业务侧使用方式（精确命名导入）：
 *   import { tree, getIp, formatDateFields } from "chanjs/utils/index.js";
 *
 * 也可从子模块单独导入：
 *   import { getIp } from "chanjs/utils/ip.js";
 */

// 时间处理
export { formatDateFields } from "./time.js";

// 文件操作
export {
  delImg,
  readFileContent,
  saveFileContent,
  getFolders,
  getHtmlFilesSync,
} from "./file.js";

// HTML 处理
export {
  htmlEncode,
  htmlDecode,
  escapeScript,
  filterImgFromStr,
} from "./html.js";

// IP 获取
export { getIp } from "./ip.js";

// 网络请求
export { request } from "./request.js";

// 数据解析
export { arrToObj, getChildrenId } from "./data-parse.js";

// 树形结构
export { tree, treeById } from "./tree.js";

// 字段过滤
export { filterFields } from "./filter.js";

// 分页工具
export { pages, parsePage, parsePageSize, pageHtml } from "./pages.js";
export { escapeLike } from "./escape.js";
