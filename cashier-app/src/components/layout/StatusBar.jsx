import React, { useState, useEffect, useRef } from 'react';
import { Wifi, WifiOff, RefreshCw, User, Clock, LogOut, Database, AlertTriangle } from 'lucide-react';
import StoreveuLogo from '../StoreveuLogo.jsx';
import { useAuthStore }    from '../../stores/useAuthStore.js';
import { useStationStore } from '../../stores/useStationStore.js';
import { useSyncStore }    from '../../stores/useSyncStore.js';
import { useCartStore }    from '../../stores/useCartStore.js';
import { fmtTime }         from '../../utils/formatters.js';
import { countCachedProducts } from '../../db/dexie.js';

/** How many minutes ago was the last catalog sync (rounded) */
function fmtSyncAge(isoStr) {
  if (!isoStr) return null;
  const mins = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export default function StatusBar({ onRefresh }) {
  const cashier  = useAuthStore(s => s.cashier);
  const logout   = useAuthStore(s => s.logout);
  const station  = useStationStore(s => s.station);
  const { isOnline, isSyncing, pendingCount, catalogSyncing, catalogSyncedAt, syncError, clearSyncError } = useSyncStore();
  const txNumber = useCartStore(s => s.txNumber);
  const cartItemCount = useCartStore(s => s.items.length);
  const checkLogout   = useAuthStore(s => s.checkLogout);

  const [time,          setTime]          = useState(fmtTime());
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [blockMsg,      setBlockMsg]      = useState('');
  const [syncAge,       setSyncAge]       = useState(fmtSyncAge(catalogSyncedAt));
  const [productCount,  setProductCount]  = useState(null);
  const resetTimer = useRef(null);

  // Count cached products for offline indicator
  useEffect(() => {
    countCachedProducts().then(setProductCount).catch(() => {});
    // Refresh count after every catalog sync
  }, [catalogSyncedAt]);

  // Auto-enter fullscreen when logged in
  useEffect(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  // Clock — update every 10 s
  useEffect(() => {
    const id = setInterval(() => setTime(fmtTime()), 10_000);
    return () => clearInterval(id);
  }, []);

  // "X min ago" label — update every 30 s
  useEffect(() => {
    setSyncAge(fmtSyncAge(catalogSyncedAt));
    const id = setInterval(() => setSyncAge(fmtSyncAge(catalogSyncedAt)), 30_000);
    return () => clearInterval(id);
  }, [catalogSyncedAt]);

  // Two-tap logout: first tap arms it (3 s window), second tap fires
  const handleLogout = async () => {
    // Guard: block sign-out if transaction in progress
    const check = checkLogout(cartItemCount);
    if (!check.allowed) {
      setBlockMsg(check.reason);
      setTimeout(() => setBlockMsg(''), 3000);
      return;
    }
    if (!confirmLogout) {
      setConfirmLogout(true);
      resetTimer.current = setTimeout(() => setConfirmLogout(false), 3000);
      return;
    }
    clearTimeout(resetTimer.current);
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
    logout();
  };

  return (
    <div style={{
      height: 44, flexShrink: 0,
      background: 'var(--statusbar-bg)',
      borderBottom: '1px solid rgba(255,255,255,.06)',
      display: 'flex', alignItems: 'center',
      padding: '0 1rem', gap: '1.25rem',
      fontSize: '0.72rem', fontWeight: 600,
      color: 'var(--text-muted)',
      userSelect: 'none',
    }}>

      {/* Brand / Store name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <StoreveuLogo iconOnly={true} height={28} darkMode={true} />
        <span style={{ color: 'var(--text-primary)', fontWeight: 700, letterSpacing: '0.03em', fontSize: '0.8rem' }}>
          {station?.storeName || 'Storeveu POS'}
        </span>
      </div>
      {station?.stationName && (
        <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', fontWeight: 600, flexShrink: 0 }}>
          {station.stationName}
        </span>
      )}

      <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,.08)', flexShrink: 0 }} />

      {/* Online status + cached product count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
        {isOnline
          ? <Wifi size={12} color="var(--green)" />
          : <WifiOff size={12} color="var(--red)" />}
        <span style={{ color: isOnline ? 'var(--green)' : 'var(--red)' }}>
          {isOnline ? 'ONLINE' : 'OFFLINE'}
        </span>
        {productCount !== null && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: 3,
            color: 'var(--text-muted)', fontSize: '0.65rem',
            marginLeft: 2,
          }}>
            <Database size={10} />
            {productCount.toLocaleString()}
          </span>
        )}
      </div>

      {/* ── Catalog Refresh button ── */}
      {isOnline && onRefresh && (
        <button
          onClick={catalogSyncing ? undefined : onRefresh}
          disabled={catalogSyncing}
          title={catalogSyncing ? 'Syncing catalog…' : `Refresh catalog${syncAge ? ` · last synced ${syncAge}` : ''}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            height: 26, borderRadius: 6, padding: '0 9px',
            background: catalogSyncing
              ? 'rgba(122,193,67,.12)'
              : 'rgba(255,255,255,.05)',
            border: `1px solid ${catalogSyncing
              ? 'rgba(122,193,67,.3)'
              : 'rgba(255,255,255,.09)'}`,
            color: catalogSyncing ? 'var(--green)' : 'var(--text-muted)',
            cursor: catalogSyncing ? 'not-allowed' : 'pointer',
            fontSize: '0.68rem', fontWeight: 700, flexShrink: 0,
            transition: 'background .15s, border-color .15s, color .15s',
          }}
          onMouseEnter={e => {
            if (!catalogSyncing) {
              e.currentTarget.style.background   = 'rgba(122,193,67,.1)';
              e.currentTarget.style.borderColor  = 'rgba(122,193,67,.3)';
              e.currentTarget.style.color        = 'var(--green)';
            }
          }}
          onMouseLeave={e => {
            if (!catalogSyncing) {
              e.currentTarget.style.background   = 'rgba(255,255,255,.05)';
              e.currentTarget.style.borderColor  = 'rgba(255,255,255,.09)';
              e.currentTarget.style.color        = 'var(--text-muted)';
            }
          }}
        >
          <RefreshCw
            size={11}
            style={{ animation: catalogSyncing ? 'spin 0.9s linear infinite' : 'none' }}
          />
          {catalogSyncing ? 'Syncing…' : syncAge ? `Synced ${syncAge}` : 'Refresh'}
        </button>
      )}

      {/* Pending tx-queue badge */}
      {pendingCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <RefreshCw size={11} color="var(--amber)"
            style={{ animation: isSyncing ? 'spin 1s linear infinite' : 'none' }} />
          <span style={{ color: 'var(--amber)' }}>
            {pendingCount} pending{isSyncing ? '…' : ''}
          </span>
        </div>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* TX Number */}
      {txNumber && (
        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-secondary)', flexShrink: 0 }}>
          {txNumber}
        </span>
      )}

      {/* Cashier name (amber if in offline mode) */}
      {cashier && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
          color: cashier.offlineMode ? 'var(--amber)' : 'var(--text-muted)',
        }}>
          <User size={12} color={cashier.offlineMode ? 'var(--amber)' : 'var(--text-muted)'} />
          <span>{cashier.name || cashier.email}</span>
          {cashier.offlineMode && (
            <span style={{ fontSize: '0.6rem', fontWeight: 800, opacity: 0.8 }}>(offline)</span>
          )}
        </div>
      )}

      {/* Clock */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
        <Clock size={12} />
        <span>{time}</span>
      </div>

      {/* Logout button — two-tap confirm */}
      <button
        onClick={handleLogout}
        title="Sign out"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          height: 28, borderRadius: 6,
          padding: confirmLogout ? '0 10px' : '0 8px',
          background: confirmLogout ? 'rgba(224,63,63,.18)' : 'rgba(255,255,255,.05)',
          border: `1px solid ${confirmLogout ? 'rgba(224,63,63,.45)' : 'rgba(255,255,255,.09)'}`,
          color: confirmLogout ? 'var(--red)' : 'var(--text-muted)',
          cursor: 'pointer', transition: 'background .15s, border-color .15s, color .15s',
          fontSize: '0.7rem', fontWeight: 700, flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => {
          if (!confirmLogout) {
            e.currentTarget.style.background  = 'rgba(224,63,63,.1)';
            e.currentTarget.style.borderColor = 'rgba(224,63,63,.3)';
            e.currentTarget.style.color       = 'var(--red)';
          }
        }}
        onMouseLeave={e => {
          if (!confirmLogout) {
            e.currentTarget.style.background  = 'rgba(255,255,255,.05)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,.09)';
            e.currentTarget.style.color       = 'var(--text-muted)';
          }
        }}
      >
        <LogOut size={12} />
        {confirmLogout ? 'Tap again to sign out' : 'Sign out'}
      </button>

      {/* Sign-out blocked warning */}
      {blockMsg && (
        <div style={{
          background: 'rgba(224,63,63,.12)', border: '1px solid rgba(224,63,63,.25)',
          borderRadius: 4, padding: '2px 8px', fontSize: '0.65rem',
          color: 'var(--red)', fontWeight: 700, flexShrink: 0,
        }}>
          {blockMsg}
        </div>
      )}

      {/* Offline mode warning */}
      {!isOnline && (
        <div style={{
          background: 'rgba(224,63,63,.12)', border: '1px solid rgba(224,63,63,.25)',
          borderRadius: 4, padding: '2px 8px', fontSize: '0.65rem',
          color: 'var(--red)', fontWeight: 700, flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <AlertTriangle size={10} />
          OFFLINE — Sales queued, will sync on reconnect
        </div>
      )}

      {/* Auth-expired warning: pending queue can't drain because JWT expired */}
      {isOnline && syncError === 'auth_expired' && pendingCount > 0 && (
        <div
          onClick={clearSyncError}
          title="Click to dismiss"
          style={{
            background: 'rgba(245,158,11,.15)', border: '1px solid rgba(245,158,11,.35)',
            borderRadius: 4, padding: '2px 10px', fontSize: '0.65rem',
            color: 'var(--amber)', fontWeight: 700, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
          }}>
          <AlertTriangle size={10} />
          Session expired — sign out and log in again to sync {pendingCount} pending sale{pendingCount !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
