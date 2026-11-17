'use strict';

// 文件传输窗口（穿梭框）的预加载脚本：只暴露该窗口需要的能力
// （设置 / SSH 主机列表 / SFTP 会话 / 传输任务 / 窗口自身信息）。

const { contextBridge, ipcRenderer } = require('electron');
const { IPC } = require('../shared/constants');
const { loadIcons } = require('./icons');

function on(channel, cb) {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  onSettingsChanged: (cb) => on(IPC.SETTINGS_CHANGED, cb),
  onThemeChanged: (cb) => on(IPC.THEME_CHANGED, cb),
  log: (text) => ipcRenderer.send(IPC.LOG_WRITE, text),
  ssh: {
    list: () => ipcRenderer.invoke(IPC.SSH_LIST),
    onConfigChanged: (cb) => on(IPC.SSH_CONFIG_CHANGED, cb),
  },
  sftp: {
    connect: (connection) => ipcRenderer.invoke(IPC.SFTP_CONNECT, connection),
    list: (id, path) => ipcRenderer.invoke(IPC.SFTP_LIST, { id, path }),
    close: (id) => ipcRenderer.invoke(IPC.SFTP_CLOSE, { id }),
    download: (id, path) => ipcRenderer.invoke(IPC.SFTP_DOWNLOAD, { id, path }),
    open: (id, path) => ipcRenderer.invoke(IPC.SFTP_OPEN, { id, path }),
    openVSCode: (id, path) => ipcRenderer.invoke(IPC.SFTP_OPEN_VSCODE, { id, path }),
    openWireshark: (id, path) => ipcRenderer.invoke(IPC.SFTP_OPEN_WIRESHARK, { id, path }),
    copyPath: (paths) => ipcRenderer.invoke(IPC.SFTP_COPY_PATH, { paths }),
    copyReference: (id, paths) => ipcRenderer.invoke(IPC.SFTP_COPY_REFERENCE, { id, paths }),
  },
  fileEditor: {
    open: (payload) => ipcRenderer.invoke(IPC.FILE_EDITOR_OPEN, payload),
  },
  transfer: {
    run: (payload) => ipcRenderer.invoke(IPC.TRANSFER_RUN, payload),
    onProgress: (cb) => on(IPC.TRANSFER_PROGRESS, cb),
  },
  transferWindow: {
    info: () => ipcRenderer.invoke(IPC.TRANSFER_WINDOW_INFO),
    close: () => ipcRenderer.invoke(IPC.TRANSFER_WINDOW_CLOSE),
    onLocate: (cb) => on(IPC.TRANSFER_WINDOW_LOCATE, cb),
  },
};

contextBridge.exposeInMainWorld('ships', api);
contextBridge.exposeInMainWorld('shipsPlatform', process.platform);
contextBridge.exposeInMainWorld('shipsIcons', loadIcons());
