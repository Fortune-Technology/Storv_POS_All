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

  // ── Cash Drawer ───────────────────────────────────────────────────────────
  /** Open drawer connected to a network receipt printer */
  openDrawerNetwork: (ip, port) =>
    ipcRenderer.invoke('drawer:open-network', { ip, port }),

  /** Open drawer connected to a USB receipt printer */
  openDrawerUSB: (printerName) =>
    ipcRenderer.invoke('drawer:open-usb', { printerName }),

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
  /** Connect to a COM port at given baud rate — data arrives via onScaleData */
  serialConnect:    (path, baud)   => ipcRenderer.invoke('serial:connect', { path, baud }),
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
});
