'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { dialog, clipboard } = require('electron');
const { IPC, DEFAULT_SETTINGS } = require('../../shared/constants');
const terminal = require('../services/terminal-service');
const settings = require('../services/settings-service');
const iterm = require('../services/iterm-service');
const sshService = require('../services/ssh-service');
const configService = require('../services/ssh-config-service');
const credentials = require('../services/ssh-credentials-service');
const proxyService = require('../services/proxy-service');
const wm = require('../window-manager');
const logger = require('../utils/logger');
const { DATA_DIR } = require('../utils/paths');

// 设置 → 终端 里「重置」要恢复的设置项（都来自 package.json 的 vessel 配置）。
const TERMINAL_SETTING_KEYS = [
  'terminalShell',
  'terminalFontSize',
  'terminalScrollback',
  'terminalOpacity',
  'terminalBlurOpacity',
  'terminalWindowWidth',
  'terminalWindowHeight',
  'terminalAlwaysOnTop',
  'terminalCloseAction',
  'sshBuiltinTerminal',
  'terminalBallEnabled',
  'terminalBallDelayMs',
  'terminalBallSize',
  'terminalBallIcon',
  'terminalBallDark',
  'terminalBallTransparent',
];

function terminalDefaults() {
  const patch = {};
  for (const key of TERMINAL_SETTING_KEYS) patch[key] = DEFAULT_SETTINGS[key];
  return patch;
}

// Each terminal window owns its own session; other features (SSH connect, network
// tests) inject a command into the most recently focused terminal window.
let overlayLastCommand = '';
// webContents.id -> session id（该终端窗口当前的 PTY 会话）
const sessionByOwner = new Map();
// webContents.id -> 待注入命令（窗口刚打开、会话还没就绪时先记下）
const pendingByOwner = new Map();

function isOverlaySender(event) {
  return wm.isTerminalWebContents(event.sender.id);
}

const EVENT_CHANNELS = {
  data: IPC.TERMINAL_DATA,
  session: IPC.TERMINAL_SESSION,
};

function emitTo(sender) {
  return (message) => {
    if (!sender || sender.isDestroyed()) return;
    sender.send(EVENT_CHANNELS[message.type] || IPC.TERMINAL_EXIT, message);
  };
}

/* SSH 命令注入后把目标告诉渲染层（驱动文件按钮 / SFTP）。不再轮询 ps 检测
   手动输入的 ssh；只通知由本应用发起的连接（头部 SSH 下拉 / SSH 管理）。 */
function notifyTarget(sender, sessionId, target) {
  const value = String(target || '');
  if (!value || !sessionId || !sender || sender.isDestroyed()) return;
  sender.send(IPC.TERMINAL_SESSION, { id: sessionId, type: 'session', ssh: value, target: value, busy: false });
}

/* 把命令注入给定窗口；会话尚未就绪时先排队（窗口会话上报后 flush）。 */
function injectInto(win, command, secret, target) {
  if (!win || win.isDestroyed()) return false;
  overlayLastCommand = command;
  const ownerId = win.webContents.id;
  const sessionId = sessionByOwner.get(ownerId);
  if (sessionId && terminal.get(sessionId)) {
    terminal.inject(sessionId, command, secret);
    notifyTarget(win.webContents, sessionId, target);
  } else {
    pendingByOwner.set(ownerId, { command, secret, target }); // flushed once the window's session reports in
  }
  return true;
}

/* Runs `command` in a terminal window: `preferredWin`（从该终端窗口本身发起时）优先，
   否则用当前聚焦的终端；都没有时新开一扇（窗口不跨桌面移动）。 */
function runInTerminal(command, secret, target, preferredWin) {
  if (!command) return false;
  let win =
    preferredWin && wm.isTerminalWindow(preferredWin) ? preferredWin : wm.getFocusedTerminalWindow();
  if (!win) {
    // 只有一扇终端且处于「悬浮球」时，直接放大它并注入命令，而不是再开一扇。
    const existing = wm.getTerminalWindow();
    if (existing && wm.isBallMode(existing)) {
      wm.exitBallMode(existing, true);
      win = existing;
    } else {
      win = wm.openTerminalWindow();
    }
  }
  return injectInto(win, command, secret, target);
}

/* 始终新开一扇终端再注入命令（SSH 快速连接使用）。 */
function runInNewTerminal(command, secret, target) {
  if (!command) return false;
  const win = wm.openTerminalWindow();
  return injectInto(win, command, secret, target);
}

function registerTerminalIpc(ipcMain) {
  ipcMain.handle(IPC.TERMINAL_OPEN, (_event, payload) => {
    const options = {};
    if (payload) {
      if (typeof payload.ballIcon === 'string' && payload.ballIcon) options.ballIcon = payload.ballIcon;
      if (payload.randomBallIcon) {
        options.randomBallIcon = true;
        if (typeof payload.excludeBallIcon === 'string') options.excludeBallIcon = payload.excludeBallIcon;
      }
    }
    return { ok: Boolean(wm.openTerminalWindow(options)) };
  });

  ipcMain.handle(IPC.TERMINAL_START, (event, payload) => {
    const ownerId = event.sender.id;
    const baseEmit = emitTo(event.sender);
    const started = terminal.start(payload, (message) => {
      if ((message.type === 'exit' || message.type === 'error') && sessionByOwner.get(ownerId) === message.id) {
        sessionByOwner.delete(ownerId);
      }
      baseEmit(message);
    });
    if (isOverlaySender(event)) {
      sessionByOwner.set(ownerId, started.id);
      const pending = pendingByOwner.get(ownerId);
      if (pending) {
        pendingByOwner.delete(ownerId);
        terminal.inject(started.id, pending.command, pending.secret);
        notifyTarget(event.sender, started.id, pending.target);
      }
    }
    return started;
  });

  ipcMain.handle(IPC.TERMINAL_INPUT, (_event, payload) => ({
    ok: terminal.write(payload && payload.id, payload && payload.data),
  }));
  /* 终端窗口内可能同时有主 / 副两块终端（分屏）：把「当前聚焦的会话」告诉主进程，
     之后 SSH 注入等操作就会落到这块终端，而不是最后一次启动的会话。 */
  ipcMain.handle(IPC.TERMINAL_SET_ACTIVE_SESSION, (event, payload) => {
    if (!isOverlaySender(event)) return { ok: false };
    const id = String((payload && payload.id) || '');
    if (!id || !terminal.get(id)) return { ok: false };
    sessionByOwner.set(event.sender.id, id);
    return { ok: true, id };
  });

  ipcMain.handle(IPC.TERMINAL_RESIZE, (_event, payload) => ({
    ok: terminal.resize(payload && payload.id, payload && payload.cols, payload && payload.rows),
  }));
  ipcMain.handle(IPC.TERMINAL_INTERRUPT, (_event, payload) => ({ ok: terminal.interrupt(payload && payload.id) }));
  ipcMain.handle(IPC.TERMINAL_KILL, (_event, payload) => ({ ok: terminal.kill(payload && payload.id) }));

  /* 会话结束（用户在终端里 exit）→ 渲染层请求销毁窗口：这条路强制销毁，不受
     「关闭按钮行为=隐藏」影响（隐藏会让一个已结束的会话挂在后台）。 */
  ipcMain.handle(IPC.TERMINAL_DESTROY, (event) => {
    if (!isOverlaySender(event)) return { ok: false };
    const win = wm.getTerminalWindowForWebContents(event.sender.id);
    // 先回包再销毁：销毁窗口会让渲染层收不到 IPC 回复
    setImmediate(() => wm.destroyTerminalWindow(win));
    return { ok: true };
  });

  /* 终端窗口不再置顶；保留该通道以兼容旧调用，恒返回 false（不写设置）。 */
  ipcMain.handle(IPC.TERMINAL_SET_TOP, () => ({ ok: true, alwaysOnTop: false }));

  /* 按渲染层实测的余量精确对齐高度（拖动结束后 / 首次打开 / 改字号时各一次）：
     拖动期间 window-manager 只会把它挂起（动尺寸会打乱 macOS 的拖拽跟踪），松手后再执行。
     只接受来自终端窗口本身的请求；低于最小高度 / 无变化时不动。 */
  ipcMain.handle(IPC.TERMINAL_SNAP_SIZE, (event, payload) => {
    if (!isOverlaySender(event)) return { ok: false };
    return wm.requestTerminalSnap(wm.getTerminalWindowForWebContents(event.sender.id), payload || {});
  });

  ipcMain.handle(IPC.TERMINAL_ENSURE_SIZE, (event, payload) => {
    if (!isOverlaySender(event)) return { ok: false };
    return wm.ensureTerminalContentSize(wm.getTerminalWindowForWebContents(event.sender.id), payload || {});
  });

  /* 双击标题栏：默认尺寸 ↔ 之前的几何。 */
  ipcMain.handle(IPC.TERMINAL_TOGGLE_ZOOM, (event) => {
    if (!isOverlaySender(event)) return { ok: false };
    return wm.toggleTerminalZoom(wm.getTerminalWindowForWebContents(event.sender.id));
  });

  /* 自定义标题栏拖动：主进程按屏幕光标位移移动窗口（无边框窗口不再用 app-region drag）。 */
  ipcMain.handle(IPC.TERMINAL_DRAG_START, (event) => {
    if (!isOverlaySender(event)) return { ok: false };
    return wm.startTerminalDrag(wm.getTerminalWindowForWebContents(event.sender.id));
  });
  ipcMain.handle(IPC.TERMINAL_DRAG_STOP, (event) => {
    if (!isOverlaySender(event)) return { ok: false };
    return wm.stopTerminalDrag(wm.getTerminalWindowForWebContents(event.sender.id));
  });

  /* 重置：终端相关设置回到默认值（写设置即可让开着的终端窗口跟着变），并清掉记住的
     屏幕 / 位置 / 尺寸。 */
  ipcMain.handle(IPC.TERMINAL_RESET, () => {
    const next = settings.set(terminalDefaults());
    wm.forgetTerminalGeometry();
    logger.file('[terminal] settings reset to defaults');
    return { ok: true, settings: next };
  });

  /* Right-click on the terminal (Windows cmd style): copy the current selection when
     there is one, otherwise paste the system clipboard into the running shell. Both
     only respond to the terminal window itself. */
  ipcMain.handle(IPC.TERMINAL_COPY_TEXT, async (event, payload) => {
    if (!isOverlaySender(event)) return { ok: false };
    const text = String((payload && payload.text) || '');
    if (!text) return { ok: false };
    // Electron 的 clipboard 读写在新版是异步的：必须 await，否则返回的 Promise 无法被 IPC 序列化。
    await clipboard.writeText(text);
    return { ok: true };
  });

  ipcMain.handle(IPC.TERMINAL_PASTE_TEXT, async (event) => {
    if (!isOverlaySender(event)) return { ok: false, text: '' };
    let text = '';
    try {
      text = String((await clipboard.readText()) || '');
    } catch (err) {
      text = '';
    }
    return { ok: true, text };
  });

  /* Export: dump the xterm buffer text into a local file chosen by the user. */
  ipcMain.handle(IPC.TERMINAL_EXPORT, async (event, payload) => {
    const text = String((payload && payload.text) || '');
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const options = {
      title: 'Export terminal text',
      defaultPath: (payload && payload.name) || path.join(os.homedir(), `vessel-terminal-${stamp}.txt`),
      filters: [{ name: 'Text', extensions: ['txt', 'log'] }],
    };
    const win = wm.getTerminalWindowForWebContents(event.sender.id);
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(result.filePath, text, 'utf8');
      return { ok: true, path: result.filePath, bytes: Buffer.byteLength(text, 'utf8') };
    } catch (err) {
      logger.error(`[terminal] export failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  /* 终端内联命令 `\v save`：把当前缓冲区文本写入应用数据目录，并用内置编辑器打开该文件。 */
  ipcMain.handle(IPC.TERMINAL_SAVE_BUFFER, (event, payload) => {
    const text = String((payload && payload.text) || '');
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const filePath = path.join(DATA_DIR, `terminal-${stamp}.txt`);
    try {
      fs.writeFileSync(filePath, text, 'utf8');
    } catch (err) {
      logger.error(`[terminal] save buffer failed (${filePath}): ${err.message}`);
      return { ok: false, error: err.message };
    }
    logger.file(`[terminal] buffer saved: ${filePath} (${Buffer.byteLength(text, 'utf8')} bytes)`);
    const win = wm.openFileEditorWindow(event.sender, {
      local: true,
      path: filePath,
      name: path.basename(filePath),
      target: '',
    });
    return win ? { ok: true, path: filePath } : { ok: false, path: filePath, error: 'open-failed' };
  });

  /* 复制终端：新开一扇终端窗口，自动连接当前 SSH（同一别名）并进入当前目录。
     命令构造与「在终端打开」一致（ssh -t 'cd <dir> && exec $SHELL -l'）。 */
  ipcMain.handle(IPC.TERMINAL_DUPLICATE, async (_event, payload) => {
    const request = payload || {};
    const alias = String(request.alias || '').trim();
    const dir = String(request.path || '').trim();
    if (!alias) return { ok: false, error: 'alias required' };
    const host = configService.list().find((item) => item.alias === alias);
    if (!host) return { ok: false, error: 'host not found' };
    const socksProxy = await proxyService.resolveSocks(host.hostName, Number(host.port) || 22);
    const remote = dir ? `cd ${sshService.shellQuote(dir)} && exec $SHELL -l` : '';
    const command = sshService.buildCommand(host, {
      socksProxy,
      forceTty: Boolean(remote),
      command: remote ? sshService.shellQuote(remote) : '',
    });
    const secret = credentials.has(alias) ? credentials.get(alias) : '';
    const win = wm.openTerminalWindow({
      randomBallIcon: true,
      excludeBallIcon: String(request.excludeBallIcon || ''),
    });
    if (!win) return { ok: false, error: 'terminal unavailable', command };
    const started = injectInto(win, command, secret, alias);
    logger.file(
      `[terminal] duplicate alias=${alias} dir=${dir || '-'} auth=${secret ? 'password' : 'key'}: ${command}`
    );
    return started ? { ok: true, command } : { ok: false, error: 'terminal unavailable', command };
  });

  /* Hand the session over to iTerm (same command when known) and close the window. */
  ipcMain.handle(IPC.TERMINAL_OPEN_ITERM, async (event) => {
    const win = wm.getTerminalWindowForWebContents(event.sender.id);
    // 交接会切到 iTerm → 终端窗口失焦；直接关闭，绝不缩成悬浮球。
    if (win && !win.isDestroyed()) win.__suppressBall = true;
    const command = overlayLastCommand || `${terminal.loginShell()} -l`;
    const result = await iterm.openCommand(command, 'terminal:handoff');
    if (result && result.ok) {
      // 交接成功 = 会话交给 iTerm：这里必须销毁（而不是按关闭行为隐藏）
      wm.destroyTerminalWindow(win);
    }
    return result && result.ok
      ? { ok: true, command }
      : { ok: false, command, error: (result && result.error) || 'error' };
  });
}

module.exports = { registerTerminalIpc, runInTerminal, runInNewTerminal };
