/**
 * LotteryWeeklySettlement — Phase 2
 *
 * Displays weekly settlement cards for the current store, mirroring the
 * Elistars "Weekly Settlement" layout:
 *
 *   Month selector → grid of weekly cards → click a card to edit/finalize
 *
 * Each card shows:
 *   - Week range (Mon–Sun) + due date
 *   - Online Due breakdown (Sales, Cancels, Commission, Pays/Cashes)
 *   - Instant Due breakdown (Settled/Unsettled Books, Commissions, Returns)
 *   - Adjustments (Bonus, Svc Charge, Adjustments)
 *   - Grand total due
 *   - Status badge: draft | finalized | paid
 *
 * Editing is allowed only on draft rows. After Finalize, the row locks
 * and all books in settledBookIds flip to status='settled'.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import { X, CheckCircle2, Printer, DollarSign, RotateCcw, Lock, Info } from 'lucide-react';
import {
  listLotterySettlements, getLotterySettlement,
  upsertLotterySettlement, finalizeLotterySettlement, markLotterySettlementPaid,
  getLotteryBoxes,
} from '../services/api';

const fmt = (n) => n == null ? '$0.00' : `$${Number(n).toFixed(2)}`;
// Browser-local date string — NOT UTC. Earlier `.toISOString().slice(0, 10)`
// returned UTC date which broke the settlement week calendar after ~8pm in
// Western timezones (page opened to next day's week).
const _pad2 = (n) => String(n).padStart(2, '0');
const toIsoDate = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${_pad2(dt.getMonth() + 1)}-${_pad2(dt.getDate())}`;
};
const formatDate = (d) => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}/${String(dt.getUTCFullYear()).slice(-2)}`;
};

export default function LotteryWeeklySettlement() {
  const [year, setYear]   = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth()); // 0-11
  const [rows, setRows]   = useState([]);
  const [boxLookup, setBoxLookup] = useState({});  // boxId → { gameNumber, boxNumber, totalValue, gameName }
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showOnlyEligible, setShowOnlyEligible] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch a 1-month window plus a buffer on either side so partial
      // weeks at the month boundary aren't cut off.
      const from = new Date(Date.UTC(year, month - 1, 25));
      const to   = new Date(Date.UTC(year, month + 1, 7));
      const [res, boxes] = await Promise.all([
        listLotterySettlements({ from: toIsoDate(from), to: toIsoDate(to) }),
        // Pull all boxes once so settlement BookList can render
        // human-readable game-book labels instead of raw nanoid strings.
        getLotteryBoxes({}),
      ]);
      setRows(Array.isArray(res) ? res : []);
      const list = Array.isArray(boxes) ? boxes : (boxes?.boxes || boxes?.data || []);
      const lookup = {};
      for (const b of list) {
        lookup[b.id] = {
          gameNumber: b.game?.gameNumber || null,
          gameName:   b.game?.name || null,
          boxNumber:  b.boxNumber || null,
          totalValue: Number(b.totalValue || 0),
        };
      }
      setBoxLookup(lookup);
    } catch (e) {
      console.warn('[settlement] load failed', e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  // Filter to just weeks that fall within the selected month
  const monthWeeks = useMemo(() => {
    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd   = new Date(Date.UTC(year, month + 1, 0));
    return rows
      .filter((r) => {
        const s = new Date(r.weekStart);
        const e = new Date(r.weekEnd);
        return s <= monthEnd && e >= monthStart;
      })
      .filter((r) => !showOnlyEligible || (Array.isArray(r.settledBookIds) && r.settledBookIds.length > 0))
      .sort((a, b) => new Date(b.weekStart) - new Date(a.weekStart));
  }, [rows, year, month, showOnlyEligible]);

  const shift = (delta) => {
    const d = new Date(Date.UTC(year, month + delta, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth());
  };

  return (
    <div className="lws-wrap">
      <div className="lws-header">
        <div className="lws-month">
          <button className="lws-month-nav" onClick={() => shift(-1)}>‹</button>
          <div className="lws-month-label">{new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</div>
          <button className="lws-month-nav" onClick={() => shift(1)}>›</button>
          <button className="lt-btn lt-btn-secondary lt-btn-sm" onClick={() => { const n = new Date(); setYear(n.getFullYear()); setMonth(n.getMonth()); }}>This month</button>
        </div>
        <label className="lws-filter">
          <input type="checkbox" checked={showOnlyEligible} onChange={e => setShowOnlyEligible(e.target.checked)} />
          <span>Weeks with eligible books only</span>
        </label>
      </div>

      {loading && <div className="lws-loading">Loading settlements…</div>}

      {!loading && monthWeeks.length === 0 && (
        <div className="lws-empty">
          <Info size={24} />
          <div>No lottery activity recorded for this month yet.</div>
          <div className="lws-empty-hint">Settlement cards appear once daily sales data exists for at least one day in the month.</div>
        </div>
      )}

      <div className="lws-grid">
        {monthWeeks.map((r) => (
          <SettlementCard key={toIsoDate(r.weekStart)} row={r} onEdit={() => setEditing(r)} />
        ))}
      </div>

      {editing && (
        <SettlementEditModal
          initial={editing}
          lookup={boxLookup}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Card — the headline view of a single week's settlement
 * ──────────────────────────────────────────────────────────────────── */
function SettlementCard({ row, onEdit }) {
  const isDraft = row.status === 'draft' || !row.status;
  const isFinal = row.status === 'finalized';
  const isPaid  = row.status === 'paid';

  const onlineDue  = Number(row.onlineGross || 0) - Number(row.onlineCashings || 0) - Number(row.onlineCommission || 0);
  const instantDue = Number(row.instantSales || 0)
                   - Number(row.instantSalesComm || 0)
                   - Number(row.instantCashingComm || 0)
                   - Number(row.returnsDeduction || 0);

  return (
    <div className={`lws-card lws-card--${row.status || 'draft'}`}>
      <div className="lws-card-head">
        <div>
          <div className="lws-card-dates">
            <span className="lws-card-week">{formatDate(row.weekStart)} – {formatDate(row.weekEnd)}</span>
            <span className="lws-card-due">DUE {formatDate(row.dueDate)}</span>
          </div>
        </div>
        <div className={`lws-card-flag ${Number(row.totalDue || 0) > 0 ? 'owed' : 'zero'}`}>
          🏁 {fmt(row.totalDue)}
        </div>
      </div>

      <div className="lws-card-body">
        <div className="lws-col">
          <div className="lws-col-title">Online Due <strong>{fmt(onlineDue)}</strong></div>
          <Line label="Sales"       value={fmt(row.onlineGross)} />
          <Line label="Cashings"    value={fmt(row.onlineCashings)} />
          <Line label="Sales Comm"  value={fmt(row.onlineCommission)} muted />
        </div>
        <div className="lws-col">
          <div className="lws-col-title">
            <span>Instant Due</span>
            {/* S79e (C10) — wrapper keeps the dollar amount + snapshot chip
                grouped on the right side of the space-between flex layout.
                Chip self-hides when row.snapshotCoverage is missing
                (i.e. older settlement rows from before this field shipped). */}
            <span className="lws-col-title-right">
              <strong>{fmt(instantDue)}</strong>
              <SnapshotCoverageChip source={row.instantSalesSource} coverage={row.snapshotCoverage} />
            </span>
          </div>
          <Line
            label={`Settled ${(row.settledBookIds?.length || 0)} book${(row.settledBookIds?.length || 0) === 1 ? '' : 's'}`}
            value={fmt(row.instantSales)} />
          <Line label="Sales Comm"   value={fmt(row.instantSalesComm)} muted />
          <Line label="Cashing Comm" value={fmt(row.instantCashingComm)} muted />
          <Line label="Returns"      value={fmt(row.returnsDeduction)} muted />
          {(row.unsettledBookIds?.length || 0) > 0 && (
            <Line label={`Unsettled ${row.unsettledBookIds.length}`} value="" muted />
          )}
        </div>
      </div>

      <div className="lws-card-adjust">
        {Number(row.bonus) > 0         && <Line label="Bonus"         value={fmt(row.bonus)} />}
        {Number(row.serviceCharge) > 0 && <Line label="Svc Charge"    value={fmt(row.serviceCharge)} />}
        {Number(row.adjustments) !== 0 && <Line label="Adjustments"   value={fmt(row.adjustments)} />}
        {row.notes && <div className="lws-card-notes" title={row.notes}>📝 {row.notes.slice(0, 80)}{row.notes.length > 80 ? '…' : ''}</div>}
      </div>

      <div className="lws-card-footer">
        {isDraft && (
          <button className="lt-btn lt-btn-secondary lt-btn-sm" onClick={onEdit}>Edit</button>
        )}
        {isFinal && (
          <>
            <span className="lws-badge lws-badge--final"><Lock size={12} /> Finalized</span>
            <button className="lt-btn lt-btn-secondary lt-btn-sm" onClick={onEdit}>View / Mark Paid</button>
          </>
        )}
        {isPaid && (
          <span className="lws-badge lws-badge--paid"><CheckCircle2 size={12} /> Paid{row.paidRef ? ` · ${row.paidRef}` : ''}</span>
        )}
      </div>
    </div>
  );
}

function Line({ label, value, muted }) {
  return (
    <div className={`lws-line ${muted ? 'muted' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/**
 * S79e (C10) — Snapshot coverage chip.
 *
 * Lets admins distinguish a legitimately quiet week ($0 sales because
 * nothing sold) from a missed-wizard week ($0 sales because no
 * close_day_snapshot events were captured).
 *
 * Decision tree (priority order):
 *   1. instantSalesSource = 'pos_fallback' → amber, source label takes precedence
 *      (no snapshots at all this week, settlement falling back to POS data)
 *   2. snapshotCoverage = 0/N    → red    "No snapshots — POS fallback / no signal"
 *   3. coverage < N/2  (< 50%)   → amber  "Partial — sales may be incomplete"
 *   4. coverage < N    (50-99%)  → amber  "X/N days tracked"
 *   5. coverage = N    (100%)    → green  "Full week tracked"
 */
function SnapshotCoverageChip({ source, coverage }) {
  // No backend support yet (e.g. older settlement row before this field
  // was added) — render nothing instead of misleading green.
  if (!coverage || typeof coverage.daysWithSnapshots !== 'number') return null;

  const { daysWithSnapshots: days, daysInPeriod: total } = coverage;
  const safeTotal = total > 0 ? total : 7;

  let tone, label, title;
  if (source === 'pos_fallback') {
    tone  = 'amber';
    label = `⚠ POS fallback — 0/${safeTotal} snapshots`;
    title = 'No snapshot trail this week — settlement is using cashier-recorded LotteryTransaction sales as a fallback. Less accurate than the EoD wizard\'s snapshot trail. Run the EoD wizard nightly to improve this.';
  } else if (days === 0) {
    tone  = 'red';
    label = `⚠ 0/${safeTotal} snapshots`;
    title = 'No snapshots captured this week — likely the cashier didn\'t run the EoD wizard. Settlement may show $0 sales even if tickets sold.';
  } else if (days < safeTotal / 2) {
    tone  = 'amber';
    label = `⚠ ${days}/${safeTotal} days tracked`;
    title = 'Partial snapshot coverage — settlement amount may be incomplete. Run the EoD wizard nightly to capture every day.';
  } else if (days < safeTotal) {
    tone  = 'amber';
    label = `${days}/${safeTotal} days tracked`;
    title = `Snapshots were captured on ${days} of ${safeTotal} days this week. Days without snapshots aren\'t reflected in the settlement amount.`;
  } else {
    tone  = 'green';
    label = `✓ ${days}/${safeTotal} days tracked`;
    title = 'Full snapshot coverage — every day in the week had at least one EoD wizard run. Settlement amount is high-confidence.';
  }

  return (
    <span className={`lws-snapshot-chip lws-snapshot-chip--${tone}`} title={title}>
      {label}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Edit Modal — adjust bonus / svc charge / adjustments + finalize + pay
 * ──────────────────────────────────────────────────────────────────── */
function SettlementEditModal({ initial, lookup = {}, onClose, onSaved }) {
  const confirm = useConfirm();
  const weekKey = toIsoDate(initial.weekStart);
  const [row, setRow] = useState(initial);
  const [form, setForm] = useState({
    bonus: Number(initial.bonus || 0),
    serviceCharge: Number(initial.serviceCharge || 0),
    adjustments: Number(initial.adjustments || 0),
    notes: initial.notes || '',
    paidRef: initial.paidRef || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Fetch fresh detail (computes latest numbers)
  useEffect(() => {
    (async () => {
      try {
        const res = await getLotterySettlement(weekKey);
        if (res) setRow(res);
      } catch {}
    })();
  }, [weekKey]);

  const isDraft = row.status === 'draft' || !row.status;
  const isFinal = row.status === 'finalized';
  const isPaid  = row.status === 'paid';

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Formula (per user spec):
  //   Daily Gross        = (instant sales − instant payouts) + (machine sales − machine cashings)
  //   Weekly Gross       = Σ Daily Gross
  //   Weekly Net         = Weekly Gross − returns − total commission
  //   Weekly Payable     = Weekly Net − bonus + service charge − adjustments
  const calc = useMemo(() => {
    const instantSales     = Number(row.instantSales || 0);
    const instantPayouts   = Number(row.instantPayouts ?? 0);
    const onlineGross      = Number(row.onlineGross || 0);
    const onlineCashings   = Number(row.onlineCashings || 0);
    const returnsDeduction = Number(row.returnsDeduction || 0);
    const totalComm =
      Number(row.instantSalesComm || 0) +
      Number(row.instantCashingComm || 0) +
      Number(row.machineSalesComm || 0) +
      Number(row.machineCashingComm || 0);

    const weeklyGross = (instantSales - instantPayouts) + (onlineGross - onlineCashings);
    const weeklyNet   = weeklyGross - returnsDeduction - totalComm;
    const weeklyPayable = weeklyNet
                        - Number(form.bonus || 0)
                        + Number(form.serviceCharge || 0)
                        - Number(form.adjustments || 0);

    return {
      weeklyGross:   Math.round(weeklyGross   * 100) / 100,
      weeklyNet:     Math.round(weeklyNet     * 100) / 100,
      weeklyPayable: Math.round(weeklyPayable * 100) / 100,
      totalComm:     Math.round(totalComm     * 100) / 100,
      instantSales, instantPayouts, onlineGross, onlineCashings, returnsDeduction,
    };
  }, [row, form]);
  const previewTotal = calc.weeklyPayable;

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const saved = await upsertLotterySettlement(weekKey, {
        bonus: Number(form.bonus || 0),
        serviceCharge: Number(form.serviceCharge || 0),
        adjustments: Number(form.adjustments || 0),
        notes: form.notes,
        saveComputedSnapshot: true,
      });
      setRow(saved);
      onSaved?.();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    if (!await confirm({
      title: 'Finalize settlement?',
      message: `Finalize this settlement? It will lock the numbers and mark all ${row.settledBookIds?.length || 0} settled books as settled.`,
      confirmLabel: 'Finalize',
    })) return;
    setSaving(true); setErr('');
    try {
      await save(); // save first to persist current adjustments
      const saved = await finalizeLotterySettlement(weekKey);
      setRow(saved);
      onSaved?.();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const markPaid = async () => {
    if (!await confirm({
      title: 'Mark settlement as paid?',
      message: `Mark this settlement as paid?${form.paidRef ? `\nRef: ${form.paidRef}` : ''}`,
      confirmLabel: 'Mark Paid',
    })) return;
    setSaving(true); setErr('');
    try {
      const saved = await markLotterySettlementPaid(weekKey, { paidRef: form.paidRef || null });
      setRow(saved);
      onSaved?.();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lt-modal-overlay">
      <div className="lt-modal" style={{ maxWidth: 720 }}>
        <div className="lt-modal-header">
          <div>
            <div className="lt-modal-title">Week of {formatDate(row.weekStart)} – {formatDate(row.weekEnd)}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>Due {formatDate(row.dueDate)} · {row.status || 'draft'}</div>
          </div>
          <button className="lt-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {err && <div className="lws-modal-err">{err}</div>}

        {/* Formula panel — user-visible so the math isn't mysterious */}
        <div className="lws-formula-box">
          <div className="lws-formula-head">How this total is calculated</div>
          <div className="lws-formula-line">
            <b>Daily:</b> Instant sales − Instant cashings + Machine sales − Machine cashings
          </div>
          <div className="lws-formula-line">
            <b>Weekly gross:</b> Sum of daily
          </div>
          <div className="lws-formula-line">
            <b>Weekly net (after commissions):</b> Weekly gross − returns − total commission
          </div>
          <div className="lws-formula-line">
            <b>Amount due:</b> Weekly net − bonus + service charge − adjustments
          </div>
        </div>

        <div className="lws-edit-grid">
          <div className="lws-edit-col">
            <div className="lws-col-title">Instant (Scratch)</div>
            <Line label="Settled books"     value={row.settledBookIds?.length ?? 0} />
            <Line label="Sales"             value={fmt(row.instantSales)} />
            <Line label="Payouts / Cashing" value={fmt(row.instantPayouts ?? 0)} />
            <Line label="Returns"           value={`−${fmt(row.returnsDeduction)}`} />
            <Line label="Sales Commission"   value={`−${fmt(row.instantSalesComm)}`} muted />
            <Line label="Cashing Commission" value={`−${fmt(row.instantCashingComm)}`} muted />
          </div>
          <div className="lws-edit-col">
            <div className="lws-col-title">Machine (Draw)</div>
            <Line label="Sales"             value={fmt(row.onlineGross)} />
            <Line label="Cashings"          value={fmt(row.onlineCashings)} />
            <Line label="Sales Commission"   value={`−${fmt(row.machineSalesComm ?? 0)}`} muted />
            <Line label="Cashing Commission" value={`−${fmt(row.machineCashingComm ?? 0)}`} muted />
          </div>
        </div>

        <div className="lws-preview-strip">
          <div className="lws-preview-step">
            <span>Weekly Gross (before commission)</span>
            <strong>{fmt(calc.weeklyGross)}</strong>
          </div>
          <div className="lws-preview-step">
            <span>− Returns</span>
            <strong>{fmt(row.returnsDeduction)}</strong>
          </div>
          <div className="lws-preview-step">
            <span>− Total Commission</span>
            <strong>{fmt(calc.totalComm)}</strong>
          </div>
          <div className="lws-preview-step lws-preview-step--net">
            <span>= Weekly Net (after commission)</span>
            <strong>{fmt(calc.weeklyNet)}</strong>
          </div>
        </div>

        <div className="lws-edit-grid">
          <DollarField label="Bonus"         disabled={!isDraft} value={form.bonus}         onChange={v => set('bonus', v)} />
          <DollarField label="Service Charge" disabled={!isDraft} value={form.serviceCharge} onChange={v => set('serviceCharge', v)} />
          <DollarField label="Adjustments"    disabled={!isDraft} value={form.adjustments}   onChange={v => set('adjustments', v)} allowNegative />
        </div>

        <div className="lws-field">
          <label>Notes</label>
          <textarea rows={2} disabled={!isDraft} value={form.notes} onChange={e => set('notes', e.target.value)}
            placeholder="Context for this week's settlement (optional)" />
        </div>

        <div className="lws-total-row">
          <div>
            <div className="lws-total-label">Amount Due (after adjustments)</div>
            <div className="lws-total-val">{fmt(previewTotal)}</div>
            <div className="lws-total-formula">
              {fmt(calc.weeklyNet)}
              {Number(form.bonus) > 0 && <> − <span style={{ color: '#dc2626' }}>{fmt(form.bonus)}</span> bonus</>}
              {Number(form.serviceCharge) > 0 && <> + <span style={{ color: '#b45309' }}>{fmt(form.serviceCharge)}</span> service</>}
              {Number(form.adjustments) !== 0 && (
                <> {Number(form.adjustments) >= 0 ? '−' : '+'} <span>{fmt(Math.abs(form.adjustments))}</span> adjustment</>
              )}
            </div>
          </div>
          {isFinal && (
            <div className="lws-field" style={{ minWidth: 240 }}>
              <label>Paid Reference (cheque / ACH)</label>
              <input type="text" value={form.paidRef} onChange={e => set('paidRef', e.target.value)} placeholder="e.g. CHK #1042" />
            </div>
          )}
        </div>

        <div className="lws-book-lists">
          {row.settledBookIds?.length > 0 && (
            <BookList title="Settled this week" ids={row.settledBookIds} tone="success" lookup={lookup} />
          )}
          {row.returnedBookIds?.length > 0 && (
            <BookList title="Returned to Lotto" ids={row.returnedBookIds} tone="warning" lookup={lookup} />
          )}
          {row.unsettledBookIds?.length > 0 && (
            <BookList title="Not yet eligible" ids={row.unsettledBookIds} tone="muted" lookup={lookup} />
          )}
        </div>

        <div className="lt-form-actions" style={{ gap: 8 }}>
          <button className="lt-btn lt-btn-secondary" onClick={onClose}>{isPaid ? 'Close' : 'Cancel'}</button>
          {isDraft && (
            <>
              <button className="lt-btn lt-btn-primary" disabled={saving} onClick={save}>
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
              <button className="lt-btn lt-btn-success" disabled={saving} onClick={finalize}>
                <Lock size={13} /> Finalize
              </button>
            </>
          )}
          {isFinal && (
            <button className="lt-btn lt-btn-success" disabled={saving} onClick={markPaid}>
              <DollarSign size={13} /> Mark Paid
            </button>
          )}
          <button className="lt-btn lt-btn-secondary" onClick={() => window.print()}>
            <Printer size={13} /> Print
          </button>
        </div>
      </div>
    </div>
  );
}

function DollarField({ label, value, onChange, disabled, allowNegative }) {
  return (
    <div className="lws-field">
      <label>{label}</label>
      <div className="lws-dollar">
        <span>$</span>
        <input
          type="number"
          step="0.01"
          min={allowNegative ? undefined : 0}
          disabled={disabled}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

function BookList({ title, ids, tone, lookup = {} }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`lws-booklist lws-booklist--${tone}`}>
      <button className="lws-booklist-head" onClick={() => setOpen(o => !o)}>
        <span>{title}</span>
        <span className="lws-booklist-count">{ids.length} {open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="lws-booklist-body">
          {ids.map((id) => {
            // Render human-readable game-book label when we have it; fall
            // back to a short truncated ID for unrecognised entries (the
            // lookup may be incomplete if a book was deleted).
            const meta = lookup[id];
            if (meta?.gameNumber && meta?.boxNumber) {
              return (
                <code
                  key={id}
                  className="lws-bookchip"
                  title={`${meta.gameName || 'Unknown game'} · $${(meta.totalValue || 0).toFixed(2)}`}
                >
                  {meta.gameNumber}-{meta.boxNumber}
                </code>
              );
            }
            return <code key={id} className="lws-bookchip lws-bookchip--unknown" title="Book details unavailable">{id.slice(-10)}</code>;
          })}
        </div>
      )}
    </div>
  );
}
