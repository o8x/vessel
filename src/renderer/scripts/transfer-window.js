'use strict';

/* 文件传输窗口（穿梭框）：左右两栏各一个 SSH 连接，中间是穿梭按钮与「同步」开关。
   - 顶部下拉选择主机后自动连接并加载目录 / 文件列表；
   - 勾选「同步」后，点某一边的目录，另一边自动进入同一路径；
   - 选中文件 / 文件夹后点穿梭按钮传输到另一边的当前目录；
   - 底部状态栏显示实时进度；同一时刻只传输一个对象。 */

(function bootstrapTransferWindow() {
  const { Icons, el, createSelect } = window.ShipsUI;
  const i18n = window.ShipsI18n;

  i18n.extend({
    zh: {
      transferWin: {
        title: '文件传输',
        sshPlaceholder: '选择已保存的主机',
        left: '左侧',
        right: '右侧',
        sync: '同步',
        syncTip: '勾选后，点一边的目录，另一边自动进入同一路径',
        toRight: '传输到右侧',
        toLeft: '传输到左侧',
        transfer: '传输',
        name: '文件名',
        size: '体积',
        time: '时间',
        perm: '权限',
        empty: '空目录',
        loading: '加载中…',
        notConnected: '未连接',
        connecting: '正在连接 {target}…',
        connected: '已连接 {target}',
        connectFailed: '连接失败：{error}',
        listFailed: '无法列出目录内容',
        copyPath: '复制路径',
        copyReference: '复制引用',
        copiedPath: '已复制路径：{path}',
        copiedReference: '已复制引用：{reference}',
        copyFailed: '复制失败',
        transferStart: '开始传输 {name}',
        transferring: '正在传输 {name}…',
        transferDone: '已传输 {name}（{bytes}）',
        transferFailed: '传输失败：{error}',
        transferBusy: '已有传输任务在进行中',
        needSelection: '请先在列表中选择一个文件或文件夹',
        needTarget: '目标一端尚未连接',
        pathPlaceholder: '输入远端路径，回车进入',
        home: '家目录',
        refresh: '刷新',
        ungrouped: '未分组',
      },
    },
    en: {
      transferWin: {
        title: 'File Transfer',
        sshPlaceholder: 'Choose a saved host',
        left: 'Left',
        right: 'Right',
        sync: 'Sync',
        syncTip: 'When enabled, clicking a directory on one side opens the same path on the other',
        toRight: 'Transfer to right',
        toLeft: 'Transfer to left',
        transfer: 'Transfer',
        name: 'Name',
        size: 'Size',
        time: 'Time',
        perm: 'Perm',
        empty: 'Empty directory',
        loading: 'Loading…',
        notConnected: 'Not connected',
        connecting: 'Connecting {target}…',
        connected: 'Connected to {target}',
        connectFailed: 'Connect failed: {error}',
        listFailed: 'Cannot list the directory',
        copyPath: 'Copy path',
        copyReference: 'Copy reference',
        copiedPath: 'Copied path: {path}',
        copiedReference: 'Copied reference: {reference}',
        copyFailed: 'Copy failed',
        transferStart: 'Transferring {name}',
        transferring: 'Transferring {name}…',
        transferDone: 'Transferred {name} ({bytes})',
        transferFailed: 'Transfer failed: {error}',
        transferBusy: 'Another transfer is already running',
        needSelection: 'Select a file or folder first',
        needTarget: 'The other side is not connected',
        pathPlaceholder: 'Type a remote path, press Enter',
        home: 'Home',
        refresh: 'Refresh',
        ungrouped: 'Ungrouped',
      },
    },
  });

  const STATUS_TTL_MS = 30000;

  function joinPath(dir, name) {
    const base = String(dir || '/');
    return base === '/' ? `/${name}` : `${base.replace(/\/$/, '')}/${name}`;
  }

  function parentPath(dir) {
    const value = String(dir || '').replace(/\/+$/, '');
    if (!value || value === '/') return '';
    const index = value.lastIndexOf('/');
    return index <= 0 ? '/' : value.slice(0, index);
  }

  function formatSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value)) return '';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function formatTime(ms) {
    const value = Number(ms);
    if (!value) return '';
    const date = new Date(value);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatMode(mode, type) {
    const value = Number(mode);
    if (!value) return '';
    const typeChar = type === 'dir' ? 'd' : type === 'link' ? 'l' : '-';
    const bits = value & 0o777;
    const triple = (shift) => {
      const n = (bits >> shift) & 0o7;
      return `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`;
    };
    return `${typeChar}${triple(6)}${triple(3)}${triple(0)}`;
  }

  const dom = {
    left: document.getElementById('transfer-pane-left'),
    right: document.getElementById('transfer-pane-right'),
    mid: document.getElementById('transfer-mid'),
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

  let statusTimer = null;
  function setStatus(message, isError) {
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    dom.statusMsg.textContent = message || '';
    dom.statusMsg.style.color = isError ? 'var(--color-danger)' : '';
    if (message) {
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
  function createPane(side, root) {
    const pane = {
      side,
      target: '',
      id: '',
      connected: false,
      connecting: false,
      home: '',
      cwd: '',
      entries: [],
      selected: null,
      picker: null,
    };

    const head = el('div', { class: 'transfer-pane-head' });
    const pickerHost = el('div', { class: 'transfer-pane-picker' });
    const pathRow = el('div', { class: 'fm-path-row' });
    const listHead = el('div', { class: 'fm-list-head' });
    const listEl = el('div', { class: 'fm-list', tabindex: '0' });
    const listPane = el('div', { class: 'fm-list-pane' });
    listPane.append(listHead, listEl);
    const wrap = el('div', { class: 'transfer-pane' });
    wrap.append(head, pathRow, listPane);
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

    function headCell(labelText, cls) {
      const cell = el('div', { class: `fm-head-cell ${cls}` });
      cell.appendChild(el('span', { class: 'fm-head-label' }, labelText));
      return cell;
    }
    listHead.append(
      el('div', { class: 'fm-head-cell fm-head-icon' }, ''),
      headCell(i18n.t('transferWin.name'), 'fm-head-name'),
      headCell(i18n.t('transferWin.size'), 'fm-head-size'),
      headCell(i18n.t('transferWin.perm'), 'fm-head-perm'),
      headCell(i18n.t('transferWin.time'), 'fm-head-time')
    );
    listPane.style.setProperty('--fm-name', '160px');
    listPane.style.setProperty('--fm-size', '70px');
    listPane.style.setProperty('--fm-time', '120px');
    listPane.style.setProperty('--fm-perm', '90px');

    function renderList() {
      listEl.innerHTML = '';
      if (!pane.connected) {
        listEl.appendChild(el('div', { class: 'fm-list-hint' }, i18n.t('transferWin.notConnected')));
        return;
      }
      const parent = parentPath(pane.cwd);
      if (parent) {
        const row = el('div', { class: 'fm-row fm-row-dir fm-row-parent' });
        const icon = el('span', { class: 'fm-cell-icon' });
        icon.innerHTML = Icons.arrowUp(13);
        row.append(icon, el('span', { class: 'fm-cell-name' }, '..'), el('span', { class: 'fm-cell-size' }, '-'));
        row.addEventListener('dblclick', () => navigate(parent));
        listEl.appendChild(row);
      }
      if (!pane.entries.length) {
        listEl.appendChild(el('div', { class: 'fm-list-hint' }, i18n.t('transferWin.empty')));
        return;
      }
      const dirs = pane.entries.filter((entry) => entry.type === 'dir');
      const files = pane.entries.filter((entry) => entry.type !== 'dir');
      for (const entry of dirs.concat(files)) {
        const path = joinPath(pane.cwd, entry.name);
        const isDir = entry.type === 'dir';
        const row = el('div', { class: 'fm-row' });
        row.dataset.path = path;
        if (isDir) row.classList.add('fm-row-dir');
        if (pane.selected && pane.selected.path === path) row.classList.add('selected');
        const icon = el('span', { class: 'fm-cell-icon' });
        icon.innerHTML = isDir ? Icons.folder(13) : Icons.file(13);
        // 远端文件名一律用 textContent 写入（不当作 HTML 解析）。
        const name = el('span', { class: 'fm-cell-name' }, '');
        name.textContent = entry.name;
        const size = el('span', { class: 'fm-cell-size' }, '');
        size.textContent = isDir ? '-' : formatSize(entry.size);
        const perm = el('span', { class: 'fm-cell-perm' }, '');
        perm.textContent = formatMode(entry.mode, entry.type);
        const time = el('span', { class: 'fm-cell-time' }, '');
        time.textContent = formatTime(entry.mtime);
        row.append(icon, name, size, perm, time);

        // 只切换选中样式（不重建 DOM），否则双击（进入目录）会被节点替换打断。
        function selectRow() {
          pane.selected = { path, name: entry.name, type: entry.type, size: entry.size };
          for (const node of listEl.querySelectorAll('.fm-row[data-path]')) {
            node.classList.toggle('selected', node.dataset.path === path);
          }
          updateButtons();
        }
        row.addEventListener('click', () => {
          selectRow();
          // 同步开启时，点目录让另一边进入同一路径。
          if (isDir && state.sync) syncTo(side, path);
        });
        row.addEventListener('dblclick', () => {
          if (isDir) navigate(path);
        });
        row.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          selectRow();
          openContextMenu(event.clientX, event.clientY, contextItems(pane, path));
        });
        listEl.appendChild(row);
      }
    }

    async function loadList(dir) {
      if (!pane.connected || !pane.id) return false;
      const result = await window.ships.sftp.list(pane.id, dir);
      if (!result || !result.ok) {
        setStatus(i18n.t('transferWin.listFailed'), true);
        return false;
      }
      pane.cwd = result.path;
      pane.home = result.home || pane.home;
      pane.entries = result.entries || [];
      pane.selected = null;
      pathInput.value = result.path;
      renderList();
      updateButtons();
      return true;
    }

    async function navigate(dir) {
      if (!pane.connected) return false;
      const ok = await loadList(dir);
      if (ok && state.sync) syncTo(side, pane.cwd);
      return ok;
    }

    async function connect(target) {
      if (!target) return;
      if (pane.id) {
        window.ships.sftp.close(pane.id);
        pane.id = '';
      }
      pane.target = target;
      pane.connected = false;
      pane.connecting = true;
      setStatus(i18n.t('transferWin.connecting', { target }), false);
      const result = await window.ships.sftp.connect({ target });
      pane.connecting = false;
      if (!result || !result.ok) {
        setStatus(i18n.t('transferWin.connectFailed', { error: (result && result.error) || 'error' }), true);
        renderList();
        return false;
      }
      pane.id = result.id;
      pane.connected = true;
      pane.home = result.home || '/';
      setStatus(i18n.t('transferWin.connected', { target }), false);
      await loadList(pane.home);
      updateButtons();
      return true;
    }

    function select(target) {
      pane.target = target || '';
      if (pane.picker) pane.picker.setValue(pane.target);
      if (!pane.target) return Promise.resolve(false);
      return connect(pane.target);
    }

    homeBtn.addEventListener('click', () => {
      if (pane.home) navigate(pane.home);
    });
    refreshBtn.addEventListener('click', () => {
      if (pane.connected) loadList(pane.cwd);
    });
    pathInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const value = pathInput.value.trim();
        if (value) navigate(value);
      }
    });

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

    pane.renderList = renderList;
    pane.navigate = navigate;
    pane.loadList = loadList;
    pane.connect = connect;
    pane.select = select;
    return pane;
  }

  /* 传输窗口里两个栏目的右键菜单（左右一致）：传输到对侧 / 复制路径 / 复制引用。 */
  function contextItems(pane, path) {
    const other = state.panes[pane.side === 'left' ? 'right' : 'left'];
    const toOther = pane.side === 'left' ? i18n.t('transferWin.toRight') : i18n.t('transferWin.toLeft');
    return [
      {
        label: toOther,
        icon: 'swap',
        disabled: !other || !other.connected,
        run: () => transferSelection(pane, other),
      },
      { label: i18n.t('transferWin.copyPath'), icon: 'copy', run: () => copyPath(pane, [path]) },
      {
        label: i18n.t('transferWin.copyReference'),
        icon: 'copy',
        run: () => copyReference(pane, [path]),
      },
    ];
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

  /* 同步：把某一边的路径带到另一边（另一边未连接时忽略）。
     syncing 守卫避免两侧互相触发同步形成递归。 */
  let syncing = false;
  function syncTo(side, path) {
    if (syncing) return;
    const other = state.panes[side === 'left' ? 'right' : 'left'];
    if (!other || !other.connected || !path) return;
    syncing = true;
    Promise.resolve(other.navigate(path)).finally(() => {
      syncing = false;
    });
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
    updateButtons();
    setProgress({ transferred: 0, total: 0 });
    setStatus(i18n.t('transferWin.transferStart', { name: item.name }), false);
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
        i18n.t('transferWin.transferDone', { name: item.name, bytes: formatSize(result.transferred || 0) }),
        false
      );
      await dest.loadList(dest.cwd || '/');
    } else {
      setStatus(
        i18n.t('transferWin.transferFailed', { error: (result && result.error) || 'error' }),
        true
      );
    }
    updateButtons();
  }

  /* ------------------------------ 中间控制区 ----------------------------- */
  const syncBtn = el('button', { class: 'transfer-sync', type: 'button' });
  const syncLabel = el('span', { class: 'transfer-sync-label' }, i18n.t('transferWin.sync'));
  syncBtn.appendChild(syncLabel);
  syncBtn.setAttribute('data-tip', i18n.t('transferWin.syncTip'));

  const toRightBtn = el('button', { class: 'transfer-move', type: 'button', 'data-tip': i18n.t('transferWin.toRight') });
  toRightBtn.innerHTML = Icons.arrowRight(16);
  const toLeftBtn = el('button', { class: 'transfer-move', type: 'button', 'data-tip': i18n.t('transferWin.toLeft') });
  toLeftBtn.innerHTML = Icons.arrowLeft(16);

  syncBtn.addEventListener('click', () => {
    state.sync = !state.sync;
    syncBtn.classList.toggle('on', state.sync);
  });
  toRightBtn.addEventListener('click', () => transferSelection(state.panes.left, state.panes.right));
  toLeftBtn.addEventListener('click', () => transferSelection(state.panes.right, state.panes.left));
  dom.mid.append(syncBtn, toRightBtn, toLeftBtn);

  function updateButtons() {
    const left = state.panes.left;
    const right = state.panes.right;
    const canRight = Boolean(
      !state.transferring && left && left.selected && right && right.connected
    );
    const canLeft = Boolean(
      !state.transferring && right && right.selected && left && left.connected
    );
    toRightBtn.disabled = !canRight;
    toLeftBtn.disabled = !canLeft;
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

    state.panes.left = createPane('left', dom.left);
    state.panes.right = createPane('right', dom.right);
    updateButtons();

    await refreshPickers();

    // 打开时带上来源连接与目录（文件管理器右键「文件传输」→ 左侧定位）。
    const info = await window.ships.transferWindow.info();
    const initialTarget = (info && info.target) || '';
    const initialPath = (info && info.path) || '';
    if (initialTarget) {
      // 左侧栏：下拉框显示该连接并自动连接，随后进入指定目录。
      await state.panes.left.select(initialTarget);
      if (initialPath) await state.panes.left.navigate(initialPath);
    }
    updateButtons();

    window.ships.transferWindow.onLocate(async (payload) => {
      const target = (payload && payload.target) || '';
      const path = (payload && payload.path) || '';
      if (target) await state.panes.left.select(target);
      if (path) await state.panes.left.navigate(path);
      updateButtons();
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
