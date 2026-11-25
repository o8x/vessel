'use strict';

/* json-search-service 断言测试：纯 node 运行，不依赖 electron 与第三方包。
 * 运行方式：node src/main/services/json-search-service.test.js
 */

const assert = require('node:assert');
const searchService = require('./json-search-service');

let assertions = 0;

function eq(actual, expected, label) {
  assertions += 1;
  assert.deepStrictEqual(actual, expected, label);
}

function paths(value, keyword) {
  const result = searchService.search(value, keyword);
  assert.strictEqual(result.ok, true, `search "${keyword}" should succeed: ${result.error}`);
  return result.rows.map((row) => row.path);
}

const DOC = {
  name: 'vessel',
  items: [
    { id: 1, ok: true, tags: ['alpha', 'beta'] },
    { id: 2, ok: false, tags: ['gamma'] },
  ],
  'weird key': { x: 1 },
  nested: { deep: { userName: 'bob' } },
  list: [10, 20],
};

/* 键名命中 */
eq(paths(DOC, 'id'), ['.items[0].id', '.items[1].id'], 'matches key names');
eq(paths(DOC, 'items'), ['.items'], 'matches a container key');
eq(paths(DOC, 'tags'), ['.items[0].tags', '.items[1].tags'], 'matches nested keys');

/* 值命中 */
eq(paths(DOC, 'vessel'), ['.name'], 'matches a string value');
eq(paths(DOC, 'bob'), ['.nested.deep.userName'], 'matches a deep value');
eq(paths(DOC, '20'), ['.list[1]'], 'matches a number value');
eq(paths(DOC, 'true'), ['.items[0].ok'], 'matches a boolean value');

/* 忽略大小写 */
eq(paths(DOC, 'ITEMS'), ['.items'], 'key match ignores case');
eq(paths(DOC, 'VESSEL'), ['.name'], 'value match ignores case');

/* 模糊（子序列）匹配：≥ 3 个字符才启用 */
eq(paths(DOC, 'nme'), ['.name', '.nested.deep.userName'], 'fuzzy match on a key');
eq(paths(DOC, 'ite'), ['.items'], 'fuzzy match hits a container key');
eq(paths(DOC, 'id'), ['.items[0].id', '.items[1].id'], 'short keywords only match literally');

/* 特殊键名用 ."..." 形式 */
eq(paths(DOC, 'weird'), ['."weird key"'], 'quotes keys that are not identifiers');

/* 没有命中 */
eq(paths(DOC, 'zzzz'), [], 'no match returns an empty list');

/* 数组路径 */
eq(paths(DOC, 'alpha'), ['.items[0].tags[0]'], 'array element path');
eq(paths([{ a: 1 }, { b: 2 }], 'a'), ['.[0].a'], 'root array element path');
eq(paths('hello world', 'world'), ['.'], 'root scalar path');

/* 同一个路径只出现一次（键名与值同时命中时合并） */
eq(paths({ k: 'k' }, 'k'), ['.k'], 'key and value hits are merged into one row');

/* 空关键字 → 报错 */
eq(searchService.search(DOC, '').ok, false, 'empty keyword fails');
eq(searchService.search(DOC, '   ').ok, false, 'blank keyword fails');
eq(searchService.search(DOC, '').error, 'Search keyword required', 'empty keyword message');

/* 类型名 */
eq(searchService.typeName(null), 'null', 'null type');
eq(searchService.typeName([]), 'array', 'array type');
eq(searchService.typeName({}), 'object', 'object type');
eq(searchService.typeName(''), 'string', 'string type');
eq(searchService.typeName(1), 'number', 'number type');
eq(searchService.typeName(true), 'boolean', 'boolean type');

/* 值文本：JSON 表示 + 超长截断 */
eq(searchService.formatValue('vessel'), '"vessel"', 'string value is quoted');
eq(searchService.formatValue(1), '1', 'number value');
eq(searchService.formatValue(null), 'null', 'null value');
eq(searchService.formatValue({ a: 1 }), '{"a":1}', 'object value is compact JSON');
eq(
  searchService.formatValue('x'.repeat(200)).length,
  searchService.MAX_VALUE_LENGTH,
  'long values are truncated'
);
eq(searchService.formatValue('x'.repeat(200)).endsWith('…'), true, 'truncated value ends with an ellipsis');

/* 路径构造 */
eq(searchService.memberPath('', 'a'), '.a', 'member path at the root');
eq(searchService.memberPath('.a', 'b'), '.a.b', 'nested member path');
eq(searchService.memberPath('.a', 'x y'), '.a."x y"', 'member path with a special key');
eq(searchService.indexPath('', 0), '.[0]', 'index path at the root');
eq(searchService.indexPath('.a', 2), '.a[2]', 'nested index path');

assertions += 1;
console.log('All assertions passed ✅');
