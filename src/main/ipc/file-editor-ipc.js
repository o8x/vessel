'use strict';

// Built-in lightweight text editor windows opened from the file manager. Multiple
// editors can be open at once; each reuses the SFTP session of the file-manager window
// that opened it (no extra credentials needed) and is closed with that window.

const fs = require('fs');
const path = require('path');
const { BrowserWindow, dialog } = require('electron');
const { IPC, FILE_EDITOR_MAX_BYTES } = require('../../shared/constants');
const wm = require('../window-manager');
const sftp = require('../services/sftp-service');
const vscode = require('../services/vscode-service');
const editorBackup = require('../services/editor-backup-service');
const logger = require('../utils/logger');

const RENDERER_DIR = path.join(__dirname, '..', '..', 'renderer');

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

/* 离屏渲染 Markdown 预览 HTML 并复制为 PNG（四周留白由导出页 CSS 提供）。 */
/* 离屏渲染 Markdown 预览 HTML 并按参数导出 PNG：
   - width：CSS 布局宽度（默认 600）；
   - dpi：输出分辨率，最终像素宽 = width × dpi / 96（默认 150）；
   - padding：四周留白（默认 32px）。
   长文档按固定高度切片逐屏截图，再在隐藏窗口的 canvas 中拼接；CSS 高度上限 30000px。 */
const IMAGE_WIDTH_DEFAULT = 600;
const IMAGE_DPI_DEFAULT = 150;
const IMAGE_PADDING_DEFAULT = 32;
const IMAGE_WIDTH_MIN = 200;
const IMAGE_WIDTH_MAX = 2400;
const IMAGE_DPI_MIN = 72;
const IMAGE_DPI_MAX = 600;
const IMAGE_PADDING_MAX = 200;
const IMAGE_EXPORT_MAX_HEIGHT = 30000;
// 单次截图的视口高度（切片）。
const IMAGE_SLICE_HEIGHT = 1600;
// 拼接画布上限：避免超大 DPI × 超长文档导致 canvas 失败 / 内存爆掉。
const IMAGE_MAX_PIXELS = 60_000_000;
const IMAGE_MAX_PIXEL_HEIGHT = 60000;

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* 复用一个隐藏窗口做导出：反复新建 / 销毁隐藏窗口在 macOS 上会触发
   GPU 进程异常（第二次 loadFile 失败），因此改为串行复用同一窗口。 */
let exportWin = null;
let renderQueue = Promise.resolve();

async function ensureExportWindow(width, height) {
  if (exportWin && !exportWin.isDestroyed()) return exportWin;
  exportWin = new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      paintWhenInitiallyHidden: true,
    },
  });
  exportWin.on('closed', () => {
    exportWin = null;
  });
  await exportWin.loadFile(path.join(RENDERER_DIR, 'markdown-export.html'));
  return exportWin;
}

function renderMarkdownImage(html, options) {
  const run = renderQueue.then(() => doRenderMarkdownImage(html, options));
  renderQueue = run.catch(() => {});
  return run;
}

async function doRenderMarkdownImage(html, options) {
  const opts = options || {};
  const cssWidth = clampInt(opts.width, IMAGE_WIDTH_MIN, IMAGE_WIDTH_MAX, IMAGE_WIDTH_DEFAULT);
  const dpi = clampInt(opts.dpi, IMAGE_DPI_MIN, IMAGE_DPI_MAX, IMAGE_DPI_DEFAULT);
  const padding = clampInt(opts.padding, 0, IMAGE_PADDING_MAX, IMAGE_PADDING_DEFAULT);
  const win = await ensureExportWindow(cssWidth, Math.min(IMAGE_SLICE_HEIGHT, 800));
  try {
    win.setContentSize(cssWidth, Math.min(IMAGE_SLICE_HEIGHT, 800));
    const size = await win.webContents.executeJavaScript(`(async () => {
      document.body.innerHTML = '<div id="export-root" class="editor-preview editor-export"></div>';
      const root = document.getElementById('export-root');
      root.innerHTML = ${JSON.stringify(String(html || ''))};
      root.style.padding = '${padding}px';
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
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
    const totalHeight = Math.min(Math.max((size && size.height) || 400, 240), IMAGE_EXPORT_MAX_HEIGHT);
    const viewportHeight = Math.min(IMAGE_SLICE_HEIGHT, totalHeight);
    win.setContentSize(cssWidth, viewportHeight);
    await sleep(180);

    const slices = [];
    let offset = 0;
    while (offset < totalHeight) {
      const sliceHeight = Math.min(viewportHeight, totalHeight - offset);
      await win.webContents.executeJavaScript(`new Promise((resolve) => {
        document.getElementById('export-root').style.transform = 'translateY(-${offset}px)';
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      })`);
      await sleep(60);
      const image = await win.webContents.capturePage({
        x: 0,
        y: 0,
        width: cssWidth,
        height: sliceHeight,
      });
      if (!image || image.isEmpty()) return { ok: false, error: 'empty-image' };
      slices.push({ dataUrl: image.toDataURL(), height: image.getSize().height });
      offset += sliceHeight;
    }
    const first = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image();
      img.src = ${JSON.stringify(slices[0].dataUrl)};
      await img.decode();
      return { width: img.width };
    })()`);
    const capturedWidth = (first && first.width) || cssWidth;
    const capturedHeight = slices.reduce((sum, item) => sum + item.height, 0);
    // width 按 DPI 换算为输出像素宽（96 DPI 为 1:1）。
    let outWidth = Math.max(1, Math.round((cssWidth * dpi) / 96));
    let scale = outWidth / capturedWidth;
    let outHeight = Math.max(1, Math.round(capturedHeight * scale));
    // 画布上限：等比缩小，避免 canvas 尺寸 / 内存超限。
    let shrink = 1;
    if (outHeight > IMAGE_MAX_PIXEL_HEIGHT) shrink = Math.min(shrink, IMAGE_MAX_PIXEL_HEIGHT / outHeight);
    const area = outWidth * outHeight * shrink * shrink;
    if (area > IMAGE_MAX_PIXELS) shrink = Math.min(shrink, Math.sqrt(IMAGE_MAX_PIXELS / area));
    if (shrink < 1) {
      outWidth = Math.max(1, Math.floor(outWidth * shrink));
      outHeight = Math.max(1, Math.floor(outHeight * shrink));
      scale *= shrink;
    }
    const dataUrl = await win.webContents.executeJavaScript(`(async () => {
      document.body.innerHTML = '';
      document.body.style.margin = '0';
      document.body.style.background = '#ffffff';
      const canvas = document.createElement('canvas');
      canvas.width = ${outWidth};
      canvas.height = ${outHeight};
      document.body.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const urls = ${JSON.stringify(slices.map((item) => item.dataUrl))};
      let y = 0;
      for (const url of urls) {
        const img = new Image();
        img.src = url;
        await img.decode();
        const h = Math.round(img.height * ${scale});
        ctx.drawImage(img, 0, y, ${outWidth}, h);
        y += h;
      }
      return canvas.toDataURL('image/png');
    })()`);
    if (!dataUrl || dataUrl === 'data:,') return { ok: false, error: 'render-failed' };
    return { ok: true, dataUrl, width: outWidth, height: outHeight, cssWidth, cssHeight: totalHeight };
  } catch (err) {
    logger.error(`[file-editor] render image failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/* 把 PNG data URL 保存到设置里的文件下载目录（重名自动加序号）。 */
function saveMarkdownImage(dataUrl, name) {
  const value = String(dataUrl || '');
  if (!/^data:image\/png;base64,/.test(value)) return { ok: false, error: 'invalid' };
  let buffer;
  try {
    buffer = Buffer.from(value.split(',')[1] || '', 'base64');
  } catch (err) {
    return { ok: false, error: 'invalid' };
  }
  if (!buffer || !buffer.length) return { ok: false, error: 'empty' };
  try {
    const dir = sftp.downloadDir();
    const stem = path.basename(String(name || 'markdown'), path.extname(String(name || ''))) || 'markdown';
    const target = sftp.uniqueLocalPath(dir, `${stem}.png`);
    fs.writeFileSync(target, buffer);
    logger.file(`[file-editor] markdown image saved: ${target}`);
    return { ok: true, path: target };
  } catch (err) {
    logger.error(`[file-editor] save image failed: ${err.message}`);
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

  // 读取当前文件：远端文件走 SFTP 流式读取，过程中实时回传进度（渲染层显示进度条）。
  ipcMain.handle(IPC.FILE_EDITOR_READ, (event) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    if (info.local) return readLocalText(info.path);
    const sender = event.sender;
    return sftp.readText(info.sessionId, info.path, (progress) => {
      try {
        sender.send(IPC.FILE_EDITOR_PROGRESS, progress);
      } catch (err) {
        /* 窗口已销毁：忽略本次进度 */
      }
    });
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
    return editorBackup.addBackup(info, payload && payload.content);
  });

  ipcMain.handle(IPC.FILE_EDITOR_BACKUPS, (event) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    return { ok: true, items: editorBackup.listBackups(info) };
  });

  ipcMain.handle(IPC.FILE_EDITOR_BACKUP_READ, (event, payload) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    const item = editorBackup.readBackup(info, payload && payload.id);
    if (!item) return { ok: false, error: 'not-found' };
    return { ok: true, content: item.content, time: item.time, size: item.size };
  });

  ipcMain.handle(IPC.FILE_EDITOR_BACKUP_CLEAR, (event) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    return editorBackup.clearBackups(info);
  });

  // Markdown 图片导出：离屏渲染并按参数返回 PNG data URL（供预览 / 复制）。
  ipcMain.handle(IPC.FILE_EDITOR_RENDER_IMAGE, async (event, payload) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    const html = payload && payload.html;
    if (typeof html !== 'string' || !html.trim()) return { ok: false, error: 'empty' };
    return renderMarkdownImage(html, payload && payload.options);
  });

  // 把导出的 PNG 保存到设置里的下载目录。
  ipcMain.handle(IPC.FILE_EDITOR_SAVE_IMAGE, (event, payload) => {
    const info = wm.getFileEditorInfoForWebContents(event.sender.id);
    if (!info) return { ok: false, error: 'forbidden' };
    return saveMarkdownImage(payload && payload.dataUrl, payload && payload.name);
  });

  // 文件管理器销毁时（分离 / 断开 / 关闭）关闭它打开的所有编辑器。
  ipcMain.handle(IPC.FILE_EDITOR_CLOSE_ALL, (event) => {
    if (!isFileManagerSender(event)) return { ok: false };
    const closed = wm.closeFileEditorsForOwner(event.sender.id);
    return { ok: true, closed };
  });
}

module.exports = { registerFileEditorIpc, renderMarkdownImage };
