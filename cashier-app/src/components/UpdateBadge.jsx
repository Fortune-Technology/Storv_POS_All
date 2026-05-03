/**
 * UpdateBadge
 * Lives on the PIN login screen. Renders ONLY when an update is actually
 * actionable (available / downloading / ready / error). Idle / checking /
 * no-update states render nothing — the cashier sees a clean PIN screen
 * unless there's something to act on.
 *
 * Renders nothing in non-Electron contexts (browser dev / PWA mode).
 */

import { Download, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { useUpdaterState } from '../hooks/useUpdaterState.js';
import './UpdateBadge.css';

export default function UpdateBadge() {
  const { state, isActionable } = useUpdaterState();

  // No state yet (non-Electron / loading) OR nothing to do → render nothing.
  if (!state || !isActionable) return null;

  const handleClick = async () => {
    try {
      if (state.status === 'available') {
        await window.electronAPI?.updaterDownload();
      } else if (state.status === 'ready') {
        await window.electronAPI?.updaterInstall();
      } else if (state.status === 'error') {
        await window.electronAPI?.updaterCheck();
      } else if (state.status === 'downloading') {
        /* in progress — no-op */
      }
    } catch {
      /* state already reflects error via the IPC channel */
    }
  };

  const labelMap = {
    available:   `Download Update${state.version ? ` (${state.version})` : ''}`,
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

  const busy = state.status === 'downloading';
  const variant = state.status; // 'available' | 'downloading' | 'ready' | 'error'

  return (
    <div className={`update-badge update-badge--${variant}`}>
      <button
        type="button"
        className="update-badge-btn"
        onClick={handleClick}
        disabled={busy}
      >
        <Icon size={16} className={busy ? 'update-badge-icon--spin' : 'update-badge-icon'} />
        <span>{labelMap[state.status]}</span>
      </button>
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
    </div>
  );
}
