import React from 'react';
import { Minus, Plus, Trash2, Tag, Zap } from 'lucide-react';
import { fmt$ } from '../../utils/formatters.js';
import { useCartStore } from '../../stores/useCartStore.js';

export default function CartItem({ item, selected, onSelect }) {
  const updateQty  = useCartStore(s => s.updateQty);
  const removeItem = useCartStore(s => s.removeItem);

  // ── Lottery items — special render (no qty controls) ──────────────────────
  if (item.isLottery) {
    const isSale   = item.lotteryType === 'sale';
    const color    = isSale ? '#16a34a' : '#f59e0b';
    const bgColor  = isSale ? 'rgba(22,163,74,0.08)' : 'rgba(245,158,11,0.08)';
    const border   = isSale ? 'rgba(22,163,74,0.25)' : 'rgba(245,158,11,0.25)';

    return (
      <div
        onClick={() => onSelect(item.lineId)}
        style={{
          padding: '0.5rem 0.75rem',
          borderRadius: 'var(--r-md)',
          background: selected ? bgColor : 'transparent',
          border: `1px solid ${selected ? border : 'transparent'}`,
          cursor: 'pointer',
          transition: 'background .1s, border-color .1s',
          marginBottom: 3,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: '1rem', flexShrink: 0 }}>{isSale ? '🎟️' : '💰'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '0.85rem', fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {item.name}
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 1 }}>
              {isSale ? 'Lottery Sale · No Tax' : 'Lottery Payout · Cash Out'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div style={{
            fontSize: '0.95rem', fontWeight: 700,
            color: isSale ? 'var(--green)' : 'var(--amber)',
          }}>
            {isSale ? '+' : ''}{fmt$(item.lineTotal)}
          </div>
          {selected && (
            <button
              onClick={e => { e.stopPropagation(); removeItem(item.lineId); }}
              title="Remove"
              style={{
                width: 28, height: 28, borderRadius: 6,
                background: 'var(--red-dim)', color: 'var(--red)',
                border: '1px solid rgba(224,63,63,.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    );
  }

  const hasDiscount   = item.discountType && item.discountValue > 0;
  const discountLabel = hasDiscount
    ? item.discountType === 'percent'
      ? `${item.discountValue}% OFF`
      : `-${fmt$(item.discountValue)}`
    : null;

  const hasPromo    = !!item.promoAdjustment;
  const promoLabel  = hasPromo ? (item.promoAdjustment?.badgeLabel || 'PROMO') : null;
  const promoColor  = item.promoAdjustment?.badgeColor || '#10b981';

  return (
    <div
      onClick={() => onSelect(item.lineId)}
      style={{
        padding: '0.55rem 0.75rem',
        borderRadius: 'var(--r-md)',
        background: selected ? 'rgba(122,193,67,.10)' : 'transparent',
        border: `1px solid ${selected ? 'rgba(122,193,67,.35)' : 'transparent'}`,
        cursor: 'pointer',
        transition: 'background .1s, border-color .1s',
        marginBottom: 3,
      }}
    >
      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

        {/* Inline qty controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <button
            onClick={e => { e.stopPropagation(); updateQty(item.lineId, item.qty - 1); }}
            title="Decrease"
            style={{
              width: 22, height: 22, borderRadius: 5, border: 'none',
              background: 'var(--bg-input)', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0, transition: 'background .1s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(224,63,63,.2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-input)'}
          >
            <Minus size={10} />
          </button>

          <div style={{
            minWidth: 28, height: 28, borderRadius: 6,
            background: selected ? 'rgba(122,193,67,.2)' : 'var(--bg-input)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.85rem', fontWeight: 700,
            color: selected ? 'var(--green)' : 'var(--text-primary)',
            border: selected ? '1px solid rgba(122,193,67,.35)' : '1px solid transparent',
            transition: 'background .1s, color .1s',
          }}>
            {item.qty}
          </div>

          <button
            onClick={e => { e.stopPropagation(); updateQty(item.lineId, item.qty + 1); }}
            title="Increase"
            style={{
              width: 22, height: 22, borderRadius: 5, border: 'none',
              background: 'var(--bg-input)', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0, transition: 'background .1s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(122,193,67,.2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-input)'}
          >
            <Plus size={10} />
          </button>
        </div>

        {/* Name + badges */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              maxWidth: 160,
            }}>
              {item.name}
            </span>

            {hasDiscount && (
              <span style={{
                fontSize: '0.58rem', fontWeight: 800, padding: '1px 5px',
                borderRadius: 4, background: 'rgba(245,158,11,.2)',
                color: 'var(--amber)', letterSpacing: '0.04em',
                display: 'flex', alignItems: 'center', gap: 3,
              }}>
                <Tag size={8} /> {discountLabel}
              </span>
            )}

            {hasPromo && (
              <span style={{
                fontSize: '0.58rem', fontWeight: 800, padding: '1px 5px',
                borderRadius: 4, background: promoColor + '22',
                color: promoColor, letterSpacing: '0.04em',
                display: 'flex', alignItems: 'center', gap: 3,
                border: `1px solid ${promoColor}44`,
              }}>
                <Zap size={7} /> {promoLabel}
              </span>
            )}

            {item.ebtEligible && (
              <span style={{
                fontSize: '0.58rem', fontWeight: 800, padding: '1px 5px',
                borderRadius: 4, background: 'rgba(122,193,67,.2)',
                color: 'var(--green)', letterSpacing: '0.04em',
              }}>EBT</span>
            )}

            {item.ageRequired && (
              <span style={{
                fontSize: '0.58rem', fontWeight: 800, padding: '1px 5px',
                borderRadius: 4, background: 'rgba(245,158,11,.2)',
                color: 'var(--amber)', letterSpacing: '0.04em',
              }}>{item.ageRequired}+</span>
            )}

            {item.priceOverridden && (
              <span style={{
                fontSize: '0.58rem', fontWeight: 700, padding: '1px 5px',
                borderRadius: 4, background: 'rgba(59,130,246,.2)',
                color: 'var(--blue)', letterSpacing: '0.03em',
              }}>OVRD</span>
            )}
          </div>

          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            {hasDiscount ? (
              <>
                <span style={{ textDecoration: 'line-through', opacity: 0.55 }}>{fmt$(item.unitPrice)}</span>
                <span style={{ color: 'var(--amber)', fontWeight: 700 }}>{fmt$(item.effectivePrice)}</span>
                <span style={{ opacity: 0.5 }}>each</span>
              </>
            ) : (
              <span>{fmt$(item.unitPrice)} each</span>
            )}
            {!item.taxable && <span>· No Tax</span>}
          </div>
        </div>

        {/* Line total + quick remove */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            {hasDiscount && (
              <div style={{
                fontSize: '0.65rem', color: 'var(--text-muted)',
                textDecoration: 'line-through', lineHeight: 1,
              }}>
                {fmt$(item.unitPrice * item.qty)}
              </div>
            )}
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {fmt$(item.lineTotal)}
            </div>
          </div>

          {selected && (
            <button
              onClick={e => { e.stopPropagation(); removeItem(item.lineId); }}
              title="Remove item"
              style={{
                width: 28, height: 28, borderRadius: 6,
                background: 'var(--red-dim)', color: 'var(--red)',
                border: '1px solid rgba(224,63,63,.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Deposit sub-line */}
      {item.depositAmount > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 4, paddingLeft: 80,
        }}>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-deposit)' }}>
            Bottle Deposit ({item.qty} × {fmt$(item.depositAmount)}) · No Tax
          </span>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-deposit)', fontWeight: 600 }}>
            {fmt$(item.depositTotal)}
          </span>
        </div>
      )}
    </div>
  );
}
