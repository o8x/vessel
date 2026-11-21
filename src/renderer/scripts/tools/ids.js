'use strict';

/* ID 与密码生成工具：UUID v4 / UUID v7 / ULID / 随机字符串 / 随机密码。
   全部逻辑在渲染层完成（无 IPC、无新依赖）；随机数一律取自系统密码学随机源
   crypto.getRandomValues，并用「拒绝采样」保证每个字符均匀分布（不使用 Math.random）。 */

(function registerIdsTool() {
  const { el, section, inputField, resultRow, createSelect, segmented, copyText, Icons } = window.ShipsUI;
  const i18n = window.ShipsI18n;

  i18n.extend({
    zh: {
      tools: { ids: 'ID 与密码' },
      toolDesc: { ids: '生成 UUID v4 / v7、ULID、随机字符串与随机密码，并管理 2FA 动态验证码' },
      ids: {
        type: '生成类型',
        twofaSection: '2FA 验证码',
        twofaHint: '粘贴 otpauth:// 链接或 Base32 密钥即可添加，验证码每 30 秒自动刷新。',
        typeUuid4: 'UUID v4',
        typeUuid7: 'UUID v7',
        typeUlid: 'ULID',
        typeRandom: '随机字符串',
        typePassword: '密码',
        hint: '随机数来自系统密码学随机源（CSPRNG），可用于密钥、令牌与密码。',
        options: '生成选项',
        count: '数量',
        countHint: '一次生成 1 - 100 个',
        length: '长度',
        lengthHintRandom: '4 - 64 位',
        lengthHintPassword: '8 - 64 位',
        alphabet: '字符集',
        alphabetLower: '小写字母',
        alphabetUpper: '大写字母',
        alphabetAlnum: '字母 + 数字',
        alphabetDigits: '数字',
        alphabetHex: '十六进制',
        classes: '密码字符类型',
        classLower: '小写字母',
        classUpper: '大写字母',
        classDigits: '数字',
        classSymbols: '符号',
        excludeAmbiguous: '排除易混淆字符',
        excludeAmbiguousHint: '去掉 I l 1 O 0',
        result: '生成结果',
        item: '第 {n} 个',
        copyAll: '复制全部',
        copied: '已复制',
        copyFailed: '复制失败',
        regenerate: '重新生成',
        empty: '暂无结果',
        strength: '强度',
        strengthWeak: '弱',
        strengthMedium: '中',
        strengthStrong: '强',
      },
    },
    en: {
      tools: { ids: 'IDs & passwords' },
      toolDesc: { ids: 'Generate UUID v4 / v7, ULID, random strings and passwords, plus 2FA codes' },
      ids: {
        type: 'Generator',
        twofaSection: '2FA codes',
        twofaHint: 'Paste an otpauth:// link or Base32 secret to add an account; codes refresh every 30 seconds.',
        typeUuid4: 'UUID v4',
        typeUuid7: 'UUID v7',
        typeUlid: 'ULID',
        typeRandom: 'Random string',
        typePassword: 'Password',
        hint: 'Randomness comes from the system CSPRNG; safe for keys, tokens and passwords.',
        options: 'Options',
        count: 'Count',
        countHint: 'Generate 1 - 100 at a time',
        length: 'Length',
        lengthHintRandom: '4 - 64 chars',
        lengthHintPassword: '8 - 64 chars',
        alphabet: 'Alphabet',
        alphabetLower: 'Lowercase letters',
        alphabetUpper: 'Uppercase letters',
        alphabetAlnum: 'Letters + digits',
        alphabetDigits: 'Digits',
        alphabetHex: 'Hexadecimal',
        classes: 'Character classes',
        classLower: 'Lowercase',
        classUpper: 'Uppercase',
        classDigits: 'Digits',
        classSymbols: 'Symbols',
        excludeAmbiguous: 'Exclude look-alikes',
        excludeAmbiguousHint: 'Drops I l 1 O 0',
        result: 'Results',
        item: 'No. {n}',
        copyAll: 'Copy all',
        copied: 'Copied',
        copyFailed: 'Copy failed',
        regenerate: 'Regenerate',
        empty: 'Nothing generated yet',
        strength: 'Strength',
        strengthWeak: 'Weak',
        strengthMedium: 'Medium',
        strengthStrong: 'Strong',
      },
    },
  });

  /* ===================== 纯逻辑区（可独立测试） ===================== */
  /* 说明：本区不依赖 DOM / i18n，可被离线脚本整段抽出跑断言。 */

  const IDGEN = {
    /* 字符集 */
    ALPHABETS: {
      lower: 'abcdefghijklmnopqrstuvwxyz',
      upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      alnum: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      digits: '0123456789',
      hex: '0123456789abcdef',
    },
    /* 密码的字符类别（符号不含引号 / 反斜杠，便于复制粘贴） */
    PASSWORD_CLASSES: {
      lower: 'abcdefghijklmnopqrstuvwxyz',
      upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      digits: '0123456789',
      symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?/~',
    },
    /* 易混淆字符（排除用） */
    AMBIGUOUS: 'Il1O0',
    /* Crockford base32（不含 I / L / O / U） */
    CROCKFORD: '0123456789ABCDEFGHJKMNPQRSTVWXYZ',
    /* ULID 随机部分上限：80 位 */
    ULID_MAX_RANDOM: (1n << 80n) - 1n,
    /* 单调 ULID 状态：同一毫秒内随机部分自增，保证「字符串顺序 = 生成顺序」 */
    ulidState: { lastTime: -1, lastRandom: 0n },
    UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    ULID_RE: /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/,

    /* 取值裁剪：非数字用兜底值，越界截断 */
    clamp(value, min, max, fallback) {
      const num = Number(value);
      if (!Number.isFinite(num)) return fallback;
      return Math.min(max, Math.max(min, Math.floor(num)));
    },

    /* 取随机字节（CSPRNG） */
    randomBytes(length) {
      const size = Math.max(0, Math.floor(Number(length) || 0));
      const bytes = new Uint8Array(size);
      if (size) crypto.getRandomValues(bytes);
      return bytes;
    },

    /* 取 [0, max) 的均匀随机整数：拒绝采样（丢弃超出整除范围的字节） */
    randomIndex(maxExclusive) {
      const max = Math.floor(Number(maxExclusive));
      if (!Number.isFinite(max) || max <= 1) return 0;
      if (max <= 256) {
        const limit = 256 - (256 % max);
        const buf = new Uint8Array(1);
        let value = 0;
        do {
          crypto.getRandomValues(buf);
          value = buf[0];
        } while (value >= limit);
        return value % max;
      }
      const limit = 65536 - (65536 % max);
      const buf = new Uint8Array(2);
      let value = 0;
      do {
        crypto.getRandomValues(buf);
        value = buf[0] * 256 + buf[1];
      } while (value >= limit);
      return value % max;
    },

    /* 从字符集里取 length 个字符：批量取字节 + 拒绝采样，分布均匀 */
    randomFrom(alphabet, length) {
      const chars = String(alphabet == null ? '' : alphabet);
      const size = Math.max(0, Math.floor(Number(length) || 0));
      if (!chars.length || !size) return '';
      if (chars.length > 256) {
        let wide = '';
        for (let i = 0; i < size; i += 1) wide += chars[IDGEN.randomIndex(chars.length)];
        return wide;
      }
      const limit = 256 - (256 % chars.length);
      let out = '';
      while (out.length < size) {
        const need = size - out.length;
        const bytes = IDGEN.randomBytes(need * 2 + 8);
        for (let i = 0; i < bytes.length && out.length < size; i += 1) {
          if (bytes[i] < limit) out += chars[bytes[i] % chars.length];
        }
      }
      return out;
    },

    /* 16 字节转标准 8-4-4-4-12 形式 */
    formatUuid(bytes) {
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    },

    /* UUID v4：优先用 crypto.randomUUID()，否则手工拼装（版本位 4 + 变体位 10） */
    uuidV4() {
      if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      const bytes = IDGEN.randomBytes(16);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      return IDGEN.formatUuid(bytes);
    },

    /* UUID v7：48 位大端毫秒时间戳 + 4 位版本 + 12 位 rand_a + 2 位变体 + 62 位 rand_b */
    uuidV7(timestamp) {
      const ts = Number.isFinite(timestamp) ? Math.floor(timestamp) : Date.now();
      const bytes = IDGEN.randomBytes(16);
      bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
      bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
      bytes[2] = Math.floor(ts / 2 ** 24) & 0xff;
      bytes[3] = Math.floor(ts / 2 ** 16) & 0xff;
      bytes[4] = Math.floor(ts / 2 ** 8) & 0xff;
      bytes[5] = ts & 0xff;
      bytes[6] = (bytes[6] & 0x0f) | 0x70; // 版本位 7 + rand_a 高 4 位
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // 变体位 10 + rand_b 高 6 位
      return IDGEN.formatUuid(bytes);
    },

    /* 取 UUID v7 内嵌的时间戳（毫秒） */
    uuidTimestamp(value) {
      const hex = String(value == null ? '' : value).replace(/-/g, '');
      if (hex.length < 12) return NaN;
      return parseInt(hex.slice(0, 12), 16);
    },

    /* BigInt 转定长 Crockford base32 */
    encodeBase32(value, length) {
      let v = BigInt(value);
      let out = '';
      for (let i = 0; i < length; i += 1) {
        out = IDGEN.CROCKFORD[Number(v & 31n)] + out;
        v >>= 5n;
      }
      return out;
    },

    /* 字节数组转 BigInt（大端） */
    randomBig(bytes) {
      let v = 0n;
      for (let i = 0; i < bytes.length; i += 1) v = (v << 8n) | BigInt(bytes[i]);
      return v;
    },

    /* ULID：10 位时间戳 + 16 位随机数（共 26 位，可按时间排序） */
    ulid(timestamp) {
      const explicit = Number.isFinite(timestamp);
      let time = explicit ? Math.floor(timestamp) : Date.now();
      let random;
      if (explicit) {
        random = IDGEN.randomBig(IDGEN.randomBytes(10));
      } else {
        // 同一毫秒（或时钟回拨）时随机部分自增，保证单调可排序
        if (time <= IDGEN.ulidState.lastTime) {
          time = IDGEN.ulidState.lastTime;
          random = IDGEN.ulidState.lastRandom + 1n;
          if (random > IDGEN.ULID_MAX_RANDOM) {
            time += 1;
            random = 0n;
          }
        } else {
          random = IDGEN.randomBig(IDGEN.randomBytes(10));
        }
        IDGEN.ulidState.lastTime = time;
        IDGEN.ulidState.lastRandom = random;
      }
      return IDGEN.encodeBase32(time, 10) + IDGEN.encodeBase32(random, 16);
    },

    /* 取 ULID 前 10 位里的时间戳（毫秒） */
    ulidTimestamp(value) {
      const text = String(value == null ? '' : value);
      if (text.length < 10) return NaN;
      let v = 0n;
      for (const ch of text.slice(0, 10)) {
        const index = IDGEN.CROCKFORD.indexOf(ch);
        if (index < 0) return NaN;
        v = v * 32n + BigInt(index);
      }
      return Number(v);
    },

    /* 随机密码：每个启用的类别至少出现一次，其余字符均匀抽取，最后洗牌 */
    password(length, options) {
      const opts = options || {};
      const useLower = opts.lower !== false;
      const useUpper = opts.upper !== false;
      const useDigits = opts.digits !== false;
      const useSymbols = opts.symbols !== false;
      const excludeAmbiguous = Boolean(opts.excludeAmbiguous);
      const size = IDGEN.clamp(length, 8, 64, 20);
      const groups = [];
      if (useLower) groups.push(IDGEN.PASSWORD_CLASSES.lower);
      if (useUpper) groups.push(IDGEN.PASSWORD_CLASSES.upper);
      if (useDigits) groups.push(IDGEN.PASSWORD_CLASSES.digits);
      if (useSymbols) groups.push(IDGEN.PASSWORD_CLASSES.symbols);
      const cleaned = groups
        .map((set) =>
          excludeAmbiguous
            ? set.split('').filter((ch) => IDGEN.AMBIGUOUS.indexOf(ch) < 0).join('')
            : set
        )
        .filter((set) => set.length);
      if (!cleaned.length) cleaned.push(IDGEN.PASSWORD_CLASSES.lower);
      const alphabet = cleaned.join('');
      const chars = cleaned.map((set) => set[IDGEN.randomIndex(set.length)]);
      while (chars.length < size) chars.push(alphabet[IDGEN.randomIndex(alphabet.length)]);
      // Fisher–Yates 洗牌（索引同样来自 CSPRNG）
      for (let i = chars.length - 1; i > 0; i -= 1) {
        const j = IDGEN.randomIndex(i + 1);
        const tmp = chars[i];
        chars[i] = chars[j];
        chars[j] = tmp;
      }
      return chars.join('');
    },

    /* 粗略强度：按实际用到的字符类别估算熵（长度 × log2(类别规模)） */
    strength(value) {
      const text = String(value == null ? '' : value);
      if (!text.length) return 'weak';
      let pool = 0;
      if (/[a-z]/.test(text)) pool += 26;
      if (/[A-Z]/.test(text)) pool += 26;
      if (/[0-9]/.test(text)) pool += 10;
      if (/[^a-zA-Z0-9]/.test(text)) pool += IDGEN.PASSWORD_CLASSES.symbols.length;
      if (!pool) return 'weak';
      const entropy = text.length * Math.log2(pool);
      if (entropy < 40) return 'weak';
      if (entropy < 70) return 'medium';
      return 'strong';
    },

    /* 生成单个值 */
    generateOne(type, options) {
      const opts = options || {};
      switch (type) {
        case 'uuid4':
          return IDGEN.uuidV4();
        case 'uuid7':
          return IDGEN.uuidV7();
        case 'ulid':
          return IDGEN.ulid();
        case 'random':
          return IDGEN.randomFrom(
            IDGEN.ALPHABETS[opts.alphabet] || IDGEN.ALPHABETS.alnum,
            IDGEN.clamp(opts.length, 4, 64, 16)
          );
        case 'password':
          return IDGEN.password(IDGEN.clamp(opts.length, 8, 64, 20), opts);
        default:
          return '';
      }
    },

    /* 批量生成 */
    generate(type, options) {
      const opts = options || {};
      const count = IDGEN.clamp(opts.count, 1, 100, 5);
      const out = [];
      for (let i = 0; i < count; i += 1) out.push(IDGEN.generateOne(type, opts));
      return out;
    },
  };
  /* ===================== 纯逻辑区结束 ===================== */

  function mount(container) {
    const state = {
      type: 'uuid4',
      count: 5,
      length: 16,
      alphabet: 'alnum',
      lower: true,
      upper: true,
      digits: true,
      symbols: true,
      excludeAmbiguous: false,
      values: [],
    };

    /* ---- 生成类型 ---- */
    const typeSegment = segmented(
      [
        { value: 'uuid4', label: i18n.t('ids.typeUuid4') },
        { value: 'uuid7', label: i18n.t('ids.typeUuid7') },
        { value: 'ulid', label: i18n.t('ids.typeUlid') },
        { value: 'random', label: i18n.t('ids.typeRandom') },
        { value: 'password', label: i18n.t('ids.typePassword') },
      ],
      state.type,
      (value) => {
        state.type = value;
        syncOptions();
        generate();
      },
      { className: 'segment-compact' }
    );

    const typeSection = section(i18n.t('ids.type'));
    typeSection.append(
      el('div', { class: 'mb-2 text-[11px] text-fg-muted' }, i18n.t('ids.hint')),
      typeSegment.root
    );

    /* ---- 数量 ---- */
    const countInput = el('input', {
      class: 'field font-mono',
      type: 'number',
      min: '1',
      max: '100',
      step: '1',
      spellcheck: 'false',
    });
    countInput.value = String(state.count);
    const countField = inputField(i18n.t('ids.count'), countInput);
    countField.appendChild(el('div', { class: 'mt-1 text-[10px] text-fg-muted' }, i18n.t('ids.countHint')));
    countInput.addEventListener('change', () => {
      state.count = IDGEN.clamp(countInput.value, 1, 100, 5);
      countInput.value = String(state.count);
      generate();
    });

    /* ---- 长度 ---- */
    const lengthInput = el('input', {
      class: 'field font-mono',
      type: 'number',
      min: '4',
      max: '64',
      step: '1',
      spellcheck: 'false',
    });
    lengthInput.value = String(state.length);
    const lengthField = inputField(i18n.t('ids.length'), lengthInput);
    const lengthHint = el('div', { class: 'mt-1 text-[10px] text-fg-muted' }, i18n.t('ids.lengthHintRandom'));
    lengthField.appendChild(lengthHint);
    lengthInput.addEventListener('change', () => {
      const min = state.type === 'password' ? 8 : 4;
      state.length = IDGEN.clamp(lengthInput.value, min, 64, state.length);
      lengthInput.value = String(state.length);
      generate();
    });

    /* ---- 字符集（随机字符串） ---- */
    const alphabetSelect = createSelect({
      options: [
        { value: 'lower', label: i18n.t('ids.alphabetLower') },
        { value: 'upper', label: i18n.t('ids.alphabetUpper') },
        { value: 'alnum', label: i18n.t('ids.alphabetAlnum') },
        { value: 'digits', label: i18n.t('ids.alphabetDigits') },
        { value: 'hex', label: i18n.t('ids.alphabetHex') },
      ],
      value: state.alphabet,
      onChange: (value) => {
        state.alphabet = value;
        generate();
      },
    });
    alphabetSelect.el.style.width = '100%';
    const alphabetField = inputField(i18n.t('ids.alphabet'), alphabetSelect.el);

    /* ---- 密码字符类型 ---- */
    function classChip(key, labelKey) {
      const input = el('input', { type: 'checkbox', class: 'accent-[var(--color-accent)]' });
      input.checked = Boolean(state[key]);
      const label = el('label', { class: 'chip cursor-pointer select-none' });
      label.append(input, el('span', {}, i18n.t(labelKey)));
      input.addEventListener('change', () => {
        state[key] = input.checked;
        generate();
      });
      return label;
    }

    const ambiguousInput = el('input', { type: 'checkbox', class: 'accent-[var(--color-accent)]' });
    const ambiguousLabel = el('label', { class: 'chip cursor-pointer select-none' });
    ambiguousLabel.setAttribute('data-tip', i18n.t('ids.excludeAmbiguousHint'));
    ambiguousLabel.append(ambiguousInput, el('span', {}, i18n.t('ids.excludeAmbiguous')));
    ambiguousInput.addEventListener('change', () => {
      state.excludeAmbiguous = ambiguousInput.checked;
      generate();
    });

    const classBlock = el('div', { class: 'mt-2' });
    const classRow = el('div', { class: 'flex flex-wrap items-center gap-1.5' });
    classRow.append(
      classChip('lower', 'ids.classLower'),
      classChip('upper', 'ids.classUpper'),
      classChip('digits', 'ids.classDigits'),
      classChip('symbols', 'ids.classSymbols'),
      ambiguousLabel
    );
    classBlock.append(el('div', { class: 'tool-label' }, i18n.t('ids.classes')), classRow);

    /* ---- 选项区 ---- */
    const optionSection = section(i18n.t('ids.options'));
    const optionGrid = el('div', { class: 'grid grid-cols-2 gap-2' });
    optionGrid.append(countField, lengthField);
    alphabetField.classList.add('mt-2');
    optionSection.append(optionGrid, alphabetField, classBlock);

    /* ---- 结果区 ---- */
    const resultList = el('div', { class: 'flex flex-col gap-1.5' });

    const copyAllBtn = el('button', { class: 'btn shrink-0 px-2 py-1 text-[11px]', type: 'button' });
    copyAllBtn.append(
      el('span', { class: 'inline-flex' }, Icons.copy(13)),
      el('span', {}, i18n.t('ids.copyAll'))
    );

    const regenBtn = el('button', { class: 'btn shrink-0 px-2 py-1 text-[11px]', type: 'button' });
    regenBtn.append(
      el('span', { class: 'inline-flex' }, Icons.refresh(13)),
      el('span', {}, i18n.t('ids.regenerate'))
    );
    regenBtn.addEventListener('click', () => generate());

    const resultSection = section(i18n.t('ids.result'));
    const resultHead = el('div', { class: 'mb-1.5 flex items-center justify-end gap-1.5' });
    resultHead.append(copyAllBtn, regenBtn);
    resultSection.append(resultHead, resultList);

    /* ---- 强度标记（仅密码类型） ---- */
    function strengthText(level) {
      if (level === 'strong') return i18n.t('ids.strengthStrong');
      if (level === 'medium') return i18n.t('ids.strengthMedium');
      return i18n.t('ids.strengthWeak');
    }

    function strengthColor(level) {
      if (level === 'strong') return 'var(--color-success)';
      if (level === 'medium') return 'var(--color-json-num)';
      return 'var(--color-danger)';
    }

    /* ---- 渲染 ---- */
    function render() {
      resultList.innerHTML = '';
      if (!state.values.length) {
        resultList.appendChild(
          el('div', { class: 'py-6 text-center text-[12px] text-fg-muted' }, i18n.t('ids.empty'))
        );
        return;
      }
      const withStrength = state.type === 'password';
      state.values.forEach((value, index) => {
        const row = resultRow(i18n.t('ids.item', { n: index + 1 }));
        if (withStrength) {
          const valueEl = row.root.querySelector('.result-value');
          if (valueEl) {
            const badge = el('span', { class: 'chip shrink-0' }, '');
            const line = el('div', { class: 'flex items-center gap-2' });
            valueEl.parentNode.replaceChild(line, valueEl);
            line.append(valueEl, badge);
            const level = IDGEN.strength(value);
            badge.textContent = `${i18n.t('ids.strength')} · ${strengthText(level)}`;
            badge.style.color = strengthColor(level);
          }
        }
        row.set(value);
        resultList.appendChild(row.root);
      });
    }

    function generate() {
      state.values = IDGEN.generate(state.type, {
        count: state.count,
        length: state.length,
        alphabet: state.alphabet,
        lower: state.lower,
        upper: state.upper,
        digits: state.digits,
        symbols: state.symbols,
        excludeAmbiguous: state.excludeAmbiguous,
      });
      render();
    }

    /* ---- 类型切换时同步可见选项 ---- */
    function syncOptions() {
      const isRandom = state.type === 'random';
      const isPassword = state.type === 'password';
      lengthField.classList.toggle('hidden', !isRandom && !isPassword);
      alphabetField.classList.toggle('hidden', !isRandom);
      classBlock.classList.toggle('hidden', !isPassword);
      if (isRandom) {
        lengthInput.min = '4';
        lengthHint.textContent = i18n.t('ids.lengthHintRandom');
        if (state.length < 4) {
          state.length = 4;
          lengthInput.value = '4';
        }
      } else if (isPassword) {
        lengthInput.min = '8';
        lengthHint.textContent = i18n.t('ids.lengthHintPassword');
        if (state.length < 8) {
          state.length = 8;
          lengthInput.value = '8';
        }
      }
    }

    copyAllBtn.addEventListener('click', async () => {
      const text = state.values.join('\n');
      if (!text) return;
      const label = copyAllBtn.lastChild;
      const ok = await copyText(text);
      label.textContent = ok ? i18n.t('ids.copied') : i18n.t('ids.copyFailed');
      setTimeout(() => {
        label.textContent = i18n.t('ids.copyAll');
      }, 1200);
    });

    /* ---- 2FA 验证码（原独立工具并入本工具） ---- */
    const twofaSection = section(i18n.t('ids.twofaSection'));
    twofaSection.appendChild(
      el('div', { class: 'mb-2 text-[11px] text-fg-muted' }, i18n.t('ids.twofaHint'))
    );
    let disposeTwofa = null;
    if (window.ShipsTwofaTool && typeof window.ShipsTwofaTool.mount === 'function') {
      disposeTwofa = window.ShipsTwofaTool.mount(twofaSection);
    }

    container.append(twofaSection, typeSection, optionSection, resultSection);

    syncOptions();
    generate();

    return () => {
      if (typeof disposeTwofa === 'function') disposeTwofa();
    };
  }

  window.ShipsToolRegistry.register({ id: 'ids', icon: 'ids', mount });
})();
