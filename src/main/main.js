'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, ipcMain } = require('electron');

/* 应用从 Ships 更名为 Vessel：首次启动时把旧数据目录 / 日志目录迁移到新名字，
   避免升级后丢失设置、SSH 密码、2FA、商品记录等。仅在目标不存在时执行。 */
(function migrateLegacyData() {
  if (!app.isPackaged) return;
  try {
    const newDataDir = app.getPath('userData');
    const oldDataDir = path.join(app.getPath('appData'), 'ships');
    if (oldDataDir !== newDataDir && !fs.existsSync(newDataDir) && fs.existsSync(oldDataDir)) {
      fs.renameSync(oldDataDir, newDataDir);
    }
    if (process.platform === 'darwin') {
      const newLogDir = path.join(os.homedir(), 'Library', 'Logs', 'Vessel');
      const oldLogDir = path.join(os.homedir(), 'Library', 'Logs', 'Ships');
      if (!fs.existsSync(newLogDir) && fs.existsSync(oldLogDir)) {
        fs.renameSync(oldLogDir, newLogDir);
      }
    }
  } catch (err) {
    /* best-effort：迁移失败不阻止应用启动 */
  }
})();

const { createTray } = require('./tray');
const wm = require('./window-manager');
const { registerAppIpc } = require('./ipc/app-ipc');
const { registerWindowIpc } = require('./ipc/window-ipc');
const { registerSettingsIpc } = require('./ipc/settings-ipc');
const { registerSshIpc } = require('./ipc/ssh-ipc');
const { registerGeoIpc } = require('./ipc/geo-ipc');
const { registerClipboardIpc } = require('./ipc/clipboard-ipc');
const { registerHashIpc } = require('./ipc/hash-ipc');
const { registerTotpIpc } = require('./ipc/twofa-ipc');
const { registerNutrientIpc } = require('./ipc/nutrient-ipc');
const { registerTerminalIpc } = require('./ipc/terminal-ipc');
const { registerShortcutIpc } = require('./ipc/shortcut-ipc');
const { registerSftpIpc } = require('./ipc/sftp-ipc');
const { registerFileWindowIpc } = require('./ipc/file-window-ipc');
const { registerFileEditorIpc } = require('./ipc/file-editor-ipc');
const { registerGameIpc } = require('./ipc/game-ipc');
const { registerUpdateIpc } = require('./ipc/update-ipc');
const { registerBackupIpc } = require('./ipc/backup-ipc');
const { installApplicationMenu } = require('./menu');
const { requestLocalNetworkAccess } = require('./services/local-network-service');
const proxyService = require('./services/proxy-service');
const logger = require('./utils/logger');
const gameService = require('./services/game-service');
const { DATA_FILES } = require('./utils/paths');
const { APP_NAME, VERSION, appConfig } = require('../shared/constants');

gameService.registerGameScheme();

/* --------------------------- 自定义 URL 协议 ---------------------------
   vessel://open/terminal —— 无条件新开一扇悬浮终端窗口。
   - macOS：系统经 `open-url` 事件投递（应用未运行时先启动再投递）。
   - Windows / Linux：经 `second-instance` 的 argv 或首次启动的 argv 投递。
   协议已在 package.json 的 build.protocols 中声明（打包后写入 Info.plist / 注册表）。 */
const APP_PROTOCOL = 'vessel';
const pendingDeepLinks = [];

function isTerminalDeepLink(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (url.protocol.toLowerCase() !== `${APP_PROTOCOL}:`) return false;
    return url.hostname.toLowerCase() === 'open' && url.pathname.replace(/\/+$/, '').toLowerCase() === '/terminal';
  } catch (err) {
    return false;
  }
}

function findDeepLink(args) {
  return (args || []).find(
    (arg) => typeof arg === 'string' && arg.toLowerCase().startsWith(`${APP_PROTOCOL}://`)
  ) || '';
}

function handleDeepLink(raw) {
  if (!isTerminalDeepLink(raw)) return false;
  if (!app.isReady()) {
    pendingDeepLinks.push(raw);
    return true;
  }
  logger.file(`[protocol] ${raw} -> new terminal`);
  wm.openTerminalWindow();
  return true;
}

// macOS 可能在 ready 之前就投递 open-url，必须尽早注册并先入队。
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const link = findDeepLink(argv);
    if (link && handleDeepLink(link)) return;
    wm.showMainWindow();
  });
  app.whenReady().then(onReady);
}

function onReady() {
  if (process.platform === 'darwin' && app.dock && !appConfig.showDockIcon) {
    app.dock.hide();
  }

  // 注册 vessel:// 协议（开发模式需带上 Electron 可执行文件与入口脚本）。
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(APP_PROTOCOL);
    }
  } catch (err) {
    logger.warn(`[protocol] register ${APP_PROTOCOL} failed: ${err.message}`);
  }

  registerAppIpc(ipcMain);
  registerWindowIpc(ipcMain);
  registerSettingsIpc(ipcMain);
  registerSshIpc(ipcMain);
  registerGeoIpc(ipcMain);
  registerClipboardIpc(ipcMain);
  registerHashIpc(ipcMain);
  registerTotpIpc(ipcMain);
  registerNutrientIpc(ipcMain);
  registerTerminalIpc(ipcMain);
  registerShortcutIpc(ipcMain);
  registerSftpIpc(ipcMain);
  registerFileWindowIpc(ipcMain);
  registerFileEditorIpc(ipcMain);
  registerGameIpc(ipcMain);
  registerUpdateIpc(ipcMain);
  gameService.registerGameProtocol();
  registerBackupIpc(ipcMain);

  installApplicationMenu();
  wm.createMainWindow();

  // 自动更新：打包后静默检查一次，发现新版本再提示下载 / 安装。
  require('./services/updater-service').initUpdater();

  const tray = createTray({
    onLeftClick: () => wm.toggleMainWindow(),
    onOpenSettings: () => wm.openSettingsWindow(),
  });
  wm.setTray(tray);

  // 首次启动即携带协议（Windows / Linux 的 argv）或 ready 前收到的 open-url：此时正式处理。
  const launchLink = findDeepLink(process.argv);
  if (launchLink) handleDeepLink(launchLink);
  for (const link of pendingDeepLinks.splice(0)) handleDeepLink(link);

  printStartupInfo();
  // 启动时请求一次 macOS「本地网络」授权并保持 socket 30 秒；之后不再重复触发。
  requestLocalNetworkAccess();
  // 系统代理开关（默认关闭）：只在开启时解析 / 使用系统代理。
  proxyService.init();
}

function printStartupInfo() {
  logger.info(`${APP_NAME} v${VERSION} (${process.platform}/${process.arch})`);
  logger.info('data files:');
  for (const file of DATA_FILES) logger.info(`  - ${file}`);
  logger.info(`games workdir: ${gameService.configuredWorkDir()}`);
}

app.on('window-all-closed', () => {
  // Menu bar app: keep running without windows.
});

app.on('before-quit', () => {
  require('./services/clipboard-service').stop();
  require('./services/sftp-service').closeAll();
  require('./services/terminal-service').killAll();
  require('./services/hotkey-service').unregisterAll();
});
