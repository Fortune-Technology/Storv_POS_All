/**
 * Electron Preload Script — StoreVeu POS
 * Exposes a secure electronAPI to the renderer (React app).
 * contextIsolation is ON — no direct Node.js access from React.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /** Running inside Electron — React can detect with: window.electronAPI?.isElectron */
  isElectron: true,

  // ── Printers ──────────────────────────────────────────────────────────────
  /** Returns array of { name, displayName, isDefault, status } */
  listPrinters: () => ipcRenderer.invoke('printer:list'),

  /** Send raw ESC/POS to a network printer via TCP */
  printNetwork: (ip, port, data) =>
    ipcRenderer.invoke('printer:print-network', { ip, port, data }),

  /** Send raw ESC/POS to a USB/system printer via Windows winspool */
  printUSB: (printerName, data) =>
    ipcRenderer.invoke('printer:print-usb', { printerName, data }),

  /** Send ZPL to a network label printer */
  printLabelNetwork: (ip, port, zpl) =>
    ipcRenderer.invoke('printer:print-label-network', { ip, port, zpl }),

  // ── Zebra Browser Print (USB via local Browser Print service) ─────────────
  /** Returns { connected, printers: [{name, connection, uid, manufacturer}], error? } */
  zebraListPrinters: () => ipcRenderer.invoke('zebra:list-printers'),
  /** Send ZPL to local Zebra via Browser Print. Returns { success, error?, printer? } */
  zebraPrintZPL:     (zpl, printerName) => ipcRenderer.invoke('zebra:print-zpl', { zpl, printerName }),
  /** Print a diagnostic label. Returns { success, error?, printer? } */
  zebraTestLabel:    (printerName) => ipcRenderer.invoke('zebra:test-label', { printerName }),

  // ── Cash Drawer ───────────────────────────────────────────────────────────
  /**
   * Open drawer connected to a network receipt printer.
   * @param {string} ip          — printer IP address
   * @param {number} [port=9100] — printer port
   * @param {string} [printerType='epson'] — 'epson' | 'star'
   */
  openDrawerNetwork: (ip, port, printerType) =>
    ipcRenderer.invoke('drawer:open-network', { ip, port, printerType }),

  /**
   * Open drawer connected to a USB receipt printer.
   * @param {string} printerName — Windows printer share name
   * @param {string} [printerType='epson'] — 'epson' | 'star'
   */
  openDrawerUSB: (printerName, printerType) =>
    ipcRenderer.invoke('drawer:open-usb', { printerName, printerType }),

  // ── App Control ───────────────────────────────────────────────────────────
  getVersion:       () => ipcRenderer.invoke('app:get-version'),
  toggleFullscreen: () => ipcRenderer.invoke('app:toggle-fullscreen'),
  reload:           () => ipcRenderer.invoke('app:reload'),
  quit:             () => ipcRenderer.invoke('app:quit'),

  // ── Scale / Scanner (TCP) ──────────────────────────────────────────────────
  /** Connect to scale/scanner via TCP (Serial-over-LAN) */
  scaleConnect:     (ip, port) => ipcRenderer.invoke('scale:connect', { ip, port }),
  scaleDisconnect:  ()         => ipcRenderer.invoke('scale:disconnect'),
  scaleSend:        (cmd)      => ipcRenderer.invoke('scale:send', cmd),
  /** Listen for scale data (weight lines + barcode lines) — shared by TCP & native serial */
  onScaleData:      (cb) => { ipcRenderer.on('scale:data', (_, line) => cb(line)); },
  onScaleError:     (cb) => { ipcRenderer.on('scale:error', (_, msg) => cb(msg)); },
  onScaleDisconnect:(cb) => { ipcRenderer.on('scale:disconnected', () => cb()); },
  removeScaleListeners: () => {
    ipcRenderer.removeAllListeners('scale:data');
    ipcRenderer.removeAllListeners('scale:error');
    ipcRenderer.removeAllListeners('scale:disconnected');
  },

  // ── Scale / Scanner (Native COM Port) ─────────────────────────────────────
  /** List available COM ports */
  serialList:       ()             => ipcRenderer.invoke('serial:list'),
  /** Connect to a COM port at given baud rate + framing — data arrives via onScaleData.
   *  dataBits: 7|8, stopBits: 1|2, parity: 'none'|'odd'|'even'. Defaults: 9600 8-N-1. */
  serialConnect:    (path, baud, dataBits, stopBits, parity) =>
    ipcRenderer.invoke('serial:connect', { path, baud, dataBits, stopBits, parity }),
  serialDisconnect: ()             => ipcRenderer.invoke('serial:disconnect'),
  serialSend:       (cmd)          => ipcRenderer.invoke('serial:send', cmd),

  // ── Customer Display ───────────────────────────────────────────────────────
  /** Open customer display on secondary monitor (or focus if already open) */
  openCustomerDisplay:  () => ipcRenderer.invoke('app:open-customer-display'),
  /** Close customer display window */
  closeCustomerDisplay: () => ipcRenderer.invoke('app:close-customer-display'),

  // ── Persistent config (disk backup of station config + API URL) ───────────
  // Survives localStorage clears and Electron updates.
  saveConfig: (data) => ipcRenderer.invoke('config:save', data),
  loadConfig: ()     => ipcRenderer.invoke('config:load'),

  // ── External browser ───────────────────────────────────────────────────────
  /** Open a URL in the user's default system browser (Chrome/Edge/Firefox),
   *  not in an Electron BrowserWindow. Returns true on success. */
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),

  // ── Auto-Updater ───────────────────────────────────────────────────────────
  /**
   * Returns the current updater state:
   *   { status, message, version, current, progress, error }
   *   status: 'idle' | 'checking' | 'available' | 'no-update' | 'downloading' | 'ready' | 'error'
   */
  updaterGetState: () => ipcRenderer.invoke('updater:get-state'),

  /** Manually check for updates (button click). Resolves to current state. */
  updaterCheck:    () => ipcRenderer.invoke('updater:check'),

  /** Begin downloading the available update. */
  updaterDownload: () => ipcRenderer.invoke('updater:download'),

  /** Quit and install the downloaded update. App relaunches automatically. */
  updaterInstall:  () => ipcRenderer.invoke('updater:install'),

  /** Subscribe to live updater state changes. Returns an unsubscribe fn. */
  onUpdaterState: (cb) => {
    const handler = (_, state) => cb(state);
    ipcRenderer.on('updater:state', handler);
    return () => ipcRenderer.removeListener('updater:state', handler);
  },
});
