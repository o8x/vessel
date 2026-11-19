'use strict';

/* 「快速连接」实现（SSH 工具的连接表单与命令行 `vessel ssh <user@host> [password]` 共用）：
   - 地址必填；有密码用密码，无密码回退到 ~/.ssh/id_ed25519 密钥；
   - 「用户名@地址」已存在时不再新建条目，直接复用（只在给了密码时更新凭据）；
   - 否则写入 ~/.ssh/config 的「快速连接」分组并置于最前；
   - 默认新开一扇内置终端，`inCurrentTerminal` 时在发起窗口里连接（终端右键菜单）。 */

const configService = require('./ssh-config-service');
const sshService = require('./ssh-service');
const credentials = require('./ssh-credentials-service');
const proxyService = require('./proxy-service');
const { requestLocalNetworkAccess } = require('./local-network-service');
const { runInTerminal, runInNewTerminal } = require('../ipc/terminal-ipc');
const { broadcast } = require('../window-manager');
const { IPC } = require('../../shared/constants');
const logger = require('../utils/logger');

/* config 条目的实际连接目标（`用户名@地址`）：没有 User / HostName 时从别名里拆。 */
function hostTarget(host) {
  const alias = String((host && host.alias) || '');
  const fields = (host && host.fields) || {};
  let user = String(fields.user || (host && host.user) || '').trim();
  let address = String(fields.hostname || (host && host.hostName) || '').trim();
  if (!address) address = alias;
  if (address.includes('@')) {
    const at = address.lastIndexOf('@');
    if (!user) user = address.slice(0, at);
    address = address.slice(at + 1);
  } else if (!user && alias.includes('@')) {
    user = alias.slice(0, alias.lastIndexOf('@'));
  }
  return { user, address };
}

/* 查找「用户名@地址」已存在的主机（忽略大小写与端口）。 */
function findExistingTarget(user, hostName) {
  const wantedUser = String(user || '').trim().toLowerCase();
  const wantedHost = String(hostName || '').trim().toLowerCase();
  if (!wantedHost) return null;
  return (
    configService.list().find((host) => {
      const target = hostTarget(host);
      if (target.address.toLowerCase() !== wantedHost) return false;
      if (!wantedUser) return true;
      return target.user.toLowerCase() === wantedUser;
    }) || null
  );
}

function notifyConfigChanged(hosts) {
  broadcast(IPC.SSH_CONFIG_CHANGED, { hosts });
  return hosts;
}

async function quickConnect(payload, senderWindow) {
  requestLocalNetworkAccess();
  const hostName = String((payload && payload.hostName) || '').trim();
  const user = String((payload && payload.user) || '').trim();
  const port = Number(payload && payload.port) || 22;
  const password = String((payload && payload.password) || '');
  // 终端右键菜单发起 = 在当前终端连接；SSH 工具 / 命令行发起 = 始终新开一扇终端。
  const inCurrentTerminal = Boolean(payload && payload.inCurrentTerminal);
  if (!hostName) return { ok: false, error: 'hostName required' };

  const alias = `${user ? `${user}@` : ''}${hostName}${port !== 22 ? `:${port}` : ''}`;
  const host = {
    alias,
    hostName,
    user,
    port,
    identityFile: '~/.ssh/id_ed25519',
    proxyJump: '',
  };
  // 已存在同「用户名@地址」的主机 → 复用它，不新建配置条目。
  const existing = findExistingTarget(user, hostName);
  let target = host;
  let targetAlias = alias;
  let hosts = configService.list();
  if (existing) {
    targetAlias = existing.alias;
    target = {
      alias: existing.alias,
      hostName,
      user: user || existing.user,
      port: Number(existing.port) || port,
      identityFile: existing.identityFile || host.identityFile,
      proxyJump: existing.proxyJump || '',
    };
    if (password) credentials.save(targetAlias, password);
    logger.file(`[ssh] quick-connect ${alias} already exists (alias=${targetAlias}); reuse it`);
  } else {
    // 新主机：写入分组（成功 / 失败都要留下记录）。
    configService.upsertQuickConnect(host);
    hosts = notifyConfigChanged(configService.list());
    if (password) credentials.save(alias, password);
    else credentials.remove(alias);
  }
  sshService.detect(target);

  const socksProxy = await proxyService.resolveSocks(target.hostName, Number(target.port) || 22);
  const command = sshService.buildCommand(target, { socksProxy });
  logger.file(
    `[ssh] quick-connect ${targetAlias} -> ${inCurrentTerminal ? 'current' : 'new'} terminal (${password ? 'password' : 'key ~/.ssh/id_ed25519'}): ${command}`
  );
  const started = inCurrentTerminal
    ? runInTerminal(command, password, targetAlias, senderWindow)
    : runInNewTerminal(command, password, targetAlias);
  if (!started) {
    return { ok: false, error: 'terminal unavailable', command, alias: targetAlias, hosts };
  }
  return { ok: true, command, alias: targetAlias, hosts, reused: Boolean(existing) };
}

module.exports = { quickConnect, findExistingTarget };
