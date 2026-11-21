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
const { app } = require('electron');

const { DATA_DIR } = require('../utils/paths');
const logger = require('../utils/logger');

const BIN_DIR = path.join(DATA_DIR, 'bin');
const SCRIPT_FILE = path.join(BIN_DIR, 'vessel');
const COMPLETION_FILE = path.join(BIN_DIR, '_vessel');
const SOCKET_FILE = path.join(DATA_DIR, 'vessel-cli.sock');
const ZSHRC_FILE = path.join(os.homedir(), '.zshrc');
const BLOCK_START = '# >>> vessel cli >>>';
const BLOCK_END = '# <<< vessel cli <<<';
// 请求体上限（工具 id / SSH 别名都远小于它）。
const MAX_BODY = 4096;

/* 工具清单（英文名）：CLI 统一用英文输出，不随界面语言变化；
   顺序与 renderer 的 tool-order.js 一致（渲染层从未上报时也按这个顺序列出）。 */
const FALLBACK_TOOLS = [
  { id: 'ssh', label: 'SSH' },
  { id: 'twofa', label: '2FA codes' },
  { id: 'timestamp', label: 'Timestamp' },
  { id: 'subnet', label: 'IP / Subnet' },
  { id: 'encode', label: 'Encode' },
  { id: 'radix', label: 'Units' },
  { id: 'json', label: 'JSON' },
  { id: 'hash', label: 'Hash' },
  { id: 'text', label: 'Text' },
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

function toolsText() {
  const list = tools();
  if (!list.length) return 'No tools.\n';
  return formatTable(
    ['ID', 'NAME'],
    list.map((tool) => [tool.id, clean(tool.label)])
  );
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
  if (kind === 'tool') {
    for (const tool of tools()) values.push(tool.id);
  } else if (kind === 'ssh') {
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

/* ------------------------------- 动作 ------------------------------- */

function openTool(key) {
  const wanted = String(key || '').trim();
  const tool = findTool(wanted);
  if (!tool) return { code: 404, message: `Unknown tool: ${wanted}` };
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

/* ------------------------------- HTTP ------------------------------- */

function send(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, res, callback) {
  let size = 0;
  let done = false;
  const chunks = [];
  req.on('data', (chunk) => {
    if (done) return;
    size += chunk.length;
    if (size > MAX_BODY) {
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
    if (req.method === 'GET' && route === '/v1/tools') return send(res, 200, toolsText());
    if (req.method === 'GET' && route === '/v1/ssh') return send(res, 200, sshText());
    if (req.method === 'GET' && route === '/v1/2fa') return send(res, 200, twofaText());
    if (req.method === 'GET' && route === '/v1/complete') {
      return send(res, 200, completeText(String(url.searchParams.get('kind') || '')));
    }
    if (req.method === 'POST' && route === '/v1/tool') {
      return readBody(req, res, (body) => {
        const result = openTool(body);
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
    updateZshrc();
    logger.file(`[cli] installed: ${SCRIPT_FILE} (+ ~/.zshrc PATH)`);
    return Object.assign({ ok: true }, cliStatus());
  } catch (err) {
    logger.error(`[cli] install failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { start, stop, status: cliStatus, install: installCli, SCRIPT_FILE, BIN_DIR };
