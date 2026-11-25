'use strict';

/* Vessel CLI 支持（macOS）：
   - 在 <数据目录>/vessel-cli.sock 上开一个仅供本机同一用户访问的 Unix socket 接口
     （不监听网络端口、不落盘任何令牌；socket 权限 0600）；
   - 「安装 CLI」把 assets/cli/vessel.sh 与 _vessel（zsh 补全）复制到 <数据目录>/bin/，
     并把 <数据目录>/bin 加进 ~/.zshrc 的 PATH（带起止标记、可重复安装）。
   命令行（vessel）通过该 socket 读取工具 / SSH 主机 / 2FA 验证码，并打开对应的工具或会话。 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const { DATA_DIR } = require('../utils/paths');
const { FILE_EDITOR_MAX_BYTES, VERSION } = require('../../shared/constants');
const logger = require('../utils/logger');

const BIN_DIR = path.join(DATA_DIR, 'bin');
const SCRIPT_FILE = path.join(BIN_DIR, 'vessel');
const COMPLETION_FILE = path.join(BIN_DIR, '_vessel');
// 短别名：安装时把 `vess` 指向 `vessel`（同一条脚本，symlink 保持同步）。
const ALIAS_FILE = path.join(BIN_DIR, 'vess');
const SOCKET_FILE = path.join(DATA_DIR, 'vessel-cli.sock');
const ZSHRC_FILE = path.join(os.homedir(), '.zshrc');
const BLOCK_START = '# >>> vessel cli >>>';
const BLOCK_END = '# <<< vessel cli <<<';
// 请求体上限（工具 id / SSH 别名都远小于它）。
const MAX_BODY = 4096;
// `vess json "<JSON 文本>"` 的请求体会包含完整 JSON，单独放宽上限。
const JSON_MAX_BODY = 2 * 1024 * 1024;
// JSON 格式化缩进：默认 4 空格（与 JSON 工具一致），`?indent=N` 可覆盖（0 = 紧凑单行）。
const JSON_INDENT_DEFAULT = 4;
const JSON_INDENT_MAX = 10;

/* 工具清单（英文名）：CLI 统一用英文输出，不随界面语言变化；
   顺序与 renderer 的 tool-order.js 一致（渲染层从未上报时也按这个顺序列出）。 */
const FALLBACK_TOOLS = [
  { id: 'ssh', label: 'SSH' },
  { id: 'timestamp', label: 'Timestamp' },
  { id: 'subnet', label: 'IP / Subnet' },
  { id: 'encode', label: 'Text & encoding' },
  { id: 'radix', label: 'Units' },
  { id: 'json', label: 'JSON' },
  { id: 'hash', label: 'Hash' },
  { id: 'regex', label: 'Regex' },
  { id: 'color', label: 'Color' },
  { id: 'ids', label: 'IDs & passwords' },
  { id: 'nutrient', label: 'Nutrition' },
  { id: 'clipboard', label: 'Clipboard' },
  { id: 'games', label: 'Games' },
];

let server = null;

/* CLI 统一显示英文工具名：已知工具用内置英文名，未知工具（后续新增、表里没有）退回渲染层名称。 */
function englishToolLabel(id, fallback) {
  const hit = FALLBACK_TOOLS.find((tool) => tool.id === id);
  return hit ? hit.label : fallback;
}

/* 当前可用的工具：优先用渲染层上报的清单（保留应用里的顺序），否则用兜底。 */
function tools() {
  let reported = [];
  try {
    reported = require('../tray').getAllTools();
  } catch (err) {
    reported = [];
  }
  if (reported.length) {
    return reported.map((tool) => ({ id: tool.id, label: englishToolLabel(tool.id, tool.label) }));
  }
  return FALLBACK_TOOLS.map((tool) => ({ id: tool.id, label: tool.label }));
}

function findTool(key) {
  const wanted = String(key || '').trim();
  if (!wanted) return null;
  const list = tools();
  const lower = wanted.toLowerCase();
  // 兼容旧命令：2FA 已并入「ID 与密码」。
  const aliases = { twofa: 'ids', totp: 'ids', '2fa': 'ids' };
  const alias = aliases[lower];
  if (alias) {
    const hit = list.find((tool) => tool.id === alias);
    if (hit) return hit;
  }
  return (
    list.find((tool) => tool.id === wanted) ||
    list.find((tool) => String(tool.label).toLowerCase() === lower) ||
    null
  );
}

function sshHosts() {
  try {
    return require('./ssh-config-service').list();
  } catch (err) {
    return [];
  }
}

/* 账号显示名：标题 + 副标题；用户输入里的制表符 / 换行压成空格，保证一行一条。 */
function clean(value) {
  return String(value == null ? '' : value)
    .replace(/[\t\r\n]+/g, ' ')
    .trim();
}

function twofaRows() {
  let accounts = [];
  let codes = {};
  try {
    const service = require('./totp-service');
    accounts = service.list();
    if (accounts.length) codes = service.codes();
  } catch (err) {
    accounts = [];
  }
  const now = Math.floor(Date.now() / 1000);
  return accounts.map((account) => {
    const period = Number(account.period) || 30;
    const left = period - (now % period);
    const title = clean(account.title);
    const subtitle = clean(account.subtitle);
    const name = title && subtitle ? `${title} (${subtitle})` : title || subtitle || 'Unnamed';
    return { name, code: codes[account.id] || '', left, id: account.id };
  });
}

/* ------------------------------- 响应内容 ------------------------------- */

/* 终端显示宽度：CJK / 全角字符按 2 列计，保证列表列对齐。 */
function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1f64f) ||
      (code >= 0x1f900 && code <= 0x1f9ff) ||
      (code >= 0x20000 && code <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

function padCell(text, width) {
  const value = String(text == null ? '' : text);
  return value + ' '.repeat(Math.max(0, width - displayWidth(value)));
}

/* 表头 + 行都按列对齐（两空格分隔、去掉行尾空白）。 */
function formatTable(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(displayWidth(header), ...rows.map((row) => displayWidth(row[index] || '')))
  );
  const line = (cells) =>
    cells
      .map((cell, index) => padCell(cell, widths[index]))
      .join('  ')
      .replace(/\s+$/, '');
  return `${[line(headers), ...rows.map(line)].join('\n')}\n`;
}

/* 主机显示名统一成「用户名@地址」（与 SSH 工具列表一致）；无用户名时退回地址。 */
function sshAddress(host) {
  const user = clean(host.user);
  const hostName = clean(host.hostName) || clean(host.alias);
  return user ? `${user}@${hostName}` : hostName;
}

function sshRows() {
  return sshHosts().map((host) => ({
    address: sshAddress(host),
    group: clean(host.group) || '-',
    alias: host.alias,
  }));
}

function sshText() {
  const rows = sshRows();
  if (!rows.length) return 'No SSH hosts.\n';
  return formatTable(
    ['HOST', 'GROUP', 'ALIAS'],
    rows.map((row) => [row.address, row.group, row.alias])
  );
}

function twofaText() {
  const rows = twofaRows();
  if (!rows.length) return 'No 2FA accounts.\n';
  return formatTable(
    ['ACCOUNT', 'CODE', 'LEFT'],
    rows.map((row) => [row.name, row.code, `${row.left}s`])
  );
}

function completeText(kind) {
  const values = [];
  if (kind === 'ssh') {
    // 与 `vessel ssh ls` 的显示一致：补全「用户名@地址」。
    const seen = new Set();
    for (const row of sshRows()) {
      if (!seen.has(row.address)) {
        seen.add(row.address);
        values.push(row.address);
      }
    }
  }
  return values.length ? `${values.join('\n')}\n` : '';
}

/* ------------------------------- 数据命令 ------------------------------- */

/* 本地时间：`YYYY-MM-DD HH:mm:ss.SSS +08:00`。 */
function formatLocal(date) {
  const pad = (value, width) => String(value).padStart(width || 2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    `${pad(date.getMilliseconds(), 3)} ${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/* `vessel timestamp [value]`：不带参数输出当前时间 + 秒 / 毫秒 / 纳秒；
   带参数时自动识别时间戳单位（≤11 位秒 / ≤15 位毫秒 / 其余纳秒）或解析日期字符串。 */
function timestampCommand(body) {
  const raw = String(body == null ? '' : body).trim();
  let millis;
  let nanos;
  let source = '';
  if (!raw) {
    millis = Date.now();
    // 用 hrtime 补出亚毫秒部分，纳秒时间戳不至于全是 0
    nanos = BigInt(millis) * 1000000n + (process.hrtime.bigint() % 1000000n);
    source = 'now';
  } else if (/^-?\d+$/.test(raw)) {
    const negative = raw.startsWith('-');
    const digits = negative ? raw.slice(1) : raw;
    const number = Number(raw);
    if (digits.length <= 11) {
      millis = number * 1000;
      source = 'seconds';
    } else if (digits.length <= 15) {
      millis = number;
      source = 'milliseconds';
    } else {
      millis = Math.floor(number / 1e6);
      source = 'nanoseconds';
    }
    nanos = BigInt(Math.round(millis)) * 1000000n;
  } else {
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) return { code: 400, message: `Cannot parse: ${raw}` };
    millis = parsed;
    nanos = BigInt(millis) * 1000000n;
    source = 'date';
  }
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return { code: 400, message: `Cannot parse: ${raw}` };
  const seconds = Math.floor(millis / 1000);
  const rows = [];
  if (raw) rows.push(['Input', `${raw}  (${source})`]);
  rows.push(
    ['Date', formatLocal(date)],
    ['UTC', date.toISOString()],
    ['Seconds', String(seconds)],
    ['Millis', String(millis)],
    ['Nanos', nanos.toString()]
  );
  return { code: 200, body: formatTable(['FIELD', 'VALUE'], rows) };
}

/* 无参数的 `vessel network`：本机内网（局域网）与公网出口 IP（v4 / v6）。 */
async function localAddressOutput() {
  const localAddress = require('./local-address-service');
  const [lan4, lan6, public4, public6] = await Promise.all([
    Promise.resolve(localAddress.lanAddress('lan4')),
    Promise.resolve(localAddress.lanAddress('lan6')),
    localAddress.publicAddress('public4').catch(() => null),
    localAddress.publicAddress('public6').catch(() => null),
  ]);
  const rows = [
    ['LAN IPv4', lan4 || '-'],
    ['LAN IPv6', lan6 || '-'],
    ['Public IPv4', public4 || '-'],
    ['Public IPv6', public6 || '-'],
  ];
  return { code: 200, body: formatTable(['KIND', 'ADDRESS'], rows) };
}

/* `vessel network [ip|cidr|mask]`：无参数时输出本机内网 / 公网地址；
   带参数时输出网段信息（与 IP 工具一致）。 */
async function networkCommand(body) {
  const raw = String(body == null ? '' : body).trim();
  if (!raw) return localAddressOutput();
  const netService = require('./net-service');
  const result = netService.describe(raw);
  if (!result.ok) {
    const message = result.error === 'badPrefix' ? 'Invalid prefix length' : `Invalid IP address or network: ${raw}`;
    return { code: 400, message };
  }
  const info = result.info;
  const scopeLabels = {
    private: 'private',
    public: 'public',
    loopback: 'loopback',
    linkLocal: 'link-local',
    cgnat: 'CGNAT',
    unspecified: 'unspecified',
    mapped: 'IPv4-mapped',
    multicast: 'multicast',
  };
  const rows =
    info.kind === 'ipv4'
      ? [
          ['Address', info.address],
          ['CIDR', info.cidr],
          ['Prefix', `/${info.prefix}`],
          ['Network', info.network],
          ['Broadcast', info.broadcast],
          ['Usable', info.range],
          ['Hosts', info.hosts.toLocaleString('en-US')],
          ['Netmask', info.netmask],
          ['Wildcard', info.wildcard],
          ['Scope', scopeLabels[info.scope] || info.scope],
        ]
      : [
          ['Address', info.compressed],
          ['CIDR', info.cidr],
          ['Prefix', `/${info.prefix}`],
          ['Network', info.network],
          ['Last', info.last],
          ['Addresses', BigInt(info.total).toLocaleString('en-US')],
          ['Netmask', info.netmask],
          ['Wildcard', info.wildcard],
          ['Expanded', info.expanded],
          ['Scope', scopeLabels[info.scope] || info.scope],
        ];
  const note = result.defaulted ? 'No prefix given, assuming /24.\n' : '';
  return { code: 200, body: note + formatTable(['FIELD', 'VALUE'], rows) };
}

/* `vessel codec <text>`：输出各种编码（与「文本处理」工具一致）。 */
function codecCommand(body) {
  const text = String(body == null ? '' : body);
  const codec = require('./codec-service');
  const out = codec.encodeAll(text);
  const rows = [
    ['Text', out.text],
    ['Base64', out.base64],
    ['Hex', out.hex],
    ['URL encode', out.url],
    ['URL decode', out.urlDecode],
    ['ASCII', out.ascii],
  ];
  return { code: 200, body: formatTable(['FIELD', 'VALUE'], rows) };
}

/* 请求体第一行是类型（text / file），其余是内容。 */
function parseKindBody(body) {
  const text = String(body == null ? '' : body);
  const index = text.indexOf('\n');
  if (index < 0) return { kind: '', value: text };
  return { kind: text.slice(0, index).trim(), value: text.slice(index + 1) };
}

/* 解析缩进参数：未给用默认值（4 空格）；给了必须是 0–10 的整数，否则返回 null（报错）。 */
function resolveJsonIndent(raw) {
  if (raw === undefined || raw === null) return JSON_INDENT_DEFAULT;
  const text = String(raw).trim();
  if (!text) return JSON_INDENT_DEFAULT;
  if (!/^\d+$/.test(text)) return null;
  const num = Number(text);
  if (!Number.isFinite(num) || num > JSON_INDENT_MAX) return null;
  return num;
}

/* `vessel json <file|text>`：把 JSON 文件 / 文本格式化后输出（默认 4 空格缩进，与 JSON 工具一致；
   `options.indent` 可指定缩进空格数（0 = 紧凑单行），非法值返回 400；
   `options.filter` 给定时按 jq 风格过滤器求值（见 jq-service），输出每个结果；
   `options.search` 给定时改为模糊搜索：输出「命中节点 + jq 风格路径」的表格。 */
function jsonCommand(body, options) {
  const opts = options || {};
  const indent = resolveJsonIndent(opts.indent);
  if (indent === null) {
    return { code: 400, message: `Invalid indent: expected 0-${JSON_INDENT_MAX}` };
  }
  const parsed = parseKindBody(body);
  const isFile = parsed.kind === 'file';
  let text = isFile ? parsed.value.trim() : parsed.value;
  if (!text) return { code: 400, message: 'JSON text or file required' };
  if (isFile) {
    try {
      const stat = fs.statSync(text);
      if (!stat.isFile()) return { code: 400, message: `Not a file: ${text}` };
      if (stat.size > FILE_EDITOR_MAX_BYTES) return { code: 400, message: 'File is larger than 8 MB' };
      text = fs.readFileSync(text, 'utf8');
    } catch (err) {
      return { code: 404, message: `File not found: ${text}` };
    }
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { code: 400, message: `Invalid JSON: ${(err && err.message) || 'parse error'}` };
  }
  const search = String(opts.search || '').trim();
  if (search) {
    const searchService = require('./json-search-service');
    const found = searchService.search(value, search);
    if (!found.ok) return { code: 400, message: found.error };
    if (!found.rows.length) return { code: 200, body: `No matches for "${search}"\n` };
    const rows = found.rows.map((row) => [row.path, row.type, searchService.formatValue(row.value)]);
    return { code: 200, body: formatTable(['PATH', 'TYPE', 'VALUE'], rows) };
  }
  const filter = String(opts.filter || '').trim();
  if (filter) {
    const jq = require('./jq-service');
    const result = jq.run(filter, value);
    if (!result.ok) return { code: 400, message: result.error };
    // 没有命中任何结果：不输出内容（与 jq 一致）。
    if (!result.results.length) return { code: 200, body: '' };
    const body = result.results.map((item) => JSON.stringify(item, null, indent)).join('\n');
    return { code: 200, body: `${body}\n` };
  }
  return { code: 200, body: `${JSON.stringify(value, null, indent)}\n` };
}

/* `vessel hash <text|file>`：输出全部 10 种算法。 */
async function hashCommand(body) {
  const parsed = parseKindBody(body);
  const isFile = parsed.kind === 'file';
  const value = isFile ? parsed.value.trim() : parsed.value;
  if (!value) return { code: 400, message: 'Text or file path required' };
  const hashService = require('./hash-service');
  let hashes;
  if (isFile) {
    try {
      const stat = fs.statSync(value);
      if (!stat.isFile()) return { code: 400, message: `Not a file: ${value}` };
    } catch (err) {
      return { code: 404, message: `File not found: ${value}` };
    }
    hashes = await hashService.hashFile(value);
  } else {
    hashes = hashService.hashText(value);
  }
  const rows = hashService.ALGORITHMS.map((algorithm) => [algorithm.label, hashes[algorithm.id] || '-']);
  const head = isFile ? `File  ${value}\n` : '';
  return { code: 200, body: head + formatTable(['ALGORITHM', 'HASH'], rows) };
}

/* `vessel id [type] [length]`：按类型生成 5 个值（uuid4 / uuid7 / ulid / random / password）。
   - uuid4：标准随机 UUID v4；
   - uuid7：48 位毫秒时间戳 + 版本 7（按时间排序）；
   - ulid：Crockford base32 的 26 位 ULID（同样按时间排序）；
   - random：随机字符串（默认 16 位，字符集为大小写字母 + 数字；可选第二参数指定 4–64 位）；
   - password：随机密码（默认 20 位，包含小写 / 大写 / 数字 / 符号且每类至少一个；可选第二参数指定 8–64 位）。 */
const ID_COUNT = 5;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RANDOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PASSWORD_CLASSES = [
  'abcdefghijklmnopqrstuvwxyz',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '0123456789',
  '!@#$%^&*()_+-=[]{}|;:,.<>?/~',
];
const ID_TYPES = ['uuid4', 'uuid7', 'ulid', 'random', 'password'];

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

/* 用 crypto.randomInt（CSPRNG）从字符集取字符，均匀分布。 */
function randomFrom(alphabet, length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

function randomPassword(length) {
  const chars = PASSWORD_CLASSES.map((set) => set[crypto.randomInt(set.length)]);
  const alphabet = PASSWORD_CLASSES.join('');
  while (chars.length < length) chars.push(alphabet[crypto.randomInt(alphabet.length)]);
  // Fisher–Yates 洗牌，保证各类别位置随机。
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }
  return chars.join('');
}

function uuidV7(timestamp) {
  const bytes = crypto.randomBytes(16);
  const ts = Number.isFinite(timestamp) ? Math.floor(timestamp) : Date.now();
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ts / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function encodeBase32(value, length) {
  let rest = BigInt(value);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out = CROCKFORD[Number(rest & 31n)] + out;
    rest >>= 5n;
  }
  return out;
}

function ulidValue(timestamp) {
  const random = BigInt(`0x${crypto.randomBytes(10).toString('hex')}`) & ((1n << 80n) - 1n);
  return encodeBase32(timestamp, 10) + encodeBase32(random, 16);
}

function idCommand(body) {
  const parts = String(body == null ? '' : body).trim().toLowerCase().split(/\s+/).filter(Boolean);
  const type = parts[0] || 'uuid4';
  const aliases = {
    uuid: 'uuid4',
    v4: 'uuid4',
    v7: 'uuid7',
    randomstring: 'random',
    rand: 'random',
    pass: 'password',
    pwd: 'password',
  };
  const kind = aliases[type] || type;
  if (ID_TYPES.indexOf(kind) === -1) {
    return { code: 400, message: 'Type must be one of: uuid4, uuid7, ulid, random, password' };
  }
  let length = 0;
  if (kind === 'random') length = clampInt(parts[1], 4, 64, 16);
  if (kind === 'password') length = clampInt(parts[1], 8, 64, 20);
  const lines = [];
  for (let i = 0; i < ID_COUNT; i += 1) {
    if (kind === 'uuid7') lines.push(uuidV7());
    else if (kind === 'ulid') lines.push(ulidValue(Date.now()));
    else if (kind === 'random') lines.push(randomFrom(RANDOM_ALPHABET, length));
    else if (kind === 'password') lines.push(randomPassword(length));
    else lines.push(crypto.randomUUID());
  }
  return { code: 200, body: `${lines.join('\n')}\n` };
}

/* 兼容旧命令：`/v1/uuid` 等价于 `/v1/id`。 */
function uuidCommand(body) {
  return idCommand(body);
}

/* ------------------------------- 动作 ------------------------------- */

function openTool(key) {
  const wanted = String(key || '').trim();
  const tool = findTool(wanted);
  if (!tool) return { code: 404, message: `Unknown command or tool: ${wanted}` };
  require('../tray').openTool(tool.id);
  logger.file(`[cli] open tool ${tool.id}`);
  return { code: 200, message: `Opened tool: ${tool.id}` };
}

/* 目标写法：`用户名@地址` / `地址` / `地址:端口` / `[IPv6]:端口`。 */
function parseTarget(raw) {
  let value = String(raw || '').trim();
  if (!value) return null;
  let user = '';
  const at = value.lastIndexOf('@');
  if (at >= 0) {
    user = value.slice(0, at).trim();
    value = value.slice(at + 1).trim();
  }
  let host = value;
  let port = 0;
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(value);
  if (bracketed) {
    host = bracketed[1];
    port = Number(bracketed[2]) || 0;
  } else {
    const withPort = /^([^:]+):(\d+)$/.exec(value);
    if (withPort) {
      host = withPort[1];
      port = Number(withPort[2]) || 0;
    }
  }
  if (!host) return null;
  return { user, host, port };
}

/* 解析出的目标是否就是这台已保存主机（忽略大小写；用户 / 端口写了才比较）。 */
function matchesParsed(host, parsed) {
  if (String(host.hostName || '').toLowerCase() !== parsed.host.toLowerCase()) return false;
  if (parsed.user && String(host.user || '').toLowerCase() !== parsed.user.toLowerCase()) return false;
  if (parsed.port && (Number(host.port) || 22) !== parsed.port) return false;
  return true;
}

/* `vessel ssh <user@host> [password]`：
   - 命中已保存的主机（别名，或同一「用户名@地址」）且没给密码 → 直接连接该主机（沿用已存密码 / 密钥）；
   - 其余写法 → 走「快速连接」（给了密码会更新已存凭据；新主机写入 ~/.ssh/config 的「快速连接」分组），
     与 SSH 工具里的连接表单逻辑一致。 */
async function connectSsh(body) {
  const parts = String(body || '').split('\n');
  const target = String(parts[0] || '').trim();
  // 密码里可以有空格（CLI 参数），但不会有换行。
  const password = parts.slice(1).join('\n');
  if (!target) return { code: 400, message: 'Target required: user@host' };

  const byAlias = sshHosts().find((host) => host.alias === target);
  if (byAlias) {
    const started = await require('../tray').connectHost(byAlias);
    logger.file(`[cli] ssh connect ${byAlias.alias} started=${started}`);
    if (!started) return { code: 500, message: 'Cannot open a terminal' };
    return { code: 200, message: `Connecting to ${byAlias.alias}` };
  }

  const parsed = parseTarget(target);
  if (!parsed) return { code: 400, message: `Invalid target: ${target}` };

  // 已保存的同一主机且没给新密码：直接连接（自动使用已存密码 / 密钥）。
  if (!password) {
    const existing = sshHosts().find((host) => matchesParsed(host, parsed));
    if (existing) {
      const started = await require('../tray').connectHost(existing);
      logger.file(`[cli] ssh connect ${existing.alias} started=${started}`);
      if (!started) return { code: 500, message: 'Cannot open a terminal' };
      return { code: 200, message: `Connecting to ${existing.alias}` };
    }
  }

  const result = await require('./ssh-quick-connect-service').quickConnect({
    hostName: parsed.host,
    user: parsed.user,
    port: parsed.port || 22,
    password,
  });
  if (!result || !result.ok) {
    return { code: 500, message: `Connect failed: ${(result && result.error) || 'error'}` };
  }
  logger.file(`[cli] ssh quick-connect ${result.alias} reused=${Boolean(result.reused)}`);
  return {
    code: 200,
    message: `Connecting to ${result.alias}${result.reused ? ' (reused)' : ' (quick connect)'}`,
  };
}

/* `vessel edit [file]`：
   - 不带参数 → 在编辑器里新建一个本地草稿（与终端内联命令 `\v edit` 一致）；
   - 带路径 → 打开该本地文件（支持 ~ 展开）。 */
function openEditor(body) {
  const wm = require('../window-manager');
  const sftp = require('./sftp-service');
  const raw = String(body || '').trim();
  if (!raw) {
    let filePath = '';
    try {
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      filePath = sftp.uniqueLocalPath(sftp.downloadDir(), `scratch-${stamp}.txt`);
      fs.writeFileSync(filePath, '', 'utf8');
    } catch (err) {
      return { code: 500, message: `Cannot create file: ${err.message}` };
    }
    const win = wm.openStandaloneFileEditor({
      local: true,
      path: filePath,
      name: path.basename(filePath),
      target: '',
    });
    if (!win) return { code: 500, message: 'Cannot open the editor' };
    logger.file(`[cli] edit new local file ${filePath}`);
    return { code: 200, message: `Opened a new file in Vessel Editor: ${filePath}` };
  }

  const expanded = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw;
  const filePath = path.resolve(expanded);
  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    return { code: 404, message: `File not found: ${raw}` };
  }
  if (!stat.isFile()) return { code: 400, message: `Not a file: ${raw}` };
  if (stat.size > FILE_EDITOR_MAX_BYTES) return { code: 400, message: 'File is larger than 8 MB' };
  const win = wm.openStandaloneFileEditor({
    local: true,
    path: filePath,
    name: path.basename(filePath),
    target: '',
  });
  if (!win) return { code: 500, message: 'Cannot open the editor' };
  logger.file(`[cli] edit local file ${filePath}`);
  return { code: 200, message: `Opened in Vessel Editor: ${filePath}` };
}

/* ------------------------------- HTTP ------------------------------- */

function send(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, res, callback, maxSize) {
  const limit = Number.isFinite(maxSize) && maxSize > 0 ? maxSize : MAX_BODY;
  let size = 0;
  let done = false;
  const chunks = [];
  req.on('data', (chunk) => {
    if (done) return;
    size += chunk.length;
    if (size > limit) {
      done = true;
      send(res, 413, 'request too large\n');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (done) return;
    done = true;
    callback(Buffer.concat(chunks).toString('utf8'));
  });
}

function handle(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (err) {
    send(res, 400, 'bad request\n');
    return;
  }
  const route = url.pathname;
  try {
    if (req.method === 'GET' && route === '/v1/ping') return send(res, 200, 'ok\n');
    if (req.method === 'GET' && route === '/v1/ssh') return send(res, 200, sshText());
    if (req.method === 'GET' && route === '/v1/2fa') return send(res, 200, twofaText());
    if (req.method === 'GET' && route === '/v1/complete') {
      return send(res, 200, completeText(String(url.searchParams.get('kind') || '')));
    }
    if (req.method === 'GET' && route === '/v1/timestamp') {
      const result = timestampCommand('');
      return send(res, result.code, result.body);
    }
    if (req.method === 'POST' && route === '/v1/timestamp') {
      return readBody(req, res, (body) => {
        const result = timestampCommand(body);
        send(res, result.code, result.body || `${result.message}\n`);
      });
    }
    if (req.method === 'GET' && route === '/v1/network') {
      networkCommand('')
        .then((result) => send(res, result.code, result.body || `${result.message}\n`))
        .catch((err) => send(res, 500, `${err.message}\n`));
      return;
    }
    if (req.method === 'POST' && route === '/v1/network') {
      return readBody(req, res, (body) => {
        networkCommand(body)
          .then((result) => send(res, result.code, result.body || `${result.message}\n`))
          .catch((err) => send(res, 500, `${err.message}\n`));
      });
    }
    if (req.method === 'POST' && route === '/v1/json') {
      const indent = url.searchParams.get('indent');
      const filter = url.searchParams.get('filter');
      const search = url.searchParams.get('search');
      return readBody(req, res, (body) => {
        const result = jsonCommand(body, { indent, filter, search });
        // 过滤器没有命中任何结果时正文为空（与 jq 一致），不是错误。
        const text = result.code === 200 ? result.body || '' : `${result.message}\n`;
        send(res, result.code, text);
      }, JSON_MAX_BODY);
    }
    if (req.method === 'POST' && route === '/v1/codec') {
      return readBody(req, res, (body) => {
        const result = codecCommand(body);
        send(res, result.code, result.body);
      });
    }
    if (req.method === 'POST' && route === '/v1/hash') {
      return readBody(req, res, (body) => {
        hashCommand(body)
          .then((result) => send(res, result.code, result.body || `${result.message}\n`))
          .catch((err) => send(res, 500, `${err.message}\n`));
      });
    }
    if (req.method === 'POST' && route === '/v1/uuid') {
      return readBody(req, res, (body) => {
        const result = idCommand(body);
        send(res, result.code, result.body || `${result.message}\n`);
      });
    }
    if (req.method === 'POST' && route === '/v1/id') {
      return readBody(req, res, (body) => {
        const result = idCommand(body);
        send(res, result.code, result.body || `${result.message}\n`);
      });
    }
    if (req.method === 'POST' && route === '/v1/main') {
      require('../window-manager').showMainWindow();
      logger.file('[cli] open main window');
      return send(res, 200, 'Opened Vessel main window\n');
    }
    if (req.method === 'POST' && route === '/v1/restart') {
      send(res, 200, 'Restarting Vessel...\n');
      // 先让 HTTP 响应写回终端，再执行重启（relaunch + quit）。
      setTimeout(() => {
        try {
          require('../tray').restartApp();
        } catch (err) {
          logger.error(`[cli] restart failed: ${err.message}`);
        }
      }, 200);
      return;
    }
    if (req.method === 'POST' && route === '/v1/check-update') {
      const updater = require('./updater-service');
      updater.checkForUpdatesInteractive().catch((err) => {
        logger.error(`[cli] check-update failed: ${err.message}`);
      });
      return send(res, 200, 'Checking for updates...\n');
    }
    if (req.method === 'POST' && route === '/v1/upgrade') {
      const result = installCli();
      if (!result.ok) return send(res, 500, `Upgrade failed: ${result.error || 'error'}\n`);
      logger.file(`[cli] upgraded by command (v${VERSION})`);
      return send(res, 200, `vessel CLI reinstalled (Vessel v${VERSION})\n  script: ${result.path}\n`);
    }
    if (req.method === 'POST' && route === '/v1/open') {
      return readBody(req, res, (body) => {
        const result = openTool(body);
        send(res, result.code, `${result.message}\n`);
      });
    }
    if (req.method === 'POST' && route === '/v1/edit') {
      return readBody(req, res, (body) => {
        const result = openEditor(body);
        send(res, result.code, `${result.message}\n`);
      });
    }
    if (req.method === 'POST' && route === '/v1/ssh') {
      return readBody(req, res, (body) => {
        connectSsh(body)
          .then((result) => send(res, result.code, `${result.message}\n`))
          .catch((err) => send(res, 500, `${err.message}\n`));
      });
    }
    return send(res, 404, 'not found\n');
  } catch (err) {
    logger.error(`[cli] ${route} failed: ${err.message}`);
    return send(res, 500, `${err.message}\n`);
  }
}

/* ------------------------------- 生命周期 ------------------------------- */

function start() {
  if (server || process.platform !== 'darwin') return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    /* 数据目录由应用创建；这里只是兜底 */
  }
  // 上次异常退出可能留下 socket 文件（单实例锁保证此时没有别的实例在监听）。
  try {
    fs.unlinkSync(SOCKET_FILE);
  } catch (err) {
    /* 不存在即忽略 */
  }
  server = http.createServer(handle);
  server.on('error', (err) => {
    logger.warn(`[cli] socket error: ${err.message}`);
    server = null;
  });
  server.listen(SOCKET_FILE, () => {
    try {
      fs.chmodSync(SOCKET_FILE, 0o600);
    } catch (err) {
      /* ignore */
    }
    logger.info(`[cli] local socket: ${SOCKET_FILE}`);
  });
}

function stop() {
  if (!server) return;
  try {
    server.close();
  } catch (err) {
    /* ignore */
  }
  server = null;
  try {
    fs.unlinkSync(SOCKET_FILE);
  } catch (err) {
    /* ignore */
  }
}

/* ------------------------------- 安装 / 状态 ------------------------------- */

function sourceFile(name) {
  return path.join(app.getAppPath(), 'assets', 'cli', name);
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    return '';
  }
}

function cliStatus() {
  const zshrc = readText(ZSHRC_FILE);
  return {
    supported: process.platform === 'darwin',
    installed: fs.existsSync(SCRIPT_FILE),
    path: SCRIPT_FILE,
    binDir: BIN_DIR,
    aliasPath: ALIAS_FILE,
    aliasInstalled: fs.existsSync(ALIAS_FILE),
    completionPath: COMPLETION_FILE,
    zshrcPath: ZSHRC_FILE,
    zshrcConfigured: zshrc.includes(BLOCK_START),
  };
}

/* 把 <binDir> 写进 ~/.zshrc：已有标记块则原地替换，否则追加到文件末尾。 */
function updateZshrc() {
  const block = [
    BLOCK_START,
    `export PATH="${BIN_DIR}:$PATH"`,
    `[ -r "${COMPLETION_FILE}" ] && . "${COMPLETION_FILE}"`,
    BLOCK_END,
  ].join('\n');
  const current = readText(ZSHRC_FILE);
  const start = current.indexOf(BLOCK_START);
  const end = current.indexOf(BLOCK_END);
  let next;
  if (start >= 0 && end > start) {
    next = `${current.slice(0, start)}${block}${current.slice(end + BLOCK_END.length)}`;
  } else {
    const trimmed = current.replace(/\s*$/, '');
    next = `${trimmed}${trimmed ? '\n\n' : ''}${block}\n`;
  }
  fs.writeFileSync(ZSHRC_FILE, next);
}

function installCli() {
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'unsupported-platform' };
  }
  try {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    fs.writeFileSync(SCRIPT_FILE, fs.readFileSync(sourceFile('vessel.sh')), { mode: 0o755 });
    fs.chmodSync(SCRIPT_FILE, 0o755);
    fs.writeFileSync(COMPLETION_FILE, fs.readFileSync(sourceFile('_vessel')), { mode: 0o644 });
    // 短别名 vess → vessel（符号链接；已存在则先删掉）
    try {
      fs.rmSync(ALIAS_FILE, { force: true });
    } catch (err) {
      /* 忽略 */
    }
    fs.symlinkSync('vessel', ALIAS_FILE);
    updateZshrc();
    logger.file(`[cli] installed: ${SCRIPT_FILE} (+ alias ${ALIAS_FILE}, ~/.zshrc PATH)`);
    return Object.assign({ ok: true }, cliStatus());
  } catch (err) {
    logger.error(`[cli] install failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  start,
  stop,
  status: cliStatus,
  install: installCli,
  openEditor,
  handle,
  timestampCommand,
  networkCommand,
  codecCommand,
  jsonCommand,
  hashCommand,
  idCommand,
  uuidCommand,
  SCRIPT_FILE,
  BIN_DIR,
  ALIAS_FILE,
};
