'use strict';

/* DNS 查询（主进程）：用 Node 内置 dns.promises 解析记录，
   渲染层「IP / 网段与掩码」工具里的「DNS 查询」分区调用。 */

const dns = require('dns').promises;
const net = require('net');
const { IPC } = require('../../shared/constants');
const logger = require('../utils/logger');

/* 支持的记录类型 → 解析函数。 */
const RESOLVERS = {
  a: (host) => dns.resolve4(host),
  aaaa: (host) => dns.resolve6(host),
  mx: (host) =>
    dns.resolveMx(host).then((list) => list.map((item) => `${item.priority} ${item.exchange}`)),
  txt: (host) => dns.resolveTxt(host).then((list) => list.map((chunks) => chunks.join(''))),
  cname: (host) => dns.resolveCname(host).then((value) => [value]),
  ns: (host) => dns.resolveNs(host).then((list) => list.map((item) => item.value)),
  soa: (host) =>
    dns.resolveSoa(host).then((item) => [
      `${item.ns} ${item.hostmaster} ${item.serial} ${item.refresh} ${item.retry} ${item.expire} ${item.minttl}`,
    ]),
  ptr: (host) => dns.reverse(host),
};

/* 反向查询（PTR）：输入是 IP 地址时用。 */
const PTR_TYPES = new Set(['ptr']);

function isIpAddress(value) {
  const text = String(value || '').trim();
  if (net.isIPv4(text)) return true;
  // IPv6：去掉 zone id 后再判断
  return net.isIPv6(text.split('%')[0]);
}

function normalizeType(type, host) {
  const value = String(type || '').trim().toLowerCase();
  if (value && RESOLVERS[value]) return value;
  // 未指定类型：输入是 IP 就做反向查询，否则查 A / AAAA。
  if (isIpAddress(host)) return 'ptr';
  return 'a';
}

async function lookup(host, type) {
  const name = String(host || '').trim();
  if (!name) return { ok: false, error: 'host required' };
  const kind = normalizeType(type, name);
  const resolver = RESOLVERS[kind];
  if (!resolver) return { ok: false, error: `unsupported type: ${kind}` };
  try {
    const records = await resolver(name);
    return { ok: true, type: kind, host: name, records: Array.isArray(records) ? records : [records] };
  } catch (err) {
    return { ok: false, type: kind, host: name, error: err.message || String(err) };
  }
}

function registerDnsIpc(ipcMain) {
  ipcMain.handle(IPC.DNS_LOOKUP, async (_event, payload) => {
    const host = payload && payload.host;
    const type = payload && payload.type;
    const result = await lookup(host, type);
    if (!result.ok) logger.file(`[dns] lookup failed: ${result.error}`);
    return result;
  });
}

module.exports = { registerDnsIpc, lookup, isIpAddress, RESOLVERS };
