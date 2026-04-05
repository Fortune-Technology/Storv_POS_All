/**
 * LotteryShiftModal — End-of-shift lottery reconciliation.
 *
 * Shows all active boxes. Cashier enters the last-scanned ticket number
 * for each box. App calculates tickets sold → expected sales amount.
 * Compares against recorded cart transactions for variance.
 */

import React, { useState, useRef } from 'react';
import { X, Ticket, AlertTriangle, CheckCircle } from 'lucide-react';

const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
const numInput = (v) => v.replace(/[^0-9]/g, '');

export default function LotteryShiftModal({
  open,
  shiftId,
  activeBoxes = [],          // [{id, boxNumber, slotNumber, startTicket, game:{name, ticketPrice}, ticketsSold, salesAmount}]
  sessionSales = 0,          // total from cart transactions this shift
  sessionPayouts = 0,
  scanRequired = false,      // from backoffice setting
  onSave,
  onClose,
}) {
  // Per-box end ticket numbers entered by cashier
  const [endTickets, setEndTickets] = useState({});
  const [notes, setNotes]           = useState('');
  const [saving, setSaving]         = useState(false);
  const scanRefs = useRef({});

  if (!open) return null;

  // Compute per-box data
  const boxData = activeBoxes.map(box => {
    const startNum = parseInt(box.startTicket || '0', 10);
    const endRaw   = endTickets[box.id] || '';
    const endNum   = endRaw ? parseInt(endRaw, 10) : null;
    const ticketsSold = endNum !== null && endNum >= startNum ? endNum - startNum : null;
    const price    = Number(box.game?.ticketPrice || box.ticketPrice || 0);
    const calcAmount = ticketsSold !== null ? ticketsSold * price : null;
    const valid    = endNum === null || endNum >= startNum;
    return { ...box, startNum, endNum, ticketsSold, calcAmount, price, valid };
  });

  const scannedTotal   = boxData.reduce((s, b) => s + (b.calcAmount || 0), 0);
  const allScanned     = activeBoxes.length === 0 || boxData.every(b => endTickets[b.id]);
  const hasInvalid     = boxData.some(b => !b.valid);
  const variance       = scannedTotal - sessionSales;
  const varColor       = Math.abs(variance) < 0.01 ? '#16a34a' : Math.abs(variance) < 5 ? '#d97706' : '#ef4444';

  const handleSave = async () => {
    if (scanRequired && !allScanned) return;
    setSaving(true);
    try {
      const boxScans = boxData.map(b => ({
        boxId:       b.id,
        gameId:      b.gameId,
        gameName:    b.game?.name || 'Unknown',
        slotNumber:  b.slotNumber,
        startTicket: b.startTicket,
        endTicket:   endTickets[b.id] || null,
        ticketsSold: b.ticketsSold,
        amount:      b.calcAmount,
      }));
      await onSave?.({
        shiftId,
        scannedAmount:  scannedTotal,
        boxScans,
        totalSales:     sessionSales,
        totalPayouts:   sessionPayouts,
        notes:          notes.trim() || undefined,
      });
      onClose?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9100,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 12,
    }}>
      <div style={{
        background: '#ffffff', borderRadius: 20, width: '100%', maxWidth: 560,
        maxHeight: '94vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.28)', border: '1px solid #e5e7eb',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', borderBottom: '1px solid #f3f4f6', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Ticket size={18} color="#16a34a" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#111827' }}>Lottery End of Shift</div>
              <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>Scan ticket numbers to reconcile</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 4 }}><X size={20} /></button>
        </div>

        <div style={{ padding: '16px 20px 20px', flex: 1 }}>

          {/* Session Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
            {[
              { label: 'Cart Sales',   value: fmt(sessionSales),   color: '#16a34a' },
              { label: 'Cart Payouts', value: fmt(sessionPayouts), color: '#d97706' },
              { label: 'Net',          value: fmt(sessionSales - sessionPayouts), color: '#111827' },
            ].map(c => (
              <div key={c.label} style={{ background: '#f9fafb', borderRadius: 10, padding: '10px 12px', textAlign: 'center', border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: '0.65rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: c.color }}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* Active Boxes Scan */}
          {activeBoxes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#9ca3af', fontSize: '0.88rem' }}>
              No active lottery boxes
            </div>
          ) : (
            <>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                Active Boxes — Enter Last Ticket Number
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {boxData.map(box => (
                  <div key={box.id} style={{
                    background: '#f9fafb', borderRadius: 12, padding: '12px 14px',
                    border: `1.5px solid ${endTickets[box.id] ? (box.valid ? '#bbf7d0' : '#fecaca') : '#e5e7eb'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#111827' }}>
                          {box.game?.name || 'Unknown Game'}
                          {box.slotNumber && <span style={{ marginLeft: 6, fontSize: '0.7rem', color: '#9ca3af', fontWeight: 600 }}>Slot #{box.slotNumber}</span>}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 2 }}>
                          Start: #{box.startTicket || '—'} · ${Number(box.price || 0).toFixed(2)}/ticket
                        </div>
                      </div>
                      {box.calcAmount !== null && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '1rem', fontWeight: 800, color: '#16a34a' }}>{fmt(box.calcAmount)}</div>
                          <div style={{ fontSize: '0.68rem', color: '#9ca3af' }}>{box.ticketsSold} tickets</div>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        ref={el => { scanRefs.current[box.id] = el; }}
                        type="text"
                        inputMode="numeric"
                        placeholder="Last ticket # (scan or type)"
                        value={endTickets[box.id] || ''}
                        onChange={e => setEndTickets(prev => ({ ...prev, [box.id]: numInput(e.target.value) }))}
                        style={{
                          flex: 1, padding: '8px 12px', borderRadius: 8,
                          border: `1.5px solid ${!box.valid ? '#fca5a5' : '#e5e7eb'}`,
                          background: '#ffffff', fontSize: '0.88rem', color: '#111827',
                          fontFamily: 'monospace',
                        }}
                      />
                      {endTickets[box.id] && (
                        box.valid
                          ? <CheckCircle size={18} color="#16a34a" />
                          : <AlertTriangle size={18} color="#ef4444" />
                      )}
                    </div>
                    {!box.valid && (
                      <div style={{ fontSize: '0.72rem', color: '#ef4444', marginTop: 4 }}>
                        End ticket must be ≥ start ticket ({box.startTicket})
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Variance Summary */}
              {allScanned && !hasInvalid && (
                <div style={{
                  background: Math.abs(variance) < 0.01 ? '#f0fdf4' : '#fffbeb',
                  border: `1.5px solid ${Math.abs(variance) < 0.01 ? '#bbf7d0' : '#fde68a'}`,
                  borderRadius: 12, padding: '12px 16px', marginBottom: 12,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: '#6b7280', fontWeight: 600, marginBottom: 2 }}>Scanned Total vs Cart Total</div>
                      <div style={{ fontSize: '0.85rem', color: '#374151' }}>
                        Scanned: <strong>{fmt(scannedTotal)}</strong> · Cart: <strong>{fmt(sessionSales)}</strong>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>Variance</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: varColor }}>
                        {variance >= 0 ? '+' : ''}{fmt(variance)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Notes */}
          <input
            type="text"
            placeholder="Notes (optional)"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 8, marginBottom: 12,
              border: '1.5px solid #e5e7eb', background: '#f9fafb', color: '#111827',
              fontSize: '0.87rem', boxSizing: 'border-box',
            }}
          />

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleSave}
              disabled={saving || hasInvalid || (scanRequired && !allScanned)}
              style={{
                flex: 1, padding: '13px', borderRadius: 12, border: 'none',
                fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer',
                background: (saving || hasInvalid || (scanRequired && !allScanned)) ? '#f3f4f6' : '#16a34a',
                color:      (saving || hasInvalid || (scanRequired && !allScanned)) ? '#9ca3af' : '#ffffff',
              }}
            >
              {saving ? 'Saving…' : scanRequired && !allScanned ? 'Scan All Boxes First' : 'Save & Close Shift'}
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '13px 18px', borderRadius: 12, border: '1.5px solid #e5e7eb',
                background: '#fff', color: '#6b7280', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
              }}
            >
              Skip
            </button>
          </div>

          {scanRequired && !allScanned && (
            <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#d97706', textAlign: 'center' }}>
              Ticket scanning is required before closing this shift
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
