'use strict';

/* JSON 模糊搜索：在整棵树里找出「键名命中」或「值命中」的节点，并给出 jq 风格路径。
 *
 * 路径写法与 jq 一致：`.name` / `.items[0].id` / `."带空格的键"`。
 * 命中判定：键名或字符串 / 数字 / 布尔值包含关键字（忽略大小写），
 *           或者按「子序列」模糊匹配（关键字的字符按顺序出现在目标里，如 nme 命中 name）。
 * 每个路径只出现一次（键名与值同时命中时合并成一行）。
 */

/* 表格里 VALUE 列的最大长度（超出截断）。 */
const MAX_VALUE_LENGTH = 60;

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'object':
      return 'object';
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return typeof value;
  }
}

/* 能直接写成 `.name` 的键名（其余用 ."..." 形式）。 */
function isSimpleKey(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/* 对象的成员路径：父路径 + `.键名`（键名含特殊字符时用 ."键名"）。 */
function memberPath(parent, key) {
  const name = isSimpleKey(key) ? key : `"${String(key).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return parent ? `${parent}.${name}` : `.${name}`;
}

/* 数组下标路径：根的第一个元素是 `.[0]`。 */
function indexPath(parent, index) {
  return parent ? `${parent}[${index}]` : `.[${index}]`;
}

/* 关键字与目标都转小写后再比较（忽略大小写）。 */
function normalize(text) {
  return String(text == null ? '' : text).toLowerCase();
}

/* 子序列匹配：needle 的字符按顺序出现在 haystack 里（忽略大小写）。
   返回匹配跨度（首末命中字符之间的距离 + 1）；没匹配上返回 -1。 */
function subsequenceSpan(needle, haystack) {
  if (!needle) return 0;
  let index = 0;
  let start = -1;
  for (let i = 0; i < haystack.length; i += 1) {
    if (haystack[i] !== needle[index]) continue;
    if (start < 0) start = i;
    index += 1;
    if (index === needle.length) return i - start + 1;
  }
  return -1;
}

/* 命中判定：包含（忽略大小写）即为命中；
   关键字 ≥ 3 个字符时还允许「子序列」模糊匹配（nme 命中 name），
   但匹配跨度不能超过关键字长度的两倍（避免 "id" 命中 "weird key" 这类噪音）。 */
function matches(text, needle) {
  if (!needle) return false;
  const haystack = normalize(text);
  if (!haystack) return false;
  if (haystack.includes(needle)) return true;
  if (needle.length < 3) return false;
  const span = subsequenceSpan(needle, haystack);
  if (span < 0) return false;
  return span <= needle.length * 2;
}

/* 可搜索的叶子值（字符串 / 数字 / 布尔）。 */
function isLeafValue(value) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * 搜索 JSON 树。
 * @param {*} value 已解析的 JSON 值
 * @param {string} keyword 关键字
 * @returns {{ ok: boolean, rows?: Array<{ path: string, type: string, value: * }>, error?: string }}
 */
function search(value, keyword) {
  const text = String(keyword == null ? '' : keyword).trim();
  if (!text) return { ok: false, error: 'Search keyword required' };
  const needle = normalize(text);
  const rows = [];
  const seen = new Set();

  const push = (path, node) => {
    if (seen.has(path)) return;
    seen.add(path);
    rows.push({ path, type: typeName(node), value: node });
  };

  const walk = (node, path, keyName) => {
    // 根节点自身的路径是 `.`（子节点的父路径用空串表示根）。
    const selfPath = path || '.';
    // 键名命中（数组元素没有键名）。
    if (keyName != null && matches(keyName, needle)) push(selfPath, node);
    // 值命中（只对叶子值判定；容器本身不按内容匹配）。
    if (isLeafValue(node) && matches(String(node), needle)) push(selfPath, node);
    // 继续往下找。
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, indexPath(path, index), null));
      return;
    }
    if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        walk(node[key], memberPath(path, key), key);
      }
    }
  };

  walk(value, '', null);
  return { ok: true, rows };
}

/* 表格里的值文本：统一用 JSON 表示（字符串带引号），过长截断。 */
function formatValue(value) {
  let text;
  if (typeof value === 'string') text = JSON.stringify(value);
  else if (value === undefined) text = '';
  else text = JSON.stringify(value);
  if (text == null) return '';
  if (text.length <= MAX_VALUE_LENGTH) return text;
  return `${text.slice(0, MAX_VALUE_LENGTH - 1)}…`;
}

module.exports = {
  search,
  formatValue,
  typeName,
  memberPath,
  indexPath,
  MAX_VALUE_LENGTH,
};
