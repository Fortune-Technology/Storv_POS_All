/**
 * Storv Exchange real-time bell — polls for:
 *   • New incoming wholesale orders (status=sent, direction=incoming)
 *   • New pending partner requests
 * Plays the same notification sound as ecom orders + shows a toast.
 */

import { useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { listWholesaleOrders, listPendingPartnerRequests } from '../services/api';

const POLL_INTERVAL = 15000;

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
  const a = ensureAudio();
  a.volume = 0;
  a.play().then(() => { a.pause(); a.currentTime = 0; a.volume = 0.8; _audioUnlocked = true; }).catch(() => {});
}
if (typeof window !== 'undefined') {
  document.addEventListener('click', unlockAudio, { once: true });
  document.addEventListener('touchstart', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });
}
function playSound() {
  try {
    const a = ensureAudio();
    a.currentTime = 0;
    const p = a.play();
    if (p) p.catch(() => {
      // Web Audio fallback
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
      } catch {}
    });
  } catch {}
}

export default function ExchangeNotifier() {
  const lastOrdersRef = useRef(null);
  const lastPartnersRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    ensureAudio();
    const check = async () => {
      try {
        const u = JSON.parse(localStorage.getItem('user') || '{}');
        if (!u.token) return;

        const [ordersRes, partnersRes] = await Promise.all([
          listWholesaleOrders({ direction: 'incoming', status: 'sent', limit: 50 }).catch(() => ({ data: [] })),
          listPendingPartnerRequests().catch(() => ({ data: [], count: 0 })),
        ]);

        const pendingOrders = ordersRes.data?.length || 0;
        const pendingPartners = partnersRes.count || 0;

        if (lastOrdersRef.current !== null && pendingOrders > lastOrdersRef.current) {
          const diff = pendingOrders - lastOrdersRef.current;
          playSound();
          toast.info(
            <div onClick={() => navigate('/portal/exchange?tab=orders&direction=incoming')} style={{ cursor: 'pointer' }}>
              <strong>Wholesale Order Received</strong>
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                {diff} new PO{diff > 1 ? 's' : ''} from trading partner — click to review
              </div>
            </div>,
            { autoClose: 10000 }
          );
        }
        if (lastPartnersRef.current !== null && pendingPartners > lastPartnersRef.current) {
          playSound();
          toast.info(
            <div onClick={() => navigate('/portal/exchange?tab=partners')} style={{ cursor: 'pointer' }}>
              <strong>New Trading Partner Request</strong>
              <div style={{ fontSize: 12, opacity: 0.85 }}>Click to review</div>
            </div>,
            { autoClose: 10000 }
          );
        }
        lastOrdersRef.current = pendingOrders;
        lastPartnersRef.current = pendingPartners;
      } catch { /* silent */ }
    };

    check();
    const iv = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(iv);
  }, [navigate]);

  return null;
}
