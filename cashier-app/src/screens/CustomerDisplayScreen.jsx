/**
 * CustomerDisplayScreen — read-only, customer-facing second screen.
 *
 * Opens via: window.open('/#/customer-display', ...)
 * Receives real-time cart state from POSScreen via BroadcastChannel.
 *
 * Three states:
 *   idle               → Welcome / store branding
 *   cart_update         → Live line items + totals
 *   transaction_complete → "Thank You" with change due
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useCustomerDisplaySubscriber } from '../hooks/useBroadcastSync.js';

const fmt$ = (n) => {
  const v = Number(n) || 0;
  return v < 0 ? `-$${Math.abs(v).toFixed(2)}` : `$${v.toFixed(2)}`;
};

// ── Styles ───────────────────────────────────────────────────────────────────

const COLORS = {
  bg:          '#0a0c12',
  bgCard:      '#141720',
  border:      '#1e2233',
  green:       '#7ac143',
  greenDim:    'rgba(122,193,67,0.08)',
  amber:       '#f59e0b',
  amberDim:    'rgba(245,158,11,0.08)',
  blue:        '#60a5fa',
  textPrimary: '#e2e8f0',
  textSecondary:'#94a3b8',
  textMuted:   '#475569',
};

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export default function CustomerDisplayScreen() {
  const [state, setState] = useState({
    type: 'idle',
    items: [],
    totals: {},
    bagCount: 0,
    bagPrice: 0,
    customer: null,
    loyaltyRedemption: null,
    orderDiscount: null,
    promoResults: { totalSaving: 0, appliedPromos: [] },
    storeName: '',
  });

  // Transaction-complete overlay
  const [thankYou, setThankYou] = useState(null); // { change, txNumber }
  const thankYouTimer = useRef(null);

  const handleMessage = useCallback((data) => {
    if (!data?.type) return;

    if (data.type === 'cart_update') {
      setState(data);
      setThankYou(null);
    } else if (data.type === 'transaction_complete') {
      setThankYou({ change: data.change, txNumber: data.txNumber });
      // Clear after 6 seconds
      clearTimeout(thankYouTimer.current);
      thankYouTimer.current = setTimeout(() => {
        setThankYou(null);
        setState(s => ({ ...s, type: 'idle', items: [], totals: {}, bagCount: 0, customer: null, loyaltyRedemption: null }));
      }, 6000);
    } else if (data.type === 'idle') {
      setState(s => ({ ...s, type: 'idle', items: [], totals: {}, bagCount: 0, customer: null, loyaltyRedemption: null }));
      setThankYou(null);
    }
  }, []);

  useCustomerDisplaySubscriber(handleMessage);

  // Auto-scroll line items
  const listRef = useRef(null);
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [state.items?.length]);

  // Clock
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const { items = [], totals = {}, customer, loyaltyRedemption, bagCount = 0, bagPrice = 0, promoResults, storeName } = state;
  const hasItems = items.length > 0;
  const itemCount = items.reduce((s, i) => s + (i.qty || 1), 0);

  // ── Thank You Overlay ────────────────────────────────────────────────────
  if (thankYou) {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: COLORS.bg, color: COLORS.textPrimary,
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'rgba(122,193,67,0.15)', border: `3px solid ${COLORS.green}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 24, animation: 'scaleIn 0.4s ease',
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={COLORS.green} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div style={{ fontSize: '2.5rem', fontWeight: 800, color: COLORS.green, marginBottom: 8 }}>
          Thank You!
        </div>
        {(thankYou.change > 0) && (
          <div style={{ fontSize: '1.4rem', fontWeight: 600, color: COLORS.textSecondary, marginTop: 8 }}>
            Change Due: <span style={{ color: COLORS.amber, fontWeight: 800 }}>{fmt$(thankYou.change)}</span>
          </div>
        )}
        <div style={{ fontSize: '0.85rem', color: COLORS.textMuted, marginTop: 24 }}>
          Have a great day!
        </div>
        <style>{`@keyframes scaleIn { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}</style>
      </div>
    );
  }

  // ── Idle State ───────────────────────────────────────────────────────────
  if (!hasItems) {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: COLORS.bg, color: COLORS.textPrimary,
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}>
        <div style={{ fontSize: '2.2rem', fontWeight: 800, color: COLORS.green, letterSpacing: '-0.02em', marginBottom: 8 }}>
          {storeName || 'Welcome'}
        </div>
        <div style={{ fontSize: '1rem', color: COLORS.textMuted, fontWeight: 500 }}>
          {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    );
  }

  // ── Active Cart ──────────────────────────────────────────────────────────
  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: COLORS.bg, color: COLORS.textPrimary,
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0.75rem 1.25rem',
        borderBottom: `1px solid ${COLORS.border}`,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '1.1rem', fontWeight: 700, color: COLORS.green }}>
          {storeName || 'StoreVue POS'}
        </span>
        <span style={{ fontSize: '0.85rem', color: COLORS.textMuted }}>
          {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Customer bar */}
      {customer && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1.25rem',
          background: 'rgba(122,193,67,0.06)',
          borderBottom: `1px solid ${COLORS.border}`,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'rgba(122,193,67,0.15)', border: `1px solid rgba(122,193,67,0.3)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.85rem', fontWeight: 700, color: COLORS.green,
            }}>
              {(customer.name || '?')[0]?.toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{customer.name}</div>
              {customer.phone && (
                <div style={{ fontSize: '0.75rem', color: COLORS.textMuted }}>{customer.phone}</div>
              )}
            </div>
          </div>
          {customer.loyaltyPoints != null && (
            <div style={{
              padding: '4px 12px', borderRadius: 20,
              background: 'rgba(122,193,67,0.1)', border: '1px solid rgba(122,193,67,0.25)',
              fontSize: '0.8rem', fontWeight: 700, color: COLORS.green,
            }}>
              {customer.loyaltyPoints.toLocaleString()} pts
            </div>
          )}
        </div>
      )}

      {/* Line items */}
      <div ref={listRef} style={{
        flex: 1, overflowY: 'auto', padding: '0.5rem 0',
      }}>
        {items.map((item, idx) => (
          <div key={item.lineId || idx} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            padding: '0.65rem 1.25rem',
            borderBottom: `1px solid ${COLORS.border}`,
            animation: 'slideIn 0.2s ease',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '1rem', fontWeight: 600, color: COLORS.textPrimary,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {item.isBagFee ? '🛍️ ' : ''}{item.name}
              </div>
              <div style={{ fontSize: '0.78rem', color: COLORS.textMuted, marginTop: 2 }}>
                {item.qty > 1 && <span>{item.qty} x {fmt$(item.unitPrice)}</span>}
              </div>
              {/* Per-line promo discount */}
              {item.promoAdjustment && (
                <div style={{ fontSize: '0.75rem', color: COLORS.green, marginTop: 2, fontWeight: 600 }}>
                  Promo: -{item.promoAdjustment.discountType === 'percent'
                    ? `${item.promoAdjustment.discountValue}%`
                    : fmt$(item.promoAdjustment.discountValue)}
                </div>
              )}
              {/* Per-line manual discount */}
              {item.discountType && (
                <div style={{ fontSize: '0.75rem', color: COLORS.amber, marginTop: 2, fontWeight: 600 }}>
                  Discount: -{item.discountType === 'percent'
                    ? `${item.discountValue}%`
                    : fmt$(item.discountValue)}
                </div>
              )}
              {/* Deposit */}
              {item.depositTotal > 0 && (
                <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginTop: 2 }}>
                  + Deposit {fmt$(item.depositTotal)}
                </div>
              )}
            </div>
            <div style={{
              fontSize: '1rem', fontWeight: 700,
              color: item.lineTotal < 0 ? COLORS.amber : COLORS.textPrimary,
              marginLeft: 12, whiteSpace: 'nowrap',
            }}>
              {fmt$(item.lineTotal)}
            </div>
          </div>
        ))}
      </div>

      {/* Summary panel */}
      <div style={{
        flexShrink: 0, borderTop: `2px solid ${COLORS.border}`,
        padding: '0.75rem 1.25rem',
        background: COLORS.bgCard,
      }}>
        <SummaryRow label={`Subtotal (${itemCount} item${itemCount !== 1 ? 's' : ''})`} value={fmt$(totals.subtotal)} />

        {totals.discountAmount > 0 && (
          <SummaryRow label="Discount" value={`-${fmt$(totals.discountAmount)}`} color={COLORS.amber} />
        )}

        {totals.promoSaving > 0 && (
          <SummaryRow label="Promo Savings" value={`-${fmt$(totals.promoSaving)}`} color={COLORS.green} />
        )}

        {loyaltyRedemption && (
          <SummaryRow
            label={`Points Redeemed (${loyaltyRedemption.pointsCost} pts)`}
            value={loyaltyRedemption.discountType === 'dollar_off'
              ? `-${fmt$(loyaltyRedemption.discountValue)}`
              : `-${loyaltyRedemption.discountValue}%`}
            color={COLORS.green}
          />
        )}

        {totals.depositTotal > 0 && (
          <SummaryRow label="Bottle Deposits" value={fmt$(totals.depositTotal)} muted />
        )}

        {totals.bagTotal > 0 && (
          <SummaryRow label={`Bag Fee (${bagCount})`} value={fmt$(totals.bagTotal)} muted />
        )}

        {totals.taxTotal > 0 && (
          <SummaryRow label="Tax" value={fmt$(totals.taxTotal)} />
        )}

        {totals.ebtTotal > 0 && (
          <SummaryRow label="EBT Eligible" value={fmt$(totals.ebtTotal)} color={COLORS.green} />
        )}

        {/* Grand total */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginTop: '0.6rem', paddingTop: '0.6rem',
          borderTop: `1px solid ${COLORS.border}`,
        }}>
          <span style={{ fontSize: '1.3rem', fontWeight: 800, color: COLORS.textPrimary }}>
            TOTAL
          </span>
          <span style={{ fontSize: '2.2rem', fontWeight: 900, color: COLORS.green, fontFamily: "'Inter', sans-serif" }}>
            {fmt$(totals.grandTotal)}
          </span>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { margin: 0; overflow: hidden; }
      `}</style>
    </div>
  );
}

// ── Summary Row helper ───────────────────────────────────────────────────────

function SummaryRow({ label, value, color, muted }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: '0.3rem',
    }}>
      <span style={{
        fontSize: '0.88rem',
        color: color || (muted ? COLORS.textMuted : COLORS.textSecondary),
        fontWeight: color ? 600 : 400,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: '0.95rem', fontWeight: 600,
        color: color || COLORS.textPrimary,
      }}>
        {value}
      </span>
    </div>
  );
}
