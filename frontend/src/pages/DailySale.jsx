/**
 * DailySale.jsx — Unified daily reconciliation (Phase 3d, "go 3").
 *
 * Mirrors the Elistars Daily/Sale layout in 3 columns:
 *   LEFT    — Lottery Sales + Other Income + Money In
 *   MIDDLE  — Total Sales (department breakdown) + Totalizer + Tax
 *   RIGHT   — Totals / Short-Over + Inside Sale + House Accts + Store Money + Cash Paidouts + Notes
 *
 * Auto-filled fields (dept sales, tenders, lottery, cash from shifts, paidouts):
 *   live-derived from POS + LotteryTransaction + Shift + VendorPayment.
 *   User can override via per-row Adjustment or direct edit.
 * Short/Over updates live on every edit (no save needed to see it).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import {
  ChevronLeft, ChevronRight, Save, Lock, FileText, Info, Trash2, Plus, RefreshCw,
} from 'lucide-react';
import { getDailySale, saveDailySale, closeDailySale } from '../services/api';
import './DailySale.css';

const fmt = (n) => {
  const v = Number(n || 0);
  return `$${v.toFixed(2)}`;
};
const fmtSignedColor = (n) => {
  const v = Number(n || 0);
  if (v > 0.005)  return { sign: 'over',  label: `over ${fmt(Math.abs(v))}` };
  if (v < -0.005) return { sign: 'short', label: `short ${fmt(Math.abs(v))}` };
  return { sign: 'even', label: 'balanced' };
};
const isoToday = () => new Date().toISOString().slice(0, 10);
const shiftDate = (iso, delta) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const prettyDate = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

export default function DailySale() {
  const confirm = useConfirm();
  const [date, setDate]           = useState(isoToday());
  const [snapshot, setSnapshot]   = useState(null);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [dirty, setDirty]         = useState(false);

  // Edit state — loaded from snapshot; saved via PUT
  const [edits, setEdits] = useState({});
  const patch = (k, v) => { setEdits((e) => ({ ...e, [k]: v })); setDirty(true); };
  const patchDeptAdj = (key, adj) => {
    setEdits((e) => {
      const curr = Array.isArray(e.deptAdjustments) ? [...e.deptAdjustments] : [];
      const idx = curr.findIndex((r) => String(r.key) === String(key));
      const row = idx >= 0 ? curr[idx] : { key: String(key), name: '', adjustment: 0, note: null };
      const next = { ...row, adjustment: Number(adj) || 0 };
      if (idx >= 0) curr[idx] = next;
      else curr.push(next);
      return { ...e, deptAdjustments: curr };
    });
    setDirty(true);
  };
  const patchHouseAccts = (list) => { setEdits((e) => ({ ...e, houseAccounts: list })); setDirty(true); };

  const load = useCallback(async (d) => {
    setLoading(true);
    try {
      const res = await getDailySale(d);
      setSnapshot(res?.data || null);
      setEdits({});
      setDirty(false);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load daily sale');
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      // Include computed-override fields; exclude fields that are purely server-computed
      const res = await saveDailySale(date, edits);
      setSnapshot(res?.data || null);
      setEdits({});
      setDirty(false);
      toast.success('Saved');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    if (!await confirm({
      title: 'Close Daily Sale report?',
      message: `Close the Daily Sale report for ${prettyDate(date)}?\n\nThis flips the status to 'closed'. You can still view it afterwards.`,
      confirmLabel: 'Close',
    })) return;
    try {
      await save();
      const res = await closeDailySale(date);
      setSnapshot(res?.data || null);
      toast.success('Day closed');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Close failed');
    }
  };

  // Edit takes precedence over the snapshot value for live-updating the UI.
  const v = (key) => {
    if (edits[key] != null) return edits[key];
    return snapshot?.[key];
  };
  const deptRows = useMemo(() => {
    if (!snapshot) return [];
    const adjMap = new Map((edits.deptAdjustments || snapshot.departments || [])
      .map((r) => [String(r.key), Number(r.adjustment || 0)]));
    return snapshot.departments.map((d) => {
      const adj = adjMap.has(String(d.key)) ? adjMap.get(String(d.key)) : Number(d.adjustment || 0);
      return { ...d, adjustment: adj, finalAmount: Math.round((d.autoAmount + adj) * 100) / 100 };
    });
  }, [snapshot, edits.deptAdjustments]);
  const depTotal = useMemo(() => deptRows.reduce((s, r) => s + r.finalAmount, 0), [deptRows]);

  // Live computed totals (UI side), mirrors server math
  const liveTotals = useMemo(() => {
    if (!snapshot) return null;
    const tenders = snapshot.tenders;
    const lotto   = snapshot.lottery;
    const houseTotal = (v('houseAccounts') || snapshot.houseAccounts || []).reduce((s, h) => s + Number(h.amount || 0), 0);
    const otherIncome  = Number(v('otherIncome')  ?? snapshot.otherIncome);
    const moneyIn      = Number(v('moneyIn')      ?? snapshot.moneyIn);
    const bankDeposit  = Number(v('bankDeposit')  ?? snapshot.bankDeposit);
    const lotteryDepo  = Number(v('lotteryDeposit') ?? snapshot.lotteryDeposit);
    const ccTotal      = Number(v('creditCardTotal') ?? snapshot.creditCardTotal);
    const dcTotal      = Number(v('debitCardTotal')  ?? snapshot.debitCardTotal);
    const purchPO      = Number(v('purchaseCashPO') ?? snapshot.purchaseCashPO);
    const expPO        = Number(v('expenseCashPO')  ?? snapshot.expenseCashPO);

    const totalIn  = tenders.cash + tenders.credit + tenders.debit + tenders.ebt + tenders.gift + tenders.check + tenders.house + tenders.other
                   + lotto.scratchoffSales + lotto.machineSales
                   + otherIncome + moneyIn + houseTotal;
    const totalOut = bankDeposit + lotteryDepo + ccTotal + dcTotal + purchPO + expPO
                   + lotto.scratchoffPO + lotto.machineCashing + lotto.instantCashing;
    const shortOver = Math.round((totalIn - totalOut) * 100) / 100;
    return {
      totalIn:   Math.round(totalIn * 100) / 100,
      totalOut:  Math.round(totalOut * 100) / 100,
      shortOver,
      insideSale: Math.round(depTotal * 100) / 100,
    };
  }, [snapshot, edits, depTotal]);

  if (loading || !snapshot) {
    return (
      <div className="ds-wrap">
        <div className="ds-loading">Loading daily sale…</div>
      </div>
    );
  }

  const isClosed = snapshot.status === 'closed';
  const shortOverDisplay = liveTotals ? fmtSignedColor(liveTotals.shortOver) : null;

  return (
    <div className="ds-wrap">
      {/* ── Header ────────────────────────────────────────── */}
      <div className="ds-header">
        <div className="ds-datebar">
          <button className="ds-datebtn" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day"><ChevronLeft size={16} /></button>
          <input type="date" value={date} max={isoToday()} onChange={(e) => setDate(e.target.value)} className="ds-dateinput" />
          <button className="ds-datebtn" onClick={() => setDate(shiftDate(date, +1))} disabled={date >= isoToday()} aria-label="Next day"><ChevronRight size={16} /></button>
          <span className="ds-pretty">{prettyDate(date)}</span>
          {isClosed && <span className="ds-closed-tag"><Lock size={11} /> Closed</span>}
          {snapshot.savedAt && !isClosed && (
            <span className="ds-saved-tag">Last saved {new Date(snapshot.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          )}
        </div>
        <div className="ds-header-actions">
          <button className="ds-btn ds-btn-ghost" onClick={() => load(date)} disabled={loading || saving}>
            <RefreshCw size={13} /> Refresh
          </button>
          {!isClosed && (
            <>
              <button className="ds-btn ds-btn-primary" onClick={save} disabled={!dirty || saving}>
                <Save size={13} /> {saving ? 'Saving…' : 'Save'}
              </button>
              <button className="ds-btn ds-btn-success" onClick={close} disabled={saving}>
                <Lock size={13} /> Close Day
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── 3-column body ───────────────────────────────────── */}
      <div className="ds-columns">

        {/* ─── LEFT COLUMN — Lottery + Other Income + Money In ─── */}
        <section className="ds-col">
          <Card title={<><span>Lottery Sales</span><strong>{fmt(snapshot.lottery.lottoSales + snapshot.lottery.scratchoffSales)}</strong></>}>
            <Row label="Lotto Sales"       value={fmt(snapshot.lottery.lottoSales)} muted />
            <Row label="Scratchoff Sales"  value={fmt(snapshot.lottery.scratchoffSales)} muted />
          </Card>

          <Card>
            <Row label="Lotto PO"          value={fmt(snapshot.lottery.lottoPO)} />
            <Row label="Scratchoff PO"     value={fmt(snapshot.lottery.scratchoffPO)} />
            <Row label="Cash Balance" bold value={fmt(snapshot.lottery.cashBalance)} />
          </Card>

          <Card>
            <EditRow
              label="Other Income"
              readOnly={isClosed}
              value={v('otherIncome') ?? snapshot.otherIncome}
              onChange={(x) => patch('otherIncome', x)}
            />
          </Card>

          <Card>
            <EditRow
              label="Money In (Bank)"
              hint="Starter cash / float added to drawer today"
              readOnly={isClosed}
              value={v('moneyIn') ?? snapshot.moneyIn}
              onChange={(x) => patch('moneyIn', x)}
            />
          </Card>
        </section>

        {/* ─── MIDDLE COLUMN — Dept Sales + Totalizer + Tax ─── */}
        <section className="ds-col">
          <Card title={<><span>Total Sales</span><strong>{fmt(depTotal)}</strong></>}>
            <div className="ds-dept-head">
              <span>Department</span>
              <span>Auto</span>
              <span>Adj.</span>
              <span>Total</span>
            </div>
            {deptRows.length === 0 && (
              <div className="ds-empty">No department sales recorded.</div>
            )}
            {deptRows.map((d) => (
              <div key={d.key} className="ds-dept-row">
                <span className="ds-dept-name">{d.name}</span>
                <span className="ds-dept-auto">{fmt(d.autoAmount)}</span>
                <input
                  type="number"
                  step="0.01"
                  disabled={isClosed}
                  className="ds-dept-adj"
                  value={d.adjustment || 0}
                  onChange={(e) => patchDeptAdj(d.key, e.target.value)}
                />
                <span className={`ds-dept-total ${d.finalAmount !== d.autoAmount ? 'ds-dept-total--adj' : ''}`}>
                  {fmt(d.finalAmount)}
                </span>
              </div>
            ))}
          </Card>

          <Card title="Totalizer (Lottery Terminal)">
            <EditRow label="Totalizer End"   readOnly={isClosed} value={v('totalizerEnd')   ?? snapshot.totalizerEnd}   onChange={(x) => patch('totalizerEnd',   x)} />
            <EditRow label="Totalizer Begin" readOnly={isClosed} value={v('totalizerBegin') ?? snapshot.totalizerBegin} onChange={(x) => patch('totalizerBegin', x)} />
            <EditRow label="Voids"           readOnly={isClosed} value={v('voids')          ?? snapshot.voids}          onChange={(x) => patch('voids',          x)} />
            <EditRow label="Customer Count"  readOnly={isClosed} int                          value={v('customerCount')  ?? snapshot.customerCount}  onChange={(x) => patch('customerCount',  x)} />
            <div className="ds-field">
              <label>Report Numbers</label>
              <input
                type="text"
                disabled={isClosed}
                value={v('reportNumbers') ?? snapshot.reportNumbers ?? ''}
                onChange={(e) => patch('reportNumbers', e.target.value)}
                placeholder="Lottery terminal receipt #s"
              />
            </div>
          </Card>

          <Card title={<><span>Sales Tax</span><strong>{fmt(snapshot.salesTax)}</strong></>}>
            <EditRow
              label="Override"
              hint="Leave blank to use POS-computed tax"
              readOnly={isClosed}
              value={v('salesTaxOverride') ?? snapshot.salesTaxOverride}
              onChange={(x) => patch('salesTaxOverride', x)}
            />
          </Card>
        </section>

        {/* ─── RIGHT COLUMN — Totals / Short-Over + Store Money + Paidouts + Notes ─── */}
        <section className="ds-col">
          <Card className={`ds-shortover ds-shortover--${shortOverDisplay?.sign || 'even'}`}>
            <Row label="Total In"  bold value={fmt(liveTotals?.totalIn)} />
            <Row label="Total Out" bold value={fmt(liveTotals?.totalOut)} />
            <div className="ds-shortover-tag">
              <span>Short/Over</span>
              <span className={`ds-shortover-val ds-shortover-val--${shortOverDisplay?.sign || 'even'}`}>
                {shortOverDisplay?.label}
              </span>
            </div>
          </Card>

          <Card>
            <Row label="Inside Sale" value={fmt(liveTotals?.insideSale)} />
          </Card>

          <Card title="House Accounts">
            <HouseAcctsEditor
              list={v('houseAccounts') ?? snapshot.houseAccounts ?? []}
              readOnly={isClosed}
              onChange={patchHouseAccts}
            />
          </Card>

          <Card title="Store Money">
            <EditRow label="Bank Deposit"     readOnly={isClosed} value={v('bankDeposit')    ?? snapshot.bankDeposit}    onChange={(x) => patch('bankDeposit',    x)} />
            <EditRow label="Lottery Deposit"  readOnly={isClosed} value={v('lotteryDeposit') ?? snapshot.lotteryDeposit} onChange={(x) => patch('lotteryDeposit', x)} />
            <EditRow label="Credit Card"      readOnly={isClosed} hint={`POS tender: ${fmt(snapshot.tenders.credit)}`} value={v('creditCardTotal') ?? snapshot.creditCardTotal} onChange={(x) => patch('creditCardTotal', x)} />
            <EditRow label="Debit Card"       readOnly={isClosed} hint={`POS tender: ${fmt(snapshot.tenders.debit)}`}  value={v('debitCardTotal')  ?? snapshot.debitCardTotal}  onChange={(x) => patch('debitCardTotal',  x)} />
          </Card>

          <Card title="Cash Paidouts">
            <EditRow label="Purchase Cash PO" readOnly={isClosed} hint={`Vendor payments: ${fmt(snapshot.purchaseCashPO)}`} value={v('purchaseCashPO') ?? snapshot.purchaseCashPO} onChange={(x) => patch('purchaseCashPO', x)} />
            <EditRow label="Expense Cash PO"  readOnly={isClosed} hint={`Drawer paidouts + expense: ${fmt(snapshot.expenseCashPO)}`} value={v('expenseCashPO') ?? snapshot.expenseCashPO}  onChange={(x) => patch('expenseCashPO',  x)} />
          </Card>

          <Card title="Cash Drawer (from Shifts)">
            <Row label="Cash Counted"   value={snapshot.cashCounted != null ? fmt(snapshot.cashCounted) : '—'} muted />
            <Row label="Closed Shifts"  value={String(snapshot.cashFromShifts?.closedCount ?? 0)} muted />
            {snapshot.cashFromShifts?.varianceFromShifts !== undefined && Math.abs(snapshot.cashFromShifts.varianceFromShifts) > 0.005 && (
              <Row label="Variance" value={fmt(snapshot.cashFromShifts.varianceFromShifts)} muted />
            )}
            <EditRow
              label="Override Cash Count"
              hint="Leave blank to use the cashier's closing amount"
              readOnly={isClosed}
              value={v('cashCounted') ?? ''}
              onChange={(x) => patch('cashCounted', x)}
            />
          </Card>

          <Card title="Notes">
            <textarea
              className="ds-notes"
              disabled={isClosed}
              rows={3}
              placeholder="Anything unusual about today's reconciliation…"
              value={v('notes') ?? snapshot.notes ?? ''}
              onChange={(e) => patch('notes', e.target.value)}
            />
          </Card>

          <Card title="Paidouts Audit" subtle>
            {(snapshot.paidoutsSource?.length || 0) === 0 ? (
              <div className="ds-empty ds-empty--small">No paidouts recorded today.</div>
            ) : (
              <ul className="ds-paidout-list">
                {snapshot.paidoutsSource.map((p, i) => (
                  <li key={i}>
                    <span className={`ds-paidout-tag ds-paidout-tag--${p.type}`}>{p.type}</span>
                    <span>{p.recipient || '—'}</span>
                    <span className="ds-paidout-amt">{fmt(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
function Card({ title, subtle, className, children }) {
  return (
    <div className={`ds-card ${subtle ? 'ds-card--subtle' : ''} ${className || ''}`}>
      {title && <div className="ds-card-title">{title}</div>}
      <div className="ds-card-body">{children}</div>
    </div>
  );
}

function Row({ label, value, muted, bold }) {
  return (
    <div className={`ds-row ${muted ? 'ds-row--muted' : ''} ${bold ? 'ds-row--bold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function EditRow({ label, value, onChange, readOnly, int, hint }) {
  return (
    <div className="ds-field">
      <label>{label}</label>
      <input
        type="number"
        step={int ? '1' : '0.01'}
        disabled={readOnly}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : (int ? parseInt(e.target.value) || 0 : Number(e.target.value)))}
      />
      {hint && <span className="ds-hint"><Info size={11} /> {hint}</span>}
    </div>
  );
}

function HouseAcctsEditor({ list, onChange, readOnly }) {
  const total = (list || []).reduce((s, h) => s + Number(h.amount || 0), 0);
  const update = (idx, patch) => {
    const next = [...list];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const remove = (idx) => {
    const next = list.filter((_, i) => i !== idx);
    onChange(next);
  };
  const addNew = () => {
    onChange([...list, { customerName: '', amount: 0, note: '' }]);
  };
  return (
    <div>
      {(list || []).length === 0 ? (
        <div className="ds-empty ds-empty--small">No house account entries.</div>
      ) : (
        <div className="ds-house">
          <div className="ds-house-head">
            <span>Customer</span>
            <span>Amount</span>
            <span>Note</span>
            <span></span>
          </div>
          {list.map((h, i) => (
            <div key={i} className="ds-house-row">
              <input type="text" placeholder="Name" value={h.customerName || ''} disabled={readOnly}
                onChange={(e) => update(i, { customerName: e.target.value })} />
              <input type="number" step="0.01" value={h.amount || 0} disabled={readOnly}
                onChange={(e) => update(i, { amount: Number(e.target.value) })} />
              <input type="text" placeholder="Note" value={h.note || ''} disabled={readOnly}
                onChange={(e) => update(i, { note: e.target.value })} />
              <button className="ds-house-del" onClick={() => remove(i)} disabled={readOnly} aria-label="Remove">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <div className="ds-house-total">
            <span>Total</span>
            <span>{fmt(total)}</span>
          </div>
        </div>
      )}
      {!readOnly && (
        <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={addNew} style={{ marginTop: 8 }}>
          <Plus size={12} /> Add entry
        </button>
      )}
    </div>
  );
}
