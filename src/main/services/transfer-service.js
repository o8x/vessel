'use strict';

// 文件传输（穿梭框）：把一个远端文件 / 目录从一台主机传到另一台主机。
// 实现方式：源端 SFTP 下载到本地临时目录 → 目标端 SFTP 上传（目录逐层递归）。
// 全局同一时刻只允许一个传输任务（需求：同时只能传输一个对象）。

const fs = require('fs');
const os = require('os');
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

/* 递归复制目录：逐个文件「下载到临时目录 → 上传到目标端」。 */
async function copyDir(fromId, toId, remoteDir, destDir, tempRoot, state, onProgress) {
  const listing = await sftp.listDir(fromId, remoteDir);
  if (!listing || !listing.ok) {
    return { ok: false, error: (listing && listing.error) || 'list-failed' };
  }
  const made = await sftp.mkdir(toId, destDir);
  if (!made || !made.ok) {
    return { ok: false, error: (made && made.error) || 'mkdir-failed' };
  }
  for (const entry of listing.entries || []) {
    const source = joinRemote(remoteDir, entry.name);
    const target = joinRemote(destDir, entry.name);
    if (entry.type === 'dir') {
      const child = await copyDir(fromId, toId, source, target, tempRoot, state, onProgress);
      if (!child.ok) return child;
      continue;
    }
    // 每个文件下载到独立的临时子目录（保持原文件名），上传后按原名落到目标目录。
    const fileTempDir = path.join(tempRoot, String((state.counter += 1)));
    fs.mkdirSync(fileTempDir, { recursive: true });
    const localPath = path.join(fileTempDir, entry.name);
    const downloaded = await sftp.downloadTo(fromId, source, localPath, (progress) => {
      state.transferred += Number(progress.transferred) || 0;
      onProgress({
        phase: 'download',
        name: entry.name,
        path: source,
        transferred: state.transferred,
        total: state.total,
      });
    });
    if (!downloaded || !downloaded.ok) {
      return { ok: false, error: (downloaded && downloaded.error) || 'download-failed', name: entry.name };
    }
    const uploaded = await sftp.upload(toId, localPath, destDir, (progress) => {
      onProgress({
        phase: 'upload',
        name: entry.name,
        path: target,
        transferred: state.transferred,
        total: state.total,
      });
    });
    try {
      fs.unlinkSync(localPath);
    } catch (err) {
      /* ignore */
    }
    if (!uploaded || !uploaded.ok) {
      return { ok: false, error: (uploaded && uploaded.error) || 'upload-failed', name: entry.name };
    }
  }
  return { ok: true };
}

/* 执行一次传输：
   - fromId / toId：两端 SFTP 会话 id；
   - path：源端远端绝对路径；destDir：目标端目录；
   - type：'file' | 'dir'（不传则自动 stat 判定）。
   返回 { ok, transferred, total, files, error }。 */
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
  let tempRoot = '';
  try {
    const info = await sftp.stat(fromId, source);
    if (!info || !info.ok) {
      return { ok: false, error: (info && info.error) || 'stat-failed' };
    }
    const isDir = (request && request.type) ? request.type === 'dir' : info.type === 'dir';
    const name = info.name || path.posix.basename(source);

    // 进度总量：目录统计所有文件字节，文件直接取体积。
    let total = Number(info.size) || 0;
    let files = 1;
    if (isDir) {
      const measured = await measure(fromId, source);
      total = measured.bytes;
      files = measured.files;
    }

    const state = { transferred: 0, total, counter: 0 };
    report({ phase: 'start', name, path: source, transferred: 0, total, files });

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-transfer-'));
    if (isDir) {
      const result = await copyDir(fromId, toId, source, joinRemote(destDir, name), tempRoot, state, report);
      if (!result.ok) {
        report({ phase: 'error', name, error: result.error });
        return { ok: false, error: result.error, transferred: state.transferred, total };
      }
    } else {
      const localPath = path.join(tempRoot, name);
      const downloaded = await sftp.downloadTo(fromId, source, localPath, (progress) => {
        state.transferred = Number(progress.transferred) || 0;
        report({
          phase: 'download',
          name,
          path: source,
          transferred: state.transferred,
          total,
        });
      });
      if (!downloaded || !downloaded.ok) {
        report({ phase: 'error', name, error: (downloaded && downloaded.error) || 'download-failed' });
        return { ok: false, error: (downloaded && downloaded.error) || 'download-failed' };
      }
      const uploaded = await sftp.upload(toId, localPath, destDir, (progress) => {
        report({
          phase: 'upload',
          name,
          path: joinRemote(destDir, name),
          transferred: state.transferred,
          total,
        });
      });
      if (!uploaded || !uploaded.ok) {
        report({ phase: 'error', name, error: (uploaded && uploaded.error) || 'upload-failed' });
        return { ok: false, error: (uploaded && uploaded.error) || 'upload-failed' };
      }
    }

    report({ phase: 'done', name, path: source, transferred: total, total, files });
    logger.file(`[transfer] ${source} -> ${destDir} done (${total} bytes, ${files} files)`);
    return { ok: true, transferred: total, total, files, name };
  } catch (err) {
    logger.error(`[transfer] failed (${source} -> ${destDir}): ${err.message}`);
    report({ phase: 'error', name: path.posix.basename(source), error: err.message });
    return { ok: false, error: err.message };
  } finally {
    if (tempRoot) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch (err) {
        /* ignore */
      }
    }
    busy = false;
  }
}

module.exports = { run, isBusy };
