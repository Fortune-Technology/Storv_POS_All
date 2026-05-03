/**
 * Auto-Update Module — StoreVeu POS
 *
 * Wraps electron-updater with a clean IPC surface so the renderer can:
 *   • Check for updates manually (the "Update" button on PIN login)
 *   • Receive progress + status events (no-update / available / downloading / ready)
 *   • Install once download finishes
 *
 * The update feed URL is read from `UPDATE_FEED_URL` env var at runtime, with
 * a fallback to a generic provider in the package.json `build.publish` block
 * (electron-builder auto-generates `app-update.yml` from that on build).
 *
 * Update files are stored in app userData. Renderer state (localStorage,
 * IndexedDB, station config JSON) is NEVER touched — auto-update only
 * replaces the app binary + ASAR archive.
 */

const { autoUpdater } = require('electron-updater');
const { app, ipcMain, BrowserWindow } = require('electron');

// ── State machine ─────────────────────────────────────────────────────────
// Renderer pulls this via 'updater:get-state' on demand and also receives
// pushed events on 'updater:state' for live UI updates.
let state = {
  // 'idle' | 'checking' | 'available' | 'no-update' | 'downloading' | 'ready' | 'error'
  status:   'idle',
  message:  '',
  version:  null,        // version available for download (when status==='available' or later)
  current:  app.getVersion(),
  progress: null,        // { percent, transferred, total, bytesPerSecond } during download
  error:    null,        // string message when status==='error'
};

function broadcast() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('updater:state', state);
  }
}

function setState(patch) {
  state = { ...state, ...patch };
  broadcast();
}

function configure() {
  // Quiet the default popup — we drive UX from the renderer.
  autoUpdater.autoDownload = false;          // don't download until renderer says so
  autoUpdater.autoInstallOnAppQuit = true;   // install pending download next launch
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableWebInstaller = true;

  // Hook log output so update issues show in the main process console.
  autoUpdater.logger = {
    info:  (m) => console.log('[Updater]', m),
    warn:  (m) => console.warn('[Updater]', m),
    error: (m) => console.error('[Updater]', m),
    debug: () => {},
  };

  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking', message: 'Checking for updates…', error: null });
  });

  autoUpdater.on('update-available', (info) => {
    setState({
      status: 'available',
      message: `Version ${info.version} is available.`,
      version: info.version,
      error: null,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    setState({
      status: 'no-update',
      message: 'You are running the latest version.',
      version: info?.version || state.current,
      error: null,
    });
  });

  autoUpdater.on('download-progress', (p) => {
    setState({
      status: 'downloading',
      message: `Downloading update… ${Math.round(p.percent)}%`,
      progress: {
        percent:        p.percent,
        transferred:    p.transferred,
        total:          p.total,
        bytesPerSecond: p.bytesPerSecond,
      },
      error: null,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setState({
      status: 'ready',
      message: `Update ${info.version} is ready to install.`,
      version: info.version,
      progress: null,
      error: null,
    });
  });

  autoUpdater.on('error', (err) => {
    setState({
      status: 'error',
      message: 'Update check failed.',
      error: err?.message || String(err),
      progress: null,
    });
  });
}

function registerIPC() {
  ipcMain.handle('updater:get-state', () => state);

  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) {
      // electron-updater intentionally refuses in dev. Return a friendly state.
      setState({
        status: 'no-update',
        message: 'Auto-update is only available in the installed app (not in dev).',
        error: null,
      });
      return state;
    }
    try {
      await autoUpdater.checkForUpdates();
      return state;
    } catch (err) {
      setState({ status: 'error', message: 'Update check failed.', error: err?.message || String(err) });
      return state;
    }
  });

  ipcMain.handle('updater:download', async () => {
    if (!app.isPackaged) {
      return { ok: false, error: 'Auto-update is only available in the installed app.' };
    }
    if (state.status !== 'available') {
      return { ok: false, error: 'No update available to download.' };
    }
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      setState({ status: 'error', message: 'Download failed.', error: err?.message || String(err) });
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('updater:install', async () => {
    if (state.status !== 'ready') {
      return { ok: false, error: 'No update has been downloaded yet.' };
    }
    // quitAndInstall(isSilent, isForceRunAfter)
    // false, true → show installer briefly then relaunch the app
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  });
}

/**
 * Initialize the auto-updater. Call once after `app.whenReady()`.
 * Safe to call when not packaged — IPC handlers register but no checks fire.
 */
function init() {
  configure();
  registerIPC();

  // Auto-check 5s after app start (production builds only).
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn('[Updater] Initial check failed:', err.message);
      });
    }, 5000);

    // Re-check every 6 hours so long-running terminals pick up updates.
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 6 * 60 * 60 * 1000);
  }
}

module.exports = { init };
