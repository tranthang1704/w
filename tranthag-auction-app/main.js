'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow = null;
let serverHandle = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  async function createApp() {
    process.env.TRANTHAG_DATA_DIR = app.getPath('userData');
    const { startServer } = require('./server.js');
    serverHandle = await startServer();

    mainWindow = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 1120,
      minHeight: 720,
      backgroundColor: '#050a13',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    await mainWindow.loadURL('http://127.0.0.1:3000');
    mainWindow.on('closed', () => { mainWindow = null; });
  }

  app.whenReady().then(createApp).catch(err => {
    console.error(err);
    app.quit();
  });

  app.on('window-all-closed', async () => {
    try {
      if (serverHandle && serverHandle.close) await serverHandle.close();
    } catch (_) {}
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createApp();
  });
}
