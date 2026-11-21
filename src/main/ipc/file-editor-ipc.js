'use strict';

// Built-in lightweight text editor windows opened from the file manager. Multiple
// editors can be open at once; each reuses the SFTP session of the file-manager window
// that opened it (no extra credentials needed) and is closed with that window.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BrowserWindow, dialog, clipboard, ClipboardItem } = require('electron');
const { IPC, FILE_EDITOR_MAX_BYTES } = require('../../shared/constants');
const { EDITOR_BACKUP_DIR } = require('../utils/paths');
const wm = require('../window-manager');
const sftp = require('../services/sftp-service');
const vscode = require('../services/vscode-service');
const logger = require('../utils/logger');

const RENDERER_DIR = path.join(__dirname, '..', '..', 'renderer');
// 每个文件最多保留的恢复副本数量。
const BACKUP_LIMIT = 5;
// 复制为图片：导出画布宽度（内容区，不含四周留白）。
const IMAGE_EXPORT_WIDTH = 900;
const IMAGE_EXPORT_MAX_HEIGHT = 12000;

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

/* ------------------------------ 恢复副本 ------------------------------
   键 = 本地绝对路径，或「远端目标 + 路径」；每个键一个 JSON 文件，最多 5 份。 */
function backupKey(info) {
  const base = info && info.local
    ? `local:${info.path}`
    : `remote:${(info && info.target) || ''}:${(info && info.path) || ''}`;
  return crypto.createHash('sha256').update(base).digest('hex').slice(0, 24);
}

function backupFileFor(info) {
  return path.join(EDITOR_BACKUP_DIR, `${backupKey(info)}.json`);
}

function readBackupStore(info) {
  try {
    const parsed = JSON.parse(fs.readFileSync(backupFileFor(info), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.content === 'string') : [];
  } catch (err) {
    return [];
  }
}

function writeBackupStore(info, items) {
  try {
    fs.mkdirSync(EDITOR_BACKUP_DIR, { recursive: true });
    fs.writeFileSync(backupFileFor(info), JSON.stringify(items), { mode: 0o600 });
    return true;
  } catch (err) {
    logger.error(`[file-editor] backup write failed: ${err.message}`);
    return false;
  }
}

function addBackup(info, content) {
  if (!info || typeof content !== 'string') return { ok: false, error: 'bad-content' };
  const data = Buffer.from(content, 'utf8');
  if (data.length > FILE_EDITOR_MAX_BYTES) return { ok: false, error: 'too-large' };
  const items = readBackupStore(info);
  if (items.length && items[0].content === content) return { ok: true, skipped: true };
  const time = Date.now();
  items.unshift({
    id: `${time}-${crypto.randomBytes(3).toString('hex')}`,
    time,
    size: data.length,
    name: (info && info.name) || '',
    content,
  });
  writeBackupStore(info, items.slice(0, BACKUP_LIMIT));
  return { ok: true, count: Math.min(items.length, BACKUP_LIMIT) };
}

/* 离屏渲染 Markdown 预览 HTML 并复制为 PNG（四周留白由导出页 CSS 提供）。 */
async function copyMarkdownImage(html) {
  const width = IMAGE_EXPORT_WIDTH;
  const win = new BrowserWindow({
    show: false,
    width,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      paintWhenInitiallyHidden: true,
    },
  });
  try {
    await win.loadFile(path.join(RENDERER_DIR, 'markdown-export.html'));
    const size = await win.webContents.executeJavaScript(`(async () => {
      const root = document.getElementById('export-root');
      root.innerHTML = ${JSON.stringify(String(html || ''))};
      const images = Array.from(root.querySelectorAll('img'));
      await Promise.all(images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
          setTimeout(resolve, 3000);
        });
      }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { height: Math.ceil(root.scrollHeight) };
    })()`);
    const height = Math.min(Math.max((size && size.height) || 400, 240), IMAGE_EXPORT_MAX_HEIGHT);
    win.setContentSize(width, height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
    if (!image || image.isEmpty()) return { ok: false, error: 'empty-image' };
    // Electron 44 已移除 clipboard.writeImage，改用 ClipboardItem + Blob（与 app:copy-image 一致）。
    const png = image.toPNG();
    if (!png || !png.length) return { ok: false, error: 'empty-image' };
    await clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) }),
    ]);
    return { ok: true, width, height };
  } catch (err) {
    logger.error(`[file-editor] copy image failed: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    if (!win.isDestroyed()) win.destroy();
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
    // 记录稳定的主机引用（用户名@地址:路径）作为恢复副本的键，跨重启仍能对上同一文件。
    let target = String((payload && payload.target) || '');
    if (!isLocal && !target) {
      const ref = sftp.reference(sessionId, [filePath]);
      if (ref && ref.ok && ref.references && ref.references[0]) target = ref.references[0];
    }
    const win = wm.openFileEditorWindow(event.sender, {
      sessionId,
      path: filePath,
      name: payload && payload.name,
      local: isLocal,
      target,
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

  // 编辑器窗口内「打开文件」：拉起系统打开面板，把当前窗口切换到选中的本地文件。
  ipcMain.handle(IPC.FILE_EDITOR_OPEN_LOCAL, async (event) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { properties: ['openFile', 'showHiddenFiles'] };
    if (info.local && info.path) options.defaultPath = path.dirname(info.path);
    let picked;
    try {
      picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    } catch (err) {
      return { ok: false, error: err.message };
    }
    if (!picked || picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true };
    const filePath = picked.filePaths[0];
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return { ok: false, error: 'not-a-file' };
      if (stat.size > FILE_EDITOR_MAX_BYTES) return { ok: false, error: 'too-large', size: stat.size };
    } catch (err) {
      return { ok: false, error: err.message };
    }
    wm.updateFileEditorTarget(event.sender.id, {
      local: true,
      sessionId: '',
      path: filePath,
      name: path.basename(filePath),
    });
    logger.file(`[file-editor] opened local file: ${filePath}`);
    return { ok: true, path: filePath, name: path.basename(filePath) };
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

  // 未保存状态同步（关闭窗口时主进程据此弹出二次确认）。
  ipcMain.handle(IPC.FILE_EDITOR_SET_DIRTY, (event, payload) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false };
    wm.setFileEditorDirty(event.sender.id, Boolean(payload && payload.dirty));
    return { ok: true };
  });

  // 本地恢复副本：有未保存修改时由渲染层定时写入，最多保留最近 5 份。
  ipcMain.handle(IPC.FILE_EDITOR_BACKUP, (event, payload) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    return addBackup(info, payload && payload.content);
  });

  ipcMain.handle(IPC.FILE_EDITOR_BACKUPS, (event) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    const items = readBackupStore(info)
      .sort((a, b) => b.time - a.time)
      .map((item) => ({ id: item.id, time: item.time, size: item.size, name: item.name }));
    return { ok: true, items };
  });

  ipcMain.handle(IPC.FILE_EDITOR_BACKUP_READ, (event, payload) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    const id = String((payload && payload.id) || '');
    const item = readBackupStore(info).find((entry) => entry.id === id);
    if (!item) return { ok: false, error: 'not-found' };
    return { ok: true, content: item.content, time: item.time, size: item.size };
  });

  ipcMain.handle(IPC.FILE_EDITOR_BACKUP_CLEAR, (event) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    try {
      fs.rmSync(backupFileFor(info), { force: true });
    } catch (err) {
      return { ok: false, error: err.message };
    }
    return { ok: true };
  });

  // Markdown 预览「复制为图片」：离屏渲染后写入剪贴板。
  ipcMain.handle(IPC.FILE_EDITOR_COPY_IMAGE, async (event, payload) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    const html = payload && payload.html;
    if (typeof html !== 'string' || !html.trim()) return { ok: false, error: 'empty' };
    return copyMarkdownImage(html);
  });

  // 文件管理器销毁时（分离 / 断开 / 关闭）关闭它打开的所有编辑器。
  ipcMain.handle(IPC.FILE_EDITOR_CLOSE_ALL, (event) => {
    if (!isFileManagerSender(event)) return { ok: false };
    const closed = wm.closeFileEditorsForOwner(event.sender.id);
    return { ok: true, closed };
  });
}

module.exports = { registerFileEditorIpc };
