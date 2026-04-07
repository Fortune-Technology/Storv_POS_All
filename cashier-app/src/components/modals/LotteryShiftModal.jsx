/**
 * LotteryShiftModal — End-of-shift lottery reconciliation.
 *
 * Shows all active boxes. Cashier enters the last-scanned ticket number
 * for each box. App calculates tickets sold → expected sales amount.
 * Compares against recorded cart transactions for variance.
 *
 * When `pendingShiftClose` is true, a banner reminds the cashier that
 * completing this scan will proceed directly to closing the shift.
 */

import React, { useState, useRef } from 'react';
import { X, Ticket, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react';
import './LotteryShiftModal.css';

const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
const numInput = (v) => v.replace(/[^0-9]/g, '');

export default function LotteryShiftModal({
  open,
  shiftId,
  activeBoxes       = [],
  sessionSales      = 0,
  sessionPayouts    = 0,
  scanRequired      = false,
  pendingShiftClose = false,  // true when triggered by CloseShift flow
  onSave,
  onClose,
}) {
  const [endTickets, setEndTickets] = useState({});
  const [notes,      setNotes]      = useState('');
  const [saving,     setSaving]     = useState(false);
  const scanRefs = useRef({});

  if (!open) return null;

  // ── Per-box computed data ────────────────────────────────────────────────
  const boxData = activeBoxes.map(box => {
    const startNum    = parseInt(box.startTicket || '0', 10);
    const endRaw      = endTickets[box.id] || '';
    const endNum      = endRaw ? parseInt(endRaw, 10) : null;
    const ticketsSold = endNum !== null && endNum >= startNum ? endNum - startNum : null;
    const price       = Number(box.game?.ticketPrice || box.ticketPrice || 0);
    const calcAmount  = ticketsSold !== null ? ticketsSold * price : null;
    const valid       = endNum === null || endNum >= startNum;
    return { ...box, startNum, endNum, ticketsSold, calcAmount, price, valid };
  });

  const scannedTotal = boxData.reduce((s, b) => s + (b.calcAmount || 0), 0);
  const allScanned   = activeBoxes.length === 0 || boxData.every(b => endTickets[b.id]);
  const hasInvalid   = boxData.some(b => !b.valid);
  const variance     = scannedTotal - sessionSales;
  const varOk        = Math.abs(variance) < 0.01;
  const varColor     = varOk ? '#16a34a' : Math.abs(variance) < 5 ? '#d97706' : '#ef4444';

  const canSave = !saving && !hasInvalid && !(scanRequired && !allScanned);

  // ── Save handler ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!canSave) return;
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
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="lsm-backdrop">
      <div className="lsm-modal">

        {/* Header */}
        <div className="lsm-header">
          <div className="lsm-header-left">
            <div className="lsm-header-icon">
              <Ticket size={18} color="#16a34a" />
            </div>
            <div>
              <div className="lsm-header-title">Lottery End of Shift</div>
              <div className="lsm-header-sub">Scan ticket numbers to reconcile</div>
            </div>
          </div>
          <button className="lsm-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="lsm-body">

          {/* Pending-close banner */}
          {pendingShiftClose && (
            <div className="lsm-pending-close-banner">
              <AlertCircle size={16} />
              Scan required before closing the shift. Complete reconciliation to proceed.
            </div>
          )}

          {/* Session summary */}
          <div className="lsm-summary-grid">
            <div className="lsm-summary-card">
              <span className="lsm-summary-label">Cart Sales</span>
              <span className="lsm-summary-value lsm-summary-value--green">{fmt(sessionSales)}</span>
            </div>
            <div className="lsm-summary-card">
              <span className="lsm-summary-label">Cart Payouts</span>
              <span className="lsm-summary-value lsm-summary-value--amber">{fmt(sessionPayouts)}</span>
            </div>
            <div className="lsm-summary-card">
              <span className="lsm-summary-label">Net</span>
              <span className="lsm-summary-value lsm-summary-value--dark">{fmt(sessionSales - sessionPayouts)}</span>
            </div>
          </div>

          {/* Active boxes */}
          {activeBoxes.length === 0 ? (
            <div className="lsm-empty">No active lottery boxes</div>
          ) : (
            <>
              <span className="lsm-section-label">Active Boxes — Enter Last Ticket Number</span>

              <div className="lsm-box-list">
                {boxData.map(box => {
                  const hasVal   = Boolean(endTickets[box.id]);
                  const rowMod   = hasVal
                    ? (box.valid ? ' lsm-box-row--scanned-ok' : ' lsm-box-row--scanned-err')
                    : '';

                  return (
                    <div key={box.id} className={`lsm-box-row${rowMod}`}>
                      <div className="lsm-box-top">
                        <div>
                          <div className="lsm-box-name">
                            {box.game?.name || 'Unknown Game'}
                            {box.slotNumber && (
                              <span className="lsm-box-slot">Slot #{box.slotNumber}</span>
                            )}
                          </div>
                          <div className="lsm-box-meta">
                            Start: #{box.startTicket || '—'} · ${Number(box.price || 0).toFixed(2)}/ticket
                          </div>
                        </div>
                        {box.calcAmount !== null && (
                          <div>
                            <div className="lsm-box-amount-value">{fmt(box.calcAmount)}</div>
                            <div className="lsm-box-ticket-count">{box.ticketsSold} tickets</div>
                          </div>
                        )}
                      </div>

                      <div className="lsm-scan-row">
                        <input
                          ref={el => { scanRefs.current[box.id] = el; }}
                          type="text"
                          inputMode="numeric"
                          placeholder="Last ticket # (scan or type)"
                          value={endTickets[box.id] || ''}
                          onChange={e => setEndTickets(prev => ({
                            ...prev,
                            [box.id]: numInput(e.target.value),
                          }))}
                          className={`lsm-scan-input${!box.valid ? ' lsm-scan-input--invalid' : ''}`}
                        />
                        {hasVal && (
                          box.valid
                            ? <CheckCircle size={18} color="#16a34a" />
                            : <AlertTriangle size={18} color="#ef4444" />
                        )}
                      </div>

                      {!box.valid && (
                        <div className="lsm-box-error-msg">
                          End ticket must be ≥ start ticket ({box.startTicket})
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Variance summary — shown once all boxes are scanned and valid */}
              {allScanned && !hasInvalid && (
                <div className={`lsm-variance ${varOk ? 'lsm-variance--ok' : 'lsm-variance--warn'}`}>
                  <div className="lsm-variance-inner">
                    <div>
                      <div className="lsm-variance-label">Scanned Total vs Cart Total</div>
                      <div className="lsm-variance-detail">
                        Scanned: <strong>{fmt(scannedTotal)}</strong> · Cart: <strong>{fmt(sessionSales)}</strong>
                      </div>
                    </div>
                    <div className="lsm-variance-right">
                      <div className="lsm-variance-num-label">Variance</div>
                      <div className="lsm-variance-num" style={{ color: varColor }}>
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
            className="lsm-notes-input"
          />

          {/* Action buttons */}
          <div className="lsm-actions">
            <button
              onClick={handleSave}
              disabled={!canSave}
              className={`lsm-btn-save ${canSave ? 'lsm-btn-save--active' : 'lsm-btn-save--disabled'}`}
            >
              {saving
                ? 'Saving…'
                : scanRequired && !allScanned
                  ? 'Scan All Boxes First'
                  : pendingShiftClose
                    ? 'Save & Continue to Close Shift'
                    : 'Save & Close Lottery'}
            </button>
            <button className="lsm-btn-skip" onClick={onClose}>
              Skip
            </button>
          </div>

          {scanRequired && !allScanned && (
            <div className="lsm-scan-required-msg">
              Ticket scanning is required before closing this shift
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
