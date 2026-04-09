/**
 * Global ecom order notifier — polls for new orders every 15 seconds
 * regardless of which portal page is active. Shows toast + plays sound.
 *
 * Sound strategy: pre-load the audio element on first user click (to satisfy
 * browser autoplay policy), then play it on new orders.
 */

import { useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

const POLL_INTERVAL = 15000;

// Pre-loaded audio element (survives re-renders)
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

// Unlock audio on first user interaction (click/touch anywhere on page)
function unlockAudio() {
  if (_audioUnlocked) return;
  const audio = ensureAudio();
  // Play a silent blip to unlock the audio context
  audio.volume = 0;
  audio.play().then(() => {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 0.8;
    _audioUnlocked = true;
  }).catch(() => {});
}

// Attach unlock listener once
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

function getHeaders() {
  const u = JSON.parse(localStorage.getItem('user') || '{}');
  const storeId = localStorage.getItem('activeStoreId') || '';
  return {
    Authorization: `Bearer ${u.token}`,
    'X-Store-Id': storeId,
    'X-Org-Id': u.orgId || u.tenantId || '',
  };
}

export default function EcomOrderNotifier() {
  const lastCountRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Pre-load the audio file
    ensureAudio();

    const check = async () => {
      try {
        const headers = getHeaders();
        if (!headers.Authorization || headers.Authorization === 'Bearer ') return;

        const r = await fetch('/api/ecom/manage/orders', { headers });
        if (!r.ok) return;
        const data = await r.json();
        const count = data.total ?? (data.data?.length || 0);

        if (lastCountRef.current !== null && count > lastCountRef.current) {
          const diff = count - lastCountRef.current;
          playNotifSound();
          toast.info(
            <div onClick={() => navigate('/portal/ecom/orders')} style={{ cursor: 'pointer' }}>
              <strong>New Order Received!</strong>
              <div style={{ fontSize: 12, marginTop: 2, opacity: 0.8 }}>
                {diff} new order{diff > 1 ? 's' : ''} — click to view
              </div>
            </div>,
            { autoClose: 10000 }
          );
        }
        lastCountRef.current = count;
      } catch {}
    };

    check();
    const interval = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  return null;
}
