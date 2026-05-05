/**
 * S78 — ImplementationPinModal
 *
 * PIN entry overlay that gates the cashier-app's Hardware Settings flow.
 * 6-digit numeric PIN matched against any user with
 * canConfigureHardware=true on the platform (cross-tenant — implementation
 * engineers serve multiple stores). On success activates a 1-hour
 * implementation session in useImplementationStore.
 *
 * Distinct from ManagerPinModal:
 *   - Different endpoint (POST /auth/implementation-pin/verify, public)
 *   - 6-digit only (no flexible 4–6 like manager PIN)
 *   - 1-hour session (vs 10-min manager)
 *   - Indigo accent (vs green) so cashiers don't confuse the two
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Delete, Wrench } from 'lucide-react';
import { useImplementationStore } from '../../stores/useImplementationStore.js';
import api from '../../api/client.js';
import './ImplementationPinModal.css';

const PIN_LENGTH = 6;

const PAD = [
  ['1','2','3'],
  ['4','5','6'],
  ['7','8','9'],
  ['','0','⌫'],
];

export default function ImplementationPinModal() {
  const { pendingAction, onPinSuccess, cancelPending } = useImplementationStore();

  const [pin,   setPin]   = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [busy,  setBusy]  = useState(false);

  useEffect(() => { setPin(''); setError(''); }, [pendingAction]);

  const triggerShake = () => {
    setShake(true); setPin('');
    setTimeout(() => setShake(false), 500);
  };

  const submit = useCallback(async (p) => {
    if (p.length !== PIN_LENGTH || busy) return;
    setBusy(true); setError('');
    try {
      // Public endpoint — no station / JWT required. PIN itself is the auth.
      const res = await api.post('/auth/implementation-pin/verify', { pin: p });
      const data = res.data || {};
      if (!data.user) {
        setError('Invalid PIN');
        triggerShake();
        return;
      }
      onPinSuccess({ user: data.user, expiresAt: data.expiresAt });
    } catch (err) {
      const status = err?.response?.status;
      if (status === 429) {
        setError('Too many attempts — try again in a few minutes');
      } else if (status === 400) {
        setError('PIN must be 6 digits');
      } else {
        setError('Invalid PIN');
      }
      triggerShake();
    } finally {
      setBusy(false);
    }
  }, [busy, onPinSuccess]);

  const addDigit = (d) => {
    if (busy) return;
    setError('');
    const next = pin + d;
    if (next.length > PIN_LENGTH) return;
    setPin(next);
    if (next.length === PIN_LENGTH) setTimeout(() => submit(next), 0);
  };

  const delDigit = () => setPin(p => p.slice(0, -1));

  useEffect(() => {
    const h = (e) => {
      if (e.key >= '0' && e.key <= '9') addDigit(e.key);
      else if (e.key === 'Backspace') delDigit();
      else if (e.key === 'Enter') submit(pin);
      else if (e.key === 'Escape') cancelPending();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, busy]);

  if (!pendingAction) return null;

  const dots = Array.from({ length: PIN_LENGTH }, (_, i) => i < pin.length);

  return (
    <div className="ipm-backdrop">
      <div className="ipm-modal">

        <div className="ipm-shield">
          <Wrench size={22} color="#6366f1" />
        </div>

        <div className="ipm-label">IMPLEMENTATION ENGINEER PIN</div>
        <div className="ipm-action-label">{pendingAction.label}</div>
        <div className="ipm-hint">
          Internal team only — store staff cannot access this flow.
        </div>

        {/* PIN dots */}
        <div className={`ipm-dots${shake ? ' ipm-dots--shake' : ''}`}>
          {dots.map((filled, i) => (
            <div key={i} className={`ipm-dot${filled ? ' ipm-dot--filled' : ''}`} />
          ))}
        </div>

        {error ? (
          <div className="ipm-error">{error}</div>
        ) : (
          <div className="ipm-error-spacer" />
        )}

        {/* Numpad */}
        <div className="ipm-numpad">
          {PAD.flat().map((key, i) => {
            const empty = key === '';
            const isDel = key === '⌫';
            return (
              <button
                key={i}
                className={`ipm-key${empty ? ' ipm-key--empty' : ''}${isDel ? ' ipm-key--delete' : ''}`}
                onClick={() => { if (empty) return; isDel ? delDigit() : addDigit(key); }}
                disabled={empty || busy}
              >
                {isDel ? <Delete size={18} /> : key}
              </button>
            );
          })}
        </div>

        <button
          className={`ipm-confirm-btn${pin.length === PIN_LENGTH ? ' ipm-confirm-btn--active' : ' ipm-confirm-btn--disabled'}`}
          onClick={() => submit(pin)}
          disabled={pin.length !== PIN_LENGTH || busy}
        >
          {busy ? 'Verifying…' : 'Confirm'}
        </button>

        <button className="ipm-cancel-btn" onClick={cancelPending}>
          Cancel
        </button>
      </div>
    </div>
  );
}
