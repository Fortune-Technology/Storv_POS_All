/**
 * DiscountModal — Apply % or $ discount.
 * Side-by-side layout: left = context/preview, right = numpad.
 * Phone-style entry: digits push in from the right.
 *   % mode:  "10"   → 10%     (decimals=0, integer)
 *   $ mode:  "500"  → $5.00   (decimals=2, implied cents)
 */

import React, { useState } from 'react';
import { X, Tag, Trash2 } from 'lucide-react';
import { useCartStore } from '../../stores/useCartStore.js';
import { fmt$ } from '../../utils/formatters.js';
import NumPadInline, { digitsToNumber } from '../pos/NumPadInline.jsx';

export default function DiscountModal({ lineId, onClose }) {
  const items          = useCartStore(s => s.items);
  const applyLineDisc  = useCartStore(s => s.applyLineDiscount);
  const applyOrderDisc = useCartStore(s => s.applyOrderDiscount);
  const removeLineDisc = useCartStore(s => s.removeLineDiscount);
  const removeOrderDisc= useCartStore(s => s.removeOrderDiscount);
  const orderDiscount  = useCartStore(s => s.orderDiscount);

  const item     = lineId ? items.find(i => i.lineId === lineId) : null;
  const existing = lineId
    ? (item?.discountType ? { type: item.discountType, value: item.discountValue } : null)
    : orderDiscount;

  const [discType, setDiscType] = useState(existing?.type || 'percent');
  // digits: for % → "10" = 10%,  for $ → "500" = $5.00
  const [digits,   setDigits]   = useState(() => {
    if (existing?.value == null) return '';
    if (existing.type === 'percent') return String(Math.round(existing.value));
    return String(Math.round(existing.value * 100));
  });
  const [error, setError] = useState('');

  // Derive numeric value based on mode
  const decimals = discType === 'percent' ? 0 : 2;
  const numVal   = digitsToNumber(digits, decimals);  // dollars or percent

  const preview = (() => {
    if (!numVal) return null;
    if (item) {
      const eff = discType === 'percent'
        ? item.unitPrice * (1 - numVal / 100)
        : Math.max(0, item.unitPrice - numVal);
      return { original: item.unitPrice * item.qty, discounted: eff * item.qty };
    }
    const sub  = items.reduce((s, i) => s + i.lineTotal, 0);
    const disc = discType === 'percent' ? sub * numVal / 100 : Math.min(numVal, sub);
    return { original: sub, discounted: sub - disc };
  })();

  const label = item ? `Discount: ${item.name}` : 'Order Discount';

  const apply = () => {
    if (!numVal || numVal <= 0)               { setError('Enter a valid discount amount'); return; }
    if (discType === 'percent' && numVal > 100){ setError('Maximum 100%'); return; }
    if (lineId) applyLineDisc(lineId, discType, numVal);
    else        applyOrderDisc(discType, numVal);
    onClose();
  };

  const remove = () => {
    if (lineId) removeLineDisc(lineId);
    else        removeOrderDisc();
    onClose();
  };

  const handleTypeChange = (t) => {
    setDiscType(t);
    setDigits('');
    setError('');
  };

  const handleChange = (v) => { setDigits(v); setError(''); };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 150,
      background: 'rgba(0,0,0,.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }}>
      <div style={{
        background: 'var(--bg-panel)', borderRadius: 18,
        border: '1px solid var(--border-light)',
        width: '100%', maxWidth: 580,
        maxHeight: '94vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 60px rgba(0,0,0,.55)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(245,158,11,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Tag size={16} color="var(--amber)" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.62rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>APPLY DISCOUNT</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{label}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 6 }}>
            <X size={16} />
          </button>
        </div>

        {/* Side-by-side body */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Left — type toggle + preview */}
          <div style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center', borderRight: '1px solid var(--border)' }}>

            {/* Type toggle */}
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { id: 'percent', label: '% Percent Off', color: 'var(--amber)', bg: 'rgba(245,158,11,.1)' },
                { id: 'amount',  label: '$ Dollar Off',  color: 'var(--green)', bg: 'rgba(122,193,67,.1)' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => handleTypeChange(t.id)}
                  style={{
                    flex: 1, padding: '0.75rem', borderRadius: 10,
                    background: discType === t.id ? t.bg : 'var(--bg-input)',
                    border: `1.5px solid ${discType === t.id ? t.color : 'var(--border)'}`,
                    color: discType === t.id ? t.color : 'var(--text-secondary)',
                    fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
                    transition: 'all .12s',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Quick % presets */}
            {discType === 'percent' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[5, 10, 15, 20, 25, 50].map(p => (
                  <button
                    key={p}
                    onClick={() => { setDigits(String(p)); setError(''); }}
                    style={{
                      padding: '0.5rem 0.875rem', borderRadius: 8,
                      background: numVal === p ? 'rgba(245,158,11,.15)' : 'var(--bg-card)',
                      border: `1px solid ${numVal === p ? 'rgba(245,158,11,.45)' : 'var(--border)'}`,
                      color: numVal === p ? 'var(--amber)' : 'var(--text-secondary)',
                      fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
                    }}
                  >
                    {p}%
                  </button>
                ))}
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{ color: '#f87171', fontSize: '0.8rem', fontWeight: 600, textAlign: 'center' }}>{error}</div>
            )}

            {/* Preview */}
            {preview ? (
              <div style={{ background: 'var(--bg-card)', borderRadius: 10, padding: '0.875rem 1rem' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>PREVIEW</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 2 }}>Original</div>
                    <div style={{ fontWeight: 700, textDecoration: 'line-through', color: 'var(--text-secondary)', fontSize: '1rem' }}>{fmt$(preview.original)}</div>
                  </div>
                  <div style={{ fontSize: '1.3rem', color: 'var(--amber)', fontWeight: 800, opacity: 0.5 }}>→</div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 2 }}>After discount</div>
                    <div style={{ fontWeight: 900, color: 'var(--green)', fontSize: '1.3rem' }}>{fmt$(Math.max(0, preview.discounted))}</div>
                  </div>
                </div>
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', textAlign: 'center', fontSize: '0.78rem', color: 'var(--amber)', fontWeight: 700 }}>
                  Saving {discType === 'percent' ? `${numVal}%` : fmt$(numVal)}
                  {discType === 'percent' && preview && ` — ${fmt$(preview.original - Math.max(0, preview.discounted))}`}
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.3 }}>
                <Tag size={32} />
              </div>
            )}
          </div>

          {/* Right — numpad */}
          <div style={{ width: 252, flexShrink: 0, padding: '0.875rem', display: 'flex', alignItems: 'center' }}>
            <NumPadInline
              value={digits}
              onChange={handleChange}
              accentColor={discType === 'percent' ? 'var(--amber)' : 'var(--green)'}
              prefix={discType === 'percent' ? '%' : '$'}
              decimals={decimals}
              maxDigits={discType === 'percent' ? 3 : 7}
            />
          </div>

        </div>

        {/* Footer */}
        <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 8 }}>
          {existing && (
            <button onClick={remove} style={{ padding: '0 16px', height: 52, borderRadius: 10, background: 'rgba(224,63,63,.08)', border: '1px solid rgba(224,63,63,.25)', color: '#f87171', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <Trash2 size={15} /> Remove
            </button>
          )}
          <button
            onClick={apply}
            disabled={!numVal || numVal <= 0}
            style={{
              flex: 1, height: 52, borderRadius: 10, border: 'none',
              background: numVal > 0 ? 'var(--amber)' : 'var(--bg-input)',
              color: numVal > 0 ? '#0f1117' : 'var(--text-muted)',
              fontWeight: 800, fontSize: '0.95rem',
              cursor: numVal > 0 ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <Tag size={16} /> Apply Discount
          </button>
        </div>
      </div>
    </div>
  );
}
