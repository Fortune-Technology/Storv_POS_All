/**
 * ActionBar — always-visible bottom bar.
 */

import React, { useEffect, useState } from 'react';
import {
  Tag, PauseCircle, Printer, DollarSign,
  RotateCcw, Ban, BarChart2, Lock, Unlock, X,
  ArrowDownCircle, ArrowUpCircle, LockKeyhole, UnlockKeyhole, Ticket, History, Recycle,
  ClipboardList, Settings, Monitor, MessageSquare, Edit3, Leaf,
} from 'lucide-react';
import { useManagerStore } from '../../stores/useManagerStore.js';
import { useCartStore }    from '../../stores/useCartStore.js';
import './ActionBar.css';

// ── Reusable action button ─────────────────────────────────────────────────
const ACT = ({ icon: Icon, label, onClick, color = 'var(--text-secondary)', disabled, locked }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={locked ? `${label} (Manager)` : label}
    className="ab-action"
    style={{ color: disabled ? 'var(--text-muted)' : color, opacity: disabled ? 0.4 : 1 }}
  >
    <Icon size={17} />
    <span className="ab-action-label">{label}</span>
    {locked && <Lock size={8} className="ab-action-lock" />}
  </button>
);

// ── Divider helper ─────────────────────────────────────────────────────────
const Divider = () => <div className="ab-divider" />;

// ── ActionBar ──────────────────────────────────────────────────────────────
export default function ActionBar({
  onPriceCheck, onHold, onReprint, onNoSale, onHistory, onBottleReturn, onOpenItem,
  onDiscount, onRefund, onVoidTx, onEndOfDay,
  onOpenCustomer,
  onLottery,
  onLotteryShift,
  onHardwareSettings,
  onCustomerDisplay,
  onTasks,
  onChat,
  chatUnread = 0,
  onOpenShift, onCloseShift, onCashDrop, onPayout,
  onEbtBalance,
  shiftOpen = false,
  lotteryEnabled = true,
  ebtEnabled = false,
  heldCount = 0,
  enabledShortcuts = {},
  actionBarHeight = 58,
}) {
  const items          = useCartStore(s => s.items);
  const requireManager = useManagerStore(s => s.requireManager);
  const isActive       = useManagerStore(s => s.isActive);
  const managerName    = useManagerStore(s => s.managerName);
  const expiresAt      = useManagerStore(s => s.expiresAt);
  const endSession     = useManagerStore(s => s.endSession);
  const isSessionValid = useManagerStore(s => s.isSessionValid);
  const [remaining, setRemaining] = useState('');

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
  const show = (key) => enabledShortcuts[key] !== false;

  return (
    <div className="ab-bar" style={{ height: actionBarHeight }}>
      {/* LEFT: Manager button */}
      {!valid ? (
        <button
          onClick={() => requireManager('Manager Access', () => {})}
          className="ab-mgr-btn"
        >
          <Lock size={14} />
          Manager
        </button>
      ) : (
        <button onClick={endSession} title="End manager session" className="ab-mgr-active">
          <Unlock size={14} />
          <div className="ab-mgr-active-info">
            <div>{managerName?.split(' ')[0]}</div>
            <div className="ab-mgr-active-timer">{remaining}</div>
          </div>
          <X size={12} style={{ opacity: 0.5, marginLeft: 4 }} />
        </button>
      )}

      <div className="ab-spacer" />

      {/* Manager actions */}
      {valid && (
        <>
          {show('discount') && <ACT icon={Tag} label="Discount" onClick={onDiscount} color="var(--amber)" />}
          {show('refund') && <ACT icon={RotateCcw} label="Refund" onClick={mgr('Refund', onRefund)} color="var(--blue)" />}
          {show('voidTx') && <ACT icon={Ban} label="Void Tx" onClick={mgr('Void Tx', onVoidTx)} color="var(--red)" />}
          {show('endOfDay') && <ACT icon={BarChart2} label="End of Day" onClick={mgr('End of Day', onEndOfDay)} />}
          {shiftOpen && <ACT icon={LockKeyhole} label="Close Shift" onClick={onCloseShift} color="var(--red)" locked={!valid} />}
          <ACT icon={Settings} label="Hardware" onClick={onHardwareSettings} color="var(--text-muted)" />
          {onCustomerDisplay && <ACT icon={Monitor} label="Cust. Display" onClick={onCustomerDisplay} color="var(--blue)" />}
          {onTasks && <ACT icon={ClipboardList} label="Tasks" onClick={onTasks} color="var(--green)" />}
          {onChat && (
            <div style={{ position: 'relative', display: 'inline-flex' }}>
              <ACT icon={MessageSquare} label="Chat" onClick={onChat} color="#8b5cf6" />
              {chatUnread > 0 && (
                <span style={{
                  position: 'absolute', top: 2, right: 2,
                  minWidth: 16, height: 16, padding: '0 4px',
                  borderRadius: 8, background: '#ef4444', color: '#fff',
                  fontSize: '0.55rem', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1, pointerEvents: 'none',
                  animation: 'badgePop 0.25s ease',
                }}>
                  {chatUnread > 99 ? '99+' : chatUnread}
                </span>
              )}
            </div>
          )}
          <Divider />
        </>
      )}

      {/* Cash Drawer actions */}
      {shiftOpen && (
        <>
          <ACT icon={ArrowDownCircle} label="Cash Drop" onClick={onCashDrop} color="var(--amber)" />
          <ACT icon={ArrowUpCircle} label="Paid Out" onClick={onPayout} color="#a855f7" />
          <Divider />
          {lotteryEnabled && (
            <>
              <ACT icon={Ticket} label="Lottery" onClick={onLottery} color="var(--green)" />
              <ACT icon={ClipboardList} label="Lotto Shift" onClick={onLotteryShift} color="#f59e0b" />
              <Divider />
            </>
          )}
        </>
      )}

      {/* Open shift */}
      {!shiftOpen && (
        <>
          <ACT icon={UnlockKeyhole} label="Open Shift" onClick={onOpenShift} color="var(--green)" />
          <Divider />
        </>
      )}

      {/* Cashier actions */}
      {show('noSale') && <ACT icon={DollarSign} label="No Sale" onClick={mgr('No Sale', onNoSale)} locked={!valid} />}
      {show('reprint') && <ACT icon={Printer} label="Reprint" onClick={onReprint} />}
      {ebtEnabled && onEbtBalance && <ACT icon={Leaf} label="EBT Balance" onClick={onEbtBalance} color="#34d399" />}
      <Divider />
      {show('history') && <ACT icon={History} label="History" onClick={onHistory} color="var(--blue)" />}
      {show('bottleReturn') && (
        <>
          <Divider />
          <ACT icon={Recycle} label="Bottle Return" onClick={onBottleReturn} color="#34d399" />
        </>
      )}
      {show('hold') && (
        <>
          <Divider />
          <button
            onClick={onHold}
            title={`Hold / Recall${heldCount ? ` (${heldCount} parked)` : ''}`}
            className={`ab-hold-btn ${heldCount > 0 ? 'ab-hold-btn--active' : 'ab-hold-btn--inactive'}`}
          >
            <PauseCircle size={17} />
            <span className="ab-hold-label">Hold{heldCount > 0 ? ` (${heldCount})` : ''}</span>
            {heldCount > 0 && <span className="ab-hold-badge">{heldCount}</span>}
          </button>
        </>
      )}
      {show('priceCheck') && (
        <>
          <Divider />
          <ACT icon={Tag} label="Price Check" onClick={onPriceCheck} />
        </>
      )}
      {onOpenItem && (
        <>
          <Divider />
          <ACT icon={Edit3} label="Manual Item" onClick={onOpenItem} color="#f59e0b" />
        </>
      )}
    </div>
  );
}
