/**
 * TenderModal v7 — side-by-side layout, phone-style numpad, no scrolling.
 *
 * Amount state stores raw DIGITS (phone-terminal style):
 *   typing "589" → $5.89   |   backspace → $0.58
 *   pressing $30 preset   → digits "3000" → display "$30.00"
 *
 * Layout: left column (context) + right column (numpad) — no scrolling needed.
 *
 * Screens:
 *   change       → full-width change-due card
 *   card-quick   → full-width tap-terminal card
 *   manual_card  → side-by-side dedicated
 *   manual_ebt   → side-by-side dedicated
 *   entry        → side-by-side full modal (numpad hidden for 'card' method)
 */

import React, { useState, useMemo } from 'react';
import {
  X, DollarSign, CreditCard, Leaf, Smartphone,
  MoreHorizontal, Check, RotateCcw,
  Printer, RefreshCw, Trash2, PlusCircle,
} from 'lucide-react';
import NumPadInline, { digitsToNumber, numberToDigits } from '../pos/NumPadInline.jsx';
import { useCartStore, selectTotals } from '../../stores/useCartStore.js';
import { useSyncStore }  from '../../stores/useSyncStore.js';
import { useAuthStore }  from '../../stores/useAuthStore.js';
import { submitTransaction } from '../../api/pos.js';
import * as posApi from '../../api/pos.js';
import { fmt$, fmtDate, fmtTime, fmtTxNumber } from '../../utils/formatters.js';
import { getSmartCashPresets, applyRounding } from '../../utils/cashPresets.js';
import { nanoid } from 'nanoid';
import { useHardware, loadHardwareConfig } from '../../hooks/useHardware.js';
import { useStationStore } from '../../stores/useStationStore.js';

// ── Method definitions ────────────────────────────────────────────────────────
const METHODS = [
  { id: 'cash',        label: 'Cash',        Icon: DollarSign,     color: 'var(--green)',          bg: 'rgba(122,193,67,.15)',  border: 'rgba(122,193,67,.4)'  },
  { id: 'card',        label: 'Card',        Icon: CreditCard,     color: 'var(--blue)',           bg: 'rgba(59,130,246,.15)',  border: 'rgba(59,130,246,.4)'  },
  { id: 'ebt',         label: 'EBT',         Icon: Leaf,           color: '#34d399',               bg: 'rgba(52,211,153,.13)',  border: 'rgba(52,211,153,.4)'  },
  { id: 'manual_card', label: 'Manual Card', Icon: Smartphone,     color: 'var(--text-secondary)', bg: 'rgba(255,255,255,.07)', border: 'rgba(255,255,255,.18)'},
  { id: 'manual_ebt',  label: 'Manual EBT',  Icon: Leaf,           color: '#6ee7b7',               bg: 'rgba(110,231,183,.1)',  border: 'rgba(110,231,183,.3)' },
  { id: 'other',       label: 'Other',       Icon: MoreHorizontal, color: 'var(--text-secondary)', bg: 'rgba(255,255,255,.07)', border: 'rgba(255,255,255,.18)'},
];
const BY_ID       = Object.fromEntries(METHODS.map(m => [m.id, m]));
const HAS_AMOUNT  = ['cash', 'manual_card', 'manual_ebt', 'other'];
const GIVES_CHANGE = ['cash'];

// ── Style helpers ─────────────────────────────────────────────────────────────
const s = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(0,0,0,.72)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '1rem',
  },
  modal: (maxW = 720) => ({
    width: '100%', maxWidth: maxW,
    background: 'var(--bg-panel)', borderRadius: 20,
    border: '1px solid var(--border-light)',
    display: 'flex', flexDirection: 'column',
    maxHeight: '94vh', overflow: 'hidden',
    boxShadow: '0 32px 80px rgba(0,0,0,.65)',
    position: 'relative',
  }),
  hdr: {
    padding: '0.875rem 1.25rem',
    borderBottom: '1px solid var(--border)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    flexShrink: 0,
  },
  closeBtn: { background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center' },
  bigBtn: (color = 'var(--green)', disabled = false) => ({
    width: '100%', padding: '1.1rem', borderRadius: 14,
    fontWeight: 800, fontSize: '1rem',
    background: disabled ? 'var(--bg-input)' : color,
    color: disabled ? 'var(--text-muted)' : '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    boxShadow: disabled ? 'none' : '0 4px 16px rgba(0,0,0,.3)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background .12s', border: 'none',
  }),
  splitAddBtn: {
    width: '100%', padding: '0.7rem', background: 'var(--bg-card)',
    border: '1px solid var(--border)', borderRadius: 10,
    color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.82rem',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
};

// numpad right column wrapper
const numpadCol = {
  width: 252, flexShrink: 0,
  padding: '0.875rem',
  display: 'flex', alignItems: 'center',
  borderLeft: '1px solid var(--border)',
};

// ── Hidden receipt for window.print() ────────────────────────────────────────
function PrintableReceipt({ tx, totals, change, cashier }) {
  if (!tx) return null;
  return (
    <div className="receipt-print" style={{ position: 'fixed', left: -9999, top: 0, width: 320, fontFamily: 'monospace', fontSize: 12 }}>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>RECEIPT</div>
        <div>{fmtTxNumber(tx.txNumber)} · {fmtDate()} {fmtTime()}</div>
        <div>Cashier: {cashier?.name || cashier?.email}</div>
      </div>
      <hr />
      {tx.lineItems?.map((item, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{item.qty > 1 ? `${item.qty}× ` : ''}{item.name}</span>
          <span>{fmt$(item.lineTotal)}</span>
        </div>
      ))}
      <hr />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{fmt$(totals.subtotal)}</span></div>
      {totals.taxTotal > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tax</span><span>{fmt$(totals.taxTotal)}</span></div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>TOTAL</span><span>{fmt$(totals.grandTotal)}</span></div>
      <hr />
      {tx.tenderLines?.map((t, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t.method.replace('_', ' ').toUpperCase()}</span><span>{fmt$(t.amount)}</span>
        </div>
      ))}
      {change > 0.005 && <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>CHANGE</span><span>{fmt$(change)}</span></div>}
      <div style={{ textAlign: 'center', marginTop: 8 }}>Thank you!</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function TenderModal({
  onClose,
  onComplete,              // optional: called with (completedTx) after transaction saves
  taxRules       = [],
  initMethod     = null,
  initCashAmount = null,   // numeric dollar amount from quick-cash buttons
  cashRounding   = 'none',
  lotteryCashOnly = false,
}) {
  const { items, clearCart } = useCartStore();
  const totals  = selectTotals(items, taxRules);
  const hasLotteryItems  = items.some(i => i.isLottery);
  const allowedMethods   = (lotteryCashOnly && hasLotteryItems)
    ? METHODS.filter(m => m.id === 'cash')
    : METHODS;
  const cashier = useAuthStore(s => s.cashier);
  const { isOnline, enqueue } = useSyncStore();
  const station = useStationStore(s => s.station);

  // ── State ──────────────────────────────────────────────────────────────────
  const [splits,  setSplits]  = useState([]);
  const [method,  setMethod]  = useState(initMethod || (totals.ebtTotal > 0 ? 'ebt' : 'cash'));
  const [payStatus, setPayStatus] = useState(null); // null | 'waiting' | 'approved' | 'declined' | 'error'
  const [payResult, setPayResult] = useState(null);
  const hw = loadHardwareConfig();
  const hasPAX = !!(hw?.paxTerminal?.enabled && hw?.paxTerminal?.ip);
  // amount = raw digit string. "2694" → $26.94  (phone-terminal style)
  const [amount,  setAmount]  = useState(initCashAmount ? numberToDigits(initCashAmount) : '');
  const [note,    setNote]    = useState('');
  const [saving,  setSaving]  = useState(false);

  const [screen,       setScreen]       = useState('entry');
  const [completedTx,  setCompletedTx]  = useState(null);
  const [completedChg, setCompletedChg] = useState(0);

  // ── Derived values ─────────────────────────────────────────────────────────
  const totalSplit = splits.reduce((s, l) => s + l.amount, 0);
  const remaining  = Math.max(0, Math.round((totals.grandTotal - totalSplit) * 100) / 100);
  const activeAmt  = digitsToNumber(amount);  // digit string → dollars

  const rawChange = GIVES_CHANGE.includes(method) && activeAmt > remaining ? activeAmt - remaining : 0;
  const change    = applyRounding(rawChange, cashRounding);

  const presets = useMemo(() => getSmartCashPresets(remaining), [remaining]);

  const canComplete = useMemo(() => {
    if (totalSplit >= totals.grandTotal - 0.005) return true;
    if (method === 'card' || method === 'manual_card') return remaining > 0;
    if (GIVES_CHANGE.includes(method)) return activeAmt >= remaining - 0.005;
    if (method === 'ebt' || method === 'manual_ebt') return activeAmt > 0;
    if (method === 'other') return activeAmt > 0;
    return false;
  }, [method, activeAmt, remaining, totalSplit, totals.grandTotal]);

  const canAddSplit = HAS_AMOUNT.includes(method) && activeAmt > 0 && activeAmt < remaining - 0.005;

  const showNumpad  = HAS_AMOUNT.includes(method);  // false for 'card'

  const storeId  = cashier?.storeId || cashier?.stores?.[0]?.storeId;
  const txNumber = `TXN-${Date.now().toString(36).toUpperCase()}`;

  // ── Helpers ────────────────────────────────────────────────────────────────
  const switchMethod = (id) => { setMethod(id); setAmount(''); setNote(''); };

  const addSplitLine = () => {
    if (!HAS_AMOUNT.includes(method) || activeAmt <= 0) return;
    const m = BY_ID[method];
    setSplits(prev => [...prev, {
      id: nanoid(), method,
      label: note ? `${m.label} (${note})` : m.label,
      amount: Math.min(activeAmt, remaining),
    }]);
    setAmount(''); setNote(''); setMethod('cash');
  };

  const removeSplit = (id) => setSplits(prev => prev.filter(l => l.id !== id));

  const finish = (finalTx, cashChange) => {
    onComplete?.(finalTx);           // notify POSScreen so it can reprint later
    if (cashChange > 0.005) {
      setCompletedTx(finalTx); setCompletedChg(cashChange); setScreen('change');
    } else {
      clearCart(); onClose();
    }
    setSaving(false);
  };

  const complete = async () => {
    if (!canComplete || saving) return;

    if (method === 'card' && hasPAX && payStatus !== 'approved') {
      // Start PAX payment flow
      const invoiceNum = Date.now().toString();
      setPayStatus('waiting');
      try {
        const result = await posApi.paxSale({
          amount: totals.grandTotal,
          invoiceNumber: invoiceNum,
          edcType: '02',  // debit default
          stationId: station?.id,
        });
        if (result.approved) {
          setPayStatus('approved');
          setPayResult(result.data);
          // Continue with normal submit — don't return, fall through
        } else {
          setPayStatus('declined');
          setPayResult(result.data);
          return; // stop here on declined
        }
      } catch (err) {
        setPayStatus('error');
        setPayResult({ message: err.message });
        return;
      }
    }
    // Reset PAX status after successful submit
    setPayStatus(null);
    setPayResult(null);

    setSaving(true);

    const finalLines = [...splits.map(({ method: m, label, amount: a }) => ({ method: m, label, amount: a }))];
    if (method === 'card' || method === 'manual_card') {
      finalLines.push({ method, amount: remaining });
    } else if (activeAmt > 0) {
      finalLines.push({ method, amount: activeAmt, ...(note ? { note } : {}) });
    }

    const payload = {
      localId: nanoid(), storeId, txNumber,
      lineItems: items.filter(i => !i.isLottery),
      lotteryItems: items.filter(i => i.isLottery).map(i => ({
        type:   i.lotteryType,
        amount: Math.abs(i.lineTotal),
        gameId: i.gameId || undefined,
        notes:  i.name,
      })),
      tenderLines: finalLines,
      changeGiven: change,
      offlineCreatedAt: new Date().toISOString(),
      ...totals,
    };

    try {
      if (isOnline) {
        const saved = await submitTransaction(payload);
        finish({ ...payload, id: saved.id, txNumber: saved.txNumber || txNumber }, change);
      } else {
        await enqueue(payload);
        finish({ ...payload, txNumber }, change);
      }
    } catch {
      await enqueue(payload);
      finish({ ...payload, txNumber }, change);
    }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // SCREEN: CHANGE DUE
  // ════════════════════════════════════════════════════════════════════════════
  if (screen === 'change' && completedTx) {
    const handleDone  = () => { clearCart(); onClose(); };
    const handlePrint = () => { window.print(); clearCart(); onClose(); };
    return (
      <>
        <PrintableReceipt tx={completedTx} totals={totals} change={completedChg} cashier={cashier} />
        <div style={s.backdrop}>
          <div style={{ width: '100%', maxWidth: 400, background: 'var(--bg-panel)', borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(122,193,67,.3)', boxShadow: '0 32px 80px rgba(0,0,0,.7)' }}>
            <div style={{ background: 'rgba(122,193,67,.1)', borderBottom: '1px solid rgba(122,193,67,.2)', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Check size={15} color="#0f1117" strokeWidth={3} />
              </div>
              <span style={{ fontWeight: 800, color: 'var(--green)', fontSize: '0.95rem' }}>Sale Complete</span>
              <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{fmtTxNumber(completedTx.txNumber)}</span>
            </div>
            <div style={{ padding: '2rem 1.5rem 1.25rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 8 }}>CHANGE DUE</div>
              <div style={{ fontSize: '4.5rem', fontWeight: 900, color: 'var(--green)', letterSpacing: '-0.03em', lineHeight: 1 }}>{fmt$(completedChg)}</div>
              {cashRounding === '0.05' && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>Rounded to nearest $0.05</div>}
              <div style={{ marginTop: '1.25rem', display: 'flex', gap: 6, justifyContent: 'center', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <span>Total: {fmt$(totals.grandTotal)}</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <span>Cash: {fmt$(completedTx.tenderLines?.find(l => l.method === 'cash')?.amount || activeAmt)}</span>
              </div>
            </div>
            <div style={{ padding: '0 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={handleDone} style={s.bigBtn('var(--green)')}>
                <RefreshCw size={18} /> Done — New Sale
              </button>
              <button onClick={handlePrint} style={{ width: '100%', padding: '0.875rem', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, cursor: 'pointer' }}>
                <Printer size={16} /> Print Receipt &amp; Done
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCREEN: CARD QUICK MODE (no numpad — just confirm)
  // ════════════════════════════════════════════════════════════════════════════
  if (initMethod === 'card' && splits.length === 0) {
    return (
      <div style={s.backdrop}>
        <div style={{ ...s.modal(440), border: '1px solid rgba(59,130,246,.3)' }}>
          <div style={{ ...s.hdr, background: 'rgba(59,130,246,.06)', borderBottomColor: 'rgba(59,130,246,.18)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CreditCard size={16} color="var(--blue)" />
              <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--blue)' }}>Card Payment</span>
            </div>
            <button onClick={onClose} style={s.closeBtn}><X size={16} /></button>
          </div>
          <div style={{ padding: '2.5rem 1.5rem 1.5rem', textAlign: 'center' }}>
            <div style={{ fontSize: '3.25rem', fontWeight: 900, color: 'var(--blue)', letterSpacing: '-0.02em' }}>{fmt$(totals.grandTotal)}</div>
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: '0.88rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', display: 'inline-block', opacity: 0.8 }} />
              Please tap / swipe / insert on terminal
            </div>
          </div>
          <div style={{ padding: '0 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={complete} disabled={saving} style={s.bigBtn('var(--blue, #3b82f6)', saving)}>
              {saving ? <><RotateCcw size={18} style={{ animation: 'spin 1s linear infinite' }} /> Processing…</> : <><Check size={18} /> Payment Complete — Confirm</>}
            </button>
            <button onClick={() => switchMethod('cash')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer', padding: '4px 0' }}>
              Split payment or other method
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCREEN: MANUAL CARD — side-by-side
  // ════════════════════════════════════════════════════════════════════════════
  if (method === 'manual_card' && splits.length === 0 && !initMethod) {
    return (
      <div style={s.backdrop}>
        <div style={s.modal(620)}>
          {/* Header */}
          <div style={s.hdr}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Smartphone size={16} color="var(--text-secondary)" />
              <div>
                <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Manual Card</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>No terminal — enter amount manually</div>
              </div>
            </div>
            <button onClick={onClose} style={s.closeBtn}><X size={16} /></button>
          </div>

          {/* Side-by-side body */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left — context */}
            <div style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
              {/* Amount to charge */}
              <div style={{ background: 'rgba(59,130,246,.06)', border: '1px solid rgba(59,130,246,.18)', borderRadius: 12, padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 6 }}>CHARGE AMOUNT</div>
                <div style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--blue)', letterSpacing: '-0.02em' }}>{fmt$(remaining)}</div>
              </div>
              {/* Charge-full shortcut */}
              <button
                onClick={() => setAmount(numberToDigits(remaining))}
                style={{
                  width: '100%', padding: '0.875rem', borderRadius: 10, cursor: 'pointer',
                  background: activeAmt === remaining && amount ? 'rgba(59,130,246,.12)' : 'var(--bg-input)',
                  border: `1.5px solid ${activeAmt === remaining && amount ? 'rgba(59,130,246,.4)' : 'var(--border)'}`,
                  color: activeAmt === remaining && amount ? 'var(--blue)' : 'var(--text-primary)',
                  fontWeight: 700, fontSize: '0.9rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'all .12s',
                }}
              >
                <Check size={14} /> Charge full — {fmt$(remaining)}
              </button>
              {activeAmt > 0 && activeAmt < remaining - 0.005 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--amber)', textAlign: 'center', fontWeight: 600 }}>
                  Remaining {fmt$(remaining - activeAmt)} needs another method
                </div>
              )}
            </div>
            {/* Right — numpad */}
            <div style={numpadCol}>
              <NumPadInline value={amount} onChange={setAmount} accentColor="var(--blue, #3b82f6)" />
            </div>
          </div>

          {/* Footer */}
          <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {canAddSplit && (
              <button onClick={addSplitLine} style={s.splitAddBtn}>
                <PlusCircle size={14} /> Add {fmt$(activeAmt)} Manual Card — pay {fmt$(remaining - activeAmt)} with another method
              </button>
            )}
            <button onClick={complete} disabled={!canComplete || saving} style={s.bigBtn('var(--blue, #3b82f6)', !canComplete || saving)}>
              {saving ? <><RotateCcw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processing…</> : <><CreditCard size={16} /> Complete Manual Card — {fmt$(Math.min(activeAmt || remaining, remaining))}</>}
            </button>
            <button onClick={() => switchMethod('cash')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'center' }}>
              ← Back to payment methods
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCREEN: MANUAL EBT — side-by-side
  // ════════════════════════════════════════════════════════════════════════════
  if (method === 'manual_ebt' && splits.length === 0 && !initMethod) {
    const ebtMax = Math.min(totals.ebtTotal, remaining);
    return (
      <div style={s.backdrop}>
        <div style={s.modal(620)}>
          {/* Header */}
          <div style={s.hdr}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Leaf size={16} color="#6ee7b7" />
              <div>
                <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Manual EBT</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Enter EBT amount manually</div>
              </div>
            </div>
            <button onClick={onClose} style={s.closeBtn}><X size={16} /></button>
          </div>

          {/* Side-by-side body */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left */}
            <div style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
              {totals.ebtTotal > 0 && (
                <div style={{ background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.25)', borderRadius: 12, padding: '0.875rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Leaf size={13} color="#34d399" />
                    <span style={{ fontSize: '0.82rem', color: '#34d399', fontWeight: 600 }}>EBT eligible</span>
                  </div>
                  <span style={{ fontWeight: 900, color: '#34d399', fontSize: '1.1rem' }}>{fmt$(totals.ebtTotal)}</span>
                </div>
              )}
              {/* Use-full shortcut */}
              <button
                onClick={() => setAmount(numberToDigits(ebtMax))}
                style={{
                  width: '100%', padding: '0.875rem', borderRadius: 10, cursor: 'pointer',
                  background: activeAmt === ebtMax && amount ? 'rgba(52,211,153,.15)' : 'var(--bg-input)',
                  border: `1.5px solid ${activeAmt === ebtMax && amount ? 'rgba(52,211,153,.4)' : 'var(--border)'}`,
                  color: '#34d399', fontWeight: 700, fontSize: '0.9rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'all .12s',
                }}
              >
                <Leaf size={14} /> Use full EBT — {fmt$(ebtMax)}
              </button>
              {activeAmt > 0 && activeAmt < remaining - 0.005 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--amber)', textAlign: 'center', fontWeight: 600 }}>
                  Remaining {fmt$(remaining - activeAmt)} needs cash or card
                </div>
              )}
            </div>
            {/* Right — numpad */}
            <div style={numpadCol}>
              <NumPadInline value={amount} onChange={setAmount} accentColor="#34d399" />
            </div>
          </div>

          {/* Footer */}
          <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {canAddSplit && (
              <button onClick={addSplitLine} style={{ ...s.splitAddBtn, background: 'rgba(52,211,153,.06)', border: '1px solid rgba(52,211,153,.2)', color: '#34d399' }}>
                <PlusCircle size={14} /> Add {fmt$(activeAmt)} EBT — Pay {fmt$(remaining - activeAmt)} with cash/card
              </button>
            )}
            <button onClick={complete} disabled={!canComplete || saving} style={s.bigBtn('#34d399', !canComplete || saving)}>
              {saving ? <><RotateCcw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processing…</> : <><Check size={16} /> Complete with Manual EBT</>}
            </button>
            <button onClick={() => switchMethod('cash')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'center' }}>
              ← Back to payment methods
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCREEN: FULL ENTRY MODAL — side-by-side
  //   Left  → order info, splits, method chips, method-specific context
  //   Right → NumPadInline (hidden for 'card' method)
  // ════════════════════════════════════════════════════════════════════════════
  const activeM    = BY_ID[method];
  const padColor   = method === 'ebt'        ? '#34d399'
                   : method === 'manual_ebt' ? '#6ee7b7'
                   : method === 'manual_card'? 'var(--blue, #3b82f6)'
                   : 'var(--green)';

  return (
    <div style={s.backdrop}>
      <div style={s.modal(720)}>

        {/* Header */}
        <div style={s.hdr}>
          <span style={{ fontWeight: 800, fontSize: '1rem' }}>Tender</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--green)' }}>{fmt$(totals.grandTotal)}</span>
            <button onClick={onClose} style={s.closeBtn}><X size={16} /></button>
          </div>
        </div>

        {/* Body — side by side */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ── Left column ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Committed splits */}
            {splits.length > 0 && (
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.5rem 0.875rem' }}>
                {splits.map(line => {
                  const m = BY_ID[line.method]; const Icon = m?.Icon || DollarSign;
                  return (
                    <div key={line.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.3rem 0', borderBottom: '1px solid var(--border)' }}>
                      <Icon size={13} color={m?.color} />
                      <span style={{ flex: 1, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{line.label}</span>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{fmt$(line.amount)}</span>
                      <button onClick={() => removeSplit(line.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: '2px 4px' }}><Trash2 size={12} /></button>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.4rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Remaining</span>
                  <span style={{ fontWeight: 800, color: remaining > 0 ? 'var(--amber)' : 'var(--green)' }}>
                    {remaining > 0 ? fmt$(remaining) : '✓ Paid'}
                  </span>
                </div>
              </div>
            )}

            {/* Method selector */}
            <div>
              <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 6 }}>PAYMENT METHOD</div>
              {lotteryCashOnly && hasLotteryItems && (
                <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '7px 12px', marginBottom: 10, fontSize: '0.78rem', color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  🎟️ Lottery items — cash only
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {allowedMethods.map(m => {
                  const Icon = m.Icon; const active = method === m.id;
                  return (
                    <button key={m.id} onClick={() => switchMethod(m.id)} style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '0.45rem 0.8rem', borderRadius: 20,
                      background: active ? m.bg : 'var(--bg-input)',
                      border: `1.5px solid ${active ? m.border : 'var(--border)'}`,
                      color: active ? m.color : 'var(--text-muted)',
                      fontWeight: active ? 700 : 500, fontSize: '0.78rem',
                      cursor: 'pointer', flexShrink: 0, transition: 'all .12s',
                    }}>
                      <Icon size={12} />{m.label}
                      {hasPAX && m.id === 'card' && <span style={{ fontSize: '0.6rem', background: '#1e3a5f', color: '#60a5fa', borderRadius: 4, padding: '1px 5px', marginLeft: 4, fontWeight: 700 }}>PAX</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── CASH: quick presets + change preview ── */}
            {method === 'cash' && (
              <>
                <div>
                  <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 6 }}>QUICK CASH</div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {/* Exact */}
                    <button onClick={() => setAmount(numberToDigits(remaining))} style={{
                      padding: '0.5rem 0.75rem', borderRadius: 8,
                      background: activeAmt === remaining && amount ? 'var(--green)' : 'var(--bg-input)',
                      color: activeAmt === remaining && amount ? '#0f1117' : 'var(--text-secondary)',
                      border: `1px solid ${activeAmt === remaining && amount ? 'var(--green)' : 'var(--border)'}`,
                      fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.25,
                    }}>
                      <span>{fmt$(remaining)}</span>
                      <span style={{ fontSize: '0.46rem', opacity: 0.65, fontWeight: 600 }}>EXACT</span>
                    </button>
                    {/* Smart presets */}
                    {presets.map((amt, i) => (
                      <button key={amt} onClick={() => setAmount(numberToDigits(amt))} style={{
                        padding: '0.5rem 0.75rem', borderRadius: 8,
                        background: activeAmt === amt ? 'var(--green)' : i < 2 ? 'rgba(245,158,11,.08)' : 'var(--bg-card)',
                        color: activeAmt === amt ? '#0f1117' : i < 2 ? 'var(--amber)' : 'var(--text-secondary)',
                        border: `1px solid ${activeAmt === amt ? 'var(--green)' : i < 2 ? 'rgba(245,158,11,.3)' : 'var(--border)'}`,
                        fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
                      }}>
                        {fmt$(amt)}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Change preview */}
                {change > 0 && (
                  <div style={{ padding: '0.75rem 1rem', borderRadius: 10, background: 'rgba(122,193,67,.08)', border: '1px solid rgba(122,193,67,.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--green)', fontSize: '0.85rem' }}>Change Due</div>
                      {cashRounding === '0.05' && rawChange !== change && (
                        <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)' }}>Rounded from {fmt$(rawChange)}</div>
                      )}
                    </div>
                    <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--green)' }}>{fmt$(change)}</span>
                  </div>
                )}
              </>
            )}

            {/* ── CARD: terminal prompt (full left area) ── */}
            {method === 'card' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '1rem', background: 'rgba(59,130,246,.05)', borderRadius: 12, border: '1px solid rgba(59,130,246,.18)', textAlign: 'center' }}>
                <CreditCard size={44} color="var(--blue)" style={{ opacity: .65 }} />
                <div style={{ fontSize: '1.9rem', fontWeight: 900, color: 'var(--blue)', letterSpacing: '-0.02em' }}>{fmt$(remaining)}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Tap / swipe / insert on terminal</div>
              </div>
            )}

            {/* ── EBT: eligible band + shortcut ── */}
            {method === 'ebt' && (
              <>
                {totals.ebtTotal > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.6rem 0.875rem', borderRadius: 8, background: 'rgba(52,211,153,.07)', border: '1px solid rgba(52,211,153,.2)' }}>
                    <Leaf size={13} color="#34d399" />
                    <span style={{ fontSize: '0.8rem', color: '#34d399', fontWeight: 600, flex: 1 }}>EBT eligible: {fmt$(totals.ebtTotal)}</span>
                    <button onClick={() => setAmount(numberToDigits(Math.min(totals.ebtTotal, remaining)))} style={{ background: '#34d399', border: 'none', borderRadius: 6, color: '#0f1117', padding: '0.2rem 0.7rem', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>
                      Use full
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── MANUAL CARD (in split flow) ── */}
            {method === 'manual_card' && splits.length > 0 && (
              <button onClick={() => setAmount(numberToDigits(remaining))} style={{ width: '100%', padding: '0.75rem', borderRadius: 10, cursor: 'pointer', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Check size={14} /> Charge full remaining — {fmt$(remaining)}
              </button>
            )}

            {/* ── MANUAL EBT (in split flow) ── */}
            {method === 'manual_ebt' && splits.length > 0 && (
              <button onClick={() => setAmount(numberToDigits(Math.min(totals.ebtTotal, remaining)))} style={{ width: '100%', padding: '0.75rem', borderRadius: 10, cursor: 'pointer', background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.25)', color: '#34d399', fontWeight: 700, fontSize: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Leaf size={14} /> Full EBT — {fmt$(Math.min(totals.ebtTotal, remaining))}
              </button>
            )}

            {/* ── OTHER: note text ── */}
            {method === 'other' && (
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Note: Gift Card, Check #1234…"
                style={{ width: '100%', fontSize: '0.9rem', borderRadius: 8, padding: '0.65rem 0.875rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
              />
            )}

          </div>{/* end left column */}

          {/* ── Right column — numpad (only for amount-entry methods) ── */}
          {showNumpad && (
            <div style={numpadCol}>
              <NumPadInline value={amount} onChange={setAmount} accentColor={padColor} />
            </div>
          )}

        </div>{/* end side-by-side body */}

        {/* Footer */}
        <div style={{ padding: '0.875rem 1rem', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {canAddSplit && (
            <button onClick={addSplitLine} style={s.splitAddBtn}>
              <PlusCircle size={14} /> Add {fmt$(activeAmt)} {activeM?.label} — pay {fmt$(remaining - activeAmt)} separately
            </button>
          )}
          <button onClick={complete} disabled={!canComplete || saving}
            style={s.bigBtn(method === 'card' ? 'var(--blue, #3b82f6)' : padColor, !canComplete || saving)}
          >
            {saving
              ? <><RotateCcw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processing…</>
              : method === 'card'
                ? <><CreditCard size={16} /> Complete Card — {fmt$(remaining)}</>
                : change > 0
                  ? <>Complete Sale · Change: {fmt$(change)}</>
                  : 'Complete Sale'
            }
          </button>
        </div>

        {/* PAX Terminal Payment Overlay */}
        {payStatus && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 100,
            background: 'rgba(11,13,20,0.97)', borderRadius: 'inherit',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '2rem', textAlign: 'center',
          }}>
            {payStatus === 'waiting' && (
              <>
                <div style={{ fontSize: '4rem', marginBottom: '1rem', animation: 'pulse 1.5s ease-in-out infinite' }}>💳</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#e8eaf0', marginBottom: 8 }}>
                  Waiting for Customer
                </div>
                <div style={{ color: '#6b7280', fontSize: '0.9rem', lineHeight: 1.7, marginBottom: '2rem' }}>
                  Please tap, insert, or swipe card<br />on the payment terminal
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4b5563', fontSize: '0.8rem' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', animation: 'blink 1s step-end infinite' }} />
                  Processing on terminal…
                </div>
                <button
                  onClick={() => { setPayStatus(null); setPayResult(null); }}
                  style={{ marginTop: '2rem', padding: '8px 20px', borderRadius: 8, border: '1px solid rgba(239,68,68,.3)', background: 'transparent', color: '#f87171', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}
                >
                  Cancel
                </button>
              </>
            )}

            {payStatus === 'approved' && (
              <>
                <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>✅</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#4ade80', marginBottom: 6 }}>Payment Approved</div>
                {payResult?.authCode && <div style={{ color: '#6b7280', fontSize: '0.8rem', marginBottom: 4 }}>Auth: {payResult.authCode}</div>}
                {payResult?.cardType && <div style={{ color: '#6b7280', fontSize: '0.8rem', marginBottom: 4 }}>{payResult.cardType} ****{payResult.lastFour}</div>}
                <div style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: 8 }}>Completing transaction…</div>
              </>
            )}

            {payStatus === 'declined' && (
              <>
                <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>❌</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f87171', marginBottom: 8 }}>Payment Declined</div>
                <div style={{ color: '#6b7280', fontSize: '0.87rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                  {payResult?.message || 'The card was declined. Please try another card or payment method.'}
                </div>
                <button onClick={() => { setPayStatus(null); setPayResult(null); }} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: '#3d56b5', color: '#fff', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' }}>
                  Try Again
                </button>
              </>
            )}

            {payStatus === 'error' && (
              <>
                <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>⚠️</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f87171', marginBottom: 8 }}>Terminal Error</div>
                <div style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                  {payResult?.message || 'Could not reach the payment terminal. Check network connection.'}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { setPayStatus(null); setPayResult(null); }} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'transparent', color: '#94a3b8', fontSize: '0.87rem', cursor: 'pointer' }}>
                    Use Cash Instead
                  </button>
                  <button onClick={() => { setPayStatus(null); }} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: '#3d56b5', color: '#fff', fontWeight: 700, fontSize: '0.87rem', cursor: 'pointer' }}>
                    Retry
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <style>{`
          @keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }
          @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        `}</style>

      </div>
    </div>
  );
}
