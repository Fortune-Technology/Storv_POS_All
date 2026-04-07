/**
 * ActionBar — always-visible bottom bar.
 *
 * Layout (right-hand cashier friendly):
 *   LEFT:  Manager button (or active session indicator)
 *   SPACER
 *   RIGHT: Manager actions (when session active) · No Sale · Reprint · Hold · Price Check
 *
 * enabledShortcuts prop gates each button — if a key is explicitly false, that
 * button is omitted entirely. Defaults to true when not specified.
 */

import React, { useEffect, useState } from 'react';
import {
  Tag, PauseCircle, Printer, DollarSign,
  RotateCcw, Ban, BarChart2, Lock, Unlock, X,
  ArrowDownCircle, ArrowUpCircle, LockKeyhole, UnlockKeyhole, Ticket, History, Recycle,
  ClipboardList,
} from 'lucide-react';
import { useManagerStore } from '../../stores/useManagerStore.js';
import { useCartStore }    from '../../stores/useCartStore.js';

// ── Reusable action button ─────────────────────────────────────────────────
const ACT = ({ icon: Icon, label, onClick, color = 'var(--text-secondary)', disabled, locked }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={locked ? `${label} (Manager)` : label}
    style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 3, padding: '0 14px', height: '100%', minWidth: 64,
      background: 'none', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
      color: disabled ? 'var(--text-muted)' : color,
      opacity: disabled ? 0.4 : 1,
      borderRadius: 0, position: 'relative',
      transition: 'background .12s',
    }}
    onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'rgba(255,255,255,.05)'; }}
    onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
  >
    <Icon size={17} />
    <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
      {label}
    </span>
    {locked && (
      <Lock size={8} style={{ position: 'absolute', top: 6, right: 10, opacity: 0.5 }} />
    )}
  </button>
);

// ── Divider helper ─────────────────────────────────────────────────────────
const Divider = () => (
  <div style={{ width: 1, background: 'var(--border)', margin: '10px 0', flexShrink: 0 }} />
);

// ── ActionBar ──────────────────────────────────────────────────────────────
export default function ActionBar({
  onPriceCheck, onHold, onReprint, onNoSale, onHistory, onBottleReturn,
  onDiscount, onRefund, onVoidTx, onEndOfDay,
  onOpenCustomer,
  onLottery,
  onLotteryShift,          // opens LotteryShiftModal for reconciliation
  // Cash drawer / shift
  onOpenShift, onCloseShift, onCashDrop, onPayout,
  shiftOpen = false,
  lotteryEnabled = true,   // show lottery buttons only when lottery is on
  heldCount = 0,           // badge on Hold button
  enabledShortcuts = {},
  actionBarHeight = 58,
  // enabledShortcuts shape:
  //   { priceCheck, hold, reprint, noSale, discount, refund, voidTx, endOfDay }
  // A key being explicitly `false` hides the button; undefined/true shows it.
}) {
  const items          = useCartStore(s => s.items);
  const requireManager = useManagerStore(s => s.requireManager);
  const isActive       = useManagerStore(s => s.isActive);
  const managerName    = useManagerStore(s => s.managerName);
  const expiresAt      = useManagerStore(s => s.expiresAt);
  const endSession     = useManagerStore(s => s.endSession);
  const isSessionValid = useManagerStore(s => s.isSessionValid);
  const [remaining, setRemaining] = useState('');

  // Countdown timer for manager session
  useEffect(() => {
    if (!isActive) return;
    const tick = () => {
      const ms = (expiresAt || 0) - Date.now();
      if (ms <= 0) { setRemaining(''); return; }
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setRemaining(`${m}:${String(s).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isActive, expiresAt]);

  const mgr   = (label, cb) => () => requireManager(label, cb);
  const valid  = isSessionValid();

  // Resolve each shortcut flag (default true when not specified)
  const show = (key) => enabledShortcuts[key] !== false;

  return (
    <div style={{
      height: actionBarHeight, flexShrink: 0,
      background: 'var(--bg-panel)',
      borderTop: '1px solid var(--border-light)',
      display: 'flex', alignItems: 'stretch',
    }}>

      {/* ── LEFT: Manager button ── */}
      {!valid ? (
        <button
          onClick={() => requireManager('Manager Access', () => {})}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '0 20px', height: '100%',
            background: 'rgba(255,255,255,.04)',
            border: 'none', borderRight: '1px solid var(--border)',
            color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: '0.75rem', fontWeight: 700,
            flexShrink: 0,
            transition: 'background .12s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.08)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,.04)'}
        >
          <Lock size={14} />
          Manager
        </button>
      ) : (
        <button
          onClick={endSession}
          title="End manager session"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '0 16px', height: '100%',
            background: 'rgba(122,193,67,.08)',
            border: 'none', borderRight: '1px solid rgba(122,193,67,.2)',
            color: 'var(--green)', cursor: 'pointer',
            fontSize: '0.72rem', fontWeight: 700,
            flexShrink: 0,
          }}
        >
          <Unlock size={14} />
          <div style={{ textAlign: 'left', lineHeight: 1.3 }}>
            <div>{managerName?.split(' ')[0]}</div>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 600 }}>{remaining}</div>
          </div>
          <X size={12} style={{ opacity: 0.5, marginLeft: 4 }} />
        </button>
      )}

      {/* ── Spacer ── */}
      <div style={{ flex: 1 }} />

      {/* ── RIGHT: Manager actions (session active) + Cashier actions ── */}

      {/* Manager actions — shown only when session active */}
      {valid && (
        <>
          {show('discount') && (
            <ACT icon={Tag}       label="Discount"   onClick={onDiscount}                       color="var(--amber)" />
          )}
          {show('refund') && (
            <ACT icon={RotateCcw} label="Refund"     onClick={mgr('Refund', onRefund)}           color="var(--blue)" />
          )}
          {show('voidTx') && (
            <ACT icon={Ban}       label="Void Tx"    onClick={mgr('Void Tx', onVoidTx)}          color="var(--red)" />
          )}
          {show('endOfDay') && (
            <ACT icon={BarChart2} label="End of Day" onClick={mgr('End of Day', onEndOfDay)} />
          )}
          {/* Close shift — manager only, only when shift is open */}
          {shiftOpen && (
            <ACT icon={LockKeyhole} label="Close Shift" onClick={onCloseShift} color="var(--red)" locked={!valid} />
          )}
          <Divider />
        </>
      )}

      {/* Cash Drawer actions — available when shift is open */}
      {shiftOpen && (
        <>
          <ACT icon={ArrowDownCircle} label="Cash Drop" onClick={onCashDrop} color="var(--amber)" />
          <ACT icon={ArrowUpCircle}   label="Paid Out"  onClick={onPayout}   color="#a855f7" />
          <Divider />
          {lotteryEnabled && (
            <>
              <ACT icon={Ticket}        label="Lottery"      onClick={onLottery}      color="var(--green)" />
              <ACT icon={ClipboardList} label="Lotto Shift"  onClick={onLotteryShift} color="#f59e0b" />
              <Divider />
            </>
          )}
        </>
      )}

      {/* Open shift button — shown when no shift is open */}
      {!shiftOpen && (
        <>
          <ACT icon={UnlockKeyhole} label="Open Shift" onClick={onOpenShift} color="var(--green)" />
          <Divider />
        </>
      )}

      {/* Cashier actions — rightmost so right-hand reach is easy */}
      {show('noSale') && (
        <ACT icon={DollarSign} label="No Sale" onClick={mgr('No Sale', onNoSale)} locked={!valid} />
      )}
      {show('reprint') && (
        <ACT icon={Printer} label="Reprint" onClick={onReprint} />
      )}
      <Divider />
      {/* History */}
      {show('history') && (
        <ACT icon={History} label="History" onClick={onHistory} color="var(--blue)" />
      )}
      {/* Bottle Return */}
      {show('bottleReturn') && (
        <>
          <Divider />
          <ACT icon={Recycle} label="Bottle Return" onClick={onBottleReturn} color="#34d399" />
        </>
      )}
      {show('hold') && (
        <>
          <Divider />
          {/* Hold button — badge shows parked count */}
          <button
            onClick={onHold}
            title={`Hold / Recall${heldCount ? ` (${heldCount} parked)` : ''}`}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 3, padding: '0 14px', height: '100%', minWidth: 64,
              background: 'none', border: 'none', cursor: 'pointer',
              color: heldCount > 0 ? 'var(--amber)' : 'var(--text-secondary)',
              position: 'relative', borderRadius: 0,
              transition: 'background .12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
          >
            <PauseCircle size={17} />
            <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
              Hold{heldCount > 0 ? ` (${heldCount})` : ''}
            </span>
            {heldCount > 0 && (
              <span style={{
                position: 'absolute', top: 5, right: 8,
                background: 'var(--amber)', color: '#000',
                borderRadius: '50%', width: 16, height: 16,
                fontSize: '0.6rem', fontWeight: 900,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {heldCount}
              </span>
            )}
          </button>
        </>
      )}
      {show('priceCheck') && (
        <>
          <Divider />
          <ACT icon={Tag} label="Price Check" onClick={onPriceCheck} />
        </>
      )}
    </div>
  );
}
