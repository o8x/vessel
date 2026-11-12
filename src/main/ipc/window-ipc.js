'use strict';

const { BrowserWindow } = require('electron');
const { IPC } = require('../../shared/constants');
const {
  hideMainWindow,
  showMainWindow,
  listManagedWindows,
  activateManagedWindow,
  destroyManagedWindow,
  openSettingsWindow,
  closeSettingsWindow,
  getMainWindow,
  getSettingsWindow,
  getTerminalWindow,
  isTerminalWindow,
  toggleTerminalZoom,
  openTerminalWindow,
  terminalCloseAction,
  destroyTerminalWindow,
  startBallDrag,
  stopBallDrag,
  exitBallMode,
  shrinkTerminalToBall,
  getFileWindow,
  openFileWindow,
  openFontPickerWindow,
  getGameWindow,
  isGameWindow,
} = require('../window-manager');

function registerWindowIpc(ipcMain) {
  /* 自绘「小红绿灯」（终端窗口）：只作用于发起请求的那个窗口，能力最小化。 */
  ipcMain.handle(IPC.WINDOW_CONTROL, (event, payload) => {
    const action = payload && payload.action;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { ok: false, action };
    if (action === 'close') {
      // 终端窗口：关闭按钮行为 = 隐藏时收缩成「悬浮球」；否则销毁。其它窗口照旧关闭。
      if (isTerminalWindow(win)) {
        if (terminalCloseAction() === 'hide') shrinkTerminalToBall(win);
        else destroyTerminalWindow(win);
        return { ok: true, action };
      }
      win.close();
      return { ok: true, action };
    }
    if (action === 'minimize') {
      // 终端窗口禁用最小化。
      if (isTerminalWindow(win)) return { ok: false, action };
      win.minimize();
      return { ok: true, action };
    }
    if (action === 'fullscreen' || (action === 'zoom' && isGameWindow(win))) {
      win.setFullScreen(!win.isFullScreen());
      return { ok: true, action, fullscreen: win.isFullScreen() };
    }
    if (action === 'zoom') {
      // 终端窗口：绿灯与双击标题栏一致，在默认尺寸与之前几何之间切换。
      if (isTerminalWindow(win)) return toggleTerminalZoom(win);
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return { ok: true, action };
    }
    return { ok: false, action };
  });

  ipcMain.on(IPC.WINDOW_HIDE, () => hideMainWindow());
  // 终端右键菜单「显示主界面」：从托盘应用语义出发，显示 / 带到前台主面板。
  ipcMain.handle(IPC.WINDOW_SHOW_MAIN, () => {
    showMainWindow();
    return { ok: true };
  });

  // 设置 → 窗口管理：列出已打开窗口、激活 / 销毁指定窗口。
  ipcMain.handle(IPC.WINDOW_LIST_OPEN, () => listManagedWindows());
  ipcMain.handle(IPC.WINDOW_ACTIVATE, (_event, payload) => {
    const id = Number(payload && payload.id);
    return { ok: Boolean(id) && activateManagedWindow(id) };
  });
  ipcMain.handle(IPC.WINDOW_DESTROY, (_event, payload) => {
    const id = Number(payload && payload.id);
    return { ok: Boolean(id) && destroyManagedWindow(id) };
  });

  // 悬浮球：拖动（按光标位置移动窗口）与点击放大回终端窗口。
  ipcMain.on(IPC.TERMINAL_BALL_DRAG, (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (payload && payload.phase === 'start') startBallDrag(win, payload.x, payload.y);
    else stopBallDrag();
  });
  ipcMain.handle(IPC.TERMINAL_BALL_RESTORE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { ok: false };
    exitBallMode(win, true);
    return { ok: true };
  });

  // 「固定」按钮（仅当前终端窗口，默认关）：开启后该窗口失焦不再缩成悬浮球。
  ipcMain.handle(IPC.TERMINAL_BALL_PIN, (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || !isTerminalWindow(win)) return { ok: false };
    win.__ballPin = Boolean(payload && payload.value);
    return { ok: true, value: win.__ballPin };
  });

  // 临时抑制缩球（如终端内「快速连接」弹窗打开期间）：不改动用户的「固定」状态。
  // 抑制期间窗口失焦不缩球；恢复时不主动缩球（下次失焦再按正常逻辑处理）。
  ipcMain.handle(IPC.TERMINAL_BALL_SUPPRESS, (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || !isTerminalWindow(win)) return { ok: false };
    win.__suppressBall = Boolean(payload && payload.value);
    return { ok: true, value: win.__suppressBall };
  });
  ipcMain.on(IPC.WINDOW_OPEN_SETTINGS, (_event, section) => {
    hideMainWindow();
    openSettingsWindow(typeof section === 'string' ? section : '');
  });
  ipcMain.handle(IPC.SSH_EDIT, (_event, payload) => {
    const alias = String((payload && payload.alias) || '');
    if (!alias) return { ok: false, error: 'alias required' };
    hideMainWindow();
    openSettingsWindow('ssh', alias);
    return { ok: true };
  });
  ipcMain.on(IPC.WINDOW_CLOSE_SETTINGS, () => closeSettingsWindow());

  ipcMain.handle(IPC.FONT_PICKER_OPEN, () => {
    openFontPickerWindow();
    return { ok: true };
  });
  ipcMain.on(IPC.FONT_PICKER_CLOSE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
  });

  ipcMain.handle(IPC.DEVTOOLS_OPEN, (_event, target) => {
    // target: 'main'（主窗口）/ 'settings' / 'terminal'（悬浮终端窗口）/ 'file'（独立文件窗口）；
    // 未打开时先打开对应窗口。
    const win =
      target === 'settings'
        ? getSettingsWindow()
        : target === 'terminal'
          ? getTerminalWindow() || openTerminalWindow()
          : target === 'file'
            ? getFileWindow() || openFileWindow()
            : target === 'game'
              ? getGameWindow()
              : getMainWindow();
    if (!win) return { ok: false };
    if (target !== 'settings') win.show();
    win.webContents.openDevTools({ mode: 'detach' });
    return { ok: true };
  });
}

module.exports = { registerWindowIpc };
