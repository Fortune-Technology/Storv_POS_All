/**
 * CustomerDisplayScreen — read-only, customer-facing second screen.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useCustomerDisplaySubscriber } from '../hooks/useBroadcastSync.js';
import './CustomerDisplayScreen.css';

const fmt$ = (n) => {
  const v = Number(n) || 0;
  return v < 0 ? `-$${Math.abs(v).toFixed(2)}` : `$${v.toFixed(2)}`;
};

export default function CustomerDisplayScreen() {
  const [state, setState] = useState({
    type: 'idle', items: [], totals: {}, bagCount: 0, bagPrice: 0,
    customer: null, loyaltyRedemption: null, orderDiscount: null,
    promoResults: { totalSaving: 0, appliedPromos: [] }, storeName: '',
  });

  const [thankYou, setThankYou] = useState(null);
  const thankYouTimer = useRef(null);

  const handleMessage = useCallback((data) => {
    if (!data?.type) return;
    if (data.type === 'cart_update') {
      setState(data);
      setThankYou(null);
    } else if (data.type === 'transaction_complete') {
      setThankYou({ change: data.change, txNumber: data.txNumber });
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

  const listRef = useRef(null);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [state.items?.length]);

  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const { items = [], totals = {}, customer, loyaltyRedemption, bagCount = 0, bagPrice = 0, promoResults, storeName } = state;
  const hasItems = items.length > 0;
  const itemCount = items.reduce((s, i) => s + (i.qty || 1), 0);

  // ── Thank You ──
  if (thankYou) {
    return (
      <div className="cds-root">
        <div className="cds-page">
          <div className="cds-thankyou-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#7ac143" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="cds-thankyou-title">Thank You!</div>
          {thankYou.change > 0 && (
            <div className="cds-thankyou-change">
              Change Due: <span className="cds-thankyou-change-amt">{fmt$(thankYou.change)}</span>
            </div>
          )}
          <div className="cds-thankyou-bye">Have a great day!</div>
        </div>
      </div>
    );
  }

  // ── Idle ──
  if (!hasItems) {
    return (
      <div className="cds-root">
        <div className="cds-page">
          <div className="cds-idle-store">{storeName || 'Welcome'}</div>
          <div className="cds-idle-clock">
            {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    );
  }

  // ── Active Cart ──
  return (
    <div className="cds-root">
      <div className="cds-active">
        {/* Header */}
        <div className="cds-header">
          <span className="cds-header-store">{storeName || 'StoreVue POS'}</span>
          <span className="cds-header-clock">
            {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* Customer bar */}
        {customer && (
          <div className="cds-customer-bar">
            <div className="cds-customer-info">
              <div className="cds-customer-avatar">
                {(customer.name || '?')[0]?.toUpperCase()}
              </div>
              <div>
                <div className="cds-customer-name">{customer.name}</div>
                {customer.phone && <div className="cds-customer-phone">{customer.phone}</div>}
              </div>
            </div>
            {customer.loyaltyPoints != null && (
              <div className="cds-customer-points">
                {customer.loyaltyPoints.toLocaleString()} pts
              </div>
            )}
          </div>
        )}

        {/* Line items — compact single-row layout */}
        <div ref={listRef} className="cds-items">
          {items.map((item, idx) => (
            <div key={item.lineId || idx} className="cds-line-item">
              <div className="cds-line-left">
                <span className="cds-line-name">{item.name}</span>
                {item.qty > 1 && <span className="cds-line-qty">{item.qty} × {fmt$(item.unitPrice)}</span>}
                {item.promoAdjustment && (
                  <span className="cds-line-promo">
                    -{item.promoAdjustment.discountType === 'percent'
                      ? `${item.promoAdjustment.discountValue}%`
                      : fmt$(item.promoAdjustment.discountValue)}
                  </span>
                )}
                {item.discountType && (
                  <span className="cds-line-discount">
                    -{item.discountType === 'percent' ? `${item.discountValue}%` : fmt$(item.discountValue)}
                  </span>
                )}
              </div>
              <span className={`cds-line-total ${item.lineTotal < 0 ? 'cds-line-total--negative' : 'cds-line-total--positive'}`}>
                {fmt$(item.lineTotal)}
              </span>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="cds-summary">
          <SummaryRow label={`Subtotal (${itemCount} items)`} value={fmt$(totals.subtotal)} />

          {/* All discount types combined into a single "You Save" line */}
          {(() => {
            const totalDiscount = (totals.discountAmount || 0) + (totals.promoSaving || 0)
              + (loyaltyRedemption?.discountType === 'dollar_off' ? loyaltyRedemption.discountValue : 0);
            return totalDiscount > 0 ? (
              <SummaryRow label="You Save" value={`-${fmt$(totalDiscount)}`} color="var(--green)" />
            ) : null;
          })()}

          {/* Individual breakdown if multiple discount sources */}
          {totals.discountAmount > 0 && <SummaryRow label="  Discount" value={`-${fmt$(totals.discountAmount)}`} color="var(--amber)" />}
          {totals.promoSaving > 0 && <SummaryRow label="  Promo" value={`-${fmt$(totals.promoSaving)}`} color="var(--green)" />}
          {loyaltyRedemption && (
            <SummaryRow
              label={`  Points (${loyaltyRedemption.pointsCost} pts)`}
              value={loyaltyRedemption.discountType === 'dollar_off' ? `-${fmt$(loyaltyRedemption.discountValue)}` : `-${loyaltyRedemption.discountValue}%`}
              color="var(--green)"
            />
          )}

          {totals.depositTotal > 0 && <SummaryRow label="Deposits" value={fmt$(totals.depositTotal)} muted />}
          {totals.bagTotal > 0 && <SummaryRow label={`Bags (${bagCount})`} value={fmt$(totals.bagTotal)} muted />}
          {totals.taxTotal > 0 && <SummaryRow label="Tax" value={fmt$(totals.taxTotal)} />}
          {totals.ebtTotal > 0 && <SummaryRow label="EBT Eligible" value={fmt$(totals.ebtTotal)} color="var(--green)" />}

          {/* Session 51 — Dual Pricing dual-total display.
              When both totals are equal (interchange OR no surcharge configured)
              we render the single existing TOTAL block. When dual_pricing is
              active and totals diverge, we show both prominently so the
              customer can choose the cheaper path. */}
          {totals.cardGrandTotal != null
            && totals.cashGrandTotal != null
            && Math.abs(totals.cardGrandTotal - totals.cashGrandTotal) > 0.005 ? (
              <>
                <div className="cds-grand cds-grand--dual">
                  <span className="cds-grand-label cds-grand-label--cash">CASH / EBT</span>
                  <span className="cds-grand-value cds-grand-value--cash">{fmt$(totals.cashGrandTotal)}</span>
                </div>
                <div className="cds-grand cds-grand--card">
                  <span className="cds-grand-label cds-grand-label--card">CARD / DEBIT</span>
                  <span className="cds-grand-value cds-grand-value--card">{fmt$(totals.cardGrandTotal)}</span>
                </div>
                {totals.potentialSavings > 0.005 && (
                  <div className="cds-savings-banner">
                    Save {fmt$(totals.potentialSavings)} by paying cash
                  </div>
                )}
              </>
            ) : (
              <div className="cds-grand">
                <span className="cds-grand-label">TOTAL</span>
                <span className="cds-grand-value">{fmt$(totals.grandTotal)}</span>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, color, muted }) {
  const labelClass = color
    ? 'cds-summary-label cds-summary-label--colored'
    : muted
      ? 'cds-summary-label cds-summary-label--muted'
      : 'cds-summary-label';

  return (
    <div className="cds-summary-row">
      <span className={labelClass} style={color ? { color } : undefined}>{label}</span>
      <span className="cds-summary-value" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}
