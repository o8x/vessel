'use strict';

(function registerWindowSettings() {
  const { Icons, el, section } = window.ShipsUI;
  const i18n = window.ShipsI18n;

  i18n.extend({
    zh: {
      settingsPage: {
        windows: '窗口管理',
        windowsHint: '查看当前已打开的窗口，可激活（带到前台）或销毁。',
        windowEmpty: '当前没有已打开的窗口',
        windowActivate: '激活',
        windowDestroy: '销毁',
        windowTypeMain: '主界面',
        windowTypeTerminal: '终端',
        windowTypeFile: '文件管理',
        windowTypeEditor: '编辑器',
        windowTypeGame: '游戏',
        windowLoadFailed: '读取窗口列表失败：{error}',
      },
    },
    en: {
      settingsPage: {
        windows: 'Windows',
        windowsHint: 'Open windows — activate (bring to front) or destroy them.',
        windowEmpty: 'No open windows',
        windowActivate: 'Activate',
        windowDestroy: 'Destroy',
        windowTypeMain: 'Main window',
        windowTypeTerminal: 'Terminal',
        windowTypeFile: 'File manager',
        windowTypeEditor: 'Editor',
        windowTypeGame: 'Game',
        windowLoadFailed: 'Cannot load windows: {error}',
      },
    },
  });

  function mount(pane) {
    const wrap = section();
    wrap.appendChild(el('div', { class: 'text-[12px] text-fg-muted' }, i18n.t('settingsPage.windowsHint')));
    const list = el('div', { class: 'mt-3 flex flex-col gap-card' });
    wrap.appendChild(list);
    pane.appendChild(wrap);

    let disposed = false;

    function typeLabel(item) {
      const map = {
        main: 'settingsPage.windowTypeMain',
        terminal: 'settingsPage.windowTypeTerminal',
        file: 'settingsPage.windowTypeFile',
        editor: 'settingsPage.windowTypeEditor',
        game: 'settingsPage.windowTypeGame',
      };
      const key = map[item.type];
      return key ? i18n.t(key) : item.type;
    }

    function buildRow(item) {
      const row = el('div', { class: 'row-card' });

      const icon = el('span', {
        class: 'flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-surface-2 text-fg-muted',
      });
      const iconName =
        item.type === 'terminal'
          ? 'terminal'
          : item.type === 'file'
            ? 'folder'
            : item.type === 'editor'
              ? 'doc'
              : item.type === 'game'
                ? 'gamepad'
                : 'monitor';
      icon.innerHTML = Icons[iconName] ? Icons[iconName](16) : Icons.monitor(16);

      const info = el('div', { class: 'min-w-0 flex-1' });
      const title = item.type === 'editor' && item.title ? item.title : typeLabel(item);
      const titleEl = el('div', { class: 'truncate font-mono text-[13px] text-fg' });
      titleEl.textContent = title;
      const metaEl = el('div', { class: 'truncate text-[10px] text-fg-muted' });
      metaEl.textContent = `${typeLabel(item)} · #${item.id}`;
      info.append(titleEl, metaEl);

      const actions = el('div', { class: 'flex shrink-0 items-center gap-1' });
      const activateBtn = el(
        'button',
        { class: 'btn h-7 px-2 text-[11px]', type: 'button' },
        i18n.t('settingsPage.windowActivate')
      );
      activateBtn.addEventListener('click', async () => {
        await window.ships.windowManager.activate(item.id);
        load();
      });
      const destroyBtn = el(
        'button',
        { class: 'btn btn-danger h-7 px-2 text-[11px]', type: 'button' },
        i18n.t('settingsPage.windowDestroy')
      );
      destroyBtn.addEventListener('click', async () => {
        destroyBtn.disabled = true;
        await window.ships.windowManager.destroy(item.id);
        setTimeout(load, 60);
      });
      actions.append(activateBtn, destroyBtn);

      row.append(icon, info, actions);
      return row;
    }

    function render(items) {
      if (disposed) return;
      list.innerHTML = '';
      if (!items.length) {
        list.appendChild(
          el('div', { class: 'py-10 text-center text-[12px] text-fg-muted' }, i18n.t('settingsPage.windowEmpty'))
        );
        return;
      }
      for (const item of items) list.appendChild(buildRow(item));
    }

    async function load() {
      if (disposed) return;
      try {
        const items = await window.ships.windowManager.list();
        render(Array.isArray(items) ? items : []);
      } catch (err) {
        if (!disposed) {
          list.innerHTML = '';
          list.appendChild(
            el(
              'div',
              { class: 'py-10 text-center text-[12px] text-danger' },
              i18n.t('settingsPage.windowLoadFailed', { error: err.message })
            )
          );
        }
      }
    }

    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    load();

    return () => {
      disposed = true;
      window.removeEventListener('focus', onFocus);
    };
  }

  window.ShipsSettingsRegistry.register({
    id: 'windows',
    icon: 'monitor',
    labelKey: 'settingsPage.windows',
    mount,
  });
})();
