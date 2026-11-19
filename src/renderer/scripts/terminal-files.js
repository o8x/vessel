'use strict';

/* Host for the file manager inside the terminal window: shows / hides the bottom
   panel, wires the terminal's current ssh target, and manages the draggable divider
   between the terminal and the panel (panel height persisted with the shared layout).
   The file UI itself lives in scripts/file-manager.js. The manager is created lazily
   the first time the panel is shown and destroyed when it is popped out. */

(function registerTerminalFiles() {
  const DEFAULT_PANEL_HEIGHT = 260;
  const MIN_PANEL_HEIGHT = 120;
  const MIN_TERM_HEIGHT = 80;
  // 面板最小高度随终端字号自适应：字号越大行越高（行高 = 字号 × 1.9），
  // 面板至少要放得下 MIN_PANEL_ROWS 行，避免大字号下被挤成一条缝。
  const MIN_PANEL_ROWS = 3;
  const ROW_HEIGHT_RATIO = 1.9;
  // 终端字号变化事件（terminal.js 的 applyHeaderFontSize 派发）：字号变了要重算面板高度。
  const FONT_SIZE_EVENT = (window.ShipsConstants && window.ShipsConstants.FONT_SIZE_EVENT) || 'vessel:font-size';
  // 首次打开（无本地布局记录）时的最小布局：终端 ≥300、文件管理 ≥200；目录树 220、文件列表 ≥400。
  const FIRST_TERM_HEIGHT = 300;
  const FIRST_PANEL_HEIGHT = 200;
  const FIRST_TREE_WIDTH = 220;
  const FIRST_LIST_WIDTH = 400;
  const CHROME_HEIGHT = 50; // 头栏 + 分隔线 + 状态栏的近似高度
  const DIVIDER_WIDTH = 6;

  function mount(options) {
    const opts = options || {};
    const onStateChange = typeof opts.onStateChange === 'function' ? opts.onStateChange : () => {};
    const onCd = typeof opts.onCd === 'function' ? opts.onCd : null;
    // 面板展开时通知外部（如收起内嵌的文件传输面板）。
    const onShow = typeof opts.onShow === 'function' ? opts.onShow : () => {};

    const panel = document.getElementById('file-panel');
    const transferPanel = document.getElementById('transfer-panel');
    const divider = document.getElementById('term-divider');
    const rootEl = document.getElementById('file-panel-root');
    if (!panel || !divider || !rootEl || !window.ShipsFileManager) return null;

    let layout = { panelHeight: DEFAULT_PANEL_HEIGHT };
    let open = false;
    let enabled = false;
    let target = '';
    let manager = null;
    // null = 未知（布局还没读回来）；true/false = 本地是否已有调整记录。
    let hasRecord = null;

    /* 当前终端字号：--file-font-size 由 terminal.js 写成终端字号（内嵌面板与终端同号）。 */
    function currentFontSize() {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--file-font-size');
      const size = parseFloat(raw);
      return Number.isFinite(size) && size > 0 ? size : 12;
    }

    /* 当前缩放系数（终端字号 ÷ 基准字号 12）：目录树宽 / 各列列宽都按它等比放大，
       因此首次布局时窗口要的宽度也要跟着放大，否则大字号下列宽会被挤掉。 */
    function currentScale() {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--fm-scale');
      const value = parseFloat(raw);
      return Number.isFinite(value) && value > 0 ? value : 1;
    }

    /* 面板最小高度：固定下限 120px，且至少放得下 MIN_PANEL_ROWS 行（随字号自适应）。 */
    function minPanelHeight() {
      return Math.max(MIN_PANEL_HEIGHT, Math.round(MIN_PANEL_ROWS * ROW_HEIGHT_RATIO * currentFontSize()));
    }

    function applyPanelHeight() {
      const value = Math.max(minPanelHeight(), Number(layout.panelHeight) || DEFAULT_PANEL_HEIGHT);
      // 文件管理与内嵌文件传输共用同一个底部面板槽位：高度对两者同时生效。
      for (const item of [panel, transferPanel]) {
        if (item) item.style.height = `${value}px`;
      }
    }

    /* 无本地记录时按最小布局（终端 ≥300 / 文件管理 ≥200、目录树 220 / 文件列表 ≥400）
       把本窗口「只放大不缩小」到够用：树宽 220 + 列表 400 + 分隔线 ≈ 626 宽（按当前
       缩放系数放大：大字号下列宽 / 树宽都会等比变大，窗口要跟着变宽才放得下），
       头栏 + 300 + 分隔线 + 200 + 状态栏 ≈ 550 高。 */
    function applyFirstRunLayout() {
      layout.treeWidth = FIRST_TREE_WIDTH;
      layout.panelHeight = FIRST_PANEL_HEIGHT;
      applyPanelHeight();
      if (manager) manager.setLayout({ treeWidth: FIRST_TREE_WIDTH, panelHeight: FIRST_PANEL_HEIGHT });
      const ensure = window.ships.terminal && window.ships.terminal.ensureSize;
      if (typeof ensure === 'function') {
        const scale = currentScale();
        ensure({
          width: Math.round((FIRST_TREE_WIDTH + FIRST_LIST_WIDTH + DIVIDER_WIDTH) * scale),
          height: CHROME_HEIGHT + FIRST_TERM_HEIGHT + FIRST_PANEL_HEIGHT,
        });
      }
    }

    window.ships.filesLayout.get('panel').then((data) => {
      hasRecord = Boolean(data && Object.keys(data).length);
      layout = Object.assign({ panelHeight: DEFAULT_PANEL_HEIGHT }, data || {});
      applyPanelHeight();
      if (manager) manager.setLayout(layout);
      if (!hasRecord && open) applyFirstRunLayout();
    });

    function ensureManager() {
      if (manager) return manager;
      manager = window.ShipsFileManager.create({
        root: rootEl,
        layout,
        // 主动连接：检测到 ssh 目标即建立 SFTP（面板可保持隐藏），这样终端里的 cd 能随时被跟随。
        active: true,
        onCd,
        onPopOut: (t, dir) => {
          // 分离为独立窗口：关闭并销毁当前内嵌容器（含其 SFTP 连接），再开独立窗口（带过去当前目录）。
          hide({ destroy: true });
          window.ships.fileWindow.open(t, dir);
        },
        // 右键「文件传输」：打开穿梭框窗口，左侧定位到当前 SSH 连接与该目录。
        onOpenTransfer: (info) => {
          const conn = (info && info.connection) || {};
          const sshTarget = String((info && info.target) || conn.target || '').trim();
          if (!sshTarget) return;
          window.ships.transferWindow.open({ target: sshTarget, path: (info && info.path) || '' });
        },
        onLayout: (patch) => {
          Object.assign(layout, patch);
          window.ships.filesLayout.set('panel', patch);
          hasRecord = true; // 用户调整过 —— 之后不再套用首次的最小布局
          if (Object.prototype.hasOwnProperty.call(patch, 'panelHeight')) applyPanelHeight();
        },
      });
      if (target) manager.setTarget(target);
      return manager;
    }

    function destroyManager() {
      if (!manager) return;
      manager.destroy();
      manager = null;
    }

    function emitState() {
      onStateChange({ enabled, open, connecting: false });
    }

    function show() {
      open = true;
      panel.classList.remove('hidden');
      divider.classList.remove('hidden');
      ensureManager().activate();
      // 首次打开且没有本地调整记录：套用最小布局并把窗口放大到够用。
      if (hasRecord === false) applyFirstRunLayout();
      emitState();
      onShow();
    }

    function hide(opts2) {
      open = false;
      panel.classList.add('hidden');
      // 内嵌文件传输正开着时，分隔条保持可见（两者共用同一个底部槽位）。
      const transferOpen = transferPanel && !transferPanel.classList.contains('hidden');
      if (!transferOpen) divider.classList.add('hidden');
      if (opts2 && opts2.destroy) destroyManager();
      emitState();
    }

    function toggle() {
      if (!enabled) return;
      if (open) hide();
      else show();
    }

    /* 右键菜单「上传文件到此处」：先展开内嵌文件面板，再对当前目录打开系统文件选择窗口。 */
    function uploadHere() {
      if (!enabled) return;
      show();
      if (manager) manager.uploadToCurrent();
    }

    function setSshTarget(next) {
      const value = String(next || '');
      if (value === target) return;
      target = value;
      enabled = Boolean(value);
      if (!value) {
        hide({ destroy: true });
        return;
      }
      // 检测到 ssh 目标即创建并连接（面板保持隐藏），终端里的 cd 跟随因此始终有效。
      ensureManager().setTarget(value);
      emitState();
    }

    function followCd(raw) {
      // 面板哪怕暂时隐藏也保持连接，cd 跟随照常生效（下次展开即定位到该目录）。
      if (manager) manager.followCd(raw);
    }

    function closeConnection() {
      destroyManager();
    }

    /* divider drag: dragging up shrinks the terminal (panel grows) */
    divider.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = Number(layout.panelHeight) || DEFAULT_PANEL_HEIGHT;
      const onMove = (moveEvent) => {
        const floor = minPanelHeight();
        const maxHeight = Math.max(floor, window.innerHeight - MIN_TERM_HEIGHT);
        const next = Math.max(floor, Math.min(maxHeight, startHeight - (moveEvent.clientY - startY)));
        layout.panelHeight = next;
        applyPanelHeight();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.ships.filesLayout.set('panel', { panelHeight: layout.panelHeight });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    /* 终端字号变化：行高随之变化，面板最小高度要重算（已展开的面板同步长高）。 */
    document.documentElement.addEventListener(FONT_SIZE_EVENT, () => {
      applyPanelHeight();
    });

    applyPanelHeight();

    return {
      setSshTarget,
      toggle,
      show,
      hide,
      uploadHere,
      followCd,
      closeConnection,
      isOpen: () => open,
      // 当前远端目录（未连接 / 面板未创建时为空）。
      getCwd: () => (manager && typeof manager.getCwd === 'function' ? manager.getCwd() : ''),
    };
  }

  window.ShipsTerminalFiles = { mount };
})();
