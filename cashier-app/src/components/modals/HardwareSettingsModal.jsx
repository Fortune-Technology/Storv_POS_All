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

  const [hw, setHW] = useState(() => loadHW() || {
    receiptPrinter: { model: '', type: 'none', name: '', ip: '', port: 9100, width: '80mm' },
    labelPrinter:   { type: 'none', name: '', ip: '', port: 9100 },
    scale:          { type: 'none', connection: 'serial', baud: 9600, ip: '', port: 4001, portLabel: '', comPort: '' },
    cashDrawer:     { type: 'none' },
  });

  const [detectedPrinters, setDetectedPrinters] = useState([]);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Native COM port state ────────────────────────────────────────────────
  const [nativeComPorts, setNativeComPorts]   = useState([]);
  const [detectingNative, setDetectingNative] = useState(false);

  const detectNativeComPorts = useCallback(async () => {
    if (!window.electronAPI?.serialList) return;
    setDetectingNative(true);
    try {
      const res = await window.electronAPI.serialList();
      setNativeComPorts(res?.ports || []);
      if (res?.ports?.length > 0 && !hw.scale.comPort) {
        updHW('scale', { comPort: res.ports[0].path });
      }
    } catch {}
    finally { setDetectingNative(false); }
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
          window.electronAPI.offScaleData?.(handler);
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
