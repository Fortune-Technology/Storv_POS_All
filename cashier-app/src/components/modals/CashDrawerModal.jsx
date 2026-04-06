/**
 * CashDrawerModal — Mid-shift cash drop entry.
 * Two-column layout: form/note LEFT, amount display + numpad RIGHT.
 * Vendor payouts are handled by VendorPayoutModal.
 */

import React, { useState, useCallback } from 'react';
import { X, ArrowDownCircle, Check } from 'lucide-react';
import { useShiftStore } from '../../stores/useShiftStore.js';
import './CashDropModal.css';

// ── Numpad helpers ─────────────────────────────────────────────────────────
function buildAmount(current, key) {
  if (key === 'C') return '';
  if (key === '⌫') return current.slice(0, -1);
  if (key === '.') {
    if (current.includes('.')) return current;
    return (current || '0') + '.';
  }
  const parts = current.split('.');
  if (parts[1] !== undefined && parts[1].length >= 2) return current;
  if (current === '0' && key !== '.') return key;
  return current + key;
}

const NUMPAD_KEYS = ['7','8','9','C','4','5','6','⌫','1','2','3','00','0','.'];

export default function CashDrawerModal({ onClose }) {
  const { addCashDrop, shift } = useShiftStore();

  const [amountStr, setAmountStr] = useState('');
  const [note,      setNote]      = useState('');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState(false);

  const handleKey = useCallback((key) => {
    setAmountStr(prev => buildAmount(prev, key));
  }, []);

  const amount = parseFloat(amountStr) || 0;

  const handleSubmit = async () => {
    setError('');
    if (!amount || amount <= 0) { setError('Enter a valid amount greater than $0.00'); return; }

    setSaving(true);
    const result = await addCashDrop(amount, note.trim() || undefined);
    setSaving(false);

    if (result.ok) {
      setSuccess(true);
      setTimeout(() => onClose(), 1200);
    } else {
      setError(result.error || 'Something went wrong');
    }
  };

  return (
    <div className="cdm-backdrop">
      <div className="cdm-modal">

        {/* Header */}
        <div className="cdm-header">
          <div className="cdm-header-left">
            <ArrowDownCircle size={18} color="var(--amber)" />
            <div>
              <div className="cdm-header-title">Cash Drop</div>
              <div className="cdm-header-sub">Remove cash from drawer for bank deposit</div>
            </div>
          </div>
          <button className="cdm-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Two-column body */}
        <div className="cdm-body">

          {/* LEFT: shift info + note */}
          <div className="cdm-left-col">
            {shift && (
              <div className="cdm-shift-chip">
                Shift opened {new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {shift.cashierName ? ` · ${shift.cashierName}` : ''}
              </div>
            )}

            <div>
              <span className="cdm-label">Note (optional)</span>
              <input
                type="text"
                className="cdm-note-input"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="e.g. Bank deposit, safe drop…"
                onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
              />
            </div>

            {error && <div className="cdm-error">{error}</div>}
          </div>

          {/* RIGHT: amount display + numpad */}
          <div className="cdm-right-col">
            <div className="cdm-amount-display">
              <span className="cdm-amount-value">
                {amountStr ? `$${amountStr}` : <span style={{ opacity: 0.3 }}>$0.00</span>}
              </span>
              <span className="cdm-amount-hint">Tap digits to enter amount</span>
            </div>

            <div className="cdm-numpad">
              {NUMPAD_KEYS.map((k, i) => (
                <button
                  key={k + i}
                  className={`cdm-key${k === 'C' ? ' cdm-key--clear' : ''}${k === '⌫' ? ' cdm-key--backspace' : ''}${k === '0' ? ' cdm-key--zero' : ''}`}
                  onClick={() => handleKey(k)}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="cdm-footer">
          <button className="cdm-btn-cancel" onClick={onClose}>Cancel</button>
          <button
            className={`cdm-btn-submit${success ? ' cdm-btn-submit--success' : saving ? ' cdm-btn-submit--saving' : amount > 0 ? ' cdm-btn-submit--active' : ' cdm-btn-submit--disabled'}`}
            onClick={handleSubmit}
            disabled={saving || success}
          >
            {success
              ? <><Check size={15} /> Saved!</>
              : saving
              ? 'Saving…'
              : `Record Drop${amount > 0 ? ` $${amount.toFixed(2)}` : ''}`}
          </button>
        </div>

      </div>
    </div>
  );
}
