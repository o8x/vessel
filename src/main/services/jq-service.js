'use strict';

/* jq 风格过滤器引擎（纯 Node 实现：不依赖 electron，也不依赖任何第三方包）。
 *
 * 分层结构：
 *   tokenizer  —— 词法分析：把过滤器文本切成 token；
 *   parser     —— 递归下降语法分析：token → AST（解析期即校验函数名与参数个数）；
 *   evaluator  —— 求值：AST + 输入值 → 输出流（数组，可能 0 / 1 / N 个元素）；
 *   builtins   —— 内置函数实现。
 *
 * 对外只暴露 parse / run / FUNCTIONS：
 *   parse(filter)      → { ok: true, ast } | { ok: false, error }
 *   run(filter, value) → { ok: true, results } | { ok: false, error }
 * 任何失败（解析失败、运行失败、乃至内部异常）都转换成 { ok:false, error }，绝不抛异常。
 */

/* ================================================================== *
 * 错误类型
 * ================================================================== */

/* 引擎内部统一错误：kind 用于区分「路径错误」与「运行时错误」，
   `?` 只抑制路径错误（其它错误照常上报）。 */
class JqError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'JqError';
    this.kind = kind;
  }
}

/* 语法错误（词法 / 语法分析阶段）。 */
class FilterSyntaxError extends JqError {
  constructor(message) {
    super(message, 'syntax');
    this.name = 'FilterSyntaxError';
  }
}

/* 未知函数：解析阶段就要报出来。 */
class UnknownFunctionError extends JqError {
  constructor(name) {
    super(`Unknown function: ${name}`, 'syntax');
    this.name = 'UnknownFunctionError';
  }
}

/* 路径错误：`.foo` 作用在非对象上、`.[]` 作用在不可迭代值上等，可被 `?` 抑制。 */
class PathError extends JqError {
  constructor(message) {
    super(message, 'path');
    this.name = 'PathError';
  }
}

/* 运行时错误：例如 `length` 作用在布尔值上。 */
class RuntimeError extends JqError {
  constructor(message) {
    super(message, 'runtime');
    this.name = 'RuntimeError';
  }
}

/* ================================================================== *
 * 值模型与通用工具
 *
 * 内部值：null / boolean / number / string / Array / Map（对象用 Map 承载，
 * 以保证键的插入顺序稳定，并且不触发 __proto__ 之类的原型坑）。
 * 对外（run 的结果、入参）仍然是普通 JS 对象 / 数组。
 * ================================================================== */

/* 类型名：与 jq 保持一致，用于错误信息。 */
function typeName(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Map) return 'object';
  const kind = typeof value;
  if (kind === 'string') return 'string';
  if (kind === 'number') return 'number';
  if (kind === 'boolean') return 'boolean';
  return 'null';
}

/* jq 的真值规则：只有 false 与 null 为假，0 / "" / [] / {} 都为真。 */
function isTruthy(value) {
  return value !== false && value !== null && value !== undefined;
}

/* 排序等级（jq 的跨类型排序：null < false < true < number < string < array < object）。 */
function orderRank(value) {
  if (value === null || value === undefined) return 0;
  if (value === false) return 1;
  if (value === true) return 2;
  if (typeof value === 'number') return 3;
  if (typeof value === 'string') return 4;
  if (Array.isArray(value)) return 5;
  return 6;
}

/* 按 Unicode 码点比较字符串（JS 的 < 比较的是 UTF-16 码元，代理对场景会有差异）。 */
function compareCodePoints(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const x = a[index].codePointAt(0);
    const y = b[index].codePointAt(0);
    if (x !== y) return x < y ? -1 : 1;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/* jq 语义的值比较（用于 sort / group_by / unique_by / min_by 等）。 */
function compareValues(left, right) {
  const leftRank = orderRank(left);
  const rightRank = orderRank(right);
  if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1;
  if (leftRank === 3) {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }
  if (leftRank === 4) return compareCodePoints(left, right);
  if (leftRank === 5) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const result = compareValues(left[index], right[index]);
      if (result !== 0) return result;
    }
    if (left.length === right.length) return 0;
    return left.length < right.length ? -1 : 1;
  }
  if (leftRank === 6) {
    const leftKeys = Array.from(left.keys()).sort();
    const rightKeys = Array.from(right.keys()).sort();
    const keyResult = compareValues(leftKeys, rightKeys);
    if (keyResult !== 0) return keyResult;
    for (const key of leftKeys) {
      const result = compareValues(left.get(key), right.get(key));
      if (result !== 0) return result;
    }
    return 0;
  }
  return 0;
}

/* 深比较（用于 unique / group_by 的分组判定）。 */
function deepEqual(left, right) {
  if (left === right) return true;
  const leftType = typeName(left);
  const rightType = typeName(right);
  if (leftType !== rightType) return false;
  if (leftType === 'array') {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqual(left[index], right[index])) return false;
    }
    return true;
  }
  if (leftType === 'object') {
    if (left.size !== right.size) return false;
    for (const [key, value] of left) {
      if (!right.has(key) || !deepEqual(value, right.get(key))) return false;
    }
    return true;
  }
  return false;
}

/* 普通 JS 值 → 内部值（对象转 Map，递归处理）。 */
function toInternal(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(toInternal);
  if (value instanceof Map) {
    const result = new Map();
    for (const [key, item] of value) result.set(key, toInternal(item));
    return result;
  }
  if (value && typeof value === 'object') {
    const result = new Map();
    for (const key of Object.keys(value)) result.set(key, toInternal(value[key]));
    return result;
  }
  return value;
}

/* 内部值 → 普通 JS 值（Map 转普通对象，递归处理）。 */
function toPlain(value) {
  if (Array.isArray(value)) return value.map(toPlain);
  if (value instanceof Map) {
    const result = {};
    for (const [key, item] of value) {
      /* 用 defineProperty 写入，避免 "__proto__" 之类的键污染原型。 */
      Object.defineProperty(result, key, {
        value: toPlain(item),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  }
  return value;
}

/* ================================================================== *
 * 词法分析（tokenizer）
 * ================================================================== */

const PUNCTUATION_CHARS = '()[]{},|:;?';

/* 运算符字符：单字符运算符与双字符运算符的首字符。 */
const OPERATOR_CHARS = '+-*/%<>=!';

function isWhitespace(char) {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function isDigit(char) {
  return char >= '0' && char <= '9';
}

function isIdentifierStart(char) {
  return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_';
}

function isIdentifierPart(char) {
  return isIdentifierStart(char) || isDigit(char);
}

function isPunct(token, value) {
  return token && token.type === 'punct' && token.value === value;
}

/* 关键字形式的运算符（and / or）。 */
function isKeyword(token, value) {
  return token && token.type === 'ident' && token.value === value;
}

/* 比较运算符 → 运算类型。 */
const COMPARISON_OPERATORS = {
  '==': 'eq',
  '!=': 'ne',
  '<': 'lt',
  '<=': 'le',
  '>': 'gt',
  '>=': 'ge',
};

/* 乘除模运算符 → 运算类型。 */
const MULTIPLICATIVE_OPERATORS = {
  '*': 'mul',
  '/': 'div',
  '%': 'mod',
};

/* 读取字符串字面量（支持 \n \t \" \\ \/ \b \f \r \uXXXX）。 */
function readString(source, start) {
  let index = start + 1;
  let out = '';
  while (index < source.length) {
    const char = source[index];
    if (char === '"') return { value: out, next: index + 1 };
    if (char === '\\') {
      const escape = source[index + 1];
      index += 2;
      switch (escape) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'u': {
          const hex = source.slice(index, index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new FilterSyntaxError('invalid unicode escape sequence');
          out += String.fromCharCode(parseInt(hex, 16));
          index += 4;
          break;
        }
        default:
          throw new FilterSyntaxError(`invalid escape sequence "\\${escape || ''}"`);
      }
      continue;
    }
    out += char;
    index += 1;
  }
  throw new FilterSyntaxError('unterminated string literal');
}

/* 读取数字字面量（123 / 1.5 / 1e3 / 1.5e-3）；负号由语法分析阶段处理。 */
function readNumber(source, start) {
  let index = start;
  while (index < source.length && isDigit(source[index])) index += 1;
  if (source[index] === '.') {
    index += 1;
    if (!isDigit(source[index])) throw new FilterSyntaxError('invalid number literal');
    while (index < source.length && isDigit(source[index])) index += 1;
  }
  if (source[index] === 'e' || source[index] === 'E') {
    index += 1;
    if (source[index] === '+' || source[index] === '-') index += 1;
    if (!isDigit(source[index])) throw new FilterSyntaxError('invalid number literal');
    while (index < source.length && isDigit(source[index])) index += 1;
  }
  return { value: Number(source.slice(start, index)), next: index };
}

/* 读取标识符（函数名、true/false/null、对象构造的裸键）。 */
function readIdentifier(source, start) {
  let index = start + 1;
  while (index < source.length && isIdentifierPart(source[index])) index += 1;
  return { value: source.slice(start, index), next: index };
}

/* 把过滤器文本切成 token 序列（末尾补一个 eof）。 */
function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }
    if (char === '.') {
      if (source[index + 1] === '.') {
        tokens.push({ type: 'dotdot' });
        index += 2;
        continue;
      }
      tokens.push({ type: 'dot' });
      index += 1;
      continue;
    }
    if (char === '"') {
      const literal = readString(source, index);
      tokens.push({ type: 'string', value: literal.value });
      index = literal.next;
      continue;
    }
    if (isDigit(char)) {
      const literal = readNumber(source, index);
      tokens.push({ type: 'number', value: literal.value });
      index = literal.next;
      continue;
    }
    if (isIdentifierStart(char)) {
      const literal = readIdentifier(source, index);
      tokens.push({ type: 'ident', value: literal.value });
      index = literal.next;
      continue;
    }
    if (PUNCTUATION_CHARS.includes(char)) {
      tokens.push({ type: 'punct', value: char });
      index += 1;
      continue;
    }
    if (OPERATOR_CHARS.includes(char)) {
      /* 双字符运算符：== != <= >= 以及备选运算符 // */
      const next = source[index + 1];
      if (char === '/' && next === '/') {
        tokens.push({ type: 'punct', value: '//' });
        index += 2;
        continue;
      }
      if ((char === '=' || char === '!' || char === '<' || char === '>') && next === '=') {
        tokens.push({ type: 'punct', value: `${char}=` });
        index += 2;
        continue;
      }
      if (char === '=' || char === '!') {
        throw new FilterSyntaxError(`unexpected character "${char}"`);
      }
      tokens.push({ type: 'punct', value: char });
      index += 1;
      continue;
    }
    throw new FilterSyntaxError(`unexpected character "${char}"`);
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

/* ================================================================== *
 * 内置函数签名表
 *
 * args: [最少参数个数, 最多参数个数]；
 * FILTER_ARG_POSITIONS 标记哪些参数位是「过滤器参数」（对每个元素求值），
 * 其余都是「值参数」（先对当前输入求值成单个值）。
 * ================================================================== */

const FUNCTION_SPECS = {
  /* 0 参数 */
  length: { args: [0, 0] },
  keys: { args: [0, 0] },
  keys_unsorted: { args: [0, 0] },
  values: { args: [0, 0] },
  type: { args: [0, 0] },
  not: { args: [0, 0] },
  empty: { args: [0, 0] },
  add: { args: [0, 0] },
  sort: { args: [0, 0] },
  unique: { args: [0, 0] },
  reverse: { args: [0, 0] },
  flatten: { args: [0, 1] },
  min: { args: [0, 0] },
  max: { args: [0, 0] },
  floor: { args: [0, 0] },
  ceil: { args: [0, 0] },
  round: { args: [0, 0] },
  sqrt: { args: [0, 0] },
  abs: { args: [0, 0] },
  first: { args: [0, 1] },
  last: { args: [0, 1] },
  tostring: { args: [0, 0] },
  tonumber: { args: [0, 0] },
  tojson: { args: [0, 0] },
  ascii_downcase: { args: [0, 0] },
  ascii_upcase: { args: [0, 0] },
  explode: { args: [0, 0] },
  implode: { args: [0, 0] },
  to_entries: { args: [0, 0] },
  from_entries: { args: [0, 0] },
  paths: { args: [0, 0] },
  leaf_paths: { args: [0, 0] },
  any: { args: [0, 1] },
  all: { args: [0, 1] },
  arrays: { args: [0, 0] },
  objects: { args: [0, 0] },
  strings: { args: [0, 0] },
  numbers: { args: [0, 0] },
  booleans: { args: [0, 0] },
  nulls: { args: [0, 0] },
  /* 1 个值参数 */
  has: { args: [1, 1] },
  startswith: { args: [1, 1] },
  endswith: { args: [1, 1] },
  ltrimstr: { args: [1, 1] },
  rtrimstr: { args: [1, 1] },
  split: { args: [1, 1] },
  join: { args: [1, 1] },
  contains: { args: [1, 1] },
  inside: { args: [1, 1] },
  getpath: { args: [1, 1] },
  test: { args: [1, 1] },
  /* 1 个过滤器参数 */
  map: { args: [1, 1] },
  map_values: { args: [1, 1] },
  select: { args: [1, 1] },
  sort_by: { args: [1, 1] },
  group_by: { args: [1, 1] },
  unique_by: { args: [1, 1] },
  min_by: { args: [1, 1] },
  max_by: { args: [1, 1] },
  with_entries: { args: [1, 1] },
  /* 多参数 */
  range: { args: [1, 3] },
  limit: { args: [2, 2] },
};

/* ================================================================== *
 * 语法分析（parser，递归下降）
 *
 * 优先级：| 最低，, 次之（逗号比管道绑定更紧，与 jq 一致），其后是项。
 * ================================================================== */

function describeToken(token) {
  if (!token || token.type === 'eof') return 'end of input';
  if (token.type === 'string') return `"${token.value}"`;
  if (token.type === 'number') return String(token.value);
  if (token.type === 'dot') return '.';
  if (token.type === 'dotdot') return '..';
  return String(token.value);
}

function expectPunct(state, value) {
  const token = state.tokens[state.pos];
  if (!isPunct(token, value)) {
    throw new FilterSyntaxError(`expected "${value}" but found "${describeToken(token)}"`);
  }
  state.pos += 1;
}

/* 管道：| */
function parsePipe(state, options) {
  let left = parseComma(state, options);
  while (isPunct(state.tokens[state.pos], '|')) {
    state.pos += 1;
    left = { type: 'pipe', left, right: parseComma(state, options) };
  }
  return left;
}

/* 逗号：左右两侧输出的并集。 */
function parseComma(state, options) {
  let left = parseAlternative(state, options);
  if (options && options.allowComma === false) return left;
  while (isPunct(state.tokens[state.pos], ',')) {
    state.pos += 1;
    left = { type: 'comma', left, right: parseAlternative(state, options) };
  }
  return left;
}

/* 备选：a // b —— a 的输出里没有 false / null 时用 a 的输出，否则改用 b 的输出。
   绑定比逗号紧、比 or 松（与 jq 的优先级一致）。 */
function parseAlternative(state, options) {
  let left = parseOr(state, options);
  while (isPunct(state.tokens[state.pos], '//')) {
    state.pos += 1;
    left = { type: 'alternative', left, right: parseOr(state, options) };
  }
  return left;
}

/* 逻辑或：or（两侧按 jq 真值规则判断）。 */
function parseOr(state, options) {
  let left = parseAnd(state, options);
  while (isKeyword(state.tokens[state.pos], 'or')) {
    state.pos += 1;
    left = { type: 'binary', op: 'or', left, right: parseAnd(state, options) };
  }
  return left;
}

/* 逻辑与：and。 */
function parseAnd(state, options) {
  let left = parseComparison(state, options);
  while (isKeyword(state.tokens[state.pos], 'and')) {
    state.pos += 1;
    left = { type: 'binary', op: 'and', left, right: parseComparison(state, options) };
  }
  return left;
}

/* 比较运算符：== != < <= > >=（左结合）。 */
function parseComparison(state, options) {
  let left = parseAdditive(state, options);
  for (;;) {
    const token = state.tokens[state.pos];
    if (token.type !== 'punct' || !COMPARISON_OPERATORS[token.value]) break;
    state.pos += 1;
    left = {
      type: 'binary',
      op: COMPARISON_OPERATORS[token.value],
      left,
      right: parseAdditive(state, options),
    };
  }
  return left;
}

/* 加减：+ -（左结合）。 */
function parseAdditive(state, options) {
  let left = parseMultiplicative(state, options);
  for (;;) {
    const token = state.tokens[state.pos];
    if (token.type !== 'punct' || (token.value !== '+' && token.value !== '-')) break;
    state.pos += 1;
    left = {
      type: 'binary',
      op: token.value === '+' ? 'add' : 'sub',
      left,
      right: parseMultiplicative(state, options),
    };
  }
  return left;
}

/* 乘除模：* / %（左结合）。 */
function parseMultiplicative(state, options) {
  let left = parseUnary(state, options);
  for (;;) {
    const token = state.tokens[state.pos];
    if (token.type !== 'punct') break;
    const op = MULTIPLICATIVE_OPERATORS[token.value];
    if (!op) break;
    state.pos += 1;
    left = { type: 'binary', op, left, right: parseUnary(state, options) };
  }
  return left;
}

/* 一元负号：-5 / -.a（优先级高于乘除模）。 */
function parseUnary(state, options) {
  if (isPunct(state.tokens[state.pos], '-')) {
    state.pos += 1;
    const operand = parseUnary(state, options);
    /* 负数字面量仍是字面量，其它表达式走取负运算。 */
    if (operand.type === 'literal' && typeof operand.value === 'number') {
      return { type: 'literal', value: -operand.value };
    }
    return { type: 'negate', expr: operand };
  }
  return parsePostfix(state, options);
}

/* 后缀：基本表达式 + 可选的 `?`。 */
function parsePostfix(state, options) {
  const node = parsePrimary(state, options);
  if (isPunct(state.tokens[state.pos], '?')) {
    state.pos += 1;
    if (isPunct(state.tokens[state.pos], '?')) throw new FilterSyntaxError('unexpected "?"');
    return { type: 'optional', expr: node };
  }
  return node;
}

function parsePrimary(state, options) {
  const token = state.tokens[state.pos];
  if (token.type === 'dot') {
    state.pos += 1;
    return { type: 'path', steps: parsePathSteps(state) };
  }
  if (token.type === 'dotdot') {
    state.pos += 1;
    const next = state.tokens[state.pos];
    if (next.type === 'ident' || next.type === 'string') {
      state.pos += 1;
      return { type: 'recurseField', name: next.value };
    }
    return { type: 'recurse' };
  }
  if (token.type === 'number' || token.type === 'string') {
    state.pos += 1;
    return { type: 'literal', value: token.value };
  }
  if (token.type === 'ident') {
    state.pos += 1;
    if (token.value === 'true') return { type: 'literal', value: true };
    if (token.value === 'false') return { type: 'literal', value: false };
    if (token.value === 'null') return { type: 'literal', value: null };
    if (isPunct(state.tokens[state.pos], '(')) return parseCall(state, token.value);
    /* 已知函数可以省略括号（如 `length`），未知函数在解析阶段就报错。 */
    const spec = FUNCTION_SPECS[token.value];
    if (!spec) throw new UnknownFunctionError(token.value);
    if (spec.args[0] > 0) {
      throw new FilterSyntaxError(`Function "${token.value}" expects ${spec.args[0]} argument(s), got 0`);
    }
    return { type: 'call', name: token.value, args: [] };
  }
  if (isPunct(token, '[')) return parseArrayConstruct(state);
  if (isPunct(token, '{')) return parseObjectConstruct(state);
  if (isPunct(token, '(')) {
    state.pos += 1;
    const inner = parsePipe(state, options);
    expectPunct(state, ')');
    return inner;
  }
  throw new FilterSyntaxError(`unexpected token "${describeToken(token)}"`);
}

/* 路径后缀：.foo / ."foo bar" / .[0] / .[1:3] / .[] / .foo.bar */
function parsePathSteps(state) {
  const steps = [];
  for (;;) {
    const token = state.tokens[state.pos];
    if (token.type === 'dot') {
      /* 路径中段的 "."：.foo.bar / .foo.[0] */
      state.pos += 1;
      const next = state.tokens[state.pos];
      if (next.type === 'ident' || next.type === 'string') {
        /* and / or 是保留关键字，不能作为路径字段名（与 jq 的词法规则一致）。 */
        if (next.type === 'ident' && (next.value === 'and' || next.value === 'or')) break;
        state.pos += 1;
        steps.push({ kind: 'field', name: next.value });
        continue;
      }
      if (isPunct(next, '[')) {
        state.pos += 1;
        steps.push(parseBracketStep(state));
        continue;
      }
      throw new FilterSyntaxError(`invalid path expression near "${describeToken(next)}"`);
    }
    if (token.type === 'ident') {
      /* and / or 是保留关键字，不能作为路径字段名（与 jq 的词法规则一致）。 */
      if (token.value === 'and' || token.value === 'or') break;
      state.pos += 1;
      steps.push({ kind: 'field', name: token.value });
      continue;
    }
    if (token.type === 'string') {
      state.pos += 1;
      steps.push({ kind: 'field', name: token.value });
      continue;
    }
    if (isPunct(token, '[')) {
      state.pos += 1;
      steps.push(parseBracketStep(state));
      continue;
    }
    break;
  }
  return steps;
}

/* 解析 `[...]` 路径后缀：下标 / 切片 / 迭代。 */
function parseBracketStep(state) {
  if (isPunct(state.tokens[state.pos], ']')) {
    state.pos += 1;
    return { kind: 'iterate' };
  }
  let from = null;
  let hasFrom = false;
  const start = state.tokens[state.pos];
  if (start.type === 'number' || isPunct(start, '-')) {
    from = parsePathIndex(state);
    hasFrom = true;
  } else if (start.type === 'string') {
    /* jq 兼容写法：.["key"] 等价于 ."key"。 */
    state.pos += 1;
    expectPunct(state, ']');
    return { kind: 'field', name: start.value };
  } else if (!isPunct(start, ':')) {
    throw new FilterSyntaxError(`invalid path expression near "${describeToken(start)}"`);
  }
  if (isPunct(state.tokens[state.pos], ':')) {
    state.pos += 1;
    let to = null;
    let hasTo = false;
    const end = state.tokens[state.pos];
    if (end.type === 'number' || isPunct(end, '-')) {
      to = parsePathIndex(state);
      hasTo = true;
    } else if (!isPunct(end, ']')) {
      throw new FilterSyntaxError(`invalid path expression near "${describeToken(end)}"`);
    }
    expectPunct(state, ']');
    return { kind: 'slice', from: hasFrom ? from : null, to: hasTo ? to : null };
  }
  expectPunct(state, ']');
  if (!hasFrom) throw new FilterSyntaxError('invalid path expression');
  return { kind: 'index', index: from };
}

/* 解析路径下标（支持负数，如 .[-1] / .[1:-1]）。 */
function parsePathIndex(state) {
  let sign = 1;
  if (isPunct(state.tokens[state.pos], '-')) {
    sign = -1;
    state.pos += 1;
  }
  const token = state.tokens[state.pos];
  if (token.type !== 'number' || !Number.isInteger(token.value)) {
    throw new FilterSyntaxError('path index must be an integer');
  }
  state.pos += 1;
  return sign * token.value;
}

/* 数组构造：[f]（收集 f 的所有输出）。 */
function parseArrayConstruct(state) {
  expectPunct(state, '[');
  if (isPunct(state.tokens[state.pos], ']')) {
    state.pos += 1;
    /* 空数组：`empty` 没有输出，收集后就是空数组。 */
    return { type: 'arrayConstruct', expr: { type: 'call', name: 'empty', args: [] } };
  }
  const expr = parsePipe(state);
  expectPunct(state, ']');
  return { type: 'arrayConstruct', expr };
}

/* 对象构造：{"key": f}（f 的每个输出构造一个对象）。 */
function parseObjectConstruct(state) {
  expectPunct(state, '{');
  const entries = [];
  while (!isPunct(state.tokens[state.pos], '}')) {
    const keyToken = state.tokens[state.pos];
    let key;
    if (keyToken.type === 'string' || keyToken.type === 'ident') {
      key = keyToken.value;
      state.pos += 1;
    } else {
      throw new FilterSyntaxError(`invalid object key "${describeToken(keyToken)}"`);
    }
    expectPunct(state, ':');
    /* 对象构造内部，逗号是「键值分隔符」，不能被当成逗号运算符吃掉。 */
    const value = parsePipe(state, { allowComma: false });
    entries.push({ key, value });
    if (isPunct(state.tokens[state.pos], ',')) {
      state.pos += 1;
      continue;
    }
    break;
  }
  expectPunct(state, '}');
  return { type: 'objectConstruct', entries };
}

/* 函数调用：name(arg; arg)。 */
function parseCall(state, name) {
  const spec = FUNCTION_SPECS[name];
  if (!spec) throw new UnknownFunctionError(name);
  expectPunct(state, '(');
  const args = [];
  if (!isPunct(state.tokens[state.pos], ')')) {
    for (;;) {
      args.push(parsePipe(state, { allowComma: false }));
      if (isPunct(state.tokens[state.pos], ';')) {
        state.pos += 1;
        continue;
      }
      break;
    }
  }
  expectPunct(state, ')');
  const [min, max] = spec.args;
  if (args.length < min || args.length > max) {
    const expectation = min === max ? `${min}` : `${min} to ${max}`;
    throw new FilterSyntaxError(`Function "${name}" expects ${expectation} argument(s), got ${args.length}`);
  }
  return { type: 'call', name, args };
}

/* 过滤器文本 → AST。 */
function parseFilter(source) {
  if (typeof source !== 'string') throw new FilterSyntaxError('filter must be a string');
  const state = { tokens: tokenize(source), pos: 0 };
  const node = parsePipe(state);
  const token = state.tokens[state.pos];
  if (token.type !== 'eof') {
    throw new FilterSyntaxError(`unexpected token "${describeToken(token)}"`);
  }
  return node;
}

/* ================================================================== *
 * 求值（evaluator）
 * ================================================================== */

/* 路径求值：逐步应用后缀；迭代后缀会产生多个输出，后续后缀分别作用。 */
function evaluatePath(steps, input) {
  let current = [input];
  for (const step of steps) {
    const next = [];
    for (const value of current) {
      for (const item of applyPathStep(step, value)) next.push(item);
    }
    current = next;
  }
  return current;
}

/* 单个路径后缀；失败抛 PathError（可被 `?` 抑制）。 */
function applyPathStep(step, value) {
  if (step.kind === 'field') {
    if (!(value instanceof Map)) {
      throw new PathError(`Cannot index ${typeName(value)} with "${step.name}"`);
    }
    const result = value.get(step.name);
    return [result === undefined ? null : result];
  }
  if (step.kind === 'index') {
    if (Array.isArray(value)) {
      let index = step.index;
      if (index < 0) index += value.length;
      if (index < 0 || index >= value.length) return [null];
      return [value[index]];
    }
    throw new PathError(`Cannot index ${typeName(value)} with ${step.index}`);
  }
  if (step.kind === 'slice') {
    if (Array.isArray(value)) return [sliceArray(value, step.from, step.to)];
    if (typeof value === 'string') {
      const chars = Array.from(value);
      return [sliceArray(chars, step.from, step.to).join('')];
    }
    throw new PathError(`Cannot slice ${typeName(value)}`);
  }
  /* iterate */
  if (Array.isArray(value)) return value.slice();
  if (value instanceof Map) return Array.from(value.values());
  throw new PathError(`Cannot iterate over ${typeName(value)}`);
}

/* 数组 / 字符串切片（越界自动收敛，from > to 得到空数组）。 */
function sliceArray(items, from, to) {
  const length = items.length;
  let start = from === null ? 0 : from;
  let end = to === null ? length : to;
  if (start < 0) start = Math.max(length + start, 0);
  if (end < 0) end = Math.max(length + end, 0);
  start = Math.min(start, length);
  end = Math.min(end, length);
  if (end < start) end = start;
  return items.slice(start, end);
}

/* 递归下降：输出子树里的所有值（包含根本身），前序遍历。 */
function collectDescendants(value) {
  const output = [];
  const walk = (node) => {
    output.push(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else if (node instanceof Map) {
      for (const item of node.values()) walk(item);
    }
  };
  walk(value);
  return output;
}

/* 递归查找子树里所有名为 name 的字段值。 */
function collectRecurseField(value, name) {
  const output = [];
  const walk = (node) => {
    if (node instanceof Map && node.has(name)) output.push(node.get(name));
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else if (node instanceof Map) {
      for (const item of node.values()) walk(item);
    }
  };
  walk(value);
  return output;
}

/* 收集路径：paths 输出所有值路径（不含根的空路径），leaf_paths 只输出叶子路径。
   值为 null 的节点不输出。 */
function collectPaths(value, leafOnly) {
  const output = [];
  const walk = (node, path) => {
    if (node === null || node === undefined) return;
    const isContainer = Array.isArray(node) || node instanceof Map;
    const included = leafOnly ? !isContainer : true;
    if (included && path.length > 0) output.push(path.slice());
    if (!isContainer) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, path.concat(index)));
    } else {
      for (const [key, item] of node) walk(item, path.concat(key));
    }
  };
  walk(value, []);
  return output;
}

/* 二元运算符求值：两侧各自产生输出流，按组合逐对运算（与 jq 的多输出语义一致）。 */
function evaluateBinary(node, input) {
  const lefts = evaluate(node.left, input);
  const rights = evaluate(node.right, input);
  const output = [];
  if (node.op === 'and' || node.op === 'or') {
    /* and / or 具备短路语义：左侧已能确定结果时不再计算右侧。 */
    for (const left of lefts) {
      const truthy = isTruthy(left);
      if (node.op === 'and' && !truthy) {
        output.push(false);
        continue;
      }
      if (node.op === 'or' && truthy) {
        output.push(true);
        continue;
      }
      for (const right of rights) output.push(isTruthy(right));
    }
    return output;
  }
  for (const left of lefts) {
    for (const right of rights) output.push(applyBinaryOperator(node.op, left, right));
  }
  return output;
}

/* 单次二元运算。 */
function applyBinaryOperator(op, left, right) {
  if (op === 'eq') return deepEqual(left, right);
  if (op === 'ne') return !deepEqual(left, right);
  if (op === 'lt') return compareValues(left, right) < 0;
  if (op === 'le') return compareValues(left, right) <= 0;
  if (op === 'gt') return compareValues(left, right) > 0;
  if (op === 'ge') return compareValues(left, right) >= 0;
  if (op === 'add') return jqAdd(left, right);
  if (op === 'sub') return jqSubtract(left, right);
  if (op === 'mul') return jqMultiply(left, right);
  if (op === 'div') return jqDivide(left, right);
  if (op === 'mod') return jqModulo(left, right);
  throw new RuntimeError(`Unsupported operator: ${op}`);
}

/* AST 求值：返回输出流。 */
function evaluate(node, input) {
  switch (node.type) {
    case 'literal':
      return [node.value];
    case 'path':
      return evaluatePath(node.steps, input);
    case 'optional': {
      /* `?` 只抑制路径错误，其它运行时错误照常上报。 */
      try {
        return evaluate(node.expr, input);
      } catch (err) {
        if (err instanceof PathError) return [];
        throw err;
      }
    }
    case 'pipe': {
      const output = [];
      for (const value of evaluate(node.left, input)) {
        for (const item of evaluate(node.right, value)) output.push(item);
      }
      return output;
    }
    case 'comma':
      return evaluate(node.left, input).concat(evaluate(node.right, input));
    case 'alternative': {
      /* a // b：a 的非 false / null 输出优先，没有则用 b 的输出。 */
      const kept = evaluate(node.left, input).filter((value) => value !== null && value !== false);
      if (kept.length) return kept;
      return evaluate(node.right, input);
    }
    case 'binary':
      return evaluateBinary(node, input);
    case 'negate': {
      const output = [];
      for (const value of evaluate(node.expr, input)) {
        if (typeof value !== 'number') {
          throw new RuntimeError(`Cannot negate ${typeName(value)}`);
        }
        output.push(-value);
      }
      return output;
    }
    case 'recurse':
      return collectDescendants(input);
    case 'recurseField':
      return collectRecurseField(input, node.name);
    case 'arrayConstruct':
      return [evaluate(node.expr, input)];
    case 'objectConstruct': {
      /* 与 jq 一致：各键的值分别求值；某个键有多个输出时，按组合生成多个对象。 */
      let objects = [new Map()];
      for (const entry of node.entries) {
        const values = evaluate(entry.value, input);
        const next = [];
        for (const object of objects) {
          for (const value of values) {
            const copy = new Map(object);
            copy.set(entry.key, value);
            next.push(copy);
          }
        }
        objects = next;
      }
      return objects;
    }
    case 'call':
      return applyCall(node, input);
    default:
      throw new RuntimeError(`unsupported expression: ${node.type}`);
  }
}

/* ================================================================== *
 * 内置函数（builtins）
 * ================================================================== */

/* 取可迭代元素：数组 → 元素，对象 → 值。 */
function iterableItems(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return Array.from(value.values());
  throw new RuntimeError(`Cannot iterate over ${typeName(value)}`);
}

/* jq 的 `+` 语义：null 视作 0 / 空串，数字相加、字符串拼接、数组拼接、对象合并。 */
function jqAdd(left, right) {
  if (left === null || left === undefined) return right;
  if (right === null || right === undefined) return left;
  const leftType = typeName(left);
  const rightType = typeName(right);
  if (leftType === 'number' && rightType === 'number') return left + right;
  if (leftType === 'string' && rightType === 'string') return left + right;
  if (leftType === 'array' && rightType === 'array') return left.concat(right);
  if (leftType === 'object' && rightType === 'object') {
    const result = new Map(left);
    for (const [key, value] of right) result.set(key, value);
    return result;
  }
  throw new RuntimeError(`Cannot add ${leftType} and ${rightType}`);
}

/* jq 的 `-`：null - x = null，x - null = x；数字相减；数组按值移除元素。 */
function jqSubtract(left, right) {
  if (left === null || left === undefined) return null;
  if (right === null || right === undefined) return left;
  const leftType = typeName(left);
  const rightType = typeName(right);
  if (leftType === 'number' && rightType === 'number') return left - right;
  if (leftType === 'array' && rightType === 'array') {
    /* 从左数组中移除右数组里出现过的所有元素（按值相等）。 */
    return left.filter((item) => !right.some((candidate) => deepEqual(candidate, item)));
  }
  throw new RuntimeError(`Cannot subtract ${rightType} from ${leftType}`);
}

/* jq 的 `*`：只支持数字。 */
function jqMultiply(left, right) {
  if (typeof left !== 'number' || typeof right !== 'number') {
    throw new RuntimeError(`Cannot multiply ${typeName(left)} and ${typeName(right)}`);
  }
  return left * right;
}

/* jq 的 `/`：真除法（4 / 2 → 2，1 / 2 → 0.5），除以 0 报错。 */
function jqDivide(left, right) {
  if (typeof left !== 'number' || typeof right !== 'number') {
    throw new RuntimeError(`Cannot divide ${typeName(left)} and ${typeName(right)}`);
  }
  if (right === 0) throw new RuntimeError('Cannot divide number by zero');
  return left / right;
}

/* jq 的 `%`：取模（截断取余，与 JS 一致），模数为 0 报错。 */
function jqModulo(left, right) {
  if (typeof left !== 'number' || typeof right !== 'number') {
    throw new RuntimeError(`Cannot modulo ${typeName(left)} and ${typeName(right)}`);
  }
  if (right === 0) throw new RuntimeError('Cannot modulo by zero');
  return left % right;
}

/* from_entries：支持 {key,value} / {name,val} / {k,v} 等写法。 */
function fromEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new RuntimeError(`Cannot use from_entries with ${typeName(entries)}`);
  }
  const result = new Map();
  for (const entry of entries) {
    if (!(entry instanceof Map)) {
      throw new RuntimeError(`Cannot use from_entries with ${typeName(entry)}`);
    }
    const key = pickEntryField(entry, ['key', 'name', 'k', 'Key', 'Name', 'K']);
    const value = pickEntryField(entry, ['value', 'val', 'v', 'Value', 'Val', 'V']);
    result.set(key === null || key === undefined ? 'null' : String(key), value === undefined ? null : value);
  }
  return result;
}

function pickEntryField(entry, names) {
  for (const name of names) {
    if (entry.has(name)) return entry.get(name);
  }
  return null;
}

/* contains：字符串包含子串 / 数组包含全部元素 / 对象包含全部键值。 */
function containsValue(left, right) {
  const leftType = typeName(left);
  const rightType = typeName(right);
  if (rightType === 'string' && leftType === 'string') return left.includes(right);
  if (rightType === 'array' && leftType === 'array') {
    return right.every((item) => left.some((candidate) => containsValue(candidate, item)));
  }
  if (rightType === 'object' && leftType === 'object') {
    for (const [key, value] of right) {
      if (!left.has(key) || !containsValue(left.get(key), value)) return false;
    }
    return true;
  }
  if (leftType !== rightType) return false;
  return deepEqual(left, right);
}

/* 按 f 计算排序键（取 f 的第一个输出，无输出时按 null 处理）。 */
function keyedItems(items, filterNode) {
  return items.map((item) => {
    const outputs = evaluate(filterNode, item);
    return { item, key: outputs.length ? outputs[0] : null };
  });
}

/* join 的元素转字符串：null → 空串，数字 / 布尔 → 文本，其它类型报错。 */
function joinString(value) {
  const kind = typeName(value);
  if (kind === 'null') return '';
  if (kind === 'string') return value;
  if (kind === 'number' || kind === 'boolean') return String(value);
  throw new RuntimeError(`Cannot join ${kind}`);
}

/* 函数调用求值：返回输出流。 */
function applyCall(node, input) {
  const name = node.name;
  const args = node.args;

  /* 值参数：先对当前输入求值，取第一个输出；无输出则整个调用无输出。 */
  const valueArg = (index) => {
    const outputs = evaluate(args[index], input);
    return outputs.length ? outputs[0] : undefined;
  };

  switch (name) {
    /* ---------------- 类型与基础 ---------------- */
    case 'type':
      return [typeName(input)];
    case 'not':
      return [!isTruthy(input)];
    case 'empty':
      return [];
    case 'length': {
      const kind = typeName(input);
      if (kind === 'string') return [Array.from(input).length];
      if (kind === 'array') return [input.length];
      if (kind === 'object') return [input.size];
      if (kind === 'number') return [Math.abs(input)];
      if (kind === 'null') return [0];
      throw new RuntimeError(`Cannot get length of ${kind}`);
    }
    case 'keys': {
      if (input instanceof Map) return [Array.from(input.keys()).sort()];
      if (Array.isArray(input)) return [input.map((item, index) => index)];
      throw new RuntimeError(`Cannot get keys of ${typeName(input)}`);
    }
    case 'keys_unsorted': {
      if (input instanceof Map) return [Array.from(input.keys())];
      if (Array.isArray(input)) return [input.map((item, index) => index)];
      throw new RuntimeError(`Cannot get keys of ${typeName(input)}`);
    }
    case 'values': {
      if (input instanceof Map) return [Array.from(input.values())];
      if (Array.isArray(input)) return [input.slice()];
      throw new RuntimeError(`Cannot get values of ${typeName(input)}`);
    }

    /* ---------------- 数组 / 对象 ---------------- */
    case 'add': {
      const kind = typeName(input);
      if (kind === 'null') return [null];
      if (kind === 'number' || kind === 'string') return [input];
      if (kind === 'array' || kind === 'object') {
        let accumulator = null;
        for (const item of iterableItems(input)) accumulator = jqAdd(accumulator, item);
        return [accumulator];
      }
      throw new RuntimeError(`Cannot add ${kind}`);
    }
    case 'sort': {
      if (!Array.isArray(input)) throw new RuntimeError(`Cannot sort ${typeName(input)}`);
      return [input.slice().sort(compareValues)];
    }
    case 'unique': {
      if (!Array.isArray(input)) throw new RuntimeError(`Cannot unique ${typeName(input)}`);
      const sorted = input.slice().sort(compareValues);
      const output = [];
      for (const item of sorted) {
        if (!output.length || !deepEqual(output[output.length - 1], item)) output.push(item);
      }
      return [output];
    }
    case 'reverse': {
      if (Array.isArray(input)) return [input.slice().reverse()];
      if (typeof input === 'string') return [Array.from(input).reverse().join('')];
      throw new RuntimeError(`Cannot reverse ${typeName(input)}`);
    }
    case 'flatten': {
      if (!Array.isArray(input)) throw new RuntimeError(`Cannot flatten ${typeName(input)}`);
      let depth = 1;
      if (args.length === 1) {
        const value = valueArg(0);
        if (value === undefined) return [];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
          throw new RuntimeError('flatten depth must be an integer greater than or equal to 1');
        }
        depth = value;
      }
      const flatten = (items, remaining) => {
        const output = [];
        for (const item of items) {
          if (Array.isArray(item) && remaining > 0) output.push(...flatten(item, remaining - 1));
          else output.push(item);
        }
        return output;
      };
      return [flatten(input, depth)];
    }
    case 'min':
    case 'max': {
      if (!Array.isArray(input)) throw new RuntimeError(`Cannot get ${name} of ${typeName(input)}`);
      if (!input.length) return [null];
      let best = input[0];
      for (let index = 1; index < input.length; index += 1) {
        const result = compareValues(input[index], best);
        if (name === 'min' ? result < 0 : result > 0) best = input[index];
      }
      return [best];
    }
    case 'first':
    case 'last': {
      if (args.length === 1) {
        const outputs = evaluate(args[0], input);
        if (!outputs.length) return [null];
        return [name === 'first' ? outputs[0] : outputs[outputs.length - 1]];
      }
      if (!Array.isArray(input)) throw new RuntimeError(`Cannot use ${name} with ${typeName(input)}`);
      if (!input.length) return [null];
      return [name === 'first' ? input[0] : input[input.length - 1]];
    }
    case 'to_entries': {
      if (!(input instanceof Map)) throw new RuntimeError(`Cannot use to_entries with ${typeName(input)}`);
      const output = [];
      for (const [key, value] of input) {
        const entry = new Map();
        entry.set('key', key);
        entry.set('value', value);
        output.push(entry);
      }
      return [output];
    }
    case 'from_entries':
      return [fromEntries(input)];

    /* ---------------- 数值 ---------------- */
    case 'floor':
    case 'ceil':
    case 'round':
    case 'sqrt':
    case 'abs': {
      if (typeof input !== 'number') throw new RuntimeError(`Cannot use ${name} with ${typeName(input)}`);
      if (name === 'floor') return [Math.floor(input)];
      if (name === 'ceil') return [Math.ceil(input)];
      if (name === 'sqrt') return [Math.sqrt(input)];
      if (name === 'abs') return [Math.abs(input)];
      /* round：四舍五入且远离零（-1.5 → -2）。 */
      return [input < 0 ? -Math.round(-input) : Math.round(input)];
    }

    /* ---------------- 字符串 ---------------- */
    case 'tostring': {
      const kind = typeName(input);
      if (kind === 'string') return [input];
      if (kind === 'number' || kind === 'boolean' || kind === 'null') return [String(input)];
      throw new RuntimeError(`Cannot convert ${kind} to string`);
    }
    case 'tonumber': {
      if (typeof input === 'number') return [input];
      if (typeof input === 'string') {
        const text = input.trim();
        if (text === '' || !/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
          throw new RuntimeError(`Cannot parse "${input}" as number`);
        }
        return [Number(text)];
      }
      throw new RuntimeError(`Cannot convert ${typeName(input)} to number`);
    }
    case 'tojson':
      return [JSON.stringify(toPlain(input))];
    case 'ascii_downcase':
    case 'ascii_upcase': {
      if (typeof input !== 'string') throw new RuntimeError(`Cannot use ${name} with ${typeName(input)}`);
      const output = name === 'ascii_downcase'
        ? input.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32))
        : input.replace(/[a-z]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 32));
      return [output];
    }
    case 'explode': {
      if (typeof input !== 'string') throw new RuntimeError(`Cannot use explode with ${typeName(input)}`);
      return [Array.from(input).map((char) => char.codePointAt(0))];
    }
    case 'implode': {
      if (!Array.isArray(input)) throw new RuntimeError(`Cannot use implode with ${typeName(input)}`);
      const codes = [];
      for (const item of input) {
        if (typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item > 0x10ffff) {
          throw new RuntimeError(`Cannot implode ${typeName(item)}`);
        }
        codes.push(item);
      }
      return [String.fromCodePoint(...codes)];
    }
    case 'startswith':
    case 'endswith':
    case 'ltrimstr':
    case 'rtrimstr': {
      const value = valueArg(0);
      if (value === undefined) return [];
      if (typeof input !== 'string') throw new RuntimeError(`Cannot use ${name} with ${typeName(input)}`);
      if (typeof value !== 'string') throw new RuntimeError(`Cannot use ${name} with ${typeName(value)}`);
      if (name === 'startswith') return [input.startsWith(value)];
      if (name === 'endswith') return [input.endsWith(value)];
      if (name === 'ltrimstr') return [input.startsWith(value) ? input.slice(value.length) : input];
      return [input.endsWith(value) ? input.slice(0, input.length - value.length) : input];
    }
    case 'split': {
      const value = valueArg(0);
      if (value === undefined) return [];
      if (typeof input !== 'string') throw new RuntimeError(`Cannot use split with ${typeName(input)}`);
      if (typeof value !== 'string') throw new RuntimeError('split separator must be a string');
      return [input.split(value)];
    }
    case 'join': {
      const value = valueArg(0);
      if (value === undefined) return [];
      if (!Array.isArray(input)) throw new RuntimeError(`Cannot use join with ${typeName(input)}`);
      if (typeof value !== 'string') throw new RuntimeError('join separator must be a string');
      return [input.map(joinString).join(value)];
    }
    case 'test': {
      const value = valueArg(0);
      if (value === undefined) return [];
      if (typeof input !== 'string') throw new RuntimeError(`Cannot use test with ${typeName(input)}`);
      if (typeof value !== 'string') throw new RuntimeError('test pattern must be a string');
      let pattern;
      try {
        pattern = new RegExp(value);
      } catch (err) {
        throw new RuntimeError(`Invalid regular expression: ${value}`);
      }
      return [pattern.test(input)];
    }

    /* ---------------- 容器判定 ---------------- */
    case 'has': {
      const value = valueArg(0);
      if (value === undefined) return [];
      const kind = typeName(input);
      if (kind === 'object') return [input.has(String(value))];
      if (kind === 'array') {
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          throw new RuntimeError('has requires a number key for arrays');
        }
        return [value >= 0 && value < input.length];
      }
      throw new RuntimeError(`Cannot use has with ${kind}`);
    }
    case 'contains':
    case 'inside': {
      const value = valueArg(0);
      if (value === undefined) return [];
      const kind = typeName(input);
      const otherKind = typeName(value);
      if (name === 'contains') {
        if (kind === 'string' && otherKind === 'string') return [input.includes(value)];
        if (kind === 'array' && otherKind === 'array') return [containsValue(input, value)];
        if (kind === 'object' && otherKind === 'object') return [containsValue(input, value)];
        throw new RuntimeError(`Cannot check whether ${kind} contains ${otherKind}`);
      }
      /* inside：反向包含。 */
      if (otherKind === 'string' && kind === 'string') return [value.includes(input)];
      if (otherKind === 'array' && kind === 'array') return [containsValue(value, input)];
      if (otherKind === 'object' && kind === 'object') return [containsValue(value, input)];
      throw new RuntimeError(`Cannot check whether ${otherKind} contains ${kind}`);
    }
    case 'getpath': {
      const value = valueArg(0);
      if (value === undefined) return [];
      if (!Array.isArray(value)) throw new RuntimeError('getpath requires an array path');
      let current = input;
      for (const segment of value) {
        if (current === null || current === undefined) return [null];
        const kind = typeName(current);
        if (typeof segment === 'string') {
          if (kind !== 'object') return [null];
          const item = current.get(segment);
          current = item === undefined ? null : item;
        } else if (typeof segment === 'number') {
          if (kind !== 'array') return [null];
          let index = segment;
          if (index < 0) index += current.length;
          current = index >= 0 && index < current.length ? current[index] : null;
        } else {
          throw new RuntimeError('getpath path segments must be strings or numbers');
        }
      }
      return [current];
    }

    /* ---------------- 过滤器参数 ---------------- */
    case 'map': {
      const output = [];
      for (const item of iterableItems(input)) output.push(...evaluate(args[0], item));
      return [output];
    }
    case 'map_values': {
      if (Array.isArray(input)) {
        const output = [];
        for (const item of input) {
          const outputs = evaluate(args[0], item);
          if (outputs.length) output.push(outputs[0]);
        }
        return [output];
      }
      if (input instanceof Map) {
        const output = new Map();
        for (const [key, value] of input) {
          const outputs = evaluate(args[0], value);
          if (outputs.length) output.set(key, outputs[0]);
        }
        return [output];
      }
      throw new RuntimeError(`Cannot use map_values with ${typeName(input)}`);
    }
    case 'select': {
      const outputs = evaluate(args[0], input);
      return outputs.some(isTruthy) ? [input] : [];
    }
    case 'sort_by': {
      if (!Array.isArray(input)) throw new RuntimeError(`Cannot use sort_by with ${typeName(input)}`);
      const keyed = keyedItems(input, args[0]).sort((left, right) => compareValues(left.key, right.key));
      return [keyed.map((entry) => entry.item)];
    }
    case 'group_by': {
      if (!Array.isArray(input)) throw new RuntimeError(`Cannot use group_by with ${typeName(input)}`);
      const keyed = keyedItems(input, args[0]).sort((left, right) => compareValues(left.key, right.key));
      const groups = [];
      for (const entry of keyed) {
        const last = groups[groups.length - 1];
        if (last && deepEqual(last.key, entry.key)) last.items.push(entry.item);
        else groups.push({ key: entry.key, items: [entry.item] });
      }
      return [groups.map((group) => group.items)];
    }
    case 'unique_by': {
      if (!Array.isArray(input)) throw new RuntimeError(`Cannot use unique_by with ${typeName(input)}`);
      const keyed = keyedItems(input, args[0]).sort((left, right) => compareValues(left.key, right.key));
      const output = [];
      for (const entry of keyed) {
        if (!output.length || !deepEqual(output[output.length - 1].key, entry.key)) output.push(entry);
      }
      return [output.map((entry) => entry.item)];
    }
    case 'min_by':
    case 'max_by': {
      if (!Array.isArray(input)) throw new RuntimeError(`Cannot use ${name} with ${typeName(input)}`);
      if (!input.length) return [null];
      const keyed = keyedItems(input, args[0]);
      let best = keyed[0];
      for (let index = 1; index < keyed.length; index += 1) {
        const result = compareValues(keyed[index].key, best.key);
        if (name === 'min_by' ? result < 0 : result > 0) best = keyed[index];
      }
      return [best.item];
    }
    case 'with_entries': {
      if (!(input instanceof Map)) throw new RuntimeError(`Cannot use with_entries with ${typeName(input)}`);
      const output = [];
      for (const [key, value] of input) {
        const entry = new Map();
        entry.set('key', key);
        entry.set('value', value);
        output.push(...evaluate(args[0], entry));
      }
      return [fromEntries(output)];
    }

    /* ---------------- 聚合 ---------------- */
    case 'any':
    case 'all': {
      const items = iterableItems(input);
      if (args.length === 0) {
        return [name === 'any' ? items.some(isTruthy) : items.every(isTruthy)];
      }
      for (const item of items) {
        const outputs = evaluate(args[0], item);
        const satisfied = outputs.some(isTruthy);
        if (name === 'any' && satisfied) return [true];
        if (name === 'all' && !satisfied) return [false];
      }
      return [name === 'any' ? false : true];
    }

    /* ---------------- 路径输出 ---------------- */
    case 'paths':
      return collectPaths(input, false);
    case 'leaf_paths':
      return collectPaths(input, true);

    /* ---------------- 类型过滤器 ---------------- */
    case 'arrays':
      return Array.isArray(input) ? [input] : [];
    case 'objects':
      return input instanceof Map ? [input] : [];
    case 'strings':
      return typeof input === 'string' ? [input] : [];
    case 'numbers':
      return typeof input === 'number' ? [input] : [];
    case 'booleans':
      return typeof input === 'boolean' ? [input] : [];
    case 'nulls':
      return input === null ? [input] : [];

    /* ---------------- 序列 ---------------- */
    case 'range': {
      const values = [];
      for (let index = 0; index < args.length; index += 1) {
        const value = valueArg(index);
        if (value === undefined) return [];
        values.push(value);
      }
      for (const value of values) {
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          throw new RuntimeError('Range bounds must be integers');
        }
      }
      const from = values.length === 1 ? 0 : values[0];
      const to = values.length === 1 ? values[0] : values[1];
      const step = values.length === 3 ? values[2] : 1;
      if (step === 0) throw new RuntimeError('Range step must not be zero');
      const output = [];
      if (step > 0) {
        for (let value = from; value < to; value += step) output.push(value);
      } else {
        for (let value = from; value > to; value += step) output.push(value);
      }
      return output;
    }
    case 'limit': {
      const count = valueArg(0);
      if (count === undefined) return [];
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
        throw new RuntimeError('limit requires a non-negative integer');
      }
      return evaluate(args[1], input).slice(0, count);
    }
    default:
      throw new RuntimeError(`Unknown function: ${name}`);
  }
}

/* ================================================================== *
 * 对外接口
 * ================================================================== */

/* 把内部异常转换成错误文本。 */
function formatError(err) {
  if (err instanceof UnknownFunctionError) return err.message;
  if (err instanceof FilterSyntaxError) return `syntax error: ${err.message}`;
  if (err instanceof JqError) return err.message;
  if (err && typeof err.message === 'string' && err.message) return err.message;
  return String(err);
}

/* 解析过滤器：{ ok: true, ast } | { ok: false, error }。 */
function parse(filter) {
  try {
    return { ok: true, ast: parseFilter(filter) };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

/* 执行过滤器：{ ok: true, results } | { ok: false, error }。 */
function run(filter, value) {
  let ast;
  try {
    ast = parseFilter(filter);
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
  try {
    const outputs = evaluate(ast, toInternal(value));
    return { ok: true, results: outputs.map(toPlain) };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

/* 支持的内置函数名（按字母序）。 */
const FUNCTIONS = Object.keys(FUNCTION_SPECS).sort();

module.exports = { parse, run, FUNCTIONS };
