const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const log = require('electron-log');

let mainWindow;

// Prevent multiple packaged instances from competing for localhost:3000.
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
  return;
}
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

// Setup logging before anything else so crashes still leave a trail.
log.transports.file.level = "debug";

// In a packaged app launched from Explorer there is no console attached, so
// stdout/stderr become a pipe with no reader. Any console.log/console.error
// then throws EPIPE and crashes the main process (the "JavaScript error in the
// main process" dialog). Swallow EPIPE from stdio and never let a stray error
// take down the app mid-auction; everything is still written to the log file.
process.stdout.on('error', (err) => { if (err && err.code === 'EPIPE') return; });
process.stderr.on('error', (err) => { if (err && err.code === 'EPIPE') return; });
process.on('uncaughtException', (err) => {
  if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) return;
  try { log.error('[MAIN] Uncaught exception:', err && (err.stack || err.message || err)); } catch (e) {}
});
process.on('unhandledRejection', (reason) => {
  try { log.error('[MAIN] Unhandled rejection:', reason && (reason.stack || reason.message || reason)); } catch (e) {}
});

// Start the Express server in background. serverReady resolves only after keys
// are loaded and the listener is accepting connections.
console.log("[ELECTRON] DĂ©marrage du serveur BetterTok.app...");
const { serverReady } = require('./server.js');

let autoUpdater = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'build', 'icon.ico'), // Packaged app icon
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const dashboardUrl = 'http://localhost:3000';
  let loadRetries = 0;
  const loadDashboard = () => {
    console.log("[ELECTRON] Chargement de l'interface...");
    mainWindow.loadURL(dashboardUrl).catch(err => {
      log.error('[MAIN] Dashboard load failed:', err && err.message);
    });
  };
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode !== -102 || loadRetries >= 5) return;
    loadRetries += 1;
    log.warn(`[MAIN] Dashboard not ready (${errorDescription}); retry ${loadRetries}/5.`);
    setTimeout(loadDashboard, 500);
  });
  loadDashboard();

  // Hide the default menu bar (File, Edit, View, etc.)
  mainWindow.setMenuBarVisibility(false);
}

// -------------------------------------------------------------
// Auto-Update (GitHub Releases)
// -------------------------------------------------------------
// Lazy-load electron-updater only after Electron app is ready. Requiring it at
// module top-level can crash when the Electron app binding is not yet available.
function setupAutoUpdater() {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    log.error('[UPDATER] Failed to load electron-updater:', err && err.message);
    return;
  }

  autoUpdater.logger = log;
  // Don't auto-install on quit until the user agrees, so we can show a prompt.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.checkForUpdates = () => Promise.resolve(null);
  autoUpdater.checkForUpdatesAndNotify = () => Promise.resolve(null);

  autoUpdater.on('update-available', (info) => {
    log.info('[UPDATER] Update available:', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    log.info('[UPDATER] No update available.');
  });

  autoUpdater.on('error', (err) => {
    log.error('[UPDATER] Error:', err == null ? 'unknown' : (err.message || err));
  });

  autoUpdater.on('download-progress', (p) => {
    log.info(`[UPDATER] Downloading: ${Math.round(p.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[UPDATER] Update downloaded:', info.version);
    if (!mainWindow) return;
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['CĂ i Ä‘áş·t & Khá»źi Ä‘á»™ng láşˇi', 'Äá» sau'],
      defaultId: 0,
      cancelId: 1,
      title: 'Cáş­p nháş­t BetterTok.app',
      message: `ÄĂŁ cĂł báşŁn cáş­p nháş­t má»›i (phiĂŞn báşŁn ${info.version}).`,
      detail: 'BáşŁn cáş­p nháş­t Ä‘ĂŁ táşŁi xong. Khá»źi Ä‘á»™ng láşˇi Ä‘á» Ăˇp dá»Ąng ngay, hoáş·c nĂł sáş˝ tá»± cĂ i khi báşˇn thoĂˇt app.'
    }).then(result => {
      if (result.response === 0 && autoUpdater) {
        autoUpdater.quitAndInstall();
      }
    }).catch(err => log.error('[UPDATER] dialog error:', err));
  });

  // Check availability only. Never download/install an update automatically;
  // this prevents stale pending installers from replacing a validated local build.
  autoUpdater.checkForUpdates().catch(err => log.error('[UPDATER] initial check failed:', err && err.message));
  setInterval(() => {
    if (!autoUpdater) return;
    autoUpdater.checkForUpdates().catch(err => log.error('[UPDATER] periodic check failed:', err && err.message));
  }, 30 * 60 * 1000);
}

app.whenReady().then(async () => {
  try {
    await serverReady;
  } catch (err) {
    log.error('[MAIN] Server startup failed:', err && (err.stack || err.message || err));
    await dialog.showMessageBox({
      type: 'error',
      title: 'KhĂ´ng thá» khá»źi Ä‘á»™ng mĂˇy chá»§',
      message: 'MĂˇy chá»§ ná»™i bá»™ khĂ´ng thá» khá»źi Ä‘á»™ng trĂŞn cá»•ng 3000.',
      detail: 'HĂŁy Ä‘Ăłng báşŁn BetterTok.app khĂˇc rá»“i má»ź láşˇi á»©ng dá»Ąng.\n\n' + (err && err.code ? err.code : (err && err.message ? err.message : 'Lá»—i khĂ´ng xĂˇc Ä‘á»‹nh'))
    });
    app.quit();
    return;
  }
  createWindow();