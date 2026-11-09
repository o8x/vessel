'use strict';

const os = require('os');
const http = require('http');
const https = require('https');
const proxyService = require('./proxy-service');
const logger = require('../utils/logger');

// 公网出口地址查询服务，按地址族分别请求（v4 走 IPv4、v6 走 IPv6）。
const PUBLIC_IP_URLS = {
  public4: ['https://ipv4.icanhazip.com', 'https://ifconfig.me/ip'],
  public6: ['https://ipv6.icanhazip.com', 'https://ifconfig.me/ip'],
};
const REQUEST_TIMEOUT_MS = 5000;

/* 私有网段（RFC 1918）。 */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function localEntries(family) {
  const interfaces = os.networkInterfaces();
  const list = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== family || entry.internal || !entry.address) continue;
      list.push(entry.address);
    }
  }
  return list;
}

/* 内网（局域网）地址：v4 优先私有网段；v6 去掉作用域后缀并优先非链路本地。 */
function lanAddress(kind) {
  if (kind === 'lan6') {
    const list = localEntries('IPv6').map((ip) => ip.replace(/%.+$/, ''));
    if (list.length === 0) return null;
    const preferred = list.find((ip) => !/^fe80:/i.test(ip));
    return preferred || list[0];
  }
  const list = localEntries('IPv4');
  if (list.length === 0) return null;
  return list.find(isPrivateIPv4) || list[0];
}

async function requestText(url, family) {
  const parsed = new URL(url);
  const mod = parsed.protocol === 'http:' ? http : https;
  let agent = null;
  try {
    agent = await proxyService.agentForUrl(parsed);
  } catch (err) {
    agent = null;
  }
  return new Promise((resolve, reject) => {
    const options = { headers: { 'User-Agent': 'Vessel', Accept: 'text/plain' }, family };
    if (agent) options.agent = agent;
    const req = mod.get(parsed, options, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
  });
}

/* 公网出口地址：依次请求对应地址族的服务，任一成功即返回。 */
async function publicAddress(kind) {
  const family = kind === 'public6' ? 6 : 4;
  const urls = PUBLIC_IP_URLS[kind] || [];
  for (const url of urls) {
    try {
      const text = await requestText(url, family);
      const first = text.split(/\s+/)[0];
      if (first) return first;
    } catch (err) {
      logger.file(`[local-address] public address lookup failed (${url}): ${err.message}`);
    }
  }
  return null;
}

async function getAddress(kind) {
  if (kind === 'public4' || kind === 'public6') return publicAddress(kind);
  if (kind === 'lan4' || kind === 'lan6') return lanAddress(kind);
  return null;
}

module.exports = { getAddress, lanAddress, publicAddress };
