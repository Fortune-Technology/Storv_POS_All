/**
 * ManagerPinModal — PIN entry overlay for manager override.
 * Verifies PIN against the station's org, checks role is manager+.
 * On success calls useManagerStore.onPinSuccess().
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Delete, Shield } from 'lucide-react';
import { useManagerStore } from '../../stores/useManagerStore.js';
import { useStationStore } from '../../stores/useStationStore.js';
import api from '../../api/client.js';
import './ManagerPinModal.css';

const MANAGER_ROLES = ['manager', 'owner', 'admin', 'superadmin'];

const PAD = [
  ['1','2','3'],
  ['4','5','6'],
  ['7','8','9'],
  ['','0','⌫'],
];

export default function ManagerPinModal() {
  const { pendingAction, onPinSuccess, cancelPending } = useManagerStore();
  const station = useStationStore(s => s.station);

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
    if (p.length < 4 || busy) return;
    setBusy(true); setError('');
    try {
      const res = await api.post(
        '/pos-terminal/pin-login',
        { pin: p },
        { headers: { 'X-Station-Token': station?.stationToken } }
      );
      const user = res.data;
      if (!MANAGER_ROLES.includes(user.role)) {
        setError('Manager or owner PIN required');
        triggerShake();
        return;
      }
      // Pass the full response (token + user) so consumers like the
      // "Back Office" handler can build a portal /impersonate URL without
      // hitting the backend a second time. Existing callers still work —
      // they ignore the third arg.
      onPinSuccess(user.id, user.name, user);
    } catch {
      setError('Invalid PIN');
      triggerShake();
    } finally {
      setBusy(false);
    }
  }, [busy, station, onPinSuccess]);

  const addDigit = (d) => {
    if (busy) return;
    setError('');
    const next = pin + d;
    setPin(next.length <= 6 ? next : pin);
    if (next.length === 6) setTimeout(() => submit(next), 0);
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
  }, [pin, busy]);

  if (!pendingAction) return null;

  const dots = Array.from({ length: 6 }, (_, i) => i < pin.length);

  return (
    <div className="mpm-backdrop">
      <div className="mpm-modal">

        <div className="mpm-shield">
          <Shield size={22} color="var(--green)" />
        </div>

        <div className="mpm-label">MANAGER REQUIRED</div>
        <div className="mpm-action-label">{pendingAction.label}</div>

        {/* PIN dots */}
        <div className={`mpm-dots${shake ? ' mpm-dots--shake' : ''}`}>
          {dots.map((filled, i) => (
            <div key={i} className={`mpm-dot${filled ? ' mpm-dot--filled' : ''}`} />
          ))}
        </div>

        {error ? (
          <div className="mpm-error">{error}</div>
        ) : (
          <div className="mpm-error-spacer" />
        )}

        {/* Numpad */}
        <div className="mpm-numpad">
          {PAD.flat().map((key, i) => {
            const empty = key === '';
            const isDel = key === '⌫';
            return (
              <button
                key={i}
                className={`mpm-key${empty ? ' mpm-key--empty' : ''}${isDel ? ' mpm-key--delete' : ''}`}
                onClick={() => { if (empty) return; isDel ? delDigit() : addDigit(key); }}
                disabled={empty || busy}
              >
                {isDel ? <Delete size={18} /> : key}
              </button>
            );
          })}
        </div>

        <button
          className={`mpm-confirm-btn${pin.length >= 4 ? ' mpm-confirm-btn--active' : ' mpm-confirm-btn--disabled'}`}
          onClick={() => submit(pin)}
          disabled={pin.length < 4 || busy}
        >
          {busy ? 'Verifying...' : 'Confirm'}
        </button>

        <button className="mpm-cancel-btn" onClick={cancelPending}>
          Cancel
        </button>
      </div>
    </div>
  );
}
