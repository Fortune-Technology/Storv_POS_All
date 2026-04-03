/**
 * PinLoginScreen
 * Shown whenever a station is configured but no cashier is signed in.
 * Big numpad, auto-submits at 6 digits or when Enter is pressed.
 * Keyboard also works (for testing without a touchscreen).
 *
 * Modes:
 *   'signin' — standard PIN → cashier session login
 *   'clock'  — PIN → clock in/out (no session created, station-token only)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Delete } from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore.js';
import { useStationStore } from '../stores/useStationStore.js';
import { clockInOut } from '../api/pos.js';

const PAD = [
  ['1','2','3'],
  ['4','5','6'],
  ['7','8','9'],
  ['','0','⌫'],
];

export default function PinLoginScreen() {
  const station      = useStationStore(s => s.station);
  const clearStation = useStationStore(s => s.clearStation);
  const { pinLogin, loading, error, clearError } = useAuthStore();

  const [pin,          setPin]          = useState('');
  const [shake,        setShake]        = useState(false);
  const [showConfirm,  setShowConfirm]  = useState(false);

  // Clock in/out mode state
  const [mode,         setMode]         = useState('signin');  // 'signin' | 'clock'
  const [clockType,    setClockType]    = useState('in');      // 'in' | 'out'
  const [clockDone,    setClockDone]    = useState(null);      // { userName, type } after success
  const [clockLoading, setClockLoading] = useState(false);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => { setShake(false); setPin(''); }, 520);
  };

  // ── Sign-in submit ──────────────────────────────────────────────────────────
  const submit = useCallback(async (p) => {
    if (p.length < 4 || loading) return;
    try {
      await pinLogin(p, station?.stationToken);
      // App.jsx will re-render to POSScreen automatically
    } catch {
      triggerShake();
    }
  }, [pinLogin, loading, station]);

  // ── Clock submit ────────────────────────────────────────────────────────────
  const submitClock = useCallback(async (p) => {
    if (p.length < 4 || clockLoading) return;
    setClockLoading(true);
    try {
      const res = await clockInOut(p, clockType, station?.storeId, station?.stationToken);
      setClockDone({ userName: res.userName, type: res.type });
      setPin('');
    } catch {
      triggerShake();
    } finally {
      setClockLoading(false);
    }
  }, [clockType, station, clockLoading]);

  // ── Digit helpers ───────────────────────────────────────────────────────────
  const addDigit = useCallback((d) => {
    if (loading || clockLoading) return;
    clearError();
    setPin(prev => {
      const next = prev + d;
      if (next.length === 6) {
        if (mode === 'clock') {
          setTimeout(() => submitClock(next), 0);
        } else {
          setTimeout(() => submit(next), 0);
        }
      }
      return next.length <= 6 ? next : prev;
    });
  }, [loading, clockLoading, clearError, submit, submitClock, mode]);

  const delDigit = useCallback(() => {
    clearError();
    setPin(p => p.slice(0, -1));
  }, [clearError]);

  // ── Keyboard support ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.key >= '0' && e.key <= '9') addDigit(e.key);
      else if (e.key === 'Backspace') delDigit();
      else if (e.key === 'Enter') {
        if (mode === 'clock') submitClock(pin);
        else submit(pin);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [addDigit, delDigit, submit, submitClock, pin, mode]);

  // ── Switch mode helper ──────────────────────────────────────────────────────
  const switchMode = (m) => {
    setMode(m);
    setPin('');
    clearError();
    setClockDone(null);
  };

  const isLoading = loading || clockLoading;
  const dots = Array.from({ length: 6 }, (_, i) => i < pin.length ? '●' : '○');

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg-base)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '2rem', userSelect: 'none',
    }}>

      {/* Store + station identity */}
      <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
        <div style={{ color: 'var(--green)', fontWeight: 900, fontSize: '1.6rem', letterSpacing: '0.04em' }}>
          {station?.storeName || 'FF POS'}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
          {station?.stationName || 'Register'}
        </div>
      </div>

      {/* Mode tabs */}
      <div style={{ display:'flex', gap:8, marginBottom:'1.5rem', background:'rgba(255,255,255,.05)', borderRadius:12, padding:4, width:260 }}>
        {[
          { id:'signin', label:'Sign In to POS' },
          { id:'clock',  label:'🕐 Clock In/Out' },
        ].map(tab => (
          <button key={tab.id} onClick={() => switchMode(tab.id)}
            style={{
              flex:1, padding:'0.6rem', borderRadius:8, border:'none', fontWeight:700, fontSize:'0.82rem',
              background: mode === tab.id ? 'var(--bg-card)' : 'transparent',
              color: mode === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor:'pointer',
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Clock done confirmation — replaces numpad in clock mode */}
      {mode === 'clock' && clockDone ? (
        <div style={{ textAlign:'center', padding:'2rem 1rem', width:260 }}>
          <div style={{ fontSize:'2.5rem', marginBottom:12 }}>{clockDone.type === 'in' ? '✅' : '👋'}</div>
          <div style={{ fontWeight:800, fontSize:'1.1rem', color: clockDone.type === 'in' ? 'var(--green)' : 'var(--text-primary)' }}>
            {clockDone.type === 'in' ? 'Clocked In' : 'Clocked Out'}
          </div>
          <div style={{ color:'var(--text-secondary)', marginTop:4 }}>{clockDone.userName}</div>
          <button
            onClick={() => { setClockDone(null); setPin(''); }}
            style={{ marginTop:'1.5rem', padding:'0.75rem 2rem', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, color:'var(--text-muted)', fontWeight:700, cursor:'pointer' }}
          >
            Done
          </button>
        </div>
      ) : (
        <>
          {/* Clock in/out type toggle — only shown in clock mode */}
          {mode === 'clock' && (
            <div style={{ display:'flex', gap:8, marginBottom:'1rem', width:260 }}>
              {['in','out'].map(t => (
                <button key={t} onClick={() => setClockType(t)} style={{
                  flex:1, padding:'0.6rem', borderRadius:8, fontWeight:700, cursor:'pointer',
                  background: clockType === t
                    ? (t === 'in' ? 'rgba(122,193,67,.15)' : 'rgba(224,63,63,.12)')
                    : 'var(--bg-input)',
                  border: `1.5px solid ${clockType === t
                    ? (t === 'in' ? 'rgba(122,193,67,.5)' : 'rgba(224,63,63,.4)')
                    : 'var(--border)'}`,
                  color: clockType === t
                    ? (t === 'in' ? 'var(--green)' : 'var(--red)')
                    : 'var(--text-muted)',
                }}>
                  {t === 'in' ? '→ Clock In' : 'Clock Out ←'}
                </button>
              ))}
            </div>
          )}

          {/* PIN dots */}
          <div style={{
            display: 'flex', gap: 16, marginBottom: '2rem',
            animation: shake ? 'shake 0.5s ease' : 'none',
          }}>
            {dots.map((d, i) => (
              <div key={i} style={{
                width: 18, height: 18, borderRadius: '50%',
                background: i < pin.length ? 'var(--green)' : 'transparent',
                border: `2px solid ${i < pin.length ? 'var(--green)' : 'rgba(255,255,255,.2)'}`,
                transition: 'background .1s, border-color .1s',
              }} />
            ))}
          </div>

          {/* Error message */}
          {error && !shake && (
            <div style={{
              color: 'var(--red)', fontSize: '0.82rem', fontWeight: 600,
              marginBottom: '1rem', minHeight: 20,
            }}>
              {error}
            </div>
          )}
          {!error && <div style={{ marginBottom: '1rem', minHeight: 20 }} />}

          {/* Numpad */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {PAD.flat().map((key, i) => {
              const isEmpty = key === '';
              const isDel   = key === '⌫';
              return (
                <button
                  key={i}
                  onClick={() => {
                    if (isEmpty) return;
                    if (isDel)   delDigit();
                    else         addDigit(key);
                  }}
                  disabled={isLoading || isEmpty}
                  style={{
                    width: 80, height: 80, borderRadius: 16,
                    background: isEmpty
                      ? 'transparent'
                      : isDel
                        ? 'rgba(224,63,63,.12)'
                        : 'var(--bg-card)',
                    border: isEmpty
                      ? 'none'
                      : `1px solid ${isDel ? 'rgba(224,63,63,.2)' : 'var(--border-light)'}`,
                    color: isDel ? 'var(--red)' : 'var(--text-primary)',
                    fontSize: isDel ? '1rem' : '1.5rem',
                    fontWeight: 700, cursor: isEmpty ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background .1s, transform .08s',
                    transform: 'scale(1)',
                  }}
                  onMouseDown={e => { if (!isEmpty) e.currentTarget.style.transform = 'scale(0.93)'; }}
                  onMouseUp={e =>   { e.currentTarget.style.transform = 'scale(1)'; }}
                  onMouseLeave={e =>{ e.currentTarget.style.transform = 'scale(1)'; }}
                >
                  {isDel ? <Delete size={20} /> : key}
                </button>
              );
            })}
          </div>

          {/* Enter / submit button */}
          {mode === 'signin' ? (
            <button
              onClick={() => submit(pin)}
              disabled={pin.length < 4 || loading}
              style={{
                marginTop: 20, width: 260, height: 52,
                background: pin.length >= 4 ? 'var(--green)' : 'rgba(255,255,255,.05)',
                color: pin.length >= 4 ? '#0f1117' : 'var(--text-muted)',
                border: 'none', borderRadius: 14,
                fontWeight: 800, fontSize: '1rem',
                cursor: pin.length >= 4 ? 'pointer' : 'not-allowed',
                transition: 'background .15s',
              }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          ) : (
            <button
              onClick={() => submitClock(pin)}
              disabled={pin.length < 4 || clockLoading}
              style={{
                marginTop: 20, width: 260, height: 52,
                background: pin.length >= 4
                  ? (clockType === 'in' ? 'var(--green)' : 'var(--red)')
                  : 'rgba(255,255,255,.05)',
                color: pin.length >= 4 ? (clockType === 'in' ? '#0f1117' : '#fff') : 'var(--text-muted)',
                border: 'none', borderRadius: 14,
                fontWeight: 800, fontSize: '1rem',
                cursor: pin.length >= 4 ? 'pointer' : 'not-allowed',
                transition: 'background .15s',
              }}
            >
              {clockLoading
                ? (clockType === 'in' ? 'Clocking in…' : 'Clocking out…')
                : (clockType === 'in' ? 'Clock In' : 'Clock Out')}
            </button>
          )}
        </>
      )}

      {/* Reset station (manager action) */}
      <div style={{ marginTop: '3rem' }}>
        {!showConfirm ? (
          <button
            onClick={() => setShowConfirm(true)}
            style={{
              background: 'none', border: 'none',
              color: 'var(--text-muted)', fontSize: '0.72rem',
              cursor: 'pointer', textDecoration: 'underline', opacity: 0.6,
            }}
          >
            Reset this register
          </button>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--red)', fontSize: '0.82rem', marginBottom: 10 }}>
              This will remove the station setup. A manager will need to reconfigure it.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => { clearStation(); }}
                style={{
                  padding: '0.5rem 1.25rem',
                  background: 'rgba(224,63,63,.15)', border: '1px solid rgba(224,63,63,.3)',
                  borderRadius: 8, color: 'var(--red)', fontWeight: 700,
                  fontSize: '0.82rem', cursor: 'pointer',
                }}
              >
                Yes, reset
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                style={{
                  padding: '0.5rem 1.25rem',
                  background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)',
                  borderRadius: 8, color: 'var(--text-muted)', fontWeight: 700,
                  fontSize: '0.82rem', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
