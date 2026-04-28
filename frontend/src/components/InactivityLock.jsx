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

// Persist lock state across page reloads. Without these keys, hitting F5
// (or letting the page auto-reload after JS error) silently dismissed the
// lock — letting anyone with browser access reach the portal without
// re-entering the password.
const LS_LOCKED      = 'storv:il:locked';        // 'true' | absent
const LS_LAST_ACTIVE = 'storv:il:lastActive';    // unix-ms timestamp
const LS_LOCKED_FOR  = 'storv:il:lockedFor';     // userId of the session that owns the lock

function readPersistedLock() {
  try { return localStorage.getItem(LS_LOCKED) === 'true'; }
  catch { return false; }
}
function readPersistedLastActive() {
  try {
    const v = parseInt(localStorage.getItem(LS_LAST_ACTIVE), 10);
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}
function writePersistedLock(v) {
  try {
    if (v) localStorage.setItem(LS_LOCKED, 'true');
    else   localStorage.removeItem(LS_LOCKED);
  } catch { /* ignore */ }
}
function writePersistedLastActive(ts) {
  try { localStorage.setItem(LS_LAST_ACTIVE, String(ts)); }
  catch { /* ignore */ }
}
function readPersistedLockedFor() {
  try { return localStorage.getItem(LS_LOCKED_FOR) || ''; }
  catch { return ''; }
}
function writePersistedLockedFor(id) {
  try {
    if (id) localStorage.setItem(LS_LOCKED_FOR, String(id));
    else    localStorage.removeItem(LS_LOCKED_FOR);
  } catch { /* ignore */ }
}
// Identity of the currently signed-in user. Falls back to email when id
// isn't on the user object (older login responses, edge cases).
function readCurrentUserId() {
  try {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    return String(u?.id || u?.email || '');
  } catch { return ''; }
}

export default function InactivityLock() {
  const location = useLocation();
  // Initialise locked state from persistence — this is the actual fix for
  // the "reload bypasses lock" bug. Two cases trigger initial-locked=true:
  //   1. lock was explicitly set before the reload (LS_LOCKED='true')
  //   2. last-active timestamp is older than IDLE_MS (we'd be locked
  //      anyway by now if the page had stayed open)
  //
  // Identity guard: the persisted lock belongs to whichever session was
  // active when it was set. If a different user is now signed in (regular
  // login, admin SSO impersonation, signup, invitation accept), the
  // persisted state is stale — clear it and start unlocked. Otherwise the
  // new session would immediately demand the previous user's password.
  const [locked, setLocked] = useState(() => {
    const currentId = readCurrentUserId();
    const lockedFor = readPersistedLockedFor();
    if (currentId && lockedFor && lockedFor !== currentId) {
      writePersistedLock(false);
      writePersistedLastActive(0);
      writePersistedLockedFor('');
      return false;
    }
    if (readPersistedLock()) return true;
    const last = readPersistedLastActive();
    if (last && Date.now() - last >= IDLE_MS) return true;
    return false;
  });
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const timerRef       = useRef(null);
  const lastActivityRef = useRef(Date.now());

  // Skip lock entirely on public/auth pages
  const isProtected = location.pathname.startsWith(PROTECTED_PATH_PREFIX)
    && !SKIP_PATH_PREFIXES.some(p => location.pathname.startsWith(p));

  // Mirror lock state into localStorage so reloads keep it. Pages outside
  // the portal don't need persistence — clear when leaving. The lockedFor
  // marker records the user who owns the current lock so a session change
  // (login / SSO impersonation / signup / invitation accept) auto-invalidates.
  useEffect(() => {
    if (!isProtected) {
      writePersistedLock(false);
      writePersistedLockedFor('');
      return;
    }
    writePersistedLock(locked);
    writePersistedLockedFor(locked ? readCurrentUserId() : '');
  }, [locked, isProtected]);

  const resetTimer = useCallback(() => {
    if (locked || !isProtected) return;
    const now = Date.now();
    if (now - lastActivityRef.current < THROTTLE_MS) return;
    lastActivityRef.current = now;
    writePersistedLastActive(now);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setLocked(true), IDLE_MS);
  }, [locked, isProtected]);

  // Set up listeners
  useEffect(() => {
    if (!isProtected) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    // If we mounted in the unlocked state, schedule based on persisted
    // last-active timestamp so a reload mid-session doesn't grant a
    // fresh full IDLE_MS window. Locked state already handled by the
    // initial useState callback above.
    const nowMs = Date.now();
    const last  = readPersistedLastActive();
    if (!locked) {
      const elapsed = last ? nowMs - last : 0;
      const remaining = Math.max(0, IDLE_MS - elapsed);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setLocked(true), remaining);
      // If we don't have a baseline yet, plant one now so subsequent
      // reloads get the same picture.
      if (!last) writePersistedLastActive(nowMs);
    }

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, resetTimer, { passive: true });
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, resetTimer);
    };
  }, [isProtected, resetTimer, locked]);

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
        const now = Date.now();
        setLocked(false);
        setPw('');
        setError(null);
        lastActivityRef.current = now;
        writePersistedLock(false);
        writePersistedLastActive(now);
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
            try {
              localStorage.removeItem('storv:il:locked');
              localStorage.removeItem('storv:il:lastActive');
              localStorage.removeItem('storv:il:lockedFor');
            } catch { /* ignore */ }
            window.location.href = '/login';
          }}
        >
          Sign out instead
        </button>
      </div>
    </div>
  );
}
