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

/**
 * Connect to Zebra Browser Print and discover available printers.
 * @returns {{ connected: boolean, printers: string[], error?: string }}
 */
export async function connectZebra() {
  try {
    const resp = await zbpFetch('/available');
    const text = await resp.text();

    // Parse printer list — Zebra Browser Print returns newline-separated printer names
    // or JSON depending on version
    let printers = [];
    try {
      const json = JSON.parse(text);
      printers = json.printer || json.printers || (Array.isArray(json) ? json : []);
      if (typeof printers === 'string') printers = [printers];
    } catch {
      // Plain text — split by newline
      printers = text.split('\n').map(s => s.trim()).filter(Boolean);
    }

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
 * @param {string} zpl — ZPL command string (^XA ... ^XZ)
 * @param {string} [printerName] — override the selected printer
 * @returns {{ success: boolean, error?: string }}
 */
export async function printZPL(zpl, printerName) {
  const printer = printerName || _selectedPrinter;
  if (!printer) {
    return { success: false, error: 'No printer selected. Connect to Zebra Browser Print first.' };
  }

  try {
    await zbpFetch('/write', {
      method: 'POST',
      body: JSON.stringify({
        device: { name: printer },
        data: zpl,
      }),
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
