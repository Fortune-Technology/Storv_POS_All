/**
 * Lottery.jsx — Lottery Module Portal Page
 *
 * Tabs (admin/superadmin): Overview · Ticket Catalog · Receive Order · Games
 *                          · Inventory · Active Tickets · Shift Reports
 *                          · Reports · Commission · Settings
 * Tabs (other roles):      Overview · Receive Order · Games · Inventory
 *                          · Active Tickets · Shift Reports · Reports
 *                          · Commission · Settings
 */

import React, { useState, useEffect, useCallback } from 'react';
import PriceInput from '../components/PriceInput';
import ModuleDisabled from '../components/ModuleDisabled';
import { useStoreModules } from '../hooks/useStoreModules';
import {
  Ticket, Plus, X, Check, Edit2, Trash2, RefreshCw,
  Package, BarChart2, Search, MapPin, AlertCircle,
  ChevronUp, ChevronDown, Bell, BookOpen, Layers,
  ScanLine,
} from 'lucide-react';

import {
  getLotteryGames, createLotteryGame, updateLotteryGame, deleteLotteryGame,
  getLotteryBoxes, receiveLotteryBoxOrder, activateLotteryBox, updateLotteryBox,
  getLotteryShiftReports,
  getLotteryDashboard, getLotteryReport, getLotteryCommissionReport,
  getLotterySettings, updateLotterySettings,
  // Phase 1a: scan + lifecycle
  scanLotteryBarcode, parseLotteryBarcode, moveLotteryBoxToSafe, soldoutLotteryBox,
  returnLotteryBoxToLotto, cancelLotteryPendingMove,
  // Catalog
  getLotteryCatalog, getAllLotteryCatalog,
  createLotteryCatalogTicket, updateLotteryCatalogTicket, deleteLotteryCatalogTicket,
  // Requests
  getLotteryTicketRequests, getLotteryPendingCount,
  createLotteryTicketRequest, reviewLotteryTicketRequest,
  // Receive from catalog
  receiveFromLotteryCatalog,
} from '../services/api';
import LotteryDailyScan from './LotteryDailyScan';
import LotteryWeeklySettlement from './LotteryWeeklySettlement';
import './Lottery.css';
import './LotteryDailyScan.css';
import './LotteryWeeklySettlement.css';

/* ── helpers ──────────────────────────────────────────────────────────────── */
const fmt = (n) => n == null ? 'N/A' : `$${Number(n).toFixed(2)}`;
const fmtNum = (n) => n == null ? 'N/A' : Number(n).toLocaleString();

const toDateStr = (d) => d.toISOString().slice(0, 10);
const todayStr = () => toDateStr(new Date());
const daysAgoStr = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toDateStr(d); };

const statusColor = (s) => ({
  inventory: 'lt-badge-blue',
  active: 'lt-badge-brand',
  depleted: 'lt-badge-amber',
  settled: 'lt-badge-gray',
}[s] || 'lt-badge-gray');

const requestStatusClass = (s) => ({
  pending: 'lt-badge-amber',
  approved: 'lt-badge-green',
  rejected: 'lt-badge-red',
}[s] || 'lt-badge-gray');

/* US States + Canadian Provinces */
const ALL_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
  'ON', 'BC', 'AB', 'MB', 'SK', 'QC', 'NS', 'NB', 'PE', 'NL', 'YT', 'NT', 'NU',
];

/* ── small shared components ──────────────────────────────────────────────── */
const Badge = ({ label, cls = 'lt-badge-gray' }) => (
  <span className={`lt-badge ${cls}`}>{label}</span>
);

function StatCard({ label, value, sub, color = 'var(--accent-primary)' }) {
  return (
    <div className="lt-stat-card">
      <div className="lt-stat-label">{label}</div>
      <div className="lt-stat-value" style={{ color }}>{value}</div>
      {sub && <div className="lt-stat-sub">{sub}</div>}
    </div>
  );
}

/* ── Simple SVG bar chart ─────────────────────────────────────────────────── */
function SimpleBarChart({ data, width = 600, height = 200 }) {
  if (!data?.length) return <div className="lt-empty">No data for selected range</div>;
  const maxVal = Math.max(...data.map(d => Math.max(d.sales || 0, d.payouts || 0)), 1);
  const barW = Math.max(8, Math.floor((width - 60) / (data.length * 2 + data.length)));
  const chartH = height - 40;
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={Math.max(width, data.length * (barW * 2 + 10) + 60)} height={height} style={{ fontFamily: 'inherit' }}>
        {data.map((d, i) => {
          const x = 40 + i * (barW * 2 + 10);
          const saleH = Math.round((d.sales / maxVal) * chartH);
          const payH = Math.round((d.payouts / maxVal) * chartH);
          return (
            <g key={d.date}>
              <rect x={x} y={chartH - saleH + 10} width={barW} height={saleH} fill="#16a34a" rx={2} />
              <rect x={x + barW + 2} y={chartH - payH + 10} width={barW} height={payH} fill="#d97706" rx={2} />
              <text x={x + barW} y={height - 2} textAnchor="middle" fontSize={9} fill="#9ca3af">
                {d.date?.slice(5)}
              </text>
            </g>
          );
        })}
        <text x={10} y={20} fontSize={9} fill="#9ca3af">$</text>
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#16a34a', borderRadius: 2, marginRight: 4 }} />Sales</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#d97706', borderRadius: 2, marginRight: 4 }} />Payouts</span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MODALS
══════════════════════════════════════════════════════════════════════════ */

/* Game Modal */
function GameModal({ game, onSave, onClose }) {
  const [form, setForm] = useState({
    name: game?.name || '',
    gameNumber: game?.gameNumber || '',
    ticketPrice: game?.ticketPrice || '',
    ticketsPerBox: game?.ticketsPerBox || 300,
    active: game?.active !== false,
    state: game?.state || '',
    isGlobal: game?.isGlobal || false,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name || !form.ticketPrice) { setErr('Name and ticket price are required.'); return; }
    setSaving(true); setErr('');
    try {
      await onSave({ ...form, ticketPrice: Number(form.ticketPrice), ticketsPerBox: Number(form.ticketsPerBox) || 300 });
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    setSaving(false);
  };

  return (
    <div className="lt-modal-overlay">
      <div className="lt-modal lt-modal-lg">
        <div className="lt-modal-header">
          <h3 className="lt-modal-title">{game ? 'Edit Game' : 'New Lottery Game'}</h3>
          <button className="lt-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        {err && <div className="lt-error">{err}</div>}
        <div className="lt-field">
          <label className="lt-field-label">Game Name</label>
          <input className="lt-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Holiday Jackpot" />
        </div>
        <div className="lt-field-row">
          <div className="lt-field">
            <label className="lt-field-label">Game #</label>
            <input className="lt-input" value={form.gameNumber} onChange={e => set('gameNumber', e.target.value)} placeholder="e.g. 1234" />
          </div>
          <div className="lt-field">
            <label className="lt-field-label">Ticket Price ($)</label>
            <PriceInput className="lt-input" value={form.ticketPrice} onChange={(v) => set('ticketPrice', v)} placeholder="2.00" />
          </div>
          <div className="lt-field">
            <label className="lt-field-label">Tickets / Box</label>
            <input className="lt-input" type="number" value={form.ticketsPerBox} onChange={e => set('ticketsPerBox', e.target.value)} />
          </div>
        </div>
        <div className="lt-field-row">
          <div className="lt-field">
            <label className="lt-field-label">State / Province</label>
            <select className="lt-select" value={form.state} onChange={e => set('state', e.target.value)}>
              <option value="">— Any —</option>
              {ALL_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="lt-field">
            <label className="lt-field-label">Visibility</label>
            <label className="lt-toggle-row" style={{ margin: 0 }}>
              <input type="checkbox" checked={form.isGlobal} onChange={e => set('isGlobal', e.target.checked)} />
              <div><div className="lt-toggle-label">Global game</div><div className="lt-toggle-hint">Shared with all stores in this state</div></div>
            </label>
          </div>
        </div>
        <label className="lt-toggle-row">
          <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
          <div><div className="lt-toggle-label">Active (available in POS)</div></div>
        </label>
        <div className="lt-form-actions">
          <button className="lt-btn lt-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="lt-btn lt-btn-primary" onClick={submit} disabled={saving}>
            {saving ? <RefreshCw size={14} className="lt-spin" /> : <Check size={14} />} {saving ? 'Saving…' : 'Save Game'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Activate Box Modal */
function ActivateBoxModal({ box, onConfirm, onClose }) {
  const [slotNumber, setSlotNumber] = useState('');
  const [activationDate, setActivationDate] = useState(toDateStr(new Date()));
  const [currentTicket, setCurrentTicket] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await onConfirm(box.id, {
        slotNumber: slotNumber ? Number(slotNumber) : null,
        date: activationDate || null,
        currentTicket: currentTicket !== '' ? String(currentTicket) : null,
      });
    } catch (err) {
      alert(err?.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="lt-modal-overlay">
      <div className="lt-modal">
        <div className="lt-modal-header">
          <div>
            <div className="lt-modal-title">Activate Ticket Book</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>{box.game?.name} — Book {box.boxNumber || '#?'}</div>
          </div>
          <button className="lt-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="lt-modal-info">
          🎟️ {fmtNum(box.totalTickets)} tickets · {fmt(box.ticketPrice)} each · Book value {fmt(box.totalValue)}
        </div>
        <div className="lt-field">
          <label className="lt-field-label">Activation Date</label>
          <input className="lt-input" type="date" value={activationDate}
            onChange={e => setActivationDate(e.target.value)} />
          <span className="lt-field-hint">Date this book was physically placed on the counter (defaults to today — you can backdate).</span>
        </div>
        <div className="lt-field">
          <label className="lt-field-label">Box # / Slot Number <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
          <input className="lt-input" type="number" min={1} max={99} value={slotNumber}
            onChange={e => setSlotNumber(e.target.value)}
            placeholder="auto-assigns next free slot if blank" />
          <span className="lt-field-hint">If blank, the system auto-assigns the next free counter slot.</span>
        </div>
        <div className="lt-field">
          <label className="lt-field-label">Starting Ticket # <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
          <input className="lt-input" type="number" value={currentTicket}
            onChange={e => setCurrentTicket(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="next-to-sell ticket number" />
          <span className="lt-field-hint">Populate if any tickets have already been sold from this book.</span>
        </div>
        <div className="lt-form-actions">
          <button className="lt-btn lt-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="lt-btn lt-btn-success" onClick={submit} disabled={saving}>
            {saving ? 'Activating…' : 'Activate Book'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Move to Safe Modal — supports immediate + scheduled */
function MoveToSafeModal({ box, onConfirm, onClose }) {
  const [date, setDate] = useState(toDateStr(new Date()));
  const [saving, setSaving] = useState(false);
  const today = toDateStr(new Date());
  const isScheduled = date > today;
  const submit = async () => {
    setSaving(true);
    try { await onConfirm(box.id, { date }); }
    catch (err) { alert(err?.response?.data?.error || err.message); }
    finally { setSaving(false); }
  };
  return (
    <div className="lt-modal-overlay">
      <div className="lt-modal">
        <div className="lt-modal-header">
          <div>
            <div className="lt-modal-title">Move to Safe</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>{box.game?.name} — Book {box.boxNumber || '#?'}</div>
          </div>
          <button className="lt-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="lt-modal-info">
          Takes the book off the counter and returns it to the Safe (your on-hand inventory). The counter slot is freed.
        </div>
        <div className="lt-field">
          <label className="lt-field-label">Effective Date</label>
          <input className="lt-input" type="date" value={date} min={today}
            onChange={e => setDate(e.target.value)} />
          {isScheduled && (
            <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.4)', borderRadius: 6, color: '#b45309', fontSize: '0.78rem' }}>
              ⓘ Scheduled for {date}. The book stays on the counter until then. You can cancel any time before.
            </div>
          )}
        </div>
        <div className="lt-form-actions">
          <button className="lt-btn lt-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="lt-btn lt-btn-warning" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : (isScheduled ? 'Schedule Move' : 'Move Now')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Return to Lotto Modal — external return reducing owed commission */
function ReturnToLottoModal({ box, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const unsold = Math.max(0, (box.totalTickets || 0) - (box.ticketsSold || 0));
  const unsoldValue = unsold * Number(box.ticketPrice || 0);
  const submit = async () => {
    setSaving(true);
    try { await onConfirm(box.id, { reason: reason || null }); }
    catch (err) { alert(err?.response?.data?.error || err.message); }
    finally { setSaving(false); }
  };
  return (
    <div className="lt-modal-overlay">
      <div className="lt-modal">
        <div className="lt-modal-header">
          <div>
            <div className="lt-modal-title">Return to Lottery Commission</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>{box.game?.name} — Book {box.boxNumber || '#?'}</div>
          </div>
          <button className="lt-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="lt-modal-info" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#991b1b' }}>
          This book is being physically returned to the lottery commission. The {fmtNum(unsold)} unsold ticket{unsold === 1 ? '' : 's'} worth {fmt(unsoldValue)} will be deducted from the next weekly settlement. This action cannot be undone.
        </div>
        <div className="lt-field">
          <label className="lt-field-label">Reason / Note <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
          <input className="lt-input" type="text" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. game ended, partial return, unsold stock" />
        </div>
        <div className="lt-form-actions">
          <button className="lt-btn lt-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="lt-btn lt-btn-danger" onClick={submit} disabled={saving}>
            {saving ? 'Returning…' : 'Return to Lotto'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Book Timeline — shows the lifecycle dates for a single box */
function BookTimelineModal({ box, onClose }) {
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString() + ' ' + new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
  return (
    <div className="lt-modal-overlay">
      <div className="lt-modal">
        <div className="lt-modal-header">
          <div>
            <div className="lt-modal-title">Book Timeline</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>{box.game?.name} — Book {box.boxNumber || '#?'}</div>
          </div>
          <button className="lt-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="lt-modal-info">
          🎟️ {fmtNum(box.totalTickets)} tickets · {fmt(box.ticketPrice)} each · Book value {fmt(box.totalValue)}
          {box.slotNumber != null && <span> · Slot #{box.slotNumber}</span>}
        </div>
        <div style={{ padding: '12px 4px' }}>
          <TimelineRow label="Received" at={box.createdAt} active />
          <TimelineRow label="Activated" at={box.activatedAt} active={!!box.activatedAt} />
          <TimelineRow label="Depleted (Soldout)" at={box.depletedAt} active={!!box.depletedAt} />
          <TimelineRow label="Returned to Lotto" at={box.returnedAt} active={!!box.returnedAt} />
          {box.pendingLocation && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.4)', borderRadius: 6, color: '#b45309', fontSize: '0.78rem' }}>
              ⓘ Pending move to <b>{box.pendingLocation === 'inventory' ? 'Safe' : box.pendingLocation}</b> on {fmtDate(box.pendingLocationEffectiveDate)}
            </div>
          )}
        </div>
        <div style={{ padding: '8px 4px', borderTop: '1px solid var(--border-color)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          Tickets sold: <b>{fmtNum(box.ticketsSold || 0)}</b> / {fmtNum(box.totalTickets)}
          {box.currentTicket != null && <span> · Next ticket: <b>{box.currentTicket}</b></span>}
          {box.autoSoldoutReason && <span> · Auto-soldout: {box.autoSoldoutReason}</span>}
        </div>
        <div className="lt-form-actions">
          <button className="lt-btn lt-btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
function TimelineRow({ label, at, active }) {
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString() + ' · ' + new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Not yet';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <div style={{
        width: 12, height: 12, borderRadius: '50%',
        background: active ? 'var(--brand-primary, #3d56b5)' : 'var(--border-color)',
        flexShrink: 0,
      }} />
      <div style={{ flex: 1, fontSize: '0.88rem', fontWeight: active ? 600 : 400, color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{fmtDate(at)}</div>
    </div>
  );
}

/* Receive Box Modal — two tabs:
 *   Manual: pick game + quantity (original flow)
 *   Scan:   scan each book barcode; list accumulates; running total; confirm
 *           creates all LotteryBox rows in status='inventory' (the Safe).
 */
function ReceiveBoxModal({ games, onSave, onClose }) {
  const [mode, setMode] = useState('scan');   // default to the faster flow
  return (
    <div className="lt-modal-overlay">
      <div className="lt-modal lt-modal-lg">
        <div className="lt-modal-header">
          <h3 className="lt-modal-title">Receive Ticket Order</h3>
          <button className="lt-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="lt-receive-tabs">
          <button
            type="button"
            className={`lt-receive-tab ${mode === 'scan' ? 'lt-receive-tab--active' : ''}`}
            onClick={() => setMode('scan')}
          >
            <ScanLine size={14} /> Scan Books
          </button>
          <button
            type="button"
            className={`lt-receive-tab ${mode === 'manual' ? 'lt-receive-tab--active' : ''}`}
            onClick={() => setMode('manual')}
          >
            Manual Entry
          </button>
        </div>
        {mode === 'scan' ? (
          <ReceiveScanTab games={games} onSave={onSave} onClose={onClose} />
        ) : (
          <ReceiveManualTab games={games} onSave={onSave} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

/* Manual-entry tab (original simple form). */
function ReceiveManualTab({ games, onSave, onClose }) {
  const [gameId, setGameId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [startTicket, setStartTicket] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!gameId) { setErr('Select a game.'); return; }
    setSaving(true); setErr('');
    try { await onSave({ gameId, quantity: Number(quantity), startTicket: startTicket || undefined }); }
    catch (e) { setErr(e.response?.data?.error || e.message); }
    setSaving(false);
  };
  return (
    <>
      {err && <div className="lt-error">{err}</div>}
      <div className="lt-field">
        <label className="lt-field-label">Game</label>
        <select className="lt-select" value={gameId} onChange={e => setGameId(e.target.value)}>
          <option value="">— Select Game —</option>
          {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div className="lt-field-row">
        <div className="lt-field">
          <label className="lt-field-label">Qty (Boxes)</label>
          <input className="lt-input" type="number" min={1} value={quantity} onChange={e => setQuantity(e.target.value)} />
        </div>
        <div className="lt-field">
          <label className="lt-field-label">Start Ticket #</label>
          <input className="lt-input" value={startTicket} onChange={e => setStartTicket(e.target.value)} placeholder="Optional" />
        </div>
      </div>
      <div className="lt-form-actions">
        <button className="lt-btn lt-btn-secondary" onClick={onClose}>Cancel</button>
        <button className="lt-btn lt-btn-primary" onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : 'Receive'}
        </button>
      </div>
    </>
  );
}

/* Scan-to-receive tab — scan each book's barcode, build a running list, confirm all. */
function ReceiveScanTab({ games, onSave, onClose }) {
  const [scanValue, setScanValue] = useState('');
  const [items, setItems]         = useState([]);   // [{ key, gameId, gameName, gameNumber, boxNumber, ticketPrice, totalTickets, value }]
  const [err, setErr]             = useState('');
  const [info, setInfo]           = useState('');
  const [saving, setSaving]       = useState(false);
  const scanRef = React.useRef(null);

  React.useEffect(() => {
    setTimeout(() => scanRef.current?.focus(), 50);
  }, []);

  const handleScan = async (rawArg) => {
    const v = String(rawArg ?? scanValue ?? '').trim();
    if (!v) return;
    setScanValue('');
    setErr(''); setInfo('');
    try {
      const res = await parseLotteryBarcode(v);
      const parsed = res?.parsed || res?.data?.parsed;   // lotteryUnwrap forgiveness
      if (!parsed || !parsed.gameNumber || !parsed.bookNumber) {
        setErr(`Barcode not recognised: ${v}`);
        return;
      }
      // Look up a matching game in the local catalog by gameNumber
      const game = games.find(g => String(g.gameNumber) === String(parsed.gameNumber));
      if (!game) {
        setErr(`Game ${parsed.gameNumber} not found in catalog. Add it to Games first, then re-scan.`);
        return;
      }
      // De-dup against the pending list (game+book unique)
      const key = `${game.id}:${parsed.bookNumber}`;
      if (items.some(it => it.key === key)) {
        setInfo(`Already added: ${game.name} — Book ${parsed.bookNumber}`);
        return;
      }
      const totalTickets = Number(game.ticketsPerBox || 150);
      const ticketPrice  = Number(game.ticketPrice   || 0);
      const value        = totalTickets * ticketPrice;
      setItems(arr => [
        ...arr,
        {
          key,
          gameId:       game.id,
          gameName:     game.name,
          gameNumber:   parsed.gameNumber,
          bookNumber:   parsed.bookNumber,
          ticketPrice,
          totalTickets,
          value,
        },
      ]);
      setInfo(`✓ Added ${game.name} — Book ${parsed.bookNumber} (${fmt(value)})`);
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Scan failed');
    } finally {
      setTimeout(() => scanRef.current?.focus(), 0);
    }
  };

  const removeItem = (key) => {
    setItems(arr => arr.filter(it => it.key !== key));
  };

  const clearAll = () => {
    if (items.length === 0) return;
    if (!window.confirm(`Clear all ${items.length} scanned book${items.length === 1 ? '' : 's'}?`)) return;
    setItems([]);
  };

  const totalValue = items.reduce((s, it) => s + it.value, 0);
  const totalCount = items.length;

  const confirm = async () => {
    if (items.length === 0) { setErr('Scan at least one book before confirming.'); return; }
    setSaving(true); setErr('');
    try {
      await onSave({
        boxes: items.map(it => ({
          gameId:     it.gameId,
          boxNumber:  it.bookNumber,
          // startTicket intentionally omitted — derived from store.sellDirection
          // on first activation via autoActivator (see Phase 3g notes).
        })),
      });
      // onSave closes the modal + reloads the Safe
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {err  && <div className="lt-error">{err}</div>}
      {info && <div className="lt-info">{info}</div>}

      <div className="lt-scan-bar">
        <ScanLine size={18} />
        <input
          ref={scanRef}
          className="lt-scan-input"
          type="text"
          placeholder="Scan the barcode on each received book…"
          value={scanValue}
          onChange={e => setScanValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleScan(scanValue); }}
        />
        <button
          type="button"
          className="lt-btn lt-btn-primary lt-scan-submit"
          onClick={() => handleScan(scanValue)}
          disabled={!scanValue.trim()}
        >
          Add
        </button>
      </div>

      <div className="lt-scan-hint">
        Scan each book you just received. Duplicates are ignored automatically.
        On Confirm, every book lands in the <strong>Safe</strong> (status=Inventory)
        and is ready to activate at EoD.
      </div>

      {items.length === 0 ? (
        <div className="lt-empty">
          <Package size={24} color="#9ca3af" />
          <div style={{ marginTop: 8, color: '#9ca3af' }}>No books scanned yet.</div>
        </div>
      ) : (
        <>
          <div className="lt-scan-list">
            <div className="lt-scan-list-head">
              <span>Game</span>
              <span>Book #</span>
              <span>Pack</span>
              <span>Value</span>
              <span></span>
            </div>
            {items.map((it, idx) => (
              <div key={it.key} className="lt-scan-list-row">
                <span>
                  <strong>{it.gameName}</strong>
                  <small style={{ display: 'block', color: '#6b7280', fontSize: '0.68rem' }}>#{it.gameNumber}</small>
                </span>
                <span style={{ fontFamily: 'monospace' }}>{it.bookNumber}</span>
                <span>{it.totalTickets} × {fmt(it.ticketPrice)}</span>
                <span style={{ fontWeight: 700, color: '#16a34a' }}>{fmt(it.value)}</span>
                <button
                  type="button"
                  className="lt-scan-remove"
                  onClick={() => removeItem(it.key)}
                  title="Remove from list"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="lt-scan-total">
            <span>
              <strong>{totalCount}</strong> book{totalCount === 1 ? '' : 's'} scanned
            </span>
            <strong className="lt-scan-total-amount">{fmt(totalValue)}</strong>
          </div>
        </>
      )}

      <div className="lt-form-actions">
        <button className="lt-btn lt-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        {items.length > 0 && (
          <button className="lt-btn lt-btn-ghost" onClick={clearAll} disabled={saving}>
            Clear all
          </button>
        )}
        <button
          className="lt-btn lt-btn-primary"
          onClick={confirm}
          disabled={saving || items.length === 0}
        >
          {saving ? 'Saving…' : `Confirm & Send to Safe (${totalCount})`}
        </button>
      </div>
    </>
  );
}

/* Catalog Ticket Form Modal */
function CatalogTicketModal({ ticket, onSave, onClose }) {
  const [form, setForm] = useState({
    name: ticket?.name || '',
    gameNumber: ticket?.gameNumber || '',
    ticketPrice: ticket?.ticketPrice || '',
    ticketsPerBook: ticket?.ticketsPerBook || 300,
    state: ticket?.state || '',
    category: ticket?.category || '',
    active: ticket?.active !== false,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) { setErr('Name is required.'); return; }
    if (!form.ticketPrice) { setErr('Ticket price is required.'); return; }
    if (!form.state) { setErr('State / Province is required.'); return; }
    setSaving(true); setErr('');
    try {
      await onSave({ ...form, ticketPrice: Number(form.ticketPrice), ticketsPerBook: Number(form.ticketsPerBook) || 300 });
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    setSaving(false);
  };

  return (
    <div className="lt-modal-overlay">
      <div className="lt-modal lt-modal-lg">
        <div className="lt-modal-header">
          <h3 className="lt-modal-title">{ticket ? 'Edit Catalog Ticket' : 'Add Catalog Ticket'}</h3>
          <button className="lt-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        {err && <div className="lt-error">{err}</div>}
        <div className="lt-field">
          <label className="lt-field-label">Ticket Name</label>
          <input className="lt-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Lucky 7s" />
        </div>
        <div className="lt-field-row">
          <div className="lt-field">
            <label className="lt-field-label">Game #</label>
            <input className="lt-input" value={form.gameNumber} onChange={e => set('gameNumber', e.target.value)} placeholder="e.g. 1234" />
          </div>
          <div className="lt-field">
            <label className="lt-field-label">Ticket Price ($)</label>
            <PriceInput className="lt-input" value={form.ticketPrice} onChange={(v) => set('ticketPrice', v)} placeholder="2.00" />
          </div>
        </div>
        <div className="lt-field-row">
          <div className="lt-field">
            <label className="lt-field-label">Tickets / Book</label>
            <input className="lt-input" type="number" value={form.ticketsPerBook} onChange={e => set('ticketsPerBook', e.target.value)} />
          </div>
          <div className="lt-field">
            <label className="lt-field-label">State / Province</label>
            <select className="lt-select" value={form.state} onChange={e => set('state', e.target.value)}>
              <option value="">— Select —</option>
              {ALL_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="lt-field">
            <label className="lt-field-label">Category</label>
            <input className="lt-input" value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. instant" />
          </div>
        </div>
        {ticket && (
          <label className="lt-toggle-row">
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
            <div><div className="lt-toggle-label">Active</div><div className="lt-toggle-hint">Inactive tickets are hidden from stores</div></div>
          </label>
        )}
        <div className="lt-form-actions">
          <button className="lt-btn lt-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="lt-btn lt-btn-primary" onClick={submit} disabled={saving}>
            {saving ? <RefreshCw size={14} className="lt-spin" /> : <Check size={14} />} {saving ? 'Saving…' : ticket ? 'Update Ticket' : 'Add to Catalog'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Review Request Modal (admin) */
function ReviewRequestModal({ request, onDone, onClose }) {
  const [action, setAction] = useState('approved');
  const [adminNotes, setAdminNotes] = useState('');
  const [addToCatalog, setAddToCatalog] = useState(true);
  const [catalogForm, setCatalogForm] = useState({
    name: request.name || '',
    gameNumber: request.gameNumber || '',
    ticketPrice: request.ticketPrice || '',
    ticketsPerBook: request.ticketsPerBook || 300,
    state: request.state || '',
    category: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const setCF = (k, v) => setCatalogForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true); setErr('');
    try {
      await onDone(request.id, {
        status: action,
        adminNotes,
        addToCatalog: action === 'approved' && addToCatalog,
        catalogData: action === 'approved' && addToCatalog ? { ...catalogForm, ticketPrice: Number(catalogForm.ticketPrice), ticketsPerBook: Number(catalogForm.ticketsPerBook) } : null,
      });
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    setSaving(false);
  };

  return (
    <div className="lt-modal-overlay">
      <div className="lt-modal lt-modal-lg">
        <div className="lt-modal-header">
          <h3 className="lt-modal-title">Review Ticket Request</h3>
          <button className="lt-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.85rem' }}>
          <strong style={{ color: 'var(--text-primary)' }}>{request.name}</strong>
          {request.gameNumber && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>#{request.gameNumber}</span>}
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {request.storeName && <span>Store: {request.storeName} · </span>}
            {request.state && <span>State: {request.state} · </span>}
            {request.ticketPrice && <span>${Number(request.ticketPrice).toFixed(2)} · </span>}
            {request.ticketsPerBook && <span>{request.ticketsPerBook} tix/book</span>}
            {request.notes && <div style={{ marginTop: 4 }}>Notes: {request.notes}</div>}
          </div>
        </div>
        {err && <div className="lt-error">{err}</div>}

        <div className="lt-field">
          <label className="lt-field-label">Decision</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['approved', 'rejected'].map(a => (
              <button key={a} onClick={() => setAction(a)} className={`lt-btn lt-btn-sm ${action === a ? (a === 'approved' ? 'lt-btn-success' : 'lt-btn-danger') : 'lt-btn-ghost'}`} style={{ flex: 1, textTransform: 'capitalize' }}>
                {a}
              </button>
            ))}
          </div>
        </div>

        {action === 'approved' && (
          <label className="lt-toggle-row">
            <input type="checkbox" checked={addToCatalog} onChange={e => setAddToCatalog(e.target.checked)} />
            <div><div className="lt-toggle-label">Also add to Ticket Catalog</div><div className="lt-toggle-hint">Makes it available to all stores in the state</div></div>
          </label>
        )}

        {action === 'approved' && addToCatalog && (
          <div style={{ padding: '1rem', background: 'var(--brand-05)', border: '1px solid var(--brand-15)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-primary)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Catalog Entry Details</div>
            <div className="lt-field-row">
              <div className="lt-field">
                <label className="lt-field-label">Name</label>
                <input className="lt-input" value={catalogForm.name} onChange={e => setCF('name', e.target.value)} />
              </div>
              <div className="lt-field">
                <label className="lt-field-label">Game #</label>
                <input className="lt-input" value={catalogForm.gameNumber} onChange={e => setCF('gameNumber', e.target.value)} />
              </div>
            </div>
            <div className="lt-field-row">
              <div className="lt-field">
                <label className="lt-field-label">Price ($)</label>
                <PriceInput className="lt-input" value={catalogForm.ticketPrice} onChange={(v) => setCF('ticketPrice', v)} />
              </div>
              <div className="lt-field">
                <label className="lt-field-label">Tickets/Book</label>
                <input className="lt-input" type="number" value={catalogForm.ticketsPerBook} onChange={e => setCF('ticketsPerBook', e.target.value)} />
              </div>
              <div className="lt-field">
                <label className="lt-field-label">State</label>
                <select className="lt-select" value={catalogForm.state} onChange={e => setCF('state', e.target.value)}>
                  <option value="">— Select —</option>
                  {ALL_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        <div className="lt-field">
          <label className="lt-field-label">Admin Notes (optional)</label>
          <input className="lt-input" value={adminNotes} onChange={e => setAdminNotes(e.target.value)} placeholder="Message to the store" />
        </div>
        <div className="lt-form-actions">
          <button className="lt-btn lt-btn-secondary" onClick={onClose}>Cancel</button>
          <button className={`lt-btn ${action === 'approved' ? 'lt-btn-success' : 'lt-btn-danger'}`} onClick={submit} disabled={saving}>
            {saving ? <RefreshCw size={14} className="lt-spin" /> : <Check size={14} />}
            {saving ? 'Saving…' : action === 'approved' ? 'Approve' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Submit Request Modal (store) */
function SubmitRequestModal({ storeState, onSave, onClose }) {
  const [form, setForm] = useState({ name: '', gameNumber: '', ticketPrice: '', ticketsPerBook: '', state: storeState || '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const submit = async () => {
    if (!form.name.trim()) { setErr('Name is required.'); return; }
    setSaving(true); setErr('');
    try { await onSave({ ...form, ticketPrice: form.ticketPrice ? Number(form.ticketPrice) : null, ticketsPerBook: form.ticketsPerBook ? Number(form.ticketsPerBook) : null }); }
    catch (e) { setErr(e.response?.data?.error || e.message); }
    setSaving(false);
  };
  return (
    <div className="lt-modal-overlay">
      <div className="lt-modal">
        <div className="lt-modal-header">
          <h3 className="lt-modal-title">Submit Ticket Request</h3>
          <button className="lt-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Can't find a ticket in the catalog? Submit a request and our admin will review and add it.
        </div>
        {err && <div className="lt-error">{err}</div>}
        <div className="lt-field">
          <label className="lt-field-label">Ticket Name *</label>
          <input className="lt-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Lucky 7s" autoFocus />
        </div>
        <div className="lt-field-row">
          <div className="lt-field">
            <label className="lt-field-label">Game # (if known)</label>
            <input className="lt-input" value={form.gameNumber} onChange={e => set('gameNumber', e.target.value)} placeholder="e.g. 1234" />
          </div>
          <div className="lt-field">
            <label className="lt-field-label">Price ($)</label>
            <PriceInput className="lt-input" value={form.ticketPrice} onChange={(v) => set('ticketPrice', v)} placeholder="2.00" />
          </div>
        </div>
        <div className="lt-field-row">
          <div className="lt-field">
            <label className="lt-field-label">Tickets / Book</label>
            <input className="lt-input" type="number" value={form.ticketsPerBook} onChange={e => set('ticketsPerBook', e.target.value)} placeholder="300" />
          </div>
          <div className="lt-field">
            <label className="lt-field-label">State</label>
            <select className="lt-select" value={form.state} onChange={e => set('state', e.target.value)}>
              <option value="">— Select —</option>
              {ALL_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="lt-field">
          <label className="lt-field-label">Notes (optional)</label>
          <input className="lt-input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any extra info for the admin" />
        </div>
        <div className="lt-form-actions">
          <button className="lt-btn lt-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="lt-btn lt-btn-primary" onClick={submit} disabled={saving}>
            {saving ? <RefreshCw size={14} className="lt-spin" /> : <Bell size={14} />}
            {saving ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   RECEIVE ORDER TAB  — catalog-based inventory receiving
══════════════════════════════════════════════════════════════════════════ */
function ReceiveOrderTab({ storeSettings, onReloadBoxes }) {
  const [catalog, setCatalog] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [qtys, setQtys] = useState({});   // { [catalogTicketId]: qty }
  const [receiving, setReceiving] = useState({});   // { [catalogTicketId]: bool }
  const [received, setReceived] = useState({});   // { [catalogTicketId]: bool }
  const [requestModal, setRequestModal] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [err, setErr] = useState('');

  const storeState = storeSettings?.state;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cat, reqs] = await Promise.all([
        getLotteryCatalog(),
        getLotteryTicketRequests(),
      ]);
      setCatalog(Array.isArray(cat) ? cat : []);
      setRequests(Array.isArray(reqs) ? reqs : []);
    } catch { setCatalog([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = catalog.filter(t => {
    const q = search.toLowerCase();
    return !q || t.name.toLowerCase().includes(q) || (t.gameNumber || '').toLowerCase().includes(q);
  });

  const setQty = (id, val) => setQtys(q => ({ ...q, [id]: Math.max(1, Number(val) || 1) }));

  const handleReceive = async (ticket) => {
    const qty = qtys[ticket.id] || 1;
    setReceiving(r => ({ ...r, [ticket.id]: true }));
    setErr('');
    try {
      await receiveFromLotteryCatalog({ catalogTicketId: ticket.id, qty });
      setReceived(r => ({ ...r, [ticket.id]: true }));
      onReloadBoxes();
      setTimeout(() => setReceived(r => { const n = { ...r }; delete n[ticket.id]; return n; }), 3000);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
    setReceiving(r => { const n = { ...r }; delete n[ticket.id]; return n; });
  };

  const handleSubmitRequest = async (data) => {
    await createLotteryTicketRequest(data);
    setRequestModal(false);
    load();
  };

  if (loading) return <div className="lt-loading"><RefreshCw size={16} className="lt-spin" /> Loading catalog…</div>;

  return (
    <div>
      {/* State banner */}
      {storeState ? (
        <div className="lt-receive-state-banner">
          <MapPin size={14} />
          Showing tickets for <strong style={{ marginLeft: 4 }}>{storeState}</strong>
          <span style={{ marginLeft: 'auto', fontSize: '0.75rem', opacity: 0.7 }}>{filtered.length} tickets available</span>
        </div>
      ) : (
        <div className="lt-no-state-banner">
          <AlertCircle size={16} />
          Your store state is not set. Go to <strong style={{ margin: '0 4px' }}>Settings</strong> to configure it, then you'll see only your state's tickets here.
        </div>
      )}

      {/* Search */}
      <div className="lt-filter-bar">
        <div className="lt-filter-input-wrap">
          <Search size={13} className="lt-filter-input-icon" />
          <input className="lt-filter-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by ticket name or game #…" />
        </div>
        <button className="lt-btn lt-btn-secondary lt-btn-sm" onClick={() => setShowRequests(s => !s)}>
          <Bell size={13} /> My Requests {requests.length > 0 && `(${requests.length})`}
        </button>
      </div>

      {err && <div className="lt-error">{err}</div>}

      {/* Catalog list */}
      {filtered.length === 0 ? (
        <div className="lt-empty">
          <BookOpen size={32} />
          <p>No tickets found{storeState ? ` for ${storeState}` : ''}.</p>
          <p style={{ fontSize: '0.8rem', marginTop: 4 }}>Can't find a ticket? Submit a request below.</p>
        </div>
      ) : (
        <div className="lt-card lt-receive-list">
          {filtered.map(ticket => (
            <div key={ticket.id} className="lt-receive-row">
              <div className="lt-receive-icon"><Ticket size={16} /></div>
              <div className="lt-receive-info">
                <div className="lt-receive-name">{ticket.name}</div>
                <div className="lt-receive-meta">
                  {ticket.gameNumber && <span>Game #{ticket.gameNumber}</span>}
                  <span>{fmtNum(ticket.ticketsPerBook)} tickets/book</span>
                  {ticket.category && <Badge label={ticket.category} cls="lt-badge-gray" />}
                  <Badge label={ticket.state} cls="lt-badge-blue" />
                </div>
              </div>
              <div className="lt-receive-price">{fmt(ticket.ticketPrice)}</div>
              <div className="lt-receive-qty-wrap">
                <button className="lt-qty-btn" onClick={() => setQty(ticket.id, (qtys[ticket.id] || 1) - 1)}>−</button>
                <input
                  className="lt-qty-input"
                  type="number"
                  min={1}
                  value={qtys[ticket.id] || 1}
                  onChange={e => setQty(ticket.id, e.target.value)}
                />
                <button className="lt-qty-btn" onClick={() => setQty(ticket.id, (qtys[ticket.id] || 1) + 1)}>+</button>
              </div>
              {received[ticket.id] ? (
                <button className="lt-btn lt-btn-success lt-btn-sm" disabled>
                  <Check size={13} /> Received!
                </button>
              ) : (
                <button
                  className="lt-btn lt-btn-primary lt-btn-sm"
                  onClick={() => handleReceive(ticket)}
                  disabled={!!receiving[ticket.id]}
                >
                  {receiving[ticket.id] ? <RefreshCw size={13} className="lt-spin" /> : <Package size={13} />}
                  {receiving[ticket.id] ? 'Adding…' : `Receive ${qtys[ticket.id] || 1}`}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Submit request CTA */}
      <div className="lt-request-cta">
        <div className="lt-request-cta-text">
          <strong>Can't find a ticket?</strong> Submit a request and the admin will review it and add it to the catalog.
        </div>
        <button className="lt-btn lt-btn-secondary" onClick={() => setRequestModal(true)}>
          <Plus size={14} /> Submit Request
        </button>
      </div>

      {/* My requests accordion */}
      {showRequests && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="lt-pending-header">
            <h4 className="lt-pending-title">My Requests</h4>
          </div>
          {requests.length === 0 ? (
            <div className="lt-empty" style={{ padding: '2rem' }}><p>No requests submitted yet.</p></div>
          ) : (
            requests.map(r => (
              <div key={r.id} className="lt-card lt-request-card">
                <div className="lt-request-card-header">
                  <div>
                    <div className="lt-request-name">{r.name}</div>
                    <div className="lt-request-meta">
                      {r.gameNumber && <>#{r.gameNumber} · </>}
                      {r.ticketPrice && <>{fmt(r.ticketPrice)} · </>}
                      {r.state && <>{r.state} · </>}
                      {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Badge label={r.status} cls={requestStatusClass(r.status)} />
                </div>
                {r.notes && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Notes: {r.notes}</div>}
                {r.adminNotes && <div className="lt-request-admin-note">Admin: {r.adminNotes}</div>}
              </div>
            ))
          )}
        </div>
      )}

      {requestModal && (
        <SubmitRequestModal
          storeState={storeState}
          onSave={handleSubmitRequest}
          onClose={() => setRequestModal(false)}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TICKET CATALOG TAB  (admin / superadmin only)
══════════════════════════════════════════════════════════════════════════ */
function TicketCatalogTab() {
  const [catalog, setCatalog] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState('');
  const [search, setSearch] = useState('');
  const [editTicket, setEditTicket] = useState(null);  // null | 'new' | ticketObj
  const [reviewReq, setReviewReq] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cat, reqs] = await Promise.all([
        getAllLotteryCatalog(),
        getLotteryTicketRequests({ status: 'pending' }),
      ]);
      setCatalog(Array.isArray(cat) ? cat : []);
      setRequests(Array.isArray(reqs) ? reqs : []);
    } catch { setCatalog([]); setRequests([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const usedStates = [...new Set(catalog.map(t => t.state))].sort();

  const filtered = catalog.filter(t => {
    const matchState = !stateFilter || t.state === stateFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || t.name.toLowerCase().includes(q) || (t.gameNumber || '').toLowerCase().includes(q);
    return matchState && matchSearch;
  });

  const handleSaveCatalog = async (data) => {
    if (editTicket && editTicket !== 'new') {
      await updateLotteryCatalogTicket(editTicket.id, data);
    } else {
      await createLotteryCatalogTicket(data);
    }
    setEditTicket(null);
    load();
  };

  const handleDeactivate = async (ticket) => {
    if (!window.confirm(`${ticket.active ? 'Deactivate' : 'Reactivate'} "${ticket.name}"?`)) return;
    await updateLotteryCatalogTicket(ticket.id, { active: !ticket.active });
    load();
  };

  const handleReviewDone = async (id, data) => {
    await reviewLotteryTicketRequest(id, data);
    setReviewReq(null);
    load();
  };

  if (loading) return <div className="lt-loading"><RefreshCw size={16} className="lt-spin" /> Loading catalog…</div>;

  return (
    <div>
      {/* Catalog section */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-heading)' }}>Ticket Catalog</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>State-scoped tickets available to stores when receiving inventory</div>
        </div>
        <button className="lt-btn lt-btn-primary" onClick={() => setEditTicket('new')}>
          <Plus size={14} /> Add Ticket
        </button>
      </div>

      {/* Filters */}
      <div className="lt-filter-bar">
        <div className="lt-filter-input-wrap">
          <Search size={13} className="lt-filter-input-icon" />
          <input className="lt-filter-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or game #…" />
        </div>
        <button className={`lt-filter-chip ${!stateFilter ? 'active' : ''}`} onClick={() => setStateFilter('')}>All</button>
        {usedStates.map(s => (
          <button key={s} className={`lt-filter-chip ${stateFilter === s ? 'active' : ''}`} onClick={() => setStateFilter(s)}>{s}</button>
        ))}
      </div>

      {err && <div className="lt-error">{err}</div>}

      {/* Catalog grid */}
      {filtered.length === 0 ? (
        <div className="lt-empty">
          <Ticket size={32} />
          <p>No catalog tickets yet.</p>
          <p style={{ fontSize: '0.8rem' }}>Click "Add Ticket" to create the first one for a state.</p>
        </div>
      ) : (
        <div className="lt-catalog-grid">
          {filtered.map(ticket => (
            <div key={ticket.id} className={`lt-card lt-catalog-card ${ticket.active ? '' : 'inactive'}`}>
              <div className="lt-catalog-card-top">
                <div className="lt-catalog-icon"><Ticket size={16} /></div>
                <div className="lt-catalog-actions">
                  <button className="lt-btn lt-btn-icon" title="Edit" onClick={() => setEditTicket(ticket)}><Edit2 size={13} /></button>
                  <button className={`lt-btn lt-btn-icon ${ticket.active ? 'lt-btn-icon-red' : ''}`} title={ticket.active ? 'Deactivate' : 'Reactivate'} onClick={() => handleDeactivate(ticket)}>
                    {ticket.active ? <Trash2 size={13} /> : <Check size={13} />}
                  </button>
                </div>
              </div>
              <div className="lt-catalog-name">{ticket.name}</div>
              <div className="lt-catalog-meta">
                <Badge label={ticket.state} cls="lt-badge-blue" />
                {ticket.gameNumber && <Badge label={`#${ticket.gameNumber}`} cls="lt-badge-gray" />}
                {ticket.category && <Badge label={ticket.category} cls="lt-badge-purple" />}
                {!ticket.active && <Badge label="Inactive" cls="lt-badge-red" />}
              </div>
              <div className="lt-catalog-price">{fmt(ticket.ticketPrice)}</div>
              <div className="lt-catalog-details">{fmtNum(ticket.ticketsPerBook)} tickets per book</div>
            </div>
          ))}
        </div>
      )}

      {/* Pending Requests section */}
      <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '2px solid var(--border-color)' }}>
        <div className="lt-pending-header">
          <h4 className="lt-pending-title">Store Ticket Requests</h4>
          {requests.length > 0 && <span className="lt-tab-badge">{requests.length}</span>}
        </div>
        {requests.length === 0 ? (
          <div className="lt-empty" style={{ padding: '2rem' }}>
            <Bell size={28} />
            <p>No pending requests from stores.</p>
          </div>
        ) : (
          requests.map(r => (
            <div key={r.id} className="lt-card lt-pending-card">
              <div className="lt-pending-card-header">
                <div>
                  <div className="lt-pending-name">{r.name}</div>
                  {r.storeName && <div className="lt-pending-store">From: {r.storeName}</div>}
                  <div className="lt-pending-details">
                    {r.gameNumber && <>#{r.gameNumber} · </>}
                    {r.ticketPrice && <>{fmt(r.ticketPrice)} · </>}
                    {r.ticketsPerBook && <>{r.ticketsPerBook} tix/book · </>}
                    {r.state && <>{r.state} · </>}
                    {new Date(r.createdAt).toLocaleDateString()}
                    {r.notes && <div style={{ marginTop: 4, color: 'var(--text-muted)' }}>"{r.notes}"</div>}
                  </div>
                </div>
                <div className="lt-pending-actions">
                  <Badge label={r.status} cls={requestStatusClass(r.status)} />
                  {r.status === 'pending' && (
                    <button className="lt-btn lt-btn-primary lt-btn-sm" onClick={() => setReviewReq(r)}>
                      Review
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modals */}
      {editTicket && (
        <CatalogTicketModal
          ticket={editTicket === 'new' ? null : editTicket}
          onSave={handleSaveCatalog}
          onClose={() => setEditTicket(null)}
        />
      )}
      {reviewReq && (
        <ReviewRequestModal
          request={reviewReq}
          onDone={handleReviewDone}
          onClose={() => setReviewReq(null)}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════════════════ */
// Default export is a thin gate — hooks-rule-safe. Only the gate hook runs
// until we decide whether to mount the full page body.
export default function Lottery() {
  const { modules, loading } = useStoreModules();
  if (loading) return null;
  if (!modules.lottery) {
    return (
      <ModuleDisabled
        icon={Ticket}
        title="Lottery module is disabled for this store"
        description="Enable the Lottery module in Store Settings to manage ticket sales, inventory, shift reconciliation, and commission reports."
      />
    );
  }
  return <LotteryBody />;
}

function LotteryBody() {
  // Role check for admin-only tabs
  const user = (() => { try { return JSON.parse(localStorage.getItem('user')) || {}; } catch { return {}; } })();
  const isAdmin = ['superadmin', 'admin'].includes(user.role);

  // 3e — removed Games (admin-managed), Receive Order (duplicate), Daily Scan
  // (nested wizard was redundant). Receive is now a one-click action in the
  // Counter tab; Online Sales is its own top-level tab.
  const TABS = [
    'Overview',
    ...(isAdmin ? ['Ticket Catalog'] : []),
    'Counter',
    'Safe',
    'Soldout',
    'Returned',
    'Online Sales',
    'Shift Reports',
    'Weekly Settlement',
    'Reports',
    'Commission',
    'Settings',
  ];

  // Maps display tab name → LotteryBox.status value
  const TAB_STATUS = { Counter: 'active', Safe: 'inventory', Soldout: 'depleted', Returned: 'returned' };

  const [tab, setTab] = useState('Overview');
  const [games, setGames] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [shiftReports, setShiftReports] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [report, setReport] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [commission, setCommission] = useState(null);
  const [reportPeriod, setReportPeriod] = useState('week');
  const [loading, setLoading] = useState(false);
  const [gameModal, setGameModal] = useState(null);
  const [receiveModal, setReceiveModal] = useState(false);
  const [activateBoxObj, setActivateBoxObj] = useState(null);
  const [moveToSafeBox, setMoveToSafeBox] = useState(null);
  const [returnToLottoBox, setReturnToLottoBox] = useState(null);
  const [timelineBox, setTimelineBox] = useState(null);
  const [boxFilter, setBoxFilter] = useState('All');
  // 3e — date filter for Soldout / Returned tabs (by depletedAt / returnedAt)
  const [boxDateFilter, setBoxDateFilter] = useState('');
  const [pendingCount, setPendingCount] = useState(0);

  // Date range for reports
  const [dateFrom, setDateFrom] = useState(daysAgoStr(30));
  const [dateTo, setDateTo] = useState(todayStr());
  const [datePreset, setDatePreset] = useState('Custom');

  // Settings
  const [lotterySettings, setLotterySettings] = useState(null);
  const [settingsForm, setSettingsForm] = useState({ enabled: true, cashOnly: false, state: '', commissionRate: '', scanRequiredAtShiftEnd: false });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');

  /* ── Loaders ──────────────────────────────────────────────────────────── */
  const loadGames = useCallback(async () => {
    try { const r = await getLotteryGames(); setGames(Array.isArray(r) ? r : r?.games || []); } catch { }
  }, []);

  const loadBoxes = useCallback(async (status) => {
    try { const r = await getLotteryBoxes(status && status !== 'All' ? { status } : {}); setBoxes(Array.isArray(r) ? r : r?.boxes || []); } catch { }
  }, []);

  const loadShiftReports = useCallback(async () => {
    try { const r = await getLotteryShiftReports(); setShiftReports(Array.isArray(r) ? r : r?.reports || []); } catch { }
  }, []);

  const loadDashboard = useCallback(async () => {
    try { const r = await getLotteryDashboard(); setDashboard(r); } catch { }
  }, []);

  const loadReport = useCallback(async (from, to) => {
    try {
      const params = { period: reportPeriod };
      if (from) params.from = from;
      if (to) params.to = to;
      const r = await getLotteryReport(params);
      setReport(r); setReportData(r);
    } catch { }
  }, [reportPeriod]);

  const loadCommission = useCallback(async () => {
    try { const r = await getLotteryCommissionReport({ period: reportPeriod }); setCommission(r); } catch { }
  }, [reportPeriod]);

  const loadSettings = useCallback(async () => {
    try {
      const r = await getLotterySettings(localStorage.getItem('activeStoreId'));
      if (r) {
        setLotterySettings(r);
        setSettingsForm({
          enabled: r.enabled ?? true,
          cashOnly: r.cashOnly ?? false,
          state: r.state || '',
          commissionRate: r.commissionRate != null ? (Number(r.commissionRate) * 100).toFixed(2) : '',
          scanRequiredAtShiftEnd: r.scanRequiredAtShiftEnd ?? false,
        });
      }
    } catch { }
  }, []);

  const loadPendingCount = useCallback(async () => {
    if (!isAdmin) return;
    try { const c = await getLotteryPendingCount(); setPendingCount(c || 0); } catch { }
  }, [isAdmin]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadGames(), loadDashboard(), loadSettings(), loadShiftReports(), loadPendingCount()])
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line

  useEffect(() => {
    if (TAB_STATUS[tab]) loadBoxes(TAB_STATUS[tab]);
    if (tab === 'Shift Reports') loadShiftReports();
    if (tab === 'Reports') loadReport(dateFrom, dateTo);
    if (tab === 'Commission') loadCommission();
    if (tab === 'Settings') loadSettings();
    if (tab === 'Ticket Catalog') loadPendingCount();
  }, [tab, reportPeriod]); // eslint-disable-line

  /* ── Date presets ─────────────────────────────────────────────────────── */
  const applyPreset = (preset) => {
    setDatePreset(preset);
    const today = new Date();
    let from, to;
    if (preset === 'Today') {
      from = todayStr(); to = todayStr();
    } else if (preset === 'This Week') {
      const start = new Date(today); start.setDate(today.getDate() - today.getDay());
      from = toDateStr(start); to = todayStr();
    } else if (preset === 'This Month') {
      from = toDateStr(new Date(today.getFullYear(), today.getMonth(), 1)); to = todayStr();
    } else if (preset === 'Last Month') {
      from = toDateStr(new Date(today.getFullYear(), today.getMonth() - 1, 1));
      to = toDateStr(new Date(today.getFullYear(), today.getMonth(), 0));
    } else { return; }
    setDateFrom(from); setDateTo(to);
    loadReport(from, to);
  };

  /* ── Settings save ────────────────────────────────────────────────────── */
  const handleSaveSettings = async () => {
    setSettingsSaving(true); setSettingsMsg('');
    try {
      const payload = { ...settingsForm, commissionRate: settingsForm.commissionRate !== '' ? Number(settingsForm.commissionRate) / 100 : null };
      const updated = await updateLotterySettings(localStorage.getItem('activeStoreId'), payload);
      setLotterySettings(updated || payload);
      setSettingsMsg('Settings saved successfully.');
    } catch (e) {
      setSettingsMsg('Error: ' + (e.response?.data?.error || e.message));
    }
    setSettingsSaving(false);
  };

  /* ── CSV Download ─────────────────────────────────────────────────────── */
  const downloadReportCSV = () => {
    if (!reportData) return;
    const rows = [['Date', 'Sales', 'Payouts', 'Net'], ...(reportData.chart || []).map(d => [d.date, d.sales?.toFixed(2), d.payouts?.toFixed(2), d.net?.toFixed(2)])];
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `lottery-${dateFrom}-${dateTo}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  };

  /* ── Game actions ─────────────────────────────────────────────────────── */
  const handleSaveGame = async (data) => {
    if (gameModal && gameModal !== 'new') { await updateLotteryGame(gameModal.id, data); }
    else { await createLotteryGame(data); }
    setGameModal(null); loadGames();
  };
  const handleDeleteGame = async (id) => {
    if (!window.confirm('Delete this game?')) return;
    await deleteLotteryGame(id); loadGames();
  };

  /* ── Box actions ──────────────────────────────────────────────────────── */
  const reloadCurrentTab = () => {
    const s = TAB_STATUS[tab];
    loadBoxes(s || boxFilter);
  };

  const handleReceive = async (data) => {
    await receiveLotteryBoxOrder(data);
    setReceiveModal(false); reloadCurrentTab();
  };
  const handleActivateBox = async (id, payload) => {
    // payload: { slotNumber?, date?, currentTicket? }
    await activateLotteryBox(id, payload);
    setActivateBoxObj(null);
    reloadCurrentTab();
  };
  const handleMoveToSafe = async (id, payload) => {
    await moveLotteryBoxToSafe(id, payload); // { date? }
    setMoveToSafeBox(null);
    reloadCurrentTab();
  };
  const handleReturnToLotto = async (id, payload) => {
    await returnLotteryBoxToLotto(id, payload); // { reason? }
    setReturnToLottoBox(null);
    reloadCurrentTab();
  };
  const handleSoldout = async (id) => {
    if (!window.confirm('Mark this book as Soldout? It will be settled in the next weekly report.')) return;
    await soldoutLotteryBox(id, { reason: 'manual' });
    reloadCurrentTab();
  };
  const handleCancelPending = async (id) => {
    if (!window.confirm('Cancel the scheduled move for this book?')) return;
    await cancelLotteryPendingMove(id);
    reloadCurrentTab();
  };

  /* ── 3e — derived view of `boxes` for the active tab ─────────────────── */
  // Counter tab: sort by totalValue descending (highest $/book first).
  // Soldout tab: filter to books depleted on the selected date (if any).
  // Returned tab: filter to books returned on the selected date (if any).
  // Safe tab: no extra filtering; created-order.
  const filteredTabBoxes = React.useMemo(() => {
    let list = Array.isArray(boxes) ? [...boxes] : [];
    if (tab === 'Counter') {
      list.sort((a, b) => Number(b.totalValue || 0) - Number(a.totalValue || 0));
    } else if (tab === 'Soldout' && boxDateFilter) {
      list = list.filter(b => {
        if (!b.depletedAt) return false;
        return b.depletedAt.slice(0, 10) === boxDateFilter;
      });
    } else if (tab === 'Returned' && boxDateFilter) {
      list = list.filter(b => {
        if (!b.returnedAt) return false;
        return b.returnedAt.slice(0, 10) === boxDateFilter;
      });
    }
    return list;
  }, [boxes, tab, boxDateFilter]);

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div className="p-page lt-page">

      {/* Header */}
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><Ticket size={22} /></div>
          <div>
            <h1 className="p-title">Lottery</h1>
            <p className="p-subtitle">Ticket inventory, sales tracking & commission reports</p>
          </div>
        </div>
        <div className="p-header-actions">
          {/* Games are managed by superadmin (Admin → Lottery → Ticket Catalog). */}
          {(TAB_STATUS[tab] !== undefined) && (
            <button className="lt-btn lt-btn-primary" onClick={() => setReceiveModal(true)}>
              <Package size={15} /> Receive Books
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="lt-tabs">
        {TABS.map(t => (
          <button key={t} className={`lt-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
            {t === 'Ticket Catalog' && pendingCount > 0 && <span className="lt-tab-badge">{pendingCount}</span>}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
      {tab === 'Overview' && (
        <div>
          <div className="lt-stat-grid">
            <StatCard label="Total Sales (Month)" value={fmt(dashboard?.totalSales)} color="var(--accent-primary)" />
            <StatCard label="Total Payouts" value={fmt(dashboard?.totalPayouts)} color="#d97706" />
            <StatCard label="Net Revenue" value={fmt(dashboard?.netRevenue)} color="#2563eb" />
            <StatCard label="Commission Earned" value={fmt(dashboard?.commission)} color="#7c3aed" />
            <StatCard label="Active Boxes" value={fmtNum(dashboard?.activeBoxes)} sub="in machine now" />
            <StatCard label="Inventory Boxes" value={fmtNum(dashboard?.inventoryBoxes)} sub="in storage" />
          </div>
          <div className="lt-grid-2" style={{ gap: '1.25rem' }}>
            <div className="lt-card">
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Active Games</div>
              {games.filter(g => g.active).length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>No active games.</p>}
              {games.filter(g => g.active).map(g => (
                <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-color)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{g.name}</div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{fmtNum(g.ticketsPerBox)} tickets · {fmt(g.ticketPrice)}</div>
                  </div>
                  <Badge label="Active" cls="lt-badge-brand" />
                </div>
              ))}
            </div>
            <div className="lt-card">
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Recent Shift Reports</div>
              {shiftReports.slice(0, 5).length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>No shift reports yet.</p>}
              {shiftReports.slice(0, 5).map(r => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{new Date(r.closedAt || r.createdAt).toLocaleDateString()}</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: Math.abs(Number(r.variance || 0)) < 0.01 ? 'var(--success)' : '#d97706' }}>
                    {r.variance >= 0 ? '+' : ''}{fmt(r.variance)} var
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── WEEKLY SETTLEMENT (Phase 2) ──────────────────────────────── */}
      {tab === 'Weekly Settlement' && <LotteryWeeklySettlement />}

      {/* ── TICKET CATALOG (admin only) ──────────────────────────────── */}
      {tab === 'Ticket Catalog' && <TicketCatalogTab />}

      {/* ── ONLINE SALES (3e) — daily instant cashing + machine sales + machine cashing entry */}
      {tab === 'Online Sales' && <LotteryDailyScan />}

      {/* ── COUNTER / SAFE / SOLDOUT / RETURNED (unified table) ─────── */}
      {TAB_STATUS[tab] !== undefined && (
        <div>
          {/* 3e — date filter on tabs where it makes sense + sort by ticket value */}
          {(tab === 'Soldout' || tab === 'Returned') && (
            <div className="lt-filter-bar" style={{ marginBottom: 10 }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, marginRight: 6 }}>
                {tab === 'Soldout' ? 'Depleted on' : 'Returned on'}
              </label>
              <input
                type="date"
                className="lt-input"
                style={{ maxWidth: 180 }}
                value={boxDateFilter}
                onChange={e => setBoxDateFilter(e.target.value)}
              />
              {boxDateFilter && (
                <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={() => setBoxDateFilter('')}>Clear</button>
              )}
              <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {filteredTabBoxes.length} / {boxes.length} book{boxes.length === 1 ? '' : 's'}
              </span>
            </div>
          )}
          {tab === 'Counter' && (
            <div className="lt-filter-bar" style={{ marginBottom: 10 }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Sorted by highest ticket value first · {filteredTabBoxes.length} active book{filteredTabBoxes.length === 1 ? '' : 's'}
              </span>
            </div>
          )}

          <div className="lt-table-wrap">
            <table className="lt-table">
              <thead>
                <tr>{[
                  ...(tab === 'Counter' ? ['Slot'] : []),
                  'Game', 'Book #', 'Total', 'Price', 'Value', 'Sold', 'Remaining',
                  ...(tab === 'Counter' ? ['Current'] : []),
                  ...(tab === 'Safe' ? ['Received'] : []),
                  ...(tab === 'Soldout' ? ['Depleted'] : []),
                  ...(tab === 'Returned' ? ['Returned'] : []),
                  'Actions',
                ].map(h => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {filteredTabBoxes.length === 0 && (
                  <tr>
                    <td colSpan={tab === 'Counter' ? 10 : 9} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      {tab === 'Counter' && 'No books are currently on the counter. Activate a book from Safe.'}
                      {tab === 'Safe' && 'Safe is empty. Receive an order to add books.'}
                      {tab === 'Soldout' && (boxDateFilter ? `No books soldout on ${boxDateFilter}.` : 'No soldout books yet.')}
                      {tab === 'Returned' && (boxDateFilter ? `No books returned on ${boxDateFilter}.` : 'No books have been returned to lottery.')}
                    </td>
                  </tr>
                )}
                {filteredTabBoxes.map(b => {
                  const remaining = Math.max(0, (b.totalTickets || 0) - (b.ticketsSold || 0));
                  const hasPending = !!b.pendingLocation;
                  const fmtCell = (d) => d ? new Date(d).toLocaleDateString() : '—';
                  return (
                    <tr key={b.id} className={hasPending ? 'lt-row-pending' : ''}>
                      {tab === 'Counter' && <td className="lt-td-strong">{b.slotNumber ?? '—'}</td>}
                      <td className="lt-td-strong">{b.game?.name || 'N/A'}</td>
                      <td>{b.boxNumber || 'N/A'}</td>
                      <td>{fmtNum(b.totalTickets)}</td>
                      <td>{fmt(b.ticketPrice)}</td>
                      <td className="lt-td-strong">{fmt(b.totalValue)}</td>
                      <td className="lt-td-small">{fmtNum(b.ticketsSold)}</td>
                      <td className="lt-td-small">{fmtNum(remaining)}</td>
                      {tab === 'Counter' && <td>{b.currentTicket ?? '—'}</td>}
                      {tab === 'Safe' && <td className="lt-td-small">{fmtCell(b.createdAt)}</td>}
                      {tab === 'Soldout' && <td className="lt-td-small">{fmtCell(b.depletedAt)}</td>}
                      {tab === 'Returned' && <td className="lt-td-small">{fmtCell(b.returnedAt)}</td>}
                      <td className="lt-td-actions">
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {/* Timeline always available */}
                          <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={() => setTimelineBox(b)} title="Book timeline">
                            ⓘ
                          </button>

                          {/* Safe-tab actions */}
                          {b.status === 'inventory' && (
                            <>
                              <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={() => setActivateBoxObj(b)}>Activate</button>
                              <button className="lt-btn lt-btn-amber lt-btn-sm" onClick={() => setReturnToLottoBox(b)}>Return</button>
                              <button className="lt-btn lt-btn-danger lt-btn-sm"
                                onClick={async () => {
                                  if (!window.confirm('Remove this book from inventory? This cannot be undone.')) return;
                                  await updateLotteryBox(b.id, { status: 'removed' });
                                  reloadCurrentTab();
                                }}>
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}

                          {/* Counter-tab actions */}
                          {b.status === 'active' && (
                            <>
                              {hasPending ? (
                                <button className="lt-btn lt-btn-secondary lt-btn-sm" onClick={() => handleCancelPending(b.id)}>
                                  Cancel Move
                                </button>
                              ) : (
                                <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={() => setMoveToSafeBox(b)}>Move to Safe</button>
                              )}
                              <button className="lt-btn lt-btn-amber lt-btn-sm" onClick={() => handleSoldout(b.id)}>Soldout</button>
                              <button className="lt-btn lt-btn-danger lt-btn-sm" onClick={() => setReturnToLottoBox(b)}>Return</button>
                            </>
                          )}

                          {/* Soldout / Returned tabs — view-only except undo-soldout for admin */}
                          {b.status === 'depleted' && (
                            <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={async () => {
                              if (!window.confirm('Re-activate this book onto the counter?')) return;
                              await updateLotteryBox(b.id, { status: 'inventory' });
                              reloadCurrentTab();
                            }}>Undo</button>
                          )}
                        </div>
                        {hasPending && (
                          <div style={{ fontSize: '0.7rem', color: '#b45309', marginTop: 3 }}>
                            → {b.pendingLocation === 'inventory' ? 'Safe' : b.pendingLocation} on {new Date(b.pendingLocationEffectiveDate).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SHIFT REPORTS ────────────────────────────────────────────── */}
      {tab === 'Shift Reports' && (() => {
        const filteredReports = shiftReports.filter(r => {
          if (!boxDateFilter) return true;
          const d = (r.closedAt || r.createdAt || '').slice(0, 10);
          return d === boxDateFilter;
        });
        return (
        <div>
          <div className="lt-filter-bar" style={{ marginBottom: 10 }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, marginRight: 6 }}>Date</label>
            <input type="date" className="lt-input" style={{ maxWidth: 180 }}
              value={boxDateFilter} onChange={e => setBoxDateFilter(e.target.value)} />
            {boxDateFilter && (
              <button className="lt-btn lt-btn-ghost lt-btn-sm" onClick={() => setBoxDateFilter('')}>Clear</button>
            )}
            <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {filteredReports.length} / {shiftReports.length} shift{shiftReports.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="lt-table-wrap">
          <table className="lt-table">
            <thead>
              <tr>{['Date / Shift', 'Sales', 'Payouts', 'Net', 'Machine', 'Digital', 'Variance', 'Notes'].map(h => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filteredReports.length === 0 && <tr><td colSpan={8} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                {boxDateFilter ? `No shift reports closed on ${boxDateFilter}.` : 'No shift reports yet.'}
              </td></tr>}
              {filteredReports.map(r => {
                const v = Number(r.variance || 0);
                const vCls = Math.abs(v) < 0.01 ? 'lt-td-green' : Math.abs(v) <= 5 ? 'lt-td-amber' : 'lt-td-red';
                return (
                  <tr key={r.id}>
                    <td className="lt-td-strong">
                      {new Date(r.closedAt || r.createdAt).toLocaleDateString()}
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{r.shiftId?.slice(-8)}</div>
                    </td>
                    <td className="lt-td-brand">{fmt(r.totalSales)}</td>
                    <td className="lt-td-amber">{fmt(r.totalPayouts)}</td>
                    <td className="lt-td-strong">{fmt(r.netAmount)}</td>
                    <td>{fmt(r.machineAmount)}</td>
                    <td>{fmt(r.digitalAmount)}</td>
                    <td className={vCls}>{v >= 0 ? '+' : ''}{fmt(v)}</td>
                    <td className="lt-td-small">{r.notes || 'N/A'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      );})()}

      {/* ── REPORTS ──────────────────────────────────────────────────── */}
      {tab === 'Reports' && (
        <div>
          <div className="lt-card" style={{ marginBottom: '1.25rem' }}>
            <div className="lt-date-controls">
              <div className="lt-field">
                <label className="lt-field-label">From</label>
                <input type="date" className="lt-input" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setDatePreset('Custom'); }} style={{ maxWidth: 160 }} />
              </div>
              <div className="lt-field">
                <label className="lt-field-label">To</label>
                <input type="date" className="lt-input" value={dateTo} onChange={e => { setDateTo(e.target.value); setDatePreset('Custom'); }} style={{ maxWidth: 160 }} />
              </div>
              <button className="lt-btn lt-btn-primary" onClick={() => loadReport(dateFrom, dateTo)}>Apply</button>
              <button className="lt-btn lt-btn-ghost" onClick={downloadReportCSV} disabled={!reportData}>⬇ Download CSV</button>
            </div>
            <div className="lt-filter-bar" style={{ marginBottom: 0 }}>
              {['Today', 'This Week', 'This Month', 'Last Month', 'Custom'].map(p => (
                <button key={p} className={`lt-filter-chip ${datePreset === p ? 'active' : ''}`} onClick={() => applyPreset(p)}>{p}</button>
              ))}
            </div>
          </div>

          {report ? (
            <>
              <div className="lt-stat-grid">
                <StatCard label="Total Sales" value={fmt(report.totalSales)} color="var(--accent-primary)" />
                <StatCard label="Total Payouts" value={fmt(report.totalPayouts)} color="#d97706" />
                <StatCard label="Net Revenue" value={fmt(report.netRevenue)} color="#2563eb" />
                <StatCard label="Transactions" value={fmtNum(report.transactionCount)} sub="sale transactions" />
              </div>
              {report.chart?.length > 0 && (
                <div className="lt-card" style={{ marginBottom: '1.25rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Daily Sales vs Payouts</div>
                  <SimpleBarChart data={report.chart} width={700} height={200} />
                </div>
              )}
              {report.byGame?.length > 0 && (
                <div className="lt-card">
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Sales by Game</div>
                  <div className="lt-table-wrap">
                    <table className="lt-table">
                      <thead><tr>{['Game', 'Sales', 'Payouts', 'Net', 'Transactions'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                      <tbody>
                        {report.byGame.map((g, i) => (
                          <tr key={i}>
                            <td className="lt-td-strong">{g.gameName || 'Unknown'}</td>
                            <td className="lt-td-brand">{fmt(g.sales)}</td>
                            <td className="lt-td-amber">{fmt(g.payouts)}</td>
                            <td className="lt-td-strong">{fmt(g.net)}</td>
                            <td>{fmtNum(g.count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="lt-empty"><p>No report data. Select a date range and click Apply.</p></div>
          )}
        </div>
      )}

      {/* ── COMMISSION ───────────────────────────────────────────────── */}
      {tab === 'Commission' && (
        <div>
          <div className="lt-commission-banner">
            <div>
              <div className="lt-commission-rate">
                💰 Commission Rate:{' '}
                {lotterySettings?.commissionRate != null ? `${(Number(lotterySettings.commissionRate) * 100).toFixed(2)}%` : 'N/A'}
              </div>
              <div className="lt-commission-hint">Store-level rate · Adjust in the Settings tab</div>
            </div>
          </div>
          <div className="lt-period-bar">
            <span className="lt-period-label">Period:</span>
            {['day', 'week', 'month'].map(p => (
              <button key={p} className={`lt-period-btn ${reportPeriod === p ? 'active' : ''}`} onClick={() => setReportPeriod(p)}>{p}</button>
            ))}
          </div>
          {commission ? (
            <>
              <div className="lt-stat-grid">
                <StatCard label="Total Commission" value={fmt(commission.totalCommission)} color="#7c3aed" />
                <StatCard label="Total Sales" value={fmt(commission.totalSales)} color="var(--accent-primary)" />
                <StatCard label="Avg Commission %"
                  value={commission.avgRate ? `${(Number(commission.avgRate) * 100).toFixed(2)}%` : 'N/A'}
                  color="#2563eb" />
              </div>
              {commission.byGame?.length > 0 && (
                <div className="lt-card">
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Commission by Game</div>
                  <div className="lt-table-wrap">
                    <table className="lt-table">
                      <thead><tr>{['Game', 'Rate', 'Sales', 'Commission'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                      <tbody>
                        {commission.byGame.map((g, i) => (
                          <tr key={i}>
                            <td className="lt-td-strong">{g.gameName}</td>
                            <td>{g.rate ? `${(Number(g.rate) * 100).toFixed(2)}%` : 'N/A'}</td>
                            <td className="lt-td-brand">{fmt(g.sales)}</td>
                            <td style={{ fontWeight: 700, color: '#7c3aed' }}>{fmt(g.commission)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="lt-empty"><p>No commission data available.</p></div>
          )}
        </div>
      )}

      {/* ── SETTINGS ─────────────────────────────────────────────────── */}
      {tab === 'Settings' && (
        <div className="lt-settings-wrap">
          <div className="lt-card">
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1.25rem', fontFamily: 'var(--font-heading)' }}>Lottery Settings</div>
            {settingsMsg && (
              <div className={settingsMsg.startsWith('Error') ? 'lt-error' : 'lt-success-msg'}>{settingsMsg}</div>
            )}
            <div className="lt-field">
              <label className="lt-field-label">Store State / Province</label>
              <select className="lt-select" value={settingsForm.state} onChange={e => setSettingsForm(f => ({ ...f, state: e.target.value }))}>
                <option value="">— Select —</option>
                {ALL_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="lt-field-hint">Used to filter the ticket catalog to your state's available tickets</span>
            </div>
            <div className="lt-field">
              <label className="lt-field-label">Commission Rate (%)</label>
              <PriceInput maxValue={100} className="lt-input" value={settingsForm.commissionRate}
                onChange={(v) => setSettingsForm(f => ({ ...f, commissionRate: v }))}
                placeholder="e.g. 5.4" style={{ maxWidth: 200 }} />
              <span className="lt-field-hint">Enter as percentage e.g. 5.4 for 5.4%</span>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              {[
                ['enabled', 'Enable Lottery', 'Allow lottery sales and payouts in POS'],
                ['cashOnly', 'Cash Only', 'Restrict lottery payments to cash transactions only'],
                ['scanRequiredAtShiftEnd', 'Require Ticket Scan at Shift End', 'Cashiers must scan each active box before closing a shift'],
              ].map(([key, label, hint]) => (
                <label key={key} className="lt-toggle-row">
                  <input type="checkbox" checked={!!settingsForm[key]} onChange={e => setSettingsForm(f => ({ ...f, [key]: e.target.checked }))} />
                  <div><div className="lt-toggle-label">{label}</div><div className="lt-toggle-hint">{hint}</div></div>
                </label>
              ))}
            </div>
            <button className="lt-btn lt-btn-primary" onClick={handleSaveSettings} disabled={settingsSaving}>
              {settingsSaving ? <RefreshCw size={14} className="lt-spin" /> : <Check size={14} />}
              {settingsSaving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

      {/* ── Modals ───────────────────────────────────────────────────── */}
      {gameModal && (
        <GameModal game={gameModal === 'new' ? null : gameModal} onSave={handleSaveGame} onClose={() => setGameModal(null)} />
      )}
      {receiveModal && (
        <ReceiveBoxModal games={games.filter(g => g.active)} onSave={handleReceive} onClose={() => setReceiveModal(false)} />
      )}
      {activateBoxObj && (
        <ActivateBoxModal box={activateBoxObj} onConfirm={handleActivateBox} onClose={() => setActivateBoxObj(null)} />
      )}
      {moveToSafeBox && (
        <MoveToSafeModal box={moveToSafeBox} onConfirm={handleMoveToSafe} onClose={() => setMoveToSafeBox(null)} />
      )}
      {returnToLottoBox && (
        <ReturnToLottoModal box={returnToLottoBox} onConfirm={handleReturnToLotto} onClose={() => setReturnToLottoBox(null)} />
      )}
      {timelineBox && (
        <BookTimelineModal box={timelineBox} onClose={() => setTimelineBox(null)} />
      )}
    </div>
  );
}
