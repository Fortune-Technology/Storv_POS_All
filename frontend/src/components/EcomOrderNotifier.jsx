/**
 * Global ecom order notifier — polls for new orders every 15 seconds
 * regardless of which portal page is active. Shows toast + plays sound.
 *
 * The "last seen order ID" is persisted to localStorage keyed by user, so:
 *   • Sound plays exactly once per ORDER (not once per session per order)
 *   • Logging out and logging back in does NOT replay the alert
 *   • Switching users on the same browser keeps each user's history isolated
 */

import { useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import './EcomOrderNotifier.css';

const POLL_INTERVAL = 15000;

// localStorage key for the highest-seen order id, namespaced per user.
function lastSeenKey(userId, storeId) {
  return `ecomOrderNotifier:lastSeen:${userId || 'anon'}:${storeId || 'all'}`;
}
function readLastSeen(userId, storeId) {
  try { return localStorage.getItem(lastSeenKey(userId, storeId)) || null; }
  catch { return null; }
}
function writeLastSeen(userId, storeId, value) {
  try { localStorage.setItem(lastSeenKey(userId, storeId), String(value)); }
  catch { /* ignore */ }
}

let _audio = null;
let _audioUnlocked = false;

function ensureAudio() {
  if (!_audio) {
    _audio = new Audio('/sounds/ordernotification.mp3');
    _audio.volume = 0.8;
    _audio.preload = 'auto';
  }
  return _audio;
}

function unlockAudio() {
  if (_audioUnlocked) return;
  const audio = ensureAudio();
  audio.volume = 0;
  audio.play().then(() => {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 0.8;
    _audioUnlocked = true;
  }).catch(() => {});
}

if (typeof window !== 'undefined') {
  document.addEventListener('click', unlockAudio, { once: true });
  document.addEventListener('touchstart', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });
}

function playNotifSound() {
  try {
    const audio = ensureAudio();
    audio.currentTime = 0;
    audio.volume = 0.8;
    console.log('[OrderNotifier] Playing MP3... unlocked:', _audioUnlocked, 'src:', audio.src);
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.then(() => {
        console.log('[OrderNotifier] MP3 playing successfully');
      }).catch((err) => {
        console.warn('[OrderNotifier] MP3 blocked:', err.message, '— trying Web Audio fallback');
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 880;
          osc.type = 'sine';
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.5);
          console.log('[OrderNotifier] Web Audio fallback played');
        } catch (e2) {
          console.error('[OrderNotifier] Both audio methods failed:', e2.message);
        }
      });
    }
  } catch (err) {
    console.error('[OrderNotifier] playNotifSound error:', err.message);
  }
}

function getAuthContext() {
  const u = JSON.parse(localStorage.getItem('user') || '{}');
  const storeId = localStorage.getItem('activeStoreId') || '';
  return {
    userId: u.id || null,
    storeId,
    headers: {
      Authorization: `Bearer ${u.token || ''}`,
      'X-Store-Id': storeId,
      'X-Org-Id': u.orgId || u.tenantId || '',
    },
  };
}

/**
 * Pick the highest-id-equivalent value from an order list. Most ecom orders
 * use createdAt timestamps as a stable monotonic ordering. Falls back to
 * id strings (lexical compare) when createdAt is missing.
 */
function highWatermark(orders) {
  if (!Array.isArray(orders) || orders.length === 0) return null;
  let best = null;
  for (const o of orders) {
    const candidate = o.createdAt || o.id || null;
    if (!candidate) continue;
    if (!best || String(candidate) > String(best)) best = candidate;
  }
  return best ? String(best) : null;
}

export default function EcomOrderNotifier() {
  const initializedRef = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    ensureAudio();

    const check = async () => {
      try {
        const { userId, storeId, headers } = getAuthContext();
        if (!headers.Authorization || headers.Authorization === 'Bearer ') return;

        const r = await fetch('/api/ecom/manage/orders', { headers });
        if (!r.ok) return;
        const data = await r.json();
        const orders = Array.isArray(data?.data) ? data.data : [];
        const newest = highWatermark(orders);
        if (!newest) return;

        const lastSeen = readLastSeen(userId, storeId);

        // First poll on a fresh user/store: silently seed the marker —
        // this is the bug the user flagged ("voice triggers on every login").
        // Only orders STRICTLY NEWER than the seeded marker should ever play sound.
        if (!lastSeen) {
          writeLastSeen(userId, storeId, newest);
          initializedRef.current = true;
          return;
        }

        // Count how many orders are strictly newer than the marker. This is
        // both more accurate than the old total-count delta (which could shift
        // from refunds/voids) and idempotent across logins.
        const newerOrders = orders.filter((o) => {
          const ord = o.createdAt || o.id || '';
          return ord && String(ord) > String(lastSeen);
        });

        if (newerOrders.length > 0) {
          playNotifSound();
          toast.info(
            <div onClick={() => navigate('/portal/ecom/orders')} className="eon-toast">
              <strong>New Order Received!</strong>
              <div className="eon-toast-detail">
                {newerOrders.length} new order{newerOrders.length > 1 ? 's' : ''} — click to view
              </div>
            </div>,
            { autoClose: 10000 }
          );
          writeLastSeen(userId, storeId, newest);
        }
      } catch {}
    };

    check();
    const interval = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  return null;
}
