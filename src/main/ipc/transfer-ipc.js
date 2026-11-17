'use strict';

// 文件传输窗口（穿梭框）+ 传输任务。
// 打开窗口的请求来自任意窗口（主界面底部按钮 / 文件管理器右键「文件传输」）；
// 传输任务只接受来自文件传输窗口本身的请求。

const { IPC } = require('../../shared/constants');
const wm = require('../window-manager');
const transfer = require('../services/transfer-service');
const settings = require('../services/settings-service');

function isTransferSender(event) {
  return wm.isTransferWebContents(event.sender.id);
}

function registerTransferIpc(ipcMain) {
  // 打开传输窗口：target / path 用于定位左侧连接与目录（可为空）。
  ipcMain.handle(IPC.TRANSFER_WINDOW_OPEN, (_event, payload) => {
    const win = wm.openTransferWindow(
      payload && payload.target != null ? payload.target : undefined,
      payload && payload.path != null ? payload.path : undefined
    );
    return { ok: Boolean(win) };
  });

  ipcMain.handle(IPC.TRANSFER_WINDOW_INFO, (event) => {
    if (!isTransferSender(event)) return { ok: false };
    return {
      ok: true,
      target: wm.getTransferWindowTarget(),
      path: wm.getTransferWindowPath(),
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
    if (!isTransferSender(event)) return { ok: false, error: 'forbidden' };
    const sender = event.sender;
    return transfer.run(payload, (progress) => {
      if (!sender.isDestroyed()) sender.send(IPC.TRANSFER_PROGRESS, progress);
    });
  });
}

module.exports = { registerTransferIpc };
