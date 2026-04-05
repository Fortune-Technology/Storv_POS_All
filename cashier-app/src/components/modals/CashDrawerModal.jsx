/**
 * CashDrawerModal — Mid-shift cash drop or paid-out entry.
 *
 * Tabs: Cash Drop | Paid Out
 *
 * Paid Out extras:
 *   - Vendor dropdown (from /pos-terminal/vendors)
 *   - Expense / Merchandise type toggle
 *   - Free-text recipient fallback if no vendor selected
 */

import React, { useState, useEffect } from 'react';
import { X, ArrowDownCircle, ArrowUpCircle, Check, ChevronDown } from 'lucide-react';
import { useShiftStore } from '../../stores/useShiftStore.js';
import { getVendors }    from '../../api/pos.js';

const BACKDROP = {
  position: 'fixed', inset: 0, zIndex: 250,
  background: 'rgba(0,0,0,.82)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '1rem',
};

export default function CashDrawerModal({ defaultTab = 'drop', onClose }) {
  const { addCashDrop, addPayout, shift } = useShiftStore();

  const [tab,         setTab]         = useState(defaultTab);
  const [amount,      setAmount]      = useState('');
  const [vendorId,    setVendorId]    = useState('');    // selected vendor id
  const [recipient,   setRecipient]   = useState('');    // free-text fallback
  const [payoutType,  setPayoutType]  = useState('expense'); // 'expense' | 'merchandise'
  const [note,        setNote]        = useState('');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState(false);
  const [vendors,     setVendors]     = useState([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);

  const isDrop  = tab === 'drop';
  const accent  = isDrop ? 'var(--amber)' : '#a855f7';
  const accentA = isDrop ? 'rgba(245,158,11,' : 'rgba(168,85,247,';

  // Load vendors for paid-out tab
  useEffect(() => {
    if (tab === 'payout' && vendors.length === 0) {
      setVendorsLoading(true);
      getVendors().then(v => { setVendors(v || []); setVendorsLoading(false); }).catch(() => setVendorsLoading(false));
    }
  }, [tab]);

  const reset = () => { setAmount(''); setVendorId(''); setRecipient(''); setNote(''); setError(''); setSuccess(false); setPayoutType('expense'); };
  const handleTabChange = (t) => { setTab(t); reset(); };

  const handleSubmit = async () => {
    setError('');
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Enter a valid amount greater than $0.00'); return; }

    setSaving(true);
    let result;
    if (isDrop) {
      result = await addCashDrop(amt, note.trim() || undefined);
    } else {
      // Resolve recipient name: prefer selected vendor name, else free-text
      const selectedVendor = vendors.find(v => String(v.id) === String(vendorId));
      const recipientName  = selectedVendor?.name || recipient.trim() || undefined;
      result = await addPayout(amt, recipientName, note.trim() || undefined, {
        vendorId:   selectedVendor?.id || undefined,
        payoutType,
      });
    }
    setSaving(false);

    if (result.ok) {
      setSuccess(true);
      setTimeout(() => onClose(), 1200);
    } else {
      setError(result.error || 'Something went wrong');
    }
  };

  return (
    <div style={BACKDROP}>
      <div style={{
        width: '100%', maxWidth: 420,
        background: 'var(--bg-panel)', borderRadius: 20,
        border: `1px solid ${accentA}.25)`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,.7)',
      }}>

        {/* Header */}
        <div style={{
          padding: '1rem 1.25rem', flexShrink: 0,
          borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: `${accentA}.06)`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isDrop ? <ArrowDownCircle size={18} color={accent} /> : <ArrowUpCircle size={18} color={accent} />}
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.95rem', color: accent }}>
                {isDrop ? 'Cash Drop' : 'Paid Out'}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 1 }}>
                {isDrop ? 'Remove cash from drawer for bank deposit' : 'Pay a vendor or expense from the drawer'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 6, display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, padding: '0.875rem 1.25rem 0', flexShrink: 0 }}>
          <button onClick={() => handleTabChange('drop')} style={{
            flex: 1, padding: '0.5rem', borderRadius: 8, fontSize: '0.78rem', fontWeight: 700,
            cursor: 'pointer', border: 'none',
            background: tab === 'drop' ? 'var(--amber)' : 'var(--bg-input)',
            color: tab === 'drop' ? '#fff' : 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          }}>
            <ArrowDownCircle size={13} /> Cash Drop
          </button>
          <button onClick={() => handleTabChange('payout')} style={{
            flex: 1, padding: '0.5rem', borderRadius: 8, fontSize: '0.78rem', fontWeight: 700,
            cursor: 'pointer', border: 'none',
            background: tab === 'payout' ? '#a855f7' : 'var(--bg-input)',
            color: tab === 'payout' ? '#fff' : 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          }}>
            <ArrowUpCircle size={13} /> Paid Out
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '0.875rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Shift info */}
          {shift && (
            <div style={{ padding: '0.5rem 0.875rem', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Shift opened {new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {shift.cashierName || '—'}
            </div>
          )}

          {/* Amount */}
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>AMOUNT *</div>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: 700, fontSize: '1.1rem' }}>$</span>
              <input
                type="number" min="0.01" step="0.01"
                value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00" autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
                style={{
                  width: '100%', paddingLeft: '2rem', paddingRight: '1rem',
                  paddingTop: '0.75rem', paddingBottom: '0.75rem',
                  background: 'var(--bg-input)', border: '1px solid var(--border)',
                  borderRadius: 10, color: 'var(--text-primary)',
                  fontSize: '1.6rem', fontWeight: 800, textAlign: 'right',
                  boxSizing: 'border-box', outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Paid Out extras */}
          {!isDrop && (
            <>
              {/* Expense / Merchandise toggle */}
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>PAYOUT TYPE</div>
                <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  {[['expense', 'Expense'], ['merchandise', 'Merchandise']].map(([val, label]) => (
                    <button key={val} onClick={() => setPayoutType(val)} style={{
                      flex: 1, padding: '0.625rem',
                      border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.825rem',
                      background: payoutType === val ? '#a855f7' : 'var(--bg-input)',
                      color: payoutType === val ? '#fff' : 'var(--text-secondary)',
                      transition: 'background .15s',
                    }}>
                      {label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {payoutType === 'expense' ? 'Utilities, rent, services, labour…' : 'Inventory, products, resale goods…'}
                </div>
              </div>

              {/* Vendor dropdown */}
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
                  VENDOR {vendorsLoading && <span style={{ fontWeight: 400 }}>(loading…)</span>}
                </div>
                <div style={{ position: 'relative' }}>
                  <select
                    value={vendorId}
                    onChange={e => { setVendorId(e.target.value); if (e.target.value) setRecipient(''); }}
                    style={{
                      width: '100%', padding: '0.625rem 2rem 0.625rem 0.875rem',
                      background: 'var(--bg-input)', border: '1px solid var(--border)',
                      borderRadius: 8, color: vendorId ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontSize: '0.875rem', appearance: 'none', outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="">— Select vendor (optional) —</option>
                    {vendors.map(v => (
                      <option key={v.id} value={v.id}>{v.name}{v.code ? ` (${v.code})` : ''}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                </div>
              </div>

              {/* Free-text recipient (shown if no vendor selected) */}
              {!vendorId && (
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>RECIPIENT (if not in vendor list)</div>
                  <input
                    type="text" value={recipient} onChange={e => setRecipient(e.target.value)}
                    placeholder="e.g. Landlord, Electrician"
                    style={{
                      width: '100%', padding: '0.625rem 0.875rem',
                      background: 'var(--bg-input)', border: '1px solid var(--border)',
                      borderRadius: 8, color: 'var(--text-primary)',
                      fontSize: '0.875rem', boxSizing: 'border-box', outline: 'none',
                    }}
                  />
                </div>
              )}
            </>
          )}

          {/* Note */}
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
              {isDrop ? 'NOTE (optional)' : 'DESCRIPTION (optional)'}
            </div>
            <input
              type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder={isDrop ? 'e.g. Bank deposit' : 'e.g. Weekly invoice payment'}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
              style={{
                width: '100%', padding: '0.625rem 0.875rem',
                background: 'var(--bg-input)', border: '1px solid var(--border)',
                borderRadius: 8, color: 'var(--text-primary)',
                fontSize: '0.875rem', boxSizing: 'border-box', outline: 'none',
              }}
            />
          </div>

          {error && (
            <div style={{ padding: '0.625rem 0.875rem', borderRadius: 8, background: 'rgba(224,63,63,.08)', border: '1px solid rgba(224,63,63,.25)', color: 'var(--red)', fontSize: '0.8rem', fontWeight: 600 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '1rem 1.25rem', display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '0.875rem',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 10, color: 'var(--text-secondary)',
            fontWeight: 700, cursor: 'pointer', fontSize: '0.875rem',
          }}>
            Cancel
          </button>
          <button
            onClick={handleSubmit} disabled={saving || success}
            style={{
              flex: 2, padding: '0.875rem',
              background: success ? 'var(--green)' : saving ? 'var(--bg-input)' : accent,
              border: 'none', borderRadius: 10,
              color: (saving && !success) ? 'var(--text-muted)' : '#fff',
              fontWeight: 800, fontSize: '0.875rem',
              cursor: (saving || success) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {success ? <><Check size={15} /> Saved!</>
              : saving ? 'Saving…'
              : isDrop ? 'Record Drop' : 'Record Payout'}
          </button>
        </div>
      </div>
    </div>
  );
}
