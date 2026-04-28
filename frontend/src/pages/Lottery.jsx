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

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
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
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend,
} from 'recharts';

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
import LotteryDailyScan, { CounterScanModal } from './LotteryDailyScan';
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

/* ── Simple SVG bar chart (legacy — kept for back-compat) ───────────────── */
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

/* ── Multi-line Reports chart (Recharts) ──────────────────────────────────
 *
 * Replaces SimpleBarChart on the Reports tab. Five toggleable series so the
 * user can isolate any combination:
 *   sales            — instant ticket sales (ticket-math, with POS fallback)
 *   payouts          — instant scratch payouts (LotteryTransaction)
 *   machineSales     — daily online machine draw sales
 *   machineCashing   — daily online machine cashings
 *   instantCashing   — daily instant ticket cashings (recorded online)
 *
 * Per-series toggle state is kept here so the parent doesn't need to rebuild
 * the chart on every checkbox click.
 */
const REPORT_SERIES = [
  { key: 'sales',          label: 'Instant Sales',      color: '#16a34a', defaultOn: true  },
  { key: 'payouts',        label: 'Scratch Payouts',    color: '#d97706', defaultOn: true  },
  { key: 'machineSales',   label: 'Machine Sales',      color: '#0ea5e9', defaultOn: true  },
  { key: 'machineCashing', label: 'Machine Cashing',    color: '#dc2626', defaultOn: false },
  { key: 'instantCashing', label: 'Instant Cashing',    color: '#7c3aed', defaultOn: false },
];

function LotteryReportsChart({ data, height = 320 }) {
  const [visible, setVisible] = useState(() =>
    Object.fromEntries(REPORT_SERIES.map(s => [s.key, s.defaultOn]))
  );
  const toggle = (k) => setVisible(v => ({ ...v, [k]: !v[k] }));

  if (!data?.length) {
    return <div className="lt-empty">No data for selected range</div>;
  }

  // Display dates as MM-DD when range > 7 days, else MMM-DD for clarity
  const fmtTickDate = (s) => (s || '').slice(5);
  const fmtTooltip  = (val, name) => [`$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, name];

  return (
    <div>
      {/* Series toggle row — checkbox per series with a colored dot */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14, fontSize: '0.82rem' }}>
        {REPORT_SERIES.map(s => (
          <label
            key={s.key}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              cursor: 'pointer', userSelect: 'none',
              padding: '4px 10px', borderRadius: 999,
              background: visible[s.key] ? 'rgba(0,0,0,0.04)' : 'transparent',
              border: `1px solid ${visible[s.key] ? s.color : 'var(--border-color)'}`,
            }}
          >
            <input
              type="checkbox"
              checked={visible[s.key]}
              onChange={() => toggle(s.key)}
              style={{ accentColor: s.color, cursor: 'pointer' }}
            />
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: s.color }} />
            <span style={{ color: 'var(--text-primary)' }}>{s.label}</span>
          </label>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis
            dataKey="date"
            tickFormatter={fmtTickDate}
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          />
          <YAxis
            tickFormatter={(v) => `$${v}`}
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
            width={64}
          />
          <Tooltip
            formatter={fmtTooltip}
            labelStyle={{ color: 'var(--text-primary)', fontWeight: 700 }}
            contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: '0.82rem' }}
          />
          <Legend wrapperStyle={{ fontSize: '0.78rem', paddingTop: 4 }} />
          {REPORT_SERIES.map(s => visible[s.key] && (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
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

/* Activate Box Modal
 *
 * sellDirection — a store setting ('asc' or 'desc', default 'desc') drives
 * the default Starting Ticket #:
 *   desc → totalTickets − 1  (a 150-pack starts at 149 and counts DOWN)
 *   asc  → 0                  (a 150-pack starts at 0 and counts UP)
 * The field stays editable so the cashier can enter a mid-book starting
 * position if some tickets were sold before this book was formally activated.
 */
function ActivateBoxModal({ box, sellDirection = 'desc', onConfirm, onClose }) {
  // Compute the direction-aware default once when the modal opens. Store
  // admin can still override via the input (e.g. book was partially sold
  // before activation).
  const defaultStart = useMemo(() => {
    const total = Number(box?.totalTickets || 0);
    if (!total) return '';
    return sellDirection === 'asc' ? '0' : String(total - 1);
  }, [box?.totalTickets, sellDirection]);

  const [slotNumber, setSlotNumber] = useState('');
  const [activationDate, setActivationDate] = useState(toDateStr(new Date()));
  const [currentTicket, setCurrentTicket] = useState(defaultStart);
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
  const dirLabel = sellDirection === 'asc' ? 'ascending (0 → up)' : 'descending (down → 0)';
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
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Store sells <strong>{dirLabel}</strong> — starting ticket pre-filled below.
            Change this in <strong>Settings</strong> if wrong.
          </div>
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
          <label className="lt-field-label">
            Starting Ticket #{' '}
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
              (pre-filled from store's {sellDirection === 'asc' ? 'ascending' : 'descending'} setting)
            </span>
          </label>
          <input className="lt-input" type="number" value={currentTicket}
            onChange={e => setCurrentTicket(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder={defaultStart || 'next-to-sell ticket number'} />
          <span className="lt-field-hint">
            {sellDirection === 'asc'
              ? `A ${fmtNum(box.totalTickets)}-pack ascending book starts at 0 and counts up. Override only if tickets were sold before activation.`
              : `A ${fmtNum(box.totalTickets)}-pack descending book starts at ${(Number(box.totalTickets)||1)-1} and counts down. Override only if tickets were sold before activation.`}
          </span>
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

// MA + most US state lotteries standardise pack sizes at these values.
// The user physically sees the pack size printed on each book so should be
// able to correct it inline if the catalog default is wrong.
const PACK_SIZE_CHOICES = [10, 20, 30, 40, 50, 60, 100, 120, 150, 200, 250, 300];

// Industry-standard pack-size heuristic mirroring the backend guess.
// Used as the DEFAULT value when the catalog's ticketsPerBook is
// obviously-wrong (the legacy 50 for every game) or missing.
function guessPackSizeClient(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return 50;
  if (p <= 1)  return 300;
  if (p <= 2)  return 200;
  if (p <= 3)  return 200;
  if (p <= 5)  return 100;
  if (p <= 10) return 50;
  if (p <= 20) return 30;
  if (p <= 30) return 20;
  return 10;
}

/**
 * Smart pack-size inference.
 *
 * Combines the price-based heuristic with a key physical constraint: the
 * scanned ticket number MUST be in range [0, packSize − 1], regardless of
 * whether the store sells ascending or descending. If the heuristic says
 * 100 but the cashier just scanned ticket 128, the pack can't be 100 —
 * ticket 128 doesn't exist in a 100-pack. We bump to the smallest standard
 * choice above the ticket number.
 *
 * Skips the bump when scannedTicket is 0 (info-free — ticket 0 fits every
 * pack size) or when it's less than the heuristic.
 */
function inferPackSize(price, scannedTicket) {
  const heuristic = guessPackSizeClient(price);
  const t = Number(scannedTicket);
  if (!Number.isFinite(t) || t <= 0) return heuristic;
  if (t < heuristic) return heuristic;
  // Ticket exceeds heuristic — find smallest standard pack that fits.
  for (const size of PACK_SIZE_CHOICES) {
    if (size > t) return size;
  }
  // Larger than any standard choice (extreme edge case) — round up to
  // the next multiple of 50 so the stored value is still clean.
  return Math.ceil((t + 1) / 50) * 50;
}

/* Scan-to-receive tab — scan each book's barcode, build a running list, confirm all.
 *
 * Game lookup cascade (most → least direct):
 *   1. Store-level LotteryGame with matching real gameNumber (already received
 *      games at this store)
 *   2. Admin-level LotteryTicketCatalog with matching (state, gameNumber) —
 *      games the superadmin has synced/seeded but this store hasn't received
 *      from yet. Backend auto-creates the store-level game on confirm.
 *   3. No match → error "Game not in catalog".
 *
 * Pack size per item: defaults from the catalog's ticketsPerBook, BUT since
 * MA's public feed doesn't expose pack size, the admin catalog may hold a
 * stale/heuristic value. The cashier has the physical book in hand — they
 * should correct it inline via the dropdown before confirming.
 */
function ReceiveScanTab({ games, onSave, onClose }) {
  const confirmDialog = useConfirm();
  const [scanValue, setScanValue] = useState('');
  const [items, setItems]         = useState([]);   // [{ key, source, gameId?, catalogTicketId?, state?, gameNumber, gameName, bookNumber, ticketPrice, totalTickets, value }]
  const [catalog, setCatalog]     = useState([]);   // LotteryTicketCatalog rows for fallback lookup
  const [err, setErr]             = useState('');
  const [info, setInfo]           = useState('');
  const [saving, setSaving]       = useState(false);
  const scanRef = React.useRef(null);

  React.useEffect(() => {
    setTimeout(() => scanRef.current?.focus(), 50);
    // Pull the master catalog once on modal open for fallback matching.
    (async () => {
      try {
        const r = await getLotteryCatalog();
        const rows = Array.isArray(r) ? r : (r?.data ?? []);
        setCatalog(rows);
      } catch {
        // Catalog fetch failure is non-fatal — scan can still match against
        // games the store already has.
        setCatalog([]);
      }
    })();
  }, []);

  const handleScan = async (rawArg) => {
    const v = String(rawArg ?? scanValue ?? '').trim();
    if (!v) return;
    setScanValue('');
    setErr(''); setInfo('');
    try {
      const res = await parseLotteryBarcode(v);
      const parsed = res?.parsed || res?.data?.parsed;
      const state  = res?.state  || res?.data?.state || parsed?.state;
      if (!parsed || !parsed.gameNumber || !parsed.bookNumber) {
        setErr(`Barcode not recognised: ${v}`);
        return;
      }
      // Some MA QR codes encode an authoritative pack size at positions
      // 15-17. When present, it beats every other source (heuristic,
      // catalog default, user dropdown) because it comes straight from the
      // ticket stock the cashier is physically holding.
      const barcodePackSize = Number.isFinite(Number(parsed.packSize)) && Number(parsed.packSize) > 0
        ? Number(parsed.packSize) : null;

      // 1. Try store-level game (real gameNumber)
      let game = games.find(g => String(g.gameNumber) === String(parsed.gameNumber));

      // 2. Fall back to admin catalog
      let catRow = null;
      if (!game && catalog.length > 0) {
        catRow = catalog.find(c =>
          String(c.gameNumber) === String(parsed.gameNumber) &&
          (!state || String(c.state).toUpperCase() === String(state).toUpperCase())
        );
      }

      if (!game && !catRow) {
        setErr(`Game ${parsed.gameNumber} (${state || 'unknown state'}) not found in store games or master catalog. Sync the state catalog or add the game manually first.`);
        return;
      }

      // Build item record — same shape whether sourced from game or catalog.
      // Pack-size default cascade (most → least authoritative):
      //   1. Pack size embedded in the barcode (MA QR positions 15-17) —
      //      THE source of truth when available
      //   2. Smart inference from price + scanned ticket number (handles
      //      the case where ticket > heuristic, bumps up)
      //   3. Catalog/store game's stored ticketsPerBox (if it's not the
      //      obviously-wrong legacy 50)
      //   4. Price-based heuristic alone
      const gameName    = game?.name          || catRow?.name          || `Game ${parsed.gameNumber}`;
      const ticketPrice = Number(game?.ticketPrice   || catRow?.ticketPrice   || 0);
      const catSize     = Number(game?.ticketsPerBox || catRow?.ticketsPerBook || 0);
      const smartSize   = inferPackSize(ticketPrice, parsed.ticketNumber);
      const catSizeOk   = catSize > 0 && catSize !== 50 && catSize > Number(parsed.ticketNumber || 0);
      const totalTickets = barcodePackSize || (catSizeOk ? catSize : smartSize);
      const value        = totalTickets * ticketPrice;

      // De-dup: gameId (if we have one) + bookNumber OR catalog+bookNumber
      const dedupKey = game
        ? `g:${game.id}:${parsed.bookNumber}`
        : `c:${catRow.id}:${parsed.bookNumber}`;
      if (items.some(it => it.key === dedupKey)) {
        setInfo(`Already added: ${gameName} — Book ${parsed.bookNumber}`);
        return;
      }

      // Same-game consistency: every book of the same game has the same
      // pack size in reality. If the new scan implies a larger pack than
      // the existing group holds, bump every prior book in the group to
      // match (otherwise the earlier 100-pack book and this 150-pack book
      // would disagree in the UI).
      const gameSig = game ? `g:${game.id}` : `c:${catRow.id}`;
      const existingInGroup = items.filter(it =>
        (it.gameId ? `g:${it.gameId}` : `c:${it.catalogTicketId}`) === gameSig
      );
      const bumpGroupTo = existingInGroup.length > 0 && totalTickets > existingInGroup[0].totalTickets
        ? totalTickets
        : null;
      const newRowSize = existingInGroup.length > 0
        ? Math.max(existingInGroup[0].totalTickets, totalTickets)
        : totalTickets;
      const newRowValue = newRowSize * ticketPrice;

      setItems(arr => {
        // Bump every book in the same group up to the larger size if needed
        const bumped = bumpGroupTo != null
          ? arr.map(it => {
              const sig = it.gameId ? `g:${it.gameId}` : `c:${it.catalogTicketId}`;
              if (sig !== gameSig) return it;
              return { ...it, totalTickets: bumpGroupTo, value: bumpGroupTo * Number(it.ticketPrice || 0) };
            })
          : arr;
        return [
          ...bumped,
          {
            key:             dedupKey,
            source:          game ? 'game' : 'catalog',
            gameId:          game?.id,
            catalogTicketId: catRow?.id,
            state:           state || catRow?.state,
            gameNumber:      parsed.gameNumber,
            gameName,
            bookNumber:      parsed.bookNumber,
            ticketPrice,
            totalTickets:    newRowSize,
            value:           newRowValue,
          },
        ];
      });
      const sourceBadge = game ? '' : ' (from master catalog)';
      const bumpNote    = bumpGroupTo != null ? ` — Pack bumped to ${bumpGroupTo} (ticket ${parsed.ticketNumber} needs larger pack)` : '';
      const packSrc     = barcodePackSize ? ` · pack ${barcodePackSize} (from barcode)` : '';
      setInfo(`✓ Added ${gameName} — Book ${parsed.bookNumber} (${fmt(newRowValue)})${sourceBadge}${bumpNote}${packSrc}`);
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Scan failed');
    } finally {
      setTimeout(() => scanRef.current?.focus(), 0);
    }
  };

  const removeItem = (key) => {
    setItems(arr => arr.filter(it => it.key !== key));
  };

  // Per-GAME pack-size correction. Every book of the same game has the same
  // pack size (intrinsic to the game), so correcting once for game 498
  // updates ALL scanned books of game 498 in this session — no need to
  // re-pick the size for each book. The game "signature" matches either by
  // gameId (store-level game) or catalogTicketId (master catalog fallback).
  const changePackSize = (signatureKey, newSize) => {
    const sz = Number(newSize);
    if (!Number.isFinite(sz) || sz <= 0) return;
    setItems(arr => arr.map(it => {
      const itSig = it.gameId ? `g:${it.gameId}` : `c:${it.catalogTicketId}`;
      if (itSig !== signatureKey) return it;
      return { ...it, totalTickets: sz, value: sz * Number(it.ticketPrice || 0) };
    }));
  };

  // Group items by game for rendering — one pack-size editor per game,
  // all books of that game listed under it. Preserves original scan order.
  const gameGroups = React.useMemo(() => {
    const groups = new Map(); // signatureKey → { signatureKey, gameName, gameNumber, state, source, ticketPrice, totalTickets, books: [] }
    for (const it of items) {
      const sig = it.gameId ? `g:${it.gameId}` : `c:${it.catalogTicketId}`;
      if (!groups.has(sig)) {
        groups.set(sig, {
          signatureKey: sig,
          gameId:       it.gameId,
          catalogTicketId: it.catalogTicketId,
          gameName:     it.gameName,
          gameNumber:   it.gameNumber,
          state:        it.state,
          source:       it.source,
          ticketPrice:  it.ticketPrice,
          totalTickets: it.totalTickets,
          books:        [],
        });
      }
      groups.get(sig).books.push(it);
    }
    return Array.from(groups.values());
  }, [items]);

  const clearAll = async () => {
    if (items.length === 0) return;
    if (!await confirmDialog({
      title: 'Clear scanned books?',
      message: `Clear all ${items.length} scanned book${items.length === 1 ? '' : 's'}?`,
      confirmLabel: 'Clear',
      danger: true,
    })) return;
    setItems([]);
  };

  const totalValue = items.reduce((s, it) => s + it.value, 0);
  const totalCount = items.length;

  const confirm = async () => {
    if (items.length === 0) { setErr('Scan at least one book before confirming.'); return; }
    setSaving(true); setErr('');
    try {
      await onSave({
        boxes: items.map(it => {
          // Backend's resolveOrCreateStoreGame prefers direct gameId, then
          // catalogTicketId, then (state, gameNumber). Send whichever we have —
          // multiple is fine, the resolver tries them in order.
          // totalTickets is sent explicitly per-book so the user's inline
          // pack-size correction flows through to LotteryBox.totalTickets,
          // which drives startTicket calculation on activation.
          const payload = {
            boxNumber:    it.bookNumber,
            totalTickets: it.totalTickets,
            // startTicket intentionally omitted — derived from store.sellDirection
            // on first activation via autoActivator (see Phase 3g notes).
          };
          if (it.gameId)          payload.gameId          = it.gameId;
          if (it.catalogTicketId) payload.catalogTicketId = it.catalogTicketId;
          if (it.state)           payload.state           = it.state;
          if (it.gameNumber)      payload.gameNumber      = it.gameNumber;
          return payload;
        }),
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
        Books are grouped by game — if the pack size looks wrong, change it
        once and it applies to every book of that game. On Confirm, every
        book lands in the <strong>Safe</strong> (status=Inventory) and is
        ready to activate at EoD.
      </div>

      {items.length === 0 ? (
        <div className="lt-empty">
          <Package size={24} color="#9ca3af" />
          <div style={{ marginTop: 8, color: '#9ca3af' }}>No books scanned yet.</div>
        </div>
      ) : (
        <>
          <div className="lt-scan-list">
            {gameGroups.map((grp) => {
              const grpTotal = grp.books.reduce((s, b) => s + b.value, 0);
              const packChoices = PACK_SIZE_CHOICES.includes(grp.totalTickets)
                ? PACK_SIZE_CHOICES
                : [...PACK_SIZE_CHOICES, grp.totalTickets].sort((a,b) => a - b);
              return (
                <div key={grp.signatureKey} className="lt-scan-group">
                  {/* Game header — game name, number, pack-size editor.
                      Editing pack size here applies to every book below. */}
                  <div className="lt-scan-group-head">
                    <div className="lt-scan-group-meta">
                      <strong>{grp.gameName}</strong>
                      <span className="lt-scan-group-num">#{grp.gameNumber}</span>
                      {grp.source === 'catalog' && (
                        <span className="lt-scan-source-tag" title="Sourced from master catalog — store game will auto-create on confirm">
                          from catalog
                        </span>
                      )}
                      <span className="lt-scan-group-books">
                        {grp.books.length} book{grp.books.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="lt-scan-group-pack">
                      <label className="lt-scan-pack-label">Pack size:</label>
                      <select
                        className="lt-scan-pack-select"
                        value={grp.totalTickets}
                        onChange={e => changePackSize(grp.signatureKey, e.target.value)}
                        title="Pack size — verify from the physical book. Applies to every book of this game."
                      >
                        {packChoices.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <span className="lt-scan-pack-price">× {fmt(grp.ticketPrice)}</span>
                      <span className="lt-scan-group-total">= {fmt(grpTotal)}</span>
                    </div>
                  </div>
                  {/* Book list under this game */}
                  <div className="lt-scan-group-books-list">
                    {grp.books.map(it => (
                      <div key={it.key} className="lt-scan-book-row">
                        <span className="lt-scan-book-num">Book {it.bookNumber}</span>
                        <span className="lt-scan-book-val">{fmt(it.value)}</span>
                        <button
                          type="button"
                          className="lt-scan-remove"
                          onClick={() => removeItem(it.key)}
                          title="Remove this book from the list"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
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
  const confirmDialog = useConfirm();
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
    if (!await confirmDialog({
      title: `${ticket.active ? 'Deactivate' : 'Reactivate'} ticket?`,
      message: `${ticket.active ? 'Deactivate' : 'Reactivate'} "${ticket.name}"?`,
      confirmLabel: ticket.active ? 'Deactivate' : 'Reactivate',
      danger: ticket.active,
    })) return;
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
//
// `urlTab` (optional prop) is forwarded from LotteryRouter when the page is
// invoked via a URL param (?tab=reports, ?tab=settings, …). The body maps
// it to the internal tab name so refresh keeps the user on the same tab.
export default function Lottery({ urlTab } = {}) {
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
  return <LotteryBody urlTab={urlTab} />;
}

// Map the URL slug (LotteryTabBar's key) → the internal `tab` state value
// used throughout LotteryBody's render tree. Kept as a small explicit
// table so the two layers can evolve independently.
const URL_TAB_MAP = {
  'shift-reports':    'Shift Reports',
  'weekly':           'Weekly Settlement',
  'reports':          'Reports',
  'commission':       'Commission',
  'settings':         'Settings',
  'catalog':          'Ticket Catalog',
  'games':            'Games',
  'overview':         'Overview',
  // 'daily' is intercepted at the router level (LotteryBackOffice renders)
};

function LotteryBody({ urlTab } = {}) {
  const confirmDialog = useConfirm();
  // Role check for admin-only tabs
  const user = (() => { try { return JSON.parse(localStorage.getItem('user')) || {}; } catch { return {}; } })();
  const isAdmin = ['superadmin', 'admin'].includes(user.role);

  // 3e — removed Games (admin-managed), Receive Order (duplicate), Daily Scan
  // (nested wizard was redundant). Receive is now a one-click action in the
  // Counter tab; End of Day (renamed from "Online Sales" in the Option A
  // collapse) is its own top-level tab that holds daily machine totals,
  // open-shift close, and the Close the Day button.
  const TABS = [
    'Overview',
    ...(isAdmin ? ['Ticket Catalog'] : []),
    'Counter',
    'Safe',
    'Soldout',
    'Returned',
    'End of Day',
    'Shift Reports',
    'Weekly Settlement',
    'Reports',
    'Commission',
    'Settings',
  ];

  // Maps display tab name → LotteryBox.status value
  const TAB_STATUS = { Counter: 'active', Safe: 'inventory', Soldout: 'depleted', Returned: 'returned' };

  // Seed the internal tab from the URL param so a refresh / deep link
  // lands on the correct section. When urlTab is absent (shouldn't happen
  // via the router but included for back-compat), default to Overview.
  const initialTab = (urlTab && URL_TAB_MAP[urlTab]) || 'Overview';
  const [tab, setTab] = useState(initialTab);
  // Keep internal state in sync when the URL changes after initial render
  // (e.g. user clicks a different tab in the LotteryTabBar above us).
  useEffect(() => {
    const mapped = (urlTab && URL_TAB_MAP[urlTab]) || 'Overview';
    if (mapped !== tab) setTab(mapped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab]);
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
  const [counterScanOpen, setCounterScanOpen] = useState(false);   // shared popup with End of Day page
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
  const [settingsForm, setSettingsForm] = useState({ enabled: true, cashOnly: false, state: '', commissionRate: '', scanRequiredAtShiftEnd: false, sellDirection: 'desc' });
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
          sellDirection: r.sellDirection === 'asc' ? 'asc' : 'desc',
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
      // Don't write through state + commissionRate — those are read-only
      // mirrors of values managed elsewhere (Store Settings + State catalog).
      // Sending them would clobber the inherited values and accidentally
      // override the per-stream rates picked up by the settlement engine.
      const { state: _ignoredState, commissionRate: _ignoredCommission, ...editable } = settingsForm;
      const updated = await updateLotterySettings(localStorage.getItem('activeStoreId'), editable);
      setLotterySettings(updated || editable);
      setSettingsMsg('Settings saved successfully.');
    } catch (e) {
      setSettingsMsg('Error: ' + (e.response?.data?.error || e.message));
    }
    setSettingsSaving(false);
  };

  /* ── CSV Download ─────────────────────────────────────────────────────── */
  const downloadReportCSV = () => {
    if (!reportData) return;
    // Include all 5 chart series + net so the spreadsheet matches what
    // the on-screen multi-line chart can show.
    const header = ['Date', 'Sales', 'Payouts', 'Net', 'MachineSales', 'MachineCashing', 'InstantCashing'];
    const rows = [header, ...(reportData.chart || []).map(d => [
      d.date,
      Number(d.sales          || 0).toFixed(2),
      Number(d.payouts        || 0).toFixed(2),
      Number(d.net            || 0).toFixed(2),
      Number(d.machineSales   || 0).toFixed(2),
      Number(d.machineCashing || 0).toFixed(2),
      Number(d.instantCashing || 0).toFixed(2),
    ])];
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
    if (!await confirmDialog({
      title: 'Delete game?',
      message: 'Delete this game?',
      confirmLabel: 'Delete',
      danger: true,
    })) return;
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
    if (!await confirmDialog({
      title: 'Mark book as Soldout?',
      message: 'Mark this book as Soldout? It will be settled in the next weekly report.',
      confirmLabel: 'Mark Soldout',
    })) return;
    await soldoutLotteryBox(id, { reason: 'manual' });
    reloadCurrentTab();
  };
  const handleCancelPending = async (id) => {
    if (!await confirmDialog({
      title: 'Cancel scheduled move?',
      message: 'Cancel the scheduled move for this book?',
      confirmLabel: 'Cancel Move',
    })) return;
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

      {/* Full page header — hidden when rendered via LotteryRouter. The
          LotteryTabBar above us already identifies the page. Legacy
          callers that mount <Lottery/> directly still get the header. */}
      {!urlTab && (
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
      )}

      {/* Internal tab strip — hidden when the page is rendered via
          LotteryRouter (urlTab prop present). The router already mounts
          LotteryTabBar above us; showing the internal strip too would
          duplicate navigation. Legacy callers that mount <Lottery/> without
          the router still see the internal tabs. */}
      {!urlTab && (
        <div className="lt-tabs">
          {TABS.map(t => (
            <button key={t} className={`lt-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t}
              {t === 'Ticket Catalog' && pendingCount > 0 && <span className="lt-tab-badge">{pendingCount}</span>}
            </button>
          ))}
        </div>
      )}

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

      {/* ── END OF DAY (Option A collapse) — daily machine totals, close
           any open cashier shifts, then Close the Lottery Day. */}
      {tab === 'End of Day' && <LotteryDailyScan />}

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
              <button
                className="lt-btn lt-btn-primary lt-btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={() => setCounterScanOpen(true)}
                disabled={filteredTabBoxes.length === 0}
                title="Same scan popup as the cashier's end-of-shift wizard — scan each book's next-to-sell ticket"
              >
                <ScanLine size={13} /> Run Counter Scan
              </button>
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
                                  if (!await confirmDialog({
                                    title: 'Remove book?',
                                    message: 'Remove this book from inventory? This cannot be undone.',
                                    confirmLabel: 'Remove',
                                    danger: true,
                                  })) return;
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
                              if (!await confirmDialog({
                                title: 'Re-activate book?',
                                message: 'Re-activate this book onto the counter?',
                                confirmLabel: 'Re-activate',
                              })) return;
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
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Daily Activity</div>
                    {report.salesSource && report.salesSource !== 'snapshot' && (
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {report.salesSource === 'pos_fallback' && '⚠ Computed from POS transactions (no shift-end scans)'}
                        {report.salesSource === 'mixed'        && '⚠ Mixed sources — some days missing shift-end scans'}
                        {report.salesSource === 'live'         && '⚡ Live (in-progress today)'}
                        {report.salesSource === 'empty'        && 'No data'}
                      </span>
                    )}
                  </div>
                  <LotteryReportsChart data={report.chart} height={320} />
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
            {/* State + commission rate are inherited from elsewhere — DO NOT
                duplicate the inputs here:
                  • State comes from Account → Store Settings (per-store)
                  • Per-stream commission rates come from the State catalog
                    (set by superadmin in Admin → States)
                  • Per-store commission override (legacy) is preserved in
                    the DB for back-compat but no longer editable here.
                Showing the resolved values read-only so the manager can
                verify what's in effect, with a hint pointing at where to
                change them. */}
            <div className="lt-field lt-field--readonly">
              <label className="lt-field-label">State (from Store Settings)</label>
              <div className="lt-field-readonly">{settingsForm.state || '— not set —'}</div>
              <span className="lt-field-hint">
                Pick this in Account → Store Settings. Determines which games
                appear in your catalog and which state-level commission rates apply.
              </span>
            </div>
            <div className="lt-field lt-field--readonly">
              <label className="lt-field-label">Commission Rate (from State catalog)</label>
              <div className="lt-field-readonly">
                {settingsForm.commissionRate
                  ? `${settingsForm.commissionRate}%`
                  : '— set by superadmin per state —'}
              </div>
              <span className="lt-field-hint">
                Per-stream rates (instant sales / instant cashing / machine sales /
                machine cashing) are managed by superadmin in Admin → States. The
                settlement engine picks the correct rate per revenue stream automatically.
              </span>
            </div>

            {/* Sell direction — how this store opens books. Drives the default
                startTicket when a book is activated, and the EoD wizard's
                "tickets sold" math. Every book in the store must open the
                same way (set once, applies to all games). */}
            <div className="lt-field">
              <label className="lt-field-label">Book Opening Direction</label>
              <div className="lt-selldir-grid">
                <label className={`lt-selldir-card ${settingsForm.sellDirection === 'desc' ? 'lt-selldir-card--active' : ''}`}>
                  <input
                    type="radio"
                    name="sellDirection"
                    value="desc"
                    checked={settingsForm.sellDirection === 'desc'}
                    onChange={() => setSettingsForm(f => ({ ...f, sellDirection: 'desc' }))}
                  />
                  <div className="lt-selldir-body">
                    <div className="lt-selldir-title">Descending <span className="lt-selldir-default">(most common)</span></div>
                    <div className="lt-selldir-example">150-pack starts at <strong>149</strong> and counts DOWN as tickets sell</div>
                    <div className="lt-selldir-hint">Books open from the highest ticket number. Typical for MA / most US states.</div>
                  </div>
                </label>
                <label className={`lt-selldir-card ${settingsForm.sellDirection === 'asc' ? 'lt-selldir-card--active' : ''}`}>
                  <input
                    type="radio"
                    name="sellDirection"
                    value="asc"
                    checked={settingsForm.sellDirection === 'asc'}
                    onChange={() => setSettingsForm(f => ({ ...f, sellDirection: 'asc' }))}
                  />
                  <div className="lt-selldir-body">
                    <div className="lt-selldir-title">Ascending</div>
                    <div className="lt-selldir-example">150-pack starts at <strong>0</strong> and counts UP as tickets sell</div>
                    <div className="lt-selldir-hint">Books open from ticket 0. Used by some stores and a few states.</div>
                  </div>
                </label>
              </div>
              <span className="lt-field-hint">
                This setting pre-fills the Starting Ticket # when you activate a book and drives the
                EoD reconciliation math. Applies to every game uniformly — change it once here, not per book.
              </span>
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
      {counterScanOpen && (
        <CounterScanModal
          onClose={() => setCounterScanOpen(false)}
          onSaved={() => { setCounterScanOpen(false); reloadCurrentTab(); }}
        />
      )}
      {activateBoxObj && (
        <ActivateBoxModal
          box={activateBoxObj}
          sellDirection={lotterySettings?.sellDirection || settingsForm.sellDirection || 'desc'}
          onConfirm={handleActivateBox}
          onClose={() => setActivateBoxObj(null)}
        />
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
