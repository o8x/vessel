'use strict';

// 文件传输窗口（穿梭框）+ 传输任务。
// 打开窗口的请求来自任意窗口（主界面底部按钮 / 文件管理器右键「文件传输」）；
// 传输任务只接受来自文件传输窗口本身、或终端窗口内嵌传输面板的请求。

const { IPC } = require('../../shared/constants');
const wm = require('../window-manager');
const transfer = require('../services/transfer-service');
const settings = require('../services/settings-service');

function isTransferSender(event) {
  return wm.isTransferWebContents(event.sender.id);
}

/* 传输任务：独立文件传输窗口，或终端窗口里的内嵌传输面板。 */
function isTransferRunSender(event) {
  return wm.isTransferWebContents(event.sender.id) || wm.isTerminalWebContents(event.sender.id);
}

function registerTransferIpc(ipcMain) {
  // 打开传输窗口：target / path 定位左侧，rightTarget / rightPath 定位右侧（均可为空）。
  ipcMain.handle(IPC.TRANSFER_WINDOW_OPEN, (_event, payload) => {
    const win = wm.openTransferWindow(
      payload && payload.target != null ? payload.target : undefined,
      payload && payload.path != null ? payload.path : undefined,
      payload && payload.rightTarget != null ? payload.rightTarget : undefined,
      payload && payload.rightPath != null ? payload.rightPath : undefined
    );
    return { ok: Boolean(win) };
  });

  ipcMain.handle(IPC.TRANSFER_WINDOW_INFO, (event) => {
    if (!isTransferSender(event)) return { ok: false };
    return {
      ok: true,
      target: wm.getTransferWindowTarget(),
      path: wm.getTransferWindowPath(),
      rightTarget: wm.getTransferWindowRightTarget(),
      rightPath: wm.getTransferWindowRightPath(),
      settings: settings.getAll(),
    };
  });

  ipcMain.handle(IPC.TRANSFER_WINDOW_CLOSE, (event) => {
    if (!isTransferSender(event)) return { ok: false };
    wm.closeTransferWindow();
    return { ok: true };
  });

  // 执行一次传输（远端 → 远端）：进度实时回传给传输窗口。
  ipcMain.handle(IPC.TRANSFER_RUN, (event, payload) => {
    if (!isTransferRunSender(event)) return { ok: false, error: 'forbidden' };
    const sender = event.sender;
    return transfer.run(payload, (progress) => {
      if (!sender.isDestroyed()) sender.send(IPC.TRANSFER_PROGRESS, progress);
    });
  });
}

module.exports = { registerTransferIpc };
