'use strict';

/* Host for the embedded file-transfer panel inside the terminal window.
   Shares the bottom panel slot with the embedded file manager (only one of them
   is visible at a time), keeps the left pane bound to the terminal's current ssh
   target, follows the terminal's cwd, and can pop out into the standalone
   transfer window. The shuttle UI itself lives in scripts/transfer-window.js. */

(function registerTerminalTransfer() {
  const { el } = window.ShipsUI;

  function mount(options) {
    const opts = options || {};
    const onStateChange = typeof opts.onStateChange === 'function' ? opts.onStateChange : () => {};
    const onShow = typeof opts.onShow === 'function' ? opts.onShow : () => {};
    // 在当前终端的 shell 里 cd 到某个目录（右键「进入该目录」，与文件管理器一致）。
    const onCd = typeof opts.onCd === 'function' ? opts.onCd : null;

    const panel = document.getElementById('transfer-panel');
    const rootEl = document.getElementById('transfer-panel-root');
    const divider = document.getElementById('term-divider');
    const filePanel = document.getElementById('file-panel');
    if (!panel || !rootEl || !window.ShipsTransferUI) return null;

    let ui = null;
    let initPromise = null;
    let open = false;
    let enabled = false;
    let target = '';
    // 左侧栏当前已连接的目标（避免每次展开都重连）。
    let connectedTarget = '';
    let cwd = '';

    function emitState() {
      onStateChange({ enabled, open });
    }

    /* 面板结构与独立文件传输窗口一致：穿梭框（左 / 右两栏）+ 竖直分隔条 + 底部状态栏。 */
    function buildUI() {
      if (ui) return ui;
      const wrap = el('div', { class: 'transfer-embedded' });
      const main = el('main', { class: 'transfer-embedded-main' });
      const left = el('section', { class: 'transfer-pane-host' });
      const divider = el('div', { class: 'transfer-divider-v' });
      const right = el('section', { class: 'transfer-pane-host' });
      main.append(left, divider, right);

      const footer = el('footer', { class: 'fm-status' });
      const statusPath = el('span', { class: 'fm-status-path' });
      const progress = el('div', { class: 'fm-progress-stack hidden' });
      const downloadRow = el('div', { class: 'fm-progress-row' });
      const downloadLabel = el('span', { class: 'fm-progress-label' });
      const downloadBar = el('div', { class: 'fm-progress' });
      const downloadFill = el('div', { class: 'fm-progress-fill' });
      downloadBar.append(downloadFill);
      downloadRow.append(downloadLabel, downloadBar);
      const uploadRow = el('div', { class: 'fm-progress-row' });
      const uploadLabel = el('span', { class: 'fm-progress-label' });
      const uploadBar = el('div', { class: 'fm-progress' });
      const uploadFill = el('div', { class: 'fm-progress-fill' });
      uploadBar.append(uploadFill);
      uploadRow.append(uploadLabel, uploadBar);
      progress.append(downloadRow, uploadRow);
      const statusMsg = el('span', { class: 'fm-status-msg' });
      footer.append(statusPath, progress, statusMsg);

      wrap.append(main, footer);
      rootEl.appendChild(wrap);

      ui = window.ShipsTransferUI.create(
        {
          left,
          right,
          divider,
          statusPath,
          statusMsg,
          progress,
          downloadFill,
          downloadLabel,
          uploadFill,
          uploadLabel,
        },
        {
          onDetach: () => detach(),
          // 左栏右键「进入该目录」→ 在当前 shell 里 cd 过去。
          onEnterDir: onCd ? (info) => onCd(info && info.path) : null,
        }
      );
      return ui;
    }

    /* 分离为独立文件传输窗口：把左右两栏的连接与目录带过去，内嵌面板收起。 */
    function detach() {
      if (window.ships.transferWindow) {
        const leftDir = ui && typeof ui.getCwd === 'function' ? ui.getCwd() : cwd;
        const right = ui && typeof ui.getRight === 'function' ? ui.getRight() : { target: '', cwd: '' };
        window.ships.transferWindow.open({
          target: String(target || ''),
          path: String(leftDir || ''),
          rightTarget: String((right && right.target) || ''),
          rightPath: String((right && right.cwd) || ''),
        });
      }
      hide();
    }

    async function show() {
      const instance = buildUI();
      if (!initPromise) {
        initPromise = instance.init().catch((err) => {
          initPromise = null;
          throw err;
        });
      }
      await initPromise;
      open = true;
      panel.classList.remove('hidden');
      if (divider) divider.classList.remove('hidden');
      onShow();
      // 左侧栏定位到当前 ssh 与当前目录（同一目标不重连）。
      if (target && target !== connectedTarget) {
        await instance.setTarget(target, cwd);
        connectedTarget = target;
      } else if (cwd) {
        await instance.followCd(cwd);
      }
      emitState();
    }

    function hide() {
      open = false;
      panel.classList.add('hidden');
      // 文件管理正开着时，分隔条保持可见（两者共用同一个底部槽位）。
      const fileOpen = filePanel && !filePanel.classList.contains('hidden');
      if (divider && !fileOpen) divider.classList.add('hidden');
      emitState();
    }

    function toggle() {
      if (!enabled) return;
      if (open) hide();
      else show().catch((err) => console.error(err));
    }

    function setSshTarget(next) {
      const value = String(next || '');
      if (value === target) return;
      target = value;
      enabled = Boolean(value);
      if (value !== connectedTarget) connectedTarget = '';
      if (!value) {
        hide();
        return;
      }
      if (open && ui) void ui.setTarget(value, cwd).then(() => {
        connectedTarget = value;
      });
      emitState();
    }

    /* 跟随终端里的 cd。 */
    function followCd(raw) {
      const dir = String(raw || '').trim();
      if (!dir) return;
      cwd = dir;
      if (open && ui) void ui.followCd(dir);
    }

    function isOpen() {
      return open;
    }

    function getCwd() {
      return ui && typeof ui.getCwd === 'function' ? ui.getCwd() : cwd;
    }

    return {
      setSshTarget,
      toggle,
      show,
      hide,
      followCd,
      isOpen,
      getCwd,
    };
  }

  window.ShipsTerminalTransfer = { mount };
})();
