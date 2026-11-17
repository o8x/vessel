'use strict';

const path = require('path');
const { Tray, Menu, nativeImage, app } = require('electron');
const { APP_NAME, TRAY_CLICK_ACTIONS, TRAY_HIDDEN_TOOL_IDS } = require('../shared/constants');
const settings = require('./services/settings-service');
const logger = require('./utils/logger');

const TRAY_ICON = path.join(__dirname, '..', '..', 'assets', 'imgs', 'trayTemplate.png');

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
        label: host.alias,
        click: () => connectHost(host),
      })),
    });
  }
  if (ungrouped.length) {
    items.push({
      label: label('未分组', 'Ungrouped'),
      submenu: ungrouped.map((host) => ({
        label: host.alias,
        click: () => connectHost(host),
      })),
    });
  }
  return items;
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

function buildMenuTemplate() {
  const wm = require('./window-manager');
  const template = [
    { label: label('主界面', 'Main Window'), click: () => wm.showMainWindow() },
    { label: label('打开终端', 'Open Terminal'), click: () => wm.openTerminalWindow() },
    { type: 'separator' },
    { label: label('连接到', 'Connect to Server'), submenu: buildSshSubmenu() },
    { label: label('文件管理', 'File Manager'), click: () => wm.openFileWindow() },
    { label: label('文件传输', 'File Transfer'), click: () => wm.openTransferWindow() },
  ];
  if (toolItems.length) {
    template.push({ type: 'separator' });
    for (const tool of toolItems) {
      template.push({ label: tool.label, click: () => openTool(tool.id) });
    }
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
