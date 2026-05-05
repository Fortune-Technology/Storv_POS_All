/**
 * useScale.js
 * Web Serial API integration for retail scales.
 *
 * Supports:
 *   CAS, Mettler Toledo, Avery Berkel, Digi, Generic RS-232,
 *   Datalogic Magellan 9800i (scale + barcode scanner combo)
 *
 * The Datalogic Magellan 9800i sends BOTH weight data AND barcode data
 * over the same serial port (USB-CDC mode). This hook detects which type
 * each line is and routes them to the correct callback.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// ── Weight + barcode parsing ───────────────────────────────────────────────

/**
 * Returns { weight, unit, stable, raw } if the line is a weight reading.
 * Returns null if the line is not a weight reading.
 */
const parseWeightLine = (line) => {
  const clean = line.trim();
  if (!clean) return null;

  // Unit pattern — must be present for this to be a weight line
  const match = clean.match(/([+-]?\s*\d+\.?\d*)\s*(kg|KG|lb|LB|g\b|G\b|oz|OZ)/);
  if (!match) return null;

  const value = parseFloat(match[1].replace(/\s/g, ''));
  const unit  = match[2].toLowerCase().replace('lb', 'lbs');

  // Stability detection across brands:
  //   CAS:      "ST,GS,…" = stable,  "US,GS,…" = unstable
  //   Mettler:  "S S …"  = stable,  "S D …"  = moving
  //   Avery:    "… ST"   = stable
  //   Datalogic:"S …"    = stable,  "D …"    = dynamic/moving
  const stable =
    /^(ST|S S|STA|S\s)/i.test(clean) ||    // starts with stable code
    /(,ST|ST$|STABLE)/i.test(clean) ||      // ends with / contains ST
    !/^(US|S D|SD|D\s|UN)/i.test(clean);   // not clearly unstable

  return { weight: value, unit, stable, raw: clean };
};

/**
 * Returns the barcode string if the line looks like a barcode scan.
 * Barcodes have NO weight unit and are reasonable-length alphanumeric strings.
 */
const parseBarcodeOutput = (line) => {
  const clean = line.trim();
  if (!clean) return null;

  // Must NOT contain a weight unit
  if (/\d\s*(kg|KG|lb|LB|g\b|G\b|oz|OZ)/.test(clean)) return null;

  // Must be alphanumeric (letters, digits, hyphens, spaces)
  // and reasonable barcode length (4–128 chars)
  if (clean.length < 4 || clean.length > 128) return null;
  if (!/^[A-Za-z0-9\-\.\s]+$/.test(clean)) return null;

  // Reject pure whitespace or status codes (scale prefixes like "Z  " for zero)
  if (/^[A-Z]{1,3}\s*$/.test(clean)) return null;

  return clean;
};

// ── Hook ──────────────────────────────────────────────────────────────────

export function useScale({ onBarcode } = {}) {
  const [weight,    setWeight]    = useState(null);
  const [unit,      setUnit]      = useState('kg');
  const [stable,    setStable]    = useState(false);
  const [connected, setConnected] = useState(false);
  const [error,     setError]     = useState(null);
  const [rawOutput, setRawOutput] = useState('');
  const [portLabel, setPortLabel] = useState('');

  const portRef      = useRef(null);
  const readerRef    = useRef(null);
  const active       = useRef(false);
  const onBarcodeRef = useRef(onBarcode);

  // Keep callback ref current without re-creating connect/readLoop
  useEffect(() => { onBarcodeRef.current = onBarcode; }, [onBarcode]);

  // ── List already-granted serial ports (for the setup dropdown) ──────────
  const getGrantedPorts = useCallback(async () => {
    if (!('serial' in navigator)) return [];
    try {
      const ports = await navigator.serial.getPorts();
      return ports.map((port, i) => {
        const info = port.getInfo?.() ?? {};
        // Build a human-readable label from USB vendor/product IDs if available
        let label = `Serial Port ${i + 1}`;
        if (info.usbVendorId === 0x05f9 || info.usbVendorId === 0x04B4) {
          label = `Datalogic Magellan (Port ${i + 1})`;
        } else if (info.usbVendorId) {
          label = `USB Serial Port ${i + 1} (VID:${info.usbVendorId.toString(16).toUpperCase()})`;
        }
        return { port, label, index: i };
      });
    } catch {
      return [];
    }
  }, []);

  // ── Request a new port (opens browser picker) ────────────────────────────
  const requestPort = useCallback(async () => {
    if (!('serial' in navigator)) return null;
    try {
      // Hint: Datalogic Magellan 9800i USB vendor IDs
      const port = await navigator.serial.requestPort({
        filters: [
          { usbVendorId: 0x05F9 }, // Datalogic
          { usbVendorId: 0x04B4 }, // Cypress (some Datalogic models)
        ],
      });
      return port;
    } catch (err) {
      if (err.name === 'NotSelectedError') return null; // user cancelled
      throw err;
    }
  }, []);

  // ── Internal read loop ───────────────────────────────────────────────────
  const readLoop = useCallback(async (port) => {
    const reader = port.readable.getReader();
    readerRef.current = reader;
    let buffer = '';
    try {
      while (active.current) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += new TextDecoder().decode(value);

        // Split on CR, LF, or CRLF
        const lines = buffer.split(/[\r\n]+/);
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          setRawOutput(line.trim());

          // 1. Try weight first
          const weightData = parseWeightLine(line);
          if (weightData) {
            setWeight(weightData.weight);
            setUnit(weightData.unit);
            setStable(weightData.stable);
            continue;
          }

          // 2. Try barcode (Datalogic Magellan combo unit)
          const barcode = parseBarcodeOutput(line);
          if (barcode && onBarcodeRef.current) {
            onBarcodeRef.current(barcode);
          }
        }
      }
    } catch (err) {
      if (active.current) setError('Scale disconnected: ' + err.message);
    } finally {
      reader.releaseLock();
      setConnected(false);
    }
  }, []);

  // ── Connect ──────────────────────────────────────────────────────────────
  const connect = useCallback(async (baudRate = 9600, existingPort = null, framing = {}) => {
    if (!('serial' in navigator)) {
      setError('Web Serial API not supported. Use Chrome or Edge.');
      return false;
    }
    try {
      setError(null);
      let port = existingPort;
      if (!port) {
        // Try granted ports first, otherwise open picker
        const granted = await navigator.serial.getPorts();
        port = granted[0] ?? await navigator.serial.requestPort({
          filters: [
            { usbVendorId: 0x05F9 },
            { usbVendorId: 0x04B4 },
          ],
        });
      }
      if (!port) return false;

      const dataBits = Number(framing.dataBits ?? 8);
      const stopBits = Number(framing.stopBits ?? 1);
      const parity   = String(framing.parity ?? 'none');
      await port.open({ baudRate, dataBits, stopBits, parity });
      portRef.current = port;
      active.current  = true;
      setConnected(true);

      // Try to get a readable label
      const info = port.getInfo?.() ?? {};
      if (info.usbVendorId === 0x05F9 || info.usbVendorId === 0x04B4) {
        setPortLabel('Datalogic Magellan');
      } else {
        setPortLabel('Serial Device');
      }

      readLoop(port);
      return true;
    } catch (err) {
      if (err.name !== 'NotSelectedError') {
        setError('Failed to connect: ' + err.message);
      }
      return false;
    }
  }, [readLoop]);

  // ── Connect to a specific port object (from dropdown selection) ──────────
  const connectToPort = useCallback(async (port, baudRate = 9600, label = '', framing = {}) => {
    if (!port) return false;
    try {
      setError(null);
      const dataBits = Number(framing.dataBits ?? 8);
      const stopBits = Number(framing.stopBits ?? 1);
      const parity   = String(framing.parity ?? 'none');
      await port.open({ baudRate, dataBits, stopBits, parity });
      portRef.current = port;
      active.current  = true;
      setConnected(true);
      setPortLabel(label || 'Serial Device');
      readLoop(port);
      return true;
    } catch (err) {
      setError('Failed to connect: ' + err.message);
      return false;
    }
  }, [readLoop]);

  // ── Disconnect ───────────────────────────────────────────────────────────
  const disconnect = useCallback(async () => {
    active.current = false;
    try { readerRef.current?.cancel(); } catch {}
    try { await portRef.current?.close(); } catch {}
    portRef.current   = null;
    readerRef.current = null;
    setConnected(false);
    setWeight(null);
    setStable(false);
    setPortLabel('');
  }, []);

  // ── Send command to scale (e.g. 'W\r\n' for weight request) ─────────────
  const sendCommand = useCallback(async (cmd) => {
    // TCP mode (Electron)
    if (connectionModeRef.current === 'tcp' && window.electronAPI?.scaleSend) {
      await window.electronAPI.scaleSend(cmd);
      return;
    }
    // USB Serial mode
    if (!portRef.current?.writable) return;
    const writer = portRef.current.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(cmd));
    } finally {
      writer.releaseLock();
    }
  }, []);

  const requestWeight = useCallback(() => sendCommand('W\r\n'), [sendCommand]);

  // ── TCP connection mode (Serial-over-LAN via Electron) ─────────────────
  const connectionModeRef = useRef('serial'); // 'serial' | 'tcp'

  const connectTCP = useCallback(async (ip, port = 4001) => {
    if (!window.electronAPI?.scaleConnect) {
      setError('TCP scale requires Electron desktop app');
      return false;
    }

    setError(null);
    connectionModeRef.current = 'tcp';

    // Set up IPC listeners for incoming data
    window.electronAPI.removeScaleListeners();

    window.electronAPI.onScaleData((line) => {
      if (!line) return;
      setRawOutput(line);

      // 1. Try weight
      const weightData = parseWeightLine(line);
      if (weightData) {
        setWeight(weightData.weight);
        setUnit(weightData.unit);
        setStable(weightData.stable);
        return;
      }

      // 2. Try barcode
      const barcode = parseBarcodeOutput(line);
      if (barcode && onBarcodeRef.current) {
        onBarcodeRef.current(barcode);
      }
    });

    window.electronAPI.onScaleError((msg) => {
      setError('Scale error: ' + msg);
      setConnected(false);
    });

    window.electronAPI.onScaleDisconnect(() => {
      setConnected(false);
      setWeight(null);
    });

    try {
      const result = await window.electronAPI.scaleConnect(ip, port);
      if (result.ok) {
        setConnected(true);
        setPortLabel(`Magellan TCP ${ip}:${port}`);
        return true;
      } else {
        setError(result.error || 'Failed to connect');
        return false;
      }
    } catch (err) {
      setError('Connection failed: ' + err.message);
      return false;
    }
  }, []);

  const disconnectTCP = useCallback(async () => {
    if (window.electronAPI?.scaleDisconnect) {
      await window.electronAPI.scaleDisconnect();
    }
    window.electronAPI?.removeScaleListeners?.();
    setConnected(false);
    setWeight(null);
    setStable(false);
    setPortLabel('');
    connectionModeRef.current = 'serial';
  }, []);

  // ── Native COM port connection (Electron serialport) ──────────────────
  // framing: { dataBits: 7|8, stopBits: 1|2, parity: 'none'|'odd'|'even' }
  // Defaults to 9600 8-N-1 if framing is omitted.
  const connectSerial = useCallback(async (comPath, baud = 9600, framing = {}) => {
    if (!window.electronAPI?.serialConnect) {
      setError('Native COM port requires Electron desktop app');
      return false;
    }

    setError(null);
    connectionModeRef.current = 'serial-native';

    // Reuse the same IPC listeners as TCP (both emit on 'scale:data')
    window.electronAPI.removeScaleListeners();

    window.electronAPI.onScaleData((line) => {
      if (!line) return;
      setRawOutput(line);
      const weightData = parseWeightLine(line);
      if (weightData) {
        setWeight(weightData.weight);
        setUnit(weightData.unit);
        setStable(weightData.stable);
        return;
      }
      const barcode = parseBarcodeOutput(line);
      if (barcode && onBarcodeRef.current) {
        onBarcodeRef.current(barcode);
      }
    });

    window.electronAPI.onScaleError((msg) => {
      setError('Scale error: ' + msg);
      setConnected(false);
    });

    window.electronAPI.onScaleDisconnect(() => {
      setConnected(false);
      setWeight(null);
    });

    try {
      const dataBits = Number(framing.dataBits ?? 8);
      const stopBits = Number(framing.stopBits ?? 1);
      const parity   = String(framing.parity ?? 'none');
      const result = await window.electronAPI.serialConnect(comPath, baud, dataBits, stopBits, parity);
      if (result.ok) {
        setConnected(true);
        setPortLabel(`COM ${comPath} @ ${baud} ${dataBits}-${parity[0].toUpperCase()}-${stopBits}`);
        return true;
      } else {
        setError(result.error || 'Failed to open ' + comPath);
        return false;
      }
    } catch (err) {
      setError('Connection failed: ' + err.message);
      return false;
    }
  }, []);

  const disconnectSerial = useCallback(async () => {
    if (window.electronAPI?.serialDisconnect) {
      await window.electronAPI.serialDisconnect();
    }
    window.electronAPI?.removeScaleListeners?.();
    setConnected(false);
    setWeight(null);
    setStable(false);
    setPortLabel('');
    connectionModeRef.current = 'serial';
  }, []);

  const formattedWeight = weight != null
    ? `${weight.toFixed(3)} ${unit}`
    : '---';

  useEffect(() => () => {
    disconnect();
    if (connectionModeRef.current === 'tcp') disconnectTCP();
    if (connectionModeRef.current === 'serial-native') disconnectSerial();
  }, [disconnect, disconnectTCP, disconnectSerial]);

  return {
    weight, unit, stable, connected, error, rawOutput,
    formattedWeight, portLabel,
    connect, connectToPort, connectTCP, connectSerial,
    disconnect, disconnectTCP, disconnectSerial,
    requestWeight, sendCommand,
    getGrantedPorts, requestPort,
    isSupported: 'serial' in navigator,
    isTCPSupported: !!window.electronAPI?.scaleConnect,
    isSerialNativeSupported: !!window.electronAPI?.serialConnect,
  };
}
