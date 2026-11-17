'use strict';

// 文件传输（穿梭框）：把一个远端文件 / 目录从一台主机传到另一台主机。
// 分两段进行：源端 SFTP 先下载到本地下载目录（保留本地副本），再从本地副本
// 上传到目标端（目录逐层递归）。进度按「下载」「上传」两段分别回传。
// 全局同一时刻只允许一个传输任务（需求：同时只能传输一个对象）。

const fs = require('fs');
const path = require('path');
const sftp = require('./sftp-service');
const logger = require('../utils/logger');

// 同一时刻只跑一个传输任务。
let busy = false;

function isBusy() {
  return busy;
}

function joinRemote(dir, name) {
  const base = String(dir || '/');
  return base === '/' ? `/${name}` : `${base.replace(/\/$/, '')}/${name}`;
}

/* 统计目录下的文件总数与总字节（用于进度条总量）。 */
async function measure(id, dir) {
  const result = await sftp.listDir(id, dir);
  if (!result || !result.ok) return { files: 0, bytes: 0, failed: true };
  let files = 0;
  let bytes = 0;
  for (const entry of result.entries || []) {
    if (entry.type === 'dir') {
      const child = await measure(id, joinRemote(dir, entry.name));
      files += child.files;
      bytes += child.bytes;
    } else {
      files += 1;
      bytes += Number(entry.size) || 0;
    }
  }
  return { files, bytes };
}

/* 第一段：把源端文件 / 目录完整下载到本地目录（stats.downloaded 累计进度）。 */
async function downloadTree(fromId, remotePath, localPath, stats, onProgress) {
  const info = await sftp.stat(fromId, remotePath);
  if (!info || !info.ok) return { ok: false, error: (info && info.error) || 'stat-failed' };

  if (info.type === 'dir') {
    try {
      fs.mkdirSync(localPath, { recursive: true });
    } catch (err) {
      return { ok: false, error: err.message };
    }
    const listing = await sftp.listDir(fromId, remotePath);
    if (!listing || !listing.ok) {
      return { ok: false, error: (listing && listing.error) || 'list-failed' };
    }
    for (const entry of listing.entries || []) {
      const child = await downloadTree(
        fromId,
        joinRemote(remotePath, entry.name),
        path.join(localPath, entry.name),
        stats,
        onProgress
      );
      if (!child.ok) return child;
    }
    return { ok: true };
  }

  const size = Number(info.size) || 0;
  const base = stats.downloaded;
  const name = info.name || path.posix.basename(remotePath);
  const downloaded = await sftp.downloadTo(fromId, remotePath, localPath, (progress) => {
    const current = Math.min(Number(progress.transferred) || 0, size);
    onProgress({
      phase: 'download',
      name,
      path: remotePath,
      transferred: base + current,
      total: stats.total,
    });
  });
  if (!downloaded || !downloaded.ok) {
    return { ok: false, error: (downloaded && downloaded.error) || 'download-failed', name };
  }
  stats.downloaded = base + size;
  return { ok: true };
}

/* 第二段：把本地副本递归上传到目标端（stats.uploaded 累计进度）。
   remoteName 为落地的远端文件名（本地暂存名可能带序号后缀，需还原原名）。 */
async function uploadTree(toId, localPath, remoteDir, remoteName, stats, onProgress) {
  let info;
  try {
    info = fs.statSync(localPath);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  if (info.isDirectory()) {
    const target = joinRemote(remoteDir, remoteName);
    const made = await sftp.mkdir(toId, target);
    if (!made || !made.ok) return { ok: false, error: (made && made.error) || 'mkdir-failed' };
    let children;
    try {
      children = fs.readdirSync(localPath);
    } catch (err) {
      return { ok: false, error: err.message };
    }
    for (const child of children) {
      const result = await uploadTree(toId, path.join(localPath, child), target, child, stats, onProgress);
      if (!result.ok) return result;
    }
    return { ok: true };
  }

  const size = Number(info.size) || 0;
  const base = stats.uploaded;
  const uploaded = await sftp.uploadAs(toId, localPath, remoteDir, remoteName, (progress) => {
    const current = Math.min(Number(progress.transferred) || 0, size);
    onProgress({
      phase: 'upload',
      name: remoteName,
      path: joinRemote(remoteDir, remoteName),
      transferred: base + current,
      total: stats.total,
    });
  });
  if (!uploaded || !uploaded.ok) {
    return { ok: false, error: (uploaded && uploaded.error) || 'upload-failed', name: remoteName };
  }
  stats.uploaded = base + size;
  return { ok: true };
}

/* 执行一次传输：
   - fromId / toId：两端 SFTP 会话 id；
   - path：源端远端绝对路径；destDir：目标端目录；
   - type：'file' | 'dir'（不传则自动 stat 判定）。
   返回 { ok, transferred, total, files, localPath, error }。 */
async function run(request, onProgress) {
  const fromId = String((request && request.fromId) || '');
  const toId = String((request && request.toId) || '');
  const source = String((request && request.path) || '');
  const destDir = String((request && request.destDir) || '/');
  if (!fromId || !toId || !source) {
    return { ok: false, error: 'invalid-request' };
  }
  if (busy) {
    return { ok: false, error: 'busy' };
  }
  if (!sftp.get(fromId) || !sftp.get(toId)) {
    return { ok: false, error: 'not-connected' };
  }

  busy = true;
  const report = typeof onProgress === 'function' ? onProgress : () => {};
  try {
    const info = await sftp.stat(fromId, source);
    if (!info || !info.ok) {
      return { ok: false, error: (info && info.error) || 'stat-failed' };
    }
    const isDir = request && request.type ? request.type === 'dir' : info.type === 'dir';
    const name = info.name || path.posix.basename(source);

    // 进度总量：目录统计所有文件字节，文件直接取体积。
    let total = Number(info.size) || 0;
    let files = 1;
    if (isDir) {
      const measured = await measure(fromId, source);
      total = measured.bytes;
      files = measured.files;
    }

    report({ phase: 'start', name, path: source, transferred: 0, total, files });

    // 第一段：下载到本地下载目录（保留副本，重名自动加序号）。
    const localPath = sftp.uniqueLocalPath(sftp.downloadDir(), name);
    const stats = { downloaded: 0, uploaded: 0, total };
    const downloaded = await downloadTree(fromId, source, localPath, stats, report);
    if (!downloaded.ok) {
      report({ phase: 'error', phaseAt: 'download', name, error: downloaded.error });
      return { ok: false, error: downloaded.error, transferred: stats.downloaded, total, localPath };
    }
    report({ phase: 'downloaded', name, path: localPath, transferred: total, total, files });

    // 第二段：从本地副本上传到目标端。
    const uploaded = await uploadTree(toId, localPath, destDir, name, stats, report);
    if (!uploaded.ok) {
      report({ phase: 'error', phaseAt: 'upload', name, error: uploaded.error });
      return { ok: false, error: uploaded.error, transferred: stats.uploaded, total, localPath };
    }

    report({ phase: 'done', name, path: source, localPath, transferred: total, total, files });
    logger.file(`[transfer] ${source} -> ${destDir} done (${total} bytes, ${files} files, local: ${localPath})`);
    return { ok: true, transferred: total, total, files, name, localPath };
  } catch (err) {
    logger.error(`[transfer] failed (${source} -> ${destDir}): ${err.message}`);
    report({ phase: 'error', name: path.posix.basename(source), error: err.message });
    return { ok: false, error: err.message };
  } finally {
    busy = false;
  }
}

module.exports = { run, isBusy };
