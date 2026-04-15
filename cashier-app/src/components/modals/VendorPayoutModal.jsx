/**
 * VendorPayoutModal — Cashier interface for recording vendor / expense payouts.
 * Two-column layout: numpad (left) always visible | form fields (right).
 * Features: amount numpad, vendor select, tender method, type toggle, note.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { ArrowUpCircle, X, ChevronDown, Check, Printer, DollarSign, ShoppingCart } from 'lucide-react';
import { useShiftStore }   from '../../stores/useShiftStore.js';
import { useAuthStore }    from '../../stores/useAuthStore.js';
import { useStationStore } from '../../stores/useStationStore.js';
import { usePOSConfig, DEFAULT_POS_CONFIG } from '../../hooks/usePOSConfig.js';
import { getVendors }      from '../../api/pos.js';
import { digitsToDisplay, digitsToNumber } from '../pos/NumPadInline.jsx';
import './VendorPayoutModal.css';

// ── Cent-based numpad helper ───────────────────────────────────────────────
// Matches TenderModal / NumPadInline behavior: digits push in from the right.
// "587" -> displays "$5.87". Backspace removes rightmost digit. Max 7 digits
// ($99,999.99) to match POS transaction cap.
const MAX_DIGITS = 7;
function buildAmount(current, key) {
  if (key === 'C')  return '';
  if (key === '⌫') return current.slice(0, -1);
  if (current.length >= MAX_DIGITS) return current;
  if (current === '' && key === '0') return ''; // ignore leading zero
  // "00" shortcut
  if (key === '00') {
    if (current.length >= MAX_DIGITS - 1) return current;
    return current + '00';
  }
  return current + key;
}

const NUMPAD_KEYS = ['7','8','9','C','4','5','6','⌫','1','2','3','00','0','.'];

export default function VendorPayoutModal({ onClose, onComplete }) {
  const { addPayout, shift } = useShiftStore();
  const cashier  = useAuthStore(s => s.cashier);
  const station  = useStationStore(s => s.station);
  const posConfig = usePOSConfig();

  const [amountStr,    setAmountStr]    = useState('');
  const [vendors,      setVendors]      = useState([]);
  const [vendorId,     setVendorId]     = useState('');
  const [recipient,    setRecipient]    = useState('');
  const [payoutType,   setPayoutType]   = useState('expense');
  const [tenderMethod, setTenderMethod] = useState('cash');
  const [note,         setNote]         = useState('');
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');
  const [success,      setSuccess]      = useState(null);
  const [vendorsLoad,  setVendorsLoad]  = useState(false);

  // Enabled tender methods from store config
  const tenderMethods = (posConfig.vendorTenderMethods || DEFAULT_POS_CONFIG.vendorTenderMethods || [])
    .filter(t => t.enabled);

  // Default tenderMethod to first enabled one
  useEffect(() => {
    if (tenderMethods.length > 0 && !tenderMethods.find(t => t.id === tenderMethod)) {
      setTenderMethod(tenderMethods[0].id);
    }
  }, [posConfig]);

  useEffect(() => {
    setVendorsLoad(true);
    getVendors()
      .then(v => setVendors(Array.isArray(v) ? v : (v?.vendors || [])))
      .catch(() => setVendors([]))
      .finally(() => setVendorsLoad(false));
  }, []);

  const handleKey = useCallback((key) => {
    // The legacy '.' key is a no-op in cent-entry mode (digits imply cents).
    if (key === '.') return;
    setAmountStr(prev => buildAmount(prev, key));
  }, []);

  const amount = digitsToNumber(amountStr, 2);
  const amountDisplay = digitsToDisplay(amountStr, 2);
  const selectedVendor = vendors.find(v => String(v.id) === String(vendorId));
  const displayVendorName = selectedVendor?.name || recipient || '';

  const handleConfirm = async () => {
    if (!amount || amount <= 0) { setError('Enter an amount greater than $0.00'); return; }
    if (!shift) { setError('No active shift. Please open a shift first.'); return; }
    setError('');
    setSaving(true);
    try {
      const result = await addPayout(amount, recipient || null, note || null, {
        vendorId:     vendorId ? parseInt(vendorId) : undefined,
        payoutType,
        tenderMethod,
      });
      setSuccess({
        amount,
        vendorName: displayVendorName || 'Vendor',
        type: payoutType,
        tenderMethod,
        result,
      });
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to record payout');
    } finally {
      setSaving(false);
    }
  };

  const handleDone = (shouldPrint) => {
    if (shouldPrint && success?.result) {
      onComplete?.({ ...success.result, _printRequested: true });
    } else {
      onComplete?.(success?.result);
    }
    onClose();
  };

  const tenderLabel = tenderMethods.find(t => t.id === tenderMethod)?.label || tenderMethod;

  return (
    <div className="vpm-backdrop">
      <div className="vpm-modal">

        {/* Header */}
        <div className="vpm-header">
          <div className="vpm-header-title">
            <ArrowUpCircle size={18} color="#a855f7" />
            <div>
              <h2>Vendor Payout</h2>
              <p>Record cash paid out from drawer</p>
            </div>
          </div>
          <button className="vpm-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {success ? (
          /* ── Success state ── */
          <div className="vpm-success">
            <div className="vpm-success-icon">
              <Check size={28} color="#a855f7" />
            </div>
            <p className="vpm-success-title">Payout Recorded</p>
            <p className="vpm-success-detail">
              <strong className="vpm-success-amount-highlight">${success.amount.toFixed(2)}</strong> paid out to{' '}
              <strong className="vpm-success-vendor-highlight">{success.vendorName}</strong>
              <br />
              <span className="vpm-success-type-cap">{success.type}</span> · via {tenderLabel} · {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </p>
            <div className="vpm-success-actions">
              <button className="vpm-btn-print" onClick={() => handleDone(true)}>
                <Printer size={15} /> Print Receipt
              </button>
              <button className="vpm-btn-skip" onClick={() => handleDone(false)}>
                Skip
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="vpm-body">
              {/* ── LEFT: form fields ── */}
              <div className="vpm-left-col">

                {/* Vendor */}
                <div>
                  <span className="vpm-section-label">Vendor / Payee</span>
                  <div className="vpm-select-wrap">
                    <select
                      className="vpm-select"
                      value={vendorId}
                      onChange={e => { setVendorId(e.target.value); if (e.target.value) setRecipient(''); }}
                      disabled={vendorsLoad}
                    >
                      <option value="">-- Select Vendor --</option>
                      {vendors.map(v => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="vpm-select-chevron" />
                  </div>
                  {!vendorId && (
                    <input
                      type="text"
                      className="vpm-recipient-input"
                      placeholder="Or type recipient name…"
                      value={recipient}
                      onChange={e => setRecipient(e.target.value)}
                    />
                  )}
                </div>

                {/* Tender Method */}
                {tenderMethods.length > 0 && (
                  <div>
                    <span className="vpm-section-label">Tender Method</span>
                    <div className="vpm-tender-btns">
                      {tenderMethods.map(t => (
                        <button
                          key={t.id}
                          className={`vpm-tender-btn${tenderMethod === t.id ? ' vpm-tender-btn--active' : ''}`}
                          onClick={() => setTenderMethod(t.id)}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Type */}
                <div>
                  <span className="vpm-section-label">Payout Type</span>
                  <div className="vpm-type-toggle">
                    <button
                      className={`vpm-type-btn${payoutType === 'expense' ? ' vpm-type-btn--active-expense' : ''}`}
                      onClick={() => setPayoutType('expense')}
                    >
                      <DollarSign size={14} /> Expense
                    </button>
                    <button
                      className={`vpm-type-btn${payoutType === 'merchandise' ? ' vpm-type-btn--active-merch' : ''}`}
                      onClick={() => setPayoutType('merchandise')}
                    >
                      <ShoppingCart size={14} /> Merchandise
                    </button>
                  </div>
                </div>

                {/* Note */}
                <div>
                  <span className="vpm-section-label">Note / Remark (optional)</span>
                  <textarea
                    className="vpm-note"
                    placeholder="e.g. Weekly produce delivery, invoice #1042…"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={2}
                  />
                </div>

                {error && <div className="vpm-error">{error}</div>}
              </div>

              {/* ── RIGHT: amount display + numpad ── */}
              <div className="vpm-right-col">
                <div className="vpm-amount-display">
                  <span className="vpm-amount-value">
                    {amountStr ? `$${amountDisplay}` : <span className="vpm-amount-placeholder">$0.00</span>}
                  </span>
                  <span className="vpm-amount-hint">Tap digits to enter amount</span>
                </div>
                <div className="vpm-numpad">
                  {NUMPAD_KEYS.map((k, i) => (
                    <button
                      key={k + i}
                      className={`vpm-key${k === 'C' ? ' vpm-key--clear' : ''}${k === '⌫' ? ' vpm-key--backspace' : ''}${k === '0' ? ' vpm-key--zero' : ''}`}
                      onClick={() => handleKey(k)}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="vpm-footer">
              <button className="vpm-btn-cancel" onClick={onClose}>Cancel</button>
              <button
                className="vpm-btn-confirm"
                onClick={handleConfirm}
                disabled={saving || !amount}
              >
                {saving ? 'Processing…' : (
                  <><Check size={16} /> Confirm {amount > 0 ? `$${amount.toFixed(2)}` : ''}</>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
