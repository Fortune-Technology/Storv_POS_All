/**
 * CashDrawerModal — Mid-shift cash drop entry.
 * Two-column layout: form/note LEFT, amount display + numpad RIGHT.
 * After saving shows details with Print Receipt / Skip buttons.
 */

import React, { useState, useCallback } from 'react';
import { X, ArrowDownCircle, Check, Printer } from 'lucide-react';
import { useShiftStore } from '../../stores/useShiftStore.js';
import { digitsToDisplay, digitsToNumber } from '../pos/NumPadInline.jsx';
import './CashDropModal.css';

// Cent-based entry (same model as TenderModal): digits push in from the right.
// "587" -> displays "$5.87".
const MAX_DIGITS = 7;
function buildAmount(current, key) {
  if (key === 'C')  return '';
  if (key === '⌫') return current.slice(0, -1);
  if (current.length >= MAX_DIGITS) return current;
  if (current === '' && key === '0') return '';
  if (key === '00') {
    if (current.length >= MAX_DIGITS - 1) return current;
    return current + '00';
  }
  return current + key;
}

const NUMPAD_KEYS = ['7','8','9','C','4','5','6','⌫','1','2','3','00','0','.'];

export default function CashDrawerModal({ onClose, onPrint }) {
  const { addCashDrop, shift } = useShiftStore();

  const [amountStr, setAmountStr] = useState('');
  const [note,      setNote]      = useState('');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState(null); // { amount, note, time }

  const handleKey = useCallback((key) => {
    if (key === '.') return; // no-op in cent-entry mode
    setAmountStr(prev => buildAmount(prev, key));
  }, []);

  const amount = digitsToNumber(amountStr, 2);
  const amountDisplay = digitsToDisplay(amountStr, 2);

  const handleSubmit = async () => {
    setError('');
    if (!amount || amount <= 0) { setError('Enter a valid amount greater than $0.00'); return; }

    setSaving(true);
    const result = await addCashDrop(amount, note.trim() || undefined);
    setSaving(false);

    if (result.ok) {
      setSuccess({
        amount,
        note:  note.trim() || null,
        time:  new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        drop:  result.drop,
      });
    } else {
      setError(result.error || 'Something went wrong');
    }
  };

  const handlePrint = () => {
    onPrint?.({ type: 'cash_drop', ...success });
    onClose();
  };

  /* ── Success state ── */
  if (success) {
    return (
      <div className="cdm-backdrop">
        <div className="cdm-modal cdm-modal--narrow">
          <div className="cdm-header">
            <div className="cdm-header-left">
              <ArrowDownCircle size={18} color="var(--amber)" />
              <div>
                <div className="cdm-header-title">Cash Drop Recorded</div>
                <div className="cdm-header-sub">{success.time}</div>
              </div>
            </div>
            <button className="cdm-close-btn" onClick={onClose}><X size={16} /></button>
          </div>

          <div className="cdm-success">
            <div className="cdm-success-icon">
              <Check size={28} color="var(--amber)" />
            </div>
            <p className="cdm-success-amount">${success.amount.toFixed(2)}</p>
            <p className="cdm-success-label">removed from drawer</p>
            {success.note && (
              <p className="cdm-success-note">{success.note}</p>
            )}
            {shift && (
              <p className="cdm-success-meta">
                Shift: {new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {shift.cashierName ? ` · ${shift.cashierName}` : ''}
              </p>
            )}
          </div>

          <div className="cdm-footer">
            <button className="cdm-btn-cancel" onClick={handlePrint}>
              <Printer size={14} className="cdm-print-icon" /> Print Receipt
            </button>
            <button
              className="cdm-btn-submit cdm-btn-submit--active"
              onClick={onClose}
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cdm-backdrop">
      <div className="cdm-modal">

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

        <div className="cdm-body">
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

          <div className="cdm-right-col">
            <div className="cdm-amount-display">
              <span className="cdm-amount-value">
                {amountStr ? `$${amountDisplay}` : <span className="cdm-amount-placeholder">$0.00</span>}
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

        <div className="cdm-footer">
          <button className="cdm-btn-cancel" onClick={onClose}>Cancel</button>
          <button
            className={`cdm-btn-submit${saving ? ' cdm-btn-submit--saving' : amount > 0 ? ' cdm-btn-submit--active' : ' cdm-btn-submit--disabled'}`}
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? 'Saving…' : `Record Drop${amount > 0 ? ` $${amount.toFixed(2)}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
