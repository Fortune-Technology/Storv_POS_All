/**
 * Lottery.jsx — Lottery Module Portal Page
 *
 * Tabs: Overview · Games · Inventory · Active · Shift Reports · Reports · Commission
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Ticket, Plus, X, Check, Edit2, Trash2, RefreshCw, Package, BarChart2, TrendingUp, DollarSign, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import {
  getLotteryGames,
  createLotteryGame,
  updateLotteryGame,
  deleteLotteryGame,
  getLotteryBoxes,
  receiveLotteryBoxOrder,
  activateLotteryBox,
  updateLotteryBox,
  getLotteryShiftReports,
  getLotteryDashboard,
  getLotteryReport,
  getLotteryCommissionReport,
  getLotterySettings,
  updateLotterySettings,
} from '../services/api';

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmt = (n) => n == null ? '—' : `$${Number(n).toFixed(2)}`;
const fmtNum = (n) => n == null ? '—' : Number(n).toLocaleString();

// ── Shared UI ──────────────────────────────────────────────────────────────────
const Card = ({ children, style }) => (
  <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '20px', ...style }}>
    {children}
  </div>
);

const StatCard = ({ label, value, sub, color = 'var(--accent-primary)' }) => (
  <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '18px 20px' }}>
    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: '1.6rem', fontWeight: 800, color, marginBottom: sub ? 4 : 0 }}>{value}</div>
    {sub && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{sub}</div>}
  </div>
);

const Badge = ({ label, color = '#3b82f6' }) => (
  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700, background: color + '22', color, border: `1px solid ${color}44` }}>
    {label}
  </span>
);

const statusColor = (s) => ({
  inventory: '#3b82f6',
  active:    'var(--accent-primary)',
  depleted:  '#f59e0b',
  settled:   '#6b7280',
}[s] || '#6b7280');

const Tabs = ({ tabs, active, onChange }) => (
  <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-light)', marginBottom: 24, overflowX: 'auto' }}>
    {tabs.map(t => (
      <button key={t} onClick={() => onChange(t)} style={{
        padding: '10px 18px', background: 'none', border: 'none', borderBottom: active === t ? '2px solid var(--accent-primary)' : '2px solid transparent',
        color: active === t ? 'var(--accent-primary)' : 'var(--text-muted)', fontWeight: active === t ? 700 : 500,
        cursor: 'pointer', fontSize: '0.88rem', whiteSpace: 'nowrap', transition: 'color .15s',
      }}>
        {t}
      </button>
    ))}
  </div>
);

// ── Simple Bar Chart (pure SVG, no external deps) ─────────────────────────────
function SimpleBarChart({ data, width = 600, height = 200 }) {
  if (!data?.length) return <div style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>No data for selected range</div>;
  const maxVal = Math.max(...data.map(d => Math.max(d.sales || 0, d.payouts || 0)), 1);
  const barW   = Math.max(8, Math.floor((width - 60) / (data.length * 2 + data.length)));
  const chartH = height - 40;
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={Math.max(width, data.length * (barW * 2 + 10) + 60)} height={height} style={{ fontFamily: 'inherit' }}>
        {data.map((d, i) => {
          const x     = 40 + i * (barW * 2 + 10);
          const saleH = Math.round((d.sales / maxVal) * chartH);
          const payH  = Math.round((d.payouts / maxVal) * chartH);
          return (
            <g key={d.date}>
              {/* Sales bar — green */}
              <rect x={x} y={chartH - saleH + 10} width={barW} height={saleH} fill="#16a34a" rx={2} />
              {/* Payouts bar — amber */}
              <rect x={x + barW + 2} y={chartH - payH + 10} width={barW} height={payH} fill="#d97706" rx={2} />
              {/* Date label */}
              <text x={x + barW} y={height - 2} textAnchor="middle" fontSize={9} fill="#9ca3af">
                {d.date?.slice(5)}
              </text>
            </g>
          );
        })}
        {/* Y-axis label */}
        <text x={10} y={20} fontSize={9} fill="#9ca3af">$</text>
      </svg>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: '0.75rem' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#16a34a', borderRadius: 2, marginRight: 4 }}></span>Sales</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#d97706', borderRadius: 2, marginRight: 4 }}></span>Payouts</span>
      </div>
    </div>
  );
}

// ── Game Form Modal ────────────────────────────────────────────────────────────
function GameModal({ game, onSave, onClose }) {
  const [form, setForm] = useState({
    name:           game?.name           || '',
    gameNumber:     game?.gameNumber     || '',
    ticketPrice:    game?.ticketPrice    || '',
    ticketsPerBox:  game?.ticketsPerBox  || 300,
    commissionRate: game?.commissionRate ? (Number(game.commissionRate) * 100).toFixed(2) : '',
    active:         game?.active         !== false,
    state:          game?.state          || '',
    isGlobal:       game?.isGlobal       || false,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  const handle = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name || !form.ticketPrice) { setErr('Name and ticket price are required.'); return; }
    setSaving(true); setErr('');
    try {
      const payload = {
        ...form,
        ticketPrice:    Number(form.ticketPrice),
        ticketsPerBox:  Number(form.ticketsPerBox) || 300,
        commissionRate: form.commissionRate ? Number(form.commissionRate) / 100 : null,
        state:          form.state || undefined,
        isGlobal:       form.isGlobal,
      };
      await onSave(payload);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
    setSaving(false);
  };

  const F = ({ label, children }) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>
      {children}
    </div>
  );
  const inp = { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px', color: '#111827', fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 8000, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 25px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(0,0,0,0.08)', color: '#111827' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h3 style={{ margin: 0, fontWeight: 700, color: '#111827' }}>{game ? 'Edit Game' : 'New Lottery Game'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={18} /></button>
        </div>
        {err && <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: 12 }}>{err}</div>}
        <F label="Game Name"><input style={inp} value={form.name} onChange={e => handle('name', e.target.value)} placeholder="e.g. Holiday Jackpot" /></F>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <F label="Game #"><input style={inp} value={form.gameNumber} onChange={e => handle('gameNumber', e.target.value)} placeholder="e.g. 1234" /></F>
          <F label="Ticket Price ($)"><input style={inp} type="number" step="0.01" value={form.ticketPrice} onChange={e => handle('ticketPrice', e.target.value)} placeholder="2.00" /></F>
          <F label="Tickets / Box"><input style={inp} type="number" value={form.ticketsPerBox} onChange={e => handle('ticketsPerBox', e.target.value)} /></F>
          <F label="Commission %"><input style={inp} type="number" step="0.01" value={form.commissionRate} onChange={e => handle('commissionRate', e.target.value)} placeholder="5.00" /></F>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <F label="State / Province">
            <input style={inp} value={form.state} onChange={e => handle('state', e.target.value)} placeholder="e.g. ON" />
          </F>
          <F label="Global Game">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', paddingTop: 6 }}>
              <input type="checkbox" checked={form.isGlobal} onChange={e => handle('isGlobal', e.target.checked)} />
              <span style={{ color: '#374151', fontSize: '0.9rem' }}>Global (all provinces)</span>
            </label>
          </F>
        </div>
        <F label="Status">
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.active} onChange={e => handle('active', e.target.checked)} />
            <span style={{ color: '#374151', fontSize: '0.9rem' }}>Active (available in POS)</span>
          </label>
        </F>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 8, background: '#f9fafb', border: '1px solid #e5e7eb', color: '#374151', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ padding: '9px 24px', borderRadius: 8, background: 'var(--accent-primary)', border: 'none', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
            {saving ? 'Saving…' : 'Save Game'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Activate Box Modal ─────────────────────────────────────────────────────────
function ActivateBoxModal({ box, onConfirm, onClose }) {
  const [slotNumber, setSlotNumber] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    await onConfirm(box.id, slotNumber ? Number(slotNumber) : null);
    setSaving(false);
  };

  const inp = {
    background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8,
    padding: '10px 12px', color: '#111827', fontSize: '0.9rem',
    width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 8000, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 28, width: '100%', maxWidth: 400, boxShadow: '0 25px 60px rgba(0,0,0,0.3)', color: '#111827' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>Activate Ticket Box</div>
            <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>{box.game?.name} — Box {box.boxNumber || '#?'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}><X size={18} /></button>
        </div>

        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
          <div style={{ fontSize: '0.82rem', color: '#166534', fontWeight: 600 }}>
            🎟️ {fmtNum(box.totalTickets)} tickets · {fmt(box.ticketPrice)} each · Box value {fmt(box.totalValue)}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Machine Slot Number <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            style={inp}
            type="number"
            min={1}
            max={99}
            value={slotNumber}
            onChange={e => setSlotNumber(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="e.g. 3"
            autoFocus
          />
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 4 }}>Which slot in the lottery machine is this box going into?</div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#f9fafb', border: '1px solid #e5e7eb', color: '#374151', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ flex: 2, padding: '10px', borderRadius: 8, background: '#16a34a', border: 'none', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
            {saving ? 'Activating…' : 'Activate Box'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Receive Box Modal ──────────────────────────────────────────────────────────
function ReceiveBoxModal({ games, onSave, onClose }) {
  const [gameId,       setGameId]       = useState('');
  const [quantity,     setQuantity]     = useState(1);
  const [startTicket,  setStartTicket]  = useState('');
  const [saving, setSaving]             = useState(false);
  const [err, setErr]                   = useState('');

  const submit = async () => {
    if (!gameId) { setErr('Select a game.'); return; }
    setSaving(true); setErr('');
    try {
      await onSave({ gameId, quantity: Number(quantity), startTicket: startTicket || undefined });
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
    setSaving(false);
  };

  const inp = { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px', color: '#111827', fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 8000, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 28, width: '100%', maxWidth: 420, boxShadow: '0 25px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(0,0,0,0.08)', color: '#111827' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h3 style={{ margin: 0, fontWeight: 700, color: '#111827' }}>Receive Ticket Order</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={18} /></button>
        </div>
        {err && <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: 12 }}>{err}</div>}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase' }}>Game</label>
          <select style={inp} value={gameId} onChange={e => setGameId(e.target.value)}>
            <option value="">— Select Game —</option>
            {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase' }}>Qty (Boxes)</label>
            <input style={inp} type="number" min={1} value={quantity} onChange={e => setQuantity(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase' }}>Start Ticket #</label>
            <input style={inp} value={startTicket} onChange={e => setStartTicket(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 8, background: '#f9fafb', border: '1px solid #e5e7eb', color: '#374151', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ padding: '9px 24px', borderRadius: 8, background: 'var(--accent-primary)', border: 'none', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
            {saving ? 'Saving…' : 'Receive'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
const TABS = ['Overview', 'Games', 'Inventory', 'Active Tickets', 'Shift Reports', 'Reports', 'Commission', '⚙️ Settings'];

// ── Date helpers ───────────────────────────────────────────────────────────────
const toDateStr = (d) => d.toISOString().slice(0, 10);
const todayStr  = () => toDateStr(new Date());
const daysAgoStr = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toDateStr(d); };

export default function Lottery() {
  const [tab,            setTab]            = useState('Overview');
  const [games,          setGames]          = useState([]);
  const [boxes,          setBoxes]          = useState([]);
  const [shiftReports,   setShiftReports]   = useState([]);
  const [dashboard,      setDashboard]      = useState(null);
  const [report,         setReport]         = useState(null);
  const [reportData,     setReportData]     = useState(null);
  const [commission,     setCommission]     = useState(null);
  const [reportPeriod,   setReportPeriod]   = useState('week');
  const [loading,        setLoading]        = useState(false);
  const [gameModal,      setGameModal]      = useState(null);  // null | 'new' | gameObj
  const [receiveModal,   setReceiveModal]   = useState(false);
  const [activateBox,    setActivateBox]    = useState(null); // box object to activate
  const [expandedBox,    setExpandedBox]    = useState(null);
  // Date range for reports
  const [dateFrom,       setDateFrom]       = useState(daysAgoStr(30));
  const [dateTo,         setDateTo]         = useState(todayStr());
  const [datePreset,     setDatePreset]     = useState('Custom');
  // Lottery settings
  const [lotterySettings,    setLotterySettings]    = useState(null);
  const [settingsForm,       setSettingsForm]       = useState({ enabled: true, cashOnly: false, state: '', commissionRate: '', scanRequiredAtShiftEnd: false });
  const [settingsSaving,     setSettingsSaving]     = useState(false);
  const [settingsMsg,        setSettingsMsg]        = useState('');

  // ── Loaders ─────────────────────────────────────────────────────────────
  const loadGames = useCallback(async () => {
    try { const r = await getLotteryGames(); setGames(Array.isArray(r) ? r : r?.games || []); } catch {}
  }, []);

  const loadBoxes = useCallback(async (status) => {
    try { const r = await getLotteryBoxes(status ? { status } : {}); setBoxes(Array.isArray(r) ? r : r?.boxes || []); } catch {}
  }, []);

  const loadShiftReports = useCallback(async () => {
    try { const r = await getLotteryShiftReports(); setShiftReports(Array.isArray(r) ? r : r?.reports || []); } catch {}
  }, []);

  const loadDashboard = useCallback(async () => {
    try { const r = await getLotteryDashboard(); setDashboard(r); } catch {}
  }, []);

  const loadReport = useCallback(async (from, to) => {
    try {
      const params = { period: reportPeriod };
      if (from) params.from = from;
      if (to)   params.to   = to;
      const r = await getLotteryReport(params);
      setReport(r);
      setReportData(r);
    } catch {}
  }, [reportPeriod]);

  const loadCommission = useCallback(async () => {
    try { const r = await getLotteryCommissionReport({ period: reportPeriod }); setCommission(r); } catch {}
  }, [reportPeriod]);

  const loadSettings = useCallback(async () => {
    try {
      const storeId = localStorage.getItem('activeStoreId');
      const r = await getLotterySettings(storeId);
      if (r) {
        setLotterySettings(r);
        setSettingsForm({
          enabled:                  r.enabled                  ?? true,
          cashOnly:                 r.cashOnly                 ?? false,
          state:                    r.state                    || '',
          commissionRate:           r.commissionRate != null   ? (Number(r.commissionRate) * 100).toFixed(2) : '',
          scanRequiredAtShiftEnd:   r.scanRequiredAtShiftEnd   ?? false,
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadGames(), loadDashboard(), loadSettings()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab === 'Inventory')      loadBoxes();
    if (tab === 'Active Tickets') loadBoxes('active');
    if (tab === 'Shift Reports')  loadShiftReports();
    if (tab === 'Reports')        loadReport(dateFrom, dateTo);
    if (tab === 'Commission')     loadCommission();
    if (tab === '⚙️ Settings')    loadSettings();
  }, [tab, reportPeriod]); // eslint-disable-line

  // ── Preset date helpers ───────────────────────────────────────────────────
  const applyPreset = (preset) => {
    setDatePreset(preset);
    const today = new Date();
    let from, to;
    if (preset === 'Today') {
      from = todayStr(); to = todayStr();
    } else if (preset === 'This Week') {
      const dow = today.getDay();
      const start = new Date(today); start.setDate(today.getDate() - dow);
      from = toDateStr(start); to = todayStr();
    } else if (preset === 'This Month') {
      from = toDateStr(new Date(today.getFullYear(), today.getMonth(), 1));
      to   = todayStr();
    } else if (preset === 'Last Month') {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last  = new Date(today.getFullYear(), today.getMonth(), 0);
      from = toDateStr(first); to = toDateStr(last);
    } else {
      return; // Custom — user sets manually
    }
    setDateFrom(from);
    setDateTo(to);
    loadReport(from, to);
  };

  // ── Settings save ─────────────────────────────────────────────────────────
  const handleSaveSettings = async () => {
    setSettingsSaving(true); setSettingsMsg('');
    try {
      const storeId = localStorage.getItem('activeStoreId');
      const payload = {
        ...settingsForm,
        commissionRate: settingsForm.commissionRate !== '' ? Number(settingsForm.commissionRate) / 100 : null,
      };
      const updated = await updateLotterySettings(storeId, payload);
      setLotterySettings(updated || payload);
      setSettingsMsg('Settings saved successfully.');
    } catch (e) {
      setSettingsMsg('Error saving settings: ' + (e.response?.data?.error || e.message));
    }
    setSettingsSaving(false);
  };

  // ── CSV Download ──────────────────────────────────────────────────────────
  const downloadReportCSV = () => {
    if (!reportData) return;
    const rows = [
      ['Date', 'Sales', 'Payouts', 'Net'],
      ...(reportData.chart || []).map(d => [d.date, d.sales?.toFixed(2), d.payouts?.toFixed(2), d.net?.toFixed(2)]),
    ];
    const csv  = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `lottery-report-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Game actions ─────────────────────────────────────────────────────────
  const handleSaveGame = async (data) => {
    if (gameModal && gameModal !== 'new') {
      await updateLotteryGame(gameModal.id, data);
    } else {
      await createLotteryGame(data);
    }
    setGameModal(null);
    loadGames();
  };

  const handleDeleteGame = async (id) => {
    if (!window.confirm('Delete this game?')) return;
    await deleteLotteryGame(id);
    loadGames();
  };

  // ── Box actions ───────────────────────────────────────────────────────────
  const handleReceive = async (data) => {
    await receiveLotteryBoxOrder(data);
    setReceiveModal(false);
    loadBoxes();
  };

  const handleActivateBox = async (id, slotNumber) => {
    await activateLotteryBox(id, { slotNumber });
    setActivateBox(null);
    loadBoxes(tab === 'Active Tickets' ? 'active' : undefined);
  };

  const handleDeplete = async (id) => {
    if (!window.confirm('Mark this box as depleted? This means all tickets have been sold.')) return;
    await updateLotteryBox(id, { status: 'depleted' });
    loadBoxes(tab === 'Active Tickets' ? 'active' : undefined);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content" style={{ padding: '28px 32px', maxWidth: 1200 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(122,193,67,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ticket size={22} color="var(--accent-primary)" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)' }}>Lottery</h1>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>Ticket inventory, sales tracking & commission reports</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {tab === 'Games' && (
            <button onClick={() => setGameModal('new')} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, background: 'var(--accent-primary)', border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.88rem' }}>
              <Plus size={15} /> New Game
            </button>
          )}
          {(tab === 'Inventory' || tab === 'Active Tickets') && (
            <button onClick={() => setReceiveModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, background: 'var(--accent-primary)', border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.88rem' }}>
              <Package size={15} /> Receive Order
            </button>
          )}
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {/* ── OVERVIEW ── */}
      {tab === 'Overview' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
            <StatCard label="Total Sales (Month)" value={fmt(dashboard?.totalSales)} color="var(--accent-primary)" />
            <StatCard label="Total Payouts"        value={fmt(dashboard?.totalPayouts)} color="#f59e0b" />
            <StatCard label="Net Revenue"          value={fmt(dashboard?.netRevenue)} color="#3b82f6" />
            <StatCard label="Commission Earned"    value={fmt(dashboard?.commission)} color="#a855f7" />
            <StatCard label="Active Boxes"         value={fmtNum(dashboard?.activeBoxes)} sub="in machine now" />
            <StatCard label="Inventory Boxes"      value={fmtNum(dashboard?.inventoryBoxes)} sub="in storage" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <Card>
              <h3 style={{ margin: '0 0 16px', fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Active Games</h3>
              {games.filter(g => g.active).length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>No active games. Add one in the Games tab.</p>
              )}
              {games.filter(g => g.active).map(g => (
                <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{g.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fmtNum(g.ticketsPerBox)} tickets · {fmt(g.ticketPrice)}</div>
                  </div>
                  <Badge label="Active" color="var(--accent-primary)" />
                </div>
              ))}
            </Card>
            <Card>
              <h3 style={{ margin: '0 0 16px', fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Recent Shift Reports</h3>
              {shiftReports.slice(0, 5).length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>No shift reports yet.</p>
              )}
              {shiftReports.slice(0, 5).map(r => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{new Date(r.closedAt || r.createdAt).toLocaleDateString()}</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: Math.abs(Number(r.variance || 0)) < 0.01 ? 'var(--accent-primary)' : '#f59e0b' }}>
                    {r.variance >= 0 ? '+' : ''}{fmt(r.variance)} var
                  </div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}

      {/* ── GAMES ── */}
      {tab === 'Games' && (
        <div>
          {games.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
              <Ticket size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
              <p>No games yet. Click "New Game" to add one.</p>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {games.map(g => (
              <Card key={g.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{g.name}</div>
                    {g.gameNumber && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Game #{g.gameNumber}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {g.state && <Badge label={g.state} color="#0ea5e9" />}
                    {g.isGlobal && <Badge label="Global" color="#7c3aed" />}
                    <Badge label={g.active ? 'Active' : 'Inactive'} color={g.active ? 'var(--accent-primary)' : '#6b7280'} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                  {[
                    ['Ticket Price', fmt(g.ticketPrice)],
                    ['Tickets / Box', fmtNum(g.ticketsPerBox)],
                    ['Box Value', fmt(Number(g.ticketPrice) * Number(g.ticketsPerBox))],
                    ['Commission', g.commissionRate ? `${(Number(g.commissionRate) * 100).toFixed(2)}%` : '—'],
                  ].map(([l, v]) => (
                    <div key={l} style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '8px 12px' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{l}</div>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.92rem' }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setGameModal(g)} style={{ flex: 1, padding: '8px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                    <Edit2 size={13} /> Edit
                  </button>
                  <button onClick={() => handleDeleteGame(g.id)} style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', cursor: 'pointer' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── INVENTORY ── */}
      {tab === 'Inventory' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            {['All', 'inventory', 'active', 'depleted', 'settled'].map(s => (
              <button key={s} onClick={() => loadBoxes(s === 'All' ? undefined : s)}
                style={{ padding: '6px 14px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, textTransform: 'capitalize' }}>
                {s}
              </button>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr>
                  {['Game', 'Box #', 'Slot', 'Total Tickets', 'Ticket Price', 'Box Value', 'Tickets Sold', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', borderBottom: '1px solid var(--border-light)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {boxes.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>No boxes found.</td></tr>
                )}
                {boxes.map(b => (
                  <tr key={b.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '12px 14px', color: 'var(--text-primary)', fontWeight: 600 }}>{b.game?.name || '—'}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{b.boxNumber || '—'}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{b.slotNumber ?? '—'}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{fmtNum(b.totalTickets)}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{fmt(b.ticketPrice)}</td>
                    <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>{fmt(b.totalValue)}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{fmtNum(b.ticketsSold)} / {fmtNum(b.totalTickets)}</td>
                    <td style={{ padding: '12px 14px' }}><Badge label={b.status} color={statusColor(b.status)} /></td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {b.status === 'inventory' && (
                          <button onClick={() => setActivateBox(b)} style={{ padding: '5px 12px', borderRadius: 6, background: 'rgba(122,193,67,0.12)', border: '1px solid rgba(122,193,67,0.3)', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>
                            Activate
                          </button>
                        )}
                        {b.status === 'active' && (
                          <button onClick={() => handleDeplete(b.id)} style={{ padding: '5px 12px', borderRadius: 6, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>
                            Mark Depleted
                          </button>
                        )}
                        {b.status === 'inventory' && (
                          <button onClick={async () => { if (!window.confirm('Remove this box from inventory?')) return; await updateLotteryBox(b.id, { status: 'removed' }); loadBoxes(); }}
                            style={{ padding: '5px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', cursor: 'pointer', fontSize: '0.78rem' }}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ACTIVE TICKETS ── */}
      {tab === 'Active Tickets' && (
        <div>
          {boxes.filter(b => b.status === 'active').length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
              <Ticket size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
              <p>No boxes currently active in machine.</p>
              <p style={{ fontSize: '0.85rem' }}>Activate a box from the Inventory tab.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {boxes.filter(b => b.status === 'active').map(b => {
                const pct = b.totalTickets > 0 ? Math.round((b.ticketsSold / b.totalTickets) * 100) : 0;
                return (
                  <Card key={b.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{b.game?.name || 'Unknown Game'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {b.slotNumber ? `Slot ${b.slotNumber}` : 'No slot'} · Box {b.boxNumber || '#?'}
                        </div>
                      </div>
                      <Badge label="Active" color="var(--accent-primary)" />
                    </div>
                    {/* Progress bar */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 5 }}>
                        <span>{fmtNum(b.ticketsSold)} sold</span>
                        <span>{fmtNum(b.totalTickets - b.ticketsSold)} remaining</span>
                      </div>
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, background: pct > 80 ? '#f59e0b' : 'var(--accent-primary)', height: '100%', borderRadius: 4, transition: 'width .3s' }} />
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: 3 }}>{pct}%</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '8px 10px' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Sales</div>
                        <div style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>{fmt(b.salesAmount)}</div>
                      </div>
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '8px 10px' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Box Value</div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{fmt(b.totalValue)}</div>
                      </div>
                    </div>
                    <button onClick={() => handleDeplete(b.id)}
                      style={{ width: '100%', padding: '8px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700 }}>
                      Mark as Depleted
                    </button>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── SHIFT REPORTS ── */}
      {tab === 'Shift Reports' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr>
                {['Date / Shift', 'Sales', 'Payouts', 'Net', 'Machine', 'Digital', 'Variance', 'Notes'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', borderBottom: '1px solid var(--border-light)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shiftReports.length === 0 && (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>No shift reports yet.</td></tr>
              )}
              {shiftReports.map(r => {
                const v = Number(r.variance || 0);
                const vColor = Math.abs(v) < 0.01 ? 'var(--accent-primary)' : Math.abs(v) <= 5 ? '#f59e0b' : '#ef4444';
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '12px 14px', color: 'var(--text-primary)', fontWeight: 600 }}>
                      {new Date(r.closedAt || r.createdAt).toLocaleDateString()}<br />
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.shiftId?.slice(-8)}</span>
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--accent-primary)', fontWeight: 600 }}>{fmt(r.totalSales)}</td>
                    <td style={{ padding: '12px 14px', color: '#f59e0b' }}>{fmt(r.totalPayouts)}</td>
                    <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--text-primary)' }}>{fmt(r.netAmount)}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{fmt(r.machineAmount)}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{fmt(r.digitalAmount)}</td>
                    <td style={{ padding: '12px 14px', fontWeight: 700, color: vColor }}>{v >= 0 ? '+' : ''}{fmt(v)}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{r.notes || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── REPORTS ── */}
      {tab === 'Reports' && (
        <div>
          {/* Date range + preset controls */}
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>From</label>
                <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setDatePreset('Custom'); }}
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: 8, padding: '7px 10px', color: 'var(--text-primary)', fontSize: '0.88rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>To</label>
                <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setDatePreset('Custom'); }}
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: 8, padding: '7px 10px', color: 'var(--text-primary)', fontSize: '0.88rem' }} />
              </div>
              <button onClick={() => loadReport(dateFrom, dateTo)}
                style={{ padding: '8px 20px', borderRadius: 8, background: 'var(--accent-primary)', border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.88rem' }}>
                Apply
              </button>
              <button onClick={downloadReportCSV} disabled={!reportData}
                style={{ padding: '8px 16px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-secondary)', fontWeight: 600, cursor: reportData ? 'pointer' : 'not-allowed', fontSize: '0.85rem', opacity: reportData ? 1 : 0.5 }}>
                ⬇ Download CSV
              </button>
            </div>
            {/* Quick preset buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {['Today', 'This Week', 'This Month', 'Last Month', 'Custom'].map(p => (
                <button key={p} onClick={() => applyPreset(p)}
                  style={{ padding: '5px 12px', borderRadius: 7, background: datePreset === p ? 'var(--accent-primary)' : 'var(--bg-secondary)', border: datePreset === p ? 'none' : '1px solid var(--border-light)', color: datePreset === p ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem' }}>
                  {p}
                </button>
              ))}
            </div>
          </Card>

          {report && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 28 }}>
                <StatCard label="Total Sales"   value={fmt(report.totalSales)}   color="var(--accent-primary)" />
                <StatCard label="Total Payouts" value={fmt(report.totalPayouts)} color="#f59e0b" />
                <StatCard label="Net Revenue"   value={fmt(report.netRevenue)}   color="#3b82f6" />
                <StatCard label="Transactions"  value={fmtNum(report.transactionCount)} sub="sale transactions" />
              </div>

              {/* Bar chart of daily sales vs payouts */}
              {report.chart && report.chart.length > 0 && (
                <Card style={{ marginBottom: 20 }}>
                  <h3 style={{ margin: '0 0 16px', fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Daily Sales vs Payouts</h3>
                  <SimpleBarChart data={report.chart} width={700} height={200} />
                </Card>
              )}

              {report.byGame && report.byGame.length > 0 && (
                <Card style={{ marginBottom: 20 }}>
                  <h3 style={{ margin: '0 0 16px', fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Sales by Game</h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                    <thead>
                      <tr>
                        {['Game', 'Sales', 'Payouts', 'Net', 'Transactions'].map(h => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', borderBottom: '1px solid var(--border-light)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.byGame.map((g, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                          <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>{g.gameName || 'Unknown'}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--accent-primary)', fontWeight: 600 }}>{fmt(g.sales)}</td>
                          <td style={{ padding: '10px 12px', color: '#f59e0b' }}>{fmt(g.payouts)}</td>
                          <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--text-primary)' }}>{fmt(g.net)}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{fmtNum(g.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </>
          )}
          {!report && <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>No report data available.</div>}
        </div>
      )}

      {/* ── COMMISSION ── */}
      {tab === 'Commission' && (
        <div>
          {/* Store-level commission rate banner */}
          <div style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.25)', borderRadius: 10, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.1rem' }}>💰</span>
              <div>
                <div style={{ fontWeight: 700, color: '#7c3aed', fontSize: '0.95rem' }}>
                  Commission Rate:{' '}
                  {lotterySettings?.commissionRate != null
                    ? `${(Number(lotterySettings.commissionRate) * 100).toFixed(2)}%`
                    : '—'}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 1 }}>Store-level rate. Rate is managed in the Settings tab.</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 24, alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.88rem', fontWeight: 600 }}>Period:</span>
            {['day', 'week', 'month'].map(p => (
              <button key={p} onClick={() => setReportPeriod(p)}
                style={{ padding: '6px 16px', borderRadius: 8, background: reportPeriod === p ? 'var(--accent-primary)' : 'var(--bg-secondary)', border: reportPeriod === p ? 'none' : '1px solid var(--border-light)', color: reportPeriod === p ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', textTransform: 'capitalize' }}>
                {p}
              </button>
            ))}
          </div>
          {commission && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
                <StatCard label="Total Commission" value={fmt(commission.totalCommission)} color="#a855f7" />
                <StatCard label="Total Sales"      value={fmt(commission.totalSales)}      color="var(--accent-primary)" />
                <StatCard label="Avg Commission %"
                  value={commission.avgRate ? `${(Number(commission.avgRate) * 100).toFixed(2)}%` : '—'}
                  color="#3b82f6" />
              </div>
              {commission.byGame && commission.byGame.length > 0 && (
                <Card>
                  <h3 style={{ margin: '0 0 16px', fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Commission by Game</h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                    <thead>
                      <tr>
                        {['Game', 'Rate', 'Sales', 'Commission'].map(h => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', borderBottom: '1px solid var(--border-light)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {commission.byGame.map((g, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                          <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>{g.gameName}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{g.rate ? `${(Number(g.rate) * 100).toFixed(2)}%` : '—'}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--accent-primary)', fontWeight: 600 }}>{fmt(g.sales)}</td>
                          <td style={{ padding: '10px 12px', fontWeight: 700, color: '#a855f7' }}>{fmt(g.commission)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </>
          )}
          {!commission && <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>No commission data available.</div>}
        </div>
      )}

      {/* ── SETTINGS ── */}
      {tab === '⚙️ Settings' && (
        <div>
          <Card style={{ maxWidth: 560 }}>
            <h3 style={{ margin: '0 0 20px', fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>Lottery Settings</h3>

            {settingsMsg && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 18, fontSize: '0.85rem', fontWeight: 600,
                background: settingsMsg.startsWith('Error') ? 'rgba(239,68,68,0.08)' : 'rgba(22,163,74,0.08)',
                border: `1px solid ${settingsMsg.startsWith('Error') ? 'rgba(239,68,68,0.25)' : 'rgba(22,163,74,0.25)'}`,
                color: settingsMsg.startsWith('Error') ? '#dc2626' : '#15803d',
              }}>
                {settingsMsg}
              </div>
            )}

            {/* Store State / Province */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Store State / Province
              </label>
              <select
                value={settingsForm.state}
                onChange={e => setSettingsForm(f => ({ ...f, state: e.target.value }))}
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-primary)', fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' }}
              >
                <option value="">— Select Province —</option>
                {['ON', 'BC', 'AB', 'MB', 'SK', 'QC', 'NS', 'NB', 'PE', 'NL'].map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            {/* Commission Rate */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Commission Rate (%)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={settingsForm.commissionRate}
                onChange={e => setSettingsForm(f => ({ ...f, commissionRate: e.target.value }))}
                placeholder="e.g. 5.4"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-primary)', fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' }}
              />
              <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Enter as percentage e.g. 5.4 for 5.4%
              </div>
            </div>

            {/* Toggle options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
              {/* Enable Lottery */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
                <input
                  type="checkbox"
                  checked={settingsForm.enabled}
                  onChange={e => setSettingsForm(f => ({ ...f, enabled: e.target.checked }))}
                  style={{ width: 16, height: 16 }}
                />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>Enable Lottery</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Allow lottery sales and payouts in POS</div>
                </div>
              </label>

              {/* Cash Only */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
                <input
                  type="checkbox"
                  checked={settingsForm.cashOnly}
                  onChange={e => setSettingsForm(f => ({ ...f, cashOnly: e.target.checked }))}
                  style={{ width: 16, height: 16 }}
                />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>Cash Only</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Restrict lottery payments to cash transactions only</div>
                </div>
              </label>

              {/* Require Ticket Scan at Shift End */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
                <input
                  type="checkbox"
                  checked={settingsForm.scanRequiredAtShiftEnd}
                  onChange={e => setSettingsForm(f => ({ ...f, scanRequiredAtShiftEnd: e.target.checked }))}
                  style={{ width: 16, height: 16 }}
                />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>Require Ticket Scan at Shift End</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>When enabled, cashiers must scan each active box before closing a shift</div>
                </div>
              </label>
            </div>

            <button
              onClick={handleSaveSettings}
              disabled={settingsSaving}
              style={{ padding: '10px 28px', borderRadius: 9, background: 'var(--accent-primary)', border: 'none', color: '#fff', fontWeight: 700, cursor: settingsSaving ? 'not-allowed' : 'pointer', fontSize: '0.92rem', opacity: settingsSaving ? 0.7 : 1 }}
            >
              {settingsSaving ? 'Saving…' : 'Save Settings'}
            </button>
          </Card>
        </div>
      )}

      {/* ── Modals ── */}
      {gameModal && (
        <GameModal
          game={gameModal === 'new' ? null : gameModal}
          onSave={handleSaveGame}
          onClose={() => setGameModal(null)}
        />
      )}
      {receiveModal && (
        <ReceiveBoxModal
          games={games.filter(g => g.active)}
          onSave={handleReceive}
          onClose={() => setReceiveModal(false)}
        />
      )}
      {activateBox && (
        <ActivateBoxModal
          box={activateBox}
          onConfirm={handleActivateBox}
          onClose={() => setActivateBox(null)}
        />
      )}
      </main>
    </div>
  );
}
