/**
 * VoidModal — Confirms voiding the current (un-tendered) transaction.
 * Shows the items currently rung up, asks for an optional reason, then clears the cart.
 */
import React, { useState } from 'react';
import { X, Ban, AlertTriangle, Check } from 'lucide-react';
import { fmt$ } from '../../utils/formatters.js';

const BACKDROP = {
  position: 'fixed', inset: 0, zIndex: 210,
  background: 'rgba(0,0,0,.75)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '1rem',
};

export default function VoidModal({ onClose, items = [], totals = {}, onConfirm }) {
  const [note, setNote]   = useState('');
  const [done, setDone]   = useState(false);

  const doVoid = () => {
    setDone(true);
    setTimeout(() => {
      onConfirm?.(note);
      onClose();
    }, 800);
  };

  const grandTotal = totals.grandTotal ?? 0;

  return (
    <div style={BACKDROP}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'var(--bg-panel)', borderRadius: 20,
        border: '1px solid rgba(224,63,63,.35)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,.65)',
      }}>

        {/* Header */}
        <div style={{
          padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'rgba(224,63,63,.06)', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Ban size={16} color="var(--red)" />
            <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--red)' }}>
              Void Current Transaction
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 6, display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        {done ? (
          /* ── Success state ── */
          <div style={{
            padding: '3rem',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12,
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%',
              background: 'rgba(224,63,63,.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Check size={24} color="var(--red)" />
            </div>
            <div style={{ fontWeight: 700, color: 'var(--red)' }}>Transaction Voided</div>
          </div>
        ) : (
          <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Current cart items */}
            <div style={{
              background: 'rgba(224,63,63,.04)',
              border: '1px solid rgba(224,63,63,.15)',
              borderRadius: 12, overflow: 'hidden',
            }}>
              <div style={{
                maxHeight: 220, overflowY: 'auto',
              }}>
                {items.length === 0 ? (
                  <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    No items in cart
                  </div>
                ) : items.map((item, i) => (
                  <div key={item.lineId} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.55rem 1rem',
                    borderBottom: i < items.length - 1 ? '1px solid rgba(224,63,63,.1)' : 'none',
                  }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                      {item.qty > 1 ? `${item.qty}× ` : ''}{item.name}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {fmt$(item.lineTotal ?? item.unitPrice * item.qty)}
                    </span>
                  </div>
                ))}
              </div>
              {items.length > 0 && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.65rem 1rem',
                  borderTop: '1px solid rgba(224,63,63,.2)',
                  background: 'rgba(224,63,63,.06)',
                }}>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {items.length} item{items.length !== 1 ? 's' : ''} — TOTAL
                  </span>
                  <span style={{ fontWeight: 900, fontSize: '1.1rem', color: 'var(--red)' }}>
                    {fmt$(grandTotal)}
                  </span>
                </div>
              )}
            </div>

            {/* Warning */}
            <div style={{
              background: 'rgba(245,158,11,.06)',
              border: '1px solid rgba(245,158,11,.2)',
              borderRadius: 8, padding: '0.75rem',
              display: 'flex', gap: 8,
            }}>
              <AlertTriangle size={15} color="var(--amber)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: '0.78rem', color: 'var(--amber)', fontWeight: 600 }}>
                All items will be removed from the register. This cannot be undone.
              </span>
            </div>

            {/* Reason */}
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Reason for void (optional)…"
              autoFocus
              style={{
                width: '100%', padding: '0.75rem',
                background: 'var(--bg-input)', border: '1px solid var(--border)',
                borderRadius: 8, color: 'var(--text-primary)',
                fontSize: '0.875rem', boxSizing: 'border-box', outline: 'none',
              }}
            />

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={onClose}
                style={{
                  flex: 1, padding: '0.875rem',
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 10, color: 'var(--text-secondary)',
                  fontWeight: 700, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={doVoid}
                disabled={items.length === 0}
                style={{
                  flex: 2, padding: '0.875rem',
                  background: items.length === 0 ? 'var(--bg-input)' : 'var(--red)',
                  border: 'none', borderRadius: 10,
                  color: items.length === 0 ? 'var(--text-muted)' : '#fff',
                  fontWeight: 800, cursor: items.length === 0 ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <Ban size={16} /> Void Transaction
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
