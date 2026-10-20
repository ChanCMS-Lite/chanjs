import logger from "./logger.js";

/** 默认最大递归深度，防止循环引用栈溢出 */
const MAX_DEPTH = 10;

/**
 * 扁平数组转树形结构（预建Map优化性能，支持自定义id/pid字段、防循环引用）
 * @param {Array<Object>} list 扁平源数组
 * @param {number|string} [rootPid=0] 根节点父ID
 * @param {Object} [options={}] 配置项
 * @param {number} [options.maxDepth=20] 最大递归深度
 * @param {string} [options.idKey='id'] 节点唯一标识字段
 * @param {string} [options.pidKey='pid'] 父ID字段
 * @returns {Array<Object>} 树形节点数组，节点自带 children、level
 */
export function tree(list, rootPid = 0, options = {}) {
  const {
    maxDepth = MAX_DEPTH,
    idKey = "id",
    pidKey = "pid",
  } = options;

  // 基础校验
  if (!Array.isArray(list) || list.length === 0) return [];

  // 1. 一次性构建id映射，O(n)，避免递归重复遍历数组（核心性能优化）
  const nodeMap = new Map();
  const rootNodes = [];
  const allNodes = [];

  for (const item of list) {
    const node = { ...item, children: [], level: 0 };
    nodeMap.set(node[idKey], node);
    allNodes.push(node);
  }

  // 2. 父子关联
  for (const node of allNodes) {
    const parentId = node[pidKey];
    if (parentId === rootPid) {
      rootNodes.push(node);
      node.level = 1;
      continue;
    }
    const parent = nodeMap.get(parentId);
    if (parent) {
      parent.children.push(node);
    }
  }

  // 3. 递归填充层级 + 循环引用深度拦截
  const visitedIds = new Set();
  function setLevel(node, depth = 1) {
    if (depth > maxDepth) {
      logger.warn(`[tree] 递归深度超限${maxDepth}，疑似循环引用，id:${node[idKey]}`);
      return;
    }
    const nodeId = node[idKey];
    if (visitedIds.has(nodeId)) {
      logger.warn(`[tree] 检测循环引用 id:${nodeId}`);
      return;
    }
    visitedIds.add(nodeId);
    node.level = depth;
    for (const child of node.children) {
      setLevel(child, depth + 1);
    }
  }

  for (const root of rootNodes) {
    setLevel(root, 1);
    // 无孩子则删除空children字段，精简结构
    if (root.children.length === 0) delete root.children;
  }

  return rootNodes;
}

/**
 * 根据节点ID向上追溯完整父级路径（通用版，不耦合具体业务字段）
 * @param {number|string} targetId 目标节点ID
 * @param {Array<Object>} list 扁平源数组
 * @param {Object} [options={}] 配置
 * @param {number} [options.maxDepth=20] 最大追溯深度
 * @param {string} [options.idKey='id'] id字段
 * @param {string} [options.pidKey='pid'] 父ID字段
 * @returns {Array<Object>} 路径数组 [根节点...父节点...目标节点]
 */
export function treeById(targetId, list, options = {}) {
  const {
    maxDepth = MAX_DEPTH,
    idKey = "id",
    pidKey = "pid",
  } = options;

  if (!Array.isArray(list) || targetId == null) return [];

  // 预构建Map加速查找
  const nodeMap = new Map();
  for (const item of list) {
    nodeMap.set(item[idKey], item);
  }

  const path = [];
  const visited = new Set();
  let currentId = targetId;
  let depth = 0;

  while (currentId != null && currentId !== 0) {
    if (depth >= maxDepth) {
      logger.warn(`[treeById] 追溯深度超限${maxDepth}，疑似循环引用 id:${currentId}`);
      break;
    }
    if (visited.has(currentId)) {
      logger.warn(`[treeById] 检测循环引用 id:${currentId}`);
      break;
    }
    visited.add(currentId);

    const node = nodeMap.get(currentId);
    if (!node) break;

    path.unshift({ ...node });
    currentId = node[pidKey];
    depth++;
  }

  return path;
}
