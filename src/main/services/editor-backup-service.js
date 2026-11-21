'use strict';

/* 内置编辑器的本地恢复副本（非机密 JSON）：
   每个文件（本地路径，或「远端目标 + 路径」的哈希）一个文件，最多保留 BACKUP_LIMIT 份。
   供 file-editor IPC 与窗口关闭逻辑共用。 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EDITOR_BACKUP_DIR } = require('../utils/paths');
const { FILE_EDITOR_MAX_BYTES } = require('../../shared/constants');
const logger = require('../utils/logger');

// 每个文件最多保留的恢复副本数量。
const BACKUP_LIMIT = 5;

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

function listBackups(info) {
  return readBackupStore(info)
    .sort((a, b) => b.time - a.time)
    .map((item) => ({ id: item.id, time: item.time, size: item.size, name: item.name }));
}

function readBackup(info, id) {
  return readBackupStore(info).find((entry) => entry.id === String(id || '')) || null;
}

function clearBackups(info) {
  try {
    fs.rmSync(backupFileFor(info), { force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  BACKUP_LIMIT,
  backupKey,
  backupFileFor,
  addBackup,
  listBackups,
  readBackup,
  clearBackups,
};
