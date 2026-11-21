'use strict';

/* 文本处理工具：大小写转换、行处理（去重 / 排序 / 反转 / 去空行 / 去空格）、
   转义与反转义（JSON / XML / SQL / URL），以及行数 / 字符数 / 单词数 / 字节数统计。
   全部在渲染层完成（纯前端、无依赖）。 */

(function registerTextTool() {
  const { el, section, segmented, copyText, Icons } = window.ShipsUI;
  const i18n = window.ShipsI18n;

  i18n.extend({
    zh: {
      text: {
        title: '文本处理',
        hint: '输入文本后使用下方按钮处理；所有操作都直接改写输入框，可随时重新输入。',
        placeholder: '粘贴或输入文本…',
        case: '大小写转换',
        caseUpper: '全大写',
        caseLower: '全小写',
        caseCamel: '驼峰',
        casePascal: '帕斯卡',
        caseSnake: '下划线',
        caseKebab: '短横线',
        caseConstant: '常量',
        caseTitle: '标题',
        lines: '行处理',
        lineDedupe: '去重',
        lineSortAsc: '升序',
        lineSortDesc: '降序',
        lineReverse: '反转',
        lineDropBlank: '去空行',
        lineTrim: '去首尾空格',
        lineTrimAll: '去空白行与首尾空格',
        escape: '转义',
        escapeNone: '不转义',
        escapeJson: 'JSON',
        escapeXml: 'XML',
        escapeSql: 'SQL',
        escapeUrl: 'URL',
        escapeDo: '转义',
        escapeUndo: '反转义',
        stats: '统计',
        statLines: '行数',
        statChars: '字符数',
        statWords: '单词数',
        statBytes: '字节数',
        statUnique: '去重行',
        copy: '复制结果',
        copied: '已复制',
        empty: '没有内容',
      },
    },
    en: {
      text: {
        title: 'Text tools',
        hint: 'Type or paste text, then use the buttons below. Every action rewrites the input box.',
        placeholder: 'Paste or type text…',
        case: 'Case',
        caseUpper: 'UPPER',
        caseLower: 'lower',
        caseCamel: 'camelCase',
        casePascal: 'PascalCase',
        caseSnake: 'snake_case',
        caseKebab: 'kebab-case',
        caseConstant: 'CONSTANT',
        caseTitle: 'Title Case',
        lines: 'Lines',
        lineDedupe: 'Dedupe',
        lineSortAsc: 'Sort ↑',
        lineSortDesc: 'Sort ↓',
        lineReverse: 'Reverse',
        lineDropBlank: 'Drop blanks',
        lineTrim: 'Trim spaces',
        lineTrimAll: 'Trim all',
        escape: 'Escape',
        escapeNone: 'None',
        escapeJson: 'JSON',
        escapeXml: 'XML',
        escapeSql: 'SQL',
        escapeUrl: 'URL',
        escapeDo: 'Escape',
        escapeUndo: 'Unescape',
        stats: 'Stats',
        statLines: 'Lines',
        statChars: 'Characters',
        statWords: 'Words',
        statBytes: 'Bytes',
        statUnique: 'Unique lines',
        copy: 'Copy result',
        copied: 'Copied',
        empty: 'Nothing to copy',
      },
    },
  });

  /* ------------------------------ 大小写转换 ------------------------------ */

  /* 拆词：先拆驼峰（lowerUpper / UPPERLower），再按非字母数字切分；
     中文等没有大小写的文字整段保留为一个词。 */
  function splitWords(text) {
    return String(text == null ? '' : text)
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
      .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  }

  function capitalize(word) {
    const chars = Array.from(String(word || ''));
    if (!chars.length) return '';
    return chars[0].toUpperCase() + chars.slice(1).join('').toLowerCase();
  }

  function mapLines(text, fn) {
    return String(text == null ? '' : text)
      .split('\n')
      .map((line) => fn(line))
      .join('\n');
  }

  const CASE_TRANSFORMS = {
    upper: (text) => String(text).toUpperCase(),
    lower: (text) => String(text).toLowerCase(),
    camel: (text) =>
      mapLines(text, (line) => {
        const words = splitWords(line);
        if (!words.length) return '';
        return words
          .map((word, index) => (index === 0 ? word.toLowerCase() : capitalize(word)))
          .join('');
      }),
    pascal: (text) =>
      mapLines(text, (line) => splitWords(line).map(capitalize).join('')),
    snake: (text) => mapLines(text, (line) => splitWords(line).map((w) => w.toLowerCase()).join('_')),
    kebab: (text) => mapLines(text, (line) => splitWords(line).map((w) => w.toLowerCase()).join('-')),
    constant: (text) => mapLines(text, (line) => splitWords(line).map((w) => w.toUpperCase()).join('_')),
    title: (text) =>
      mapLines(text, (line) =>
        splitWords(line)
          .map((word) => (/^[\p{Ll}\p{N}]/u.test(word) ? capitalize(word) : word))
          .join(' ')
      ),
  };

  /* ------------------------------ 行处理 ------------------------------ */

  const LINE_TRANSFORMS = {
    dedupe: (text) => {
      const seen = new Set();
      const out = [];
      for (const line of String(text).split('\n')) {
        if (seen.has(line)) continue;
        seen.add(line);
        out.push(line);
      }
      return out.join('\n');
    },
    sortAsc: (text) =>
      String(text)
        .split('\n')
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        .join('\n'),
    sortDesc: (text) =>
      String(text)
        .split('\n')
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))
        .join('\n'),
    reverse: (text) => String(text).split('\n').reverse().join('\n'),
    dropBlank: (text) =>
      String(text)
        .split('\n')
        .filter((line) => line.trim() !== '')
        .join('\n'),
    trim: (text) => String(text).split('\n').map((line) => line.trim()).join('\n'),
    trimAll: (text) =>
      String(text)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .join('\n'),
  };

  /* ------------------------------ 转义 / 反转义 ------------------------------ */

  const ESCAPE_JSON_MAP = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };

  function escapeJson(text) {
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/[\b\f]/g, (ch) => (ch === '\b' ? '\\b' : '\\f'))
      .replace(/[\u0000-\u001f\u007f]/g, (ch) =>
        `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
      );
  }

  function unescapeJson(text) {
    // 单次扫描：\uXXXX / \xXX / \n 等转义序列，避免「\\n」被误拆成反斜杠 + 换行。
    return String(text).replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (match, seq) => {
      if (seq[0] === 'u' || seq[0] === 'x') return String.fromCharCode(parseInt(seq.slice(1), 16));
      return Object.prototype.hasOwnProperty.call(ESCAPE_JSON_MAP, seq) ? ESCAPE_JSON_MAP[seq] : seq;
    });
  }

  function escapeXml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function unescapeXml(text) {
    return String(text)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(Number(dec)))
      .replace(/&amp;/g, '&');
  }

  function escapeSql(text) {
    return String(text).replace(/'/g, "''");
  }

  function unescapeSql(text) {
    return String(text).replace(/''/g, "'");
  }

  function escapeUrl(text) {
    return encodeURIComponent(String(text));
  }

  function unescapeUrl(text) {
    try {
      return decodeURIComponent(String(text));
    } catch (err) {
      // 非法转义序列：尽量还原可还原的部分，不整体报错。
      return String(text).replace(/%([0-9a-fA-F]{2})/g, (match, hex) => {
        try {
          return decodeURIComponent(match);
        } catch (inner) {
          return match;
        }
      });
    }
  }

  const ESCAPERS = {
    json: { do: escapeJson, undo: unescapeJson },
    xml: { do: escapeXml, undo: unescapeXml },
    sql: { do: escapeSql, undo: unescapeSql },
    url: { do: escapeUrl, undo: unescapeUrl },
  };

  /* ------------------------------ 统计 ------------------------------ */

  function countChars(text) {
    return Array.from(String(text)).length;
  }

  function countWords(text) {
    const trimmed = String(text).trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }

  function countBytes(text) {
    try {
      return new TextEncoder().encode(String(text)).length;
    } catch (err) {
      return String(text).length;
    }
  }

  function mount(container) {
    const textarea = el('textarea', {
      class: 'field h-[150px] w-full resize-none font-mono text-[12px]',
      spellcheck: 'false',
      placeholder: i18n.t('text.placeholder'),
    });

    const inputSection = section(i18n.t('text.title'));
    inputSection.append(
      el('div', { class: 'mb-2 text-[11px] text-fg-muted' }, i18n.t('text.hint')),
      textarea
    );

    function buttonRow(labelKey, items) {
      const wrap = el('section', { class: 'section' });
      wrap.appendChild(el('div', { class: 'mb-1.5 text-[11px] text-fg-muted' }, i18n.t(labelKey)));
      const row = el('div', { class: 'flex flex-wrap gap-1.5' });
      for (const item of items) {
        const button = el('button', {
          class: 'btn shrink-0 px-2 py-1 text-[11px]',
          type: 'button',
        }, item.label);
        button.addEventListener('click', item.onClick);
        row.appendChild(button);
      }
      wrap.appendChild(row);
      return wrap;
    }

    function apply(transform) {
      const next = transform(textarea.value);
      if (next === textarea.value) return;
      textarea.value = next;
      updateStats();
    }

    const caseSection = buttonRow('text.case', [
      { label: i18n.t('text.caseUpper'), onClick: () => apply(CASE_TRANSFORMS.upper) },
      { label: i18n.t('text.caseLower'), onClick: () => apply(CASE_TRANSFORMS.lower) },
      { label: i18n.t('text.caseCamel'), onClick: () => apply(CASE_TRANSFORMS.camel) },
      { label: i18n.t('text.casePascal'), onClick: () => apply(CASE_TRANSFORMS.pascal) },
      { label: i18n.t('text.caseSnake'), onClick: () => apply(CASE_TRANSFORMS.snake) },
      { label: i18n.t('text.caseKebab'), onClick: () => apply(CASE_TRANSFORMS.kebab) },
      { label: i18n.t('text.caseConstant'), onClick: () => apply(CASE_TRANSFORMS.constant) },
      { label: i18n.t('text.caseTitle'), onClick: () => apply(CASE_TRANSFORMS.title) },
    ]);

    const lineSection = buttonRow('text.lines', [
      { label: i18n.t('text.lineDedupe'), onClick: () => apply(LINE_TRANSFORMS.dedupe) },
      { label: i18n.t('text.lineSortAsc'), onClick: () => apply(LINE_TRANSFORMS.sortAsc) },
      { label: i18n.t('text.lineSortDesc'), onClick: () => apply(LINE_TRANSFORMS.sortDesc) },
      { label: i18n.t('text.lineReverse'), onClick: () => apply(LINE_TRANSFORMS.reverse) },
      { label: i18n.t('text.lineDropBlank'), onClick: () => apply(LINE_TRANSFORMS.dropBlank) },
      { label: i18n.t('text.lineTrim'), onClick: () => apply(LINE_TRANSFORMS.trim) },
      { label: i18n.t('text.lineTrimAll'), onClick: () => apply(LINE_TRANSFORMS.trimAll) },
    ]);

    /* 转义：分段控件选类型 + 「转义 / 反转义」两个按钮 */
    let escapeKind = 'json';
    const escapeSegment = segmented(
      [
        { value: 'json', label: i18n.t('text.escapeJson') },
        { value: 'xml', label: i18n.t('text.escapeXml') },
        { value: 'sql', label: i18n.t('text.escapeSql') },
        { value: 'url', label: i18n.t('text.escapeUrl') },
      ],
      'json',
      (value) => {
        escapeKind = value;
      },
      { className: 'segment-compact' }
    );
    const escapeDoBtn = el('button', { class: 'btn shrink-0 px-2 py-1 text-[11px]', type: 'button' }, i18n.t('text.escapeDo'));
    escapeDoBtn.addEventListener('click', () => {
      const pair = ESCAPERS[escapeKind];
      if (pair) apply(pair.do);
    });
    const escapeUndoBtn = el('button', { class: 'btn shrink-0 px-2 py-1 text-[11px]', type: 'button' }, i18n.t('text.escapeUndo'));
    escapeUndoBtn.addEventListener('click', () => {
      const pair = ESCAPERS[escapeKind];
      if (pair) apply(pair.undo);
    });
    const escapeSection = el('section', { class: 'section' });
    escapeSection.appendChild(el('div', { class: 'mb-1.5 text-[11px] text-fg-muted' }, i18n.t('text.escape')));
    const escapeRow = el('div', { class: 'flex flex-wrap items-center gap-1.5' });
    escapeRow.append(escapeSegment.root, escapeDoBtn, escapeUndoBtn);
    escapeSection.appendChild(escapeRow);

    /* 统计 */
    const statDefs = [
      { key: 'lines', labelKey: 'text.statLines' },
      { key: 'chars', labelKey: 'text.statChars' },
      { key: 'words', labelKey: 'text.statWords' },
      { key: 'bytes', labelKey: 'text.statBytes' },
      { key: 'unique', labelKey: 'text.statUnique' },
    ];
    const statValues = {};
    const statGrid = el('div', { class: 'grid grid-cols-5 gap-2' });
    for (const def of statDefs) {
      const card = el('div', { class: 'rounded-card border border-border bg-surface px-2 py-1.5' });
      const value = el('div', { class: 'font-mono text-[13px] text-fg' }, '0');
      card.append(
        el('div', { class: 'text-[10px] text-fg-muted' }, i18n.t(def.labelKey)),
        value
      );
      statValues[def.key] = value;
      statGrid.appendChild(card);
    }

    const copyBtn = el('button', { class: 'btn shrink-0 px-2 py-1 text-[11px]', type: 'button' });
    copyBtn.appendChild(el('span', { class: 'inline-flex' }, Icons.copy(13)));
    copyBtn.appendChild(el('span', {}, i18n.t('text.copy')));
    copyBtn.addEventListener('click', async () => {
      const value = textarea.value;
      if (!value) {
        copyBtn.lastChild.textContent = i18n.t('text.empty');
        setTimeout(() => {
          copyBtn.lastChild.textContent = i18n.t('text.copy');
        }, 1200);
        return;
      }
      const ok = await copyText(value);
      copyBtn.lastChild.textContent = ok ? i18n.t('text.copied') : i18n.t('text.empty');
      setTimeout(() => {
        copyBtn.lastChild.textContent = i18n.t('text.copy');
      }, 1200);
    });

    const statsSection = el('section', { class: 'section' });
    const statsHead = el('div', { class: 'mb-1.5 flex items-center justify-between gap-2' });
    statsHead.append(
      el('div', { class: 'text-[11px] text-fg-muted' }, i18n.t('text.stats')),
      copyBtn
    );
    statsSection.append(statsHead, statGrid);

    function updateStats() {
      const value = textarea.value;
      const lines = value === '' ? 0 : value.split('\n').length;
      const unique = value === '' ? 0 : new Set(value.split('\n')).size;
      statValues.lines.textContent = String(lines);
      statValues.chars.textContent = String(countChars(value));
      statValues.words.textContent = String(countWords(value));
      statValues.bytes.textContent = String(countBytes(value));
      statValues.unique.textContent = String(unique);
    }

    textarea.addEventListener('input', updateStats);
    updateStats();

    container.append(inputSection, caseSection, lineSection, escapeSection, statsSection);
  }

  window.ShipsToolRegistry.register({ id: 'text', icon: 'text', mount });
})();
