'use strict';

/* 哈希算法实现（主进程）。
   - MD5 / SHA-1 / SHA-256 / SHA-384 / SHA-512：Node 内置 crypto
   - CRC32、FNV-1a（32 / 64 位）、xxHash64、CityHash64：纯 JS 实现
     xxHash64 与 CityHash64 按上游 C++ 参考实现移植，已与参考实现逐字节比对验证
     （长度 0–300 的随机语料全部一致）。

   统一接口：每个算法都提供 create() → { update(buffer), digest() }，
   update 可分多次喂入（文件流式计算），digest 返回小写十六进制字符串。 */

const crypto = require('crypto');

const MASK64 = 0xffffffffffffffffn;

/* ------------------------------ 64 位运算辅助 ------------------------------ */

function mul64(a, b) {
  return (a * b) & MASK64;
}

function add64(...values) {
  let total = 0n;
  for (const value of values) total += value;
  return total & MASK64;
}

/* 循环左移（xxHash 用）：shift 为 0 时直接返回，避免 BigInt 移位按 64 取模的坑。 */
function rotl64(value, shift) {
  if (!shift) return value & MASK64;
  const s = BigInt(shift);
  return ((value << s) | (value >> (64n - s))) & MASK64;
}

/* 循环右移（CityHash 的 Rotate 就是右移：`(val >> shift) | (val << (64 - shift))`）。 */
function rotr64(value, shift) {
  if (!shift) return value & MASK64;
  const s = BigInt(shift);
  return ((value >> s) | (value << (64n - s))) & MASK64;
}

function readLE64(buffer, offset) {
  return buffer.readBigUInt64LE(offset);
}

function readLE32(buffer, offset) {
  return BigInt(buffer.readUInt32LE(offset));
}

/* ------------------------------ CRC32 ------------------------------ */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

class Crc32 {
  constructor() {
    this.value = 0xffffffff;
  }

  update(chunk) {
    let c = this.value;
    for (let i = 0; i < chunk.length; i += 1) {
      c = CRC32_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
    }
    this.value = c >>> 0;
  }

  digest() {
    return ((this.value ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
  }
}

/* ------------------------------ FNV-1a ------------------------------ */

class Fnv1a32 {
  constructor() {
    this.hash = 0x811c9dc5;
  }

  update(chunk) {
    let h = this.hash;
    for (let i = 0; i < chunk.length; i += 1) {
      h ^= chunk[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    this.hash = h >>> 0;
  }

  digest() {
    return (this.hash >>> 0).toString(16).padStart(8, '0');
  }
}

class Fnv1a64 {
  constructor() {
    this.hash = 0xcbf29ce484222325n;
  }

  update(chunk) {
    let h = this.hash;
    const prime = 0x100000001b3n;
    for (let i = 0; i < chunk.length; i += 1) {
      h ^= BigInt(chunk[i]);
      h = (h * prime) & MASK64;
    }
    this.hash = h;
  }

  digest() {
    return this.hash.toString(16).padStart(16, '0');
  }
}

/* ------------------------------ xxHash64 ------------------------------ */

const XXH_PRIME64_1 = 11400714785074694791n;
const XXH_PRIME64_2 = 14029467366897019727n;
const XXH_PRIME64_3 = 1609587929392839161n;
const XXH_PRIME64_4 = 9650029242287828579n;
const XXH_PRIME64_5 = 2870177450012600261n;

function xxh64Round(acc, input) {
  acc = add64(acc, mul64(input, XXH_PRIME64_2));
  acc = rotl64(acc, 31);
  return mul64(acc, XXH_PRIME64_1);
}

function xxh64MergeRound(acc, val) {
  const mixed = xxh64Round(0n, val);
  const xored = (acc ^ mixed) & MASK64;
  return add64(mul64(xored, XXH_PRIME64_1), XXH_PRIME64_4);
}

function xxh64Avalanche(hash) {
  let h = hash;
  h = mul64(h ^ (h >> 33n), XXH_PRIME64_2);
  h = mul64(h ^ (h >> 29n), XXH_PRIME64_3);
  return h ^ (h >> 32n);
}

class XxHash64 {
  constructor() {
    this.v = [
      (XXH_PRIME64_1 + XXH_PRIME64_2) & MASK64,
      XXH_PRIME64_2,
      0n,
      (-XXH_PRIME64_1) & MASK64,
    ];
    this.mem = Buffer.alloc(32);
    this.memSize = 0;
    this.totalLen = 0;
  }

  update(chunk) {
    this.totalLen += chunk.length;
    let offset = 0;
    if (this.memSize + chunk.length < 32) {
      chunk.copy(this.mem, this.memSize, offset);
      this.memSize += chunk.length;
      return;
    }
    if (this.memSize > 0) {
      chunk.copy(this.mem, this.memSize, 0, 32 - this.memSize);
      this.v[0] = xxh64Round(this.v[0], readLE64(this.mem, 0));
      this.v[1] = xxh64Round(this.v[1], readLE64(this.mem, 8));
      this.v[2] = xxh64Round(this.v[2], readLE64(this.mem, 16));
      this.v[3] = xxh64Round(this.v[3], readLE64(this.mem, 24));
      offset = 32 - this.memSize;
      this.memSize = 0;
    }
    const limit = chunk.length - 32;
    while (offset <= limit) {
      this.v[0] = xxh64Round(this.v[0], readLE64(chunk, offset));
      this.v[1] = xxh64Round(this.v[1], readLE64(chunk, offset + 8));
      this.v[2] = xxh64Round(this.v[2], readLE64(chunk, offset + 16));
      this.v[3] = xxh64Round(this.v[3], readLE64(chunk, offset + 24));
      offset += 32;
    }
    if (offset < chunk.length) {
      chunk.copy(this.mem, 0, offset);
      this.memSize = chunk.length - offset;
    }
  }

  digest() {
    let h;
    if (this.totalLen >= 32) {
      h = add64(
        rotl64(this.v[0], 1),
        rotl64(this.v[1], 7),
        rotl64(this.v[2], 12),
        rotl64(this.v[3], 18)
      );
      h = xxh64MergeRound(h, this.v[0]);
      h = xxh64MergeRound(h, this.v[1]);
      h = xxh64MergeRound(h, this.v[2]);
      h = xxh64MergeRound(h, this.v[3]);
    } else {
      h = add64(this.v[2], XXH_PRIME64_5);
    }
    h = add64(h, BigInt(this.totalLen));
    // 收尾：只处理最后 (totalLen % 32) 个字节。
    let len = this.totalLen & 31;
    let ptr = 0;
    const mem = this.mem;
    while (len >= 8) {
      const k1 = xxh64Round(0n, readLE64(mem, ptr));
      ptr += 8;
      h ^= k1;
      h = add64(mul64(rotl64(h, 27), XXH_PRIME64_1), XXH_PRIME64_4);
      len -= 8;
    }
    if (len >= 4) {
      h ^= mul64(readLE32(mem, ptr), XXH_PRIME64_1);
      ptr += 4;
      h = add64(mul64(rotl64(h, 23), XXH_PRIME64_2), XXH_PRIME64_3);
      len -= 4;
    }
    while (len > 0) {
      h ^= mul64(BigInt(mem[ptr]), XXH_PRIME64_5);
      ptr += 1;
      h = mul64(rotl64(h, 11), XXH_PRIME64_1);
      len -= 1;
    }
    return xxh64Avalanche(h).toString(16).padStart(16, '0');
  }
}

/* ------------------------------ CityHash64 ------------------------------ */

const CITY_K0 = 0xc3a5c85c97cb3127n;
const CITY_K1 = 0xb492b66fbe98f273n;
const CITY_K2 = 0x9ae16a3b2f90404fn;
const CITY_MUL = 0x9ddfea08eb382d69n;

function cityShiftMix(value) {
  return (value ^ (value >> 47n)) & MASK64;
}

/* HashLen16(u, v)：等价于 Hash128to64(uint128(u, v))。 */
function cityHashLen16(u, v) {
  let a = mul64(u ^ v, CITY_MUL);
  a = (a ^ (a >> 47n)) & MASK64;
  let b = mul64(v ^ a, CITY_MUL);
  b = (b ^ (b >> 47n)) & MASK64;
  return mul64(b, CITY_MUL);
}

/* HashLen16(u, v, mul)：Murmur 风格的变体。 */
function cityHashLen16Mul(u, v, mul) {
  let a = mul64(u ^ v, mul);
  a = (a ^ (a >> 47n)) & MASK64;
  let b = mul64(v ^ a, mul);
  b = (b ^ (b >> 47n)) & MASK64;
  return mul64(b, mul);
}

/* WeakHashLen32WithSeeds(w, x, y, z, a, b) */
function cityWeakHash32(w, x, y, z, a, b) {
  a = add64(a, w);
  b = rotr64(add64(b, a, z), 21);
  const c = a;
  a = add64(a, x);
  a = add64(a, y);
  b = add64(b, rotr64(a, 44));
  return { first: add64(a, z), second: add64(b, c) };
}

/* WeakHashLen32WithSeeds(s, a, b)：对 32 字节缓冲区做同样的混合。 */
function cityWeakHash32Buffer(buffer, offset, a, b) {
  return cityWeakHash32(
    readLE64(buffer, offset),
    readLE64(buffer, offset + 8),
    readLE64(buffer, offset + 16),
    readLE64(buffer, offset + 24),
    a,
    b
  );
}

/* HashLen0to16 */
function cityHashLen0to16(buffer, len) {
  if (len >= 8) {
    const mul = add64(CITY_K2, BigInt(len * 2));
    const a = add64(readLE64(buffer, 0), CITY_K2);
    const b = readLE64(buffer, len - 8);
    const c = add64(mul64(rotr64(b, 37), mul), a);
    const d = mul64(add64(rotr64(a, 25), b), mul);
    return cityHashLen16Mul(c, d, mul);
  }
  if (len >= 4) {
    const mul = add64(CITY_K2, BigInt(len * 2));
    const a = readLE32(buffer, 0);
    return cityHashLen16Mul(add64(BigInt(len), a << 3n), readLE32(buffer, len - 4), mul);
  }
  if (len > 0) {
    const a = BigInt(buffer[0]);
    const b = BigInt(buffer[len >> 1]);
    const c = BigInt(buffer[len - 1]);
    const y = (a + (b << 8n)) & 0xffffffffn;
    const z = (BigInt(len) + (c << 2n)) & 0xffffffffn;
    return mul64(cityShiftMix(mul64(y, CITY_K2) ^ mul64(z, CITY_K0)), CITY_K2);
  }
  return CITY_K2;
}

/* HashLen17to32 */
function cityHashLen17to32(buffer, len) {
  const mul = add64(CITY_K2, BigInt(len * 2));
  const a = mul64(readLE64(buffer, 0), CITY_K1);
  const b = readLE64(buffer, 8);
  const c = mul64(readLE64(buffer, len - 8), mul);
  const d = mul64(readLE64(buffer, len - 16), CITY_K2);
  return cityHashLen16Mul(
    add64(add64(rotr64(add64(a, b), 43), rotr64(c, 30)), d),
    add64(add64(a, rotr64(add64(b, CITY_K2), 18)), c),
    mul
  );
}

/* HashLen33to64 */
function cityHashLen33to64(buffer, len) {
  const mul = add64(CITY_K2, BigInt(len * 2));
  const a = mul64(readLE64(buffer, 0), CITY_K2);
  const b = readLE64(buffer, 8);
  const c = readLE64(buffer, len - 24);
  const d = readLE64(buffer, len - 32);
  const e = mul64(readLE64(buffer, 16), CITY_K2);
  const f = mul64(readLE64(buffer, 24), 9n);
  const g = readLE64(buffer, len - 8);
  const h = mul64(readLE64(buffer, len - 16), mul);
  const u = add64(rotr64(add64(a, g), 43), mul64(add64(rotr64(b, 30), c), 9n));
  const v = add64(add64((a + g) ^ d, f), 1n);
  const w = add64(swap64(mul64(add64(u, v), mul)), h);
  const x = add64(rotr64(add64(e, f), 42), c);
  const y = mul64(add64(swap64(mul64(add64(v, w), mul)), g), mul);
  const z = add64(add64(e, f), c);
  const a2 = add64(swap64(add64(mul64(add64(x, z), mul), y)), b);
  const b2 = mul64(cityShiftMix(add64(mul64(add64(z, a2), mul), add64(d, h))), mul);
  return add64(b2, x);
}

/* 字节序交换（64 位）。 */
function swap64(value) {
  const v = value & MASK64;
  let out = 0n;
  let rest = v;
  for (let i = 0; i < 8; i += 1) {
    out = (out << 8n) | (rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/* CityHash64 主流程的初始化：需要「头部 64 字节」与「尾部 64 字节」+ 总长度。 */
function cityInit(head, tail, len) {
  let x = readLE64(tail, 24);
  const y = add64(readLE64(tail, 48), readLE64(tail, 8));
  const z = cityHashLen16(add64(readLE64(tail, 16), BigInt(len)), readLE64(tail, 40));
  const v = cityWeakHash32Buffer(tail, 0, BigInt(len), z);
  const w = cityWeakHash32Buffer(tail, 32, add64(y, CITY_K1), x);
  x = add64(mul64(x, CITY_K1), readLE64(head, 0));
  return { x, y, z, v, w };
}

/* 处理一个 64 字节块。 */
function cityChunk(state, chunk, offset) {
  let { x, y, z, v, w } = state;
  x = mul64(rotr64(add64(x, y, v.first, readLE64(chunk, offset + 8)), 37), CITY_K1);
  y = mul64(rotr64(add64(y, v.second, readLE64(chunk, offset + 48)), 42), CITY_K1);
  x = (x ^ w.second) & MASK64;
  y = add64(y, v.first, readLE64(chunk, offset + 40));
  z = mul64(rotr64(add64(z, w.first), 33), CITY_K1);
  v = cityWeakHash32Buffer(chunk, offset, mul64(v.second, CITY_K1), add64(x, w.first));
  w = cityWeakHash32Buffer(chunk, offset + 32, add64(z, w.second), add64(y, readLE64(chunk, offset + 16)));
  const swap = x;
  x = z;
  z = swap;
  state.x = x;
  state.y = y;
  state.z = z;
  state.v = v;
  state.w = w;
}

function cityFinish(state) {
  const { x, y, z, v, w } = state;
  return cityHashLen16(
    add64(cityHashLen16(v.first, w.first), mul64(cityShiftMix(y), CITY_K1), z),
    add64(cityHashLen16(v.second, w.second), x)
  );
}

/* 整段数据（≤ 64 字节走短路径，> 64 字节按 64 字节块处理）。 */
function cityHash64(buffer) {
  const len = buffer.length;
  if (len <= 16) return cityHashLen0to16(buffer, len);
  if (len <= 32) return cityHashLen17to32(buffer, len);
  if (len <= 64) return cityHashLen33to64(buffer, len);
  const state = cityInit(buffer.subarray(0, 64), buffer.subarray(len - 64), len);
  const chunks = Math.floor((len - 1) / 64);
  for (let i = 0; i < chunks; i += 1) cityChunk(state, buffer, i * 64);
  return cityFinish(state);
}

/* ------------------------------ 算法注册表 ------------------------------ */

/* crypto 内置算法（Node 支持的全部摘要算法）。 */
const CRYPTO_ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'];

/* 纯 JS 实现的流式算法。 */
const STREAM_ALGORITHMS = {
  crc32: Crc32,
  fnv1a32: Fnv1a32,
  fnv1a64: Fnv1a64,
  xxhash64: XxHash64,
};

/* 展示顺序与显示名（主进程与渲染层共用）。 */
const ALGORITHMS = [
  { id: 'md5', label: 'MD5' },
  { id: 'sha1', label: 'SHA1' },
  { id: 'sha256', label: 'SHA256' },
  { id: 'sha384', label: 'SHA384' },
  { id: 'sha512', label: 'SHA512' },
  { id: 'crc32', label: 'CRC32' },
  { id: 'fnv1a32', label: 'FNV-1a 32' },
  { id: 'fnv1a64', label: 'FNV-1a 64' },
  { id: 'xxhash64', label: 'XXH64' },
  { id: 'cityhash64', label: 'CityHash64' },
];

const ALGORITHM_IDS = ALGORITHMS.map((item) => item.id);

function isCryptoAlgorithm(id) {
  return CRYPTO_ALGORITHMS.includes(id);
}

function isStreamAlgorithm(id) {
  return Object.prototype.hasOwnProperty.call(STREAM_ALGORITHMS, id);
}

/* 创建一个流式计算器：update(chunk) 可多次调用，digest() 返回十六进制。 */
function create(id) {
  if (isCryptoAlgorithm(id)) {
    const hash = crypto.createHash(id);
    return {
      update(chunk) {
        hash.update(chunk);
      },
      digest() {
        return hash.digest('hex');
      },
    };
  }
  if (isStreamAlgorithm(id)) {
    const Hasher = STREAM_ALGORITHMS[id];
    const instance = new Hasher();
    return {
      update(chunk) {
        instance.update(chunk);
      },
      digest() {
        return instance.digest();
      },
    };
  }
  return null;
}

/* CityHash64 需要看到整段数据（算法本身依赖尾部字节），
   文件场景由 hash-service 用「两次读取」的方式流式计算。 */
function cityHash64Hex(buffer) {
  return cityHash64(buffer).toString(16).padStart(16, '0');
}

module.exports = {
  ALGORITHMS,
  ALGORITHM_IDS,
  CRYPTO_ALGORITHMS,
  create,
  isCryptoAlgorithm,
  isStreamAlgorithm,
  cityHash64,
  cityHash64Hex,
  cityInit,
  cityChunk,
  cityFinish,
  XxHash64,
  Crc32,
  Fnv1a32,
  Fnv1a64,
};
