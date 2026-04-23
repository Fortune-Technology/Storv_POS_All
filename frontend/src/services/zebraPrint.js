/**
 * Zebra Browser Print Integration
 *
 * Connects to Zebra Browser Print desktop app via WebSocket (localhost:9100).
 * Zebra Browser Print must be installed and running on the user's PC.
 * Download: https://www.zebra.com/us/en/software/printer-software/browser-print.html
 *
 * Flow:
 *   1. connect()         → establish WebSocket to Zebra Browser Print
 *   2. getAvailablePrinters() → list all Zebra printers found
 *   3. setDefaultPrinter(name) → select which printer to use
 *   4. print(zpl)        → send ZPL string to the selected printer
 *   5. printTestLabel()  → send a diagnostic label to verify connectivity
 */

const ZBP_ENDPOINT = 'http://localhost:9100';
const ZBP_ENDPOINT_HTTPS = 'https://localhost:9101';

let _device = null;
let _availablePrinters = [];
let _selectedPrinter = null;
let _isConnected = false;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function zbpFetch(path, options = {}) {
  // Try HTTPS first (Zebra Browser Print 4+), fallback to HTTP
  for (const base of [ZBP_ENDPOINT_HTTPS, ZBP_ENDPOINT]) {
    try {
      const resp = await fetch(`${base}${path}`, {
        ...options,
        headers: { 'Content-Type': 'text/plain', ...options.headers },
      });
      if (resp.ok) return resp;
    } catch {
      // Try next endpoint
    }
  }
  throw new Error('Cannot connect to Zebra Browser Print. Is it installed and running?');
}

// ── Connect & Discover ───────────────────────────────────────────────────────

// Full device descriptors (objects) kept internally so /write can send the
// complete record Browser Print v5 requires (uid + name + connection + ...).
// The exported `printers` string[] is derived from these for UI compatibility.
let _availableDevices = [];

/**
 * Connect to Zebra Browser Print and discover available printers.
 * @returns {{ connected: boolean, printers: string[], error?: string }}
 */
export async function connectZebra() {
  try {
    const resp = await zbpFetch('/available');
    const text = await resp.text();

    // Parse printer list — Browser Print returns JSON in v3+, plain text in older versions.
    // Normalize to an array of { name, uid, connection, provider, version, manufacturer, deviceType }
    // so /write can send the full descriptor (required by v5+ which errors "No value for uid").
    let devices = [];
    try {
      const json = JSON.parse(text);
      const rows = json.printer || json.printers || (Array.isArray(json) ? json : []);
      const arr  = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      devices = arr.map(r => (typeof r === 'string'
        ? { name: r, uid: r }
        : {
            deviceType:   r.deviceType   || 'printer',
            uid:          r.uid          || r.name,
            name:         r.name         || r.uid,
            connection:   r.connection   || 'usb',
            provider:     r.provider,
            version:      r.version,
            manufacturer: r.manufacturer,
          }
      )).filter(d => d.name || d.uid);
    } catch {
      // Plain text — split by newline; uid falls back to name
      devices = text.split('\n').map(s => s.trim()).filter(Boolean)
        .map(name => ({ name, uid: name, connection: 'usb' }));
    }

    const printers = devices.map(d => d.name);
    _availableDevices  = devices;
    _availablePrinters = printers;
    _isConnected = true;

    // Auto-select first printer if none selected
    if (!_selectedPrinter && printers.length > 0) {
      _selectedPrinter = printers[0];
    }

    // Restore saved preference
    const saved = localStorage.getItem('storv_zebra_printer');
    if (saved && printers.includes(saved)) {
      _selectedPrinter = saved;
    }

    return { connected: true, printers, selectedPrinter: _selectedPrinter };
  } catch (err) {
    _isConnected = false;
    _availablePrinters = [];
    _availableDevices  = [];
    return { connected: false, printers: [], error: err.message };
  }
}

/**
 * Get current connection status.
 */
export function getZebraStatus() {
  return {
    connected: _isConnected,
    printers: _availablePrinters,
    selectedPrinter: _selectedPrinter,
  };
}

/**
 * Select which printer to use.
 * @param {string} printerName — name from the available printers list
 */
export function selectZebraPrinter(printerName) {
  _selectedPrinter = printerName;
  localStorage.setItem('storv_zebra_printer', printerName);
}

// ── Print ────────────────────────────────────────────────────────────────────

/**
 * Send ZPL to the selected Zebra printer.
 *
 * Browser Print v5 requires the FULL device descriptor on the `device` field
 * (it errors "No value for uid" otherwise). We look up the full object from
 * `_availableDevices` by name; if not cached, we synthesise a minimum object
 * using the same string for both name and uid (works for v3-v4 fallback).
 *
 * @param {string|object} zpl — ZPL command string (^XA ... ^XZ)
 * @param {string|object} [printerName] — printer name (string) OR the full device
 *   descriptor object. Object form is accepted for defensive tolerance against
 *   older callers that stashed the whole descriptor in localStorage.
 * @returns {{ success: boolean, error?: string }}
 */
export async function printZPL(zpl, printerName) {
  const input = printerName || _selectedPrinter;
  if (!input) {
    return { success: false, error: 'No printer selected. Connect to Zebra Browser Print first.' };
  }

  // Normalise to a name string whether caller passed a name or a device object
  const nameStr =
    typeof input === 'string' ? input : (input?.name || input?.uid || '');
  if (!nameStr) {
    return { success: false, error: 'Printer name is empty or invalid' };
  }

  // Resolve the full device descriptor. Prefer the object cached during
  // connectZebra (has uid + provider + version that v5 requires). If the
  // caller passed an object directly, use that. Otherwise synthesise.
  let device =
    _availableDevices.find(d => d.name === nameStr || d.uid === nameStr) ||
    (typeof input === 'object' && input?.uid ? input : null) ||
    { name: nameStr, uid: nameStr, connection: 'usb', deviceType: 'printer' };

  try {
    await zbpFetch('/write', {
      method: 'POST',
      body: JSON.stringify({ device, data: zpl }),
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Print a test label to verify connectivity.
 * @param {string} [printerName] — override
 * @returns {{ success: boolean, error?: string }}
 */
export async function printTestLabel(printerName) {
  const testZPL = `^XA
^PW406
^LL203
^FO20,20
^A0,30,20
^FDStoreVue POS^FS
^FO20,60
^A0,22,16
^FDZebra Test Label^FS
^FO20,90
^A0,18,14
^FDPrinter: ${printerName || _selectedPrinter || 'Unknown'}^FS
^FO20,115
^A0,18,14
^FD${new Date().toLocaleString()}^FS
^FO20,145
^BY2,2,40
^BC,,Y,N,N
^FD1234567890^FS
^XZ`;

  return printZPL(testZPL, printerName);
}

/**
 * Check if Zebra Browser Print is available (fast ping).
 * @returns {boolean}
 */
export async function isZebraAvailable() {
  try {
    await zbpFetch('/available');
    return true;
  } catch {
    return false;
  }
}

export default {
  connectZebra,
  getZebraStatus,
  selectZebraPrinter,
  printZPL,
  printTestLabel,
  isZebraAvailable,
};
