/**
 * Electron Zebra Browser Print bridge
 *
 * Calls the local Zebra Browser Print service (https://localhost:9101 or
 * http://localhost:9100) from Node instead of the browser. Chrome's Local
 * Network Access policy blocks storeveu.com → localhost:9101, but the
 * Electron main process is a Node runtime, not a browser, so it has no
 * such restriction. The portal submits ZPL to the backend queue; the
 * cashier-app renderer picks it up via polling and calls into this module
 * via IPC.
 *
 * Zebra Browser Print must still be installed and running on the PC.
 */

const https = require('https');
const http  = require('http');

const ZBP_HTTPS = { host: 'localhost', port: 9101, protocol: 'https:' };
const ZBP_HTTP  = { host: 'localhost', port: 9100, protocol: 'http:'  };

/** Low-level request helper — ignores self-signed cert on localhost. */
function zbpRequest(target, path, { method = 'GET', body = null, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === 'https:';
    const lib = isHttps ? https : http;
    const opts = {
      host:               target.host,
      port:               target.port,
      path,
      method,
      headers:            { 'Content-Type': 'text/plain' },
      // Zebra Browser Print ships a self-signed localhost cert — accept it.
      rejectUnauthorized: false,
    };

    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data || 'empty response'}`));
        }
      });
    });

    req.on('error',   (err) => reject(err));
    req.on('timeout', () => { req.destroy(new Error('Zebra Browser Print timeout')); });
    req.setTimeout(timeoutMs);

    if (body != null) req.write(body);
    req.end();
  });
}

/** Try HTTPS first, fall back to HTTP. */
async function zbpFetch(path, opts) {
  const errors = [];
  for (const target of [ZBP_HTTPS, ZBP_HTTP]) {
    try {
      return await zbpRequest(target, path, opts);
    } catch (err) {
      errors.push(`${target.protocol}//${target.host}:${target.port}${path} — ${err.message}`);
    }
  }
  throw new Error(
    `Cannot reach Zebra Browser Print. Is it installed and running? Tried:\n  ${errors.join('\n  ')}`
  );
}

/**
 * Discover available Zebra printers.
 * @returns {Promise<{ connected: boolean, printers: Array<{name,connection,uid,manufacturer}>, error?: string }>}
 */
async function listPrinters() {
  try {
    const res = await zbpFetch('/available');
    let printers = [];
    try {
      const json = JSON.parse(res.body);
      const rows = json.printer || json.printers || (Array.isArray(json) ? json : []);
      printers = (Array.isArray(rows) ? rows : [rows])
        .filter(Boolean)
        .map(p => (typeof p === 'string'
          ? { name: p, connection: 'unknown' }
          : { name: p.name || p.uid, connection: p.connection || 'unknown', uid: p.uid, manufacturer: p.manufacturer }));
    } catch {
      // Fall back to newline-separated plain text
      printers = res.body.split('\n').map(s => s.trim()).filter(Boolean)
        .map(name => ({ name, connection: 'unknown' }));
    }
    return { connected: true, printers };
  } catch (err) {
    return { connected: false, printers: [], error: err.message };
  }
}

/**
 * Send ZPL to Zebra Browser Print.
 * @param {object} args
 * @param {string} args.zpl           — ZPL command string
 * @param {string} [args.printerName] — select a specific printer by name/uid
 * @returns {Promise<{ success: boolean, error?: string, printer?: string }>}
 */
async function printZPL({ zpl, printerName }) {
  if (!zpl || typeof zpl !== 'string') {
    return { success: false, error: 'zpl is required' };
  }

  // Resolve the target printer. If the caller didn't specify one, pick the
  // first available — same behaviour as the portal's zebraPrint.js.
  let target = printerName;
  if (!target) {
    const list = await listPrinters();
    if (!list.connected) return { success: false, error: list.error || 'Browser Print not reachable' };
    if (list.printers.length === 0) return { success: false, error: 'No Zebra printers discovered' };
    target = list.printers[0].name;
  }

  const payload = JSON.stringify({
    device: { name: target },
    data: zpl,
  });

  try {
    await zbpFetch('/write', { method: 'POST', body: payload });
    return { success: true, printer: target };
  } catch (err) {
    return { success: false, error: err.message, printer: target };
  }
}

/** Print a small diagnostic label to prove connectivity. */
async function printTestLabel({ printerName } = {}) {
  const zpl = `^XA
^PW406
^LL203
^FO20,20
^A0,30,20
^FDStorv POS — Electron Bridge^FS
^FO20,60
^A0,22,16
^FDZebra Test Label^FS
^FO20,90
^A0,18,14
^FD${new Date().toLocaleString()}^FS
^FO20,145
^BY2,2,40
^BC,,Y,N,N
^FD1234567890^FS
^XZ`;
  return printZPL({ zpl, printerName });
}

module.exports = { listPrinters, printZPL, printTestLabel };
