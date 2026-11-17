'use strict';

/* 文件传输窗口（穿梭框）：左右两栏各一个 SSH 连接，中间是穿梭按钮与「同步」开关。
   - 顶部下拉选择主机后自动连接并加载目录树；
   - 每栏是**可折叠的目录 / 文件树**（与文件管理器的目录树一致，含 loading 指示）；
   - 勾选「同步」后立即把两边定位到同一目录，之后**双击进入目录**时另一侧同步跟随；
   - 选中文件 / 文件夹后点穿梭按钮，传输到另一栏的当前目录；
   - 底部状态栏显示实时进度；同一时刻只传输一个对象。 */

(function bootstrapTransferWindow() {
  const { Icons, el, createSelect } = window.ShipsUI;
  const i18n = window.ShipsI18n;
  const constants = window.ShipsConstants || {};
  const FILE_TYPE_ICONS = constants.FILE_TYPE_ICONS || {};
  const FILE_NAME_ICONS = constants.FILE_NAME_ICONS || {};
  const DEFAULT_FILE_ICON = constants.DEFAULT_FILE_ICON || 'file';
  const NON_TEXT_EXTENSIONS = new Set(constants.NON_TEXT_EXTENSIONS || []);
  const WIRESHARK_EXTENSIONS = new Set(constants.WIRESHARK_EXTENSIONS || []);
  const EDITOR_MAX_BYTES = constants.FILE_EDITOR_MAX_BYTES || 8 * 1024 * 1024;

  i18n.extend({
    zh: {
      transferWin: {
        title: '文件传输',
        sshPlaceholder: '选择已保存的主机',
        left: '左侧',
        right: '右侧',
        sync: '同步',
        syncTip: '勾选后立即把两边定位到同一目录；之后双击进入目录时另一侧同步跟随',
        toRight: '传输到右侧',
        toLeft: '传输到左侧',
        name: '文件名',
        empty: '空目录',
        notConnected: '未连接',
        connecting: '正在连接 {target}…',
        connected: '已连接 {target}',
        connectFailed: '{target} 连接失败：{error}',
        listFailed: '{target} 无法列出目录内容',
        loadFailed: '{target} 无法读取目录：{error}',
        copyPath: '复制路径',
        copyReference: '复制引用',
        copiedPath: '已复制路径：{path}',
        copiedReference: '已复制引用：{reference}',
        copyFailed: '复制失败',
        transferStart: '{target} 开始传输 {name}',
        transferDone: '{target} 已传输 {name}（{bytes}）',
        transferFailed: '{target} 传输失败：{error}',
        transferBusy: '已有传输任务在进行中',
        needSelection: '请先在树中选择一个文件或文件夹',
        needTarget: '目标一端尚未连接',
        download: '下载到本地',
        downloadDone: '已下载到 {path}',
        downloadFailed: '下载失败：{error}',
        openFinder: '从 Finder 打开',
        openExplorer: '在资源管理器中显示',
        openFileManager: '从文件管理器打开',
        openVSCode: '从 VS Code 打开',
        openWireshark: '从 Wireshark 打开',
        editFile: '编辑文件',
        editFailed: '无法打开编辑器：{error}',
        opened: '已在文件管理器中定位 {path}',
        openedVSCode: '已用 VS Code 打开 {path}',
        openedWireshark: '已用 Wireshark 打开 {path}',
        home: '家目录',
        refresh: '刷新',
        ungrouped: '未分组',
        pathPlaceholder: '输入远端路径，回车进入',
      },
    },
    en: {
      transferWin: {
        title: 'File Transfer',
        sshPlaceholder: 'Choose a saved host',
        left: 'Left',
        right: 'Right',
        sync: 'Sync',
        syncTip: 'When enabled both sides jump to the same folder right away; later, entering a folder on one side moves the other one too',
        toRight: 'Transfer to right',
        toLeft: 'Transfer to left',
        name: 'Name',
        empty: 'Empty directory',
        notConnected: 'Not connected',
        connecting: 'Connecting {target}…',
        connected: 'Connected to {target}',
        connectFailed: '{target} connect failed: {error}',
        listFailed: '{target} cannot list the directory',
        loadFailed: '{target} cannot read the folder: {error}',
        copyPath: 'Copy path',
        copyReference: 'Copy reference',
        copiedPath: 'Copied path: {path}',
        copiedReference: 'Copied reference: {reference}',
        copyFailed: 'Copy failed',
        transferStart: '{target} transferring {name}',
        transferDone: '{target} transferred {name} ({bytes})',
        transferFailed: '{target} transfer failed: {error}',
        transferBusy: 'Another transfer is already running',
        needSelection: 'Select a file or folder in the tree first',
        needTarget: 'The other side is not connected',
        download: 'Download to local',
        downloadDone: 'Saved to {path}',
        downloadFailed: 'Download failed: {error}',
        openFinder: 'Reveal in Finder',
        openExplorer: 'Show in Explorer',
        openFileManager: 'Open from file manager',
        openVSCode: 'Open from VS Code',
        openWireshark: 'Open from Wireshark',
        editFile: 'Edit file',
        editFailed: 'Cannot open editor: {error}',
        opened: 'Revealed in Finder: {path}',
        openedVSCode: 'Opened in VS Code: {path}',
        openedWireshark: 'Opened in Wireshark: {path}',
        home: 'Home',
        refresh: 'Refresh',
        ungrouped: 'Ungrouped',
        pathPlaceholder: 'Type a remote path, press Enter',
      },
    },
  });

  const STATUS_TTL_MS = 30000;
  const PLATFORM = window.shipsPlatform || '';

  function joinPath(dir, name) {
    const base = String(dir || '/');
    return base === '/' ? `/${name}` : `${base.replace(/\/$/, '')}/${name}`;
  }

  function baseName(path) {
    const value = String(path || '');
    const index = value.lastIndexOf('/');
    return index >= 0 ? value.slice(index + 1) : value;
  }

  function formatSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value)) return '';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function iconFor(name) {
    const lower = String(name || '').toLowerCase();
    if (FILE_NAME_ICONS[lower]) return FILE_NAME_ICONS[lower];
    const dot = lower.lastIndexOf('.');
    if (dot > 0 && dot < lower.length - 1) {
      const icon = FILE_TYPE_ICONS[lower.slice(dot + 1)];
      if (icon) return icon;
    }
    return DEFAULT_FILE_ICON;
  }

  function entryExtension(entry) {
    const name = String((entry && entry.name) || '').toLowerCase();
    const dot = name.lastIndexOf('.');
    return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : '';
  }

  function isBinaryEntry(entry) {
    return NON_TEXT_EXTENSIONS.has(entryExtension(entry));
  }

  function isEditorEntry(entry) {
    return (Number(entry && entry.size) || 0) <= EDITOR_MAX_BYTES;
  }

  function isWiresharkEntry(entry) {
    if (!WIRESHARK_EXTENSIONS.has(entryExtension(entry))) return false;
    return (Number(entry && entry.size) || 0) <= 4 * 1024 * 1024 * 1024;
  }

  function nativeOpenLabel() {
    if (PLATFORM === 'win32') return i18n.t('transferWin.openExplorer');
    if (PLATFORM === 'darwin') return i18n.t('transferWin.openFinder');
    return i18n.t('transferWin.openFileManager');
  }

  const dom = {
    left: document.getElementById('transfer-pane-left'),
    right: document.getElementById('transfer-pane-right'),
    divider: document.getElementById('transfer-divider'),
    statusPath: document.getElementById('transfer-status-path'),
    statusMsg: document.getElementById('transfer-status-msg'),
    progress: document.getElementById('transfer-progress'),
    progressFill: document.getElementById('transfer-progress-fill'),
  };

  const state = {
    hosts: [],
    sync: false,
    transferring: false,
    panes: {},
  };

  /* 连接目标的显示名：优先「用户名@地址」（与 SSH 列表一致），否则用别名。 */
  function targetLabel(pane) {
    const target = String((pane && pane.target) || '');
    if (!target) return '';
    const host = state.hosts.find((item) => item.alias === target);
    if (!host) return target;
    return host.user ? `${host.user}@${host.hostName}` : String(host.hostName || target);
  }

  let statusTimer = null;
  function setStatus(message, isError) {
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    dom.statusMsg.textContent = message || '';
    dom.statusMsg.style.color = isError ? 'var(--color-danger)' : '';
    if (message) {
      try {
        if (window.ships && window.ships.log) window.ships.log(`[transfer] ${message}`);
      } catch (err) {
        /* ignore */
      }
      statusTimer = setTimeout(() => {
        statusTimer = null;
        dom.statusMsg.textContent = '';
        dom.statusMsg.style.color = '';
      }, STATUS_TTL_MS);
    }
  }

  function setProgress(value) {
    if (value == null) {
      dom.progress.classList.add('hidden');
      dom.progressFill.style.width = '0%';
      return;
    }
    dom.progress.classList.remove('hidden');
    const percent = value.total ? Math.min(100, Math.max(0, (value.transferred / value.total) * 100)) : 0;
    dom.progressFill.style.width = `${percent.toFixed(0)}%`;
  }

  /* ------------------------------- 右键菜单 ------------------------------- */
  let contextMenu = null;
  function closeContextMenu() {
    if (!contextMenu) return;
    contextMenu.remove();
    contextMenu = null;
  }
  function openContextMenu(x, y, items) {
    closeContextMenu();
    const menu = el('div', { class: 'fm-menu' });
    for (const item of items) {
      const btn = el('button', { class: 'fm-menu-item', type: 'button' });
      const icon = el('span', { class: 'term-menu-icon' });
      if (item.icon && Icons[item.icon]) icon.innerHTML = Icons[item.icon](13);
      btn.appendChild(icon);
      btn.appendChild(el('span', { class: 'term-menu-label' }, item.label));
      if (item.disabled) {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
      } else {
        btn.addEventListener('click', () => {
          closeContextMenu();
          item.run();
        });
      }
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
    contextMenu = menu;
  }
  document.addEventListener(
    'mousedown',
    (event) => {
      if (contextMenu && !contextMenu.contains(event.target)) closeContextMenu();
    },
    true
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') closeContextMenu();
    },
    true
  );

  /* -------------------------------- 一栏 --------------------------------- */
  function createPane(side, root, options) {
    const paneOpts = options || {};
    const pane = {
      side,
      target: '',
      id: '',
      connected: false,
      connecting: false,
      home: '',
      cwd: '',
      // 目录树：path -> 子项（目录 + 文件）；展开集合；加载中的目录（显示旋转 loading）。
      children: new Map(),
      expanded: new Set(),
      loading: new Map(),
      selected: null,
      picker: null,
    };

    const head = el('div', { class: 'transfer-pane-head' });
    const pickerHost = el('div', { class: 'transfer-pane-picker' });
    const pathRow = el('div', { class: 'fm-path-row' });
    const treeEl = el('div', { class: 'fm-tree' });
    const wrap = el('div', { class: 'transfer-pane' });
    wrap.append(head, pathRow, treeEl);
    root.appendChild(wrap);

    const homeBtn = el('button', { class: 'icon-btn fm-path-btn', type: 'button', 'data-tip': i18n.t('transferWin.home') });
    homeBtn.innerHTML = Icons.home(14);
    const refreshBtn = el('button', { class: 'icon-btn fm-path-btn', type: 'button', 'data-tip': i18n.t('transferWin.refresh') });
    refreshBtn.innerHTML = Icons.refresh(14);
    const pathInput = el('input', {
      class: 'fm-path-input',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: i18n.t('transferWin.pathPlaceholder'),
    });
    pathRow.append(homeBtn, refreshBtn, pathInput);

    /* ------------------------------ 目录树 ------------------------------ */
    function makeRow(entry, path, depth) {
      const isDir = entry.type === 'dir';
      const expanded = isDir && pane.expanded.has(path);
      const row = el('div', { class: 'fm-tree-row', style: `padding-left:${6 + depth * 14}px` });
      row.dataset.path = path;
      const caret = el('span', { class: `fm-tree-caret${expanded ? ' open' : ''}` });
      if (isDir) {
        caret.innerHTML = Icons.caretRight(11);
        caret.addEventListener('click', (event) => {
          event.stopPropagation();
          toggleExpand(path);
        });
      }
      const icon = el('span', { class: 'fm-tree-icon' });
      icon.innerHTML = isDir ? Icons.folder(13) : (Icons[iconFor(entry.name)] || Icons.file)(13);
      const label = el('span', { class: 'fm-tree-label' }, '');
      label.textContent = entry.name;
      row.append(caret, icon, label);
      // 正在加载该目录的子项：名称右侧显示旋转 loading。
      if (pane.loading.has(path)) row.appendChild(el('span', { class: 'fm-tree-spinner' }));
      if (pane.selected && pane.selected.path === path) row.classList.add('selected');
      if (pane.cwd === path) row.classList.add('current');

      row.addEventListener('click', () => {
        selectEntry({ path, name: entry.name, type: entry.type, size: entry.size });
        // 点击目录 = 展开 / 折叠（**不触发同步**；同步只在双击「进入」时发生）。
        if (isDir) toggleExpand(path);
      });
      row.addEventListener('dblclick', () => {
        if (isDir) {
          // 子项还在加载时**不响应双击**（避免重复进入 / 进入未加载完的目录）。
          if (pane.loading.has(path)) return;
          enter(path);
          return;
        }
        openEntry(pane, { path, name: entry.name, type: entry.type, size: entry.size });
      });
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        selectEntry({ path, name: entry.name, type: entry.type, size: entry.size });
        openContextMenu(event.clientX, event.clientY, contextItems(pane, { path, name: entry.name, type: entry.type, size: entry.size }));
      });
      return row;
    }

    function renderTree() {
      treeEl.innerHTML = '';
      if (!pane.connected) {
        treeEl.appendChild(el('div', { class: 'fm-list-hint' }, i18n.t('transferWin.notConnected')));
        return;
      }
      const render = (entry, path, depth) => {
        treeEl.appendChild(makeRow(entry, path, depth));
        if (entry.type !== 'dir' || !pane.expanded.has(path)) return;
        const kids = pane.children.get(path) || [];
        for (const kid of kids) render(kid, joinPath(path, kid.name), depth + 1);
      };
      render({ name: '/', type: 'dir' }, '/', 0);
    }

    /* 把当前目录行滚动到可见位置（同步 / 进入目录后调用）。 */
    function scrollCurrentIntoView() {
      const node = treeEl.querySelector('.fm-tree-row.current');
      if (!node) return;
      const treeRect = treeEl.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      if (nodeRect.top < treeRect.top) {
        treeEl.scrollTop -= treeRect.top - nodeRect.top + 8;
      } else if (nodeRect.bottom > treeRect.bottom) {
        treeEl.scrollTop += nodeRect.bottom - treeRect.bottom + 8;
      }
    }

    function selectEntry(item) {
      pane.selected = item;
      for (const node of treeEl.querySelectorAll('.fm-tree-row[data-path]')) {
        node.classList.toggle('selected', node.dataset.path === item.path);
      }
      }

    function beginLoading(path) {
      if (!path) return;
      pane.loading.set(path, (pane.loading.get(path) || 0) + 1);
      renderTree();
    }

    function endLoading(path) {
      if (!path) return;
      const count = (pane.loading.get(path) || 0) - 1;
      if (count > 0) pane.loading.set(path, count);
      else pane.loading.delete(path);
      renderTree();
    }

    /* 读取某个目录的内容（目录 + 文件），带 loading 指示与缓存。 */
    async function ensureChildren(path) {
      if (pane.children.has(path)) return pane.children.get(path);
      beginLoading(path);
      try {
        const result = await window.ships.sftp.list(pane.id, path);
        if (!result || !result.ok) {
          setStatus(i18n.t('transferWin.listFailed', { target: targetLabel(pane) }), true);
          pane.children.set(path, []);
          return [];
        }
        const entries = result.entries || [];
        pane.children.set(path, entries);
        return entries;
      } catch (err) {
        setStatus(i18n.t('transferWin.loadFailed', { target: targetLabel(pane), error: err.message }), true);
        pane.children.set(path, []);
        return [];
      } finally {
        endLoading(path);
      }
    }

    function toggleExpand(path) {
      if (pane.expanded.has(path)) {
        pane.expanded.delete(path);
        renderTree();
        return;
      }
      pane.expanded.add(path);
      renderTree();
      ensureChildren(path).then(() => {
        if (pane.expanded.has(path)) renderTree();
      });
    }

    /* 进入目录：设为当前目录（传输目标目录）+ 展开 + 同步另一侧。 */
    async function enter(path) {
      if (!pane.connected) return false;
      const target = String(path || '');
      if (!target) return false;
      pane.cwd = target;
      pathInput.value = target;
      dom.statusPath.textContent = target;
      pane.expanded.add(target);
      await ensureChildren(target);
      // 展开祖先目录，保证该目录在树中可见。
      const parts = target.split('/').filter(Boolean);
      let current = '';
      for (const part of parts) {
        current = current === '' ? `/${part}` : `${current}/${part}`;
        pane.expanded.add(current);
        if (!pane.children.has(current)) await ensureChildren(current);
      }
      pane.expanded.add('/');
      renderTree();
      // 当前目录滚动到可见位置。
      scrollCurrentIntoView();
      if (state.sync) syncTo(side, target);
      return true;
    }

    async function connect(target) {
      if (!target) return false;
      if (pane.id) {
        window.ships.sftp.close(pane.id);
        pane.id = '';
      }
      pane.target = target;
      pane.connected = false;
      pane.connecting = true;
      setStatus(i18n.t('transferWin.connecting', { target: targetLabel(pane) }), false);
      const result = await window.ships.sftp.connect({ target });
      pane.connecting = false;
      if (!result || !result.ok) {
        setStatus(
          i18n.t('transferWin.connectFailed', { target: targetLabel(pane), error: (result && result.error) || 'error' }),
          true
        );
        renderTree();
        return false;
      }
      pane.id = result.id;
      pane.connected = true;
      pane.home = result.home || '/';
      pane.children = new Map();
      pane.expanded = new Set();
      pane.loading = new Map();
      pane.selected = null;
      setStatus(i18n.t('transferWin.connected', { target: targetLabel(pane) }), false);
      // 展开根目录并进入家目录。
      pane.expanded.add('/');
      await ensureChildren('/');
      await enter(pane.home);
        return true;
    }

    function select(target) {
      pane.target = target || '';
      if (!pane.target) return Promise.resolve(false);
      // 刷新下拉选项（当前目标不在已保存主机里时也补一项），再连接。
      refreshPickers();
      return connect(pane.target);
    }

    homeBtn.addEventListener('click', () => {
      if (pane.home) enter(pane.home);
    });
    refreshBtn.addEventListener('click', () => {
      if (!pane.connected) return;
      pane.children.delete(pane.cwd);
      ensureChildren(pane.cwd).then(() => renderTree());
    });
    pathInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const value = pathInput.value.trim();
        if (value) enter(value);
      }
    });

    // 初始渲染（未连接时显示提示）。
    renderTree();

    pane.picker = createSelect({
      options: [],
      value: '',
      placeholder: i18n.t('transferWin.sshPlaceholder'),
      align: 'left',
      className: 'select-compact transfer-ssh-select',
      matchTrigger: true,
      onChange: (alias) => select(alias),
    });
    pickerHost.appendChild(pane.picker.el);
    head.appendChild(pickerHost);
    // 「同步」开关放在**左侧栏**的 SSH 下拉右侧（中间不再有按钮区）。
    if (paneOpts.withSync) {
      const syncBtn = el('button', { class: 'transfer-sync', type: 'button' });
      const syncIcon = el('span', { class: 'transfer-sync-icon' });
      syncIcon.innerHTML = Icons.refresh(13);
      const syncLabel = el('span', { class: 'transfer-sync-label' }, i18n.t('transferWin.sync'));
      syncBtn.append(syncIcon, syncLabel);
      syncBtn.setAttribute('data-tip', i18n.t('transferWin.syncTip'));
      syncBtn.addEventListener('click', async () => {
        state.sync = !state.sync;
        syncBtn.classList.toggle('on', state.sync);
        // 勾选后立即把两边定位到同一目录。
        if (state.sync) await syncNow();
      });
      pane.syncBtn = syncBtn;
      head.appendChild(syncBtn);
    }

    pane.renderTree = renderTree;
    pane.enter = enter;
    pane.connect = connect;
    pane.select = select;
    pane.ensureChildren = ensureChildren;
    return pane;
  }

  /* 右键菜单：传输到对侧 + 与文件管理器一致的文件操作（编辑 / Finder / VS Code /
     Wireshark / 下载 / 复制路径 / 复制引用）。 */
  function contextItems(pane, item) {
    const other = state.panes[pane.side === 'left' ? 'right' : 'left'];
    const toOther = pane.side === 'left' ? i18n.t('transferWin.toRight') : i18n.t('transferWin.toLeft');
    const isFile = item.type !== 'dir';
    const items = [
      {
        label: toOther,
        icon: 'transfer',
        disabled: !other || !other.connected,
        run: () => transferSelection(pane, other),
      },
    ];
    if (isFile) {
      items.push({
        label: i18n.t('transferWin.editFile'),
        icon: 'edit',
        disabled: !isEditorEntry(item),
        run: () => openInEditor(pane, item),
      });
      items.push({ label: nativeOpenLabel(), icon: 'folder', run: () => openFiles(pane, item) });
      items.push({
        label: i18n.t('transferWin.openVSCode'),
        icon: 'code',
        disabled: isBinaryEntry(item),
        run: () => openFilesVSCode(pane, item),
      });
      if (WIRESHARK_EXTENSIONS.has(entryExtension(item))) {
        items.push({
          label: i18n.t('transferWin.openWireshark'),
          icon: 'globe',
          disabled: !isWiresharkEntry(item),
          run: () => openFilesWireshark(pane, item),
        });
      }
      items.push({ label: i18n.t('transferWin.download'), icon: 'download', run: () => downloadFile(pane, item) });
    }
    items.push(
      { label: i18n.t('transferWin.copyPath'), icon: 'copy', run: () => copyPath(pane, [item.path]) },
      { label: i18n.t('transferWin.copyReference'), icon: 'copy', run: () => copyReference(pane, [item.path]) }
    );
    return items;
  }

  async function copyPath(pane, paths) {
    const result = await window.ships.sftp.copyPath(paths);
    if (result && result.ok) setStatus(i18n.t('transferWin.copiedPath', { path: paths.join('\n') }));
    else setStatus(i18n.t('transferWin.copyFailed'), true);
  }

  async function copyReference(pane, paths) {
    const result = await window.ships.sftp.copyReference(pane.id, paths);
    if (result && result.ok) {
      setStatus(i18n.t('transferWin.copiedReference', { reference: (result.references || []).join('\n') }));
    } else {
      setStatus(i18n.t('transferWin.copyFailed'), true);
    }
  }

  async function downloadFile(pane, item) {
    setStatus(i18n.t('transferWin.transferStart', { target: targetLabel(pane), name: item.name }), false);
    const result = await window.ships.sftp.download(pane.id, item.path);
    if (result && result.ok) setStatus(i18n.t('transferWin.downloadDone', { path: result.path }));
    else setStatus(i18n.t('transferWin.downloadFailed', { error: (result && result.error) || 'error' }), true);
  }

  async function openFiles(pane, item) {
    const result = await window.ships.sftp.open(pane.id, item.path);
    if (result && result.ok) setStatus(i18n.t('transferWin.opened', { path: result.path }));
    else setStatus(i18n.t('transferWin.downloadFailed', { error: (result && result.error) || 'error' }), true);
  }

  async function openFilesVSCode(pane, item) {
    const result = await window.ships.sftp.openVSCode(pane.id, item.path);
    if (result && result.ok) setStatus(i18n.t('transferWin.openedVSCode', { path: result.path }));
    else setStatus(i18n.t('transferWin.downloadFailed', { error: (result && result.error) || 'error' }), true);
  }

  async function openFilesWireshark(pane, item) {
    const result = await window.ships.sftp.openWireshark(pane.id, item.path);
    if (result && result.ok) setStatus(i18n.t('transferWin.openedWireshark', { path: result.path }));
    else setStatus(i18n.t('transferWin.downloadFailed', { error: (result && result.error) || 'error' }), true);
  }

  async function openInEditor(pane, item) {
    if (!window.ships.fileEditor) return;
    const result = await window.ships.fileEditor.open({
      sessionId: pane.id,
      path: item.path,
      name: baseName(item.path),
    });
    if (!result || !result.ok) {
      setStatus(i18n.t('transferWin.editFailed', { error: (result && result.error) || 'error' }), true);
    }
  }

  /* 双击文件：≤ 8M 用内置编辑器打开，否则下载到本地。 */
  function openEntry(pane, item) {
    if (item.type === 'dir') return;
    if (isEditorEntry(item)) {
      openInEditor(pane, item);
      return;
    }
    openFiles(pane, item);
  }

  /* 同步：把某一边的目录带到另一边（syncing 守卫避免两侧互相触发）。 */
  let syncing = false;
  function syncTo(side, path) {
    if (syncing) return;
    const other = state.panes[side === 'left' ? 'right' : 'left'];
    if (!other || !other.connected || !path) return;
    syncing = true;
    Promise.resolve(other.enter(path)).finally(() => {
      syncing = false;
    });
  }

  /* 勾选同步：立即把两边定位到同一目录。 */
  async function syncNow() {
    const left = state.panes.left;
    const right = state.panes.right;
    const path = left && left.connected && left.cwd ? left.cwd : right && right.connected ? right.cwd : '';
    if (!path) return;
    syncing = true;
    try {
      if (left && left.connected) await left.enter(path);
      if (right && right.connected) await right.enter(path);
    } finally {
      syncing = false;
    }
  }

  /* 穿梭：把 source 栏选中的对象传到 dest 栏的当前目录。 */
  async function transferSelection(source, dest) {
    if (state.transferring) {
      setStatus(i18n.t('transferWin.transferBusy'), true);
      return;
    }
    if (!source || !dest) return;
    if (!source.selected) {
      setStatus(i18n.t('transferWin.needSelection'), true);
      return;
    }
    if (!dest.connected) {
      setStatus(i18n.t('transferWin.needTarget'), true);
      return;
    }
    const item = source.selected;
    state.transferring = true;
    setProgress({ transferred: 0, total: 0 });
    setStatus(i18n.t('transferWin.transferStart', { target: targetLabel(source), name: item.name }), false);
    const result = await window.ships.transfer.run({
      fromId: source.id,
      toId: dest.id,
      path: item.path,
      destDir: dest.cwd || '/',
      type: item.type,
    });
    state.transferring = false;
    setProgress(null);
    if (result && result.ok) {
      setStatus(
        i18n.t('transferWin.transferDone', {
          target: targetLabel(source),
          name: item.name,
          bytes: formatSize(result.transferred || 0),
        }),
        false
      );
      // 目标端刷新当前目录。
      dest.children.delete(dest.cwd);
      await dest.ensureChildren(dest.cwd);
      dest.renderTree();
    } else {
      setStatus(
        i18n.t('transferWin.transferFailed', {
          target: targetLabel(source),
          error: (result && result.error) || 'error',
        }),
        true
      );
    }
  }

  /* ------------------------------ 分隔线（可拖动） -------------------------- */
  /* 中间不再有按钮区，只留一条可拖动的竖线：拖动即改变左右两栏的宽度。 */
  function setupDivider(divider) {
    const left = dom.left;
    const right = dom.right;
    const MIN_PANE = 200;
    divider.addEventListener('mousedown', (event) => {
      event.preventDefault();
      divider.classList.add('dragging');
      const total = left.getBoundingClientRect().width + right.getBoundingClientRect().width;
      const onMove = (moveEvent) => {
        const offset = moveEvent.clientX - left.getBoundingClientRect().left;
        const width = Math.max(MIN_PANE, Math.min(total - MIN_PANE, offset));
        left.style.flex = `0 0 ${width}px`;
        right.style.flex = '1 1 auto';
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        divider.classList.remove('dragging');
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  /* ------------------------------- SSH 列表 ------------------------------ */
  async function refreshPickers() {
    try {
      const result = await window.ships.ssh.list();
      state.hosts = (result && result.hosts) || [];
    } catch (err) {
      state.hosts = [];
    }
    const grouped = [];
    const byGroup = new Map();
    const ungrouped = [];
    for (const host of state.hosts) {
      const group = host.group || '';
      if (!group) {
        ungrouped.push(host);
        continue;
      }
      const key = group.toLowerCase();
      if (!byGroup.has(key)) {
        const section = { name: group, hosts: [] };
        byGroup.set(key, section);
        grouped.push(section);
      }
      byGroup.get(key).hosts.push(host);
    }
    const sections = grouped.length + (ungrouped.length ? 1 : 0);
    const showHeaders = sections > 1;
    const options = [];
    const pushHost = (host) => {
      const address = host.user ? `${host.user}@${host.hostName}` : String(host.hostName || host.alias || '');
      options.push({ value: host.alias, label: address });
    };
    for (const section of grouped) {
      if (showHeaders) options.push({ header: true, label: section.name });
      for (const host of section.hosts) pushHost(host);
    }
    if (ungrouped.length) {
      if (showHeaders) options.push({ header: true, label: i18n.t('transferWin.ungrouped') });
      for (const host of ungrouped) pushHost(host);
    }
    for (const pane of Object.values(state.panes)) {
      if (!pane.picker) continue;
      if (pane.target && !options.some((option) => option.value === pane.target)) {
        options.push({ value: pane.target, label: pane.target });
      }
      pane.picker.setOptions(options);
      pane.picker.setValue(pane.target);
    }
  }

  /* --------------------------------- 启动 -------------------------------- */
  async function boot() {
    const settings = await window.ships.getSettings();
    i18n.setLocale((settings && settings.locale) || 'zh');
    window.ShipsTheme.set(settings || {});

    state.panes.left = createPane('left', dom.left, { withSync: true });
    state.panes.right = createPane('right', dom.right);
    if (dom.divider) setupDivider(dom.divider);

    await refreshPickers();

    // 打开时带上来源连接与目录（文件管理器右键「文件传输」→ 左侧定位）。
    const info = await window.ships.transferWindow.info();
    const initialTarget = (info && info.target) || '';
    const initialPath = (info && info.path) || '';
    if (initialTarget) {
      // 左侧栏：下拉框显示该连接并自动连接，随后进入指定目录。
      await state.panes.left.select(initialTarget);
      if (initialPath) await state.panes.left.enter(initialPath);
    }

    window.ships.transferWindow.onLocate(async (payload) => {
      const target = (payload && payload.target) || '';
      const path = (payload && payload.path) || '';
      if (target) await state.panes.left.select(target);
      if (path) await state.panes.left.enter(path);
      });

    window.ships.onSettingsChanged((next) => {
      i18n.setLocale((next && next.locale) || 'zh');
      window.ShipsTheme.set(next || {});
    });
    window.ships.onThemeChanged(() => window.ShipsTheme.apply());
    if (window.ships.ssh.onConfigChanged) {
      window.ships.ssh.onConfigChanged(() => refreshPickers());
    }
  }

  boot().catch((err) => console.error(err));
})();
