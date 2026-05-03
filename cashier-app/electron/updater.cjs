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

// ── Dev simulator ─────────────────────────────────────────────────────────
// `electron-updater` only runs in packaged builds. To preview the UI states
// during development without standing up a release server, set:
//   UPDATER_SIMULATE=1 npm run electron:dev
// (or use the in-app menu in dev). The simulator walks through
//   checking → available → downloading 0…100% → ready → idle
// in response to the same renderer IPC calls real updates use, so the
// UpdateBadge + StatusBar pill render every state exactly as in production.
const SIMULATE = process.env.UPDATER_SIMULATE === '1' || process.env.UPDATER_SIMULATE === 'true';

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

// ── Simulated update sequences (dev only) ────────────────────────────────
function simulateCheck() {
  setState({ status: 'checking', message: 'Checking for updates… (SIMULATED)', error: null });
  setTimeout(() => {
    setState({
      status: 'available',
      message: 'Version 99.0.0 is available. (SIMULATED)',
      version: '99.0.0',
      error: null,
    });
  }, 900);
}

function simulateDownload() {
  let pct = 0;
  setState({
    status: 'downloading',
    message: 'Downloading update… 0% (SIMULATED)',
    progress: { percent: 0, transferred: 0, total: 50 * 1024 * 1024, bytesPerSecond: 1024 * 1024 },
    error: null,
  });
  const tick = setInterval(() => {
    pct = Math.min(100, pct + 7 + Math.random() * 6);
    if (pct >= 100) {
      clearInterval(tick);
      setState({
        status: 'ready',
        message: 'Update 99.0.0 is ready to install. (SIMULATED)',
        version: '99.0.0',
        progress: null,
        error: null,
      });
      return;
    }
    setState({
      status: 'downloading',
      message: `Downloading update… ${Math.round(pct)}% (SIMULATED)`,
      progress: {
        percent:        pct,
        transferred:    Math.round((pct / 100) * 50 * 1024 * 1024),
        total:          50 * 1024 * 1024,
        bytesPerSecond: 1024 * 1024,
      },
      error: null,
    });
  }, 250);
}

function simulateInstall() {
  console.log('[Updater] (SIMULATE) quitAndInstall would fire here in production.');
  // Cycle back to idle so the dev tester can run another round
  setTimeout(() => {
    setState({
      status: 'idle',
      message: 'Simulated install complete — back to idle. Click again to repeat.',
      version: null,
      progress: null,
      error: null,
    });
  }, 600);
}

function registerIPC() {
  ipcMain.handle('updater:get-state', () => state);

  ipcMain.handle('updater:check', async () => {
    if (SIMULATE) {
      simulateCheck();
      return state;
    }
    if (!app.isPackaged) {
      // electron-updater intentionally refuses in dev. Return a friendly state.
      setState({
        status: 'no-update',
        message: 'Auto-update is only available in the installed app (not in dev). Run with UPDATER_SIMULATE=1 to preview the UI.',
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
    if (SIMULATE) {
      simulateDownload();
      return { ok: true };
    }
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
    if (SIMULATE) {
      simulateInstall();
      return { ok: true };
    }
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

  if (SIMULATE) {
    console.log('[Updater] SIMULATION MODE — fake update flow active. Set UPDATER_SIMULATE=0 to disable.');
    // Kick off a simulated "available" state shortly after launch so the
    // PIN-screen badge + StatusBar pill light up without any user action.
    setTimeout(simulateCheck, 1500);
    return;
  }

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
