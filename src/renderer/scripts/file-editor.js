'use strict';

/* Lightweight built-in text editor window (CodeMirror 5). Opened from the file
   manager for text files < 2 MB; reuses the file manager's SFTP session so saving
   writes straight back to the remote file. */

(function bootstrapFileEditor() {
  const i18n = window.ShipsI18n;

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
    wrap: false,
    statusText: '',
    statusKind: '',
    cm: null,
    sizeBytes: 0,
    sizeTimer: null,
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
    document.title = `${state.name || 'Vessel Editor'}${state.dirty ? ' •' : ''} — Vessel Editor`;
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
    if (state.dirty) {
      if (state.statusKind !== 'is-error') setStatus(i18n.t('editor.unsaved'), 'is-dirty');
    } else if (state.statusKind === 'is-dirty') {
      setStatus('');
    }
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
    state.cm.on('change', syncDirty);
    state.cm.on('cursorActivity', renderStatus);
    renderStatus();
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
    setStatus('');
  }

  async function save() {
    if (!state.cm || state.saving) return false;
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
      const time = new Date().toLocaleTimeString();
      setStatus(`${i18n.t('editor.saved')} ${time}`, 'is-success');
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
      const time = new Date().toLocaleTimeString();
      setStatus(`${i18n.t('editor.saved')} ${time}`, 'is-success');
    } else {
      setStatus(i18n.t('editor.saveFailed', { error: (result && result.error) || 'error' }), 'is-error');
    }
    renderStatus();
  }

  async function ensureSaved() {
    if (!state.dirty) return true;
    return save();
  }

  async function openInVSCode() {
    if (!state.cm || state.saving || state.downloading) return;
    if (!(await ensureSaved())) return;
    state.downloading = true;
    setStatus(i18n.t('editor.downloading'));
    let result = null;
    try {
      result = await window.ships.fileEditor.openVSCode();
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    state.downloading = false;
    if (result && result.ok) setStatus(i18n.t('editor.openedVSCode', { path: result.path }), 'is-success');
    else setStatus(i18n.t('editor.downloadFailed', { error: (result && result.error) || 'error' }), 'is-error');
  }

  async function downloadToLocal() {
    if (!state.cm || state.saving || state.downloading) return;
    if (!(await ensureSaved())) return;
    state.downloading = true;
    setStatus(i18n.t('editor.downloading'));
    let result = null;
    try {
      result = await window.ships.fileEditor.download();
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
    state.dirty = false;
    state.cm.setValue(state.original);
    setStatus('');
  }

  function applyLocale() {
    dom.save.textContent = i18n.t('editor.save');
    dom.saveAs.textContent = i18n.t('editor.saveAs');
    dom.openVSCode.textContent = i18n.t('editor.openVSCode');
    dom.download.textContent = i18n.t('editor.download');
    dom.reload.textContent = i18n.t('editor.reload');
    dom.undo.textContent = i18n.t('editor.undo');
    dom.redo.textContent = i18n.t('editor.redo');
    dom.wrap.textContent = i18n.t(state.wrap ? 'editor.wrapOff' : 'editor.wrapOn');
    state.modeLabel = labelForMode(state.mode, state.name);
    renderStatus();
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
    dom.wrap.textContent = i18n.t(state.wrap ? 'editor.wrapOff' : 'editor.wrapOn');
  });

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
    if (!mod) return;
    const key = String(event.key || '').toLowerCase();
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

  window.ships.sftp.onProgress((payload) => {
    if (!state.downloading || !payload || payload.direction !== 'download') return;
    if (payload.name && state.name !== payload.name) return;
    const percent = payload.total ? Math.min(100, Math.round((payload.transferred / payload.total) * 100)) : 0;
    setStatus(`${i18n.t('editor.downloading')} ${percent}%`);
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
