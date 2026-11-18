'use strict';

// Built-in lightweight text editor windows opened from the file manager. Multiple
// editors can be open at once; each reuses the SFTP session of the file-manager window
// that opened it (no extra credentials needed) and is closed with that window.

const fs = require('fs');
const path = require('path');
const { BrowserWindow, dialog } = require('electron');
const { IPC } = require('../../shared/constants');
const wm = require('../window-manager');
const sftp = require('../services/sftp-service');
const vscode = require('../services/vscode-service');
const logger = require('../utils/logger');

/* 只有终端窗口的内嵌面板 / 独立文件窗口可以打开编辑器。 */
function isFileManagerSender(event) {
  const fileWin = wm.getFileWindow();
  const id = event.sender.id;
  return Boolean(
    wm.isTerminalWebContents(id) ||
      wm.isTransferWebContents(id) ||
      (fileWin && !fileWin.isDestroyed() && fileWin.webContents.id === id)
  );
}

/* 本地临时文件：读 / 写直接走 fs，与 SFTP 无关。 */
function readLocalText(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const binary = data.subarray(0, 8192).includes(0);
    let mtime = 0;
    try {
      mtime = fs.statSync(filePath).mtimeMs;
    } catch (err) {
      mtime = 0;
    }
    return { ok: true, content: data.toString('utf8'), size: data.length, mtime, binary };
  } catch (err) {
    return { ok: false, error: err.message, code: 'read' };
  }
}

function writeLocalText(filePath, content) {
  const data = Buffer.from(String(content == null ? '' : content), 'utf8');
  try {
    fs.writeFileSync(filePath, data);
    return { ok: true, path: filePath, bytes: data.length };
  } catch (err) {
    logger.error(`[file-editor] local write failed (${filePath}): ${err.message}`);
    return { ok: false, error: err.message };
  }
}

function registerFileEditorIpc(ipcMain) {
  ipcMain.handle(IPC.FILE_EDITOR_OPEN, (event, payload) => {
    if (!isFileManagerSender(event)) return { ok: false, error: 'forbidden' };
    const isLocal = Boolean(payload && payload.local);
    const sessionId = isLocal ? '' : String((payload && payload.sessionId) || '');
    const filePath = String((payload && payload.path) || '');
    if (!filePath || (!isLocal && !sessionId)) return { ok: false, error: 'bad-request' };
    // 会话必须属于发起窗口，避免跨窗口 / 跨连接读取。
    if (!isLocal && sftp.ownerId(sessionId) !== event.sender.id) {
      return { ok: false, error: 'forbidden' };
    }
    const win = wm.openFileEditorWindow(event.sender, {
      sessionId,
      path: filePath,
      name: payload && payload.name,
      local: isLocal,
      target: payload && payload.target,
    });
    return win ? { ok: true } : { ok: false, error: 'open-failed' };
  });

  // 新建本地临时文件并在内置编辑器中打开（终端内联命令 `\v edit`）。
  // 本地文件默认落在设置里配置的「文件下载目录」，方便用户直接找到。
  ipcMain.handle(IPC.FILE_EDITOR_NEW_LOCAL, (event) => {
    if (!isFileManagerSender(event)) return { ok: false, error: 'forbidden' };
    let filePath = '';
    try {
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const dir = sftp.downloadDir();
      filePath = sftp.uniqueLocalPath(dir, `scratch-${stamp}.txt`);
      fs.writeFileSync(filePath, '', 'utf8');
    } catch (err) {
      logger.error(`[file-editor] cannot create local file: ${err.message}`);
      return { ok: false, error: err.message };
    }
    const win = wm.openFileEditorWindow(event.sender, {
      local: true,
      path: filePath,
      name: path.basename(filePath),
      target: '',
    });
    if (!win) return { ok: false, error: 'open-failed' };
    logger.file(`[file-editor] local file created: ${filePath}`);
    return { ok: true, path: filePath };
  });

  ipcMain.handle(IPC.FILE_EDITOR_INFO, (event) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false };
    if (info.local) {
      return { ok: true, path: info.path, name: info.name, reference: info.path, local: true };
    }
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
    if (info.local) return readLocalText(info.path);
    return sftp.readText(info.sessionId, info.path);
  });

  ipcMain.handle(IPC.FILE_EDITOR_SAVE, (event, payload) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    const content = payload && payload.content;
    if (typeof content !== 'string') return { ok: false, error: 'bad-content' };
    if (info.local) return writeLocalText(info.path, content);
    return sftp.writeText(info.sessionId, info.path, content);
  });

  ipcMain.handle(IPC.FILE_EDITOR_SAVE_AS, async (event, payload) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    const nextPath = String((payload && payload.path) || '').trim();
    const content = payload && payload.content;
    if (typeof content !== 'string') return { ok: false, error: 'bad-content' };
    // 本地文件：拉起系统保存面板（Finder 样式）选择保存位置。
    if (info.local) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: 'Save As',
        defaultPath: path.join(sftp.downloadDir(), info.name || 'untitled.txt'),
        filters: [{ name: 'Text', extensions: ['txt', 'log', 'md'] }],
      };
      const picked = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
      const result = writeLocalText(picked.filePath, content);
      if (result && result.ok) wm.updateFileEditorPath(event.sender.id, picked.filePath);
      return result;
    }
    if (!nextPath.startsWith('/')) return { ok: false, error: 'bad-path' };
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
    // 本地临时文件：先落盘当前内容，再直接用 VS Code 打开该文件。
    if (info.local) {
      const written = writeLocalText(info.path, content);
      if (!written.ok) return written;
      const opened = await vscode.openPath(info.path);
      if (!opened || !opened.ok) {
        return { ok: false, error: (opened && opened.error) || 'vscode-failed', path: info.path };
      }
      return { ok: true, path: info.path, name: info.name, bytes: written.bytes };
    }
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
