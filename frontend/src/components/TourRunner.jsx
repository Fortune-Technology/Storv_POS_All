/**
 * TourRunner — step-by-step walkthrough with element spotlight.
 *
 * When a step has a `selector`, we dim the rest of the page and punch a hole
 * around the target element (`box-shadow: 0 0 0 9999px` trick) + pulse a ring.
 * The tour card repositions to the opposite side of the target so it doesn't
 * cover the highlighted element. Auto-scrolls the target into view.
 *
 * When a step has no selector (or the selector doesn't match anything on the
 * current page), falls back to a centered card with dim overlay only.
 *
 * State is persisted to sessionStorage so the card survives React Router
 * navigation + full page reload. If the backend returns 401 during tour
 * navigation, the global interceptor redirects to /login?returnTo=...; after
 * re-login, TourRunner picks up where it left off.
 */

import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronLeft, ChevronRight, Navigation, Sparkles, Minus } from 'lucide-react';
import { getAiTourBySlug } from '../services/api';
import './TourRunner.css';

const SESSION_KEY = 'activeTour';
const PADDING = 6;          // spacing between spotlight ring and target
const CARD_GAP = 18;        // space between card and highlighted element

function saveState(state) {
  if (state) sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  else       sessionStorage.removeItem(SESSION_KEY);
}

function loadState() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}

function renderBody(text) {
  if (!text) return '';
  const escaped = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
}

/**
 * Find the target element for the current step.
 *
 * Uses requestAnimationFrame + a small retry window so we pick up elements
 * rendered after route change (React mount). Returns null if not found.
 */
function waitForElement(selector, timeout = 1500) {
  return new Promise(resolve => {
    const deadline = Date.now() + timeout;
    function tick() {
      if (!selector) { resolve(null); return; }
      const el = document.querySelector(selector);
      if (el) { resolve(el); return; }
      if (Date.now() >= deadline) { resolve(null); return; }
      requestAnimationFrame(tick);
    }
    tick();
  });
}

/**
 * Decode a JWT (without signature verification) to check if it's expired.
 * Used for a cheap client-side pre-check so we can show a friendly message
 * instead of silently navigating to a page that will 401 and bounce.
 */
function isTokenExpired() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (!user?.token) return true;
    const [, payload] = user.token.split('.');
    const { exp } = JSON.parse(atob(payload));
    // 10s buffer so we don't race with token expiry at exactly now.
    return !exp || Date.now() / 1000 > exp - 10;
  } catch { return false; }
}

/**
 * Pick a card position that avoids the highlighted rect — tries right, bottom,
 * left, then top. Returns { top, left } in viewport pixels.
 */
function pickCardPosition(targetRect, cardWidth, cardHeight) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const candidates = [
    // Right of target
    { top: Math.max(16, targetRect.top), left: targetRect.right + CARD_GAP },
    // Below target
    { top: targetRect.bottom + CARD_GAP, left: Math.max(16, targetRect.left) },
    // Left of target
    { top: Math.max(16, targetRect.top), left: targetRect.left - cardWidth - CARD_GAP },
    // Above target
    { top: targetRect.top - cardHeight - CARD_GAP, left: Math.max(16, targetRect.left) },
  ];

  for (const p of candidates) {
    if (p.left >= 16 && p.left + cardWidth <= vw - 16 &&
        p.top  >= 16 && p.top  + cardHeight <= vh - 16) {
      return p;
    }
  }
  // Fallback: top-right corner (where the non-spotlighted card lives).
  return { top: 78, right: 22 };
}

export default function TourRunner() {
  const navigate = useNavigate();
  const [tour, setTour]           = useState(null);
  const [stepIndex, setStepIdx]   = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [error, setError]         = useState(null);
  const [targetRect, setTargetRect] = useState(null);   // rect of highlighted element
  const [cardPos, setCardPos]     = useState(null);     // { top, left } | { top, right }
  const [sessionExpired, setSessionExpired] = useState(false);

  const cardRef = useRef(null);

  const loadTour = useCallback(async (slug, startAt = 0) => {
    setError(null);
    try {
      const res = await getAiTourBySlug(slug);
      const t = res.tour;
      if (!t || !Array.isArray(t.steps) || t.steps.length === 0) {
        setError('This tour has no steps.');
        return;
      }
      setTour(t);
      const idx = Math.min(Math.max(0, startAt), t.steps.length - 1);
      setStepIdx(idx);
      saveState({ slug: t.slug, stepIndex: idx });
      setMinimized(false);
    } catch (err) {
      // Session expired — tour state is already in sessionStorage; the global
      // 401 interceptor will redirect to /login and bring them back. Just stop
      // spinning silently.
      if (err?.response?.status === 401) return;
      setError(err.response?.data?.error || 'Failed to load tour');
      saveState(null);
    }
  }, []);

  // Mount: check URL param ?startTour=, then session-restored tour.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlSlug = params.get('startTour');
    if (urlSlug) {
      params.delete('startTour');
      const newSearch = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (newSearch ? `?${newSearch}` : ''));
      loadTour(urlSlug, 0);
      return;
    }
    const saved = loadState();
    if (saved?.slug) loadTour(saved.slug, saved.stepIndex || 0);
  }, [loadTour]);

  useEffect(() => {
    const handler = (e) => {
      const slug = e.detail?.slug;
      if (slug) loadTour(slug, 0);
    };
    window.addEventListener('ai-tour-start', handler);
    return () => window.removeEventListener('ai-tour-start', handler);
  }, [loadTour]);

  /**
   * Whenever the step changes (or the tour becomes visible), try to find the
   * target element on the current page. If found: scroll it into view, compute
   * spotlight rect + card position. If not: clear rect (centered card mode).
   */
  useLayoutEffect(() => {
    if (!tour || minimized) { setTargetRect(null); return; }
    const step = tour.steps[stepIndex];
    const selector = step?.selector;

    let disposed = false;
    let clickListenerEl = null;

    // Click-through auto-advance: if user clicks the spotlighted element,
    // advance to the next step automatically. We let the element's own
    // handler fire first (no preventDefault) and call `next()` on the next
    // animation frame — so the user's intent is honoured AND the tour keeps up.
    const handleTargetClick = () => {
      // Tiny delay so if the click causes navigation, the URL-change effect
      // happens before we advance + resolve the next selector.
      setTimeout(() => { next(); }, 120);
    };

    async function resolveTarget() {
      if (!selector) { setTargetRect(null); setCardPos(null); return; }
      const el = await waitForElement(selector, 1500);
      if (disposed) return;
      if (!el) { setTargetRect(null); setCardPos(null); return; }

      // Scroll into view (instant; we update the rect on scroll/resize below).
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      } catch { el.scrollIntoView(); }

      // Give the smooth-scroll a beat so the rect is stable.
      setTimeout(() => {
        if (disposed) return;
        const rect = el.getBoundingClientRect();
        setTargetRect({
          top: rect.top, left: rect.left, width: rect.width, height: rect.height,
          right: rect.right, bottom: rect.bottom,
        });
        const cw = cardRef.current?.offsetWidth || 360;
        const ch = cardRef.current?.offsetHeight || 260;
        setCardPos(pickCardPosition(rect, cw, ch));
      }, 220);

      el.addEventListener('click', handleTargetClick);
      clickListenerEl = el;
    }

    resolveTarget();
    return () => {
      disposed = true;
      if (clickListenerEl) clickListenerEl.removeEventListener('click', handleTargetClick);
    };
    // `next` is stable via useCallback dependency chain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, stepIndex, minimized]);

  // Reposition on resize / scroll.
  useEffect(() => {
    if (!tour || minimized || !targetRect) return;
    const step = tour.steps[stepIndex];
    if (!step?.selector) return;

    const update = () => {
      const el = document.querySelector(step.selector);
      if (!el) { setTargetRect(null); setCardPos(null); return; }
      const rect = el.getBoundingClientRect();
      setTargetRect({
        top: rect.top, left: rect.left, width: rect.width, height: rect.height,
        right: rect.right, bottom: rect.bottom,
      });
      const cw = cardRef.current?.offsetWidth || 360;
      const ch = cardRef.current?.offsetHeight || 260;
      setCardPos(pickCardPosition(rect, cw, ch));
    };

    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [tour, stepIndex, minimized, targetRect]);

  const exit = useCallback(() => {
    setTour(null); setStepIdx(0); setTargetRect(null); setCardPos(null);
    saveState(null);
  }, []);

  const goTo = useCallback((i) => {
    if (!tour) return;
    const next = Math.max(0, Math.min(i, tour.steps.length - 1));
    setStepIdx(next);
    saveState({ slug: tour.slug, stepIndex: next });
  }, [tour]);

  const next = useCallback(() => {
    if (!tour) return;
    if (stepIndex >= tour.steps.length - 1) { exit(); return; }
    goTo(stepIndex + 1);
  }, [tour, stepIndex, goTo, exit]);

  const back = useCallback(() => goTo(stepIndex - 1), [goTo, stepIndex]);

  const navigateToStep = useCallback(() => {
    if (!tour) return;
    const step = tour.steps[stepIndex];
    if (!step?.url) return;

    // Pre-check: if JWT is expired, don't navigate blindly (that would 401
    // and trigger the global interceptor redirect to /login). Surface an
    // explicit message — tour state survives in sessionStorage so after the
    // user logs in and returns to the same page, the tour auto-resumes.
    if (isTokenExpired()) {
      setSessionExpired(true);
      return;
    }
    navigate(step.url);
  }, [tour, stepIndex, navigate]);

  const handleReLogin = useCallback(() => {
    // Tour state is already saved to sessionStorage. After login,
    // returnTo will restore the page and the tour auto-resumes.
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?session=expired&returnTo=${returnTo}`;
  }, []);

  if (error && !tour) {
    return (
      <div className="tr-toast" role="alert">
        <span>⚠ {error}</span>
        <button onClick={() => setError(null)}><X size={14} /></button>
      </div>
    );
  }
  if (!tour) return null;

  const step = tour.steps[stepIndex];
  const total = tour.steps.length;
  const isFirst = stepIndex === 0;
  const isLast  = stepIndex === total - 1;
  const progressPct = Math.round(((stepIndex + 1) / total) * 100);
  const hasSpotlight = !!targetRect;

  if (minimized) {
    return (
      <button className="tr-minimized" onClick={() => setMinimized(false)} title={`Resume tour: ${tour.name}`}>
        <Sparkles size={14} />
        <span>Step {stepIndex + 1} / {total}</span>
      </button>
    );
  }

  // Spotlight element: fixed-positioned to cover the target, with a massive
  // `box-shadow` spread that acts as the dim overlay. The target stays
  // visually crisp through the hole cut into the shadow.
  const spotlightStyle = targetRect ? {
    position: 'fixed',
    top: targetRect.top - PADDING,
    left: targetRect.left - PADDING,
    width: targetRect.width + PADDING * 2,
    height: targetRect.height + PADDING * 2,
    borderRadius: 10,
    boxShadow: [
      '0 0 0 4px rgba(61, 86, 181, 0.55)',
      '0 0 0 8px rgba(61, 86, 181, 0.22)',
      '0 0 0 9999px rgba(15, 23, 42, 0.55)',
    ].join(', '),
    pointerEvents: 'none',
    zIndex: 1140,
    transition: 'all 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
  } : null;

  // When no target, a plain dim overlay.
  const dimStyle = !targetRect ? {
    position: 'fixed', inset: 0,
    background: 'rgba(15, 23, 42, 0.4)',
    zIndex: 1140,
    pointerEvents: 'none',
  } : null;

  const cardStyle = cardPos || { top: 78, right: 22 };

  return (
    <>
      {spotlightStyle && <div className="tr-spotlight" style={spotlightStyle} />}
      {dimStyle && <div className="tr-dim" style={dimStyle} />}

      <div
        ref={cardRef}
        className={`tr-card ${hasSpotlight ? 'tr-card--spotlight' : ''}`}
        style={cardStyle}
        role="dialog"
        aria-label={`Tour: ${tour.name}`}
      >
        <div className="tr-header">
          <div className="tr-header-main">
            <span className="tr-header-icon"><Sparkles size={13} /></span>
            <div className="tr-header-text">
              <div className="tr-tour-name">{tour.name}</div>
              <div className="tr-progress-label">Step {stepIndex + 1} of {total}</div>
            </div>
          </div>
          <div className="tr-header-actions">
            <button className="tr-iconbtn" onClick={() => setMinimized(true)} title="Minimize">
              <Minus size={13} />
            </button>
            <button className="tr-iconbtn" onClick={exit} title="Exit tour">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="tr-progress-track">
          <div className="tr-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>

        <div className="tr-body">
          <h3 className="tr-step-title">{step.title || ''}</h3>
          <div className="tr-step-body" dangerouslySetInnerHTML={{ __html: renderBody(step.body || '') }} />
          {sessionExpired && (
            <div className="tr-session-expired">
              <strong>⚠ Your session expired.</strong>
              Log in again — your tour progress is saved and will auto-resume after sign-in.
              <button className="tr-session-btn" onClick={handleReLogin}>Log in & continue</button>
            </div>
          )}
          {hasSpotlight && !sessionExpired && (
            <div className="tr-spotlight-hint">
              👉 Click the highlighted area — the tour advances automatically.
            </div>
          )}
          {step.url && !hasSpotlight && !sessionExpired && (
            <button className="tr-goto" onClick={navigateToStep}>
              <Navigation size={13} /> Go to this screen
            </button>
          )}
        </div>

        <div className="tr-footer">
          <button className="tr-nav-btn" onClick={back} disabled={isFirst}>
            <ChevronLeft size={14} /> Back
          </button>
          <div className="tr-step-dots">
            {tour.steps.map((_, i) => (
              <button
                key={i}
                className={`tr-dot ${i === stepIndex ? 'tr-dot--current' : ''} ${i < stepIndex ? 'tr-dot--done' : ''}`}
                onClick={() => goTo(i)}
                title={`Jump to step ${i + 1}`}
              />
            ))}
          </div>
          <button className="tr-nav-btn tr-nav-btn--primary" onClick={next}>
            {isLast ? 'Finish' : 'Next'} <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </>
  );
}
