/**
 * NotificationBell — global bell icon + dropdown panel.
 *
 * Mounted in Sidebar (or Layout). Polls /api/notifications/count every
 * 30s to keep the badge fresh, fetches the full list when the dropdown
 * opens, and lets the user mark-read / mark-all-read / dismiss / click
 * through to the linked URL.
 *
 * Hides itself when unauthenticated (no `user` in localStorage).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, X, CheckCheck, ShoppingCart, ListTodo, AlertTriangle,
  Info, AlertCircle, CheckCircle2, MessageSquare, Megaphone,
} from 'lucide-react';
import {
  listMyNotifications,
  getUnreadNotifCount,
  markNotifRead,
  markAllNotifsRead,
  dismissNotif,
} from '../services/api';
import './NotificationBell.css';

const POLL_INTERVAL_MS = 30 * 1000;

// Map source/iconKey → Lucide icon component
function iconForNotification(n) {
  const key = (n.iconKey || n.source || '').toLowerCase();
  switch (key) {
    case 'order':   return ShoppingCart;
    case 'task':    return ListTodo;
    case 'support': return MessageSquare;
    case 'admin':   return Megaphone;
    case 'alert':
    case 'warning': return AlertTriangle;
    case 'error':   return AlertCircle;
    case 'success': return CheckCircle2;
    default:        return Info;
  }
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function isAuthed() {
  try {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    return !!u?.token;
  } catch { return false; }
}

export default function NotificationBell() {
  const [open, setOpen]     = useState(false);
  const [count, setCount]   = useState(0);
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const buttonRef = useRef(null);

  // Poll the unread count regardless of whether the panel is open
  useEffect(() => {
    if (!isAuthed()) return undefined;

    let cancelled = false;
    const fetchCount = async () => {
      try {
        const r = await getUnreadNotifCount();
        if (!cancelled) setCount(r?.count || 0);
      } catch { /* ignore */ }
    };

    fetchCount();
    const id = setInterval(fetchCount, POLL_INTERVAL_MS);

    // Refetch when window becomes visible again
    const onVisible = () => { if (document.visibilityState === 'visible') fetchCount(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Click-outside to close
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target)
        && buttonRef.current && !buttonRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listMyNotifications({ limit: 30 });
      setItems(r?.data || []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchList();
  };

  const handleItemClick = async (n) => {
    if (!n.readAt) {
      try { await markNotifRead(n.deliveryId); } catch { /* non-fatal */ }
      setItems((prev) => prev.map(p => p.deliveryId === n.deliveryId ? { ...p, readAt: new Date().toISOString() } : p));
      setCount((c) => Math.max(0, c - 1));
    }
    if (n.linkUrl) {
      setOpen(false);
      // Internal link → React Router; external → new tab
      if (n.linkUrl.startsWith('/')) navigate(n.linkUrl);
      else window.open(n.linkUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleDismiss = async (e, n) => {
    e.stopPropagation();
    try { await dismissNotif(n.deliveryId); } catch { /* non-fatal */ }
    setItems((prev) => prev.filter(p => p.deliveryId !== n.deliveryId));
    if (!n.readAt) setCount((c) => Math.max(0, c - 1));
  };

  const handleMarkAll = async () => {
    try { await markAllNotifsRead(); } catch { /* non-fatal */ }
    const now = new Date().toISOString();
    setItems((prev) => prev.map(p => p.readAt ? p : { ...p, readAt: now }));
    setCount(0);
  };

  if (!isAuthed()) return null;

  return (
    <div className="notif-bell">
      <button
        type="button"
        ref={buttonRef}
        className={`notif-bell-btn ${count > 0 ? 'notif-bell-btn--has-unread' : ''}`}
        onClick={handleToggle}
        aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ''}`}
        title="Notifications"
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="notif-bell-badge">{count > 99 ? '99+' : count}</span>
        )}
      </button>

      {open && (
        <div ref={panelRef} className="notif-bell-panel" role="dialog" aria-label="Notifications">
          <div className="notif-bell-panel-header">
            <span className="notif-bell-panel-title">Notifications</span>
            <div className="notif-bell-panel-actions">
              {count > 0 && (
                <button type="button" className="notif-bell-link" onClick={handleMarkAll}>
                  <CheckCheck size={13} /> Mark all read
                </button>
              )}
              <button
                type="button"
                className="notif-bell-icon-btn"
                onClick={() => setOpen(false)}
                aria-label="Close notifications"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="notif-bell-list">
            {loading ? (
              <div className="notif-bell-empty">Loading…</div>
            ) : items.length === 0 ? (
              <div className="notif-bell-empty">
                <Bell size={28} />
                <p>You're all caught up.</p>
              </div>
            ) : (
              items.map((n) => {
                const Icon = iconForNotification(n);
                const unread = !n.readAt;
                return (
                  <div
                    key={n.deliveryId}
                    role="button"
                    tabIndex={0}
                    className={`notif-bell-item ${unread ? 'notif-bell-item--unread' : ''} notif-bell-item--${n.type || 'info'} notif-bell-item--p-${n.priority || 'normal'}`}
                    onClick={() => handleItemClick(n)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleItemClick(n); } }}
                  >
                    <div className="notif-bell-item-icon">
                      <Icon size={16} />
                    </div>
                    <div className="notif-bell-item-body">
                      <div className="notif-bell-item-title">
                        {n.title}
                        {unread && <span className="notif-bell-item-dot" aria-label="unread" />}
                      </div>
                      <div className="notif-bell-item-msg">{n.message}</div>
                      <div className="notif-bell-item-meta">
                        <span>{timeAgo(n.createdAt)}</span>
                        {n.priority && n.priority !== 'normal' && (
                          <span className={`notif-bell-pri notif-bell-pri--${n.priority}`}>{n.priority}</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="notif-bell-dismiss"
                      onClick={(e) => handleDismiss(e, n)}
                      aria-label="Dismiss notification"
                      title="Dismiss"
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
