'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const hashAlgorithms = require('./hash-algorithms');

const ALGORITHMS = hashAlgorithms.ALGORITHMS;

/* 可流式计算（可直接喂文件块）的算法。 */
const STREAM_IDS = hashAlgorithms.ALGORITHM_IDS.filter(
  (id) => hashAlgorithms.isCryptoAlgorithm(id) || hashAlgorithms.isStreamAlgorithm(id)
);

/* CityHash64 需要看到整段数据（算法依赖尾部字节）：
   文件场景用「两次读取」实现 —— 先读尾部 64 字节算出初始状态，再按 64 字节块顺序推进。 */
function cityHash64File(file, size) {
  const total = Number.isFinite(size) ? size : fs.statSync(file).size;
  if (total <= 64) {
    return hashAlgorithms.cityHash64Hex(fs.readFileSync(file));
  }
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    const tail = Buffer.alloc(64);
    fs.readSync(fd, tail, 0, 64, total - 64);
    const state = hashAlgorithms.cityInit(head, tail, total);
    const chunks = Math.floor((total - 1) / 64);
    const block = Buffer.alloc(64);
    for (let index = 0; index < chunks; index += 1) {
      const read = fs.readSync(fd, block, 0, 64, index * 64);
      if (read < 64) break;
      hashAlgorithms.cityChunk(state, block, 0);
    }
    return hashAlgorithms.cityFinish(state).toString(16).padStart(16, '0');
  } finally {
    fs.closeSync(fd);
  }
}

/* 文本：一次性算出全部算法。 */
function hashText(text) {
  const buffer = Buffer.from(String(text == null ? '' : text), 'utf8');
  const out = {};
  for (const id of STREAM_IDS) {
    const hasher = hashAlgorithms.create(id);
    hasher.update(buffer);
    out[id] = hasher.digest();
  }
  out.cityhash64 = hashAlgorithms.cityHash64Hex(buffer);
  return out;
}

/* 文件：流式计算（CityHash64 单独走两次读取）。 */
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hashers = {};
    for (const id of STREAM_IDS) hashers[id] = hashAlgorithms.create(id);
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => {
      for (const id of STREAM_IDS) hashers[id].update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      const out = {};
      for (const id of STREAM_IDS) out[id] = hashers[id].digest();
      try {
        out.cityhash64 = cityHash64File(file);
      } catch (err) {
        out.cityhash64 = '';
      }
      resolve(out);
    });
  });
}

function fileInfo(file) {
  const stat = fs.statSync(file);
  const home = os.homedir();
  const tilde = file.startsWith(home) ? `~${file.slice(home.length)}` : file;
  return { path: file, name: path.basename(file), size: stat.size, tilde };
}

module.exports = { hashText, hashFile, fileInfo, ALGORITHMS };
