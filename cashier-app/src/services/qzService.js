/**
 * qzService.js
 * Manages the QZ Tray WebSocket connection.
 * QZ Tray is a small desktop app that bridges the web app to local hardware.
 * Download: https://qz.io/download/
 */

let qz = null;
let connected = false;

// Lazy-load QZ Tray library (loaded via CDN in index.html or bundled)
const getQZ = () => {
  if (qz) return qz;
  if (typeof window !== 'undefined' && window.qz) {
    qz = window.qz;
    return qz;
  }
  return null;
};

export const isQZAvailable = () => !!getQZ();
export const isQZConnected = () => connected;

export const connectQZ = async () => {
  const q = getQZ();
  if (!q) throw new Error('QZ Tray library not loaded. Add qz-tray.js to index.html.');
  if (connected) return true;

  try {
    await q.websocket.connect({ retries: 2, delay: 1 });
    connected = true;

    q.websocket.setClosedCallbacks(() => { connected = false; });

    // Security: certificate signing (for production use signed cert)
    q.security.setCertificatePromise((resolve) => resolve(''));
    q.security.setSignatureAlgorithm('SHA512');
    q.security.setSignaturePromise(() => Promise.resolve(''));

    return true;
  } catch (err) {
    connected = false;
    throw new Error(`QZ Tray not running. Start QZ Tray and try again. (${err.message})`);
  }
};

export const disconnectQZ = async () => {
  const q = getQZ();
  if (q && connected) {
    await q.websocket.disconnect();
    connected = false;
  }
};

export const listPrinters = async () => {
  const q = getQZ();
  if (!q || !connected) return [];
  try {
    const printers = await q.printers.find();
    return Array.isArray(printers) ? printers : [printers];
  } catch {
    return [];
  }
};

export const findPrinterByName = async (partialName) => {
  const q = getQZ();
  if (!q || !connected) return null;
  try {
    const found = await q.printers.find(partialName);
    return Array.isArray(found) ? found[0] : found;
  } catch {
    return null;
  }
};

export const printRaw = async (printerName, data) => {
  const q = getQZ();
  if (!q || !connected) throw new Error('QZ Tray not connected');
  const config = q.configs.create(printerName);
  await q.print(config, data);
};

export const printZPL = async (printerName, zplString) => {
  const q = getQZ();
  if (!q || !connected) throw new Error('QZ Tray not connected');
  const config = q.configs.create(printerName);
  await q.print(config, [{ type: 'raw', format: 'plain', data: zplString }]);
};
