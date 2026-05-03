import React, { useState, useEffect, useRef } from 'react';
import { Wifi, WifiOff, RefreshCw, User, Clock, LogOut, Database, AlertTriangle, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import StoreveuLogo from '../StoreveuLogo.jsx';
import { useAuthStore }    from '../../stores/useAuthStore.js';
import { useStationStore } from '../../stores/useStationStore.js';
import { useSyncStore }    from '../../stores/useSyncStore.js';
import { useCartStore }    from '../../stores/useCartStore.js';
import { usePOSConfig }    from '../../hooks/usePOSConfig.js';
import { fmtTime }         from '../../utils/formatters.js';
import { countCachedProducts, db } from '../../db/dexie.js';
import { useConfirm }      from '../../hooks/useConfirmDialog.jsx';
import './StatusBar.css';

// "Born on or before X" date for an age threshold (today − N years).
const ageDate = (years) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

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
  // Total quantity of items to bag (sum of qty across all lines, not line count)
  const cartItemCount = useCartStore(s => s.items.reduce((sum, i) => sum + (i.qty || 1), 0));
  const checkLogout   = useAuthStore(s => s.checkLogout);
  const posConfig     = usePOSConfig();
  const tobaccoAge    = Number(posConfig.ageLimits?.tobacco) || 0;
  const alcoholAge    = Number(posConfig.ageLimits?.alcohol) || 0;

  const [time,          setTime]          = useState(fmtTime());
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [blockMsg,      setBlockMsg]      = useState('');
  const [syncAge,       setSyncAge]       = useState(fmtSyncAge(catalogSyncedAt));
  const [productCount,  setProductCount]  = useState(null);
  const resetTimer = useRef(null);
  const confirm    = useConfirm();

  // Hard Reset — three-stage nuke for "the data on this register is wrong
  // and Refresh isn't fixing it":
  //   1. Wipe the IndexedDB products table (so any stale per-product
  //      depositAmount, retailPrice, etc. is gone — Refresh upserts on top
  //      of stale rows, which doesn't help when the field shape changed).
  //   2. Unregister every service worker (forces the PWA to re-download
  //      the latest JS bundle on reload, instead of serving the cached one).
  //   3. window.location.reload — kicks the app to fresh JS + empty cache,
  //      catalog sync will repopulate from server.
  // Manager PIN gate intentionally omitted — a wrong cache is a real
  // problem, and the cost of running this is "30 second resync wait."
  const handleHardReset = async () => {
    if (catalogSyncing) return;
    const ok = await confirm({
      title:   'Hard reset register?',
      message: 'Wipes the local product cache and reloads the cashier app. ' +
               'The next sign-in pulls fresh data from the server. Use this ' +
               'when prices, deposits, or product info look out of date and ' +
               'the regular Refresh button has not fixed it.',
      confirmLabel: 'Hard Reset',
      danger: true,
    });
    if (!ok) return;
    try {
      await db.products.clear();
    } catch { /* if Dexie is locked, the unregister + reload still helps */ }
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch { /* no SW to clear, fine */ }
    try {
      // Best-effort: also drop the Cache Storage so any opaque PWA assets
      // are re-fetched. If unsupported (Electron without CacheStorage), skip.
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch { /* ignore */ }
    window.location.reload();
  };

  // Count cached products for offline indicator
  useEffect(() => {
    countCachedProducts().then(setProductCount).catch(() => {});
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

  // Age-check dates: "must be born on or before" for tobacco / alcohol.
  // Falls back to a standard 21+ chip when both store-level limits are 0/unset.
  // Recomputed each render so they roll over at midnight (clock tick re-renders).
  const tobaccoDate = tobaccoAge > 0 ? ageDate(tobaccoAge) : null;
  const alcoholDate = alcoholAge > 0 ? ageDate(alcoholAge) : null;
  const showLegacy21 = !tobaccoDate && !alcoholDate;
  const legacy21Date = showLegacy21 ? ageDate(21) : null;

  // Two-tap logout: first tap arms it (3 s window), second tap fires
  const handleLogout = async () => {
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
    <div className="sb-bar">
      {/* Brand / Store name */}
      <div className="sb-brand">
        <StoreveuLogo iconOnly={true} height={28} darkMode={true} />
        <span className="sb-store-name">
          {station?.storeName || 'Storeveu POS'}
        </span>
      </div>
      {station?.stationName && (
        <span className="sb-station-name">{station.stationName}</span>
      )}

      <div className="sb-divider" />

      {/* Online status + cached product count */}
      <div className="sb-online-status">
        {isOnline
          ? <Wifi size={12} color="var(--green)" />
          : <WifiOff size={12} color="var(--red)" />}
        <span className={isOnline ? 'sb-online-label--on' : 'sb-online-label--off'}>
          {isOnline ? 'ONLINE' : 'OFFLINE'}
        </span>
        {productCount !== null && (
          <span className="sb-product-count">
            <Database size={10} />
            {productCount.toLocaleString()}
          </span>
        )}
      </div>

      {/* Catalog Refresh button */}
      {isOnline && onRefresh && (
        <button
          onClick={catalogSyncing ? undefined : onRefresh}
          disabled={catalogSyncing}
          title={catalogSyncing ? 'Syncing catalog\u2026' : `Refresh catalog${syncAge ? ` \u00B7 last synced ${syncAge}` : ''}`}
          className={`sb-refresh-btn ${catalogSyncing ? 'sb-refresh-btn--syncing' : ''}`}
        >
          <RefreshCw
            size={11}
            style={catalogSyncing ? { animation: 'spin 0.9s linear infinite' } : undefined}
          />
          {catalogSyncing ? 'Syncing\u2026' : syncAge ? `Synced ${syncAge}` : 'Refresh'}
        </button>
      )}

      {/* Hard Reset — wipes IndexedDB products + unregisters the service
          worker + reloads. Use when the cashier sees stale catalog data
          (deposit not flowing, prices off, etc.) that a normal Refresh
          doesn't fix. The normal Refresh upserts on top of the cache; this
          nukes the cache + the PWA bundle so the register comes back fresh. */}
      {isOnline && onRefresh && (
        <button
          onClick={catalogSyncing ? undefined : handleHardReset}
          disabled={catalogSyncing}
          title="Hard reset — wipe local cache + reload (use when refresh isn't fixing stale data)"
          className="sb-hardreset-btn"
        >
          <Zap size={11} /> Hard Reset
        </button>
      )}

      {/* Pending tx-queue badge */}
      {pendingCount > 0 && (
        <div className="sb-pending">
          <RefreshCw size={11} color="var(--amber)"
            style={isSyncing ? { animation: 'spin 1s linear infinite' } : undefined} />
          <span>
            {pendingCount} pending{isSyncing ? '\u2026' : ''}
          </span>
        </div>
      )}

      {/* Spacer */}
      <div className="sb-spacer" />

      {/* TX Number */}
      {txNumber && (
        <span className="sb-tx-number">{txNumber}</span>
      )}

      {/* Cashier name */}
      {cashier && (
        <div className={`sb-cashier ${cashier.offlineMode ? 'sb-cashier--offline' : 'sb-cashier--online'}`}>
          <User size={12} color={cashier.offlineMode ? 'var(--amber)' : 'var(--text-muted)'} />
          <span>{cashier.name || cashier.email}</span>
          {cashier.offlineMode && (
            <span className="sb-cashier-offline-tag">(offline)</span>
          )}
        </div>
      )}

      {/* Age-check chips — born on or before this date.
          Tobacco + Alcohol shown side-by-side when their limits are configured;
          falls back to a single 21+ chip when neither is set. */}
      {tobaccoDate && (
        <div
          className="sb-age-chip sb-age-chip--tobacco"
          title={`Customer must be born on or before this date to purchase tobacco (${tobaccoAge}+) items`}
        >
          <ShieldCheck size={12} />
          <span>Tobacco {tobaccoAge}+: {tobaccoDate}</span>
        </div>
      )}
      {alcoholDate && (
        <div
          className="sb-age-chip sb-age-chip--alcohol"
          title={`Customer must be born on or before this date to purchase alcohol (${alcoholAge}+) items`}
        >
          <ShieldCheck size={12} />
          <span>Alcohol {alcoholAge}+: {alcoholDate}</span>
        </div>
      )}
      {showLegacy21 && (
        <div className="sb-age21" title="Customer must be born on or before this date to purchase 21+ items">
          <ShieldCheck size={12} />
          <span>21+: {legacy21Date}</span>
        </div>
      )}

      {/* Clock */}
      <div className="sb-clock">
        <Clock size={12} />
        <span>{time}</span>
      </div>

      {/* AI Assistant trigger — sits beside Sign Out so the floating FAB
          no longer overlaps the logout button. Dispatches a window event
          that AIAssistantWidget listens to. Only shown when a cashier is
          signed in (mirrors the widget's own visibility check). */}
      {cashier && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('cashier-ai-toggle'))}
          title="AI Assistant — get help, ask questions"
          aria-label="Open AI Assistant"
          className="sb-ai-btn"
        >
          <Sparkles size={12} />
          <span className="sb-ai-btn-label">AI Assistant</span>
        </button>
      )}

      {/* Logout button — two-tap confirm */}
      <button
        onClick={handleLogout}
        title="Sign out"
        className={`sb-logout-btn ${confirmLogout ? 'sb-logout-btn--confirm' : ''}`}
      >
        <LogOut size={12} />
        {confirmLogout ? 'Tap again to sign out' : 'Sign out'}
      </button>

      {/* Sign-out blocked warning */}
      {blockMsg && (
        <div className="sb-warning">{blockMsg}</div>
      )}

      {/* Offline mode warning */}
      {!isOnline && (
        <div className="sb-warning">
          <AlertTriangle size={10} />
          OFFLINE — Sales queued, will sync on reconnect
        </div>
      )}

      {/* Auth-expired warning */}
      {isOnline && syncError === 'auth_expired' && pendingCount > 0 && (
        <div
          onClick={clearSyncError}
          title="Click to dismiss"
          className="sb-warning sb-warning--amber"
        >
          <AlertTriangle size={10} />
          Session expired — sign out and log in again to sync {pendingCount} pending sale{pendingCount !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
