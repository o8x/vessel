'use strict';

// 全局快捷键（设置 → 快捷键）：只绑定悬浮终端，一个 accelerator 对应一个动作。
// 不再与主窗口共用组合键、也不再区分单击 / 双击（无延迟）：按下即切换终端窗口。
// 「显示主界面」改为终端右键菜单的第一项（见 terminal.js）。

const { globalShortcut } = require('electron');
const settings = require('./settings-service');
const logger = require('../utils/logger');

const TARGET_KEYS = {
  terminal: 'terminalHotkey',
};

function normalize(value) {
  return String(value == null ? '' : value).trim();
}

let bindings = { terminal: '' };
let registered = '';

function toggleTerminal() {
  require('../window-manager').toggleTerminalWindow();
}

function registerOne(accelerator) {
  try {
    const ok = globalShortcut.register(accelerator, toggleTerminal);
    if (!ok) {
      logger.warn(`[hotkey] register "${accelerator}" rejected (可能已被其它 App 占用)`);
      return { ok: false, error: 'unavailable' };
    }
  } catch (err) {
    logger.warn(`[hotkey] register "${accelerator}" failed:`, err.message);
    return { ok: false, error: err.message };
  }
  return { ok: true };
}

function unregister(accelerator) {
  if (!accelerator) return;
  try {
    globalShortcut.unregister(accelerator);
  } catch (err) {
    /* ignore */
  }
}

function applyBindings(next) {
  const wanted = normalize(next && next.terminal);
  if (wanted === bindings.terminal && registered) return { ok: true };

  const previous = bindings;
  const previousRegistered = registered;

  unregister(previousRegistered);
  registered = '';

  if (wanted) {
    const result = registerOne(wanted);
    if (!result.ok) {
      // 回滚到上一次成功的绑定，避免因注册失败导致快捷键失效。
      if (previousRegistered) registerOne(previousRegistered);
      registered = previousRegistered;
      bindings = previous;
      return result;
    }
    registered = wanted;
  }

  bindings = wanted ? { terminal: wanted } : { terminal: '' };
  logger.file(`[hotkey] registered: ${registered || '(none)'}`);
  return { ok: true };
}

/* 设置终端快捷键：先试注册成功再返回（由 IPC 调用方持久化），失败时恢复旧绑定。 */
function setTarget(target, accelerator) {
  const key = TARGET_KEYS[target];
  if (!key) return { ok: false, error: 'invalid-target' };
  const result = applyBindings({ terminal: accelerator });
  if (!result.ok) return result;
  return { ok: true, hotkey: bindings.terminal };
}

function current() {
  return Object.assign({}, bindings);
}

// 启动时按设置注册；改设置（含重置）时跟随。
function init() {
  const result = applyBindings({ terminal: settings.get(TARGET_KEYS.terminal) });
  if (!result.ok) logger.warn('[hotkey] terminal shortcut unavailable');
}

settings.on('changed', (_data, keys) => {
  if (Array.isArray(keys) && !keys.includes(TARGET_KEYS.terminal)) return;
  init();
});

function unregisterAll() {
  unregister(registered);
  registered = '';
  bindings = { terminal: '' };
  try {
    globalShortcut.unregisterAll();
  } catch (err) {
    /* ignore */
  }
}

module.exports = { init, setTarget, current, unregisterAll };
