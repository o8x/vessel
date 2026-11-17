'use strict';

/* Lightweight built-in editor window (CodeMirror 5). Opened from the file
   manager for any file ≤ 8 MB; reuses the file manager's SFTP session so saving
   writes straight back to the remote file. Binary files open read-only. */

(function bootstrapFileEditor() {
  const i18n = window.ShipsI18n;
  const { Icons } = window.ShipsUI;

  i18n.extend({
    zh: {
      editor: {
        save: '保存',
        saveAs: '另存为',
        openVSCode: '从 VS Code 打开',
        download: '下载到本地',
        downloading: '下载中…',
        downloaded: '已下载到 {path}',
        downloadFailed: '下载失败：{error}',
        openedVSCode: '已用 VS Code 打开 {path}',
        reload: '重新加载',
        undo: '撤销',
        redo: '重做',
        wrapOn: '自动换行',
        wrapOff: '关闭自动换行',
        saving: '保存中…',
        saved: '已保存',
        unsaved: '未保存',
        loading: '加载中…',
        loadFailed: '加载失败：{error}',
        saveFailed: '保存失败：{error}',
        binaryReadOnly: '二进制文件，已按只读文本打开（不会写回原文件）',
        reloadConfirm: '文件已修改，确定放弃修改并重新加载？',
        saveAsTitle: '另存为（远端路径）',
        saveAsPlaceholder: '远端绝对路径，如 /home/user/file.txt',
        cancel: '取消',
        confirm: '确定',
        badPath: '请输入以 / 开头的远端绝对路径',
        plainText: '纯文本',
        position: '第 {line} 行，第 {col} 列',
        syntax: '语法',
        eol: '换行',
        size: '大小',
        findLabel: '查找内容',
        replaceLabel: '替换为',
        findPrev: '上一个',
        findNext: '下一个',
        findClose: '关闭',
        caseSensitive: '区分大小写',
        regex: '正则表达式',
        replaceOne: '替换',
        replaceAll: '全部替换',
        regexInvalid: '正则无效',
        findNone: '无结果',
        replacedAll: '已替换 {count} 处',
      },
    },
    en: {
      editor: {
        save: 'Save',
        saveAs: 'Save as',
        openVSCode: 'Open from VS Code',
        download: 'Download to local',
        downloading: 'Downloading…',
        downloaded: 'Saved to {path}',
        downloadFailed: 'Download failed: {error}',
        openedVSCode: 'Opened in VS Code: {path}',
        reload: 'Reload',
        undo: 'Undo',
        redo: 'Redo',
        wrapOn: 'Word wrap',
        wrapOff: 'No wrap',
        saving: 'Saving…',
        saved: 'Saved',
        unsaved: 'Unsaved',
        loading: 'Loading…',
        loadFailed: 'Load failed: {error}',
        saveFailed: 'Save failed: {error}',
        binaryReadOnly: 'Binary file opened read-only (changes are not written back)',
        reloadConfirm: 'Discard changes and reload this file?',
        saveAsTitle: 'Save as (remote path)',
        saveAsPlaceholder: 'Absolute remote path, e.g. /home/user/file.txt',
        cancel: 'Cancel',
        confirm: 'OK',
        badPath: 'Enter an absolute remote path starting with /',
        plainText: 'Plain text',
        position: 'Ln {line}, Col {col}',
        syntax: 'Syntax',
        eol: 'EOL',
        size: 'Size',
        findLabel: 'Find what',
        replaceLabel: 'Replace with',
        findPrev: 'Previous',
        findNext: 'Next',
        findClose: 'Close',
        caseSensitive: 'Match case',
        regex: 'Regular expression',
        replaceOne: 'Replace',
        replaceAll: 'Replace all',
        regexInvalid: 'Invalid regex',
        findNone: 'No results',
        replacedAll: 'Replaced {count} occurrence(s)',
      },
    },
  });

  const MODE_BY_EXT = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'javascript', json: 'javascript', jsonc: 'javascript',
    jsx: 'jsx', tsx: 'jsx',
    html: 'htmlmixed', htm: 'htmlmixed', vue: 'htmlmixed', svelte: 'htmlmixed',
    xml: 'xml', svg: 'xml', xsd: 'xml', plist: 'xml',
    css: 'css', scss: 'css', less: 'css', sass: 'sass',
    md: 'markdown', markdown: 'markdown', mdx: 'markdown',
    py: 'python', pyw: 'python',
    sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ksh: 'shell',
    yml: 'yaml', yaml: 'yaml', toml: 'toml',
    ini: 'properties', conf: 'properties', cfg: 'properties', env: 'properties', properties: 'properties',
    sql: 'sql', go: 'go', rs: 'rust', rb: 'ruby', pl: 'perl', lua: 'lua', php: 'php',
    c: 'clike', h: 'clike', cc: 'clike', cpp: 'clike', cxx: 'clike', hpp: 'clike', hh: 'clike',
    java: 'clike', cs: 'clike', kt: 'clike', kts: 'clike', scala: 'clike',
    swift: 'swift', dart: 'dart', clj: 'clojure', cljs: 'clojure', cljc: 'clojure',
    dockerfile: 'dockerfile',
  };

  const MODE_FILES = {
    javascript: ['mode/javascript/javascript.js'],
    jsx: ['mode/javascript/javascript.js', 'mode/jsx/jsx.js'],
    xml: ['mode/xml/xml.js'],
    css: ['mode/css/css.js'],
    sass: ['mode/css/css.js', 'mode/sass/sass.js'],
    htmlmixed: ['mode/xml/xml.js', 'mode/javascript/javascript.js', 'mode/css/css.js', 'mode/htmlmixed/htmlmixed.js'],
    markdown: ['mode/markdown/markdown.js'],
    python: ['mode/python/python.js'],
    shell: ['mode/shell/shell.js'],
    yaml: ['mode/yaml/yaml.js'],
    toml: ['mode/toml/toml.js'],
    properties: ['mode/properties/properties.js'],
    sql: ['mode/sql/sql.js'],
    go: ['mode/go/go.js'],
    rust: ['mode/rust/rust.js'],
    ruby: ['mode/ruby/ruby.js'],
    perl: ['mode/perl/perl.js'],
    lua: ['mode/lua/lua.js'],
    php: ['mode/xml/xml.js', 'mode/clike/clike.js', 'mode/php/php.js'],
    clike: ['mode/clike/clike.js'],
    swift: ['mode/swift/swift.js'],
    dart: ['mode/dart/dart.js'],
    clojure: ['mode/clojure/clojure.js'],
    dockerfile: ['mode/dockerfile/dockerfile.js'],
  };

  const MODE_LABEL = {
    javascript: 'JavaScript',
    jsx: 'JSX',
    xml: 'XML',
    css: 'CSS',
    sass: 'Sass',
    htmlmixed: 'HTML',
    markdown: 'Markdown',
    python: 'Python',
    shell: 'Shell',
    yaml: 'YAML',
    toml: 'TOML',
    properties: 'Properties',
    sql: 'SQL',
    go: 'Go',
    rust: 'Rust',
    ruby: 'Ruby',
    perl: 'Perl',
    lua: 'Lua',
    php: 'PHP',
    clike: 'C/C++',
    swift: 'Swift',
    dart: 'Dart',
    clojure: 'Clojure',
    dockerfile: 'Dockerfile',
  };

  const EXT_LABEL = { ts: 'TypeScript', tsx: 'TSX', kt: 'Kotlin', kts: 'Kotlin', cs: 'C#' };

  const dom = {
    title: document.getElementById('editor-window-title'),
    host: document.getElementById('editor-host'),
    save: document.getElementById('ed-save'),
    saveAs: document.getElementById('ed-save-as'),
    openVSCode: document.getElementById('ed-open-vscode'),
    download: document.getElementById('ed-download'),
    reload: document.getElementById('ed-reload'),
    undo: document.getElementById('ed-undo'),
    redo: document.getElementById('ed-redo'),
    wrap: document.getElementById('ed-wrap'),
    ref: document.getElementById('ed-ref'),
    mode: document.getElementById('ed-mode'),
    eol: document.getElementById('ed-eol'),
    pos: document.getElementById('ed-pos'),
    size: document.getElementById('ed-size'),
    state: document.getElementById('ed-state'),
    modal: document.getElementById('ed-modal'),
    modalTitle: document.getElementById('ed-modal-title'),
    modalInput: document.getElementById('ed-modal-input'),
    modalCancel: document.getElementById('ed-modal-cancel'),
    modalConfirm: document.getElementById('ed-modal-confirm'),
    find: document.getElementById('editor-find'),
    findLabel: document.getElementById('ed-find-label'),
    findInput: document.getElementById('ed-find-input'),
    findCount: document.getElementById('ed-find-count'),
    findPrev: document.getElementById('ed-find-prev'),
    findNext: document.getElementById('ed-find-next'),
    findCase: document.getElementById('ed-find-case'),
    findRegex: document.getElementById('ed-find-regex'),
    findClose: document.getElementById('ed-find-close'),
    replaceLabel: document.getElementById('ed-replace-label'),
    replaceInput: document.getElementById('ed-replace-input'),
    replaceOne: document.getElementById('ed-replace-one'),
    replaceAll: document.getElementById('ed-replace-all'),
  };

  const state = {
    path: '',
    name: '',
    reference: '',
    original: '',
    separator: '\n',
    separatorLabel: 'LF',
    mode: '',
    modeLabel: '',
    dirty: false,
    saving: false,
    downloading: false,
    readOnly: false,
    binary: false,
    wrap: false,
    statusText: '',
    statusKind: '',
    cm: null,
    sizeBytes: 0,
    sizeTimer: null,
    // 查找 / 替换（Command + F）
    find: {
      visible: false,
      query: '',
      replace: '',
      caseSensitive: false,
      regex: false,
      pattern: '',
      invalid: false,
      matches: [],
      index: -1,
      markers: [],
      activeMarker: null,
      timer: null,
    },
  };

  const loadedScripts = new Set();

  function extOf(name) {
    const value = String(name || '').toLowerCase();
    const dot = value.lastIndexOf('.');
    return dot > 0 && dot < value.length - 1 ? value.slice(dot + 1) : '';
  }

  function modeForName(name) {
    const ext = extOf(name);
    return MODE_BY_EXT[ext] || '';
  }

  function labelForMode(mode, name) {
    const ext = extOf(name);
    if (EXT_LABEL[ext]) return EXT_LABEL[ext];
    return MODE_LABEL[mode] || i18n.t('editor.plainText');
  }

  function loadScript(src) {
    if (loadedScripts.has(src)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `../../node_modules/codemirror/${src}`;
      script.onload = () => {
        loadedScripts.add(src);
        resolve();
      };
      script.onerror = () => reject(new Error(src));
      document.head.appendChild(script);
    });
  }

  async function ensureMode(mode) {
    const files = MODE_FILES[mode] || [];
    for (const file of files) await loadScript(file);
  }

  function detectSeparator(text) {
    if (text.includes('\r\n')) return { separator: '\r\n', label: 'CRLF' };
    if (text.includes('\r')) return { separator: '\r', label: 'CR' };
    return { separator: '\n', label: 'LF' };
  }

  function normalize(text) {
    return String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(2)} MB`;
  }

  function docByteLength() {
    if (!state.cm) return 0;
    try {
      return new TextEncoder().encode(state.cm.getValue('\n')).length;
    } catch (err) {
      return state.cm.getValue('\n').length;
    }
  }

  function setStatus(text, kind) {
    state.statusText = text || '';
    state.statusKind = kind || '';
    renderStatus();
  }

  function renderStatus() {
    if (dom.ref) dom.ref.textContent = state.reference || state.path;
    if (dom.mode) dom.mode.textContent = state.modeLabel || i18n.t('editor.plainText');
    if (dom.eol) dom.eol.textContent = state.separatorLabel;
    if (dom.size) dom.size.textContent = formatBytes(state.sizeBytes);
    if (dom.state) {
      dom.state.textContent = state.statusText;
      dom.state.className = `editor-status-right${state.statusKind ? ` ${state.statusKind}` : ''}`;
    }
    if (state.cm) {
      const cursor = state.cm.getCursor();
      dom.pos.textContent = i18n.t('editor.position', { line: cursor.line + 1, col: cursor.ch + 1 });
    } else if (dom.pos) {
      dom.pos.textContent = '';
    }
    const windowTitle = `${state.dirty ? '* ' : ''}${state.name || 'Vessel Editor'} — Vessel Editor`;
    document.title = windowTitle;
    // 模态标题栏与窗口标题保持一致（文件名 + 未保存标记）。
    if (dom.title) dom.title.textContent = windowTitle;
  }

  function scheduleSize() {
    if (state.sizeTimer) clearTimeout(state.sizeTimer);
    state.sizeTimer = setTimeout(() => {
      state.sizeTimer = null;
      state.sizeBytes = docByteLength();
      if (dom.size) dom.size.textContent = formatBytes(state.sizeBytes);
    }, 250);
  }

  function serialize() {
    if (!state.cm) return '';
    return state.cm.getValue('\n').split('\n').join(state.separator);
  }

  function syncDirty() {
    if (!state.cm) return;
    state.dirty = state.cm.getValue('\n') !== state.original;
    renderStatus();
    scheduleSize();
  }

  function createEditor(mode, value) {
    const wrap = state.wrap;
    state.cm = window.CodeMirror(dom.host, {
      value,
      mode: mode || null,
      lineNumbers: true,
      lineWrapping: wrap,
      readOnly: state.readOnly,
      tabSize: 2,
      indentUnit: 2,
      indentWithTabs: false,
      matchBrackets: true,
      autoCloseBrackets: true,
      styleActiveLine: true,
      extraKeys: {
        'Cmd-S': save,
        'Ctrl-S': save,
        'Cmd-Shift-S': saveAs,
        'Ctrl-Shift-S': saveAs,
      },
    });
    state.cm.on('change', () => {
      syncDirty();
      scheduleFindRefresh();
    });
    state.cm.on('cursorActivity', renderStatus);
    renderStatus();
  }

  /* ------------------------------ 查找 / 替换 ------------------------------
     Command + F 打开：停靠在工具栏下方的两行面板（查找内容 / 替换为），
     全部命中弱高亮、当前命中强高亮；匹配位置按文档全文计算（支持区分大小写与正则）。 */
  function clearFindMarkers() {
    const f = state.find;
    for (const marker of f.markers) marker.clear();
    f.markers = [];
    if (f.activeMarker) {
      f.activeMarker.clear();
      f.activeMarker = null;
    }
  }

  function updateFindCount() {
    const f = state.find;
    if (!dom.findCount) return;
    dom.findCount.classList.toggle('is-error', Boolean(f.invalid));
    if (f.invalid) {
      dom.findCount.textContent = i18n.t('editor.regexInvalid');
      return;
    }
    if (!f.query) {
      dom.findCount.textContent = '';
      return;
    }
    if (!f.matches.length) {
      dom.findCount.textContent = i18n.t('editor.findNone');
      return;
    }
    dom.findCount.textContent = `${f.index >= 0 ? f.index + 1 : 0} / ${f.matches.length}`;
  }

  function activateFindMatch(scroll) {
    const f = state.find;
    if (f.activeMarker) {
      f.activeMarker.clear();
      f.activeMarker = null;
    }
    const item = f.matches[f.index];
    if (!item || !state.cm) {
      updateFindCount();
      return;
    }
    f.activeMarker = state.cm.markText(item.from, item.to, { className: 'cm-find-active' });
    if (scroll) {
      state.cm.setSelection(item.from, item.to);
      state.cm.scrollIntoView({ from: item.from, to: item.to }, 60);
    }
    updateFindCount();
  }

  /* 重新计算全部命中并刷新高亮 / 计数（默认把视图带到光标之后的第一处命中）。 */
  function refreshFind() {
    const f = state.find;
    f.matches = [];
    f.index = -1;
    f.invalid = false;
    clearFindMarkers();
    const cm = state.cm;
    const query = String(f.query || '');
    if (!cm || !query) {
      updateFindCount();
      return;
    }
    const source = f.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      // 先验证正则合法性（非法时只提示，不阻塞输入）。
      new RegExp(source, f.caseSensitive ? 'g' : 'gi');
    } catch (err) {
      f.invalid = true;
      updateFindCount();
      return;
    }
    f.pattern = source;
    const re = new RegExp(source, f.caseSensitive ? 'g' : 'gi');
    const text = cm.getValue('\n');
    const cmp = (window.CodeMirror && window.CodeMirror.cmpPos) || null;
    const cursor = cm.getCursor();
    let match = re.exec(text);
    while (match !== null) {
      if (!match[0].length) {
        re.lastIndex += 1;
      } else {
        const from = cm.posFromIndex(match.index);
        const to = cm.posFromIndex(match.index + match[0].length);
        f.matches.push({ from, to, text: match[0] });
        if (f.index < 0 && (!cmp || cmp(from, cursor) >= 0)) f.index = f.matches.length - 1;
        if (f.matches.length >= 20000) break;
      }
      match = re.exec(text);
    }
    if (f.matches.length && f.index < 0) f.index = 0;
    f.markers = f.matches.map((item) => cm.markText(item.from, item.to, { className: 'cm-find-match' }));
    if (f.index >= 0) activateFindMatch(true);
    else updateFindCount();
  }

  function scheduleFindRefresh() {
    const f = state.find;
    if (!f.visible) return;
    if (f.timer) clearTimeout(f.timer);
    f.timer = setTimeout(() => {
      f.timer = null;
      refreshFind();
    }, 180);
  }

  function findStep(direction) {
    const f = state.find;
    if (!f.visible) {
      openFind(false);
      return;
    }
    if (!f.matches.length && !f.invalid) refreshFind();
    if (!f.matches.length) return;
    if (f.index < 0) f.index = direction > 0 ? 0 : f.matches.length - 1;
    else f.index = (f.index + direction + f.matches.length) % f.matches.length;
    activateFindMatch(true);
  }

  function replacementForMatch(item) {
    const f = state.find;
    if (!f.regex) return f.replace;
    try {
      const single = new RegExp(f.pattern, f.caseSensitive ? '' : 'i');
      return item.text.replace(single, f.replace);
    } catch (err) {
      return f.replace;
    }
  }

  function replaceOne() {
    const f = state.find;
    if (!state.cm) return;
    if (state.readOnly) {
      setStatus(i18n.t('editor.binaryReadOnly'));
      return;
    }
    if (!f.matches.length && !f.invalid) refreshFind();
    if (!f.matches.length) return;
    if (f.index < 0) f.index = 0;
    const item = f.matches[f.index];
    const next = replacementForMatch(item);
    state.cm.replaceRange(next, item.from, item.to);
    refreshFind();
  }

  function replaceAll() {
    const f = state.find;
    if (!state.cm) return;
    if (state.readOnly) {
      setStatus(i18n.t('editor.binaryReadOnly'));
      return;
    }
    if (!f.matches.length && !f.invalid) refreshFind();
    const items = f.matches.slice();
    if (!items.length) return;
    const replacements = items.map((item) => replacementForMatch(item));
    // 从后往前替换，避免前面的改动影响后面命中的位置。
    state.cm.operation(() => {
      for (let i = items.length - 1; i >= 0; i -= 1) {
        state.cm.replaceRange(replacements[i], items[i].from, items[i].to);
      }
    });
    syncDirty();
    refreshFind();
    setStatus(i18n.t('editor.replacedAll', { count: items.length }), 'is-success');
  }

  function openFind(focusReplace) {
    if (!state.cm) return;
    const f = state.find;
    f.visible = true;
    dom.find.hidden = false;
    // 有单行选区时用它作为初始关键词（Word 的习惯）。
    const selection = state.cm.getSelection();
    if (selection && !selection.includes('\n')) {
      f.query = selection;
      dom.findInput.value = selection;
    }
    refreshFind();
    const target = focusReplace ? dom.replaceInput : dom.findInput;
    target.focus();
    target.select();
    // 面板显隐改变了编辑器可用高度：下一帧让 CodeMirror 重新测量。
    requestAnimationFrame(() => {
      if (state.cm) state.cm.refresh();
    });
  }

  function closeFind() {
    const f = state.find;
    f.visible = false;
    if (f.timer) {
      clearTimeout(f.timer);
      f.timer = null;
    }
    clearFindMarkers();
    if (dom.find) dom.find.hidden = true;
    if (state.cm) state.cm.focus();
    requestAnimationFrame(() => {
      if (state.cm) state.cm.refresh();
    });
  }

  /* 二进制文件按只读方式呈现：禁用保存 / 另存为 / 从 VS Code 打开 / 下载，
     避免把有损解码后的文本写回或导出。 */
  function applyReadOnlyState() {
    if (state.cm) state.cm.setOption('readOnly', state.readOnly);
    for (const button of [dom.save, dom.saveAs, dom.openVSCode, dom.download, dom.replaceOne, dom.replaceAll]) {
      if (button) button.disabled = state.readOnly;
    }
  }

  async function loadFile() {
    setStatus(i18n.t('editor.loading'));
    const info = await window.ships.fileEditor.info();
    if (!info || !info.ok) {
      setStatus(i18n.t('editor.loadFailed', { error: 'info' }), 'is-error');
      return;
    }
    state.path = info.path || '';
    state.name = info.name || state.path.split('/').pop() || 'Untitled';
    state.reference = info.reference || state.path;
    const read = await window.ships.fileEditor.read();
    if (!read || !read.ok) {
      setStatus(i18n.t('editor.loadFailed', { error: (read && read.error) || 'read' }), 'is-error');
      return;
    }
    const sep = detectSeparator(read.content);
    state.separator = sep.separator;
    state.separatorLabel = sep.label;
    state.original = normalize(read.content);
    state.sizeBytes = Number(read.size) || 0;
    state.binary = Boolean(read.binary);
    state.readOnly = state.binary;
    state.mode = modeForName(state.name);
    state.modeLabel = labelForMode(state.mode, state.name);
    try {
      await ensureMode(state.mode);
    } catch (err) {
      state.mode = '';
      state.modeLabel = i18n.t('editor.plainText');
    }
    state.dirty = false;
    createEditor(state.mode, state.original);
    applyReadOnlyState();
    setStatus(state.binary ? i18n.t('editor.binaryReadOnly') : '');
  }

  async function save() {
    if (!state.cm || state.saving) return false;
    if (state.readOnly) {
      setStatus(i18n.t('editor.binaryReadOnly'));
      return false;
    }
    state.saving = true;
    setStatus(i18n.t('editor.saving'));
    let result = null;
    try {
      result = await window.ships.fileEditor.save(serialize());
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    state.saving = false;
    if (result && result.ok) {
      state.original = state.cm.getValue('\n');
      state.sizeBytes = Number(result.bytes) || docByteLength();
      state.dirty = false;
      setStatus('');
      renderStatus();
      return true;
    }
    setStatus(i18n.t('editor.saveFailed', { error: (result && result.error) || 'error' }), 'is-error');
    renderStatus();
    return false;
  }

  function closeModal() {
    dom.modal.hidden = true;
  }

  function saveAs() {
    if (!state.cm) return;
    if (state.readOnly) {
      setStatus(i18n.t('editor.binaryReadOnly'));
      return;
    }
    dom.modalTitle.textContent = i18n.t('editor.saveAsTitle');
    dom.modalInput.placeholder = i18n.t('editor.saveAsPlaceholder');
    dom.modalInput.value = state.path;
    dom.modalCancel.textContent = i18n.t('editor.cancel');
    dom.modalConfirm.textContent = i18n.t('editor.confirm');
    dom.modal.hidden = false;
    dom.modalInput.focus();
    dom.modalInput.select();
  }

  async function saveAsTo(nextPath) {
    if (!state.cm || state.saving) return;
    if (state.readOnly) {
      setStatus(i18n.t('editor.binaryReadOnly'));
      return;
    }
    const value = String(nextPath || '').trim();
    if (!value.startsWith('/')) {
      setStatus(i18n.t('editor.badPath'), 'is-error');
      return;
    }
    state.saving = true;
    setStatus(i18n.t('editor.saving'));
    let result = null;
    try {
      result = await window.ships.fileEditor.saveAs(value, serialize());
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    state.saving = false;
    if (result && result.ok) {
      state.path = value;
      state.name = value.split('/').pop() || value;
      state.mode = modeForName(state.name);
      state.modeLabel = labelForMode(state.mode, state.name);
      try {
        await ensureMode(state.mode);
        state.cm.setOption('mode', state.mode || null);
      } catch (err) {
        state.mode = '';
        state.cm.setOption('mode', null);
      }
      state.original = state.cm.getValue('\n');
      state.sizeBytes = Number(result.bytes) || docByteLength();
      state.dirty = false;
      const info = await window.ships.fileEditor.info();
      if (info && info.ok) state.reference = info.reference || state.path;
      setStatus('');
    } else {
      setStatus(i18n.t('editor.saveFailed', { error: (result && result.error) || 'error' }), 'is-error');
    }
    renderStatus();
  }

  async function openInVSCode() {
    if (!state.cm || state.saving || state.downloading) return;
    if (state.readOnly) {
      setStatus(i18n.t('editor.binaryReadOnly'));
      return;
    }
    state.downloading = true;
    setStatus(i18n.t('editor.downloading'));
    let result = null;
    try {
      result = await window.ships.fileEditor.openVSCode({ content: serialize(), name: state.name });
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    state.downloading = false;
    if (result && result.ok) setStatus(i18n.t('editor.openedVSCode', { path: result.path }), 'is-success');
    else setStatus(i18n.t('editor.downloadFailed', { error: (result && result.error) || 'error' }), 'is-error');
  }

  async function downloadToLocal() {
    if (!state.cm || state.saving || state.downloading) return;
    if (state.readOnly) {
      setStatus(i18n.t('editor.binaryReadOnly'));
      return;
    }
    state.downloading = true;
    setStatus(i18n.t('editor.downloading'));
    let result = null;
    try {
      result = await window.ships.fileEditor.download({ content: serialize(), name: state.name });
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    state.downloading = false;
    if (result && result.ok) setStatus(i18n.t('editor.downloaded', { path: result.path }), 'is-success');
    else setStatus(i18n.t('editor.downloadFailed', { error: (result && result.error) || 'error' }), 'is-error');
  }

  async function reload() {
    if (!state.cm) return;
    if (state.dirty && !window.confirm(i18n.t('editor.reloadConfirm'))) return;
    const read = await window.ships.fileEditor.read();
    if (!read || !read.ok) {
      setStatus(i18n.t('editor.loadFailed', { error: (read && read.error) || 'read' }), 'is-error');
      return;
    }
    const sep = detectSeparator(read.content);
    state.separator = sep.separator;
    state.separatorLabel = sep.label;
    state.original = normalize(read.content);
    state.sizeBytes = Number(read.size) || 0;
    state.binary = Boolean(read.binary);
    state.readOnly = state.binary;
    state.dirty = false;
    state.cm.setValue(state.original);
    applyReadOnlyState();
    setStatus(state.binary ? i18n.t('editor.binaryReadOnly') : '');
  }

  function setIconButton(button, icon, tipKey) {
    if (!button) return;
    button.innerHTML = icon(15);
    button.setAttribute('data-tip', i18n.t(tipKey));
    button.setAttribute('aria-label', i18n.t(tipKey));
  }

  function applyLocale() {
    setIconButton(dom.save, Icons.save, 'editor.save');
    setIconButton(dom.saveAs, Icons.saveAs, 'editor.saveAs');
    setIconButton(dom.openVSCode, Icons.code, 'editor.openVSCode');
    setIconButton(dom.download, Icons.download, 'editor.download');
    setIconButton(dom.reload, Icons.refresh, 'editor.reload');
    setIconButton(dom.undo, Icons.undo, 'editor.undo');
    setIconButton(dom.redo, Icons.redo, 'editor.redo');
    setIconButton(dom.wrap, Icons.wrap, state.wrap ? 'editor.wrapOff' : 'editor.wrapOn');
    if (dom.findLabel) dom.findLabel.textContent = i18n.t('editor.findLabel');
    if (dom.findInput) dom.findInput.placeholder = i18n.t('editor.findLabel');
    if (dom.replaceLabel) dom.replaceLabel.textContent = i18n.t('editor.replaceLabel');
    if (dom.replaceInput) dom.replaceInput.placeholder = i18n.t('editor.replaceLabel');
    setIconButton(dom.findPrev, Icons.chevronUp, 'editor.findPrev');
    setIconButton(dom.findNext, Icons.chevronDown, 'editor.findNext');
    setIconButton(dom.findClose, Icons.x, 'editor.findClose');
    setIconButton(dom.findCase, Icons.caseSensitive, 'editor.caseSensitive');
    if (dom.findRegex) {
      dom.findRegex.setAttribute('data-tip', i18n.t('editor.regex'));
      dom.findRegex.setAttribute('aria-label', i18n.t('editor.regex'));
    }
    if (dom.replaceOne) dom.replaceOne.textContent = i18n.t('editor.replaceOne');
    if (dom.replaceAll) dom.replaceAll.textContent = i18n.t('editor.replaceAll');
    state.modeLabel = labelForMode(state.mode, state.name);
    renderStatus();
    updateFindCount();
  }

  dom.save.addEventListener('click', () => save());
  dom.saveAs.addEventListener('click', () => saveAs());
  dom.openVSCode.addEventListener('click', () => openInVSCode());
  dom.download.addEventListener('click', () => downloadToLocal());
  dom.reload.addEventListener('click', () => reload());
  dom.undo.addEventListener('click', () => state.cm && state.cm.undo());
  dom.redo.addEventListener('click', () => state.cm && state.cm.redo());
  dom.wrap.addEventListener('click', () => {
    state.wrap = !state.wrap;
    if (state.cm) state.cm.setOption('lineWrapping', state.wrap);
    const tipKey = state.wrap ? 'editor.wrapOff' : 'editor.wrapOn';
    dom.wrap.setAttribute('data-tip', i18n.t(tipKey));
    dom.wrap.setAttribute('aria-label', i18n.t(tipKey));
  });

  /* 查找 / 替换面板交互 */
  if (dom.findInput) {
    dom.findInput.addEventListener('input', () => {
      state.find.query = dom.findInput.value;
      refreshFind();
    });
    dom.findInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        findStep(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeFind();
      }
    });
  }
  if (dom.replaceInput) {
    dom.replaceInput.addEventListener('input', () => {
      state.find.replace = dom.replaceInput.value;
    });
    dom.replaceInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        replaceOne();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeFind();
      }
    });
  }
  if (dom.findPrev) dom.findPrev.addEventListener('click', () => findStep(-1));
  if (dom.findNext) dom.findNext.addEventListener('click', () => findStep(1));
  if (dom.findClose) dom.findClose.addEventListener('click', closeFind);
  if (dom.findCase) {
    dom.findCase.addEventListener('click', () => {
      state.find.caseSensitive = !state.find.caseSensitive;
      dom.findCase.setAttribute('aria-pressed', String(state.find.caseSensitive));
      refreshFind();
    });
  }
  if (dom.findRegex) {
    dom.findRegex.addEventListener('click', () => {
      state.find.regex = !state.find.regex;
      dom.findRegex.setAttribute('aria-pressed', String(state.find.regex));
      refreshFind();
    });
  }
  if (dom.replaceOne) dom.replaceOne.addEventListener('click', replaceOne);
  if (dom.replaceAll) dom.replaceAll.addEventListener('click', replaceAll);

  dom.modalCancel.addEventListener('click', closeModal);
  dom.modalConfirm.addEventListener('click', () => {
    const value = dom.modalInput.value;
    closeModal();
    saveAsTo(value);
  });
  dom.modalInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      dom.modalConfirm.click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
    }
  });
  dom.modal.addEventListener('mousedown', (event) => {
    if (event.target === dom.modal) closeModal();
  });

  window.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = String(event.key || '').toLowerCase();
    // Command + F：打开查找（已打开时聚焦并全选关键词）；Command + G / Shift + G：下一个 / 上一个。
    if (mod && key === 'f') {
      event.preventDefault();
      openFind(false);
      return;
    }
    if (mod && key === 'g') {
      event.preventDefault();
      findStep(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'Escape' && state.find.visible && dom.modal.hidden) {
      event.preventDefault();
      closeFind();
      return;
    }
    if (!mod) return;
    if (key === 's') {
      event.preventDefault();
      if (event.shiftKey) saveAs();
      else save();
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  async function boot() {
    let settings = null;
    try {
      settings = await window.ships.getSettings();
    } catch (err) {
      settings = null;
    }
    i18n.setLocale((settings && settings.locale) || 'zh');
    window.ShipsTheme.set({ theme: 'light', accent: (settings && settings.accent) || '#2e6bfc' });
    applyLocale();
    await loadFile();
    applyLocale();
    window.ships.onSettingsChanged((next) => {
      i18n.setLocale((next && next.locale) || 'zh');
      window.ShipsTheme.set({ theme: 'light', accent: (next && next.accent) || '#2e6bfc' });
      applyLocale();
    });
  }

  boot().catch((err) => {
    setStatus(i18n.t('editor.loadFailed', { error: err.message }), 'is-error');
  });
})();
