/**
 * S77 (C9) — CashDrawerEventModal
 *
 * Unified modal for all 5 cash drawer events:
 *   cash_drop · cash_in · vendor_payout · loan · received_on_account
 *
 * Replaces CashDrawerModal + VendorPayoutModal. Props:
 *   open          — bool
 *   initialKind   — pre-select type from ActionBar button
 *   onClose       — () => void
 *   onComplete    — (event) => void (called when modal closes after success)
 *   onPrint       — (printPayload) => Promise<void>  — house copy auto-fired
 *                                                      then optionally a vendor
 *                                                      copy after user Yes
 *
 * Layout:
 *   [Type selector chip row]
 *   [LEFT: type-specific form fields]   |   [RIGHT: amount display + numpad]
 *   [Footer: Cancel | Confirm]
 *   [Success state: amount + ref + Done | (Print Vendor Copy if vendor_payout)]
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X, Check, Printer,
  ArrowDownCircle, ArrowUpCircle, ArrowDownToLine, HandCoins, Receipt, ChevronDown,
} from 'lucide-react';
import { useShiftStore }   from '../../stores/useShiftStore.js';
import { useStationStore } from '../../stores/useStationStore.js';
import { useAuthStore }    from '../../stores/useAuthStore.js';
import { usePOSConfig, DEFAULT_POS_CONFIG } from '../../hooks/usePOSConfig.js';
import { getVendors, searchCustomers } from '../../api/pos.js';
import { digitsToDisplay, digitsToNumber } from '../pos/NumPadInline.jsx';
import './CashDrawerEventModal.css';

// ── Cent-based numpad helper (same shape as TenderModal/VendorPayoutModal) ──
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

// ── Type metadata ───────────────────────────────────────────────────────────
const KINDS = [
  { id: 'cash_drop',           label: 'Cash Drop',           desc: 'Drawer pickup → safe',    direction: 'OUT', accent: '#f59e0b', Icon: ArrowDownCircle },
  { id: 'cash_in',             label: 'Cash In',             desc: 'Add cash to drawer',      direction: 'IN',  accent: '#16a34a', Icon: ArrowDownToLine },
  { id: 'vendor_payout',       label: 'Vendor Payout',       desc: 'Pay vendor from drawer',  direction: 'OUT', accent: '#a855f7', Icon: ArrowUpCircle },
  { id: 'loan',                label: 'Cashier Loan',        desc: 'Cash advance / loan',     direction: 'OUT', accent: '#0ea5e9', Icon: HandCoins },
  { id: 'received_on_account', label: 'Received on Account', desc: 'Customer pays balance',   direction: 'IN',  accent: '#10b981', Icon: Receipt },
];

const KIND_BY_ID = Object.fromEntries(KINDS.map(k => [k.id, k]));

export default function CashDrawerEventModal({
  open,
  initialKind = 'cash_drop',
  onClose,
  onComplete,
  onPrint,
}) {
  const { addCashDrop, addPayout, shift } = useShiftStore();
  const station   = useStationStore(s => s.station);
  const cashier   = useAuthStore(s => s.cashier);
  const posConfig = usePOSConfig();

  const [kind, setKind] = useState(initialKind);
  useEffect(() => { if (open) setKind(initialKind); }, [open, initialKind]);

  // Form state
  const [amountStr,    setAmountStr]    = useState('');
  const [note,         setNote]         = useState('');
  const [vendorId,     setVendorId]     = useState('');
  const [recipient,    setRecipient]    = useState('');
  const [payoutSubtype, setPayoutSubtype] = useState('expense'); // expense | merchandise (vendor_payout)
  const [tenderMethod, setTenderMethod] = useState('cash');
  const [customerId,   setCustomerId]   = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [vendors,      setVendors]      = useState([]);
  const [vendorsLoad,  setVendorsLoad]  = useState(false);

  // Status
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState(null); // { kind, amount, referenceNumber, savedRow, printedHouse, printedVendor }

  // Reset on close
  useEffect(() => {
    if (!open) {
      setAmountStr(''); setNote(''); setVendorId(''); setRecipient('');
      setPayoutSubtype('expense'); setTenderMethod('cash'); setCustomerId('');
      setCustomerName(''); setCustomerSearch(''); setCustomerResults([]);
      setError(''); setSuccess(null); setSaving(false);
    }
  }, [open]);

  // Tender methods from POS config (vendorTenderMethods array; reused for RA too)
  const tenderMethods = useMemo(() => (
    (posConfig.vendorTenderMethods || DEFAULT_POS_CONFIG.vendorTenderMethods || []).filter(t => t.enabled)
  ), [posConfig]);

  useEffect(() => {
    if (tenderMethods.length > 0 && !tenderMethods.find(t => t.id === tenderMethod)) {
      setTenderMethod(tenderMethods[0].id);
    }
  }, [tenderMethods, tenderMethod]);

  // Lazy-load vendors when type is vendor_payout
  useEffect(() => {
    if (kind !== 'vendor_payout' || vendors.length || vendorsLoad) return;
    setVendorsLoad(true);
    getVendors()
      .then(v => setVendors(Array.isArray(v) ? v : (v?.vendors || [])))
      .catch(() => setVendors([]))
      .finally(() => setVendorsLoad(false));
  }, [kind, vendors.length, vendorsLoad]);

  // Customer search debounced for received_on_account
  useEffect(() => {
    if (kind !== 'received_on_account') return;
    const q = customerSearch.trim();
    if (q.length < 2) { setCustomerResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const results = await searchCustomers(q, station?.storeId);
        setCustomerResults(Array.isArray(results) ? results.slice(0, 8) : []);
      } catch {
        setCustomerResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [kind, customerSearch, station?.storeId]);

  const handleKey = useCallback((key) => {
    if (key === '.') return;
    setAmountStr(prev => buildAmount(prev, key));
  }, []);
  const amount = digitsToNumber(amountStr, 2);
  const amountDisplay = digitsToDisplay(amountStr, 2);

  // Build the print payload from a saved cashDrop / cashPayout row
  const buildPrintPayload = useCallback((kindId, savedRow, copyLabel, showSignature) => {
    const k = KIND_BY_ID[kindId] || KINDS[0];
    const vendorObj = vendors.find(v => String(v.id) === String(vendorId));
    return {
      kind: kindId,
      amount: Number(savedRow.amount),
      referenceNumber: savedRow.referenceNumber || null,
      createdAt: savedRow.createdAt || new Date().toISOString(),
      cashierName: cashier?.name || cashier?.email || 'Cashier',
      stationName: station?.name || null,
      shiftId: shift?.id || null,
      // Type-specific fields
      vendorName: vendorObj?.name || recipient || null,
      payoutType: payoutSubtype,
      tenderMethod,
      customerName: customerName || null,
      recipient: recipient || null,
      note: note || null,
      copyLabel,
      showSignatureLine: showSignature,
      direction: k.direction,
    };
  }, [vendors, vendorId, cashier, station, shift, recipient, payoutSubtype, tenderMethod, customerName, note]);

  // ── Confirm: save → auto-print house copy → success state ────────────────
  const handleConfirm = async () => {
    if (!amount || amount <= 0) { setError('Enter an amount greater than $0.00'); return; }
    if (!shift) { setError('No active shift. Open a shift first.'); return; }
    if (kind === 'received_on_account' && !customerId) { setError('Select a customer for Received on Account.'); return; }
    setError(''); setSaving(true);

    try {
      let savedRow;
      if (kind === 'cash_drop') {
        const r = await addCashDrop(amount, note || null, { type: 'drop' });
        if (!r.ok) throw new Error(r.error || 'Failed to record cash drop');
        savedRow = r.drop;
      } else if (kind === 'cash_in') {
        const r = await addCashDrop(amount, note || null, { type: 'paid_in' });
        if (!r.ok) throw new Error(r.error || 'Failed to record cash in');
        savedRow = r.drop;
      } else if (kind === 'vendor_payout') {
        const r = await addPayout(amount, recipient || null, note || null, {
          vendorId: vendorId ? parseInt(vendorId) : undefined,
          payoutType: payoutSubtype, // 'expense' | 'merchandise'
          tenderMethod,
        });
        if (!r.ok) throw new Error(r.error || 'Failed to record vendor payout');
        savedRow = r.payout;
      } else if (kind === 'loan') {
        const r = await addPayout(amount, recipient || null, note || null, {
          payoutType: 'loan',
          tenderMethod: 'cash',
        });
        if (!r.ok) throw new Error(r.error || 'Failed to record loan');
        savedRow = r.payout;
      } else if (kind === 'received_on_account') {
        const r = await addPayout(amount, customerName || null, note || null, {
          customerId,
          payoutType: 'received_on_account',
          tenderMethod,
        });
        if (!r.ok) throw new Error(r.error || 'Failed to record payment');
        savedRow = r.payout;
      }

      // Auto-print house copy (1 copy mandatory per spec).
      let printedHouse = false;
      if (onPrint) {
        try {
          await onPrint(buildPrintPayload(kind, savedRow, 'STORE COPY', true));
          printedHouse = true;
        } catch (printErr) {
          // Print failure shouldn't block save — user can reprint from Done.
          console.warn('[CashDrawerEventModal] House-copy print failed:', printErr);
        }
      }

      setSuccess({
        kind,
        amount,
        referenceNumber: savedRow.referenceNumber,
        savedRow,
        printedHouse,
        printedVendor: false,
      });
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to record event');
    } finally {
      setSaving(false);
    }
  };

  // ── Success: optional vendor / customer copy ─────────────────────────────
  const handlePrintExtraCopy = async () => {
    if (!success || !onPrint) return;
    const copyLabel = success.kind === 'vendor_payout'
      ? 'VENDOR COPY'
      : success.kind === 'received_on_account'
        ? 'CUSTOMER COPY'
        : 'DUPLICATE';
    try {
      await onPrint(buildPrintPayload(success.kind, success.savedRow, copyLabel, false));
      setSuccess(prev => ({ ...prev, printedVendor: true }));
    } catch (err) {
      setError('Failed to print extra copy: ' + (err.message || ''));
    }
  };

  const handleDone = () => {
    onComplete?.(success?.savedRow);
    onClose();
  };

  if (!open) return null;

  const k = KIND_BY_ID[kind] || KINDS[0];

  // ── Success state ─────────────────────────────────────────────────────────
  if (success) {
    const sk = KIND_BY_ID[success.kind] || KINDS[0];
    const showExtraCopy = success.kind === 'vendor_payout' && !success.printedVendor;
    return (
      <div className="cdem-backdrop" onClick={onClose}>
        <div className="cdem-modal cdem-modal--narrow" onClick={e => e.stopPropagation()}>
          <div className="cdem-header">
            <div className="cdem-header-title">
              <sk.Icon size={18} color={sk.accent} />
              <div>
                <h2>{sk.label} Recorded</h2>
                <p>{sk.desc}</p>
              </div>
            </div>
            <button className="cdem-close-btn" onClick={onClose}><X size={16} /></button>
          </div>

          <div className="cdem-success">
            <div className="cdem-success-icon" style={{ background: `${sk.accent}20`, color: sk.accent }}>
              <Check size={32} />
            </div>
            <div className="cdem-success-amount">${success.amount.toFixed(2)}</div>
            <div className="cdem-success-direction">Money {sk.direction} of drawer</div>
            {success.referenceNumber && (
              <div className="cdem-success-ref">Ref: {success.referenceNumber}</div>
            )}
            <div className="cdem-success-status">
              {success.printedHouse
                ? <><Printer size={13} /> House copy printed</>
                : <span className="cdem-success-status--warn"><Printer size={13} /> Print failed — see settings</span>}
            </div>
            {success.printedVendor && (
              <div className="cdem-success-status">
                <Printer size={13} /> Vendor copy printed
              </div>
            )}

            <div className="cdem-success-actions">
              {showExtraCopy && (
                <button className="cdem-btn-print" onClick={handlePrintExtraCopy}>
                  <Printer size={15} /> Print Vendor Copy
                </button>
              )}
              {success.kind === 'received_on_account' && !success.printedVendor && (
                <button className="cdem-btn-print" onClick={handlePrintExtraCopy}>
                  <Printer size={15} /> Print Customer Copy
                </button>
              )}
              <button className="cdem-btn-done" onClick={handleDone}>Done</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Entry state ──────────────────────────────────────────────────────────
  return (
    <div className="cdem-backdrop" onClick={onClose}>
      <div className="cdem-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="cdem-header">
          <div className="cdem-header-title">
            <k.Icon size={18} color={k.accent} />
            <div>
              <h2>Cash Drawer Event</h2>
              <p>{k.desc}</p>
            </div>
          </div>
          <button className="cdem-close-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Type selector chips */}
        <div className="cdem-type-chips">
          {KINDS.map(opt => {
            const active = opt.id === kind;
            return (
              <button
                key={opt.id}
                className={`cdem-type-chip${active ? ' cdem-type-chip--active' : ''}`}
                style={active ? { borderColor: opt.accent, background: `${opt.accent}15`, color: opt.accent } : {}}
                onClick={() => setKind(opt.id)}
              >
                <opt.Icon size={14} />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>

        <div className="cdem-body">
          {/* LEFT: form */}
          <div className="cdem-left-col">

            {/* Vendor select — vendor_payout only */}
            {kind === 'vendor_payout' && (
              <>
                <div>
                  <span className="cdem-section-label">Vendor / Payee</span>
                  <div className="cdem-select-wrap">
                    <select
                      className="cdem-select"
                      value={vendorId}
                      onChange={e => { setVendorId(e.target.value); if (e.target.value) setRecipient(''); }}
                      disabled={vendorsLoad}
                    >
                      <option value="">— Select Vendor —</option>
                      {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                    <ChevronDown size={14} className="cdem-select-chevron" />
                  </div>
                  {!vendorId && (
                    <input
                      type="text"
                      className="cdem-input"
                      placeholder="Or type recipient name…"
                      value={recipient}
                      onChange={e => setRecipient(e.target.value)}
                    />
                  )}
                </div>

                {tenderMethods.length > 0 && (
                  <div>
                    <span className="cdem-section-label">Tender Method</span>
                    <div className="cdem-tender-btns">
                      {tenderMethods.map(t => (
                        <button
                          key={t.id}
                          className={`cdem-tender-btn${tenderMethod === t.id ? ' cdem-tender-btn--active' : ''}`}
                          onClick={() => setTenderMethod(t.id)}
                        >{t.label}</button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <span className="cdem-section-label">Payout Type</span>
                  <div className="cdem-subtype-toggle">
                    <button
                      className={`cdem-subtype-btn${payoutSubtype === 'expense' ? ' cdem-subtype-btn--active' : ''}`}
                      onClick={() => setPayoutSubtype('expense')}
                    >Expense</button>
                    <button
                      className={`cdem-subtype-btn${payoutSubtype === 'merchandise' ? ' cdem-subtype-btn--active' : ''}`}
                      onClick={() => setPayoutSubtype('merchandise')}
                    >Merchandise</button>
                  </div>
                </div>
              </>
            )}

            {/* Loan recipient */}
            {kind === 'loan' && (
              <div>
                <span className="cdem-section-label">Loan To (employee or recipient)</span>
                <input
                  type="text"
                  className="cdem-input"
                  placeholder="e.g. John Smith — register loan"
                  value={recipient}
                  onChange={e => setRecipient(e.target.value)}
                />
              </div>
            )}

            {/* Customer for received_on_account */}
            {kind === 'received_on_account' && (
              <>
                <div>
                  <span className="cdem-section-label">Customer</span>
                  {customerId ? (
                    <div className="cdem-customer-pill">
                      <Receipt size={14} />
                      <span>{customerName}</span>
                      <button
                        className="cdem-customer-clear"
                        onClick={() => { setCustomerId(''); setCustomerName(''); setCustomerSearch(''); setCustomerResults([]); }}
                      ><X size={12} /></button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        className="cdem-input"
                        placeholder="Search by name, phone, or card…"
                        value={customerSearch}
                        onChange={e => setCustomerSearch(e.target.value)}
                      />
                      {customerResults.length > 0 && (
                        <div className="cdem-customer-results">
                          {customerResults.map(c => (
                            <button
                              key={c.id}
                              className="cdem-customer-result"
                              onClick={() => {
                                setCustomerId(c.id);
                                setCustomerName(c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.phone || 'Customer');
                                setCustomerSearch('');
                                setCustomerResults([]);
                              }}
                            >
                              <span className="cdem-customer-name">
                                {c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Customer'}
                              </span>
                              <span className="cdem-customer-meta">
                                {c.phone || c.email || c.cardNo || ''}
                                {c.balance != null && ` · Bal: $${Number(c.balance).toFixed(2)}`}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {tenderMethods.length > 0 && (
                  <div>
                    <span className="cdem-section-label">Tender Method</span>
                    <div className="cdem-tender-btns">
                      {tenderMethods.map(t => (
                        <button
                          key={t.id}
                          className={`cdem-tender-btn${tenderMethod === t.id ? ' cdem-tender-btn--active' : ''}`}
                          onClick={() => setTenderMethod(t.id)}
                        >{t.label}</button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Note (universal) */}
            <div>
              <span className="cdem-section-label">Note / Remark (optional)</span>
              <textarea
                className="cdem-note"
                placeholder={
                  kind === 'cash_drop'           ? 'e.g. Pickup to safe — heavy register' :
                  kind === 'cash_in'             ? 'e.g. Petty cash refill, change drop'  :
                  kind === 'vendor_payout'       ? 'e.g. Weekly produce delivery — INV #1042' :
                  kind === 'loan'                ? 'e.g. Cash advance, will repay Friday'  :
                  /* received_on_account */         'e.g. House charge payment — Jan invoice'
                }
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
              />
            </div>

            {error && <div className="cdem-error">{error}</div>}
          </div>

          {/* RIGHT: amount + numpad */}
          <div className="cdem-right-col">
            <div className="cdem-amount-display" style={{ borderColor: k.accent }}>
              <span className="cdem-amount-direction" style={{ color: k.accent }}>
                {k.direction === 'IN' ? '↓ INTO drawer' : '↑ OUT of drawer'}
              </span>
              <span className="cdem-amount-value">
                {amountStr ? `$${amountDisplay}` : <span className="cdem-amount-placeholder">$0.00</span>}
              </span>
              <span className="cdem-amount-hint">Tap digits to enter amount</span>
            </div>
            <div className="cdem-numpad">
              {NUMPAD_KEYS.map((key, i) => (
                <button
                  key={key + i}
                  className={`cdem-key${key === 'C' ? ' cdem-key--clear' : ''}${key === '⌫' ? ' cdem-key--backspace' : ''}${key === '0' ? ' cdem-key--zero' : ''}`}
                  onClick={() => handleKey(key)}
                >{key}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="cdem-footer">
          <button className="cdem-btn-cancel" onClick={onClose}>Cancel</button>
          <button
            className="cdem-btn-confirm"
            style={{ background: k.accent }}
            onClick={handleConfirm}
            disabled={saving || !amount}
          >
            {saving ? 'Processing…' : (
              <><Check size={16} /> Confirm {amount > 0 ? `$${amount.toFixed(2)}` : ''}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
