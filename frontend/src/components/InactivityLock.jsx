/**
 * InactivityLock — back-office security overlay.
 *
 * After IDLE_MS of no user activity (mouse, keyboard, click, scroll, touch),
 * shows a full-screen overlay that requires the user to re-enter their
 * password to continue. The session and current page are preserved — the
 * overlay just blocks interaction until unlock.
 *
 * Activity events are throttled to once per second to avoid spam.
 *
 * Skipped on these routes (still public): /login, /signup, /forgot-password,
 * /reset-password, /impersonate, marketing pages.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Lock, Eye, EyeOff } from 'lucide-react';
import api from '../services/api';
import './InactivityLock.css';

/* eslint-disable jsx-a11y/no-autofocus */

const IDLE_MS = 30 * 60 * 1000;     // 30 minutes
const THROTTLE_MS = 1000;            // collapse activity events to 1/sec
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
const SKIP_PATH_PREFIXES = ['/login', '/signup', '/forgot-password', '/reset-password', '/impersonate'];
const PROTECTED_PATH_PREFIX = '/portal'; // only lock when inside the portal

export default function InactivityLock() {
  const location = useLocation();
  const [locked, setLocked] = useState(false);
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const timerRef       = useRef(null);
  const lastActivityRef = useRef(Date.now());

  // Skip lock entirely on public/auth pages
  const isProtected = location.pathname.startsWith(PROTECTED_PATH_PREFIX)
    && !SKIP_PATH_PREFIXES.some(p => location.pathname.startsWith(p));

  const resetTimer = useCallback(() => {
    if (locked || !isProtected) return;
    const now = Date.now();
    if (now - lastActivityRef.current < THROTTLE_MS) return;
    lastActivityRef.current = now;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setLocked(true), IDLE_MS);
  }, [locked, isProtected]);

  // Set up listeners
  useEffect(() => {
    if (!isProtected) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }
    // Initial timer
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setLocked(true), IDLE_MS);

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, resetTimer, { passive: true });
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, resetTimer);
    };
  }, [isProtected, resetTimer]);

  // ── Unlock handler ─────────────────────────────────────────────────────────
  const handleUnlock = async (e) => {
    e?.preventDefault?.();
    setError(null);
    if (!pw) { setError('Password required'); return; }
    setSubmitting(true);
    try {
      const stored = JSON.parse(localStorage.getItem('user') || 'null');
      if (!stored?.email) {
        setError('Session lost — please sign in again.');
        setTimeout(() => { window.location.href = '/login'; }, 1200);
        return;
      }
      // Re-authenticate against the same credentials but DON'T overwrite the
      // session — we just need to confirm the password is correct.
      const res = await api.post('/auth/verify-password', { password: pw });
      if (res?.data?.success) {
        setLocked(false);
        setPw('');
        setError(null);
        lastActivityRef.current = Date.now();
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setLocked(true), IDLE_MS);
      } else {
        setError('Incorrect password');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Incorrect password');
    } finally {
      setSubmitting(false);
    }
  };

  return <LockOverlay
    visible={isProtected && locked}
    pw={pw}
    setPw={setPw}
    showPw={showPw}
    setShowPw={setShowPw}
    error={error}
    submitting={submitting}
    onSubmit={handleUnlock}
  />;
}

// Separate component so the input can be re-mounted (with focus) every time
// the overlay opens. Returns null when hidden so unmount/mount cycles around
// the input keep autoFocus reliable.
function LockOverlay({ visible, pw, setPw, showPw, setShowPw, error, submitting, onSubmit }) {
  const inputRef = useRef(null);

  // Force-focus the input each time the overlay becomes visible. Some browsers
  // (notably Electron/Chromium with backdrop-filter) silently drop autoFocus.
  useEffect(() => {
    if (!visible) return;
    let raf;
    const focusInput = () => {
      if (inputRef.current) {
        try { inputRef.current.focus({ preventScroll: true }); } catch { /* ignore */ }
      } else {
        raf = requestAnimationFrame(focusInput);
      }
    };
    raf = requestAnimationFrame(focusInput);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  if (!visible) return null;

  const stored = (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); }
    catch { return null; }
  })();

  // Guard: backdrop click should NOT dismiss the lock; stop propagation so
  // background page handlers can't react to clicks on the backdrop either.
  const swallow = (e) => { e.stopPropagation(); };

  return (
    <div
      className="il-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Session locked"
      onMouseDown={swallow}
      onClick={swallow}
      onTouchStart={swallow}
    >
      <div className="il-card" onMouseDown={e => e.stopPropagation()}>
        <div className="il-icon"><Lock size={36} /></div>
        <h2 className="il-title">Session Locked</h2>
        <p className="il-sub">
          You were inactive for 30&nbsp;minutes. Re-enter your password to continue.
        </p>
        {stored?.email && (
          <div className="il-user">{stored.name || stored.email}</div>
        )}
        <form onSubmit={onSubmit} className="il-form">
          <div className="il-pw-wrap">
            <input
              ref={inputRef}
              autoFocus
              type={showPw ? 'text' : 'password'}
              value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder="Password"
              className="il-pw-input"
              disabled={submitting}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="il-pw-eye"
              onClick={() => setShowPw(s => !s)}
              tabIndex={-1}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {error && <div className="il-error">{error}</div>}
          <button type="submit" className="il-unlock-btn" disabled={submitting || !pw}>
            {submitting ? 'Unlocking…' : 'Unlock'}
          </button>
        </form>
        <button
          type="button"
          className="il-signout"
          onClick={() => {
            localStorage.removeItem('user');
            localStorage.removeItem('activeStoreId');
            window.location.href = '/login';
          }}
        >
          Sign out instead
        </button>
      </div>
    </div>
  );
}
