import React, { useState } from 'react';
import { ShieldAlert, CheckCircle, XCircle, CreditCard, Calendar } from 'lucide-react';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner.js';
import { parseAAMVALicense, meetsAgeRequirement, looksLikeLicense } from '../../utils/pdf417Parser.js';
import { useCartStore } from '../../stores/useCartStore.js';

export default function AgeVerificationModal() {
  const { pendingProduct, confirmAgeVerify, cancelAgeVerify } = useCartStore();
  const required = pendingProduct?.ageRequired || 21;

  const [result,    setResult]    = useState(null); // 'pass' | 'fail'
  const [resultMsg, setResultMsg] = useState('');
  const [manualDOB, setManualDOB] = useState('');
  const [showManual,setShowManual]= useState(false);

  // Listen for 2D scanner reading a driver's license
  useBarcodeScanner((raw) => {
    if (!looksLikeLicense(raw)) return;
    try {
      const parsed = parseAAMVALicense(raw);
      if (meetsAgeRequirement(parsed.dob, required)) {
        setResult('pass');
        setResultMsg(`Age verified — ${parsed.age} years old`);
        setTimeout(confirmAgeVerify, 1200);
      } else {
        setResult('fail');
        setResultMsg(`ID shows age ${parsed.age} — must be ${required}+`);
      }
    } catch (e) {
      setResult('fail');
      setResultMsg('Could not read ID — try manual entry');
      setShowManual(true);
    }
  }, true);

  const checkManual = () => {
    // Expect MM/DD/YYYY or MMDDYYYY
    const s = manualDOB.replace(/\D/g, '');
    if (s.length !== 8) { setResultMsg('Enter date as MM/DD/YYYY'); return; }
    const mm = s.slice(0, 2), dd = s.slice(2, 4), yyyy = s.slice(4, 8);
    const dob = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    if (isNaN(dob)) { setResultMsg('Invalid date'); return; }
    const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000));
    if (age >= required) {
      setResult('pass');
      setResultMsg(`Age verified — ${age} years old`);
      setTimeout(confirmAgeVerify, 1200);
    } else {
      setResult('fail');
      setResultMsg(`Customer is ${age} years old — must be ${required}+`);
    }
  };

  const resultColor = result === 'pass' ? 'var(--green)' : result === 'fail' ? 'var(--red)' : 'var(--amber)';

  return (
    <div className="modal-backdrop">
      <div className="modal-box" style={{ maxWidth: 440 }}>
        {/* Header */}
        <div style={{
          padding: '1.5rem', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: 'rgba(245,158,11,.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ShieldAlert size={24} color="var(--amber)" />
          </div>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Age Verification Required</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>
              {pendingProduct?.name} · Must be {required}+
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem' }}>
          {/* Scan prompt */}
          {!showManual && result !== 'pass' && (
            <div style={{
              textAlign: 'center', padding: '1.5rem',
              border: '2px dashed rgba(245,158,11,.3)',
              borderRadius: 12, marginBottom: '1rem',
            }}>
              <CreditCard size={40} color="var(--amber)" style={{ opacity: 0.6, marginBottom: 8 }} />
              <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 4 }}>
                Scan customer's ID
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Use the 2D scanner to scan the barcode on the back of the driver's license
              </div>
            </div>
          )}

          {/* Result banner */}
          {result && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '0.875rem 1rem',
              borderRadius: 10, background: result === 'pass' ? 'var(--green-dim)' : 'var(--red-dim)',
              border: `1px solid ${result === 'pass' ? 'var(--green-border)' : 'rgba(224,63,63,.35)'}`,
              marginBottom: '1rem',
            }}>
              {result === 'pass'
                ? <CheckCircle size={20} color="var(--green)" />
                : <XCircle    size={20} color="var(--red)" />}
              <span style={{ fontWeight: 700, color: resultColor }}>{resultMsg}</span>
            </div>
          )}

          {/* Manual DOB fallback */}
          {showManual && result !== 'pass' && (
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                <Calendar size={12} style={{ marginRight: 5 }} />
                Enter date of birth (MM/DD/YYYY)
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={manualDOB}
                  onChange={e => setManualDOB(e.target.value)}
                  placeholder="01/15/1990"
                  style={{ flex: 1 }}
                  autoFocus
                />
                <button onClick={checkManual} style={{
                  padding: '0 1.25rem', borderRadius: 8,
                  background: 'var(--amber)', color: '#000',
                  fontWeight: 700, fontSize: '0.85rem',
                }}>
                  Verify
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0 1.5rem 1.5rem',
          display: 'flex', gap: 8,
        }}>
          {!showManual && result !== 'pass' && (
            <button onClick={() => setShowManual(true)} style={{
              flex: 1, padding: '0.75rem', borderRadius: 8,
              background: 'var(--bg-input)', color: 'var(--text-secondary)',
              fontWeight: 600, fontSize: '0.85rem',
            }}>
              Manual Entry
            </button>
          )}
          <button onClick={cancelAgeVerify} style={{
            flex: 1, padding: '0.75rem', borderRadius: 8,
            background: 'var(--red-dim)', color: 'var(--red)',
            fontWeight: 700, fontSize: '0.85rem',
            border: '1px solid rgba(224,63,63,.3)',
          }}>
            Decline Item
          </button>
        </div>
      </div>
    </div>
  );
}
