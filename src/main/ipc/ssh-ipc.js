'use strict';

const fs = require('fs');
const { IPC } = require('../../shared/constants');
const { Notification, dialog, BrowserWindow } = require('electron');
const configService = require('../services/ssh-config-service');
const sshService = require('../services/ssh-service');
const credentials = require('../services/ssh-credentials-service');
const { broadcast, getMainWindow } = require('../window-manager');
const { runInTerminal, runInNewTerminal } = require('./terminal-ipc');
const { requestLocalNetworkAccess } = require('../services/local-network-service');
const proxyService = require('../services/proxy-service');
const logger = require('../utils/logger');

function findHost(alias) {
  if (!alias) return null;
  return configService.list().find((host) => host.alias === alias) || null;
}

/* 「在终端打开」：优先用别名命中 ~/.ssh/config，否则用手动连接字段构造主机。 */
function hostForTerminal(payload) {
  const target = String((payload && payload.target) || '').trim();
  const explicitAlias = String((payload && payload.alias) || '').trim();
  const alias =
    explicitAlias ||
    (target && !target.includes('@') && !target.includes(':') ? target : '');
  const configured = findHost(alias);
  if (configured) return configured;
  const hostName = String((payload && payload.host) || '').trim();
  if (!hostName) return null;
  return {
    alias: explicitAlias || target || hostName,
    hostName,
    user: String((payload && payload.username) || '').trim(),
    port: Number(payload && payload.port) || 22,
    identityFile: String((payload && payload.identityFile) || '').trim() || '~/.ssh/id_ed25519',
    proxyJump: '',
  };
}

/* 给主机列表附上「是否已存密码」（非机密标记；密码本体加密存本地）。 */
function withPassword(hosts) {
  return hosts.map((host) => Object.assign({}, host, { hasPassword: credentials.has(host.alias) }));
}

function registerSshIpc(ipcMain) {
  ipcMain.handle(IPC.SSH_LIST, () => ({
    hosts: withPassword(configService.list()),
    detected: sshService.getDetected(),
  }));

  // Connect inside the always-on-top terminal window (it can float above full-screen
  // apps, unlike iTerm which switches desktops).
  // `inTerminal: true`（终端窗口头部的 SSH 下拉）明确要求在「当前终端」里执行，
  // 不受「SSH 使用内置终端连接」开关影响。
  ipcMain.handle(IPC.SSH_CONNECT, async (_event, payload) => {
    requestLocalNetworkAccess();
    const host = findHost(payload && payload.alias);
    if (!host) return { ok: false, error: 'host not found' };
    const socksProxy = await proxyService.resolveSocks(host.hostName, Number(host.port) || 22);
    const command = sshService.buildCommand(host, { socksProxy });
    const settingsService = require('../services/settings-service');
    const inTerminal = Boolean(payload && payload.inTerminal);
    if (!inTerminal && settingsService.get('sshBuiltinTerminal') === false) {
      // iTerm：不自动输入密码（在 iTerm 里手动输入）。
      logger.file(`[ssh] connect(alias=${host.alias}) -> iTerm: ${command}`);
      return sshService.connect(host, { socksProxy });
    }
    // 内置终端：若有存储密码，ssh 提示输入密码时由终端自动注入（见 terminal-service）。
    const secret = credentials.has(host.alias) ? credentials.get(host.alias) : '';
    logger.file(`[ssh] connect(alias=${host.alias}) -> terminal: ${command}${secret ? ' (+password)' : ''}`);
    if (!runInTerminal(command, secret, host.alias)) return { ok: false, error: 'terminal unavailable', command };
    return { ok: true, command };
  });

  // 文件管理（独立文件窗口）目录右键「在终端打开」：新建一扇终端，SSH 连接该主机，
  // 并让远端 shell 直接进入指定目录（ssh -t 'cd … && exec $SHELL -l'）。
  ipcMain.handle(IPC.SSH_OPEN_IN_TERMINAL, async (_event, payload) => {
    requestLocalNetworkAccess();
    const request = payload || {};
    const dir = String(request.path || '').trim();
    if (!dir) return { ok: false, error: 'path required' };
    const host = hostForTerminal(request);
    if (!host) return { ok: false, error: 'host not found' };
    const socksProxy = await proxyService.resolveSocks(host.hostName, Number(host.port) || 22);
    const remote = `cd ${sshService.shellQuote(dir)} && exec $SHELL -l`;
    const command = sshService.buildCommand(host, {
      socksProxy,
      forceTty: true,
      command: sshService.shellQuote(remote),
    });
    const typedPassword = typeof request.password === 'string' ? request.password : '';
    const secret =
      typedPassword ||
      (host.alias && credentials.has(host.alias) ? credentials.get(host.alias) : '');
    logger.file(
      `[ssh] open-in-terminal ${host.alias || host.hostName} dir=${dir} ` +
        `auth=${secret ? 'password' : 'key'}: ${command}`
    );
    const started = runInNewTerminal(command, secret, host.alias || host.hostName);
    return started
      ? { ok: true, command }
      : { ok: false, error: 'terminal unavailable', command };
  });

  // 「快速连接」：地址必填；有密码用密码，无密码回退到 ~/.ssh/id_ed25519 密钥。
  // 无论连接成功与否都写入 ~/.ssh/config 的「快速连接」分组（该分组恒在最前）。
  ipcMain.handle(IPC.SSH_QUICK_CONNECT, async (event, payload) => {
    requestLocalNetworkAccess();
    const hostName = String((payload && payload.hostName) || '').trim();
    const user = String((payload && payload.user) || '').trim();
    const port = Number(payload && payload.port) || 22;
    const password = String((payload && payload.password) || '');
    // 终端右键菜单发起 = 在当前终端连接；SSH 工具发起 = 始终新开一扇终端。
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
    // 先写入分组（成功 / 失败都要留下记录）。
    configService.upsertQuickConnect(host);
    const hosts = notifyConfigChanged(configService.list());
    if (password) credentials.save(alias, password);
    else credentials.remove(alias);
    sshService.detect(host);

    const socksProxy = await proxyService.resolveSocks(hostName, port);
    const command = sshService.buildCommand(host, { socksProxy });
    logger.file(
      `[ssh] quick-connect ${alias} -> ${inCurrentTerminal ? 'current' : 'new'} terminal (${password ? 'password' : 'key ~/.ssh/id_ed25519'}): ${command}`
    );
    const started = inCurrentTerminal
      ? runInTerminal(command, password, alias, BrowserWindow.fromWebContents(event.sender))
      : runInNewTerminal(command, password, alias);
    if (!started) return { ok: false, error: 'terminal unavailable', command, alias, hosts };
    return { ok: true, command, alias, hosts };
  });

  ipcMain.handle(IPC.SSH_DETECT, (_event, payload) => {
    requestLocalNetworkAccess();
    const host = findHost(payload && payload.alias);
    if (!host) return { queued: false };
    sshService.detect(host);
    return { queued: true };
  });

  // Detect an arbitrary host (used by the settings form before the host exists).
  // 支持密码认证：优先用表单里填的密码；留空则回退到该别名已保存的密码（除非表单点了「清除密码」）。
  ipcMain.handle(IPC.SSH_DETECT_HOST, async (_event, payload) => {
    requestLocalNetworkAccess();
    const host = payload || {};
    if (!host.hostName) return { ok: false, error: 'hostName required' };
    const alias = host.alias || host.hostName;
    const typedPassword = String(host.password || '');
    const storedPassword =
      host.useStoredPassword !== false && credentials.has(alias) ? credentials.get(alias) : '';
    const password = typedPassword || storedPassword;
    const info = await sshService.runDetect(
      {
        alias,
        hostName: host.hostName,
        port: host.port,
        user: host.user,
        identityFile: host.identityFile,
        proxyJump: host.proxyJump,
      },
      password ? { password } : null
    );
    sshService.setDetected(alias, info);
    return { ok: true, alias, info };
  });

  ipcMain.handle(IPC.SSH_GET_DETECTED, () => sshService.getDetected());

  // SSH 主机 / 分组有变更后广播，供终端 / 文件窗口的 SSH 下拉实时刷新（设置页自身会重新读取）。
  function notifyConfigChanged(hosts) {
    broadcast(IPC.SSH_CONFIG_CHANGED, { hosts });
    return hosts;
  }

  ipcMain.handle(IPC.SSH_CONFIG_READ, () => withPassword(configService.list()));
  ipcMain.handle(IPC.SSH_PASSWORD_SAVE, (_event, payload) =>
    credentials.save(payload && payload.alias, payload && payload.password)
  );
  ipcMain.handle(IPC.SSH_PASSWORD_REMOVE, (_event, payload) => credentials.remove(payload && payload.alias));
  ipcMain.handle(IPC.SSH_CONFIG_UPSERT, (_event, host) => notifyConfigChanged(configService.upsert(host)));
  ipcMain.handle(IPC.SSH_CONFIG_REMOVE, (_event, alias) => notifyConfigChanged(configService.remove(alias)));
  ipcMain.handle(IPC.SSH_CONFIG_RENAME_GROUP, (_event, payload) =>
    notifyConfigChanged(configService.renameGroup(payload && payload.from, payload && payload.to))
  );

  ipcMain.handle(IPC.SSH_CONFIG_EXPORT, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: 'config',
      defaultPath: 'config',
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      if (fs.existsSync(configService.CONFIG_FILE)) {
        fs.copyFileSync(configService.CONFIG_FILE, result.filePath);
      } else {
        fs.writeFileSync(result.filePath, '', 'utf8');
      }
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  sshService.on('detected', (payload) => {
    broadcast(IPC.SSH_DETECTED, payload);
    const win = getMainWindow();
    if ((!win || !win.isVisible()) && Notification.isSupported()) {
      new Notification({
        title: 'Vessel',
        body: `${payload.alias} · ${payload.label || 'Unknown'}`,
      }).show();
    }
  });
}

module.exports = { registerSshIpc };
