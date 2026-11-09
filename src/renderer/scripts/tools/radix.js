'use strict';

(function registerRadixUnitsTool() {
  const { el, section, inputField } = window.ShipsUI;
  const i18n = window.ShipsI18n;

  i18n.extend({
    zh: {
      radix: {
        sectionRadix: '进制转换',
        sectionUnits: '单位转换',
        hint: '在任意一行输入，其余进制实时同步',
        bin: '二进制',
        oct: '八进制',
        dec: '十进制',
        hex: '十六进制',
        bits: '位宽',
        bytes: '字节',
        invalid: '该进制的输入无效',
        empty: '在任意进制输入数值，实时转换',
      },
      units: {
        hint: '在任意一行输入，其余单位实时同步（速率按 1 位 = 1/8 字节换算）',
        unitByte: '字节 (B)',
        unitBit: '位 (b)',
        unitKib: 'KiB',
        unitMib: 'MiB',
        unitGib: 'GiB',
        unitTib: 'TiB',
        unitKbps: 'Kbps',
        unitMbps: 'Mbps',
        unitGbps: 'Gbps',
        invalid: '请输入有效的数字',
      },
    },
    en: {
      radix: {
        sectionRadix: 'Radix',
        sectionUnits: 'Units',
        hint: 'Type in any row to sync all bases',
        bin: 'Binary',
        oct: 'Octal',
        dec: 'Decimal',
        hex: 'Hex',
        bits: 'Bit length',
        bytes: 'Bytes',
        invalid: 'Invalid input for this base',
        empty: 'Type a value in any base to convert live',
      },
      units: {
        hint: 'Type in any row to sync all units (rates use 1 bit = 1/8 byte)',
        unitByte: 'Bytes (B)',
        unitBit: 'Bits (b)',
        unitKib: 'KiB',
        unitMib: 'MiB',
        unitGib: 'GiB',
        unitTib: 'TiB',
        unitKbps: 'Kbps',
        unitMbps: 'Mbps',
        unitGbps: 'Gbps',
        invalid: 'Enter a valid number',
      },
    },
  });

  /* ---------- 进制转换 ---------- */

  const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

  function parseInBase(text, base) {
    const cleaned = String(text).trim().replace(/[\s_]/g, '');
    if (!cleaned) return null;
    const negative = cleaned.startsWith('-');
    const body = negative ? cleaned.slice(1) : cleaned;
    if (!body) return null;
    let value = 0n;
    const b = BigInt(base);
    for (const ch of body.toLowerCase()) {
      const digit = DIGITS.indexOf(ch);
      if (digit < 0 || digit >= base) return null;
      value = value * b + BigInt(digit);
    }
    return negative ? -value : value;
  }

  function formatInBase(value, base) {
    if (value === 0n) return '0';
    const negative = value < 0n;
    let v = negative ? -value : value;
    const b = BigInt(base);
    let out = '';
    while (v > 0n) {
      out = DIGITS[Number(v % b)] + out;
      v /= b;
    }
    if (base === 16) out = out.toUpperCase();
    return (negative ? '-' : '') + out;
  }

  function mountRadix(container) {
    const rows = [];
    const rowsSection = section();
    rowsSection.classList.add('radix-fields');

    function makeRow(labelText, base, placeholder) {
      const input = el('input', {
        class: 'field font-mono',
        type: 'text',
        spellcheck: 'false',
        autocomplete: 'off',
        placeholder: placeholder || '',
      });
      const wrapper = inputField(labelText, input);
      const meta = el('div', { class: 'mt-1 text-[10px] text-fg-muted' }, '');
      wrapper.appendChild(meta);
      rowsSection.appendChild(wrapper);
      const row = { base, input, meta, setError: null };
      input.addEventListener('input', () => onInput(row));
      input.addEventListener('blur', () => onInput(row));
      return row;
    }

    function setError(row, invalid) {
      row.input.style.borderColor = invalid ? 'var(--color-danger)' : '';
      row.meta.textContent = invalid ? i18n.t('radix.invalid') : '';
      row.meta.style.color = invalid ? 'var(--color-danger)' : '';
    }

    function onInput(source) {
      const text = source.input.value;
      if (!text.trim()) {
        setError(source, false);
        return;
      }
      const value = parseInBase(text, source.base);
      if (value == null) {
        setError(source, true);
        return;
      }
      setError(source, false);
      lastValue = value;
      for (const row of rows) {
        if (row === source) continue;
        row.input.value = formatInBase(value, row.base);
        setError(row, false);
      }
      updateMeta(value);
    }

    function updateMeta(value) {
      const abs = value < 0n ? -value : value;
      const bitLength = abs === 0n ? 1 : abs.toString(2).length;
      metaBits.set(String(Math.ceil(bitLength / 8) * 8));
      metaBytes.set(String(Math.ceil(bitLength / 8)));
    }

    let lastValue = null;

    const binRow = makeRow(i18n.t('radix.bin'), 2, '1010');
    const octRow = makeRow(i18n.t('radix.oct'), 8, '17');
    const decRow = makeRow(i18n.t('radix.dec'), 10, '255');
    const hexRow = makeRow(i18n.t('radix.hex'), 16, 'FF');
    rows.push(binRow, octRow, decRow, hexRow);

    const metaBits = resultField(i18n.t('radix.bits'));
    const metaBytes = resultField(i18n.t('radix.bytes'));

    const wrapper = section(i18n.t('radix.sectionRadix'));
    wrapper.append(
      el('div', { class: 'text-[12px] text-fg-muted' }, i18n.t('radix.hint')),
      rowsSection
    );
    container.append(wrapper);

    function resultField(labelText) {
      const value = el('div', { class: 'field font-mono' }, '—');
      const wrap = inputField(labelText, value);
      rowsSection.appendChild(wrap);
      return { root: wrap, set: (text) => (value.textContent = text) };
    }

    function resetErrors() {
      rows.forEach((row) => setError(row, false));
    }
    resetErrors();
  }

  /* ---------- 单位转换 ---------- */

  // 换算基准：字节。Kbps / Mbps / Gbps 按 1 位 = 1/8 字节（十进制 1000 进位）换算。
  const UNITS = [
    { key: 'byte', factor: 1, labelKey: 'units.unitByte', placeholder: '1024' },
    { key: 'bit', factor: 1 / 8, labelKey: 'units.unitBit', placeholder: '8192' },
    { key: 'kib', factor: 1024, labelKey: 'units.unitKib', placeholder: '1' },
    { key: 'mib', factor: 1024 ** 2, labelKey: 'units.unitMib', placeholder: '1' },
    { key: 'gib', factor: 1024 ** 3, labelKey: 'units.unitGib', placeholder: '1' },
    { key: 'tib', factor: 1024 ** 4, labelKey: 'units.unitTib', placeholder: '1' },
    { key: 'kbps', factor: 1000 / 8, labelKey: 'units.unitKbps', placeholder: '8' },
    { key: 'mbps', factor: 1000 ** 2 / 8, labelKey: 'units.unitMbps', placeholder: '8' },
    { key: 'gbps', factor: 1000 ** 3 / 8, labelKey: 'units.unitGbps', placeholder: '8' },
  ];

  function parseNumber(text) {
    const cleaned = String(text).trim().replace(/[\s,_]/g, '');
    if (!cleaned) return null;
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : NaN;
  }

  function formatValue(value) {
    if (!Number.isFinite(value)) return '';
    if (value === 0) return '0';
    const abs = Math.abs(value);
    if (abs >= 1e15 || abs < 1e-6) {
      return value.toExponential(6).replace(/\.?0+e/, 'e').replace(/e\+/, 'e');
    }
    return String(Number(value.toPrecision(12)));
  }

  function mountUnits(container) {
    const rowsSection = section();
    rowsSection.classList.add('radix-fields');
    const rows = [];

    for (const unit of UNITS) {
      const input = el('input', {
        class: 'field font-mono',
        type: 'text',
        inputmode: 'decimal',
        spellcheck: 'false',
        autocomplete: 'off',
        placeholder: unit.placeholder || '',
      });
      const wrapper = inputField(i18n.t(unit.labelKey), input);
      const meta = el('div', { class: 'mt-1 text-[10px] text-fg-muted' }, '');
      wrapper.appendChild(meta);
      rowsSection.appendChild(wrapper);
      const row = { unit, input, meta };
      rows.push(row);
      input.addEventListener('input', () => onInput(row));
      input.addEventListener('blur', () => onInput(row));
    }

    const state = { editing: null };

    function setError(row, invalid) {
      row.input.style.borderColor = invalid ? 'var(--color-danger)' : '';
      row.meta.textContent = invalid ? i18n.t('units.invalid') : '';
      row.meta.style.color = invalid ? 'var(--color-danger)' : '';
    }

    function clearOthers(source) {
      for (const row of rows) {
        if (row === source) continue;
        row.input.value = '';
        setError(row, false);
      }
    }

    function onInput(source) {
      const value = parseNumber(source.input.value);
      if (value == null) {
        setError(source, false);
        clearOthers(source);
        return;
      }
      if (Number.isNaN(value)) {
        setError(source, true);
        clearOthers(source);
        return;
      }
      setError(source, false);
      state.editing = source.unit.key;
      const bytes = value * source.unit.factor;
      for (const row of rows) {
        if (row === source) continue;
        row.input.value = formatValue(bytes / row.unit.factor);
        setError(row, false);
      }
    }

    const wrapper = section(i18n.t('radix.sectionUnits'));
    wrapper.append(
      el('div', { class: 'text-[12px] text-fg-muted' }, i18n.t('units.hint')),
      rowsSection
    );
    container.append(wrapper);

    return () => {
      state.editing = null;
    };
  }

  function mount(container) {
    mountRadix(container);
    return mountUnits(container);
  }

  window.ShipsToolRegistry.register({ id: 'radix', icon: 'hash', mount });
})();
