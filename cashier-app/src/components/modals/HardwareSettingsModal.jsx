/**
 * HardwareSettingsModal.jsx
 *
 * Allows reconfiguring station hardware after initial setup.
 * Requires admin or superadmin credentials — managers and cashiers
 * cannot access this screen.
 *
 * Step 1 — Admin auth (email + password, admin/superadmin only)
 * Step 2 — Hardware configuration (receipt printer, cash drawer, scale, label printer)
 */

import React, { useState } from 'react';
import {
  X, Loader, Shield, ChevronDown, ChevronUp, Printer,
  Scale, Tag, Check, AlertCircle, RefreshCw,
} from 'lucide-react';
import { loginWithPassword, saveHardwareConfig } from '../../api/pos.js';
import { useStationStore } from '../../stores/useStationStore.js';
import { isElectron } from '../../hooks/useHardware.js';
import { connectQZ, isQZConnected, listPrinters } from '../../services/qzService.js';

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

const S = {
  field:  { width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, color: '#e8eaf0', padding: '0.75rem 1rem', fontSize: '0.9rem', outline: 'none' },
  select: { width: '100%', boxSizing: 'border-box', background: '#1a1d27', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, color: '#e8eaf0', padding: '0.75rem 1rem', fontSize: '0.9rem', outline: 'none', cursor: 'pointer' },
  label:  { display: 'block', color: '#6b7280', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 },
  testBtn: (status) => ({ padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,.1)', background: status === 'ok' ? 'rgba(22,163,74,.15)' : status === 'err' ? 'rgba(239,68,68,.12)' : 'rgba(255,255,255,.06)', color: status === 'ok' ? '#4ade80' : status === 'err' ? '#f87171' : '#94a3b8', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }),
  hwSection: (open) => ({ border: `1px solid ${open ? 'rgba(61,86,181,.4)' : 'rgba(255,255,255,.06)'}`, borderRadius: 12, marginBottom: 8, overflow: 'hidden', background: open ? 'rgba(61,86,181,.04)' : 'rgba(255,255,255,.02)' }),
  hwHeader:  { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer', userSelect: 'none' },
};

function HWSection({ icon: Icon, title, status, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const dotColor = status === 'ok' ? '#4ade80' : status === 'err' ? '#f87171' : '#374151';
  return (
    <div style={S.hwSection(open)}>
      <div style={S.hwHeader} onClick={() => setOpen(o => !o)}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(61,86,181,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={15} color="#7b95e0" />
        </div>
        <span style={{ flex: 1, fontWeight: 700, color: '#e8eaf0', fontSize: '0.88rem' }}>{title}</span>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, marginRight: 6, flexShrink: 0 }} />
        <span style={{ fontSize: '0.7rem', color: dotColor, marginRight: 6 }}>{status === 'ok' ? 'Configured' : status === 'err' ? 'Error' : 'Optional'}</span>
        {open ? <ChevronUp size={13} color="#4b5563" /> : <ChevronDown size={13} color="#4b5563" />}
      </div>
      {open && <div style={{ padding: '0 14px 14px' }}>{children}</div>}
    </div>
  );
}

export default function HardwareSettingsModal({ onClose }) {
  const station = useStationStore(s => s.station);

  // ── Step 1 — auth ────────────────────────────────────────────────────────
  const [step,        setStep]        = useState(1);
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [authError,   setAuthError]   = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // ── Step 2 — hardware ────────────────────────────────────────────────────
  const [hw, setHW] = useState(() => loadHW() || {
    receiptPrinter: { model: '', type: 'none', name: '', ip: '', port: 9100, width: '80mm' },
    labelPrinter:   { type: 'none', name: '', ip: '', port: 9100 },
    scale:          { type: 'none', baud: 9600, portLabel: '' },
    cashDrawer:     { type: 'none' },
  });

  const [detectedPrinters, setDetectedPrinters] = useState([]);
  const [detecting,        setDetecting]        = useState(false);
  const [saving,           setSaving]           = useState(false);

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
      const storeId = station.storeId;
      saveHardwareConfig(station.id, hw, storeId).catch(() => {});
    }
    setTimeout(() => { setSaving(false); onClose(); }, 400);
  };

  // ── Printer detect ──────────────────────────────────────────────────────
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
    } catch {
      setDetectedPrinters([]);
    } finally {
      setDetecting(false);
    }
  };

  const printerModel = PRINTER_MODELS.find(p => p.id === hw.receiptPrinter.model);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', background: '#13161e', borderRadius: 20, border: '1px solid rgba(255,255,255,.07)', padding: '1.75rem', position: 'relative' }}>

        {/* Close */}
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <X size={18} />
        </button>

        {/* Header */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0, color: '#e8eaf0', fontSize: '1.1rem', fontWeight: 800 }}>Hardware Settings</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: '0.82rem' }}>
            {step === 1 ? 'Admin authentication required' : `Station: ${station?.name || 'Unknown'}`}
          </p>
        </div>

        {/* ── STEP 1: Auth ─────────────────────────────────────────────── */}
        {step === 1 && (
          <form onSubmit={handleAuth}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 10, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', marginBottom: 20, fontSize: '0.82rem', color: '#f87171' }}>
              <Shield size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <strong>Admin access only.</strong> Hardware settings can only be changed with an Admin or Super Admin account.
              </div>
            </div>

            {authError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', marginBottom: 14, color: '#f87171', fontSize: '0.85rem' }}>
                <AlertCircle size={15} />{authError}
              </div>
            )}

            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <label style={S.label}>Admin Email</label>
                <input style={S.field} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@company.com" required autoFocus />
              </div>
              <div>
                <label style={S.label}>Password</label>
                <input style={S.field} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
              </div>
              <button type="submit" disabled={authLoading} style={{ padding: '0.85rem', borderRadius: 12, border: 'none', cursor: authLoading ? 'not-allowed' : 'pointer', background: '#3d56b5', color: '#fff', fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: authLoading ? 0.7 : 1 }}>
                {authLoading ? <><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Verifying...</> : <><Shield size={16} /> Authenticate</>}
              </button>
            </div>
          </form>
        )}

        {/* ── STEP 2: Hardware ─────────────────────────────────────────── */}
        {step === 2 && (
          <>
            {/* Receipt Printer */}
            <HWSection icon={Printer} title="Receipt Printer" status={hw.receiptPrinter.type !== 'none' && hw.receiptPrinter.model ? 'ok' : 'idle'} defaultOpen>
              <div style={{ display: 'grid', gap: 10 }}>
                <div>
                  <label style={S.label}>Printer Model</label>
                  <select style={S.select} value={hw.receiptPrinter.model} onChange={e => {
                    const m = PRINTER_MODELS.find(p => p.id === e.target.value);
                    if (m) updHW('receiptPrinter', { model: m.id, type: m.type, port: m.port || 9100, width: m.width });
                    else   updHW('receiptPrinter', { model: '', type: 'none' });
                  }}>
                    <option value="">— Select model —</option>
                    {PRINTER_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>

                {printerModel?.type === 'network' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
                    <div>
                      <label style={S.label}>IP Address</label>
                      <input style={S.field} value={hw.receiptPrinter.ip || ''} onChange={e => updHW('receiptPrinter', { ip: e.target.value })} placeholder="192.168.1.100" />
                    </div>
                    <div>
                      <label style={S.label}>Port</label>
                      <input style={{ ...S.field, width: 90 }} type="number" value={hw.receiptPrinter.port || 9100} onChange={e => updHW('receiptPrinter', { port: Number(e.target.value) })} />
                    </div>
                  </div>
                )}

                {printerModel?.type === 'qz' && (
                  <div>
                    <label style={S.label}>Printer Name</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {detectedPrinters.length > 0 ? (
                        <select style={S.select} value={hw.receiptPrinter.name || ''} onChange={e => updHW('receiptPrinter', { name: e.target.value })}>
                          <option value="">— Select printer —</option>
                          {detectedPrinters.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      ) : (
                        <input style={S.field} value={hw.receiptPrinter.name || ''} onChange={e => updHW('receiptPrinter', { name: e.target.value })} placeholder="Printer name" />
                      )}
                      <button type="button" onClick={detectPrinters} disabled={detecting} style={S.testBtn(null)}>
                        {detecting ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />} Detect
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </HWSection>

            {/* Cash Drawer */}
            <HWSection icon={Tag} title="Cash Drawer" status={hw.cashDrawer.type !== 'none' ? 'ok' : 'idle'}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={hw.cashDrawer.type !== 'none'} onChange={e => updHW('cashDrawer', { type: e.target.checked ? 'printer' : 'none' })} />
                  <span style={{ color: '#e8eaf0', fontSize: '0.88rem' }}>Connected via receipt printer</span>
                </label>
              </div>
            </HWSection>

            {/* Scale */}
            <HWSection icon={Scale} title="Weighing Scale" status={hw.scale.type !== 'none' ? 'ok' : 'idle'}>
              <div style={{ display: 'grid', gap: 10 }}>
                <div>
                  <label style={S.label}>Scale Brand</label>
                  <select style={S.select} value={hw.scale.type === 'none' ? '' : hw.scale.brand || ''} onChange={e => {
                    const brand = SCALE_BRANDS.find(b => b.id === e.target.value);
                    updHW('scale', { brand: e.target.value, type: e.target.value ? 'serial' : 'none', baud: brand?.baud || 9600 });
                  }}>
                    <option value="">— None —</option>
                    {SCALE_BRANDS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </select>
                </div>
                {hw.scale.type !== 'none' && (
                  <>
                    <div>
                      <label style={S.label}>Baud Rate</label>
                      <select style={S.select} value={hw.scale.baud || 9600} onChange={e => updHW('scale', { baud: Number(e.target.value) })}>
                        {BAUD_RATES.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={S.label}>Serial Port</label>
                      <input style={S.field} value={hw.scale.portLabel || ''} onChange={e => updHW('scale', { portLabel: e.target.value })} placeholder="e.g. COM3 or /dev/ttyUSB0" />
                    </div>
                  </>
                )}
              </div>
            </HWSection>

            {/* Label Printer */}
            <HWSection icon={Tag} title="Label Printer" status={hw.labelPrinter.type !== 'none' ? 'ok' : 'idle'}>
              <div style={{ display: 'grid', gap: 10 }}>
                <div>
                  <label style={S.label}>Label Printer Type</label>
                  <select style={S.select} value={hw.labelPrinter.type} onChange={e => updHW('labelPrinter', { type: e.target.value })}>
                    <option value="none">— None —</option>
                    <option value="zebra_usb">Zebra (ZPL) — USB via QZ Tray</option>
                    <option value="zebra_network">Zebra (ZPL) — Network/TCP</option>
                    <option value="dymo">Dymo LabelWriter</option>
                  </select>
                </div>
                {hw.labelPrinter.type === 'zebra_network' && (
                  <div>
                    <label style={S.label}>IP Address</label>
                    <input style={S.field} value={hw.labelPrinter.ip || ''} onChange={e => updHW('labelPrinter', { ip: e.target.value })} placeholder="192.168.1.101" />
                  </div>
                )}
                {(hw.labelPrinter.type === 'zebra_usb' || hw.labelPrinter.type === 'dymo') && (
                  <div>
                    <label style={S.label}>Printer Name</label>
                    <input style={S.field} value={hw.labelPrinter.name || ''} onChange={e => updHW('labelPrinter', { name: e.target.value })} placeholder="Label printer name" />
                  </div>
                )}
              </div>
            </HWSection>

            {/* Save */}
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '0.9rem', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: '#3d56b5', color: '#fff', fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {saving ? <><Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</> : <><Check size={15} /> Save Hardware Settings</>}
              </button>
              <button onClick={onClose} style={{ padding: '0.9rem 1.25rem', borderRadius: 12, border: '1px solid rgba(255,255,255,.1)', background: 'none', color: '#6b7280', fontWeight: 700, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
