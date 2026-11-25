'use strict';

/* jq-service 断言测试：纯 node 运行，不依赖 electron 与第三方包。
 * 运行方式：node src/main/services/jq-service.test.js
 */

const assert = require('node:assert');
const jq = require('./jq-service');

/* 断言计数（用于结尾统计）。 */
let assertions = 0;

/* 统一计数 + 深比较。 */
function eq(actual, expected, label) {
  assertions += 1;
  assert.deepStrictEqual(actual, expected, label);
}

/* 执行过滤器，断言成功并返回输出流。 */
function run(filter, value) {
  const outcome = jq.run(filter, value);
  assert.strictEqual(outcome.ok, true, `filter "${filter}" should succeed: ${outcome.error}`);
  return outcome.results;
}

/* 执行过滤器，断言失败并返回错误信息。 */
function fail(filter, value) {
  const outcome = jq.run(filter, value);
  assert.strictEqual(outcome.ok, false, `filter "${filter}" should fail`);
  assert.strictEqual(typeof outcome.error, 'string');
  assert.ok(outcome.error.length > 0, 'error message should not be empty');
  return outcome.error;
}

/* ================================================================== *
 * 路径语法
 * ================================================================== */

eq(run('.', 42), [42], 'identity on number');
eq(run('.', { a: 1 }), [{ a: 1 }], 'identity on object');
eq(run('.', [1, 2]), [[1, 2]], 'identity on array');
eq(run('.', null), [null], 'identity on null');
eq(run('.foo', { foo: 1 }), [1], 'field access');
eq(run('.foo.bar', { foo: { bar: 2 } }), [2], 'nested field access');
eq(run('.foo', { bar: 1 }), [null], 'missing field yields null');
eq(run('.foo.baz', { foo: { bar: 1 } }), [null], 'missing nested field yields null');
eq(run('."foo bar"', { 'foo bar': 3 }), [3], 'quoted field name');
eq(run('.["foo"]', { foo: 4 }), [4], 'bracket string index');
eq(run('.[0]', [1, 2, 3]), [1], 'array index');
eq(run('.[2]', [1, 2, 3]), [3], 'array index tail');
eq(run('.[-1]', [1, 2, 3]), [3], 'negative index');
eq(run('.[-3]', [1, 2, 3]), [1], 'negative index head');
eq(run('.[5]', [1, 2, 3]), [null], 'out of range index yields null');
eq(run('.[-5]', [1, 2, 3]), [null], 'out of range negative index yields null');
eq(run('.[1:3]', [1, 2, 3, 4]), [[2, 3]], 'slice with both bounds');
eq(run('.[2:]', [1, 2, 3, 4]), [[3, 4]], 'slice from');
eq(run('.[:2]', [1, 2, 3, 4]), [[1, 2]], 'slice to');
eq(run('.[1:100]', [1, 2, 3]), [[2, 3]], 'slice out of range');
eq(run('.[2:1]', [1, 2, 3]), [[]], 'slice with from greater than to');
eq(run('.[1:2]', 'abcd'), ['b'], 'slice on string');
eq(run('.[]', [1, 2]), [1, 2], 'iterate array');
eq(run('.[]', { a: 1, b: 2 }), [1, 2], 'iterate object values');
eq(run('.[]', []), [], 'iterate empty array');
eq(run('.foo[]', { foo: [1, 2] }), [1, 2], 'field then iterate');
eq(run('.foo[0]', { foo: [1, 2] }), [1], 'field then index');
eq(run('.foo.bar', { foo: { bar: [1, 2] } }), [[1, 2]], 'field then field');

/* ================================================================== *
 * 可选（?）与路径错误
 * ================================================================== */

eq(run('.foo?', { foo: 1 }), [1], 'optional on successful field');
eq(run('.foo?', {}), [null], 'optional on missing field still yields null');
eq(run('.foo.bar?', { foo: 1 }), [], 'optional suppresses path error');
eq(run('.foo[]?', { foo: 1 }), [], 'optional suppresses iterate error');
eq(run('.foo?', 5), [], 'optional suppresses index error on number');
eq(fail('.foo', 5), 'Cannot index number with "foo"', 'index error on number');
eq(fail('.foo', null), 'Cannot index null with "foo"', 'index error on null');
eq(fail('.foo', 'text'), 'Cannot index string with "foo"', 'index error on string');
eq(fail('.foo', true), 'Cannot index boolean with "foo"', 'index error on boolean');
eq(fail('.[0]', { a: 1 }), 'Cannot index object with 0', 'index error on object');
eq(fail('.[]', 5), 'Cannot iterate over number', 'iterate error on number');
eq(fail('.[]', 'abc'), 'Cannot iterate over string', 'iterate error on string');
eq(fail('.[]', null), 'Cannot iterate over null', 'iterate error on null');
eq(fail('length?', true), 'Cannot get length of boolean', 'optional does not hide runtime errors');

/* ================================================================== *
 * 递归下降
 * ================================================================== */

eq(run('..', { a: 1, b: { c: 2 } }), [{ a: 1, b: { c: 2 } }, 1, { c: 2 }, 2], 'recursive descent');
eq(run('..', [1, [2]]), [[1, [2]], 1, [2], 2], 'recursive descent on array');
eq(run('..foo', { foo: 1, a: { foo: 2 } }), [1, 2], 'recursive field');
eq(run('..foo', { a: { b: { foo: 3 } } }), [3], 'recursive field deep');
eq(run('..foo', {}), [], 'recursive field without match');

/* ================================================================== *
 * 组合语法
 * ================================================================== */

eq(run('.a | .b', { a: { b: 1 } }), [1], 'pipe');
eq(run('.a, .b', { a: 1, b: 2 }), [1, 2], 'comma');
eq(run('1, 2'), [1, 2], 'comma with literals');
eq(run('.[] | .x', [{ x: 1 }, { x: 2 }]), [1, 2], 'pipe over iterate');
eq(run('(.a, .b) | .', { a: 1, b: 2 }), [1, 2], 'grouped comma');
eq(run('.a | .b, .c', { a: { b: 1, c: 2 } }), [1, 2], 'comma binds tighter than pipe');
eq(run('.[] | empty', [1, 2]), [], 'pipe with empty right side');

/* ================================================================== *
 * 字面量
 * ================================================================== */

eq(run('123'), [123], 'number literal');
eq(run('-1.5'), [-1.5], 'negative float literal');
eq(run('1e3'), [1000], 'exponent literal');
eq(run('"hi"'), ['hi'], 'string literal');
eq(run('"a\\nb"'), ['a\nb'], 'newline escape');
eq(run('"a\\tb"'), ['a\tb'], 'tab escape');
eq(run('"a\\\\b"'), ['a\\b'], 'backslash escape');
eq(run('"a\\"b"'), ['a"b'], 'quote escape');
eq(run('"a\\/b"'), ['a/b'], 'slash escape');
eq(run('"\\u4e2d"'), ['中'], 'unicode escape');
eq(run('true'), [true], 'true literal');
eq(run('false'), [false], 'false literal');
eq(run('null'), [null], 'null literal');

/* ================================================================== *
 * 内置函数：基础
 * ================================================================== */

eq(run('length', 'hello'), [5], 'length of string');
eq(run('length', 'héllo'), [5], 'length counts code points');
eq(run('length', [1, 2, 3]), [3], 'length of array');
eq(run('length', { a: 1, b: 2 }), [2], 'length of object');
eq(run('length', 123), [123], 'length of number');
eq(run('length', -5), [5], 'length of negative number');
eq(run('length', null), [0], 'length of null');
fail('length', true);
eq(run('keys', { b: 1, a: 2 }), [['a', 'b']], 'keys are sorted');
eq(run('keys', [7, 8]), [[0, 1]], 'keys of array are indices');
fail('keys', 5);
eq(run('keys_unsorted', { b: 1, a: 2 }), [['b', 'a']], 'keys_unsorted keeps insertion order');
eq(run('values', { b: 1, a: 2 }), [[1, 2]], 'values keep insertion order');
eq(run('values', [1, 2]), [[1, 2]], 'values of array');
fail('values', 5);
eq(run('type', {}), ['object'], 'type of object');
eq(run('type', []), ['array'], 'type of array');
eq(run('type', ''), ['string'], 'type of string');
eq(run('type', 1), ['number'], 'type of number');
eq(run('type', false), ['boolean'], 'type of boolean');
eq(run('type', null), ['null'], 'type of null');
eq(run('not', false), [true], 'not of false');
eq(run('not', null), [true], 'not of null');
eq(run('not', 0), [false], 'zero is truthy');
eq(run('not', ''), [false], 'empty string is truthy');
eq(run('not', []), [false], 'empty array is truthy');
eq(run('not', {}), [false], 'empty object is truthy');
eq(run('empty', 1), [], 'empty produces no output');

/* ================================================================== *
 * 内置函数：数组与对象
 * ================================================================== */

eq(run('add', [1, 2, 3]), [6], 'add numbers');
eq(run('add', []), [null], 'add of empty array');
eq(run('add', ['a', 'b']), ['ab'], 'add strings');
eq(run('add', { a: 1, b: 2 }), [3], 'add object values');
eq(run('sort', [3, 1, 2]), [[1, 2, 3]], 'sort numbers');
eq(run('sort', ['b', 'a']), [['a', 'b']], 'sort strings');
eq(run('unique', [3, 1, 3, 2]), [[1, 2, 3]], 'unique');
eq(run('unique', []), [[]], 'unique of empty array');
eq(run('reverse', [1, 2, 3]), [[3, 2, 1]], 'reverse array');
eq(run('flatten', [[1], [2, [3]]]), [[1, 2, [3]]], 'flatten one level');
eq(run('flatten(2)', [[1], [2, [3]]]), [[1, 2, 3]], 'flatten two levels');
eq(run('min', [3, 1, 2]), [1], 'min');
eq(run('max', [3, 1, 2]), [3], 'max');
eq(run('min', []), [null], 'min of empty array');
eq(run('max', []), [null], 'max of empty array');
eq(run('first', [1, 2]), [1], 'first');
eq(run('last', [1, 2]), [2], 'last');
eq(run('first', []), [null], 'first of empty array');
eq(run('last', []), [null], 'last of empty array');
eq(run('first(.a)', { a: 7 }), [7], 'first of filter output');
eq(run('last(.a)', { a: 7 }), [7], 'last of filter output');
eq(run('first(empty)', { a: 7 }), [null], 'first of empty filter output');
eq(run('to_entries', { a: 1 }), [[{ key: 'a', value: 1 }]], 'to_entries');
eq(run('from_entries', [{ key: 'a', value: 1 }]), [{ a: 1 }], 'from_entries');
eq(run('from_entries', [{ name: 'a', val: 2 }]), [{ a: 2 }], 'from_entries with name/val');
eq(run('from_entries', [{ k: 'a', v: 3 }]), [{ a: 3 }], 'from_entries with k/v');
fail('to_entries', [1]);
fail('from_entries', [1]);

/* ================================================================== *
 * 内置函数：数值与字符串
 * ================================================================== */

eq(run('floor', 1.7), [1], 'floor');
eq(run('ceil', 1.2), [2], 'ceil');
eq(run('round', 1.5), [2], 'round half up');
eq(run('round', -1.5), [-2], 'round half away from zero');
eq(run('round', 2.4), [2], 'round down');
eq(run('sqrt', 9), [3], 'sqrt');
eq(run('abs', -3), [3], 'abs');
fail('floor', 'x');
eq(run('tostring', 1), ['1'], 'tostring of number');
eq(run('tostring', 'a'), ['a'], 'tostring of string');
eq(run('tostring', true), ['true'], 'tostring of boolean');
eq(run('tostring', null), ['null'], 'tostring of null');
eq(run('tonumber', '42'), [42], 'tonumber');
eq(run('tonumber', 7), [7], 'tonumber of number');
fail('tonumber', 'abc');
eq(run('tojson', { a: 1 }), ['{"a":1}'], 'tojson of object');
eq(run('tojson', 'x'), ['"x"'], 'tojson of string');
eq(run('tojson', null), ['null'], 'tojson of null');
eq(run('ascii_downcase', 'AbC'), ['abc'], 'ascii_downcase');
eq(run('ascii_upcase', 'AbC'), ['ABC'], 'ascii_upcase');
eq(run('explode', 'ab'), [[97, 98]], 'explode');
eq(run('implode', [97, 98]), ['ab'], 'implode');
fail('explode', 1);
fail('implode', 'x');

/* ================================================================== *
 * 内置函数：谓词与字符串操作
 * ================================================================== */

eq(run('has("a")', { a: 1 }), [true], 'has key');
eq(run('has("z")', { a: 1 }), [false], 'has missing key');
eq(run('has(0)', [1, 2]), [true], 'has index');
eq(run('has(5)', [1, 2]), [false], 'has out of range index');
eq(run('startswith("ab")', 'abc'), [true], 'startswith');
eq(run('startswith("bc")', 'abc'), [false], 'startswith mismatch');
eq(run('endswith("bc")', 'abc'), [true], 'endswith');
eq(run('ltrimstr("ab")', 'abc'), ['c'], 'ltrimstr');
eq(run('ltrimstr("x")', 'abc'), ['abc'], 'ltrimstr without match');
eq(run('rtrimstr("bc")', 'abc'), ['a'], 'rtrimstr');
eq(run('rtrimstr("x")', 'abc'), ['abc'], 'rtrimstr without match');
eq(run('split(",")', 'a,b,c'), [['a', 'b', 'c']], 'split');
eq(run('join("-")', ['a', 'b']), ['a-b'], 'join');
eq(run('join(",")', [1, null, true]), ['1,,true'], 'join converts values');
eq(run('contains("bc")', 'abcd'), [true], 'contains substring');
eq(run('contains([1])', [1, 2]), [true], 'contains array items');
eq(run('contains({ "a": 1 })', { a: 1, b: 2 }), [true], 'contains object entries');
eq(run('inside([1, 2])', [1]), [true], 'inside is the reverse of contains');
eq(run('getpath(["a", "b"])', { a: { b: 1 } }), [1], 'getpath');
eq(run('getpath(["a", "x"])', { a: { b: 1 } }), [null], 'getpath missing key');
eq(run('getpath(["a"])', { a: { b: 1 } }), [{ b: 1 }], 'getpath single segment');
eq(run('test("^a")', 'abc'), [true], 'test matches');
eq(run('test("^b")', 'abc'), [false], 'test does not match');
fail('test("[")', 'abc');

/* ================================================================== *
 * 内置函数：过滤器参数
 * ================================================================== */

eq(run('map(.a)', [{ a: 1 }, { a: 2 }]), [[1, 2]], 'map');
eq(run('map(.a)', []), [[]], 'map of empty array');
eq(run('map_values(.a)', { x: { a: 1 }, y: { a: 2 } }), [{ x: 1, y: 2 }], 'map_values');
eq(run('.[] | select(.a)', [{ a: 1 }, { b: 2 }]), [{ a: 1 }], 'select keeps truthy elements');
eq(run('.[] | select(.a)', [{ b: 2 }]), [], 'select drops falsy elements');
eq(run('sort_by(.a)', [{ a: 2 }, { a: 1 }]), [[{ a: 1 }, { a: 2 }]], 'sort_by');
eq(run('group_by(.a)', [{ a: 1 }, { a: 2 }, { a: 1 }]), [[[{ a: 1 }, { a: 1 }], [{ a: 2 }]]], 'group_by');
eq(run('unique_by(.a)', [{ a: 1 }, { a: 1 }, { a: 2 }]), [[{ a: 1 }, { a: 2 }]], 'unique_by');
eq(run('min_by(.a)', [{ a: 2 }, { a: 1 }]), [{ a: 1 }], 'min_by');
eq(run('max_by(.a)', [{ a: 2 }, { a: 1 }]), [{ a: 2 }], 'max_by');
eq(run('min_by(.a)', []), [null], 'min_by of empty array');
eq(run('with_entries({ key: .key, value: .value })', { a: 1 }), [{ a: 1 }], 'with_entries');
eq(run('any', [false, true]), [true], 'any');
eq(run('any', [false, false]), [false], 'any of all falsy');
eq(run('any', []), [false], 'any of empty array');
eq(run('all', [true, true]), [true], 'all');
eq(run('all', [true, false]), [false], 'all with one falsy');
eq(run('all', []), [true], 'all of empty array');
eq(run('any(.a)', [{ a: 1 }, { b: 2 }]), [true], 'any with filter');
eq(run('all(.a)', [{ a: 1 }, { b: 2 }]), [false], 'all with filter');
eq(run('all(.a)', [{ a: 1 }, { a: 2 }]), [true], 'all with filter on all elements');

/* ================================================================== *
 * 内置函数：类型过滤器与路径输出
 * ================================================================== */

eq(run('arrays', []), [[]], 'arrays filter');
eq(run('arrays', {}), [], 'arrays filter rejects object');
eq(run('objects', {}), [{}], 'objects filter');
eq(run('strings', 'a'), ['a'], 'strings filter');
eq(run('numbers', 1), [1], 'numbers filter');
eq(run('booleans', false), [false], 'booleans filter');
eq(run('nulls', null), [null], 'nulls filter');
eq(run('numbers', '1'), [], 'numbers filter rejects string');
eq(run('paths', { a: 1, b: { c: 2 } }), [['a'], ['b'], ['b', 'c']], 'paths');
eq(run('paths', 1), [], 'paths excludes the root path');
eq(run('leaf_paths', { a: 1, b: { c: 2 } }), [['a'], ['b', 'c']], 'leaf_paths');

/* ================================================================== *
 * 内置函数：序列
 * ================================================================== */

eq(run('range(3)'), [0, 1, 2], 'range with one argument');
eq(run('range(1;4)'), [1, 2, 3], 'range with two arguments');
eq(run('range(0;10;3)'), [0, 3, 6, 9], 'range with step');
eq(run('range(5;0;-2)'), [5, 3, 1], 'range with negative step');
eq(run('range(0)'), [], 'range with zero');
eq(run('limit(2; .[])', [1, 2, 3]), [1, 2], 'limit truncates outputs');
eq(run('limit(0; .[])', [1, 2, 3]), [], 'limit with zero');

/* ================================================================== *
 * 数组 / 对象构造
 * ================================================================== */

eq(run('[.[] | .a]', [{ a: 1 }, { a: 2 }]), [[1, 2]], 'array construction collects outputs');
eq(run('[]'), [[]], 'empty array construction');
eq(run('{"a": .b}', { b: 1 }), [{ a: 1 }], 'object construction');
eq(run('{"a": .[]}', [1, 2]), [{ a: 1 }, { a: 2 }], 'object construction per output');
eq(run('{a: .b}', { b: 1 }), [{ a: 1 }], 'object construction with bare key');

/* ================================================================== *
 * 错误处理
 * ================================================================== */

eq(fail('nosuchfunction', 1), 'Unknown function: nosuchfunction', 'unknown function without parentheses');
eq(fail('nosuchfunction(1)', 1), 'Unknown function: nosuchfunction', 'unknown function with parentheses');
eq(fail('.foo |', 1).startsWith('syntax error:'), true, 'syntax error prefix');
eq(fail('|', 1).startsWith('syntax error:'), true, 'syntax error for leading pipe');
eq(fail('.[', 1).startsWith('syntax error:'), true, 'syntax error for unclosed bracket');
eq(fail('"abc', 1).startsWith('syntax error:'), true, 'syntax error for unterminated string');
eq(fail('{', 1).startsWith('syntax error:'), true, 'syntax error for unclosed object');
eq(fail('map(.a', 1).startsWith('syntax error:'), true, 'syntax error for unclosed call');
eq(fail('map', 1).startsWith('syntax error:'), true, 'syntax error for missing argument');
eq(fail('.[1.5]', 1).startsWith('syntax error:'), true, 'syntax error for bad path');
eq(fail('.[0:1]', 1), 'Cannot slice number', 'slice error on number');
eq(fail('length', true).startsWith('Cannot'), true, 'runtime error message');
eq(jq.run(123, 1).ok, false, 'non string filter is rejected');
eq(jq.run(123, 1).error.startsWith('syntax error:'), true, 'non string filter error message');

/* ================================================================== *
 * 更多边界与错误分支
 * ================================================================== */

eq(run('map(.a)', { x: { a: 1 }, y: { a: 2 } }), [[1, 2]], 'map over object values');
eq(run('select(.a)', { a: 1 }), [{ a: 1 }], 'select applies to the current input');
eq(run('with_entries({ key: .key, value: .value }) | keys', { b: 1, a: 2 }), [['a', 'b']], 'with_entries keeps keys');
eq(run('limit(1; .[][])', [[1, 2], [3]]), [1], 'limit applies to the whole output stream');
eq(run('unique', ['b', 'a', 'b']), [['a', 'b']], 'unique of strings');
eq(run('paths', [1, 2]), [[0], [1]], 'paths of array uses numeric segments');
eq(run('leaf_paths', [1, 2]), [[0], [1]], 'leaf_paths of array');
eq(run('getpath([0])', [7, 8]), [7], 'getpath with numeric segment');
eq(run('getpath([-1])', [7, 8]), [8], 'getpath with negative segment');
eq(run('.[] | .a', [{ a: 1 }, { a: 2 }]), [1, 2], 'iterate then field');
eq(run('.. | .', 1), [1], 'recursive descent on a scalar');
eq(fail('.. | .a', { a: 1 }), 'Cannot index number with "a"', 'recursive descent output can fail on a path');
eq(fail('flatten', 1), 'Cannot flatten number', 'flatten requires an array');
eq(fail('first', 1), 'Cannot use first with number', 'first requires an array');
eq(fail('getpath("a")', { a: 1 }), 'getpath requires an array path', 'getpath requires an array');
eq(fail('has("a")', 1), 'Cannot use has with number', 'has requires an object or array');
eq(fail('join(",")', 1), 'Cannot use join with number', 'join requires an array');
eq(fail('map_values(.a)', 1), 'Cannot use map_values with number', 'map_values requires an object or array');
eq(fail('with_entries(.value)', 1), 'Cannot use with_entries with number', 'with_entries requires an object');
eq(fail('tostring', [1]), 'Cannot convert array to string', 'tostring rejects containers');
eq(fail('explode', 1), 'Cannot use explode with number', 'explode requires a string');
eq(fail('implode', 'x'), 'Cannot use implode with string', 'implode requires an array');
eq(fail('range(1.5)', null), 'Range bounds must be integers', 'range requires integers');
eq(fail('limit(-1; .)', null), 'limit requires a non-negative integer', 'limit requires a non-negative count');
eq(fail('tonumber', ' '), 'Cannot parse " " as number', 'tonumber rejects blank strings');

/* ================================================================== *
 * 比较运算符
 * ================================================================== */

eq(run('1 == 1'), [true], 'equal numbers');
eq(run('1 == 2'), [false], 'unequal numbers');
eq(run('1 != 2'), [true], 'not equal numbers');
eq(run('1 != 1'), [false], 'not equal same numbers');
eq(run('1 < 2'), [true], 'less than');
eq(run('2 < 1'), [false], 'less than reversed');
eq(run('2 <= 2'), [true], 'less or equal');
eq(run('1 <= 2'), [true], 'less or equal true');
eq(run('3 > 2'), [true], 'greater than');
eq(run('2 > 3'), [false], 'greater than reversed');
eq(run('3 >= 3'), [true], 'greater or equal');
eq(run('"a" < "b"'), [true], 'string comparison');
eq(run('"b" < "a"'), [false], 'string comparison reversed');
eq(run('"abc" < "abd"'), [true], 'string lexicographic order');
eq(run('[1, 2] == [1, 2]'), [true], 'array equality');
eq(run('[1, 2] < [1, 3]'), [true], 'array comparison by elements');
eq(run('[] < [1]'), [true], 'shorter array is smaller');
eq(run('[1] < [1, 2]'), [true], 'array prefix is smaller');
eq(run('{"a": 1} == {"a": 1}'), [true], 'object equality');
eq(run('{"a": 1, "b": 2} == {"b": 2, "a": 1}'), [true], 'object equality ignores key order');
eq(run('{"a": 1} == {"a": 2}'), [false], 'object inequality');
eq(run('{"a": 1} < {"b": 1}'), [true], 'object comparison by keys');
eq(run('null < false'), [true], 'null is the smallest type');
eq(run('false < true'), [true], 'false is smaller than true');
eq(run('true < 1'), [true], 'boolean is smaller than number');
eq(run('1 < "a"'), [true], 'number is smaller than string');
eq(run('"a" < []'), [true], 'string is smaller than array');
eq(run('[] < {}'), [true], 'array is smaller than object');
eq(run('null == null'), [true], 'null equality');
eq(run('1 != "1"'), [true], 'different types are not equal');
eq(run('.a > .b', { a: 2, b: 1 }), [true], 'field comparison');
eq(run('null > 99'), [false], 'null is not greater than a number');
eq(run('select(.id > 99)', { id: 100 }), [{ id: 100 }], 'select with greater than');
eq(run('select(.id > 99)', { id: 1 }), [], 'select with greater than filters out');
eq(run('select(.ok == true)', { ok: true }), [{ ok: true }], 'select with equal true');
eq(run('.[] | select(.id > 99)', [{ id: 100 }, { id: 1 }]), [{ id: 100 }], 'select inside iteration');
eq(run('.[] | select(.ok == true)', [{ ok: true }, { ok: false }]), [{ ok: true }], 'select equality inside iteration');

/* ================================================================== *
 * 算术运算符
 * ================================================================== */

eq(run('1 + 2'), [3], 'addition');
eq(run('5 - 2'), [3], 'subtraction');
eq(run('3 * 4'), [12], 'multiplication');
eq(run('4 / 2'), [2], 'division');
eq(run('1 / 2'), [0.5], 'true division');
eq(run('7 % 3'), [1], 'modulo');
eq(run('7 % 2'), [1], 'modulo again');
eq(run('"a" + "b"'), ['ab'], 'string concatenation');
eq(run('[1] + [2]'), [[1, 2]], 'array concatenation');
eq(run('{"a": 1} + {"a": 2, "b": 3}'), [{ a: 2, b: 3 }], 'object merge with right hand side winning');
eq(run('[1, 2, 3] - [2]'), [[1, 3]], 'array subtraction removes matching values');
eq(run('[1, 1, 2] - [1]'), [[2]], 'array subtraction removes every match');
eq(run('null + 1'), [1], 'null plus number');
eq(run('1 + null'), [1], 'number plus null');
eq(run('null - 1'), [null], 'null minus number');
eq(run('1 - null'), [1], 'number minus null');
eq(run('-5'), [-5], 'negative number literal');
eq(run('-.a', { a: 5 }), [-5], 'unary minus on a field');
eq(run('- -5'), [5], 'double negation');
eq(fail('1 / 0'), 'Cannot divide number by zero', 'division by zero');
eq(fail('1 % 0'), 'Cannot modulo by zero', 'modulo by zero');
eq(fail('1 + "a"'), 'Cannot add number and string', 'mixed addition is an error');
eq(fail('"a" - "b"'), 'Cannot subtract string from string', 'string subtraction is an error');
eq(fail('"a" * 2'), 'Cannot multiply string and number', 'string multiplication is an error');
eq(fail('1 / "a"'), 'Cannot divide number and string', 'mixed division is an error');
eq(fail('-"a"'), 'Cannot negate string', 'negating a string is an error');

/* ================================================================== *
 * 逻辑运算符
 * ================================================================== */

eq(run('true and false'), [false], 'and');
eq(run('false and true'), [false], 'and reversed');
eq(run('true or false'), [true], 'or');
eq(run('false or false'), [false], 'or reversed');
eq(run('.a and .b', { a: true, b: false }), [false], 'and with fields');
eq(run('.a or .b', { a: false, b: true }), [true], 'or with fields');
eq(run('1 == 1 and 2 == 2 and 3 == 3'), [true], 'chained and');
eq(run('1 == 2 or 2 == 2'), [true], 'or with comparisons');
eq(run('true or false and false'), [true], 'and binds tighter than or');
eq(run('false and false or true'), [true], 'and binds tighter than or (left side)');
eq(run('select(.id > 99 and .ok == true)', { id: 100, ok: true }), [{ id: 100, ok: true }], 'combined conditions');

/* ================================================================== *
 * 运算符优先级
 * ================================================================== */

eq(run('.a - .b - .c', { a: 10, b: 3, c: 2 }), [5], 'subtraction is left associative');
eq(run('1 - 2 - 3'), [-4], 'subtraction is left associative with literals');
eq(run('.a + .b * .c', { a: 1, b: 2, c: 3 }), [7], 'multiplication binds tighter than addition');
eq(run('.a * .b + .c', { a: 2, b: 3, c: 4 }), [10], 'multiplication binds tighter than addition (left side)');
eq(run('1 + 2 * 3'), [7], 'multiplication binds tighter than addition');
eq(run('2 * 3 + 1'), [7], 'multiplication binds tighter than addition (trailing)');
eq(run('(1 + 2) * 3'), [9], 'parentheses override precedence');
eq(run('12 / 3 / 2'), [2], 'division is left associative');
eq(run('1 + 2 == 3'), [true], 'addition binds tighter than comparison');
eq(run('1 == 1 and 2 == 2'), [true], 'comparison binds tighter than and');
eq(run('1, 2 == 2'), [1, true], 'comparison binds tighter than comma');
eq(run('.a | .b == 1', { a: { b: 1 } }), [true], 'pipe binds looser than comparison');
eq(run('.a == .b', { a: 1, b: 2 }), [false], 'comparison of two fields');

/* ================================================================== *
 * 运算符语法错误
 * ================================================================== */

eq(fail('1 = 1').startsWith('syntax error:'), true, 'single equals is invalid');
eq(fail('1 ! 1').startsWith('syntax error:'), true, 'single exclamation mark is invalid');
eq(fail('1 ==').startsWith('syntax error:'), true, 'incomplete comparison');
eq(fail('1 +').startsWith('syntax error:'), true, 'incomplete addition');
eq(fail('1 *').startsWith('syntax error:'), true, 'incomplete multiplication');
eq(fail('.a and').startsWith('syntax error:'), true, 'incomplete and');

/* ================================================================== *
 * 备选运算符 a // b
 * ================================================================== */

eq(run('.a // "fallback"', { a: null }), ['fallback'], 'alternative falls back on null');
eq(run('.a // "fallback"', { a: false }), ['fallback'], 'alternative falls back on false');
eq(run('.a // "fallback"', { a: 0 }), [0], 'alternative keeps 0 (truthy in jq)');
eq(run('.a // "fallback"', { a: '' }), [''], 'alternative keeps an empty string');
eq(run('.a // "fallback"', { a: 'x' }), ['x'], 'alternative keeps a normal value');
eq(run('.missing // "fallback"', {}), ['fallback'], 'alternative falls back on a missing field');
eq(run('.a // .b', { a: null, b: 'b' }), ['b'], 'alternative falls back to another field');
eq(run('.a // .b // "z"', { a: null, b: null }), ['z'], 'alternative chains');
eq(run('.a // "fallback"', { a: null, b: 2 }), ['fallback'], 'alternative ignores other fields');
eq(run('.list[] | .v // 0', { list: [{ v: 1 }, { v: null }] }), [1, 0], 'alternative inside a pipe');
eq(run('.a, .b // "z"', { a: null, b: 'b' }), [null, 'b'], 'comma binds looser than alternative');
eq(run('.a // "x" | length', { a: 'ab' }), [2], 'alternative result can be piped on');

/* ================================================================== *
 * 对外接口
 * ================================================================== */

eq(jq.parse('.foo').ok, true, 'parse succeeds');
eq(jq.parse('.foo').ast.type, 'path', 'parse returns an AST');
eq(jq.parse('nosuchfunction').ok, false, 'parse reports unknown function');
eq(jq.parse('nosuchfunction').error, 'Unknown function: nosuchfunction', 'parse unknown function message');
eq(jq.parse('.foo |').ok, false, 'parse reports syntax error');
eq(jq.parse('.foo |').error.startsWith('syntax error:'), true, 'parse syntax error message');
eq(Array.isArray(jq.FUNCTIONS), true, 'FUNCTIONS is an array');
eq(jq.FUNCTIONS.length, 62, 'FUNCTIONS lists every builtin');
eq(jq.FUNCTIONS.join(','), jq.FUNCTIONS.slice().sort().join(','), 'FUNCTIONS is sorted');
eq(jq.FUNCTIONS.includes('length'), true, 'FUNCTIONS contains length');
eq(jq.FUNCTIONS.includes('map'), true, 'FUNCTIONS contains map');
eq(jq.FUNCTIONS.includes('with_entries'), true, 'FUNCTIONS contains with_entries');
eq(Object.keys(jq).sort().join(','), 'FUNCTIONS,parse,run', 'module exports exactly parse/run/FUNCTIONS');

/* 内部异常也要被包装成 { ok:false, error }，不抛异常。 */
eq(typeof jq.run('.foo', 5).error, 'string', 'runtime failure returns an error string');

assertions += 1;
console.log('All assertions passed ✅');
