'use strict';

(function registerSubnetTool() {
  const { Icons, el, section, field, resultRow, createGeoRow } = window.ShipsUI;
  const i18n = window.ShipsI18n;

  i18n.extend({
    zh: {
      subnet: {
        input: 'IP / 网段 / 掩码',
        placeholder: '如 192.168.1.10/24、192.168.1.0 255.255.255.0、2001:db8::/32 或 3232235777',
        defaultMask: '未指定掩码，默认按 /24 计算',
        baseTitle: 'IP 进制',
        decimal: '十进制',
        hex: '十六进制',
        binary: '二进制',
        network: '网络地址',
        broadcast: '广播地址',
        lastAddr: '最后一个地址',
        netmask: '子网掩码',
        wildcard: '反掩码（通配符）',
        range: '可用地址范围',
        hosts: '可用主机数',
        totalAddrs: '地址总数',
        prefix: '网络前缀',
        binaryMask: '掩码二进制',
        scope: '地址类型',
        cidr: 'CIDR',
        expandFull: 'IPv6 展开',
        compress: 'IPv6 压缩',
        splitLabel: '子网数量',
        splitPlaceholder: '输入 2 的幂，如 4、8、16',
        splitNewPrefix: '新前缀',
        splitSize: '子网大小',
        splitList: '子网列表',
        splitError: '需为大于 0 的 2 的幂，且不超过当前前缀可划分的子网数',
        splitMore: '仅显示前 8 个',
        kindIpv4: '识别为 IPv4',
        kindIpv6: '识别为 IPv6',
        kindNumber: '识别为数字',
        kindHex: '识别为十六进制数字',
        errorIp: 'IP 地址无效',
        errorMask: '掩码无效',
        empty: '输入 IP / 网段 / 掩码，实时计算',
        scopePrivate: '私有地址',
        scopePublic: '公网地址',
        scopeLoopback: '环回地址',
        scopeLinkLocal: '链路本地',
        scopeCgnat: '运营商级 NAT',
        scopeUnspecified: '未指定地址',
        scopeMapped: 'IPv4 映射地址',
        scopeMulticast: '多播地址',
        geo: '归属地',
        none: '无',
        geoOpen: '在浏览器中打开 {site}',
      },
    },
    en: {
      subnet: {
        input: 'IP / subnet / mask',
        placeholder: 'e.g. 192.168.1.10/24, 192.168.1.0 255.255.255.0, 2001:db8::/32 or 3232235777',
        defaultMask: 'No mask given, using /24',
        baseTitle: 'IP bases',
        decimal: 'Decimal',
        hex: 'Hex',
        binary: 'Binary',
        network: 'Network',
        broadcast: 'Broadcast',
        lastAddr: 'Last address',
        netmask: 'Netmask',
        wildcard: 'Wildcard',
        range: 'Usable range',
        hosts: 'Usable hosts',
        totalAddrs: 'Total addresses',
        prefix: 'Prefix',
        binaryMask: 'Netmask binary',
        scope: 'Scope',
        cidr: 'CIDR',
        expandFull: 'IPv6 expanded',
        compress: 'IPv6 compressed',
        splitLabel: 'Subnet count',
        splitPlaceholder: 'Power of 2, e.g. 4, 8, 16',
        splitNewPrefix: 'New prefix',
        splitSize: 'Subnet size',
        splitList: 'Subnet list',
        splitError: 'Must be a power of 2 greater than 0 and not exceed divisible subnets of the current prefix',
        splitMore: 'Showing first 8 only',
        kindIpv4: 'Detected IPv4',
        kindIpv6: 'Detected IPv6',
        kindNumber: 'Detected number',
        kindHex: 'Detected hex number',
        errorIp: 'Invalid IP address',
        errorMask: 'Invalid mask',
        empty: 'Enter IP / subnet / mask to compute live',
        scopePrivate: 'Private',
        scopePublic: 'Public',
        scopeLoopback: 'Loopback',
        scopeLinkLocal: 'Link-local',
        scopeCgnat: 'CGNAT',
        scopeUnspecified: 'Unspecified',
        scopeMapped: 'IPv4-mapped',
        scopeMulticast: 'Multicast',
        geo: 'Location',
        none: 'None',
        geoOpen: 'Open {site} in the browser',
      },
    },
  });

  const DEFAULT_PREFIX = 24;
  const SPLIT_LIST_MAX = 8;

  function ipToInt(text) {
    const parts = String(text).trim().split('.');
    if (parts.length !== 4) return null;
    let value = 0;
    for (const part of parts) {
      if (!/^\d{1,3}$/.test(part)) return null;
      const num = Number(part);
      if (num > 255) return null;
      value = (value * 256 + num) >>> 0;
    }
    return value >>> 0;
  }

  function intToIp(value) {
    const v = value >>> 0;
    return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.');
  }

  function maskFromPrefix(prefix) {
    return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  }

  function prefixFromMask(mask) {
    const binary = (mask >>> 0).toString(2).padStart(32, '0');
    if (!/^1*0*$/.test(binary)) return null;
    const firstZero = binary.indexOf('0');
    return firstZero === -1 ? 32 : firstZero;
  }

  function binaryIPv4(value) {
    return [24, 16, 8, 0].map((shift) => ((value >>> shift) & 255).toString(2).padStart(8, '0')).join('.');
  }

  function binaryMask(mask) {
    return (mask >>> 0).toString(2).padStart(32, '0').match(/.{8}/g).join('.');
  }

  function toHex(value) {
    return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  }

  function scopeOf(value) {
    const inRange = (base, prefix) => {
      const mask = maskFromPrefix(prefix);
      return ((value & mask) >>> 0) === ((base & mask) >>> 0);
    };
    if (inRange(ipToInt('127.0.0.0'), 8)) return 'scopeLoopback';
    if (inRange(ipToInt('10.0.0.0'), 8)) return 'scopePrivate';
    if (inRange(ipToInt('172.16.0.0'), 12)) return 'scopePrivate';
    if (inRange(ipToInt('192.168.0.0'), 16)) return 'scopePrivate';
    if (inRange(ipToInt('169.254.0.0'), 16)) return 'scopeLinkLocal';
    if (inRange(ipToInt('100.64.0.0'), 10)) return 'scopeCgnat';
    return 'scopePublic';
  }

  const U128_MAX = (1n << 128n) - 1n;

  function groupsOf6(value) {
    const groups = [];
    for (let i = 7; i >= 0; i--) groups.push(((value >> BigInt(16 * i)) & 0xffffn).toString(16));
    return groups;
  }

  function formatIPv6(value, compress) {
    const groups = groupsOf6(value);
    if (!compress) return groups.map((group) => group.padStart(4, '0')).join(':');
    let bestStart = -1;
    let bestLen = 0;
    let curStart = -1;
    let curLen = 0;
    groups.forEach((group, index) => {
      if (group === '0') {
        if (curStart < 0) {
          curStart = index;
          curLen = 1;
        } else {
          curLen += 1;
        }
        if (curLen > bestLen) {
          bestLen = curLen;
          bestStart = curStart;
        }
      } else {
        curStart = -1;
        curLen = 0;
      }
    });
    if (bestLen < 2) return groups.join(':');
    return `${groups.slice(0, bestStart).join(':')}::${groups.slice(bestStart + bestLen).join(':')}`;
  }

  function parseIPv6(text) {
    let source = text.trim().toLowerCase();
    if (!source.includes(':')) return null;

    const lastColon = source.lastIndexOf(':');
    const tail = source.slice(lastColon + 1);
    if (tail.includes('.')) {
      const v4 = ipToInt(tail);
      if (v4 == null) return null;
      const high = ((v4 >>> 16) & 0xffff).toString(16);
      const low = (v4 & 0xffff).toString(16);
      source = `${source.slice(0, lastColon + 1)}${high}:${low}`;
    }

    const halves = source.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
    const all = head.concat(rest);
    if (all.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;

    let groups;
    if (halves.length === 2) {
      const missing = 8 - all.length;
      if (missing < 0) return null;
      groups = head.concat(new Array(missing).fill('0'), rest);
    } else {
      if (all.length !== 8) return null;
      groups = all;
    }

    let value = 0n;
    for (const group of groups) value = (value << 16n) + BigInt(parseInt(group || '0', 16));
    return value;
  }

  function scopeOf6(value) {
    const inRange6 = (base, prefix) => {
      const mask = (U128_MAX << BigInt(128 - prefix)) & U128_MAX;
      return (value & mask) === base;
    };
    if (value === 1n) return 'scopeLoopback';
    if (value === 0n) return 'scopeUnspecified';
    if (inRange6(0xffffn << 32n, 96)) return 'scopeMapped';
    if (inRange6(0xfe80n << 112n, 10)) return 'scopeLinkLocal';
    if (inRange6(0xfc00n << 112n, 7)) return 'scopePrivate';
    if (inRange6(0xff00n << 112n, 8)) return 'scopeMulticast';
    return 'scopePublic';
  }

  function mask6FromPrefix(prefix) {
    return prefix === 0 ? 0n : (U128_MAX << BigInt(128 - prefix)) & U128_MAX;
  }

  function binaryMask6(mask) {
    const bits = mask.toString(2).padStart(128, '0');
    return bits.match(/.{16}/g).join(':');
  }

  function formatBigCount(value) {
    const power = value.toString(2).length - 1;
    if ((1n << BigInt(power)) === value && power >= 40) return `2^${power}`;
    return value.toLocaleString();
  }

  function parseInput(raw) {
    const text = (raw || '').trim();
    if (!text) return { empty: true };

    let ipPart = text;
    let maskPart = null;
    if (text.includes('/')) {
      const halves = text.split('/');
      ipPart = halves[0].trim();
      maskPart = halves.slice(1).join('/').trim();
    } else {
      const parts = text.split(/\s+/);
      if (parts.length === 2) {
        ipPart = parts[0];
        maskPart = parts[1];
      }
    }

    if (ipPart.includes(':')) {
      const value = parseIPv6(ipPart);
      if (value == null) return { error: 'errorIp' };
      let prefix = 128;
      const defaulted = maskPart == null || maskPart === '';
      if (maskPart) {
        if (!/^\d{1,3}$/.test(maskPart)) return { error: 'errorMask' };
        prefix = Number(maskPart);
        if (prefix < 0 || prefix > 128) return { error: 'errorMask' };
      }
      return { mode: 'ipv6', value, prefix, defaulted, kind: 'kindIpv6' };
    }

    let ip;
    let kind = 'kindIpv4';
    if (ipPart.includes('.')) {
      ip = ipToInt(ipPart);
    } else if (/^0x[0-9a-f]+$/i.test(ipPart)) {
      const big = BigInt(ipPart);
      kind = 'kindHex';
      ip = big <= 0xffffffffn ? Number(big) : null;
    } else if (/^\d+$/.test(ipPart)) {
      const big = BigInt(ipPart);
      kind = 'kindNumber';
      ip = big <= 0xffffffffn ? Number(big) : null;
    } else {
      ip = null;
    }
    if (ip == null) return { error: 'errorIp' };

    let prefix = DEFAULT_PREFIX;
    let defaulted = maskPart == null || maskPart === '';
    if (maskPart) {
      if (/^\d{1,2}$/.test(maskPart)) {
        prefix = Number(maskPart);
      } else if (maskPart.includes('.')) {
        const maskInt = ipToInt(maskPart);
        if (maskInt == null) return { error: 'errorMask' };
        const derived = prefixFromMask(maskInt);
        if (derived == null) return { error: 'errorMask' };
        prefix = derived;
      } else {
        return { error: 'errorMask' };
      }
    }
    if (prefix < 0 || prefix > 32) return { error: 'errorMask' };

    return { mode: 'ipv4', ip, prefix, defaulted, kind };
  }

  function computeSplit(parsed, countText) {
    const text = (countText || '').trim();
    if (!text) return { empty: true };
    if (!/^\d+$/.test(text)) return { error: true };
    const count = BigInt(text);
    if (count <= 0n || (count & (count - 1n)) !== 0n) return { error: true };
    const maxPrefix = parsed.mode === 'ipv6' ? 128 : 32;
    const bits = count.toString(2).length - 1;
    const newPrefix = parsed.prefix + bits;
    if (newPrefix > maxPrefix) return { error: true };

    const size = 1n << BigInt(maxPrefix - newPrefix);
    const base = parsed.mode === 'ipv6' ? parsed.value : BigInt(parsed.ip);
    const topMask = (U128_MAX << BigInt(maxPrefix - parsed.prefix)) & U128_MAX;
    const network = base & topMask;

    const list = [];
    const total = count < BigInt(SPLIT_LIST_MAX) ? Number(count) : SPLIT_LIST_MAX;
    for (let i = 0; i < total; i++) {
      const start = network + BigInt(i) * size;
      const formatted = parsed.mode === 'ipv6' ? formatIPv6(start, true) : intToIp(Number(start));
      list.push(`${formatted}/${newPrefix}`);
    }
    return { newPrefix, size, list, more: count > BigInt(SPLIT_LIST_MAX) };
  }

  function mount(container) {
    const inputSection = section();
    const input = field(null, { placeholder: i18n.t('subnet.placeholder'), spellcheck: 'false' }).input;
    inputSection.appendChild(input);
    const hint = el('div', { class: 'text-[11px] text-fg-muted' }, i18n.t('subnet.empty'));
    inputSection.appendChild(hint);

    const baseRows = {
      decimal: resultRow(i18n.t('subnet.decimal')),
      hex: resultRow(i18n.t('subnet.hex')),
      binary: resultRow(i18n.t('subnet.binary')),
    };
    const baseSection = section();
    for (const key of Object.keys(baseRows)) baseSection.appendChild(baseRows[key].root);

    const v6FormRows = {
      expandFull: resultRow(i18n.t('subnet.expandFull')),
      compress: resultRow(i18n.t('subnet.compress')),
    };
    const v6FormSection = section();
    for (const key of Object.keys(v6FormRows)) v6FormSection.appendChild(v6FormRows[key].root);

    const rows = {
      network: resultRow(i18n.t('subnet.network')),
      broadcast: resultRow(i18n.t('subnet.broadcast')),
      range: resultRow(i18n.t('subnet.range')),
      hosts: resultRow(i18n.t('subnet.hosts')),
      netmask: resultRow(i18n.t('subnet.netmask')),
      wildcard: resultRow(i18n.t('subnet.wildcard')),
      prefix: resultRow(i18n.t('subnet.prefix')),
      binaryMask: resultRow(i18n.t('subnet.binaryMask')),
      scope: resultRow(i18n.t('subnet.scope')),
    };
    const calcSection = section();
    for (const key of Object.keys(rows)) calcSection.appendChild(rows[key].root);

    const rows6 = {
      network: resultRow(i18n.t('subnet.network')),
      lastAddr: resultRow(i18n.t('subnet.lastAddr')),
      range: resultRow(i18n.t('subnet.range')),
      totalAddrs: resultRow(i18n.t('subnet.totalAddrs')),
      netmask: resultRow(i18n.t('subnet.netmask')),
      wildcard: resultRow(i18n.t('subnet.wildcard')),
      prefix: resultRow(i18n.t('subnet.prefix')),
      binaryMask: resultRow(i18n.t('subnet.binaryMask')),
      scope: resultRow(i18n.t('subnet.scope')),
    };
    const calc6Section = section();
    for (const key of Object.keys(rows6)) calc6Section.appendChild(rows6[key].root);

    const splitSection = section();
    const splitField = field(i18n.t('subnet.splitLabel'), {
      placeholder: i18n.t('subnet.splitPlaceholder'),
      spellcheck: 'false',
    });
    splitSection.appendChild(splitField.wrapper);
    const splitRows = {
      newPrefix: resultRow(i18n.t('subnet.splitNewPrefix')),
      size: resultRow(i18n.t('subnet.splitSize')),
      list: resultRow(i18n.t('subnet.splitList'), { mono: false }),
    };
    for (const key of Object.keys(splitRows)) splitSection.appendChild(splitRows[key].root);
    const splitHint = el('div', { class: 'text-[11px] text-fg-muted' });
    splitSection.appendChild(splitHint);

    const geoSection = section();
    const geoRow = createGeoRow();
    geoSection.appendChild(geoRow.root);

    // Two public lookup sites, opened in the browser with the current address.
    const GEO_LINKS = [
      { icon: 'globe', site: 'ipgeolocation.io', base: 'https://ipgeolocation.io/what-is-my-ip/' },
      { icon: 'external', site: 'iplocation.io', base: 'https://iplocation.io/ip/' },
    ];
    let geoIp = '';
    const geoLinkButtons = GEO_LINKS.map((link) => {
      const button = el('button', {
        class: 'icon-btn h-6 w-6 shrink-0',
        type: 'button',
        'data-tip': i18n.t('subnet.geoOpen', { site: link.site }),
      });
      button.innerHTML = (Icons[link.icon] || Icons.external)(14);
      button.disabled = true;
      button.addEventListener('click', async () => {
        if (!geoIp) return;
        const result = await window.ships.openExternal(`${link.base}${geoIp}`);
        if (result && result.ok === false) console.error('open failed:', result.error);
      });
      geoRow.root.appendChild(button);
      return button;
    });

    function setGeoLinks(ip) {
      geoIp = ip || '';
      for (const button of geoLinkButtons) button.disabled = !geoIp;
    }


    let geoToken = 0;
    function lookupGeo(ip) {
      const token = ++geoToken;
      setGeoLinks(ip);
      if (!ip || !window.ships.geoLookup) {
        geoRow.set(null);
        return;
      }
      window.ships.geoLookup(ip).then((info) => {
        if (token !== geoToken) return;
        geoRow.set(info);
      });
    }

    function clearAll() {
      for (const key of Object.keys(baseRows)) baseRows[key].set(null);
      for (const key of Object.keys(rows)) rows[key].set(null);
      for (const key of Object.keys(rows6)) rows6[key].set(null);
      for (const key of Object.keys(v6FormRows)) v6FormRows[key].set(null);
      clearSplit();
      geoToken += 1;
      setGeoLinks('');
      geoRow.set(null);
    }

    function clearSplit() {
      for (const key of Object.keys(splitRows)) splitRows[key].set(null);
      splitHint.textContent = '';
    }

    function setBase(value, hex, binary) {
      baseRows.decimal.set(value);
      baseRows.hex.set(hex);
      baseRows.binary.set(binary);
    }

    function updateSplit(parsed) {
      const result = computeSplit(parsed, splitField.input.value);
      if (result.empty || result.error) {
        clearSplit();
        if (result.error) {
          splitHint.textContent = i18n.t('subnet.splitError');
          splitHint.style.color = 'var(--color-danger)';
        }
        return;
      }
      splitHint.style.color = '';
      splitHint.textContent = result.more ? i18n.t('subnet.splitMore') : '';
      splitRows.newPrefix.set(`/${result.newPrefix}`);
      splitRows.size.set(
        parsed.mode === 'ipv6' && result.size >= (1n << 40n)
          ? `2^${result.size.toString(2).length - 1}`
          : result.size.toLocaleString()
      );
      splitRows.list.set(result.list.join('\n'));
    }

    function updateV6(parsed) {
      const { value, prefix } = parsed;
      const mask = mask6FromPrefix(prefix);
      const network = value & mask;
      const last = network | (~mask & U128_MAX);
      const total = 1n << BigInt(128 - prefix);

      v6FormSection.classList.remove('hidden');
      v6FormRows.expandFull.set(formatIPv6(value, false));
      v6FormRows.compress.set(formatIPv6(value, true));

      calc6Section.classList.remove('hidden');
      rows6.network.set(formatIPv6(network, true));
      rows6.lastAddr.set(formatIPv6(last, true));
      rows6.range.set(prefix >= 128 ? formatIPv6(network, true) : `${formatIPv6(network, true)} - ${formatIPv6(last, true)}`);
      rows6.totalAddrs.set(formatBigCount(total));
      rows6.netmask.set(formatIPv6(mask, true));
      rows6.wildcard.set(formatIPv6(~mask & U128_MAX, true));
      rows6.prefix.set(`/${prefix}  ·  ${formatIPv6(network, true)}/${prefix}`);
      rows6.binaryMask.set(binaryMask6(mask));
      rows6.scope.set(i18n.t(`subnet.${scopeOf6(value)}`));
    }

    function update() {
      const parsed = parseInput(input.value);
      if (parsed.empty) {
        hint.textContent = i18n.t('subnet.empty');
        hint.style.color = '';
        calcSection.classList.remove('hidden');
        geoSection.classList.remove('hidden');
        v6FormSection.classList.add('hidden');
        calc6Section.classList.add('hidden');
        clearAll();
        return;
      }
      if (parsed.error) {
        hint.textContent = i18n.t(`subnet.${parsed.error}`);
        hint.style.color = 'var(--color-danger)';
        calcSection.classList.remove('hidden');
        geoSection.classList.remove('hidden');
        v6FormSection.classList.add('hidden');
        calc6Section.classList.add('hidden');
        clearAll();
        return;
      }

      hint.style.color = '';

      if (parsed.mode === 'ipv6') {
        hint.textContent = i18n.t('subnet.kindIpv6');
        setBase(parsed.value.toString(), `0x${parsed.value.toString(16).toUpperCase()}`, parsed.value.toString(2).padStart(128, '0'));
        calcSection.classList.add('hidden');
        geoSection.classList.add('hidden');
        geoToken += 1;
        setGeoLinks('');
        geoRow.set(null);
        updateV6(parsed);
        updateSplit(parsed);
        return;
      }

      v6FormSection.classList.add('hidden');
      calc6Section.classList.add('hidden');
      calcSection.classList.remove('hidden');
      geoSection.classList.remove('hidden');
      hint.textContent = parsed.defaulted ? i18n.t('subnet.defaultMask') : i18n.t(`subnet.${parsed.kind}`);

      const { ip, prefix } = parsed;
      const mask = maskFromPrefix(prefix);
      const network = (ip & mask) >>> 0;
      const broadcast = (network | (~mask >>> 0)) >>> 0;

      setBase(String(ip), toHex(ip), binaryIPv4(ip));

      rows.network.set(intToIp(network));
      rows.broadcast.set(intToIp(broadcast));
      if (prefix >= 31) rows.range.set(intToIp(network));
      else rows.range.set(`${intToIp(network + 1)} - ${intToIp(broadcast - 1)}`);

      let hosts;
      if (prefix <= 30) hosts = Math.pow(2, 32 - prefix) - 2;
      else if (prefix === 31) hosts = 2;
      else hosts = 1;
      rows.hosts.set(hosts.toLocaleString());

      rows.netmask.set(intToIp(mask));
      rows.wildcard.set(intToIp(~mask >>> 0));
      rows.prefix.set(`/${prefix}  ·  ${intToIp(network)}/${prefix}`);
      rows.binaryMask.set(binaryMask(mask));
      rows.scope.set(i18n.t(`subnet.${scopeOf(ip)}`));

      lookupGeo(intToIp(ip));
      updateSplit(parsed);
    }

    input.addEventListener('input', update);
    input.addEventListener('blur', update);
    splitField.input.addEventListener('input', () => {
      const parsed = parseInput(input.value);
      if (parsed.empty || parsed.error) {
        clearSplit();
        return;
      }
      updateSplit(parsed);
    });

    container.append(inputSection, geoSection, baseSection, v6FormSection, calcSection, calc6Section, splitSection);
    update();
  }

  window.ShipsToolRegistry.register({ id: 'subnet', icon: 'layers', mount });
})();
