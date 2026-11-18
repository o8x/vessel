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
        syncTip: '勾选后立即把两边定位到同一目录；之后单击进入目录时另一侧同步跟随',
        popOut: '分离为独立窗口',
        syncOn: '已开启同步：进入目录时另一侧跟随',
        syncOff: '已关闭同步',
        syncNeedBoth: '请先连接两侧主机，再开启同步',
        toRight: '传输到右侧',
        toLeft: '传输到左侧',
        phaseDownload: '下载',
        phaseUpload: '上传',
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
        syncTip: 'When enabled both sides jump to the same folder right away; entering a folder on one side then moves the other one too',
        popOut: 'Open in a separate window',
        syncOn: 'Sync on: the other side follows when you enter a folder',
        syncOff: 'Sync turned off',
        syncNeedBoth: 'Connect both sides before enabling sync',
        toRight: 'Transfer to right',
        toLeft: 'Transfer to left',
        phaseDownload: 'Download',
        phaseUpload: 'Upload',
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

  /* 文件传输 UI（穿梭框）：既可挂载到独立窗口，也可挂到终端窗口底部的内嵌面板。
     refs    = { title, left, right, divider, statusPath, statusMsg, progress,
                 downloadFill, downloadLabel, uploadFill, uploadLabel }
     options = { standalone?, initialTarget?, initialPath? } */
  function createTransferUI(refs, options) {
    const opts = options || {};
    const dom = Object.assign({ title: null }, refs || {});

    const state = {
      hosts: [],
      sync: false,
      transferring: false,
      panes: {},
    };

    /* 模态标题栏的文字：跟随界面语言显示窗口标题，并同步浏览器窗口标题。 */
    function renderWindowTitle() {
      const title = i18n.t('transferWin.title');
      if (dom.title) dom.title.textContent = title;
      document.title = title;
    }

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

    /* 两段式进度：下载段（源端 → 本地下载目录）与上传段（本地副本 → 目标端）。
       同一时刻只显示一行，上一段完成后再显示下一段。 */
    function setProgressRow(phase) {
      const downloadRow = dom.downloadLabel && dom.downloadLabel.parentElement;
      const uploadRow = dom.uploadLabel && dom.uploadLabel.parentElement;
      if (downloadRow) downloadRow.classList.toggle('hidden', phase !== 'download');
      if (uploadRow) uploadRow.classList.toggle('hidden', phase !== 'upload');
    }

    function hideProgress() {
      dom.progress.classList.add('hidden');
      dom.downloadFill.style.width = '0%';
      dom.uploadFill.style.width = '0%';
      setProgressRow('download');
    }

    function resetProgress() {
      dom.progress.classList.remove('hidden');
      dom.downloadFill.style.width = '0%';
      dom.uploadFill.style.width = '0%';
      dom.downloadLabel.textContent = i18n.t('transferWin.phaseDownload');
      dom.uploadLabel.textContent = i18n.t('transferWin.phaseUpload');
      setProgressRow('download');
    }

    function setProgress(phase, value) {
      if (!phase) {
        hideProgress();
        return;
      }
      dom.progress.classList.remove('hidden');
      const percent = value && value.total ? Math.min(100, Math.max(0, (value.transferred / value.total) * 100)) : 0;
      const text = `${Math.round(percent)}%`;
      if (phase === 'download') {
        setProgressRow('download');
        dom.downloadFill.style.width = `${percent.toFixed(0)}%`;
        dom.downloadLabel.textContent = `${i18n.t('transferWin.phaseDownload')} ${text}`;
      } else if (phase === 'upload') {
        setProgressRow('upload');
        dom.uploadFill.style.width = `${percent.toFixed(0)}%`;
        dom.uploadLabel.textContent = `${i18n.t('transferWin.phaseUpload')} ${text}`;
      } else if (phase === 'downloaded') {
        // 下载完成：立即切换到上传进度行。
        dom.downloadFill.style.width = '100%';
        dom.uploadFill.style.width = '0%';
        dom.uploadLabel.textContent = i18n.t('transferWin.phaseUpload');
        setProgressRow('upload');
      }
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

    /* 同步按钮需要两侧都已连接才可用（右侧未连接时禁用）。 */
    function updateSyncAvailability() {
      const left = state.panes && state.panes.left;
      const right = state.panes && state.panes.right;
      if (!left || !left.syncBtn) return;
      const disabled = !(left.connected && right && right.connected);
      left.syncBtn.disabled = disabled;
      left.syncBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }

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
        // 目录行上一次单击的时间戳（用于忽略双击的第 2 次点击）。
        lastClick: null,
      };

      // 内嵌面板把 SSH 下拉行与路径行合并成一行；独立窗口保持两行。
      const compact = Boolean(paneOpts.compact);
      const head = el('div', { class: `transfer-pane-head${compact ? ' transfer-pane-head-merged' : ''}` });
      const pickerHost = el('div', { class: 'transfer-pane-picker' });
      const pathRow = el('div', { class: 'fm-path-row' });
      const treeEl = el('div', { class: 'fm-tree' });
      const wrap = el('div', { class: 'transfer-pane' });
      if (compact) {
        head.classList.add(side === 'left' ? 'transfer-head-left' : 'transfer-head-right');
        if (side === 'right') {
          pathRow.classList.add('transfer-path-half');
          head.append(pathRow);
        }
        wrap.append(head, treeEl);
      } else {
        wrap.append(head, pathRow, treeEl);
      }
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
      // 未连接时禁用路径栏（右侧未连接时其路径栏不可编辑）。
      function updatePathAvailability() {
        const disabled = !pane.connected;
        pathInput.disabled = disabled;
        homeBtn.disabled = disabled;
        refreshBtn.disabled = disabled;
      }
      if (compact) {
        // 右栏只有「SSH 下拉 + 路径栏」；路径栏里不放图标。
        if (side === 'right') pathRow.append(pathInput);
        // 左栏顺序：分离图标 / 主页 / 刷新 / 路径栏 /（同步图标稍后追加）。
        if (side === 'left') head.append(homeBtn, refreshBtn, pathInput);
      } else {
        pathRow.append(homeBtn, refreshBtn, pathInput);
      }
      // 「分离为独立窗口」（仅内嵌面板用）：把穿梭框拆到独立的文件传输窗口。
      if (typeof paneOpts.detach === 'function') {
        const detachBtn = el('button', {
          class: 'icon-btn fm-path-btn',
          type: 'button',
          'data-tip': i18n.t('transferWin.popOut'),
        });
        detachBtn.innerHTML = Icons.external(14);
        detachBtn.addEventListener('click', () => paneOpts.detach());
        // 合并行左栏放在最前；独立窗口仍留在路径行最左。
        if (compact) head.insertBefore(detachBtn, head.firstChild);
        else pathRow.insertBefore(detachBtn, pathRow.firstChild);
      }

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
          if (!isDir) return;
          // 目录：单击即进入（展开并设为当前目录，同步开启时另一侧跟随）。
          // 同一目录的连续点击（双击的第 2 下）忽略，避免「打开再关闭」与重复加载。
          const now = Date.now();
          if (pane.lastClick && pane.lastClick.path === path && now - pane.lastClick.ts < 400) {
            pane.lastClick.ts = now;
            return;
          }
          pane.lastClick = { path, ts: now };
          if (pane.loading.has(path)) return;
          enter(path);
        });
        // 目录**不响应双击**（进入只由单击触发，避免双击导致展开后又折叠）；
        // 双击只对文件生效：≤ 8M 用内置编辑器打开，其余下载到本地。
        row.addEventListener('dblclick', (event) => {
          event.preventDefault();
          if (isDir) return;
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
        updatePathAvailability();
        updateSyncAvailability();
        setStatus(i18n.t('transferWin.connecting', { target: targetLabel(pane) }), false);
        const result = await window.ships.sftp.connect({ target });
        pane.connecting = false;
        if (!result || !result.ok) {
          setStatus(
            i18n.t('transferWin.connectFailed', { target: targetLabel(pane), error: (result && result.error) || 'error' }),
            true
          );
          renderTree();
          updatePathAvailability();
          updateSyncAvailability();
          return false;
        }
        pane.id = result.id;
        pane.connected = true;
        updatePathAvailability();
        updateSyncAvailability();
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
      updatePathAvailability();

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
      // 合并行的左栏不显示 SSH 下拉（自动绑定终端连接），右栏下拉占左半区。
      if (compact && side === 'left') {
        // 不挂载 pickerHost，仅保留 picker 供内部同步使用。
      } else if (compact) {
        head.insertBefore(pickerHost, pathRow);
      } else {
        head.appendChild(pickerHost);
      }
      // 「同步」开关放在**左侧栏**的 SSH 下拉右侧（中间不再有按钮区）。
      if (paneOpts.withSync) {
        const syncBtn = el('button', { class: `transfer-sync${compact ? ' transfer-sync-icon-only' : ''}`, type: 'button' });
        const syncIcon = el('span', { class: 'transfer-sync-icon' });
        syncIcon.innerHTML = Icons.sync(13);
        syncBtn.appendChild(syncIcon);
        // 内嵌面板只用图标（不显示「同步」文字），独立窗口保留图标 + 文字。
        if (!compact) {
          syncBtn.appendChild(el('span', { class: 'transfer-sync-label' }, i18n.t('transferWin.sync')));
        }
        syncBtn.setAttribute('data-tip', i18n.t('transferWin.syncTip'));
        syncBtn.disabled = true;
        syncBtn.addEventListener('click', async () => {
          state.sync = !state.sync;
          syncBtn.classList.toggle('on', state.sync);
          if (!state.sync) {
            setStatus(i18n.t('transferWin.syncOff'), false);
            return;
          }
          // 勾选后立即把两边定位到同一目录；两侧都未连接时给出明确反馈。
          const aligned = await syncNow();
          if (aligned) setStatus(i18n.t('transferWin.syncOn'), false);
          else setStatus(i18n.t('transferWin.syncNeedBoth'), true);
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

    /* 勾选同步：立即把两边定位到同一目录。
       返回是否「两侧都已连接」（false 表示当前无法同步，调用方据此提示）。 */
    async function syncNow() {
      const left = state.panes.left;
      const right = state.panes.right;
      if (!left || !right || !left.connected || !right.connected) return false;
      const path = left.cwd || right.cwd;
      if (!path) return false;
      syncing = true;
      try {
        await left.enter(path);
        await right.enter(path);
      } finally {
        syncing = false;
      }
      return true;
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
      resetProgress();
      setStatus(i18n.t('transferWin.transferStart', { target: targetLabel(source), name: item.name }), false);
      const result = await window.ships.transfer.run({
        fromId: source.id,
        toId: dest.id,
        path: item.path,
        destDir: dest.cwd || '/',
        type: item.type,
      });
      state.transferring = false;
      hideProgress();
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
    async function init() {
      const settings = await window.ships.getSettings();
      i18n.setLocale((settings && settings.locale) || 'zh');
      if (opts.standalone) {
        renderWindowTitle();
        window.ShipsTheme.set(settings || {});
      }

      const compact = !opts.standalone;
      state.panes.left = createPane('left', dom.left, {
        withSync: true,
        compact,
        detach: typeof opts.onDetach === 'function' ? opts.onDetach : null,
      });
      state.panes.right = createPane('right', dom.right, { compact });
      updateSyncAvailability();
      if (dom.divider) setupDivider(dom.divider);

      await refreshPickers();

      // 初始定位：独立窗口读主进程记录的来源连接 / 目录；内嵌面板由调用方传入。
      let initialTarget = String(opts.initialTarget || '');
      let initialPath = String(opts.initialPath || '');
      let initialRightTarget = String(opts.initialRightTarget || '');
      let initialRightPath = String(opts.initialRightPath || '');
      if (opts.standalone) {
        const info = await window.ships.transferWindow.info();
        initialTarget = (info && info.target) || initialTarget;
        initialPath = (info && info.path) || initialPath;
        initialRightTarget = (info && info.rightTarget) || initialRightTarget;
        initialRightPath = (info && info.rightPath) || initialRightPath;
      }
      if (initialTarget) {
        // 左侧栏：下拉框显示该连接并自动连接，随后进入指定目录。
        await state.panes.left.select(initialTarget);
        if (initialPath) await state.panes.left.enter(initialPath);
      }
      // 右侧：分离为独立窗口时一并选中原来的 SSH 连接与目录。
      if (initialRightTarget) {
        await state.panes.right.select(initialRightTarget);
        if (initialRightPath) await state.panes.right.enter(initialRightPath);
      }

      if (opts.standalone) {
        window.ships.transferWindow.onLocate(async (payload) => {
          const target = (payload && payload.target) || '';
          const path = (payload && payload.path) || '';
          const rightTarget = (payload && payload.rightTarget) || '';
          const rightPath = (payload && payload.rightPath) || '';
          if (target) await state.panes.left.select(target);
          if (path) await state.panes.left.enter(path);
          if (rightTarget) await state.panes.right.select(rightTarget);
          if (rightPath) await state.panes.right.enter(rightPath);
        });
      }

      // 传输实时进度：下载段 / 上传段分别驱动各自的进度条。
      window.ships.transfer.onProgress((progress) => {
        if (!progress) return;
        if (progress.phase === 'download') setProgress('download', progress);
        else if (progress.phase === 'upload') setProgress('upload', progress);
        else if (progress.phase === 'downloaded') setProgress('downloaded', progress);
      });

      window.ships.onSettingsChanged((next) => {
        i18n.setLocale((next && next.locale) || 'zh');
        if (opts.standalone) renderWindowTitle();
        window.ShipsTheme.set(next || {});
      });
      window.ships.onThemeChanged(() => window.ShipsTheme.apply());
      if (window.ships.ssh.onConfigChanged) {
        window.ships.ssh.onConfigChanged(() => refreshPickers());
      }
    }

    /* ------------------------------- 对外能力 ------------------------------- */

    /* 定位到某个连接 / 目录（左侧栏）。 */
    async function setTarget(target, path) {
      const alias = String(target || '').trim();
      if (alias) await state.panes.left.select(alias);
      const dir = String(path || '').trim();
      if (dir) await state.panes.left.enter(dir);
    }

    /* 跟随终端里的 cd（内嵌面板用）。 */
    async function followCd(path) {
      const dir = String(path || '').trim();
      if (!dir) return;
      await state.panes.left.enter(dir);
    }

    /* 左侧栏当前目录。 */
    function getCwd() {
      const left = state.panes.left;
      return left ? left.cwd : '';
    }

    /* 右侧栏当前连接与目录（分离为独立窗口时带过去）。 */
    function getRight() {
      const right = state.panes.right;
      return right ? { target: right.target, cwd: right.cwd } : { target: '', cwd: '' };
    }

    /* 关闭所有 SFTP 会话并清理。 */
    function destroy() {
      closeContextMenu();
      for (const pane of Object.values(state.panes)) {
        if (pane && pane.id) {
          try {
            window.ships.sftp.close(pane.id);
          } catch (err) {
            /* ignore */
          }
        }
      }
      state.panes = {};
    }

    return { init, setTarget, followCd, getCwd, getRight, destroy };
  }

  window.ShipsTransferUI = { create: createTransferUI };

  /* 独立文件传输窗口启动。 */
  async function bootStandalone() {
    const refs = {
      title: document.getElementById('transfer-window-title'),
      left: document.getElementById('transfer-pane-left'),
      right: document.getElementById('transfer-pane-right'),
      divider: document.getElementById('transfer-divider'),
      statusPath: document.getElementById('transfer-status-path'),
      statusMsg: document.getElementById('transfer-status-msg'),
      progress: document.getElementById('transfer-progress'),
      downloadFill: document.getElementById('transfer-progress-download-fill'),
      downloadLabel: document.getElementById('transfer-progress-download-label'),
      uploadFill: document.getElementById('transfer-progress-upload-fill'),
      uploadLabel: document.getElementById('transfer-progress-upload-label'),
    };
    const ui = createTransferUI(refs, { standalone: true });
    await ui.init();
  }

  if (document.getElementById('transfer-pane-left')) {
    bootStandalone().catch((err) => console.error(err));
  }

})();
