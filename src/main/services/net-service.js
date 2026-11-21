'use strict';

/* 网段计算（CLI 用）：把输入的 IP / 网段 / 掩码解析成结构化结果。
   与渲染层「IP / 网段与掩码」工具的计算保持一致（IPv4 用 32 位整数，IPv6 用 BigInt）。 */

const net = require('net');

const U128_MAX = (1n << 128n) - 1n;

function parseIPv4(text) {
  if (!net.isIPv4(String(text || ''))) return null;
  const parts = String(text).split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIPv4(value) {
  const v = Number(value) >>> 0;
  return [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff].join('.');
}

function maskFromPrefix(prefix) {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

function prefixFromMask(mask) {
  let value = mask >>> 0;
  let count = 0;
  while (value & 0x80000000) {
    count += 1;
    value = (value << 1) >>> 0;
  }
  return count;
}

function ipv4Scope(value) {
  const ip = value >>> 0;
  if (ip === 0) return 'unspecified';
  if ((ip & 0xff000000) >>> 0 === 0x7f000000) return 'loopback';
  if ((ip & 0xff000000) >>> 0 === 0x0a000000) return 'private';
  if ((ip & 0xfff00000) >>> 0 === 0xac100000) return 'private';
  if ((ip & 0xffff0000) >>> 0 === 0xc0a80000) return 'private';
  if ((ip & 0xffff0000) >>> 0 === 0xa9fe0000) return 'linkLocal';
  if ((ip & 0xffc00000) >>> 0 === 0x64400000) return 'cgnat';
  if ((ip & 0xf0000000) >>> 0 === 0xe0000000) return 'multicast';
  return 'public';
}

function parseIPv6(text) {
  let value = String(text || '').split('%')[0].trim();
  if (!net.isIPv6(value)) return null;
  // 内嵌 IPv4 尾部（如 ::ffff:1.2.3.4）先换成两个十六进制组
  if (value.includes('.')) {
    const index = value.lastIndexOf(':');
    const v4 = parseIPv4(value.slice(index + 1));
    if (v4 == null) return null;
    value = `${value.slice(0, index + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = value.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const missing = Math.max(0, 8 - head.length - tail.length);
  const groups = [...head, ...Array(missing).fill('0'), ...tail];
  let result = 0n;
  for (const group of groups) result = (result << 16n) | BigInt(parseInt(group || '0', 16));
  return result & U128_MAX;
}

function formatIPv6(value, compressed) {
  const groups = [];
  let rest = value & U128_MAX;
  for (let i = 0; i < 8; i += 1) {
    groups.unshift(Number(rest & 0xffffn));
    rest >>= 16n;
  }
  if (!compressed) {
    return groups.map((g) => g.toString(16).padStart(4, '0')).join(':');
  }
  // RFC 5952：合并最长的连续 0 段（长度 ≥ 2 才合并）
  let bestStart = -1;
  let bestLen = 0;
  let start = -1;
  for (let i = 0; i < 8; i += 1) {
    if (groups[i] === 0) {
      if (start < 0) start = i;
      const len = i - start + 1;
      if (len > bestLen) {
        bestLen = len;
        bestStart = start;
      }
    } else {
      start = -1;
    }
  }
  if (bestLen < 2) return groups.map((g) => g.toString(16)).join(':');
  const head = groups.slice(0, bestStart).map((g) => g.toString(16)).join(':');
  const tail = groups.slice(bestStart + bestLen).map((g) => g.toString(16)).join(':');
  return `${head}::${tail}`;
}

function mask6FromPrefix(prefix) {
  if (prefix <= 0) return 0n;
  if (prefix >= 128) return U128_MAX;
  return (U128_MAX << BigInt(128 - prefix)) & U128_MAX;
}

function ipv6Scope(value) {
  const v = value & U128_MAX;
  if (v === 0n) return 'unspecified';
  if (v === 1n) return 'loopback';
  if ((v >> 32n) === 0xffffn) return 'mapped';
  if ((v & 0xffc00000000000000000000000000000n) === 0xfe800000000000000000000000000000n) return 'linkLocal';
  if ((v & 0xfe000000000000000000000000000000n) === 0xfc000000000000000000000000000000n) return 'private';
  if ((v & 0xff000000000000000000000000000000n) === 0xff000000000000000000000000000000n) return 'multicast';
  return 'public';
}

/* 解析输入：IPv4 / IPv4/前缀 / IPv4 掩码 / 纯数字 / 0x 十六进制 / IPv6 / IPv6/前缀。 */
function parseInput(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return { empty: true };

  const withPrefix = /^([^/\s]+)\s*\/\s*(\d{1,3})$/.exec(text);
  const ipv4Mask = /^(\S+)\s+(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);

  if (withPrefix) {
    const host = withPrefix[1];
    const prefix = Number(withPrefix[2]);
    if (net.isIPv6(host.split('%')[0])) {
      if (prefix > 128) return { error: 'badPrefix' };
      const value = parseIPv6(host);
      return value == null ? { error: 'badIp' } : { kind: 'ipv6', value, prefix };
    }
    if (prefix > 32) return { error: 'badPrefix' };
    const value = parseIPv4(host);
    if (value == null) return { error: 'badIp' };
    return { kind: 'ipv4', value, prefix, defaulted: false };
  }

  if (ipv4Mask) {
    const value = parseIPv4(ipv4Mask[1]);
    const mask = parseIPv4(ipv4Mask[2]);
    if (value == null || mask == null) return { error: 'badIp' };
    return { kind: 'ipv4', value, prefix: prefixFromMask(mask), defaulted: false };
  }

  if (net.isIPv4(text)) {
    return { kind: 'ipv4', value: parseIPv4(text), prefix: 24, defaulted: true };
  }
  if (net.isIPv6(text)) {
    const value = parseIPv6(text);
    return value == null ? { error: 'badIp' } : { kind: 'ipv6', value, prefix: 128, defaulted: false };
  }
  if (/^\d+$/.test(text)) {
    const number = Number(text);
    if (!Number.isFinite(number) || number < 0 || number > 0xffffffff) return { error: 'badIp' };
    return { kind: 'ipv4', value: number >>> 0, prefix: 24, defaulted: true };
  }
  if (/^0x[0-9a-f]+$/i.test(text)) {
    const number = Number.parseInt(text.slice(2), 16);
    if (!Number.isFinite(number) || number < 0 || number > 0xffffffff) return { error: 'badIp' };
    return { kind: 'ipv4', value: number >>> 0, prefix: 24, defaulted: true };
  }
  return { error: 'badIp' };
}

/* 描述一个 IPv4 网段（与工具展示的字段一致）。 */
function describeIPv4(value, prefix) {
  const mask = maskFromPrefix(prefix);
  const network = (value & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  let hosts;
  if (prefix <= 30) hosts = Math.pow(2, 32 - prefix) - 2;
  else if (prefix === 31) hosts = 2;
  else hosts = 1;
  const first = prefix >= 31 ? network : (network + 1) >>> 0;
  const last = prefix >= 31 ? broadcast : (broadcast - 1) >>> 0;
  return {
    kind: 'ipv4',
    address: intToIPv4(value),
    prefix,
    cidr: `${intToIPv4(network)}/${prefix}`,
    network: intToIPv4(network),
    broadcast: intToIPv4(broadcast),
    range: prefix >= 31 ? intToIPv4(network) : `${intToIPv4(first)} - ${intToIPv4(last)}`,
    hosts,
    netmask: intToIPv4(mask),
    wildcard: intToIPv4(~mask >>> 0),
    scope: ipv4Scope(value),
  };
}

/* 描述一个 IPv6 网段。 */
function describeIPv6(value, prefix) {
  const mask = mask6FromPrefix(prefix);
  const network = value & mask;
  const last = (network | (~mask & U128_MAX)) & U128_MAX;
  const total = 1n << BigInt(128 - prefix);
  return {
    kind: 'ipv6',
    address: formatIPv6(value, true),
    prefix,
    cidr: `${formatIPv6(network, true)}/${prefix}`,
    network: formatIPv6(network, true),
    last: formatIPv6(last, true),
    total: total.toString(),
    netmask: formatIPv6(mask, true),
    wildcard: formatIPv6(~mask & U128_MAX, true),
    expanded: formatIPv6(value, false),
    compressed: formatIPv6(value, true),
    scope: ipv6Scope(value),
  };
}

function describe(raw) {
  const parsed = parseInput(raw);
  if (parsed.empty) return { ok: false, error: 'empty' };
  if (parsed.error) return { ok: false, error: parsed.error };
  const info =
    parsed.kind === 'ipv4'
      ? describeIPv4(parsed.value, parsed.prefix)
      : describeIPv6(parsed.value, parsed.prefix);
  return { ok: true, info, defaulted: Boolean(parsed.defaulted) };
}

module.exports = { describe, parseInput, describeIPv4, describeIPv6, ipv4Scope, ipv6Scope };
