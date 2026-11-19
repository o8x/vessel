'use strict';

const { IPC } = require('../../shared/constants');
const cliService = require('../services/cli-service');

/* 设置 → 数据 → 命令行工具（CLI）：查询安装状态 / 安装到 <数据目录>/bin 并写入 ~/.zshrc。 */
function registerCliIpc(ipcMain) {
  ipcMain.handle(IPC.CLI_STATUS, () => cliService.status());
  ipcMain.handle(IPC.CLI_INSTALL, () => cliService.install());
}

module.exports = { registerCliIpc };
