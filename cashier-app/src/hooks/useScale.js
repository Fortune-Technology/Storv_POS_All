/**
 * useScale.js
 * Web Serial API integration for retail scales.
 * Supports CAS, Mettler Toledo, Avery Berkel, Digi, and generic scales.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// Parse scale output for various brand formats
const parseScaleOutput = (line) => {
  const clean = line.trim();
  if (!clean) return null;

  // CAS: "ST,GS,  +  0.450 kg" or "US,GS,  +  0.450 kg" (unstable)
  // Mettler Toledo: "S S      0.450 kg" or "S D      0.450 kg"
  // Avery Berkel: "  0.450 kg ST"
  // Generic: find a number + unit pattern

  const stable   = /^(ST|S S|STA)/i.test(clean) || /(ST|STABLE)/.test(clean.toUpperCase());
  const match    = clean.match(/([+-]?\s*\d+\.?\d*)\s*(kg|KG|lb|LB|g\b|G\b|oz|OZ)/);
  if (!match) return null;

  const value = parseFloat(match[1].replace(/\s/g, ''));
  const unit  = match[2].toLowerCase().replace('lb', 'lbs');

  return { weight: value, unit, stable, raw: clean };
};

export function useScale() {
  const [weight,    setWeight]    = useState(null);
  const [unit,      setUnit]      = useState('kg');
  const [stable,    setStable]    = useState(false);
  const [connected, setConnected] = useState(false);
  const [error,     setError]     = useState(null);
  const [rawOutput, setRawOutput] = useState('');

  const portRef   = useRef(null);
  const readerRef = useRef(null);
  const active    = useRef(false);

  // Detect already-granted serial ports
  const getGrantedPorts = async () => {
    if (!('serial' in navigator)) return [];
    try {
      const ports = await navigator.serial.getPorts();
      return ports.map((p, i) => ({ port: p, label: `Serial Port ${i + 1}` }));
    } catch {
      return [];
    }
  };

  const connect = useCallback(async (baudRate = 9600, existingPort = null) => {
    if (!('serial' in navigator)) {
      setError('Web Serial API not supported. Use Chrome or Edge.');
      return false;
    }
    try {
      setError(null);
      let port = existingPort;
      if (!port) {
        // Opens browser port picker
        port = await navigator.serial.requestPort();
      }
      await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none' });
      portRef.current = port;
      active.current  = true;
      setConnected(true);
      readLoop(port);
      return true;
    } catch (err) {
      if (err.name !== 'NotSelectedError') { // User cancelled = not an error
        setError('Failed to connect: ' + err.message);
      }
      return false;
    }
  }, []);

  const readLoop = async (port) => {
    const reader = port.readable.getReader();
    readerRef.current = reader;
    let buffer = '';
    try {
      while (active.current) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += new TextDecoder().decode(value);
        const lines = buffer.split(/[\r\n]+/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          setRawOutput(line.trim());
          const parsed = parseScaleOutput(line);
          if (parsed) {
            setWeight(parsed.weight);
            setUnit(parsed.unit);
            setStable(parsed.stable);
          }
        }
      }
    } catch (err) {
      if (active.current) setError('Scale disconnected: ' + err.message);
    } finally {
      reader.releaseLock();
      setConnected(false);
    }
  };

  const disconnect = useCallback(async () => {
    active.current = false;
    try { readerRef.current?.cancel(); } catch {}
    try { await portRef.current?.close(); } catch {}
    portRef.current  = null;
    readerRef.current = null;
    setConnected(false);
    setWeight(null);
    setStable(false);
  }, []);

  // Send command to scale (e.g., 'W\r\n' to request weight on some models)
  const sendCommand = useCallback(async (cmd) => {
    if (!portRef.current?.writable) return;
    const writer = portRef.current.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(cmd));
    } finally {
      writer.releaseLock();
    }
  }, []);

  const requestWeight = useCallback(() => sendCommand('W\r\n'), [sendCommand]);

  // Format weight for display
  const formattedWeight = weight != null
    ? `${weight.toFixed(3)} ${unit}`
    : '---';

  useEffect(() => () => { disconnect(); }, [disconnect]);

  return {
    weight, unit, stable, connected, error, rawOutput, formattedWeight,
    connect, disconnect, requestWeight, getGrantedPorts,
    isSupported: 'serial' in navigator,
  };
}
