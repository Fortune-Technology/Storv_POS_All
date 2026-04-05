/**
 * LotteryPayoutModal — light-theme modal for adding lottery payouts to the cart.
 * Payouts are negative line items so the cart total decreases (cash given to customer).
 */

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useCartStore } from '../../stores/useCartStore.js';

const NUMPAD = ['7','8','9','4','5','6','1','2','3','.','0','⌫'];
const PRESETS = [5, 10, 20, 50, 100, 200];

export default function LotteryPayoutModal({ open, onClose }) {
  const addLotteryItem = useCartStore(s => s.addLotteryItem);
  const [display, setDisplay] = useState('0');
  const [note,    setNote]    = useState('');
  const [added,   setAdded]   = useState([]);

  if (!open) return null;

  const handleKey = (key) => {
    setDisplay(prev => {
      if (key === '⌫') return prev.length > 1 ? prev.slice(0, -1) : '0';
      if (key === '.') return prev.includes('.') ? prev : prev + '.';
      if (prev === '0') return key;
      if (prev.includes('.') && prev.split('.')[1].length >= 2) return prev;
      return prev + key;
    });
  };

  const amount = parseFloat(display) || 0;

  const handleAdd = () => {
    if (amount <= 0) return;
    addLotteryItem({ lotteryType: 'payout', amount, notes: note.trim() || undefined });
    setAdded(a => [...a, { amount, note: note.trim() }]);
    setDisplay('0');
    setNote('');
  };

  const handleDone = () => {
    setAdded([]);
    setDisplay('0');
    setNote('');
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#ffffff', borderRadius: 20, width: '100%', maxWidth: 440,
        maxHeight: '92vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.25)', border: '1px solid #e5e7eb',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 12px', borderBottom: '1px solid #f3f4f6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>💰</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#111827' }}>Lottery Payout</div>
              <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>Cash paid to winning customer</div>
            </div>
          </div>
          <button onClick={handleDone} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 4 }}><X size={20} /></button>
        </div>

        <div style={{ padding: '16px 20px 20px' }}>
          {/* Amount display */}
          <div style={{
            background: '#fffbeb', borderRadius: 12, padding: '14px 18px',
            marginBottom: 10, textAlign: 'right',
            border: '1.5px solid #fde68a',
          }}>
            <span style={{ fontSize: '2.2rem', fontWeight: 800, color: '#92400e', letterSpacing: '-0.03em' }}>${display}</span>
          </div>

          {/* Quick presets */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 10 }}>
            {PRESETS.map(p => (
              <button key={p} onClick={() => setDisplay(String(p))}
                style={{ padding: '7px 0', borderRadius: 8, border: '1.5px solid #fde68a', background: '#fffbeb', color: '#92400e', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}>
                ${p}
              </button>
            ))}
          </div>

          {/* Numpad */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7, marginBottom: 12 }}>
            {NUMPAD.map(k => (
              <button key={k} onClick={() => handleKey(k)} style={{
                padding: '13px 0', borderRadius: 10, fontSize: '1.1rem', fontWeight: 700, cursor: 'pointer',
                border: '1.5px solid #e5e7eb',
                background: k === '⌫' ? '#fff1f2' : '#f9fafb',
                color: k === '⌫' ? '#ef4444' : '#111827',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = k === '⌫' ? '#ffe4e6' : '#f3f4f6'; }}
              onMouseLeave={e => { e.currentTarget.style.background = k === '⌫' ? '#fff1f2' : '#f9fafb'; }}
              >{k}</button>
            ))}
          </div>

          {/* Note */}
          <input type="text" placeholder="Note — e.g. winning ticket #12345 (optional)"
            value={note} onChange={e => setNote(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #e5e7eb', background: '#f9fafb', color: '#111827', fontSize: '0.88rem', marginBottom: 12, boxSizing: 'border-box' }} />

          {/* Add button */}
          <button onClick={handleAdd} disabled={amount <= 0}
            style={{
              width: '100%', padding: '13px', borderRadius: 12, marginBottom: 10,
              border: 'none', fontSize: '0.95rem', fontWeight: 700, cursor: amount > 0 ? 'pointer' : 'not-allowed',
              background: amount > 0 ? '#d97706' : '#f3f4f6',
              color: amount > 0 ? '#fff' : '#9ca3af',
            }}>
            Add Payout — {`$${amount.toFixed(2)}`} to Cart
          </button>

          {/* Added preview */}
          {added.length > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#92400e', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Added to Cart</div>
              {added.map((a, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#78350f', padding: '2px 0' }}>
                  <span>💰 Payout{a.note ? ` — ${a.note}` : ''}</span>
                  <span style={{ fontWeight: 700 }}>-${a.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}

          {added.length > 0 && (
            <button onClick={handleDone} style={{
              width: '100%', padding: '13px', borderRadius: 12, marginTop: 10,
              border: '2px solid #d97706', background: '#fff', color: '#d97706',
              fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer',
            }}>
              Done — {added.length} payout{added.length > 1 ? 's' : ''} in cart
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
