/**
 * HardwareSettingsModal.jsx
 *
 * Allows reconfiguring station hardware after initial setup.
 * Requires admin or superadmin credentials.
 *
 * Step 1 — Admin auth (email + password, admin/superadmin only)
 * Step 2 — Hardware configuration (receipt printer, cash drawer, scale, label printer)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Loader, Shield, ChevronDown, ChevronUp, Printer,
  Scale, Tag, Check, AlertCircle, RefreshCw, Eye, EyeOff,
} from 'lucide-react';
import { loginWithPassword, saveHardwareConfig } from '../../api/pos.js';
import { useStationStore } from '../../stores/useStationStore.js';
import { isElectron } from '../../hooks/useHardware.js';
import { connectQZ, isQZConnected, listPrinters } from '../../services/qzService.js';
import './HardwareSettingsModal.css';

const HW_KEY = 'storv_hardware_config';
const saveHW = (cfg) => localStorage.setItem(HW_KEY, JSON.stringify(cfg));
const loadHW = () => {
  try { return JSON.parse(localStorage.getItem(HW_KEY) || 'null'); } catch { return null; }
};

const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

const PRINTER_MODELS = [
  { id: 'sii_rpf10',       label: 'SII RP-F10 / RP-G10',            type: 'network', port: 9100, width: '80mm' },
  { id: 'epson_t88vi',     label: 'EPSON TM-T88VI',                  type: 'network', port: 9100, width: '80mm' },
  { id: 'epson_t88vii',    label: 'EPSON TM-T88VII',                 type: 'network', port: 9100, width: '80mm' },
  { id: 'epson_t88v',      label: 'EPSON TM-T88V',                   type: 'network', port: 9100, width: '80mm' },
  { id: 'epson_t20iii',    label: 'EPSON TM-T20III',                 type: 'network', port: 9100, width: '80mm' },
  { id: 'star_tsp143lan',  label: 'Star TSP143 (LAN)',               type: 'network', port: 9100, width: '80mm' },
  { id: 'bixolon_350iii',  label: 'Bixolon SRP-350III (LAN)',        type: 'network', port: 9100, width: '80mm' },
  { id: 'citizen_ct_s310', label: 'Citizen CT-S310II (LAN)',         type: 'network', port: 9100, width: '80mm' },
  { id: 'other_80_lan',    label: 'Other 80mm Printer (LAN)',        type: 'network', port: 9100, width: '80mm' },
  { id: 'other_58_lan',    label: 'Other 58mm Printer (LAN)',        type: 'network', port: 9100, width: '58mm' },
  { id: 'sii_rpf10usb',    label: 'SII RP-F10 (USB)',               type: 'qz',      port: null, width: '80mm' },
  { id: 'epson_t88vi_usb', label: 'EPSON TM-T88VI (USB)',           type: 'qz',      port: null, width: '80mm' },
  { id: 'star_tsp143usb',  label: 'Star TSP143 (USB)',              type: 'qz',      port: null, width: '80mm' },
  { id: 'bixolon_350usb',  label: 'Bixolon SRP-350III (USB)',       type: 'qz',      port: null, width: '80mm' },
  { id: 'other_usb',       label: 'Other USB Printer (via QZ Tray)', type: 'qz',     port: null, width: '80mm' },
];

const SCALE_BRANDS = [
  { id: 'cas',       label: 'CAS (PD-II, SW)',            baud: 9600 },
  { id: 'mettler',   label: 'Mettler Toledo',              baud: 9600 },
  { id: 'avery',     label: 'Avery Berkel',                baud: 9600 },
  { id: 'digi',      label: 'Digi',                        baud: 9600 },
  { id: 'datalogic', label: 'Datalogic Magellan 9800i',    baud: 9600 },
  { id: 'generic',   label: 'Generic RS-232 / USB-Serial', baud: 9600 },
];

/**
 * ZebraRoutedPanel — inline helper shown when "Accept routed Zebra jobs" is on.
 * Lists printers discovered via Electron's zebra:list-printers IPC and offers
 * a test-print button so the user can confirm the local Zebra is reachable
 * from the Electron main process (bypassing Chrome's LNA block).
 */
function ZebraRoutedPanel({ printerName, onChangeName }) {
  const [state, setState] = useState({ loading: true, printers: [], error: null });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.zebraListPrinters) {
      setState({ loading: false, printers: [], error: 'Electron runtime unavailable (run the cashier-app, not the web build).' });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await window.electronAPI.zebraListPrinters();
      setState({
        loading:  false,
        printers: res?.printers || [],
        error:    res?.connected ? null : (res?.error || 'Browser Print not reachable'),
      });
    } catch (err) {
      setState({ loading: false, printers: [], error: err?.message || String(err) });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleTest = async () => {
    if (!window.electronAPI?.zebraTestLabel) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.electronAPI.zebraTestLabel(printerName || undefined);
      setTestResult(res);
    } catch (err) {
      setTestResult({ success: false, error: err?.message || String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ background: 'rgba(59, 130, 246, 0.04)', border: '1px solid rgba(59, 130, 246, 0.25)', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
          Local Zebra Printer
          {state.error
            ? <span style={{ marginLeft: 6, fontSize: '0.68rem', color: 'var(--error, #ef4444)' }}>● Unreachable</span>
            : state.loading
              ? <span style={{ marginLeft: 6, fontSize: '0.68rem', color: 'var(--text-muted)' }}>Discovering…</span>
              : <span style={{ marginLeft: 6, fontSize: '0.68rem', color: 'var(--success, #10b981)' }}>● {state.printers.length} found</span>
          }
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="hsm-save-btn" type="button" onClick={refresh}
            style={{ padding: '4px 10px', fontSize: '0.75rem', background: 'transparent', color: 'var(--text-primary)', border: '1px solid rgba(148, 163, 184, 0.35)' }}>
            <RefreshCw size={12} /> Refresh
          </button>
          <button className="hsm-save-btn" type="button" onClick={handleTest}
            disabled={testing || !!state.error || state.printers.length === 0}
            style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
            {testing ? <Loader size={12} /> : <Printer size={12} />} Test print
          </button>
        </div>
      </div>

      {state.error && (
        <div style={{ fontSize: '0.72rem', color: 'var(--error, #ef4444)', marginBottom: 6 }}>
          {state.error}. Install Zebra Browser Print from
          {' '}<a href="https://www.zebra.com/us/en/software/printer-software/browser-print.html"
          target="_blank" rel="noreferrer">zebra.com</a> and make sure it's running.
        </div>
      )}

      {!state.error && state.printers.length > 0 && (
        <>
          <label className="hsm-label" style={{ fontSize: '0.72rem' }}>Preferred printer (optional)</label>
          <select className="hsm-select"
            value={printerName}
            onChange={(e) => onChangeName(e.target.value)}>
            <option value="">Auto-select first available</option>
            {state.printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}{p.connection && p.connection !== 'unknown' ? ` (${p.connection})` : ''}
              </option>
            ))}
          </select>
        </>
      )}

      {testResult && (
        <div style={{
          marginTop: 8, padding: 6, borderRadius: 6, fontSize: '0.72rem',
          background: testResult.success ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
          color: testResult.success ? 'var(--success, #10b981)' : 'var(--error, #ef4444)',
        }}>
          {testResult.success
            ? `✓ Test label sent to ${testResult.printer || 'Zebra'}`
            : `✗ ${testResult.error || 'Print failed'}`}
        </div>
      )}
    </div>
  );
}

/**
 * S(scale-fix) — Diagnostic banner shown under the COM Port dropdown after
 * Detect is pressed. Helps the cashier figure out why their scale isn't in
 * the list — usually because it's an HID-class scale, or a missing VCP/USB
 * driver. The most common path: scale works in MarketPOS because the user
 * installed the manufacturer's VCP driver during MarketPOS setup; our app
 * has no driver bundling, so the scale's USB device shows up as HID-only
 * (zero COM ports) until the driver is also installed for our app context.
 */
function ScaleDetectDiagnostic({ diag, ports }) {
  if (!diag || diag.kind === 'idle') return null;

  // Successful detection — show a compact summary of what was found.
  if (diag.kind === 'ok') {
    return (
      <div className="hsm-scale-diag hsm-scale-diag--ok">
        <Check size={13} />
        <div>
          <strong>Found {diag.count} COM port{diag.count === 1 ? '' : 's'}.</strong>{' '}
          Pick the one your scale uses (manufacturer name in the dropdown often helps —
          Datalogic, FTDI, Prolific, Silicon Labs, etc.).
        </div>
      </div>
    );
  }

  if (diag.kind === 'no-ipc') {
    return (
      <div className="hsm-scale-diag hsm-scale-diag--err">
        <AlertCircle size={13} />
        <div>
          <strong>Native COM ports require the desktop app.</strong>{' '}
          You're running the browser build — close this and launch the
          installed cashier-app to access COM ports.
        </div>
      </div>
    );
  }

  if (diag.kind === 'no-module') {
    return (
      <div className="hsm-scale-diag hsm-scale-diag--err">
        <AlertCircle size={13} />
        <div>
          <strong>serialport native module didn't load.</strong>{' '}
          This usually means the desktop app build is missing native binaries.
          Reinstall from the latest installer or check the app log for the load error.
          <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>{diag.error}</div>
        </div>
      </div>
    );
  }

  if (diag.kind === 'list-error') {
    return (
      <div className="hsm-scale-diag hsm-scale-diag--err">
        <AlertCircle size={13} />
        <div>
          <strong>OS-level enumeration error.</strong>{' '}
          Try running the cashier-app as administrator (Windows) or check that
          your user is in the <code>dialout</code> group (Linux).
          <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>{diag.error}</div>
        </div>
      </div>
    );
  }

  // empty — most common when MarketPOS sees the scale but we don't.
  if (diag.kind === 'empty') {
    const isWin = diag.platform === 'win32';
    return (
      <div className="hsm-scale-diag hsm-scale-diag--warn">
        <AlertCircle size={13} />
        <div>
          <strong>No COM ports detected.</strong> If MarketPOS sees your scale
          but we don't, the cause is almost always one of these:
          <ul style={{ margin: '6px 0 4px 16px', padding: 0, fontSize: 12 }}>
            <li>
              <strong>Scale is connected as USB-HID</strong> (no COM port).
              Many Datalogic / Magellan / Honeywell scales default to HID mode
              and need a config switch + driver to expose a COM port.
            </li>
            <li>
              <strong>Manufacturer's VCP/USB-Serial driver isn't installed.</strong>{' '}
              MarketPOS typically bundles it; we don't. Install the driver from
              your scale manufacturer's site (Datalogic Aladdin, FTDI VCP,
              Prolific PL-2303, Silicon Labs CP210x, etc.).
            </li>
            <li>
              {isWin ? (
                <>
                  Open <strong>Device Manager → Ports (COM &amp; LPT)</strong> on this
                  PC. If your scale isn't listed there, Windows has no COM
                  port for it — that's why we can't see it either.
                </>
              ) : (
                <>
                  Run <code>ls /dev/tty*</code> in a terminal. If your scale
                  isn't listed (typically <code>/dev/ttyUSB0</code> or
                  <code>/dev/ttyACM0</code>), the kernel hasn't bound a serial
                  driver — install or load the right one.
                </>
              )}
            </li>
            <li>
              If your scale is purely HID, switch the <strong>Connection</strong>{' '}
              dropdown to <em>USB Serial (Web Serial API)</em> — Chromium can
              talk to USB-CDC scales without a Windows driver, and the user
              picks the device via a browser prompt.
            </li>
          </ul>
        </div>
      </div>
    );
  }

  return null;
}

function HWSection({ icon: Icon, title, status, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const dotCls = status === 'ok' ? 'hsm-hw-dot--ok' : status === 'err' ? 'hsm-hw-dot--err' : 'hsm-hw-dot--idle';
  const statusCls = status === 'ok' ? 'hsm-hw-status--ok' : status === 'err' ? 'hsm-hw-status--err' : 'hsm-hw-status--idle';
  const statusText = status === 'ok' ? 'Configured' : status === 'err' ? 'Error' : 'Optional';
  return (
    <div className={`hsm-hw-section${open ? ' hsm-hw-section--open' : ''}`}>
      <div className="hsm-hw-header" onClick={() => setOpen(o => !o)}>
        <div className="hsm-hw-icon"><Icon size={15} color="#7b95e0" /></div>
        <span className="hsm-hw-title">{title}</span>
        <span className={`hsm-hw-dot ${dotCls}`} />
        <span className={`hsm-hw-status ${statusCls}`}>{statusText}</span>
        {open ? <ChevronUp size={13} color="#4b5563" /> : <ChevronDown size={13} color="#4b5563" />}
      </div>
      {open && <div className="hsm-hw-body">{children}</div>}
    </div>
  );
}

export default function HardwareSettingsModal({ onClose }) {
  const station = useStationStore(s => s.station);

  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [hw, setHW] = useState(() => {
    const stored = loadHW();
    const defaults = {
      receiptPrinter: { model: '', type: 'none', name: '', ip: '', port: 9100, width: '80mm' },
      labelPrinter:   { type: 'none', name: '', ip: '', port: 9100, acceptRoutedJobs: false, zebraName: '' },
      scale:          { type: 'none', connection: 'serial', baud: 9600, ip: '', port: 4001, portLabel: '', comPort: '' },
      cashDrawer:     { type: 'none' },
    };
    if (!stored) return defaults;
    // Merge to ensure new fields exist on older persisted configs
    return {
      ...defaults,
      ...stored,
      labelPrinter: { ...defaults.labelPrinter, ...(stored.labelPrinter || {}) },
    };
  });

  const [detectedPrinters, setDetectedPrinters] = useState([]);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Native COM port state ────────────────────────────────────────────────
  const [nativeComPorts, setNativeComPorts]   = useState([]);
  const [detectingNative, setDetectingNative] = useState(false);
  // S(scale-fix) — surface diagnostic info from main.cjs `serial:list` so the
  // user can tell *why* their scale isn't showing up. Possible states:
  //   { kind: 'idle' }                        — Detect not pressed yet
  //   { kind: 'no-ipc' }                      — running outside Electron desktop app
  //   { kind: 'no-module', error }            — serialport native module didn't load
  //   { kind: 'list-error', error }           — OS-level enumeration failure
  //   { kind: 'empty', platform }             — module + OS fine, just no ports registered
  //   { kind: 'ok', count, platform }         — at least one port found
  const [serialDiag, setSerialDiag] = useState({ kind: 'idle' });

  const detectNativeComPorts = useCallback(async () => {
    if (!window.electronAPI?.serialList) {
      setSerialDiag({ kind: 'no-ipc' });
      return;
    }
    setDetectingNative(true);
    try {
      const res = await window.electronAPI.serialList();
      const ports = res?.ports || [];
      setNativeComPorts(ports);
      if (ports.length > 0 && !hw.scale.comPort) {
        updHW('scale', { comPort: ports[0].path });
      }
      if (res?.moduleLoaded === false) {
        setSerialDiag({ kind: 'no-module', error: res?.error || 'serialport not available' });
      } else if (!res?.ok && res?.error) {
        setSerialDiag({ kind: 'list-error', error: res.error });
      } else if (ports.length === 0) {
        setSerialDiag({ kind: 'empty', platform: res?.platform || '' });
      } else {
        setSerialDiag({ kind: 'ok', count: ports.length, platform: res?.platform || '' });
      }
    } catch (err) {
      setSerialDiag({ kind: 'list-error', error: err?.message || String(err) });
    } finally {
      setDetectingNative(false);
    }
  }, [hw.scale.comPort]);

  // ── Scale test state ────────────────────────────────────────────────────
  const [scaleTestConnected, setScaleTestConnected] = useState(false);
  const [scaleTestWeight, setScaleTestWeight]       = useState('');
  const [scaleTestBarcode, setScaleTestBarcode]     = useState('');
  const [scaleTestError, setScaleTestError]         = useState('');
  const scaleSerialPort = useRef(null);
  const scaleSerialReader = useRef(null);
  const scaleTestCleanup = useRef(null);

  const stopScaleTest = useCallback(() => {
    // Clean up TCP IPC listeners
    if (scaleTestCleanup.current) { scaleTestCleanup.current(); scaleTestCleanup.current = null; }
    // Clean up Web Serial
    if (scaleSerialReader.current) {
      try { scaleSerialReader.current.cancel(); } catch {}
      scaleSerialReader.current = null;
    }
    if (scaleSerialPort.current) {
      try { scaleSerialPort.current.close(); } catch {}
      scaleSerialPort.current = null;
    }
    setScaleTestConnected(false);
    setScaleTestWeight('');
    setScaleTestBarcode('');
    setScaleTestError('');
  }, []);

  const startScaleTest = useCallback(async () => {
    stopScaleTest();
    setScaleTestError('');

    if (hw.scale.connection === 'serial-native') {
      // Native COM port via Electron IPC
      if (!window.electronAPI?.serialConnect) {
        setScaleTestError('Electron IPC not available — native COM port requires the desktop app.');
        return;
      }
      if (!hw.scale.comPort) {
        setScaleTestError('Select a COM port first.');
        return;
      }
      try {
        const res = await window.electronAPI.serialConnect(hw.scale.comPort, hw.scale.baud || 9600);
        if (!res?.ok) { setScaleTestError('Failed to open ' + hw.scale.comPort + ': ' + (res?.error || 'unknown')); return; }
        setScaleTestConnected(true);
        const handler = (line) => {
          const match = line.match(/([+-]?\s*\d+\.?\d*)\s*(kg|KG|lb|LB|oz|OZ)/);
          if (match) setScaleTestWeight(parseFloat(match[1]) + ' ' + match[2]);
          else if (/^[A-Za-z0-9\-\.]{4,}$/.test(line.trim())) setScaleTestBarcode(line.trim());
        };
        window.electronAPI.onScaleData(handler);
        scaleTestCleanup.current = () => {
          window.electronAPI.removeScaleListeners?.();
          window.electronAPI.serialDisconnect?.();
        };
      } catch (err) {
        setScaleTestError('COM port connect failed: ' + (err.message || err));
        setScaleTestConnected(false);
      }
      return;
    }

    if (hw.scale.connection === 'tcp') {
      // TCP via Electron IPC
      if (!window.electronAPI?.scaleConnect) {
        setScaleTestError('Electron IPC not available — TCP scale requires the desktop app.');
        return;
      }
      try {
        await window.electronAPI.scaleConnect(hw.scale.ip, hw.scale.port);
        setScaleTestConnected(true);
        const handler = (line) => {
          const match = line.match(/([+-]?\s*\d+\.?\d*)\s*(kg|KG|lb|LB|oz|OZ)/);
          if (match) setScaleTestWeight(parseFloat(match[1]) + ' ' + match[2]);
          else if (/^[A-Za-z0-9\-\.]{4,}$/.test(line.trim())) setScaleTestBarcode(line.trim());
        };
        window.electronAPI.onScaleData(handler);
        scaleTestCleanup.current = () => {
          // S(scale-fix) — was calling a non-existent `offScaleData`, leaving
          // stale listeners attached on every reconnect. `removeScaleListeners`
          // is the documented cleanup channel exposed by preload.cjs.
          window.electronAPI.removeScaleListeners?.();
          window.electronAPI.scaleDisconnect?.();
        };
      } catch (err) {
        setScaleTestError('TCP connect failed: ' + (err.message || err));
        setScaleTestConnected(false);
      }
    } else {
      // Web Serial API
      if (!navigator.serial) {
        setScaleTestError('Web Serial API not available in this browser.');
        return;
      }
      try {
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: hw.scale.baud || 9600 });
        scaleSerialPort.current = port;
        setScaleTestConnected(true);
        const reader = port.readable.getReader();
        scaleSerialReader.current = reader;
        const decoder = new TextDecoder();
        let buffer = '';
        (async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split(/[\r\n]+/);
              buffer = lines.pop() || '';
              for (const line of lines) {
                if (!line.trim()) continue;
                const match = line.match(/([+-]?\s*\d+\.?\d*)\s*(kg|KG|lb|LB|oz|OZ)/);
                if (match) setScaleTestWeight(parseFloat(match[1]) + ' ' + match[2]);
                else if (/^[A-Za-z0-9\-\.]{4,}$/.test(line.trim())) setScaleTestBarcode(line.trim());
              }
            }
          } catch {}
        })();
      } catch (err) {
        setScaleTestError('Serial connect failed: ' + (err.message || err));
        setScaleTestConnected(false);
      }
    }
  }, [hw.scale, stopScaleTest]);

  // Clean up scale test on unmount
  useEffect(() => () => stopScaleTest(), [stopScaleTest]);

  const updHW = (section, fields) => setHW(p => ({ ...p, [section]: { ...p[section], ...fields } }));

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      const data = await loginWithPassword(email, password);
      const user = data.user || data;
      if (!['admin', 'superadmin'].includes(user.role)) {
        throw new Error('Admin or superadmin account required to access hardware settings.');
      }
      setStep(2);
    } catch (err) {
      setAuthError(err.response?.data?.error || err.message || 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    saveHW(hw);
    if (station?.id) {
      saveHardwareConfig(station.id, hw, station.storeId).catch(() => {});
    }
    setTimeout(() => { setSaving(false); onClose(); }, 400);
  };

  const detectPrinters = async () => {
    setDetecting(true);
    try {
      let list = [];
      if (isElectron()) {
        list = (await window.electronAPI.listPrinters()).map(p => p.name || p);
      } else {
        if (!isQZConnected()) await connectQZ();
        list = await listPrinters();
      }
      setDetectedPrinters(list);
    } catch { setDetectedPrinters([]); }
    finally { setDetecting(false); }
  };

  const printerModel = PRINTER_MODELS.find(p => p.id === hw.receiptPrinter.model);

  return (
    <div className="hsm-backdrop">
      <div className="hsm-modal">
        <button className="hsm-close-btn" onClick={onClose}><X size={18} /></button>

        <div className="hsm-header">
          <h2 className="hsm-header-title">Hardware Settings</h2>
          <p className="hsm-header-sub">
            {step === 1 ? 'Admin authentication required' : `Station: ${station?.name || 'Unknown'}`}
          </p>
        </div>

        {/* Step 1: Auth */}
        {step === 1 && (
          <form onSubmit={handleAuth}>
            <div className="hsm-auth-warning">
              <Shield size={16} className="hsm-auth-warning-icon" />
              <div><strong>Admin access only.</strong> Hardware settings can only be changed with an Admin or Super Admin account.</div>
            </div>
            {authError && (
              <div className="hsm-auth-error"><AlertCircle size={15} />{authError}</div>
            )}
            <div className="hsm-auth-form">
              <div>
                <label className="hsm-label">Admin Email</label>
                <input className="hsm-field" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@company.com" required autoFocus />
              </div>
              <div>
                <label className="hsm-label">Password</label>
                <div style={{ position: 'relative' }}>
                  <input className="hsm-field" type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required style={{ paddingRight: 40 }} />
                  <button type="button" onClick={() => setShowPw(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', display: 'flex', padding: 4 }}>
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={authLoading} className={`hsm-auth-btn${authLoading ? ' hsm-auth-btn--loading' : ''}`}>
                {authLoading ? <><Loader size={16} /> Verifying...</> : <><Shield size={16} /> Authenticate</>}
              </button>
            </div>
          </form>
        )}

        {/* Step 2: Hardware */}
        {step === 2 && (
          <>
            <HWSection icon={Printer} title="Receipt Printer" status={hw.receiptPrinter.type !== 'none' && hw.receiptPrinter.model ? 'ok' : 'idle'} defaultOpen>
              <div className="hsm-hw-grid">
                <div>
                  <label className="hsm-label">Printer Model</label>
                  <select className="hsm-select" value={hw.receiptPrinter.model} onChange={e => {
                    const m = PRINTER_MODELS.find(p => p.id === e.target.value);
                    if (m) updHW('receiptPrinter', { model: m.id, type: m.type, port: m.port || 9100, width: m.width });
                    else updHW('receiptPrinter', { model: '', type: 'none' });
                  }}>
                    <option value="">-- Select model --</option>
                    {PRINTER_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
                {printerModel?.type === 'network' && (
                  <div className="hsm-hw-grid-row">
                    <div>
                      <label className="hsm-label">IP Address</label>
                      <input className="hsm-field" value={hw.receiptPrinter.ip || ''} onChange={e => updHW('receiptPrinter', { ip: e.target.value })} placeholder="192.168.1.100" />
                    </div>
                    <div>
                      <label className="hsm-label">Port</label>
                      <input className="hsm-field hsm-field--narrow" type="number" value={hw.receiptPrinter.port || 9100} onChange={e => updHW('receiptPrinter', { port: Number(e.target.value) })} />
                    </div>
                  </div>
                )}
                {printerModel?.type === 'qz' && (
                  <div>
                    <label className="hsm-label">Printer Name</label>
                    <div className="hsm-detect-row">
                      {detectedPrinters.length > 0 ? (
                        <select className="hsm-select" value={hw.receiptPrinter.name || ''} onChange={e => updHW('receiptPrinter', { name: e.target.value })}>
                          <option value="">-- Select printer --</option>
                          {detectedPrinters.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      ) : (
                        <input className="hsm-field" value={hw.receiptPrinter.name || ''} onChange={e => updHW('receiptPrinter', { name: e.target.value })} placeholder="Printer name" />
                      )}
                      <button type="button" className="hsm-test-btn" onClick={detectPrinters} disabled={detecting}>
                        {detecting ? <Loader size={12} /> : <RefreshCw size={12} />} Detect
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </HWSection>

            <HWSection icon={Tag} title="Cash Drawer" status={hw.cashDrawer.type !== 'none' ? 'ok' : 'idle'}>
              <div className="hsm-checkbox-row">
                <label className="hsm-checkbox-label">
                  <input type="checkbox" checked={hw.cashDrawer.type !== 'none'} onChange={e => updHW('cashDrawer', { type: e.target.checked ? 'printer' : 'none' })} />
                  <span className="hsm-checkbox-text">Connected via receipt printer</span>
                </label>
              </div>
            </HWSection>

            <HWSection icon={Scale} title="Weighing Scale / Scanner" status={hw.scale.type !== 'none' ? 'ok' : 'idle'}>
              <div className="hsm-hw-grid">
                <div>
                  <label className="hsm-label">Scale Brand</label>
                  <select className="hsm-select" value={hw.scale.type === 'none' ? '' : hw.scale.brand || ''} onChange={e => {
                    const brand = SCALE_BRANDS.find(b => b.id === e.target.value);
                    updHW('scale', { brand: e.target.value, type: e.target.value ? (hw.scale.connection || 'serial') : 'none', baud: brand?.baud || 9600 });
                  }}>
                    <option value="">-- None --</option>
                    {SCALE_BRANDS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </select>
                </div>
                {hw.scale.type !== 'none' && (
                  <>
                    <div>
                      <label className="hsm-label">Connection</label>
                      <select className="hsm-select" value={hw.scale.connection || 'serial'} onChange={e => updHW('scale', { connection: e.target.value })}>
                        <option value="serial">USB Serial (Web Serial API)</option>
                        <option value="serial-native">Native COM Port (Electron)</option>
                        <option value="tcp">TCP / Serial-over-LAN</option>
                      </select>
                    </div>
                    {hw.scale.connection === 'serial-native' ? (
                      <>
                        <div>
                          <label className="hsm-label">COM Port</label>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <select className="hsm-select" style={{ flex: 1 }} value={hw.scale.comPort || ''} onChange={e => updHW('scale', { comPort: e.target.value })}>
                              <option value="">-- Select --</option>
                              {nativeComPorts.map(p => (
                                <option key={p.path} value={p.path}>{p.path}{p.manufacturer ? ` — ${p.manufacturer}` : ''}</option>
                              ))}
                              {hw.scale.comPort && !nativeComPorts.find(p => p.path === hw.scale.comPort) && (
                                <option value={hw.scale.comPort}>{hw.scale.comPort} (saved)</option>
                              )}
                            </select>
                            <button type="button" className="hsm-test-btn" onClick={detectNativeComPorts} disabled={detectingNative}>
                              {detectingNative ? <Loader size={12} /> : <RefreshCw size={12} />} Detect
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="hsm-label">Baud Rate</label>
                          <select className="hsm-select" value={hw.scale.baud || 9600} onChange={e => updHW('scale', { baud: Number(e.target.value) })}>
                            {BAUD_RATES.map(b => <option key={b} value={b}>{b}</option>)}
                          </select>
                        </div>

                        {/* S(scale-fix) — diagnostic banner. Shown only after the user clicks Detect. */}
                        <ScaleDetectDiagnostic diag={serialDiag} ports={nativeComPorts} />
                      </>
                    ) : hw.scale.connection === 'tcp' ? (
                      <>
                        <div>
                          <label className="hsm-label">IP Address</label>
                          <input className="hsm-field" value={hw.scale.ip || ''} onChange={e => updHW('scale', { ip: e.target.value })} placeholder="192.168.1.100" />
                        </div>
                        <div>
                          <label className="hsm-label">TCP Port</label>
                          <input className="hsm-field" type="number" value={hw.scale.port || 4001} onChange={e => updHW('scale', { port: Number(e.target.value) })} placeholder="4001" />
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="hsm-label">Baud Rate</label>
                          <select className="hsm-select" value={hw.scale.baud || 9600} onChange={e => updHW('scale', { baud: Number(e.target.value) })}>
                            {BAUD_RATES.map(b => <option key={b} value={b}>{b}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="hsm-label">Serial Port</label>
                          <input className="hsm-field" value={hw.scale.portLabel || ''} onChange={e => updHW('scale', { portLabel: e.target.value })} placeholder="e.g. COM3 or /dev/ttyUSB0" />
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

              {/* ── Scale Test Area ─────────────────────────────────────── */}
              {hw.scale.type !== 'none' && (
                <div className="hsm-scale-test">
                  <div className="hsm-scale-test-header">Test Scale</div>
                  {scaleTestError && (
                    <div className="hsm-scale-test-error"><AlertCircle size={13} /> {scaleTestError}</div>
                  )}
                  <div className="hsm-scale-test-controls">
                    {!scaleTestConnected ? (
                      <button type="button" className="hsm-test-btn" onClick={startScaleTest}>
                        <RefreshCw size={12} /> Connect &amp; Test
                      </button>
                    ) : (
                      <>
                        <span className="hsm-scale-test-status hsm-scale-test-status--ok">Connected &#x2705;</span>
                        <button type="button" className="hsm-test-btn hsm-test-btn--disconnect" onClick={stopScaleTest}>
                          Disconnect
                        </button>
                      </>
                    )}
                  </div>
                  {scaleTestConnected && (
                    <div className="hsm-scale-test-readings">
                      <div className="hsm-scale-test-row">
                        <span className="hsm-scale-test-label">Weight:</span>
                        <span className="hsm-scale-test-value">{scaleTestWeight || '— waiting —'}</span>
                      </div>
                      <div className="hsm-scale-test-row">
                        <span className="hsm-scale-test-label">Last Barcode:</span>
                        <span className="hsm-scale-test-value">{scaleTestBarcode || '— none —'}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </HWSection>

            <HWSection icon={Tag} title="Label Printer" status={hw.labelPrinter.type !== 'none' ? 'ok' : 'idle'}>
              <div className="hsm-hw-grid">
                <div>
                  <label className="hsm-label">Label Printer Type</label>
                  <select className="hsm-select" value={hw.labelPrinter.type} onChange={e => updHW('labelPrinter', { type: e.target.value })}>
                    <option value="none">-- None --</option>
                    <option value="zebra_usb">Zebra (ZPL) — USB via QZ Tray</option>
                    <option value="zebra_network">Zebra (ZPL) — Network/TCP</option>
                    <option value="dymo">Dymo LabelWriter</option>
                  </select>
                </div>
                {hw.labelPrinter.type === 'zebra_network' && (
                  <div>
                    <label className="hsm-label">IP Address</label>
                    <input className="hsm-field" value={hw.labelPrinter.ip || ''} onChange={e => updHW('labelPrinter', { ip: e.target.value })} placeholder="192.168.1.101" />
                  </div>
                )}
                {(hw.labelPrinter.type === 'zebra_usb' || hw.labelPrinter.type === 'dymo') && (
                  <div>
                    <label className="hsm-label">Printer Name</label>
                    <input className="hsm-field" value={hw.labelPrinter.name || ''} onChange={e => updHW('labelPrinter', { name: e.target.value })} placeholder="Label printer name" />
                  </div>
                )}
                {hw.labelPrinter.type !== 'none' && (
                  <>
                    <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem' }}>
                        <input type="checkbox"
                          checked={!!hw.labelPrinter.autoPrintOnNew}
                          onChange={e => updHW('labelPrinter', { autoPrintOnNew: e.target.checked })} />
                        Auto-print label when a new product is created from POS
                      </label>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem' }}>
                        <input type="checkbox"
                          checked={!!hw.labelPrinter.autoPrintOnPriceChange}
                          onChange={e => updHW('labelPrinter', { autoPrintOnPriceChange: e.target.checked })} />
                        Auto-print label when product price is changed from POS
                      </label>
                    </div>
                  </>
                )}

                {/* Routed Zebra printing — works independently of the dropdown above */}
                <div style={{ gridColumn: '1 / -1', marginTop: 12, paddingTop: 12, borderTop: '1px dashed rgba(148, 163, 184, 0.35)' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input type="checkbox"
                      style={{ marginTop: 3, flexShrink: 0 }}
                      checked={!!hw.labelPrinter.acceptRoutedJobs}
                      onChange={e => updHW('labelPrinter', { acceptRoutedJobs: e.target.checked })} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        Accept routed Zebra jobs from the portal
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                        When enabled, this register polls the portal's label print queue and prints ZPL jobs via the local
                        Zebra Browser Print app. Required when the portal is served from a public HTTPS URL (storeveu.com)
                        because Chrome blocks direct calls to localhost.
                      </div>
                    </div>
                  </label>
                </div>

                {hw.labelPrinter.acceptRoutedJobs && (
                  <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
                    <ZebraRoutedPanel
                      printerName={hw.labelPrinter.zebraName || ''}
                      onChangeName={(name) => updHW('labelPrinter', { zebraName: name })}
                    />
                  </div>
                )}
              </div>
            </HWSection>

            <div className="hsm-footer">
              <button className={`hsm-save-btn${saving ? ' hsm-save-btn--loading' : ''}`} onClick={handleSave} disabled={saving}>
                {saving ? <><Loader size={15} /> Saving...</> : <><Check size={15} /> Save Hardware Settings</>}
              </button>
              <button className="hsm-cancel-btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
