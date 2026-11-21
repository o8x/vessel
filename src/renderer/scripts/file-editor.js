'use strict';

/* Lightweight built-in editor window (CodeMirror 5). Opened from the file
   manager for any file ≤ 8 MB; reuses the file manager's SFTP session so saving
   writes straight back to the remote file. Binary files open read-only. */

(function bootstrapFileEditor() {
  const i18n = window.ShipsI18n;
  const { Icons, el, escapeHtml } = window.ShipsUI;

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
        openLocal: '打开本地文件',
        openLocalFailed: '打开失败：{error}',
        openLocalTooLarge: '文件超过 8 MB，请在 VS Code 中打开',
        openLocalConfirm: '当前文件有未保存修改，确定放弃并打开其他文件？',
        preview: 'Markdown 预览',
        previewOn: '关闭预览',
        previewOff: '显示 Markdown 预览',
        previewOnlyMarkdown: '仅 Markdown 文件支持预览（保存为 .md 后可用）',
        previewEmpty: '（没有内容）',
        linesOff: '隐藏行号',
        linesOn: '显示行号',
        more: '更多命令',
        goToLine: '转到行…',
        goToLineTitle: '转到行',
        goToLinePlaceholder: '行号（1 – {max}）',
        goToLineBad: '行号无效',
        duplicateLine: '复制当前行',
        deleteLine: '删除当前行',
        moveLineUp: '上移当前行',
        moveLineDown: '下移当前行',
        toggleComment: '切换注释',
        trimTrailing: '去除行尾空白',
        trimTrailingDone: '已去除行尾空白',
        indent2: '缩进 2 个空格',
        indent4: '缩进 4 个空格',
        fontBigger: '放大字号',
        fontSmaller: '缩小字号',
        fontReset: '重置字号',
        copyImage: '导出图片',
        copiedImage: '已复制为图片',
        copyImageFailed: '复制图片失败：{error}',
        copyImageEmpty: '没有可复制的内容',
        imageExport: '导出 Markdown 图片',
        imageWidth: '宽度',
        imageDpi: 'DPI',
        imagePadding: '留白',
        imageHint: '宽度为 CSS 布局宽度；DPI 150 时最终像素宽 = 宽度 × 150 / 96。',
        imageRendering: '渲染中…',
        imageRenderFailed: '渲染失败：{error}',
        imageReady: '{width} × {height} px',
        imageDownload: '下载',
        imageDownloading: '下载中…',
        imageDownloaded: '已保存到 {path}',
        imageDownloadFailed: '保存失败：{error}',
        imageCopy: '复制',
        imageCopied: '已复制到剪贴板',
        imageCopyFailed: '复制失败：{error}',
        imageClose: '关闭',
        recoveryTitle: '发现未保存的恢复副本',
        recoveryHint: '上次退出时该文件有未保存的修改。可按时间选择一个版本恢复到编辑器中（本地最多保留最近 5 份）。',
        recoveryRestore: '恢复所选版本',
        recoveryDiscard: '忽略并删除',
        recoveryItem: '{time} · {size}',
        recoveryRestored: '已恢复 {time} 的副本，保存前仍是未保存状态',
        recoveryCleared: '已删除恢复副本',
        menuSeparator: '—',
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
        openLocal: 'Open local file',
        openLocalFailed: 'Open failed: {error}',
        openLocalTooLarge: 'File is larger than 8 MB; open it in VS Code',
        openLocalConfirm: 'This file has unsaved changes. Discard them and open another file?',
        preview: 'Markdown preview',
        previewOn: 'Hide preview',
        previewOff: 'Show Markdown preview',
        previewOnlyMarkdown: 'Preview is available for Markdown files only (save as .md to enable)',
        previewEmpty: '(empty)',
        linesOff: 'Hide line numbers',
        linesOn: 'Show line numbers',
        more: 'More commands',
        goToLine: 'Go to line…',
        goToLineTitle: 'Go to line',
        goToLinePlaceholder: 'Line number (1 – {max})',
        goToLineBad: 'Invalid line number',
        duplicateLine: 'Duplicate line',
        deleteLine: 'Delete line',
        moveLineUp: 'Move line up',
        moveLineDown: 'Move line down',
        toggleComment: 'Toggle comment',
        trimTrailing: 'Trim trailing whitespace',
        trimTrailingDone: 'Trailing whitespace trimmed',
        indent2: 'Indent: 2 spaces',
        indent4: 'Indent: 4 spaces',
        fontBigger: 'Increase font size',
        fontSmaller: 'Decrease font size',
        fontReset: 'Reset font size',
        copyImage: 'Export image',
        copiedImage: 'Copied as image',
        copyImageFailed: 'Copy image failed: {error}',
        copyImageEmpty: 'Nothing to copy',
        imageExport: 'Export Markdown image',
        imageWidth: 'Width',
        imageDpi: 'DPI',
        imagePadding: 'Padding',
        imageHint: 'Width is the CSS layout width; at 150 DPI the output pixel width = width × 150 / 96.',
        imageRendering: 'Rendering…',
        imageRenderFailed: 'Render failed: {error}',
        imageReady: '{width} × {height} px',
        imageDownload: 'Download',
        imageDownloading: 'Downloading…',
        imageDownloaded: 'Saved to {path}',
        imageDownloadFailed: 'Save failed: {error}',
        imageCopy: 'Copy',
        imageCopied: 'Copied to clipboard',
        imageCopyFailed: 'Copy failed: {error}',
        imageClose: 'Close',
        recoveryTitle: 'Unsaved recovery found',
        recoveryHint: 'This file had unsaved changes when the editor last closed. Pick a version by time to restore it (the last 5 local copies are kept).',
        recoveryRestore: 'Restore selected',
        recoveryDiscard: 'Ignore and delete',
        recoveryItem: '{time} · {size}',
        recoveryRestored: 'Restored the {time} copy; it is still unsaved',
        recoveryCleared: 'Recovery copies deleted',
        menuSeparator: '—',
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
    open: document.getElementById('ed-open'),
    save: document.getElementById('ed-save'),
    saveAs: document.getElementById('ed-save-as'),
    openVSCode: document.getElementById('ed-open-vscode'),
    download: document.getElementById('ed-download'),
    reload: document.getElementById('ed-reload'),
    undo: document.getElementById('ed-undo'),
    redo: document.getElementById('ed-redo'),
    wrap: document.getElementById('ed-wrap'),
    preview: document.getElementById('ed-preview'),
    lines: document.getElementById('ed-lines'),
    more: document.getElementById('ed-more'),
    fontSmaller: document.getElementById('ed-font-smaller'),
    fontBigger: document.getElementById('ed-font-bigger'),
    copyImage: document.getElementById('ed-copy-image'),
    recovery: document.getElementById('ed-recovery'),
    recoveryTitle: document.getElementById('ed-recovery-title'),
    recoveryHint: document.getElementById('ed-recovery-hint'),
    recoveryList: document.getElementById('ed-recovery-list'),
    recoveryDiscard: document.getElementById('ed-recovery-discard'),
    recoveryRestore: document.getElementById('ed-recovery-restore'),
    imageModal: document.getElementById('ed-image-modal'),
    imageTitle: document.getElementById('ed-image-title'),
    imagePreview: document.getElementById('ed-image-preview'),
    imageNote: document.getElementById('ed-image-note'),
    imageWidthLabel: document.getElementById('ed-image-width-label'),
    imageWidth: document.getElementById('ed-image-width'),
    imageDpiLabel: document.getElementById('ed-image-dpi-label'),
    imageDpi: document.getElementById('ed-image-dpi'),
    imagePaddingLabel: document.getElementById('ed-image-padding-label'),
    imagePadding: document.getElementById('ed-image-padding'),
    imageHint: document.getElementById('ed-image-hint'),
    imageClose: document.getElementById('ed-image-close'),
    imageDownload: document.getElementById('ed-image-download'),
    imageCopy: document.getElementById('ed-image-copy'),
    menu: document.getElementById('ed-menu'),
    split: document.getElementById('editor-split'),
    previewPane: document.getElementById('ed-preview-pane'),
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
    // 本地文件（终端内联命令 \v edit 创建）：读写走本地 fs，另存为拉起系统保存面板。
    local: false,
    wrap: false,
    // 显示行号（默认开）与 Markdown 预览（打开 / 另存为 .md 时自动开启）。
    lineNumbers: true,
    previewOn: false,
    previewTimer: null,
    // 编辑器字号（Cmd +/- 调整，仅当前窗口生效）。
    fontSize: 13,
    statusText: '',
    statusKind: '',
    cm: null,
    sizeBytes: 0,
    sizeTimer: null,
    // 本地恢复副本：有未保存修改时定时保存，关闭 / 重新打开时可按时间恢复。
    backupTimer: null,
    lastBackupContent: '',
    dirtySent: false,
    recovery: { items: [], selected: -1 },
    // Markdown 图片导出：预览参数与最近一次渲染结果。
    imageExport: { width: 600, dpi: 150, padding: 32, dataUrl: '', widthPx: 0, heightPx: 0, timer: null, rendering: false },
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

  /* ------------------------------ Markdown 预览 ------------------------------
     只渲染受支持的语法：文件里的原始 HTML 一律转义（不执行标签，避免从远端打开的
     md 注入脚本）；链接 / 图片只保留 http(s)、mailto 与相对路径，其余丢弃。 */
  const SAFE_HREF = /^(https?:|mailto:)/i;

  function safeHref(href) {
    const value = String(href == null ? '' : href).trim();
    if (!value) return '';
    if (SAFE_HREF.test(value)) return value;
    if (/^[#/.]/.test(value)) return value;
    return '';
  }

  function safeImageSrc(src) {
    const value = String(src == null ? '' : src).trim();
    if (/^https?:/i.test(value)) return value;
    if (/^data:image\//i.test(value)) return value;
    // 相对路径（如 ![](images/a.png)）一并保留，渲染后按当前文件目录解析。
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '';
    return value;
  }

  /* 把预览里的相对图片路径解析成可加载的 file:// 地址（仅本地文件可解析）。
     远端文件没有可访问的本地目录，相对图片保持原样（可能显示为破图）。 */
  function resolvePreviewImage(img) {
    const raw = String(img.getAttribute('src') || '');
    if (!raw) return;
    if (/^(https?:|data:|file:)/i.test(raw)) return;
    if (!state.local || !state.path) return;
    const slash = state.path.lastIndexOf('/');
    if (slash < 0) return;
    const dir = state.path.slice(0, slash + 1);
    try {
      img.src = new URL(raw, `file://${encodeURI(dir)}`).href;
    } catch (err) {
      /* 非法路径保持原样 */
    }
  }

  function fixPreviewImages(pane) {
    if (!pane) return;
    for (const img of pane.querySelectorAll('img')) resolvePreviewImage(img);
  }

  let markdownReady = false;
  function setupMarkdown() {
    const marked = window.marked;
    if (!marked || typeof marked.use !== 'function') return;
    marked.use({
      gfm: true,
      breaks: false,
      renderer: {
        // 原始 HTML（块级 / 行内）一律按文本显示
        html(token) {
          return escapeHtml(token && token.text != null ? token.text : '');
        },
        link(token) {
          const href = safeHref(token.href);
          const text = token.text != null ? token.text : escapeHtml(token.href || '');
          if (!href) return text;
          return `<a href="${escapeHtml(href)}" rel="noreferrer">${text}</a>`;
        },
        image(token) {
          const src = safeImageSrc(token.href);
          const alt = escapeHtml(token.text || '');
          if (!src) return alt;
          return `<img src="${escapeHtml(src)}" alt="${alt}" />`;
        },
      },
    });
    markdownReady = true;
  }

  function isMarkdownFile() {
    return state.mode === 'markdown';
  }

  function markdownHtml(source) {
    if (!markdownReady) setupMarkdown();
    const marked = window.marked;
    if (!marked || typeof marked.parse !== 'function') {
      return `<pre>${escapeHtml(source)}</pre>`;
    }
    try {
      return marked.parse(String(source || ''));
    } catch (err) {
      return `<pre>${escapeHtml(source)}</pre>`;
    }
  }

  function renderPreview() {
    if (!state.previewOn || !state.cm || !dom.previewPane) return;
    const source = state.cm.getValue('\n');
    const pane = dom.previewPane;
    if (!source.trim()) {
      pane.innerHTML = `<div class="editor-preview-empty">${escapeHtml(i18n.t('editor.previewEmpty'))}</div>`;
      return;
    }
    pane.innerHTML = markdownHtml(source);
    fixPreviewImages(pane);
  }

  function schedulePreview() {
    if (!state.previewOn) return;
    if (state.previewTimer) clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(() => {
      state.previewTimer = null;
      renderPreview();
    }, 300);
  }

  function setPreview(on) {
    const next = Boolean(on) && isMarkdownFile();
    state.previewOn = next;
    if (dom.previewPane) dom.previewPane.hidden = !next;
    if (dom.split) dom.split.classList.toggle('preview-on', next);
    if (next) renderPreview();
    updateToggleTips();
    requestAnimationFrame(() => {
      if (state.cm) state.cm.refresh();
    });
  }

  /* ------------------------------ Markdown 图片导出 ------------------------------
     点击工具栏按钮先打开预览弹窗，可调宽度 / DPI / 留白；预览由主进程离屏渲染，
     复制写入剪贴板，下载保存到设置里的文件下载目录。 */
  function closeImageExport() {
    if (!dom.imageModal) return;
    if (state.imageExport.timer) {
      clearTimeout(state.imageExport.timer);
      state.imageExport.timer = null;
    }
    dom.imageModal.hidden = true;
  }

  function imageModalNote(text, isError) {
    if (!dom.imageNote) return;
    dom.imageNote.textContent = text || '';
    dom.imageNote.classList.toggle('is-error', Boolean(isError));
  }

  function readImageOptions() {
    const clamp = (value, min, max, fallback) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return fallback;
      return Math.min(max, Math.max(min, Math.round(num)));
    };
    const opts = {
      width: clamp(dom.imageWidth.value, 200, 2400, 600),
      dpi: clamp(dom.imageDpi.value, 72, 600, 150),
      padding: clamp(dom.imagePadding.value, 0, 200, 32),
    };
    dom.imageWidth.value = String(opts.width);
    dom.imageDpi.value = String(opts.dpi);
    dom.imagePadding.value = String(opts.padding);
    Object.assign(state.imageExport, opts);
    return opts;
  }

  let imageRenderSeq = 0;

  async function renderImageNow() {
    if (!state.cm || !dom.previewPane) return { ok: false, error: 'empty' };
    const seq = ++imageRenderSeq;
    const opts = readImageOptions();
    state.imageExport.rendering = true;
    if (dom.imageDownload) dom.imageDownload.disabled = true;
    if (dom.imageCopy) dom.imageCopy.disabled = true;
    imageModalNote(i18n.t('editor.imageRendering'));
    let result = null;
    try {
      result = await window.ships.fileEditor.renderImage(dom.previewPane.innerHTML, opts);
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    if (seq !== imageRenderSeq) return result; // 有更新的渲染请求，丢弃旧结果
    state.imageExport.rendering = false;
    if (dom.imageDownload) dom.imageDownload.disabled = false;
    if (dom.imageCopy) dom.imageCopy.disabled = false;
    if (result && result.ok) {
      state.imageExport.dataUrl = result.dataUrl;
      state.imageExport.widthPx = result.width;
      state.imageExport.heightPx = result.height;
      if (dom.imagePreview) {
        dom.imagePreview.src = result.dataUrl;
        dom.imagePreview.hidden = false;
      }
      imageModalNote(i18n.t('editor.imageReady', { width: result.width, height: result.height }));
    } else {
      state.imageExport.dataUrl = '';
      if (dom.imagePreview) {
        dom.imagePreview.hidden = true;
        dom.imagePreview.removeAttribute('src');
      }
      imageModalNote(
        i18n.t('editor.imageRenderFailed', { error: (result && result.error) || 'error' }),
        true
      );
    }
    return result;
  }

  function scheduleImageRender() {
    if (state.imageExport.timer) clearTimeout(state.imageExport.timer);
    state.imageExport.timer = setTimeout(() => {
      state.imageExport.timer = null;
      renderImageNow();
    }, 300);
  }

  async function openImageExport() {
    if (!state.previewOn || !dom.previewPane || !dom.imageModal) {
      setStatus(i18n.t('editor.copyImageEmpty'));
      return;
    }
    if (!state.cm || !state.cm.getValue('\n').trim()) {
      setStatus(i18n.t('editor.copyImageEmpty'));
      return;
    }
    dom.imageWidth.value = String(state.imageExport.width);
    dom.imageDpi.value = String(state.imageExport.dpi);
    dom.imagePadding.value = String(state.imageExport.padding);
    dom.imagePreview.hidden = true;
    dom.imagePreview.removeAttribute('src');
    dom.imageModal.hidden = false;
    renderImageNow();
  }

  async function downloadImage() {
    const result = await renderImageNow();
    if (!result || !result.ok) return;
    let saved = null;
    try {
      saved = await window.ships.fileEditor.saveImage(result.dataUrl, state.name);
    } catch (err) {
      saved = { ok: false, error: err.message };
    }
    if (saved && saved.ok) {
      imageModalNote(i18n.t('editor.imageDownloaded', { path: saved.path }));
      setStatus(i18n.t('editor.imageDownloaded', { path: saved.path }), 'is-success');
    } else {
      const text = i18n.t('editor.imageDownloadFailed', { error: (saved && saved.error) || 'error' });
      imageModalNote(text, true);
      setStatus(text, 'is-error');
    }
  }

  async function copyImageToClipboard() {
    const result = await renderImageNow();
    if (!result || !result.ok) return;
    let copied = null;
    try {
      copied = await window.ships.copyImage(result.dataUrl);
    } catch (err) {
      copied = { ok: false, error: err.message };
    }
    if (copied && copied.ok) {
      imageModalNote(i18n.t('editor.imageCopied'));
      setStatus(i18n.t('editor.copiedImage'), 'is-success');
    } else {
      const text = i18n.t('editor.imageCopyFailed', { error: (copied && copied.error) || 'error' });
      imageModalNote(text, true);
      setStatus(text, 'is-error');
    }
  }

  /* ------------------------------ 编辑器命令 ------------------------------ */

  const FONT_MIN = 10;
  const FONT_MAX = 28;

  function setLineNumbers(on) {
    state.lineNumbers = Boolean(on);
    if (state.cm) state.cm.setOption('lineNumbers', state.lineNumbers);
    updateToggleTips();
  }

  function setTabSize(size) {
    if (!state.cm) return;
    const value = Number(size) === 4 ? 4 : 2;
    state.cm.setOption('tabSize', value);
    state.cm.setOption('indentUnit', value);
  }

  function zoomFont(delta) {
    const next = Math.max(FONT_MIN, Math.min(FONT_MAX, state.fontSize + delta));
    if (next === state.fontSize) return;
    state.fontSize = next;
    applyFontSize();
  }

  function resetFontSize() {
    state.fontSize = 13;
    applyFontSize();
  }

  function applyFontSize() {
    if (!state.cm) return;
    state.cm.getWrapperElement().style.fontSize = `${state.fontSize}px`;
    state.cm.refresh();
  }

  function duplicateLine() {
    const cm = state.cm;
    if (!cm) return;
    const cursor = cm.getCursor();
    const line = cm.getLine(cursor.line);
    cm.replaceRange(`\n${line}`, { line: cursor.line, ch: line.length });
    cm.setCursor({ line: cursor.line + 1, ch: cursor.ch });
  }

  function deleteLine() {
    const cm = state.cm;
    if (!cm) return;
    const cursor = cm.getCursor();
    const count = cm.lineCount();
    if (count <= 1) {
      cm.setValue('');
      return;
    }
    if (cursor.line === count - 1) {
      const prevLength = cm.getLine(cursor.line - 1).length;
      cm.replaceRange(
        '',
        { line: cursor.line - 1, ch: prevLength },
        { line: cursor.line, ch: cm.getLine(cursor.line).length }
      );
    } else {
      cm.replaceRange('', { line: cursor.line, ch: 0 }, { line: cursor.line + 1, ch: 0 });
    }
  }

  function moveLine(direction) {
    const cm = state.cm;
    if (!cm) return;
    const cursor = cm.getCursor();
    const target = cursor.line + direction;
    if (target < 0 || target >= cm.lineCount()) return;
    const current = cm.getLine(cursor.line);
    const other = cm.getLine(target);
    cm.operation(() => {
      cm.replaceRange(other, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: current.length });
      cm.replaceRange(current, { line: target, ch: 0 }, { line: target, ch: other.length });
    });
    cm.setCursor({ line: target, ch: cursor.ch });
  }

  function toggleComment() {
    const cm = state.cm;
    if (!cm || typeof cm.toggleComment !== 'function') return;
    try {
      cm.toggleComment();
    } catch (err) {
      /* 该语言没有注释配置时忽略 */
    }
  }

  function trimTrailingWhitespace() {
    const cm = state.cm;
    if (!cm) return;
    const total = cm.lineCount();
    let changed = 0;
    cm.operation(() => {
      for (let index = 0; index < total; index += 1) {
        const line = cm.getLine(index);
        const trimmed = line.replace(/[ \t]+$/, '');
        if (trimmed === line) continue;
        // 只删除行尾空白：把 [trimmed.length, line.length) 区间替换成空串。
        cm.replaceRange('', { line: index, ch: trimmed.length }, { line: index, ch: line.length });
        changed += 1;
      }
    });
    if (changed) setStatus(i18n.t('editor.trimTrailingDone'), 'is-success');
  }

  function goToLine() {
    if (!state.cm) return;
    openModal({
      title: i18n.t('editor.goToLineTitle'),
      placeholder: i18n.t('editor.goToLinePlaceholder', { max: state.cm.lineCount() }),
      value: String(state.cm.getCursor().line + 1),
      onConfirm: (value) => {
        const line = parseInt(String(value).trim(), 10);
        if (!Number.isFinite(line) || line < 1 || line > state.cm.lineCount()) {
          setStatus(i18n.t('editor.goToLineBad'), 'is-error');
          return;
        }
        state.cm.setCursor({ line: line - 1, ch: 0 });
        state.cm.focus();
      },
    });
  }

  /* 打开本地文件：拉起系统打开面板，把当前窗口切换到该文件。 */
  async function openLocalFile() {
    if (!window.ships.fileEditor || typeof window.ships.fileEditor.openLocal !== 'function') return;
    if (state.dirty && !window.confirm(i18n.t('editor.openLocalConfirm'))) return;
    let result = null;
    try {
      result = await window.ships.fileEditor.openLocal();
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    if (!result || result.canceled) return;
    if (!result.ok) {
      setStatus(
        result.error === 'too-large'
          ? i18n.t('editor.openLocalTooLarge')
          : i18n.t('editor.openLocalFailed', { error: result.error || 'error' }),
        'is-error'
      );
      return;
    }
    // 换文件：先清空当前编辑器实例，再按新路径重新加载
    state.dirty = false;
    state.previewOn = false;
    if (state.previewTimer) {
      clearTimeout(state.previewTimer);
      state.previewTimer = null;
    }
    if (state.cm) state.cm = null;
    if (dom.host) dom.host.innerHTML = '';
    if (dom.previewPane) dom.previewPane.hidden = true;
    if (dom.split) dom.split.classList.remove('preview-on');
    closeRecovery();
    await loadFile();
    applyLocale();
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
    notifyDirty();
  }

  /* 把未保存状态同步给主进程：关闭窗口时据此弹出二次确认。 */
  function notifyDirty() {
    if (state.dirty === state.dirtySent) return;
    state.dirtySent = state.dirty;
    try {
      window.ships.fileEditor.setDirty(state.dirty).catch(() => {});
    } catch (err) {
      /* 忽略：主进程未注册时不影响编辑 */
    }
  }

  /* ------------------------------ 本地恢复副本 ------------------------------
     有未保存修改时，每隔 EDITOR_BACKUP_INTERVAL_MS 写一份本地副本（主进程只保留
     最近 5 份）。正常保存后清空；意外关闭后重新打开该文件时提示按时间恢复。 */
  function backupIfNeeded() {
    if (!state.cm || state.readOnly || !state.dirty) return;
    const content = state.cm.getValue('\n');
    if (!content || content === state.lastBackupContent) return;
    state.lastBackupContent = content;
    window.ships.fileEditor.backup(content).catch(() => {
      state.lastBackupContent = '';
    });
  }

  function startBackupTimer() {
    if (state.backupTimer) clearInterval(state.backupTimer);
    const interval = (window.ShipsConstants && window.ShipsConstants.EDITOR_BACKUP_INTERVAL_MS) || 30000;
    state.backupTimer = setInterval(backupIfNeeded, interval);
  }

  function clearBackups() {
    state.lastBackupContent = '';
    try {
      window.ships.fileEditor.clearBackups().catch(() => {});
    } catch (err) {
      /* ignore */
    }
  }

  function formatBackupTime(time) {
    try {
      return new Date(time).toLocaleString();
    } catch (err) {
      return String(time);
    }
  }

  function renderRecoveryList() {
    if (!dom.recoveryList) return;
    dom.recoveryList.innerHTML = '';
    state.recovery.items.forEach((item, index) => {
      const button = el('button', {
        class: `editor-recovery-item${index === state.recovery.selected ? ' is-active' : ''}`,
        type: 'button',
      });
      button.appendChild(el('span', { class: 'editor-recovery-time' }, formatBackupTime(item.time)));
      button.appendChild(el('span', { class: 'editor-recovery-size' }, formatBytes(item.size)));
      button.addEventListener('click', () => {
        state.recovery.selected = index;
        renderRecoveryList();
      });
      dom.recoveryList.appendChild(button);
    });
  }

  function closeRecovery() {
    if (dom.recovery) dom.recovery.hidden = true;
    state.recovery.items = [];
    state.recovery.selected = -1;
  }

  /* 打开文件后检查是否有上次意外退出留下的恢复副本。 */
  async function checkRecovery() {
    if (!window.ships.fileEditor || typeof window.ships.fileEditor.backups !== 'function') return;
    let result = null;
    try {
      result = await window.ships.fileEditor.backups();
    } catch (err) {
      return;
    }
    if (!result || !result.ok || !result.items || !result.items.length) return;
    state.recovery.items = result.items;
    state.recovery.selected = 0;
    if (!dom.recovery) return;
    dom.recoveryTitle.textContent = i18n.t('editor.recoveryTitle');
    dom.recoveryHint.textContent = i18n.t('editor.recoveryHint');
    dom.recoveryDiscard.textContent = i18n.t('editor.recoveryDiscard');
    dom.recoveryRestore.textContent = i18n.t('editor.recoveryRestore');
    renderRecoveryList();
    dom.recovery.hidden = false;
  }

  async function restoreSelectedBackup() {
    const item = state.recovery.items[state.recovery.selected];
    if (!item || !state.cm) return;
    let result = null;
    try {
      result = await window.ships.fileEditor.readBackup(item.id);
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    if (!result || !result.ok) {
      setStatus(i18n.t('editor.loadFailed', { error: (result && result.error) || 'error' }), 'is-error');
      return;
    }
    state.cm.setValue(normalize(result.content));
    syncDirty();
    closeRecovery();
    setStatus(i18n.t('editor.recoveryRestored', { time: formatBackupTime(item.time) }), 'is-success');
  }

  function discardRecovery() {
    clearBackups();
    closeRecovery();
    setStatus(i18n.t('editor.recoveryCleared'), 'is-success');
  }

  function createEditor(mode, value) {
    const wrap = state.wrap;
    state.cm = window.CodeMirror(dom.host, {
      value,
      mode: mode || null,
      lineNumbers: state.lineNumbers,
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
        'Cmd-/': toggleComment,
        'Ctrl-/': toggleComment,
        'Alt-Up': () => moveLine(-1),
        'Alt-Down': () => moveLine(1),
      },
    });
    state.cm.on('change', () => {
      syncDirty();
      scheduleFindRefresh();
      schedulePreview();
    });
    state.cm.on('cursorActivity', renderStatus);
    applyFontSize();
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
    state.local = Boolean(info.local);
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
    state.dirtySent = true;
    state.lastBackupContent = '';
    createEditor(state.mode, state.original);
    notifyDirty();
    applyReadOnlyState();
    // Markdown 文件默认打开预览（要求：打开 md 即可预览）；其他文件关闭预览。
    setPreview(isMarkdownFile());
    setStatus(state.binary ? i18n.t('editor.binaryReadOnly') : '');
    void checkRecovery();
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
      state.dirtySent = true;
      notifyDirty();
      clearBackups();
      setStatus('');
      renderStatus();
      return true;
    }
    setStatus(i18n.t('editor.saveFailed', { error: (result && result.error) || 'error' }), 'is-error');
    renderStatus();
    return false;
  }

  /* 模态输入框：通用（另存为远端路径 / 转到行共用），确认时调用当前 action。 */
  let modalAction = null;

  function openModal(config) {
    const options = config || {};
    dom.modalTitle.textContent = options.title || '';
    dom.modalInput.placeholder = options.placeholder || '';
    dom.modalInput.value = options.value || '';
    dom.modalCancel.textContent = i18n.t('editor.cancel');
    dom.modalConfirm.textContent = i18n.t('editor.confirm');
    modalAction = typeof options.onConfirm === 'function' ? options.onConfirm : null;
    dom.modal.hidden = false;
    dom.modalInput.focus();
    dom.modalInput.select();
  }

  function closeModal() {
    dom.modal.hidden = true;
    modalAction = null;
  }

  function saveAs() {
    if (!state.cm) return;
    if (state.readOnly) {
      setStatus(i18n.t('editor.binaryReadOnly'));
      return;
    }
    // 本地文件：拉起系统保存面板（Finder 样式）选位置，不弹路径输入框。
    if (state.local) {
      void saveAsTo('');
      return;
    }
    openModal({
      title: i18n.t('editor.saveAsTitle'),
      placeholder: i18n.t('editor.saveAsPlaceholder'),
      value: state.path,
      onConfirm: (value) => saveAsTo(value),
    });
  }

  async function saveAsTo(nextPath) {
    if (!state.cm || state.saving) return;
    if (state.readOnly) {
      setStatus(i18n.t('editor.binaryReadOnly'));
      return;
    }
    const value = state.local ? '' : String(nextPath || '').trim();
    if (!state.local && !value.startsWith('/')) {
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
    if (result && result.canceled) {
      setStatus('');
      renderStatus();
      return;
    }
    if (result && result.ok) {
      const nextPath2 = state.local ? String(result.path || '') : value;
      state.path = nextPath2;
      state.name = nextPath2.split('/').pop() || nextPath2;
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
      state.dirtySent = true;
      notifyDirty();
      clearBackups();
      const info = await window.ships.fileEditor.info();
      if (info && info.ok) state.reference = info.reference || state.path;
      // 另存为 .md（或其他 Markdown 扩展名）后自动打开预览。
      setPreview(isMarkdownFile());
      applyLocale();
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
    state.dirtySent = true;
    notifyDirty();
    clearBackups();
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

  /* 状态型按钮（自动换行 / 预览 / 行号）的提示与高亮。 */
  function updateToggleTips() {
    if (dom.wrap) {
      const key = state.wrap ? 'editor.wrapOff' : 'editor.wrapOn';
      dom.wrap.setAttribute('data-tip', i18n.t(key));
      dom.wrap.setAttribute('aria-label', i18n.t(key));
      dom.wrap.style.color = state.wrap ? 'var(--color-accent)' : '';
    }
    if (dom.lines) {
      const key = state.lineNumbers ? 'editor.linesOff' : 'editor.linesOn';
      dom.lines.setAttribute('data-tip', i18n.t(key));
      dom.lines.setAttribute('aria-label', i18n.t(key));
      dom.lines.style.color = state.lineNumbers ? 'var(--color-accent)' : '';
    }
    if (dom.preview) {
      const key = state.previewOn ? 'editor.previewOn' : 'editor.previewOff';
      dom.preview.setAttribute('data-tip', i18n.t(key));
      dom.preview.setAttribute('aria-label', i18n.t(key));
      dom.preview.style.color = state.previewOn ? 'var(--color-accent)' : '';
      dom.preview.disabled = !isMarkdownFile();
    }
    if (dom.copyImage) {
      dom.copyImage.disabled = !state.previewOn;
      dom.copyImage.style.opacity = state.previewOn ? '' : '0.4';
    }
  }

  /* ------------------------------ 更多命令菜单 ------------------------------ */

  function closeMenu() {
    if (!dom.menu || dom.menu.hidden) return;
    dom.menu.hidden = true;
    dom.menu.innerHTML = '';
    document.removeEventListener('mousedown', onMenuDown, true);
    window.removeEventListener('blur', closeMenu);
    window.removeEventListener('resize', closeMenu);
  }

  function onMenuDown(event) {
    if (!dom.menu) return;
    if (dom.menu.contains(event.target) || (dom.more && dom.more.contains(event.target))) return;
    closeMenu();
  }

  function menuItems() {
    return [
      { label: i18n.t('editor.goToLine'), hint: '⌘L', run: goToLine },
      { separator: true },
      { label: i18n.t('editor.duplicateLine'), hint: '⌘D', run: duplicateLine },
      { label: i18n.t('editor.deleteLine'), hint: '⌘⇧K', run: deleteLine },
      { label: i18n.t('editor.moveLineUp'), hint: '⌥↑', run: () => moveLine(-1) },
      { label: i18n.t('editor.moveLineDown'), hint: '⌥↓', run: () => moveLine(1) },
      { label: i18n.t('editor.toggleComment'), hint: '⌘/', run: toggleComment },
      { label: i18n.t('editor.trimTrailing'), run: trimTrailingWhitespace },
      { separator: true },
      { label: i18n.t('editor.indent2'), run: () => setTabSize(2) },
      { label: i18n.t('editor.indent4'), run: () => setTabSize(4) },
      { label: i18n.t('editor.linesOff'), run: () => setLineNumbers(!state.lineNumbers) },
    ];
  }

  function openMenu() {
    if (!dom.menu || !dom.more) return;
    dom.menu.innerHTML = '';
    for (const item of menuItems()) {
      if (item.separator) {
        dom.menu.appendChild(el('div', { class: 'editor-menu-sep' }));
        continue;
      }
      const button = el('button', { class: 'editor-menu-item', type: 'button' });
      button.appendChild(el('span', {}, item.label));
      if (item.hint) button.appendChild(el('span', { class: 'editor-menu-hint' }, item.hint));
      button.addEventListener('click', () => {
        closeMenu();
        item.run();
      });
      dom.menu.appendChild(button);
    }
    dom.menu.hidden = false;
    const rect = dom.more.getBoundingClientRect();
    const width = dom.menu.offsetWidth;
    const left = Math.max(6, Math.min(rect.right - width, window.innerWidth - width - 6));
    dom.menu.style.left = `${left}px`;
    dom.menu.style.top = `${rect.bottom + 4}px`;
    document.addEventListener('mousedown', onMenuDown, true);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
  }

  function applyLocale() {
    setIconButton(dom.open, Icons.folder, 'editor.openLocal');
    setIconButton(dom.save, Icons.save, 'editor.save');
    setIconButton(dom.saveAs, Icons.saveAs, 'editor.saveAs');
    setIconButton(dom.openVSCode, Icons.code, 'editor.openVSCode');
    setIconButton(dom.download, Icons.download, 'editor.download');
    setIconButton(dom.reload, Icons.refresh, 'editor.reload');
    setIconButton(dom.undo, Icons.undo, 'editor.undo');
    setIconButton(dom.redo, Icons.redo, 'editor.redo');
    setIconButton(dom.preview, Icons.eye, 'editor.preview');
    setIconButton(dom.lines, Icons.hash, 'editor.linesOff');
    setIconButton(dom.copyImage, Icons.image, 'editor.copyImage');
    if (dom.fontSmaller) {
      dom.fontSmaller.setAttribute('data-tip', i18n.t('editor.fontSmaller'));
      dom.fontSmaller.setAttribute('aria-label', i18n.t('editor.fontSmaller'));
    }
    if (dom.fontBigger) {
      dom.fontBigger.setAttribute('data-tip', i18n.t('editor.fontBigger'));
      dom.fontBigger.setAttribute('aria-label', i18n.t('editor.fontBigger'));
    }
    setIconButton(dom.more, Icons.chevronDown, 'editor.more');
    updateToggleTips();
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
    if (dom.imageTitle) dom.imageTitle.textContent = i18n.t('editor.imageExport');
    if (dom.imageWidthLabel) dom.imageWidthLabel.textContent = i18n.t('editor.imageWidth');
    if (dom.imageDpiLabel) dom.imageDpiLabel.textContent = i18n.t('editor.imageDpi');
    if (dom.imagePaddingLabel) dom.imagePaddingLabel.textContent = i18n.t('editor.imagePadding');
    if (dom.imageHint) dom.imageHint.textContent = i18n.t('editor.imageHint');
    if (dom.imageClose) dom.imageClose.textContent = i18n.t('editor.imageClose');
    if (dom.imageDownload) dom.imageDownload.textContent = i18n.t('editor.imageDownload');
    if (dom.imageCopy) dom.imageCopy.textContent = i18n.t('editor.imageCopy');
    state.modeLabel = labelForMode(state.mode, state.name);
    renderStatus();
    updateFindCount();
  }

  dom.open.addEventListener('click', () => openLocalFile());
  dom.save.addEventListener('click', () => save());
  dom.saveAs.addEventListener('click', () => saveAs());
  dom.openVSCode.addEventListener('click', () => openInVSCode());
  dom.download.addEventListener('click', () => downloadToLocal());
  dom.reload.addEventListener('click', () => reload());
  dom.undo.addEventListener('click', () => state.cm && state.cm.undo());
  dom.redo.addEventListener('click', () => state.cm && state.cm.redo());
  if (dom.more) dom.more.addEventListener('click', () => (dom.menu && dom.menu.hidden ? openMenu() : closeMenu()));
  if (dom.fontSmaller) dom.fontSmaller.addEventListener('click', () => zoomFont(-1));
  if (dom.fontBigger) dom.fontBigger.addEventListener('click', () => zoomFont(1));
  if (dom.copyImage) dom.copyImage.addEventListener('click', () => openImageExport());
  if (dom.preview) {
    dom.preview.addEventListener('click', () => setPreview(!state.previewOn));
  }
  if (dom.lines) {
    dom.lines.addEventListener('click', () => setLineNumbers(!state.lineNumbers));
  }
  // 预览里的链接交给系统浏览器打开（不在应用内导航）。
  if (dom.previewPane) {
    dom.previewPane.addEventListener('click', (event) => {
      const link = event.target && event.target.closest ? event.target.closest('a') : null;
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute('href') || '';
      if (href && window.ships.openExternal) window.ships.openExternal(href);
    });
  }
  dom.wrap.addEventListener('click', () => {
    state.wrap = !state.wrap;
    if (state.cm) state.cm.setOption('lineWrapping', state.wrap);
    updateToggleTips();
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
    const action = modalAction;
    closeModal();
    if (action) action(value);
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
  if (dom.recoveryRestore) dom.recoveryRestore.addEventListener('click', () => restoreSelectedBackup());
  if (dom.recoveryDiscard) dom.recoveryDiscard.addEventListener('click', () => discardRecovery());
  if (dom.imageClose) dom.imageClose.addEventListener('click', () => closeImageExport());
  if (dom.imageDownload) dom.imageDownload.addEventListener('click', () => downloadImage());
  if (dom.imageCopy) dom.imageCopy.addEventListener('click', () => copyImageToClipboard());
  for (const input of [dom.imageWidth, dom.imageDpi, dom.imagePadding]) {
    if (input) input.addEventListener('input', scheduleImageRender);
  }
  if (dom.imageModal) {
    dom.imageModal.addEventListener('mousedown', (event) => {
      if (event.target === dom.imageModal) closeImageExport();
    });
  }

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
    if (event.key === 'Escape' && dom.imageModal && !dom.imageModal.hidden) {
      event.preventDefault();
      closeImageExport();
      return;
    }
    if (event.key === 'Escape' && state.find.visible && dom.modal.hidden) {
      event.preventDefault();
      closeFind();
      return;
    }
    if (event.key === 'Escape' && dom.menu && !dom.menu.hidden) {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (!mod) return;
    if (key === 's') {
      event.preventDefault();
      if (event.shiftKey) saveAs();
      else save();
      return;
    }
    // 编辑器命令：转到行 / 复制行 / 删除行 / 切换注释 / 字号缩放
    if (key === 'l' && !event.shiftKey) {
      event.preventDefault();
      goToLine();
      return;
    }
    if (key === 'd' && !event.shiftKey) {
      event.preventDefault();
      duplicateLine();
      return;
    }
    if (key === 'k' && event.shiftKey) {
      event.preventDefault();
      deleteLine();
      return;
    }
    if (key === '/') {
      event.preventDefault();
      toggleComment();
      return;
    }
    if (key === '=' || key === '+') {
      event.preventDefault();
      zoomFont(1);
      return;
    }
    if (key === '-') {
      event.preventDefault();
      zoomFont(-1);
      return;
    }
    if (key === '0') {
      event.preventDefault();
      resetFontSize();
    }
  });

  // 退出确认由主进程负责（见 window-manager 的 close 处理），这里只维护恢复副本定时器。
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
    startBackupTimer();
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
