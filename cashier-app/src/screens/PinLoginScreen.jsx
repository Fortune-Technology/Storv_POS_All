/**
 * PinLoginScreen
 * Shown whenever a station is configured but no cashier is signed in.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Delete } from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore.js';
import { useStationStore } from '../stores/useStationStore.js';
import { clockInOut } from '../api/pos.js';
import UpdateBadge from '../components/UpdateBadge.jsx';
import './PinLoginScreen.css';

const PAD = [
  ['1','2','3'],
  ['4','5','6'],
  ['7','8','9'],
  ['','0','\u232B'],
];

export default function PinLoginScreen() {
  const station      = useStationStore(s => s.station);
  const clearStation = useStationStore(s => s.clearStation);
  const { pinLogin, loading, error, clearError } = useAuthStore();

  const [pin,          setPin]          = useState('');
  const [shake,        setShake]        = useState(false);
  const [showConfirm,  setShowConfirm]  = useState(false);
  const [mode,         setMode]         = useState('signin');
  const [clockType,    setClockType]    = useState('in');
  const [clockDone,    setClockDone]    = useState(null);
  const [clockWarn,    setClockWarn]    = useState(null);
  const [clockLoading, setClockLoading] = useState(false);

  const fmtDuration = (since) => {
    const mins = Math.floor((Date.now() - new Date(since)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => { setShake(false); setPin(''); }, 520);
  };

  const submit = useCallback(async (p) => {
    if (p.length < 4 || loading) return;
    try {
      await pinLogin(p, station?.stationToken);
    } catch (err) {
      triggerShake();
    }
  }, [pinLogin, loading, station]);

  const submitClock = useCallback(async (p) => {
    if (p.length < 4 || clockLoading) return;
    setClockLoading(true);
    try {
      const res = await clockInOut(p, clockType, station?.storeId, station?.stationToken);
      setPin('');
      if (res.alreadyClockedIn) {
        setClockWarn({ kind: 'alreadyIn', userName: res.userName, since: res.since });
      } else if (res.notClockedIn) {
        setClockWarn({ kind: 'notIn', userName: res.userName });
      } else {
        setClockDone({ userName: res.userName, type: res.type });
      }
    } catch {
      triggerShake();
    } finally {
      setClockLoading(false);
    }
  }, [clockType, station, clockLoading]);

  const addDigit = useCallback((d) => {
    if (loading || clockLoading) return;
    clearError();
    setPin(prev => {
      const next = prev + d;
      if (next.length === 6) {
        if (mode === 'clock') setTimeout(() => submitClock(next), 0);
        else setTimeout(() => submit(next), 0);
      }
      return next.length <= 6 ? next : prev;
    });
  }, [loading, clockLoading, clearError, submit, submitClock, mode]);

  const delDigit = useCallback(() => {
    clearError();
    setPin(p => p.slice(0, -1));
  }, [clearError]);

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

  const switchMode = (m) => {
    setMode(m);
    setPin('');
    clearError();
    setClockDone(null);
    setClockWarn(null);
  };

  const isLoading = loading || clockLoading;
  const dots = Array.from({ length: 6 }, (_, i) => i < pin.length);

  return (
    <div className="pls-page">
      <div className="pls-identity">
        <div className="pls-store-name">{station?.storeName || 'Storeveu POS'}</div>
        <div className="pls-station-name">{station?.stationName || 'Register'}</div>
      </div>

      {/* Mode tabs */}
      <div className="pls-mode-tabs">
        {[
          { id: 'signin', label: 'Sign In to POS' },
          { id: 'clock',  label: '\uD83D\uDD50 Clock In/Out' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => switchMode(tab.id)}
            className={`pls-mode-tab ${mode === tab.id ? 'pls-mode-tab--active' : 'pls-mode-tab--inactive'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Clock done */}
      {mode === 'clock' && clockDone ? (
        <div className="pls-clock-done">
          <div className="pls-clock-done-emoji">{clockDone.type === 'in' ? '\u2705' : '\uD83D\uDC4B'}</div>
          <div className={`pls-clock-done-title ${clockDone.type === 'in' ? 'pls-clock-done-title--in' : 'pls-clock-done-title--out'}`}>
            {clockDone.type === 'in' ? 'Clocked In' : 'Clocked Out'}
          </div>
          <div className="pls-clock-done-name">{clockDone.userName}</div>
          <button onClick={() => { setClockDone(null); setPin(''); }} className="pls-done-btn">Done</button>
        </div>

      ) : mode === 'clock' && clockWarn ? (
        <div className="pls-clock-warn">
          {clockWarn.kind === 'alreadyIn' ? (
            <>
              <div className="pls-warn-emoji">\u23F1</div>
              <div className="pls-warn-title pls-warn-title--amber">Already Clocked In</div>
              <div className="pls-warn-name">{clockWarn.userName}</div>
              <div className="pls-warn-duration">Clocked in for {fmtDuration(clockWarn.since)}</div>
              <div className="pls-warn-hint">Please clock out first before clocking in again.</div>
            </>
          ) : (
            <>
              <div className="pls-warn-emoji">\uD83D\uDD12</div>
              <div className="pls-warn-title pls-warn-title--red">Not Clocked In</div>
              <div className="pls-warn-name">{clockWarn.userName}</div>
              <div className="pls-warn-hint">You must clock in before you can clock out.</div>
            </>
          )}
          <button
            onClick={() => {
              setClockWarn(null);
              setPin('');
              setClockType(clockWarn.kind === 'alreadyIn' ? 'out' : 'in');
            }}
            className="pls-warn-switch-btn"
          >
            {clockWarn.kind === 'alreadyIn' ? 'Switch to Clock Out' : 'Switch to Clock In'}
          </button>
        </div>

      ) : (
        <>
          {/* Clock hint */}
          {mode === 'clock' && <div className="pls-clock-hint">Use your register PIN to clock in or out</div>}

          {/* Clock toggle */}
          {mode === 'clock' && (
            <div className="pls-clock-toggle">
              {['in', 'out'].map(t => (
                <button
                  key={t}
                  onClick={() => setClockType(t)}
                  className={`pls-clock-toggle-btn ${
                    t === 'in'
                      ? (clockType === 'in' ? 'pls-clock-toggle-btn--in-active' : 'pls-clock-toggle-btn--in-inactive')
                      : (clockType === 'out' ? 'pls-clock-toggle-btn--out-active' : 'pls-clock-toggle-btn--out-inactive')
                  }`}
                >
                  {t === 'in' ? '\u2192 Clock In' : 'Clock Out \u2190'}
                </button>
              ))}
            </div>
          )}

          {/* PIN dots */}
          <div className={`pls-pin-dots ${shake ? 'pls-pin-dots--shake' : ''}`}>
            {dots.map((filled, i) => (
              <div key={i} className={`pls-dot ${filled ? 'pls-dot--filled' : 'pls-dot--empty'}`} />
            ))}
          </div>

          {/* Error */}
          {error && !shake ? (
            <div className="pls-error">{error}</div>
          ) : (
            <div className="pls-error-spacer" />
          )}

          {/* Numpad */}
          <div className="pls-numpad">
            {PAD.flat().map((key, i) => {
              const isEmpty = key === '';
              const isDel   = key === '\u232B';
              return (
                <button
                  key={i}
                  onClick={() => {
                    if (isEmpty) return;
                    if (isDel) delDigit();
                    else addDigit(key);
                  }}
                  disabled={isLoading || isEmpty}
                  className={`pls-numpad-key ${isEmpty ? 'pls-numpad-key--empty' : isDel ? 'pls-numpad-key--del' : 'pls-numpad-key--digit'}`}
                >
                  {isDel ? <Delete size={20} /> : key}
                </button>
              );
            })}
          </div>

          {/* Submit */}
          {mode === 'signin' ? (
            <button
              onClick={() => submit(pin)}
              disabled={pin.length < 4 || loading}
              className={`pls-submit ${pin.length >= 4 ? 'pls-submit--ready' : 'pls-submit--disabled'}`}
            >
              {loading ? 'Signing in\u2026' : 'Sign In'}
            </button>
          ) : (
            <button
              onClick={() => submitClock(pin)}
              disabled={pin.length < 4 || clockLoading}
              className={`pls-submit ${pin.length >= 4 ? (clockType === 'in' ? 'pls-submit--clock-in' : 'pls-submit--clock-out') : 'pls-submit--disabled'}`}
            >
              {clockLoading
                ? (clockType === 'in' ? 'Clocking in\u2026' : 'Clocking out\u2026')
                : (clockType === 'in' ? 'Clock In' : 'Clock Out')}
            </button>
          )}
        </>
      )}

      {/* Auto-update — Electron only */}
      <UpdateBadge />

      {/* Reset station */}
      <div className="pls-reset-section">
        {!showConfirm ? (
          <button onClick={() => setShowConfirm(true)} className="pls-reset-link">
            Reset this register
          </button>
        ) : (
          <div className="pls-reset-confirm">
            <p className="pls-reset-warning">
              This will remove the station setup. A manager will need to reconfigure it.
            </p>
            <div className="pls-reset-actions">
              <button onClick={() => clearStation()} className="pls-reset-yes">Yes, reset</button>
              <button onClick={() => setShowConfirm(false)} className="pls-reset-cancel">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
