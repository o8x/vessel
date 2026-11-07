'use strict';

const { IPC } = require('../../shared/constants');
const settings = require('../services/settings-service');
const hotkey = require('../services/hotkey-service');

// 只有终端绑定了全局快捷键；主窗口不再注册（改为终端右键菜单「显示主界面」）。
const TARGET_KEYS = {
  terminal: 'terminalHotkey',
};

function registerShortcutIpc(ipcMain) {
  hotkey.init();

  /* 设置终端快捷键：先试注册，成功了才写设置 —— 否则会存下一个按不出来
     （被占用 / 非法）的组合键。 */
  ipcMain.handle(IPC.SHORTCUT_SET, (_event, payload) => {
    const target = String((payload && payload.target) || '');
    const key = TARGET_KEYS[target];
    if (!key) return { ok: false, error: 'invalid-target' };

    const result = hotkey.setTarget(target, payload && payload.hotkey);
    if (!result.ok) return result;

    settings.set({ [key]: result.hotkey });
    return { ok: true, hotkey: result.hotkey };
  });
}

module.exports = { registerShortcutIpc };
