/**
 * UpdateBadge
 * Lives on the PIN login screen. One-click access to:
 *   • Check for updates
 *   • Download (when one is available)
 *   • Install (when download is complete — relaunches app)
 *
 * Renders nothing in non-Electron contexts (browser dev / PWA mode).
 */

import { useEffect, useState } from 'react';
import { Download, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import './UpdateBadge.css';

const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.updaterGetState;

export default function UpdateBadge() {
  const [state, setState] = useState({
    status: 'idle', message: '', current: '', version: null, progress: null, error: null,
  });

  useEffect(() => {
    if (!isElectron) return;
    let unsubscribe = null;
    window.electronAPI.updaterGetState().then(setState).catch(() => {});
    unsubscribe = window.electronAPI.onUpdaterState((s) => setState(s));
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  if (!isElectron) return null;

  const handleClick = async () => {
    try {
      if (state.status === 'available') {
        await window.electronAPI.updaterDownload();
      } else if (state.status === 'ready') {
        await window.electronAPI.updaterInstall();
      } else {
        await window.electronAPI.updaterCheck();
      }
    } catch {
      /* state already reflects error via the IPC channel */
    }
  };

  const labelMap = {
    idle:        'Check for Updates',
    checking:    'Checking…',
    available:   `Download Update${state.version ? ` (${state.version})` : ''}`,
    'no-update': 'Check for Updates',
    downloading: state.progress
      ? `Downloading ${Math.round(state.progress.percent)}%`
      : 'Downloading…',
    ready:       'Restart & Install',
    error:       'Retry Update Check',
  };

  const Icon = (() => {
    switch (state.status) {
      case 'available':   return Download;
      case 'downloading': return RefreshCw;
      case 'ready':       return CheckCircle2;
      case 'error':       return AlertCircle;
      default:            return RefreshCw;
    }
  })();

  const busy = state.status === 'checking' || state.status === 'downloading';
  const variant = state.status === 'ready'      ? 'ready'
                : state.status === 'available'  ? 'available'
                : state.status === 'error'      ? 'error'
                : 'default';

  return (
    <div className={`update-badge update-badge--${variant}`}>
      <button
        type="button"
        className="update-badge-btn"
        onClick={handleClick}
        disabled={busy}
      >
        <Icon size={16} className={busy ? 'update-badge-icon--spin' : 'update-badge-icon'} />
        <span>{labelMap[state.status] || labelMap.idle}</span>
      </button>
      {state.status === 'no-update' && (
        <span className="update-badge-hint">You're on v{state.current} — the latest.</span>
      )}
      {state.status === 'error' && state.error && (
        <span className="update-badge-hint update-badge-hint--err">{state.error}</span>
      )}
      {state.status === 'downloading' && state.progress && (
        <div className="update-badge-progress">
          <div
            className="update-badge-progress-bar"
            style={{ width: `${Math.round(state.progress.percent || 0)}%` }}
          />
        </div>
      )}
      {state.current && (
        <span className="update-badge-version">v{state.current}</span>
      )}
    </div>
  );
}
