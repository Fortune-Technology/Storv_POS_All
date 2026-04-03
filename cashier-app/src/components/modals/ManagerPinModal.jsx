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
      onPinSuccess(user.id, user.name);
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
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-panel)', borderRadius: 20,
        border: '1px solid var(--border-light)',
        padding: '2rem', width: 320, textAlign: 'center',
        boxShadow: '0 32px 80px rgba(0,0,0,.6)',
      }}>

        <div style={{
          width: 48, height: 48, borderRadius: 14, margin: '0 auto 1rem',
          background: 'rgba(122,193,67,.12)', border: '1px solid rgba(122,193,67,.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Shield size={22} color="var(--green)" />
        </div>

        <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>
          MANAGER REQUIRED
        </div>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1.5rem' }}>
          {pendingAction.label}
        </div>

        {/* PIN dots */}
        <div style={{
          display: 'flex', gap: 12, justifyContent: 'center', marginBottom: '0.75rem',
          animation: shake ? 'shake .5s ease' : 'none',
        }}>
          {dots.map((filled, i) => (
            <div key={i} style={{
              width: 14, height: 14, borderRadius: '50%',
              background: filled ? 'var(--green)' : 'transparent',
              border: `2px solid ${filled ? 'var(--green)' : 'rgba(255,255,255,.2)'}`,
              transition: 'background .1s',
            }} />
          ))}
        </div>

        {error && (
          <div style={{ color: 'var(--red)', fontSize: '0.78rem', marginBottom: '0.75rem', fontWeight: 600 }}>
            {error}
          </div>
        )}
        {!error && <div style={{ height: 22 }} />}

        {/* Numpad */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: '1rem' }}>
          {PAD.flat().map((key, i) => {
            const empty = key === '';
            const isDel = key === '⌫';
            return (
              <button key={i}
                onClick={() => { if (empty) return; isDel ? delDigit() : addDigit(key); }}
                disabled={empty || busy}
                style={{
                  height: 56, borderRadius: 12,
                  background: empty ? 'transparent' : isDel ? 'var(--red-dim)' : 'var(--bg-card)',
                  border: empty ? 'none' : `1px solid ${isDel ? 'rgba(224,63,63,.2)' : 'var(--border-light)'}`,
                  color: isDel ? 'var(--red)' : 'var(--text-primary)',
                  fontSize: '1.2rem', fontWeight: 700, cursor: empty ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {isDel ? <Delete size={18} /> : key}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => submit(pin)}
          disabled={pin.length < 4 || busy}
          style={{
            width: '100%', height: 48, borderRadius: 12,
            background: pin.length >= 4 ? 'var(--green)' : 'var(--bg-input)',
            color: pin.length >= 4 ? '#0f1117' : 'var(--text-muted)',
            border: 'none', fontWeight: 800, fontSize: '0.95rem', cursor: pin.length >= 4 ? 'pointer' : 'not-allowed',
            marginBottom: '0.75rem',
          }}
        >
          {busy ? 'Verifying…' : 'Confirm'}
        </button>

        <button
          onClick={cancelPending}
          style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
