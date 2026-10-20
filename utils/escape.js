/**
 * LIKE 关键词转义（% _ \），防止用户输入的通配符干扰模糊查询语义。
 * 仅用于用户输入侧（如 mapUrlFilters 的字段映射函数内部）；
 * 内部代码构造的查询条件为可信输入，无需转义。
 */
export function escapeLike(str = "") {
  return String(str).replace(/[%_\\]/g, "\\$&");
}
