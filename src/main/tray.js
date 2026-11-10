'use strict';

const path = require('path');
const { Tray, Menu, nativeImage, app } = require('electron');
const { APP_NAME } = require('../shared/constants');

const TRAY_ICON = path.join(__dirname, '..', '..', 'assets', 'imgs', 'trayTemplate.png');

/* 重启应用：先登记「退出后重新拉起当前可执行文件」，再正常走退出流程，
   让 before-quit 里的清理（终端会话、托盘销毁等）照常执行。 */
function restartApp() {
  app.relaunch();
  app.quit();
}

function createTray({ onLeftClick, onOpenSettings }) {
  const image = nativeImage.createFromPath(TRAY_ICON);
  image.setTemplateImage(true);

  const tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  tray.on('click', () => onLeftClick());
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: '打开设置', click: () => onOpenSettings() },
      { label: `重启 ${APP_NAME}`, click: () => restartApp() },
      { type: 'separator' },
      { label: `退出 ${APP_NAME}`, click: () => app.quit() },
    ]);
    tray.popUpContextMenu(menu);
  });

  return tray;
}

module.exports = { createTray };
