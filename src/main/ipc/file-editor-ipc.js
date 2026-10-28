'use strict';

// Built-in lightweight text editor windows opened from the file manager. Multiple
// editors can be open at once; each reuses the SFTP session of the file-manager window
// that opened it (no extra credentials needed) and is closed with that window.

const { IPC } = require('../../shared/constants');
const wm = require('../window-manager');
const sftp = require('../services/sftp-service');
const vscode = require('../services/vscode-service');

/* 只有终端窗口的内嵌面板 / 独立文件窗口可以打开编辑器。 */
function isFileManagerSender(event) {
  const fileWin = wm.getFileWindow();
  const id = event.sender.id;
  return Boolean(
    wm.isTerminalWebContents(id) || (fileWin && !fileWin.isDestroyed() && fileWin.webContents.id === id)
  );
}

function registerFileEditorIpc(ipcMain) {
  ipcMain.handle(IPC.FILE_EDITOR_OPEN, (event, payload) => {
    if (!isFileManagerSender(event)) return { ok: false, error: 'forbidden' };
    const sessionId = String((payload && payload.sessionId) || '');
    const filePath = String((payload && payload.path) || '');
    if (!sessionId || !filePath) return { ok: false, error: 'bad-request' };
    // 会话必须属于发起窗口，避免跨窗口 / 跨连接读取。
    if (sftp.ownerId(sessionId) !== event.sender.id) return { ok: false, error: 'forbidden' };
    const win = wm.openFileEditorWindow(event.sender, {
      sessionId,
      path: filePath,
      name: payload && payload.name,
      target: payload && payload.target,
    });
    return win ? { ok: true } : { ok: false, error: 'open-failed' };
  });

  ipcMain.handle(IPC.FILE_EDITOR_INFO, (event) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false };
    const ref = sftp.reference(info.sessionId, [info.path]);
    return {
      ok: true,
      path: info.path,
      name: info.name,
      reference: ref && ref.ok ? ref.references[0] : info.path,
    };
  });

  ipcMain.handle(IPC.FILE_EDITOR_READ, (event) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    return sftp.readText(info.sessionId, info.path);
  });

  ipcMain.handle(IPC.FILE_EDITOR_SAVE, (event, payload) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    const content = payload && payload.content;
    if (typeof content !== 'string') return { ok: false, error: 'bad-content' };
    return sftp.writeText(info.sessionId, info.path, content);
  });

  ipcMain.handle(IPC.FILE_EDITOR_SAVE_AS, (event, payload) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    const nextPath = String((payload && payload.path) || '').trim();
    const content = payload && payload.content;
    if (!nextPath.startsWith('/')) return { ok: false, error: 'bad-path' };
    if (typeof content !== 'string') return { ok: false, error: 'bad-content' };
    return sftp.writeText(info.sessionId, nextPath, content).then((result) => {
      if (result && result.ok) wm.updateFileEditorPath(event.sender.id, nextPath);
      return result;
    });
  });


  // 从 VS Code 打开：把编辑器当前内容写成下载目录里的本地文件，再用 VS Code 打开
  //（不依赖再下载远端文件，也保证打开的是当前内容）。
  ipcMain.handle(IPC.FILE_EDITOR_OPEN_VSCODE, async (event, payload) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    const content = payload && payload.content;
    if (typeof content !== 'string') return { ok: false, error: 'bad-content' };
    const result = sftp.saveLocalText((payload && payload.name) || info.name, content);
    if (!result || !result.ok) return result;
    const opened = await vscode.openPath(result.path);
    if (!opened || !opened.ok) {
      return { ok: false, error: (opened && opened.error) || 'vscode-failed', path: result.path };
    }
    return result;
  });

  // 下载到本地：把编辑器当前内容写成下载目录里的本地文件。
  ipcMain.handle(IPC.FILE_EDITOR_DOWNLOAD, (event, payload) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    const content = payload && payload.content;
    if (typeof content !== 'string') return { ok: false, error: 'bad-content' };
    return sftp.saveLocalText((payload && payload.name) || info.name, content);
  });

  // 文件管理器销毁时（分离 / 断开 / 关闭）关闭它打开的所有编辑器。
  ipcMain.handle(IPC.FILE_EDITOR_CLOSE_ALL, (event) => {
    if (!isFileManagerSender(event)) return { ok: false };
    const closed = wm.closeFileEditorsForOwner(event.sender.id);
    return { ok: true, closed };
  });
}

module.exports = { registerFileEditorIpc };
