'use strict';

const path = require('path');
const { Tray, Menu, nativeImage, app, clipboard } = require('electron');
const { APP_NAME, TRAY_CLICK_ACTIONS, TRAY_HIDDEN_TOOL_IDS } = require('../shared/constants');
const settings = require('./services/settings-service');
const logger = require('./utils/logger');

const TRAY_ICON = path.join(__dirname, '..', '..', 'assets', 'imgs', 'trayTemplate.png');

// 2FA 工具 id（托盘里用它做「复制验证码」而非打开主界面）。
const TOTP_TOOL_ID = 'twofa';
// SSH 工具 id（托盘里用它承载「连接到服务器」，不再显示「SSH 管理」）。
const SSH_TOOL_ID = 'ssh';

/* 右键菜单里的工具清单由渲染层上报（主进程不硬编码工具列表）：
   渲染层知道自己的工具注册顺序与当前语言下的名称，上报后托盘菜单据此生成条目。 */
let toolItems = [];

function setTools(list) {
  if (!Array.isArray(list)) return;
  const hidden = new Set(TRAY_HIDDEN_TOOL_IDS || []);
  toolItems = list
    .filter((item) => item && item.id && typeof item.label === 'string' && item.label)
    .filter((item) => !hidden.has(String(item.id)))
    .map((item) => ({ id: String(item.id), label: String(item.label) }));
  logger.file(`[tray] tools updated: ${toolItems.map((t) => t.id).join(',') || '(none)'}`);
}

/* 重启应用：先登记「退出后重新拉起当前可执行文件」，再正常走退出流程，
   让 before-quit 里的清理（终端会话、托盘销毁等）照常执行。 */
function restartApp() {
  app.relaunch();
  app.quit();
}

/* 托盘菜单文案：跟随界面语言（默认中文）。 */
function label(zh, en) {
  const locale = String(settings.get('locale') || 'zh');
  return locale.toLowerCase().startsWith('en') ? en : zh;
}

/* 「连接到服务器」二级菜单：按 ~/.ssh/config 的分组组织主机。 */
function buildSshSubmenu() {
  const configService = require('./services/ssh-config-service');
  const hosts = configService.list();
  if (!hosts.length) {
    return [{ label: label('暂无主机', 'No hosts'), enabled: false }];
  }
  const groupOrder = configService.listGroups();
  const groups = new Map();
  const ungrouped = [];
  for (const host of hosts) {
    const group = String(host.group || '').trim();
    if (!group) {
      ungrouped.push(host);
      continue;
    }
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(host);
  }
  // 命名分组按配置文件中的先后排序，其余分组追加在后；未分组最后。
  const ordered = [];
  const seen = new Set();
  for (const name of groupOrder) {
    for (const [group, list] of groups) {
      if (group.toLowerCase() !== name.toLowerCase() || seen.has(group)) continue;
      seen.add(group);
      ordered.push([group, list]);
    }
  }
  for (const [group, list] of groups) {
    if (!seen.has(group)) ordered.push([group, list]);
  }

  const items = [];
  for (const [group, list] of ordered) {
    items.push({
      label: group,
      submenu: list.map((host) => ({
        label: configService.hostLabel(host),
        click: () => connectHost(host),
      })),
    });
  }
  // 未分组主机直接平铺在二级菜单里（不再单独放进「未分组」分组）。
  for (const host of ungrouped) {
    items.push({
      label: configService.hostLabel(host),
      click: () => connectHost(host),
    });
  }
  return items;
}

/* 2FA 验证码：直接复制到剪贴板，不打开主界面。
   沿用工具清单里的「2FA 验证码」菜单项：账号多于 1 个时展开二级菜单列出名称，
   点击对应名称即复制该账号的验证码；只有 1 个账号时点击菜单项即复制。 */
function buildTotpToolItem(item) {
  const totpService = require('./services/totp-service');
  const accounts = totpService.list();
  // 没有账号：保持原样（打开主界面并加载 2FA 工具，便于添加账号）。
  if (!accounts.length) return { label: item.label, click: () => openTool(item.id) };
  const copyCode = (account) => {
    const codes = totpService.codes();
    const code = codes[account.id];
    if (!code) return;
    clipboard.writeText(String(code));
    logger.file(`[tray] 2FA code copied (id=${account.id})`);
  };
  if (accounts.length === 1) {
    return { label: item.label, click: () => copyCode(accounts[0]) };
  }
  return {
    label: item.label,
    submenu: accounts.map((account) => ({
      label: totpAccountLabel(account),
      click: () => copyCode(account),
    })),
  };
}

/* 账号显示名：优先标题，其次副标题（都没有则「未命名」）。 */
function totpAccountLabel(account) {
  const title = String((account && account.title) || '').trim();
  const subtitle = String((account && account.subtitle) || '').trim();
  if (title && subtitle) return `${title} (${subtitle})`;
  return title || subtitle || label('未命名', 'Unnamed');
}

/* 连接主机：新开一扇内置终端并执行 ssh；已存密码时自动注入。 */
async function connectHost(host) {
  const sshService = require('./services/ssh-service');
  const credentials = require('./services/ssh-credentials-service');
  const proxyService = require('./services/proxy-service');
  const { runInNewTerminal } = require('./ipc/terminal-ipc');
  const { requestLocalNetworkAccess } = require('./services/local-network-service');
  try {
    requestLocalNetworkAccess();
    const socksProxy = await proxyService.resolveSocks(host.hostName, Number(host.port) || 22);
    const command = sshService.buildCommand(host, { socksProxy });
    const secret = credentials.has(host.alias) ? credentials.get(host.alias) : '';
    logger.file(`[tray] ssh connect(alias=${host.alias}) -> new terminal: ${command}`);
    const started = runInNewTerminal(command, secret, host.alias);
    if (!started) logger.warn(`[tray] ssh connect(alias=${host.alias}) failed: terminal unavailable`);
  } catch (err) {
    logger.error(`[tray] ssh connect(alias=${host.alias}) failed: ${err.message}`);
  }
}

/* 工具条目：显示主界面并加载对应工具。 */
function openTool(id) {
  const wm = require('./window-manager');
  wm.showMainWindowWithTool(id);
}

/* 「连接到服务器」条目：列出 ~/.ssh/config 里的主机（未分组的主机平铺）。 */
function connectMenuItem() {
  return { label: label('连接到服务器', 'Connect to Server'), submenu: buildSshSubmenu() };
}

function buildMenuTemplate() {
  const wm = require('./window-manager');
  const template = [
    { label: label('主界面', 'Main Window'), click: () => wm.showMainWindow() },
    { label: label('打开终端', 'Open Terminal'), click: () => wm.openTerminalWindow() },
    { label: label('打开文件管理', 'Open File Manager'), click: () => wm.openFileWindow() },
    { label: label('打开文件传输', 'Open File Transfer'), click: () => wm.openTransferWindow() },
  ];
  if (toolItems.length) {
    template.push({ type: 'separator' });
    for (const tool of toolItems) {
      // SSH 工具项 → 「连接到服务器」：直接列主机，不再打开主界面的「SSH 管理」。
      if (tool.id === SSH_TOOL_ID) {
        template.push(connectMenuItem());
        continue;
      }
      // 2FA 工具项：直接复制验证码，不打开主界面。
      if (tool.id === TOTP_TOOL_ID) {
        template.push(buildTotpToolItem(tool));
        continue;
      }
      template.push({ label: tool.label, click: () => openTool(tool.id) });
    }
  } else {
    // 工具清单还没上报时，保留「连接到服务器」入口。
    template.push({ type: 'separator' });
    template.push(connectMenuItem());
  }
  template.push({ type: 'separator' });
  template.push({ label: label(`重新启动`, `Restart`), click: () => restartApp() });
  template.push({ label: label(`打开设置`, `Open Settings`), click: () => wm.openSettingsWindow() });
  template.push({ label: label(`退出`, `Quit`), click: () => app.quit() });
  return template;
}

function createTray({ onLeftClick }) {
  const image = nativeImage.createFromPath(TRAY_ICON);
  image.setTemplateImage(true);

  const tray = new Tray(image);
  tray.setToolTip(APP_NAME);

  const popupMenu = () => {
    const menu = Menu.buildFromTemplate(buildMenuTemplate());
    tray.popUpContextMenu(menu);
  };

  // 点击托盘图标：默认弹出右键菜单（可在设置里改为直接显示主界面）。
  tray.on('click', () => {
    if (settings.get('trayClickAction') === TRAY_CLICK_ACTIONS.WINDOW) {
      onLeftClick();
      return;
    }
    popupMenu();
  });
  tray.on('right-click', popupMenu);

  return tray;
}

module.exports = { createTray, setTools, buildMenuTemplate };
