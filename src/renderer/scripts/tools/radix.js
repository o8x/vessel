'use strict';

(function registerUnitsTool() {
  const { el, section, inputField } = window.ShipsUI;
  const i18n = window.ShipsI18n;

  i18n.extend({
    zh: {
      radix: {
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

  // 换算基准：字节。Kbps / Mbps / Gbps 按 1 位 = 1/8 字节（十进制 1000 进位）换算。
  const UNITS = [
    { key: 'byte', factor: 1, labelKey: 'radix.unitByte', placeholder: '1024' },
    { key: 'bit', factor: 1 / 8, labelKey: 'radix.unitBit', placeholder: '8192' },
    { key: 'kib', factor: 1024, labelKey: 'radix.unitKib', placeholder: '1' },
    { key: 'mib', factor: 1024 ** 2, labelKey: 'radix.unitMib', placeholder: '1' },
    { key: 'gib', factor: 1024 ** 3, labelKey: 'radix.unitGib', placeholder: '1' },
    { key: 'tib', factor: 1024 ** 4, labelKey: 'radix.unitTib', placeholder: '1' },
    { key: 'kbps', factor: 1000 / 8, labelKey: 'radix.unitKbps', placeholder: '8' },
    { key: 'mbps', factor: 1000 ** 2 / 8, labelKey: 'radix.unitMbps', placeholder: '8' },
    { key: 'gbps', factor: 1000 ** 3 / 8, labelKey: 'radix.unitGbps', placeholder: '8' },
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

  function mount(container) {
    const rowsSection = section();
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
      row.meta.textContent = invalid ? i18n.t('radix.invalid') : '';
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

    container.append(rowsSection);
    container.insertBefore(
      el('div', { class: 'text-[12px] text-fg-muted' }, i18n.t('radix.hint')),
      rowsSection
    );

    return () => {
      state.editing = null;
    };
  }

  window.ShipsToolRegistry.register({ id: 'radix', icon: 'swap', mount });
})();
