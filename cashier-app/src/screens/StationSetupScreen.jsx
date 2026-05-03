/**
 * StationSetupScreen
 * Multi-step wizard: Manager login → Store → Register Name → Hardware → Done
 */

import React, { useState, useCallback } from 'react';
import {
  Monitor, ChevronRight, Check, Loader, Printer, Scale,
  CreditCard, Tag, Package, Wifi, WifiOff, CheckCircle2,
  AlertCircle, RefreshCw, ChevronDown, ChevronUp, SkipForward,
  Settings, Zap, TestTube, Eye, EyeOff,
} from 'lucide-react';
import StoreveuLogo      from '../components/StoreveuLogo.jsx';
import { useStationStore }  from '../stores/useStationStore.js';
import { loginWithPassword, registerStation } from '../api/pos.js';
import api from '../api/client.js';
import './StationSetupScreen.css';

// ── Helpers ────────────────────────────────────────────────────────────────
const HW_KEY = 'storv_hardware_config';
const saveHW = (cfg) => localStorage.setItem(HW_KEY, JSON.stringify(cfg));

const BAUD_RATES   = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
const PAPER_WIDTHS = ['58mm', '80mm'];

/* ── Known receipt printer models ────────────────────────────────────────────
   type: 'network' → LAN/TCP, shows IP input
   type: 'qz'     → USB via QZ Tray, shows printer name detect
   port: default TCP port (always 9100 for receipt printers)
   tip:  how to find the IP address for that model
──────────────────────────────────────────────────────────────────────────── */
const PRINTER_MODELS = [
  // ── SII (Seiko) ───────────────────────────────────────────────────────────
  { id: 'sii_rpf10',      label: 'SII RP-F10 / RP-G10',          type: 'network', port: 9100, width: '80mm',
    tip: 'Hold the FEED button while turning the printer ON. Release after 3 sec — IP address prints on the ticket.' },
  { id: 'sii_rpd10',      label: 'SII RP-D10',                    type: 'network', port: 9100, width: '80mm',
    tip: 'Hold FEED while powering on to print a self-test page showing the IP address.' },
  { id: 'sii_rpf10usb',   label: 'SII RP-F10 (USB)',              type: 'qz',      port: null, width: '80mm', tip: '' },

  // ── EPSON ─────────────────────────────────────────────────────────────────
  { id: 'epson_t88vi',    label: 'EPSON TM-T88VI',                type: 'network', port: 9100, width: '80mm',
    tip: 'Hold FEED while powering on. The self-test prints IP on page 2.' },
  { id: 'epson_t88vii',   label: 'EPSON TM-T88VII',               type: 'network', port: 9100, width: '80mm',
    tip: 'Hold FEED while powering on. IP prints on self-test page.' },
  { id: 'epson_t88v',     label: 'EPSON TM-T88V',                 type: 'network', port: 9100, width: '80mm',
    tip: 'Hold FEED while powering on. IP prints on self-test page.' },
  { id: 'epson_t20iii',   label: 'EPSON TM-T20III',               type: 'network', port: 9100, width: '80mm',
    tip: 'Hold FEED while powering on to print IP address.' },
  { id: 'epson_t82iii',   label: 'EPSON TM-T82III',               type: 'network', port: 9100, width: '80mm',
    tip: 'Hold FEED while powering on to print IP address.' },
  { id: 'epson_m30ii',    label: 'EPSON TM-m30II',                type: 'network', port: 9100, width: '80mm',
    tip: 'Hold FEED + POWER simultaneously, release when LED flashes.' },
  { id: 'epson_t88vi_usb', label: 'EPSON TM-T88VI (USB)',         type: 'qz',      port: null, width: '80mm', tip: '' },

  // ── Star Micronics ────────────────────────────────────────────────────────
  { id: 'star_tsp143lan', label: 'Star TSP143 (LAN)',              type: 'network', port: 9100, width: '80mm',
    tip: 'Hold FEED button for 5 seconds while powered on. IP prints on test ticket.' },
  { id: 'star_tsp654',    label: 'Star TSP654',                    type: 'network', port: 9100, width: '80mm',
    tip: 'Hold FEED button for 5 seconds while powered on.' },
  { id: 'star_tsp143usb', label: 'Star TSP143 (USB)',              type: 'qz',      port: null, width: '80mm', tip: '' },

  // ── Bixolon ───────────────────────────────────────────────────────────────
  { id: 'bixolon_350iii', label: 'Bixolon SRP-350III (LAN)',       type: 'network', port: 9100, width: '80mm',
    tip: 'Power on while holding FEED. IP address is on the self-test printout.' },
  { id: 'bixolon_350usb', label: 'Bixolon SRP-350III (USB)',       type: 'qz',      port: null, width: '80mm', tip: '' },

  // ── Citizen ───────────────────────────────────────────────────────────────
  { id: 'citizen_ct_s310', label: 'Citizen CT-S310II (LAN)',       type: 'network', port: 9100, width: '80mm',
    tip: 'Hold FEED while powering on to print network config.' },

  // ── Generic ───────────────────────────────────────────────────────────────
  { id: 'other_80_lan',   label: 'Other 80mm Printer (LAN/Network)', type: 'network', port: 9100, width: '80mm',
    tip: 'Check your printer manual or router DHCP list to find the IP. Port is almost always 9100.' },
  { id: 'other_58_lan',   label: 'Other 58mm Printer (LAN/Network)', type: 'network', port: 9100, width: '58mm',
    tip: 'Check your printer manual or router DHCP list to find the IP. Port is almost always 9100.' },
  { id: 'other_usb',      label: 'Other USB Printer (via QZ Tray)',  type: 'qz',     port: null, width: '80mm', tip: '' },
];

// Default baud rate per scale brand
const SCALE_BAUD_DEFAULTS = {
  cas:       9600,
  mettler:   9600,
  avery:     9600,
  digi:      9600,
  datalogic: 9600,
  generic:   9600,
};

// ── Style helpers (retained for backward compat with deeply nested form elements) ──
const S = {
  field: 'sss-field',
  select: 'sss-select',
  label: 'sss-label',
  row:   'sss-hw-grid',
};

// ── Section wrapper component ──────────────────────────────────────────────
function HWSection({ icon: Icon, title, status, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const dotClass = status === 'ok' ? 'sss-hw-status-dot--ok'
    : status === 'err' ? 'sss-hw-status-dot--err'
    : status === 'testing' ? 'sss-hw-status-dot--testing'
    : 'sss-hw-status-dot--none';
  const labelClass = status === 'ok' ? 'sss-hw-status-label--ok'
    : status === 'err' ? 'sss-hw-status-label--err'
    : 'sss-hw-status-label--none';
  return (
    <div className={`sss-hw-section ${open ? 'sss-hw-section--open' : 'sss-hw-section--closed'}`}>
      <div className="sss-hw-header" onClick={() => setOpen(o => !o)}>
        <div className="sss-hw-icon-wrap">
          <Icon size={16} color="#7b95e0" />
        </div>
        <span className="sss-hw-title">{title}</span>
        <div className={`sss-hw-status-dot ${dotClass}`} />
        <span className={`sss-hw-status-label ${labelClass}`}>
          {status === 'ok' ? 'Configured' : status === 'err' ? 'Error' : 'Optional'}
        </span>
        {open ? <ChevronUp size={14} color="#4b5563" /> : <ChevronDown size={14} color="#4b5563" />}
      </div>
      {open && <div className="sss-hw-body">{children}</div>}
    </div>
  );
}

// ── Field + label combo ────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div>
      <label className="sss-label">{label}</label>
      {children}
    </div>
  );
}

function TestButton({ onClick, status, loading, label }) {
  const cls = status === 'ok' ? 'sss-test-btn--ok' : status === 'err' ? 'sss-test-btn--err' : 'sss-test-btn--idle';
  return (
    <button onClick={onClick} disabled={loading} className={`sss-test-btn ${cls}`}>
      {loading ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <TestTube size={12} />}
      {loading ? 'Testing\u2026' : label || 'Test'}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
export default function StationSetupScreen() {
  const setStation = useStationStore(s => s.setStation);

  // ── wizard state ──────────────────────────────────────────────────────
  const [step,         setStep]         = useState(1);  // 1-5
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');

  // Step 1 — login
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPw,       setShowPw]       = useState(false);
  const [managerToken, setManagerToken] = useState('');
  // If the user clicks "Skip login", `skippedLogin` flips true. We then jump
  // to step 2 with no stores fetched — step 2 falls back to a manual storeId
  // text input. Backend accepts station-register without a JWT (see route
  // comments in posTerminalRoutes.ts).
  const [skippedLogin, setSkippedLogin] = useState(false);

  // Step 2 — store
  const [stores,       setStores]       = useState([]);
  const [storeId,      setStoreId]      = useState('');

  // Step 3 — register name
  const [stationName,  setStationName]  = useState('Register 1');
  const [registeredStation, setRegisteredStation] = useState(null);

  // Step 4 — hardware
  const [hw, setHW] = useState({
    receiptPrinter: { model: '', type: 'none', name: '', ip: '', port: 9100, width: '80mm' },
    labelPrinter:   { type: 'none', name: '', ip: '', port: 9100 },
    scale:          { type: 'none', connection: 'serial', baud: 9600, portLabel: '', ip: '', port: 4001, comPort: '' },
    paxTerminal:    { enabled: false, model: 'A35', ip: '', port: 10009 },
    cashDrawer:     { type: 'none' },
  });

  // Test statuses per device
  const [testStatus, setTestStatus] = useState({});
  const [testLoading, setTestLoading] = useState({});

  // Detected devices lists
  const [detectedPrinters,      setDetectedPrinters]      = useState([]);
  const [detectedLabelPrinters, setDetectedLabelPrinters] = useState([]);
  const [detectingPrinters,     setDetectingPrinters]     = useState(false);

  // Scale port detection
  const [detectedPorts,    setDetectedPorts]    = useState([]); // { label, port|name }
  const [detectingPorts,   setDetectingPorts]   = useState(false);
  const [nativeComPorts,   setNativeComPorts]   = useState([]); // [{ path, friendlyName, manufacturer }]
  const [detectingNative,  setDetectingNative]  = useState(false);
  const [scaleTestWeight,  setScaleTestWeight]  = useState(null);
  const [scaleTesting,     setScaleTestingState] = useState(false);
  const scaleReaderCleanup = React.useRef(null);

  const setTest = (key, status) => setTestStatus(p => ({ ...p, [key]: status }));
  const setTestLoad = (key, val) => setTestLoading(p => ({ ...p, [key]: val }));
  const updHW = (section, fields) => setHW(p => ({ ...p, [section]: { ...p[section], ...fields } }));

  // ── Step 1: Manager login ─────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const data  = await loginWithPassword(email, password);
      const user  = data.user || data;
      if (!['manager', 'owner', 'admin', 'superadmin'].includes(user.role)) {
        throw new Error('A manager or owner account is required.');
      }
      const token = user.token;
      setManagerToken(token);
      const res   = await api.get('/stores', { headers: { Authorization: `Bearer ${token}` } });
      const list  = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
      setStores(list);
      if (list.length === 1) { setStoreId(list[0].id); setStep(3); }
      else setStep(2);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Login failed');
    } finally { setLoading(false); }
  };

  // ── Step 3: Register station ──────────────────────────────────────────
  const handleRegister = async (e) => {
    e.preventDefault();
    if (!stationName.trim()) { setError('Please name this register.'); return; }
    setLoading(true); setError('');
    try {
      const result = await registerStation({ storeId, name: stationName.trim() }, managerToken);
      setRegisteredStation(result);
      setStep(4);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to register station.');
    } finally { setLoading(false); }
  };

  // ── Detect printers (Electron OR QZ Tray) ────────────────────────────
  const [qzStatus, setQzStatus] = React.useState('unknown'); // 'unknown'|'running'|'not_running'|'electron'

  const detectQZPrinters = async (forLabel = false) => {
    setDetectingPrinters(true);
    setQzStatus('unknown');
    try {
      // ── Path 1: Electron — use native OS printer list ──────────────────
      if (window.electronAPI?.isElectron) {
        const printers = await window.electronAPI.listPrinters();
        const list = printers.map(p => p.displayName || p.name).filter(Boolean);
        setQzStatus('electron');
        if (forLabel) setDetectedLabelPrinters(list);
        else setDetectedPrinters(list);
        return;
      }

      // ── Path 2: QZ Tray ───────────────────────────────────────────────
      if (typeof window.qz === 'undefined') {
        setQzStatus('not_running');
        return;
      }
      const q = window.qz;
      if (!q.websocket.isActive()) {
        await q.websocket.connect({ retries: 2, delay: 1 });
        q.security.setCertificatePromise((res) => res(''));
        q.security.setSignaturePromise(() => Promise.resolve(''));
      }
      setQzStatus('running');
      const printers = await q.printers.find();
      const list = (Array.isArray(printers) ? printers : [printers]).filter(Boolean);
      if (forLabel) setDetectedLabelPrinters(list);
      else setDetectedPrinters(list);
    } catch (err) {
      setQzStatus('not_running');
    } finally {
      setDetectingPrinters(false);
    }
  };

  // ── Detect serial ports for scale ────────────────────────────────────
  const detectScalePorts = async () => {
    setDetectingPorts(true);
    setDetectedPorts([]);
    const found = [];

    // Method 1: QZ Tray serial port list
    try {
      if (window.qz?.websocket?.isActive()) {
        const qzPorts = await window.qz.serial.findPorts();
        const list = (Array.isArray(qzPorts) ? qzPorts : [qzPorts]).filter(Boolean);
        list.forEach(name => found.push({ label: name, source: 'qz', name }));
      }
    } catch {}

    // Method 2: Web Serial API — already-granted ports
    if ('serial' in navigator) {
      try {
        const ports = await navigator.serial.getPorts();
        ports.forEach((port, i) => {
          const info = port.getInfo?.() ?? {};
          let label = `Serial Port ${i + 1}`;
          if (info.usbVendorId === 0x05F9 || info.usbVendorId === 0x04B4) {
            label = `Datalogic Magellan (Port ${i + 1})`;
          } else if (info.usbVendorId) {
            label = `USB Serial Port ${i + 1} (VID:${info.usbVendorId.toString(16).toUpperCase()})`;
          }
          // Avoid duplicates from QZ
          if (!found.some(f => f.label === label)) {
            found.push({ label, source: 'webserial', port });
          }
        });
      } catch {}
    }

    if (found.length > 0) {
      setDetectedPorts(found);
      // Auto-select first port
      if (!hw.scale.portLabel) {
        updHW('scale', { portLabel: found[0].label, portSource: found[0].source, portName: found[0].name || '' });
      }
    } else {
      // No previously-granted ports — offer to open picker
      setDetectedPorts([{ label: '+ Click to select port…', source: 'picker' }]);
    }

    setDetectingPorts(false);
  };

  // ── Detect native COM ports (Electron only) ─────────────────────────
  const detectNativeComPorts = async () => {
    if (!window.electronAPI?.serialList) return;
    setDetectingNative(true);
    try {
      const res = await window.electronAPI.serialList();
      setNativeComPorts(res?.ports || []);
      // Auto-select first port if none selected
      if (res?.ports?.length > 0 && !hw.scale.comPort) {
        updHW('scale', { comPort: res.ports[0].path });
      }
    } catch {}
    finally { setDetectingNative(false); }
  };

  // ── Test scale connection — read live weight for 5 seconds ───────────
  const testScaleConnection = async () => {
    setScaleTestingState(true);
    setScaleTestWeight(null);

    // ── Native COM port mode (Electron only) ─────────────────────────
    if (hw.scale.connection === 'serial-native') {
      if (!window.electronAPI?.serialConnect) {
        setScaleTestWeight('no signal');
        setScaleTestingState(false);
        alert('Native COM port requires the Electron desktop app.');
        return;
      }
      try {
        const comPath = hw.scale.comPort;
        if (!comPath) { setScaleTestWeight('no signal'); setScaleTestingState(false); alert('Select a COM port first.'); return; }
        const res = await window.electronAPI.serialConnect(comPath, hw.scale.baud || 9600);
        if (!res?.ok) { setScaleTestWeight('no signal'); setScaleTestingState(false); return; }

        let found = false;
        const handler = (line) => {
          const m = line.match(/([+-]?\s*\d+\.?\d*)\s*(kg|KG|lb|LB|g\b|G\b|oz|OZ)/);
          if (m && !found) {
            found = true;
            setScaleTestWeight(`${parseFloat(m[1].replace(/\s/g, ''))} ${m[2].toLowerCase()}`);
          }
        };
        window.electronAPI.onScaleData(handler);

        await new Promise(r => setTimeout(r, 5000));
        window.electronAPI.removeScaleListeners?.();
        window.electronAPI.serialDisconnect?.();
        if (!found) setScaleTestWeight('no signal');
      } catch {
        setScaleTestWeight('no signal');
      } finally {
        setScaleTestingState(false);
      }
      return;
    }

    // ── TCP mode (Electron only) ──────────────────────────────────────
    if (hw.scale.connection === 'tcp') {
      if (!window.electronAPI?.scaleConnect) {
        setScaleTestWeight('no signal');
        setScaleTestingState(false);
        alert('TCP scale requires the Electron desktop app.');
        return;
      }
      try {
        const ip   = hw.scale.ip || '192.168.1.100';
        const port = hw.scale.port || 4001;
        const res  = await window.electronAPI.scaleConnect(ip, port);
        if (!res?.ok) { setScaleTestWeight('no signal'); setScaleTestingState(false); return; }

        let found = false;
        const handler = (line) => {
          const m = line.match(/([+-]?\s*\d+\.?\d*)\s*(kg|KG|lb|LB|g\b|G\b|oz|OZ)/);
          if (m && !found) {
            found = true;
            setScaleTestWeight(`${parseFloat(m[1].replace(/\s/g, ''))} ${m[2].toLowerCase()}`);
          }
        };
        window.electronAPI.onScaleData(handler);

        // Listen for 5 seconds
        await new Promise(r => setTimeout(r, 5000));
        window.electronAPI.removeScaleListeners?.();
        window.electronAPI.scaleDisconnect?.();
        if (!found) setScaleTestWeight('no signal');
      } catch (err) {
        setScaleTestWeight('no signal');
      } finally {
        setScaleTestingState(false);
      }
      return;
    }

    // ── USB Serial mode ───────────────────────────────────────────────
    if (!('serial' in navigator)) {
      alert('Web Serial API not supported. Use Chrome or Edge.');
      setScaleTestingState(false);
      return;
    }
    let port;
    let reader;
    try {
      const granted = await navigator.serial.getPorts();
      port = granted[0];
      if (!port) {
        port = await navigator.serial.requestPort({
          filters: [{ usbVendorId: 0x05F9 }, { usbVendorId: 0x04B4 }],
        });
      }
      if (!port) { setScaleTestingState(false); return; }

      await port.open({ baudRate: hw.scale.baud || 9600, dataBits: 8, stopBits: 1, parity: 'none' });
      reader = port.readable.getReader();

      let buffer = '';
      const timeout = setTimeout(() => reader.cancel(), 5000);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += new TextDecoder().decode(value);
        const lines = buffer.split(/[\r\n]+/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const m = line.match(/([+-]?\s*\d+\.?\d*)\s*(kg|KG|lb|LB|g\b|G\b|oz|OZ)/);
          if (m) {
            setScaleTestWeight(`${parseFloat(m[1].replace(/\s/g,''))} ${m[2].toLowerCase()}`);
            clearTimeout(timeout);
            reader.cancel();
            break;
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError' && err.name !== 'NotSelectedError' && !scaleTestWeight) {
        setScaleTestWeight('no signal');
      }
    } finally {
      try { reader?.releaseLock(); } catch {}
      try { await port?.close(); } catch {}
      setScaleTestingState(false);
    }
  };

  // ── Test receipt printer ──────────────────────────────────────────────
  const testReceiptPrinter = async () => {
    const p = hw.receiptPrinter;
    setTestLoad('receipt', true); setTest('receipt', null);

    // ESC/POS: reset → centre → print text → partial cut
    const TEST_ESC = '\x1B\x40\x1B\x61\x01StoreVeu POS\nTest Print OK!\n\n\n\x1D\x56\x00';

    try {
      // ── Electron desktop: route through native OS printer APIs ────────────
      if (window.electronAPI?.isElectron) {
        if (p.type === 'network' && p.ip) {
          await window.electronAPI.printNetwork(p.ip, p.port || 9100, TEST_ESC);
        } else if (p.name) {
          // USB (Windows winspool) — printer name from the dropdown
          await window.electronAPI.printUSB(p.name, TEST_ESC);
        } else {
          throw new Error('No printer selected. Choose a printer from the SELECT PRINTER dropdown.');
        }
      }
      // ── Network printer via backend TCP proxy ─────────────────────────────
      else if (p.type === 'network') {
        await api.post('/pos-terminal/print-network', {
          ip: p.ip, port: p.port,
          data: btoa(TEST_ESC),
        });
      }
      // ── USB via QZ Tray ───────────────────────────────────────────────────
      else if (p.type === 'qz' && p.name) {
        const q = window.qz;
        if (!q?.websocket?.isActive()) throw new Error('QZ Tray not connected');
        const cfg = q.configs.create(p.name);
        await q.print(cfg, [TEST_ESC]);
      } else {
        throw new Error('No printer configured. Select a model and printer above.');
      }
      setTest('receipt', 'ok');
    } catch (err) {
      setTest('receipt', 'err');
      alert('Print test failed: ' + err.message);
    } finally { setTestLoad('receipt', false); }
  };

  // ── Test cash drawer ──────────────────────────────────────────────────
  const testCashDrawer = async () => {
    const p = hw.receiptPrinter;
    if (hw.cashDrawer.type === 'none') return;
    setTestLoad('drawer', true);
    try {
      // ── Electron ─────────────────────────────────────────────────────────
      if (window.electronAPI?.isElectron) {
        const pType = p.printerType || 'epson';
        if (p.type === 'network' && p.ip) {
          await window.electronAPI.openDrawerNetwork(p.ip, p.port || 9100, pType);
        } else if (p.name) {
          await window.electronAPI.openDrawerUSB(p.name, pType);
        }
      }
      // ── QZ Tray ───────────────────────────────────────────────────────────
      else if (p.type === 'qz' && p.name) {
        const q = window.qz;
        if (!q?.websocket?.isActive()) throw new Error('QZ Tray not connected');
        const cfg = q.configs.create(p.name);
        await q.print(cfg, ['\x1B\x70\x00\x19\xFA']); // ESC/POS drawer kick
      }
      setTest('drawer', 'ok');
    } catch (err) {
      setTest('drawer', 'err');
    } finally { setTestLoad('drawer', false); }
  };

  // ── Test PAX terminal ─────────────────────────────────────────────────
  const testPAX = async () => {
    const p = hw.paxTerminal;
    if (!p.ip) { alert('Enter the PAX terminal IP address first.'); return; }
    setTestLoad('pax', true); setTest('pax', null);
    try {
      const res = await api.post('/payment/pax/test', { ip: p.ip, port: p.port });
      if (res.data?.success) setTest('pax', 'ok');
      else { setTest('pax', 'err'); alert('PAX not reachable: ' + (res.data?.error || 'Unknown error')); }
    } catch (err) {
      setTest('pax', 'err');
      alert('PAX test failed: ' + err.message);
    } finally { setTestLoad('pax', false); }
  };

  // ── Test label printer ────────────────────────────────────────────────
  const testLabelPrinter = async () => {
    const p = hw.labelPrinter;
    setTestLoad('label', true); setTest('label', null);
    try {
      const zpl = '^XA^CF0,40^FO30,30^FDTEST LABEL^FS^CF0,25^FO30,80^FDLabel printer OK!^FS^XZ';

      // ── Electron: ZPL USB via winspool ───────────────────────────────────
      if (window.electronAPI?.isElectron && p.type === 'zebra_zpl' && p.name) {
        await window.electronAPI.printUSB(p.name, zpl);
        setTest('label', 'ok');
      }
      // ── Electron / Browser: ZPL network ──────────────────────────────────
      else if (p.type === 'zebra_net' && p.ip) {
        if (window.electronAPI?.isElectron) {
          await window.electronAPI.printLabelNetwork(p.ip, p.port || 9100, zpl);
        } else {
          await api.post('/pos-terminal/print-network', { ip: p.ip, port: p.port, data: btoa(zpl) });
        }
        setTest('label', 'ok');
      }
      // ── QZ Tray ───────────────────────────────────────────────────────────
      else if (p.type === 'zebra_zpl' && p.name) {
        const q = window.qz;
        if (!q?.websocket?.isActive()) throw new Error('QZ Tray not connected');
        const cfg = q.configs.create(p.name);
        await q.print(cfg, [{ type: 'raw', format: 'plain', data: zpl }]);
        setTest('label', 'ok');
      } else {
        throw new Error('No label printer configured.');
      }
    } catch (err) {
      setTest('label', 'err');
      alert('Label test failed: ' + err.message);
    } finally { setTestLoad('label', false); }
  };

  // ── Complete setup ────────────────────────────────────────────────────
  const handleComplete = async () => {
    saveHW(hw);
    // Optionally sync to backend
    try {
      if (registeredStation?.id) {
        await api.post('/payment/hardware', {
          stationId: registeredStation.id,
          hardwareConfig: hw,
        }, { headers: { 'x-store-id': storeId, Authorization: `Bearer ${managerToken}` } });
      }
    } catch {} // non-fatal
    setStation(registeredStation);
  };

  // ── Step indicator ────────────────────────────────────────────────────
  const STEPS = ['Login', 'Store', 'Name', 'Hardware', 'Done'];
  const totalSteps = STEPS.length;

  return (
    <div className="sss-wrap">
      <div className="sss-card">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.75rem' }}>
          <StoreveuLogo iconOnly={true} height={40} darkMode={true} />
          <div>
            <div style={{ color: '#7b95e0', fontWeight: 900, fontSize: '1rem' }}>Storeveu POS</div>
            <div style={{ color: '#4b5563', fontSize: '0.75rem' }}>Register Setup — Step {step} of {totalSteps}</div>
          </div>
          {/* Progress dots */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' }}>
            {STEPS.map((_, i) => (
              <div key={i} style={{
                width: step > i + 1 ? 10 : step === i + 1 ? 12 : 8,
                height: step > i + 1 ? 10 : step === i + 1 ? 12 : 8,
                borderRadius: '50%',
                background: step > i + 1 ? '#4ade80' : step === i + 1 ? '#3d56b5' : 'rgba(255,255,255,.1)',
                transition: 'all .2s',
              }} />
            ))}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 3, marginBottom: '1.75rem' }}>
          <div style={{ height: '100%', width: `${((step - 1) / (totalSteps - 1)) * 100}%`, background: '#3d56b5', borderRadius: 3, transition: 'width .3s' }} />
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 10, padding: '0.75rem 1rem', color: '#f87171', fontSize: '0.84rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* ── STEP 1: Login ── */}
        {step === 1 && (
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#e8eaf0', marginBottom: 6 }}>Manager Sign-In</div>
              <div style={{ color: '#6b7280', fontSize: '0.84rem', lineHeight: 1.6 }}>Sign in with a <strong style={{ color: '#94a3b8' }}>manager or owner</strong> account to register this terminal. You only need to do this once.</div>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label className="sss-label">Email</label>
              <input type="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="manager@store.com" className="sss-field" />
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label className="sss-label">Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className="sss-field" style={{ paddingRight: 40 }} />
                <button type="button" onClick={() => setShowPw(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', display: 'flex', padding: 4 }}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading || !email || !password} className={`sss-btn sss-btn--full ${!loading && !!email && !!password ? 'sss-btn--active' : 'sss-btn--disabled'}`}>
              {loading ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <>Continue <ChevronRight size={15} /></>}
            </button>
            {/*
              Skip login — advanced / re-pair path. Used when re-pairing the
              SAME machine (the most common reset case) where the admin
              doesn't want to dig out the manager password every time.
              Goes straight to step 2 with a manual Store ID text input.
            */}
            <button
              type="button"
              onClick={() => { setSkippedLogin(true); setError(''); setStores([]); setStep(2); }}
              style={{
                marginTop: 12, width: '100%', padding: '0.65rem',
                background: 'transparent', border: '1px solid rgba(255,255,255,.08)',
                borderRadius: 10, color: '#94a3b8', cursor: 'pointer', fontSize: '0.83rem',
              }}
            >
              Skip login — I have the Store ID
            </button>
          </form>
        )}

        {/* ── STEP 2: Store ── */}
        {/*
          Two render paths:
            - Logged-in flow (stores fetched) → list of selectable store
              buttons (the original UI)
            - Skip-login flow (no stores)     → manual Store ID text input
              (admin pastes the cuid from the back-office)
        */}
        {step === 2 && (
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#e8eaf0', marginBottom: 6 }}>
              {skippedLogin ? 'Store ID' : 'Select Store'}
            </div>
            <div style={{ color: '#6b7280', fontSize: '0.84rem', marginBottom: '1.25rem' }}>
              {skippedLogin
                ? 'Paste the Store ID for this location. Find it in the back-office under Account → Stores.'
                : 'Which store location is this register in?'}
            </div>

            {skippedLogin ? (
              <div style={{ marginBottom: '1.5rem' }}>
                <label className="sss-label">Store ID</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={storeId}
                  onChange={e => setStoreId(e.target.value.trim())}
                  placeholder="e.g. cmoa3b2c0000h5k3psylas8r"
                  className="sss-field"
                  style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' }}
                />
                <div style={{ color: '#4b5563', fontSize: '0.71rem', marginTop: 5 }}>
                  Server validates the ID — if it's wrong you'll see an error on the next step.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1.5rem' }}>
                {stores.map(s => {
                  const id = s.id || s._id; const active = storeId === id;
                  return (
                    <button key={id} onClick={() => setStoreId(id)} style={{
                      padding: '1rem 1.25rem', borderRadius: 12, textAlign: 'left',
                      background: active ? 'rgba(61,86,181,.12)' : 'rgba(255,255,255,.04)',
                      border: `2px solid ${active ? '#3d56b5' : 'rgba(255,255,255,.08)'}`,
                      color: '#e8eaf0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      transition: 'border-color .15s',
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{s.name}</div>
                        {s.address && <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>{s.address}</div>}
                      </div>
                      {active && <Check size={16} color="#4ade80" />}
                    </button>
                  );
                })}
              </div>
            )}

            <button onClick={() => { setError(''); setStep(3); }} disabled={!storeId} className={`sss-btn sss-btn--full ${storeId ? 'sss-btn--active' : 'sss-btn--disabled'}`}>
              Continue <ChevronRight size={15} />
            </button>
          </div>
        )}

        {/* ── STEP 3: Register Name ── */}
        {step === 3 && (
          <form onSubmit={handleRegister}>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#e8eaf0', marginBottom: 6 }}>Name This Register</div>
            <div style={{ color: '#6b7280', fontSize: '0.84rem', marginBottom: '1.25rem', lineHeight: 1.6 }}>Give this terminal a name so cashiers know which register they're on.</div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label className="sss-label">Register Name</label>
              <input type="text" required autoFocus maxLength={30} value={stationName} onChange={e => setStationName(e.target.value)} placeholder="Register 1" className="sss-field" />
              <div style={{ color: '#4b5563', fontSize: '0.71rem', marginTop: 5 }}>e.g. "Register 1", "Express Lane", "Self-Checkout"</div>
            </div>
            <button type="submit" disabled={loading || !stationName.trim()} className={`sss-btn sss-btn--full ${!loading && !!stationName.trim() ? 'sss-btn--active' : 'sss-btn--disabled'}`}>
              {loading ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <>Register Terminal <ChevronRight size={15} /></>}
            </button>
          </form>
        )}

        {/* ── STEP 4: Hardware Setup ── */}
        {step === 4 && (
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#e8eaf0', marginBottom: 4 }}>Hardware Setup</div>
            <div style={{ color: '#6b7280', fontSize: '0.83rem', marginBottom: '1.25rem', lineHeight: 1.6 }}>Configure the peripherals connected to this register. All sections are optional — click any section to expand it.</div>

            {/* ── Receipt Printer ── */}
            <HWSection icon={Printer} title="Receipt Printer" status={hw.receiptPrinter.type !== 'none' ? (testStatus.receipt || null) : null}>
              <div style={{ display: 'grid', gap: 10 }}>

                {/* Step 1: Pick the model */}
                <Field label="Printer Model">
                  <select
                    value={hw.receiptPrinter.model || ''}
                    onChange={e => {
                      const modelId = e.target.value;
                      if (!modelId) {
                        updHW('receiptPrinter', { model: '', type: 'none', port: 9100, width: '80mm', ip: '', name: '' });
                        return;
                      }
                      const m = PRINTER_MODELS.find(p => p.id === modelId);
                      if (m) {
                        updHW('receiptPrinter', {
                          model: m.id,
                          type:  m.type,
                          port:  m.port ?? 9100,
                          width: m.width,
                        });
                      }
                    }}
                    className="sss-select"
                  >
                    <option value="">— None / Skip —</option>
                    <optgroup label="SII (Seiko)">
                      {PRINTER_MODELS.filter(p => p.id.startsWith('sii')).map(p => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="EPSON">
                      {PRINTER_MODELS.filter(p => p.id.startsWith('epson')).map(p => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Star Micronics">
                      {PRINTER_MODELS.filter(p => p.id.startsWith('star')).map(p => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Bixolon">
                      {PRINTER_MODELS.filter(p => p.id.startsWith('bixolon')).map(p => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Citizen">
                      {PRINTER_MODELS.filter(p => p.id.startsWith('citizen')).map(p => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Other">
                      {PRINTER_MODELS.filter(p => p.id.startsWith('other')).map(p => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </optgroup>
                  </select>
                </Field>

                {/* IP tip for this model */}
                {hw.receiptPrinter.model && (() => {
                  const m = PRINTER_MODELS.find(p => p.id === hw.receiptPrinter.model);
                  return m?.tip ? (
                    <div style={{ background: 'rgba(61,86,181,.08)', border: '1px solid rgba(61,86,181,.2)', borderRadius: 8, padding: '10px 12px', fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.6 }}>
                      <span style={{ color: '#7b95e0', fontWeight: 700 }}>💡 How to find IP: </span>{m.tip}
                    </div>
                  ) : null;
                })()}

                {/* Network: IP + port */}
                {hw.receiptPrinter.type === 'network' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10 }}>
                    <Field label="Printer IP Address">
                      <input
                        value={hw.receiptPrinter.ip}
                        onChange={e => updHW('receiptPrinter', { ip: e.target.value })}
                        placeholder="192.168.1.100"
                        className="sss-field"
                        autoFocus
                      />
                    </Field>
                    <Field label="Port">
                      <input
                        type="number"
                        value={hw.receiptPrinter.port || 9100}
                        onChange={e => updHW('receiptPrinter', { port: Number(e.target.value) })}
                        className="sss-field"
                      />
                    </Field>
                  </div>
                )}

                {/* USB / QZ Tray: detect + dropdown + manual fallback */}
                {hw.receiptPrinter.type === 'qz' && (
                  <>
                    {/* QZ Tray status banner */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                      background: qzStatus === 'running'     ? 'rgba(22,163,74,.08)'
                                : qzStatus === 'not_running' ? 'rgba(239,68,68,.08)'
                                : 'rgba(255,255,255,.04)',
                      border: `1px solid ${qzStatus === 'running' ? 'rgba(22,163,74,.25)' : qzStatus === 'not_running' ? 'rgba(239,68,68,.25)' : 'rgba(255,255,255,.08)'}`,
                      borderRadius: 8, padding: '10px 12px',
                    }}>
                      <div style={{ fontSize: '0.78rem', lineHeight: 1.5 }}>
                        {qzStatus === 'electron'     && <span style={{ color: '#4ade80', fontWeight: 700 }}>✓ Running as desktop app — all printers detected</span>}
                        {qzStatus === 'running'      && <span style={{ color: '#4ade80', fontWeight: 700 }}>✓ QZ Tray is running</span>}
                        {qzStatus === 'not_running'  && (
                          <span style={{ color: '#f87171', fontWeight: 700 }}>
                            ✗ QZ Tray not detected —{' '}
                            <a href="https://qz.io/download/" target="_blank" rel="noreferrer" style={{ color: '#7b95e0' }}>
                              Download &amp; install it
                            </a>
                            , then click Detect again.
                          </span>
                        )}
                        {qzStatus === 'unknown' && (
                          <span style={{ color: '#6b7280' }}>
                            Click <strong style={{ color: '#94a3b8' }}>Detect Printers</strong> to find all USB printers connected to this computer.
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => detectQZPrinters(false)}
                        disabled={detectingPrinters}
                        className={`sss-test-btn ${qzStatus === 'running' ? 'sss-test-btn--ok' : 'sss-test-btn--idle'}`}
                      >
                        {detectingPrinters
                          ? <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Detecting…</>
                          : <><RefreshCw size={12} /> Detect Printers</>
                        }
                      </button>
                    </div>

                    {/* Printer dropdown — populated after detect */}
                    {detectedPrinters.length > 0 && (
                      <Field label="Select Printer">
                        <select
                          value={hw.receiptPrinter.name}
                          onChange={e => updHW('receiptPrinter', { name: e.target.value })}
                          className="sss-select"
                        >
                          <option value="">— Select a printer —</option>
                          {detectedPrinters.map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </Field>
                    )}

                    {/* Manual name input — always available as fallback */}
                    <Field label={detectedPrinters.length > 0 ? 'Or type printer name manually' : 'Printer Name (type manually)'}>
                      <input
                        value={hw.receiptPrinter.name}
                        onChange={e => updHW('receiptPrinter', { name: e.target.value })}
                        placeholder="e.g. Epson TM-T20II Receipt"
                        className="sss-field"
                      />
                      <div style={{ fontSize: '0.71rem', color: '#4b5563', marginTop: 4 }}>
                        The printer name must match exactly as shown in{' '}
                        <strong style={{ color: '#94a3b8' }}>Windows → Control Panel → Devices and Printers</strong>
                      </div>
                    </Field>
                  </>
                )}

                {/* Paper width + test */}
                {hw.receiptPrinter.type !== 'none' && hw.receiptPrinter.model && (
                  <>
                    <Field label="Paper Width">
                      <select value={hw.receiptPrinter.width || '80mm'} onChange={e => updHW('receiptPrinter', { width: e.target.value })} className="sss-select">
                        {PAPER_WIDTHS.map(w => <option key={w} value={w}>{w}</option>)}
                      </select>
                    </Field>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <TestButton onClick={testReceiptPrinter} status={testStatus.receipt} loading={testLoading.receipt} label="Print Test Receipt" />
                    </div>
                    {testStatus.receipt === 'ok' && (
                      <div style={{ color: '#4ade80', fontSize: '0.76rem', textAlign: 'right' }}>✓ Printer connected and working</div>
                    )}
                  </>
                )}
              </div>
            </HWSection>

            {/* ── Cash Drawer ── */}
            <HWSection icon={Package} title="Cash Drawer" status={hw.cashDrawer.type !== 'none' ? (testStatus.drawer || null) : null}>
              <div style={{ display: 'grid', gap: 10 }}>
                <Field label="Connection Type">
                  <select value={hw.cashDrawer.type} onChange={e => updHW('cashDrawer', { type: e.target.value })} className="sss-select">
                    <option value="none">None / Skip</option>
                    <option value="printer">Through Receipt Printer (RJ-11 port)</option>
                  </select>
                </Field>
                {hw.cashDrawer.type === 'printer' && (
                  <>
                    <div style={{ background: 'rgba(61,86,181,.08)', border: '1px solid rgba(61,86,181,.2)', borderRadius: 8, padding: '10px 12px', fontSize: '0.78rem', color: '#94a3b8' }}>
                      ℹ️ Cash drawer will be triggered through your receipt printer. Make sure the receipt printer is configured above.
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <TestButton onClick={testCashDrawer} status={testStatus.drawer} loading={testLoading.drawer} label="Test Open Drawer" />
                    </div>
                  </>
                )}
              </div>
            </HWSection>

            {/* ── Scale ── */}
            <HWSection icon={Scale} title="Weighing Scale" status={hw.scale.type !== 'none' ? (testStatus.scale || null) : null}>
              <div style={{ display: 'grid', gap: 10 }}>

                <Field label="Scale Brand / Model">
                  <select
                    value={hw.scale.type}
                    onChange={e => {
                      const t = e.target.value;
                      updHW('scale', { type: t, baud: SCALE_BAUD_DEFAULTS[t] ?? 9600 });
                      setDetectedPorts([]);
                      setScaleTestWeight(null);
                    }}
                    className="sss-select"
                  >
                    <option value="none">None / Skip</option>
                    <option value="datalogic">Datalogic Magellan 9800i (Scanner + Scale)</option>
                    <option value="cas">CAS (SW-20, PD-II, etc.)</option>
                    <option value="mettler">Mettler Toledo</option>
                    <option value="avery">Avery Berkel</option>
                    <option value="digi">Digi</option>
                    <option value="generic">Generic RS-232 / USB-Serial</option>
                  </select>
                </Field>

                {/* Datalogic info card */}
                {hw.scale.type === 'datalogic' && (
                  <div style={{ background: 'rgba(61,86,181,.08)', border: '1px solid rgba(61,86,181,.25)', borderRadius: 8, padding: '10px 12px', fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.7 }}>
                    <div style={{ fontWeight: 700, color: '#7b95e0', marginBottom: 4 }}>⚡ Datalogic Magellan 9800i — Combo Unit</div>
                    <div>Supports <strong style={{ color: '#e8eaf0' }}>barcode scanning AND weight</strong> over the same USB cable.</div>
                    <div style={{ marginTop: 4, color: '#6b7280' }}>
                      Make sure the unit is in <strong style={{ color: '#94a3b8' }}>USB-COM mode</strong> (not HID-only).
                      On the Magellan: <em>Program → Interface → USB-COM</em>.
                    </div>
                  </div>
                )}

                {hw.scale.type !== 'none' && (
                  <>
                    {/* Connection type */}
                    <Field label="Connection">
                      <select
                        value={hw.scale.connection || 'serial'}
                        onChange={e => updHW('scale', { connection: e.target.value })}
                        className="sss-select"
                      >
                        <option value="serial">USB Serial (Web Serial API)</option>
                        <option value="serial-native">Native COM Port (Electron)</option>
                        <option value="tcp">TCP / Serial-over-LAN (Ethernet)</option>
                      </select>
                    </Field>

                    {hw.scale.connection === 'serial-native' ? (
                      <>
                        {/* Native COM Port — port picker */}
                        <Field label="COM Port">
                          <div style={{ display: 'flex', gap: 8 }}>
                            <select
                              value={hw.scale.comPort || ''}
                              onChange={e => updHW('scale', { comPort: e.target.value })}
                              className="sss-select" style={{ flex: 1 }}
                            >
                              <option value="">-- Select COM port --</option>
                              {nativeComPorts.map(p => (
                                <option key={p.path} value={p.path}>
                                  {p.path}{p.manufacturer ? ` — ${p.manufacturer}` : ''}{p.friendlyName && p.friendlyName !== p.path ? ` (${p.friendlyName})` : ''}
                                </option>
                              ))}
                              {hw.scale.comPort && !nativeComPorts.find(p => p.path === hw.scale.comPort) && (
                                <option value={hw.scale.comPort}>{hw.scale.comPort} (saved)</option>
                              )}
                            </select>
                            <button
                              onClick={detectNativeComPorts}
                              disabled={detectingNative}
                              className={`sss-test-btn ${nativeComPorts.length > 0 ? 'sss-test-btn--ok' : 'sss-test-btn--idle'}`}
                              title="List available COM ports"
                            >
                              {detectingNative
                                ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />
                                : <RefreshCw size={13} />}
                              {detectingNative ? 'Scanning…' : 'Detect'}
                            </button>
                          </div>
                          {nativeComPorts.length === 0 && (
                            <div style={{ fontSize: '0.72rem', color: '#4b5563', marginTop: 4 }}>
                              Click <strong style={{ color: '#94a3b8' }}>Detect</strong> to list available COM ports
                            </div>
                          )}
                        </Field>

                        {/* Baud rate */}
                        <Field label="Baud Rate">
                          <select value={hw.scale.baud} onChange={e => updHW('scale', { baud: Number(e.target.value) })} className="sss-select">
                            {BAUD_RATES.map(b => (
                              <option key={b} value={b}>{b}{b === 9600 ? ' (most common)' : ''}</option>
                            ))}
                          </select>
                        </Field>

                        <div style={{ background: 'rgba(61,86,181,.08)', border: '1px solid rgba(61,86,181,.2)', borderRadius: 8, padding: '10px 12px', fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.7 }}>
                          <div style={{ fontWeight: 700, color: '#7b95e0', marginBottom: 4 }}>Native COM Port</div>
                          Direct RS-232 serial connection via the PC's built-in COM ports. Requires the <strong style={{ color: '#e8eaf0' }}>desktop Electron app</strong>.
                          Use this when the scale is connected with an RS-232 cable (DB9 / RJ45-to-DB9).
                        </div>
                      </>
                    ) : hw.scale.connection === 'tcp' ? (
                      <>
                        {/* TCP IP + Port */}
                        <div className="sss-grid-equal-2">
                          <Field label="IP Address">
                            <input
                              className="sss-field"
                              value={hw.scale.ip || ''}
                              onChange={e => updHW('scale', { ip: e.target.value })}
                              placeholder="192.168.1.100"
                            />
                          </Field>
                          <Field label="TCP Port">
                            <input
                              className="sss-field"
                              type="number"
                              value={hw.scale.port || 4001}
                              onChange={e => updHW('scale', { port: Number(e.target.value) })}
                              placeholder="4001"
                            />
                          </Field>
                        </div>
                        <div style={{ background: 'rgba(61,86,181,.08)', border: '1px solid rgba(61,86,181,.2)', borderRadius: 8, padding: '10px 12px', fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.7 }}>
                          <div style={{ fontWeight: 700, color: '#7b95e0', marginBottom: 4 }}>TCP / Serial-over-LAN</div>
                          Connect to the scale via Ethernet using a serial-to-TCP adapter (e.g. Moxa NPort, USR-TCP232).
                          The Datalogic Magellan 9800i also supports Ethernet mode. Requires the <strong style={{ color: '#e8eaf0' }}>desktop Electron app</strong>.
                        </div>
                      </>
                    ) : (
                      <>
                        {/* USB Serial — Port selection */}
                        <Field label="Serial Port">
                          <div style={{ display: 'flex', gap: 8 }}>
                            <select
                              value={hw.scale.portLabel || ''}
                              onChange={e => {
                                const chosen = detectedPorts.find(p => p.label === e.target.value);
                                if (chosen?.source === 'picker') {
                                  navigator.serial?.requestPort({
                                    filters: [{ usbVendorId: 0x05F9 }, { usbVendorId: 0x04B4 }],
                                  }).then(port => {
                                    const info = port.getInfo?.() ?? {};
                                    const label = info.usbVendorId === 0x05F9 || info.usbVendorId === 0x04B4
                                      ? 'Datalogic Magellan'
                                      : 'USB Serial Port';
                                    const newEntry = { label, source: 'webserial', port };
                                    setDetectedPorts(prev => [...prev.filter(p => p.source !== 'picker'), newEntry]);
                                    updHW('scale', { portLabel: label });
                                  }).catch(() => {});
                                } else if (chosen) {
                                  updHW('scale', { portLabel: chosen.label, portSource: chosen.source, portName: chosen.name || '' });
                                }
                              }}
                              className="sss-select" style={{ flex: 1 }}
                            >
                              <option value="">-- Select port --</option>
                              {detectedPorts.map(p => (
                                <option key={p.label} value={p.label}>{p.label}</option>
                              ))}
                              {hw.scale.portLabel && !detectedPorts.find(p => p.label === hw.scale.portLabel) && (
                                <option value={hw.scale.portLabel}>{hw.scale.portLabel} (saved)</option>
                              )}
                            </select>
                            <button
                              onClick={detectScalePorts}
                              disabled={detectingPorts}
                              className={`sss-test-btn ${detectedPorts.length > 0 ? 'sss-test-btn--ok' : 'sss-test-btn--idle'}`}
                              title="Auto-detect connected serial ports"
                            >
                              {detectingPorts
                                ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />
                                : <RefreshCw size={13} />}
                              {detectingPorts ? 'Detecting…' : 'Detect'}
                            </button>
                          </div>
                          {detectedPorts.length === 0 && (
                            <div style={{ fontSize: '0.72rem', color: '#4b5563', marginTop: 4 }}>
                              Click <strong style={{ color: '#94a3b8' }}>Detect</strong> to auto-find connected scale ports
                            </div>
                          )}
                        </Field>

                        {/* Baud rate */}
                        <Field label="Baud Rate">
                          <select value={hw.scale.baud} onChange={e => updHW('scale', { baud: Number(e.target.value) })} className="sss-select">
                            {BAUD_RATES.map(b => (
                              <option key={b} value={b}>{b}{b === 9600 ? ' (most common)' : ''}</option>
                            ))}
                          </select>
                        </Field>
                      </>
                    )}

                    {/* Test weight button + live reading */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {scaleTestWeight && (
                          <div style={{
                            background: scaleTestWeight === 'no signal' ? 'rgba(239,68,68,.1)' : 'rgba(22,163,74,.1)',
                            border: `1px solid ${scaleTestWeight === 'no signal' ? 'rgba(239,68,68,.25)' : 'rgba(22,163,74,.25)'}`,
                            borderRadius: 8, padding: '6px 12px',
                            fontSize: '1rem', fontWeight: 700,
                            color: scaleTestWeight === 'no signal' ? '#f87171' : '#4ade80',
                            letterSpacing: '0.05em',
                          }}>
                            {scaleTestWeight === 'no signal' ? '✗ No weight signal received' : `⚖️ ${scaleTestWeight}`}
                          </div>
                        )}
                      </div>
                      <TestButton
                        onClick={() => { setScaleTestWeight(null); testScaleConnection(); setTest('scale', null); }}
                        status={scaleTestWeight && scaleTestWeight !== 'no signal' ? 'ok' : scaleTestWeight === 'no signal' ? 'err' : testStatus.scale}
                        loading={scaleTesting}
                        label="Test Weight"
                      />
                    </div>

                    {scaleTesting && (
                      <div style={{ fontSize: '0.75rem', color: '#6b7280', textAlign: 'right' }}>
                        Place something on the scale… (listening 5s)
                      </div>
                    )}

                    {testStatus.scale === 'ok' && !scaleTesting && (
                      <div style={{ color: '#4ade80', fontSize: '0.76rem', textAlign: 'right' }}>✓ Scale configured successfully</div>
                    )}
                  </>
                )}
              </div>
            </HWSection>

            {/* ── PAX Terminal ── */}
            <HWSection icon={CreditCard} title="PAX Payment Terminal (A30 / A35)" status={hw.paxTerminal.enabled ? (testStatus.pax || null) : null}>
              <div style={{ display: 'grid', gap: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 12px', background: 'rgba(255,255,255,.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,.07)' }}>
                  <input type="checkbox" checked={hw.paxTerminal.enabled} onChange={e => updHW('paxTerminal', { enabled: e.target.checked })} style={{ width: 16, height: 16, accentColor: '#3d56b5' }} />
                  <div>
                    <div style={{ fontWeight: 600, color: '#e8eaf0', fontSize: '0.87rem' }}>Enable PAX Terminal</div>
                    <div style={{ color: '#6b7280', fontSize: '0.74rem' }}>Semi-integrated card processing — card data never touches your POS</div>
                  </div>
                </label>

                {hw.paxTerminal.enabled && (
                  <>
                    <Field label="Terminal Model">
                      <select value={hw.paxTerminal.model} onChange={e => updHW('paxTerminal', { model: e.target.value })} className="sss-select">
                        <option value="A30">PAX A30 (compact)</option>
                        <option value="A35">PAX A35 (countertop with customer screen)</option>
                        <option value="A80">PAX A80</option>
                        <option value="S300">PAX S300</option>
                      </select>
                    </Field>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10 }}>
                      <Field label="Terminal IP Address">
                        <input
                          value={hw.paxTerminal.ip}
                          onChange={e => updHW('paxTerminal', { ip: e.target.value })}
                          placeholder="192.168.1.50"
                          className="sss-field"
                        />
                      </Field>
                      <Field label="Port">
                        <input
                          type="number"
                          value={hw.paxTerminal.port}
                          onChange={e => updHW('paxTerminal', { port: Number(e.target.value) })}
                          placeholder="10009"
                          className="sss-field"
                        />
                      </Field>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 8, padding: '10px 12px', fontSize: '0.77rem', color: '#6b7280', lineHeight: 1.6 }}>
                      💡 Find the PAX terminal IP in: <strong style={{ color: '#94a3b8' }}>Settings → Ethernet → IP Address</strong> on the terminal screen. Assign a static IP in your router for reliability.
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <TestButton onClick={testPAX} status={testStatus.pax} loading={testLoading.pax} label="Test Connection" />
                    </div>
                    {testStatus.pax === 'ok' && (
                      <div style={{ color: '#4ade80', fontSize: '0.78rem', textAlign: 'right' }}>✓ PAX terminal is reachable</div>
                    )}
                    {testStatus.pax === 'err' && (
                      <div style={{ color: '#f87171', fontSize: '0.78rem', textAlign: 'right' }}>✗ Cannot reach terminal — check IP and network</div>
                    )}
                  </>
                )}
              </div>
            </HWSection>

            {/* ── Label Printer ── */}
            <HWSection icon={Tag} title="Label Printer (Optional)" status={hw.labelPrinter.type !== 'none' ? (testStatus.label || null) : null}>
              <div style={{ display: 'grid', gap: 10 }}>
                <Field label="Label Printer Type">
                  <select value={hw.labelPrinter.type} onChange={e => updHW('labelPrinter', { type: e.target.value })} className="sss-select">
                    <option value="none">None / Skip</option>
                    <option value="zebra_zpl">Zebra (ZPL) — USB via QZ Tray</option>
                    <option value="zebra_net">Zebra (ZPL) — Network TCP</option>
                    <option value="dymo">Dymo LabelWriter</option>
                  </select>
                </Field>

                {(hw.labelPrinter.type === 'zebra_zpl' || hw.labelPrinter.type === 'dymo') && (
                  <>
                    <Field label="Printer Name">
                      <div style={{ display: 'flex', gap: 8 }}>
                        <select value={hw.labelPrinter.name} onChange={e => updHW('labelPrinter', { name: e.target.value })} className="sss-select" style={{ flex: 1 }}>
                          <option value="">-- Select printer --</option>
                          {detectedLabelPrinters.map(p => <option key={p} value={p}>{p}</option>)}
                          {hw.labelPrinter.name && !detectedLabelPrinters.includes(hw.labelPrinter.name) && (
                            <option value={hw.labelPrinter.name}>{hw.labelPrinter.name}</option>
                          )}
                        </select>
                        <button onClick={() => detectQZPrinters(true)} disabled={detectingPrinters} className="sss-test-btn sss-test-btn--idle">
                          {detectingPrinters ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />} Detect
                        </button>
                      </div>
                    </Field>
                    <Field label="Enter printer name manually">
                      <input value={hw.labelPrinter.name} onChange={e => updHW('labelPrinter', { name: e.target.value })} placeholder="e.g. ZDesigner GX420d" className="sss-field" />
                    </Field>
                  </>
                )}

                {hw.labelPrinter.type === 'zebra_net' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10 }}>
                    <Field label="Printer IP Address">
                      <input value={hw.labelPrinter.ip} onChange={e => updHW('labelPrinter', { ip: e.target.value })} placeholder="192.168.1.51" className="sss-field" />
                    </Field>
                    <Field label="Port">
                      <input type="number" value={hw.labelPrinter.port} onChange={e => updHW('labelPrinter', { port: Number(e.target.value) })} placeholder="9100" className="sss-field" />
                    </Field>
                  </div>
                )}

                {hw.labelPrinter.type !== 'none' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <TestButton onClick={testLabelPrinter} status={testStatus.label} loading={testLoading.label} label="Print Test Label" />
                  </div>
                )}
              </div>
            </HWSection>

            {/* Continue button */}
            <div style={{ display: 'flex', gap: 10, marginTop: '1.5rem' }}>
              <button onClick={() => setStep(5)} className="sss-btn sss-btn--active" style={{ flex: 1 }}>
                <Zap size={15} /> Complete Setup
              </button>
            </div>
            <button onClick={() => setStep(5)} style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: '0.78rem', cursor: 'pointer', marginTop: 8, width: '100%', textAlign: 'center', padding: '4px 0' }}>
              <SkipForward size={11} style={{ marginRight: 4 }} />Skip hardware setup for now
            </button>
          </div>
        )}

        {/* ── STEP 5: Done ── */}
        {step === 5 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(74,222,128,.12)', border: '2px solid rgba(74,222,128,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
              <CheckCircle2 size={36} color="#4ade80" />
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#e8eaf0', marginBottom: 8 }}>
              {registeredStation?.name || stationName} is Ready!
            </div>
            <div style={{ color: '#6b7280', fontSize: '0.87rem', lineHeight: 1.7, marginBottom: '1.75rem' }}>
              Your register has been configured. Here's a summary of what's set up:
            </div>

            {/* Hardware summary */}
            <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 14, padding: '1rem', marginBottom: '1.5rem', textAlign: 'left' }}>
              {[
                { label: 'Receipt Printer', value: !hw.receiptPrinter.model ? 'Not configured' : (() => {
                    const m = PRINTER_MODELS.find(p => p.id === hw.receiptPrinter.model);
                    const modelLabel = m?.label || hw.receiptPrinter.model;
                    if (hw.receiptPrinter.type === 'network') return `${modelLabel} — ${hw.receiptPrinter.ip || 'IP not set'}:${hw.receiptPrinter.port || 9100}`;
                    return `${modelLabel} — ${hw.receiptPrinter.name || 'USB/QZ Tray'}`;
                  })(), icon: Printer },
                { label: 'Cash Drawer',    value: hw.cashDrawer.type === 'none' ? 'Not configured' : 'Via receipt printer', icon: Package },
                { label: 'Scale', value: hw.scale.type === 'none' ? 'Not configured' : `${hw.scale.type === 'datalogic' ? 'Datalogic Magellan 9800i' : hw.scale.type.toUpperCase()} — ${hw.scale.connection === 'tcp' ? `TCP ${hw.scale.ip || '?'}:${hw.scale.port || 4001}` : hw.scale.connection === 'serial-native' ? `COM ${hw.scale.comPort || '?'} @ ${hw.scale.baud} baud` : `${hw.scale.baud} baud${hw.scale.portLabel ? ' · ' + hw.scale.portLabel : ''}`}`, icon: Scale },
                { label: 'PAX Terminal',   value: hw.paxTerminal.enabled ? `${hw.paxTerminal.model} @ ${hw.paxTerminal.ip}:${hw.paxTerminal.port}` : 'Not configured', icon: CreditCard },
                { label: 'Label Printer',  value: hw.labelPrinter.type === 'none' ? 'Not configured' : (hw.labelPrinter.name || hw.labelPrinter.ip || hw.labelPrinter.type), icon: Tag },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                  <Icon size={14} color="#4b5563" />
                  <span style={{ color: '#6b7280', fontSize: '0.8rem', flex: 1 }}>{label}</span>
                  <span style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>

            <button onClick={handleComplete} className="sss-btn sss-btn--green sss-btn--full" style={{ fontSize: '1rem', padding: '1rem' }}>
              <Zap size={16} /> Open POS
            </button>

            <button onClick={() => setStep(4)} style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: '0.78rem', cursor: 'pointer', marginTop: 10 }}>
              ← Back to hardware setup
            </button>
          </div>
        )}

      </div>

      {/* Styles moved to StationSetupScreen.css */}
    </div>
  );
}
