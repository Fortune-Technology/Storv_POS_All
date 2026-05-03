/**
 * UpdatePill — compact in-shift update affordance for the StatusBar.
 *
 * Auto-hides when there's nothing to do (idle / checking / no-update).
 * Shows up the moment electron-updater reports an available / downloading /
 * ready / error status so the cashier can act on it without signing out.
 *
 * Renders nothing in non-Electron contexts.
 */

import { Download, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { useUpdaterState } from '../hooks/useUpdaterState.js';
import './UpdatePill.css';

export default function UpdatePill() {
  const { state, isActionable } = useUpdaterState();

  // Hide entirely when there's nothing actionable. Cashiers in mid-shift
  // shouldn't see an "everything's fine" pill — only act-now states surface.
  if (!state || !isActionable) return null;

  const handleClick = async () => {
    try {
      if (state.status === 'available')   await window.electronAPI?.updaterDownload();
      else if (state.status === 'ready')  await window.electronAPI?.updaterInstall();
      else if (state.status === 'error')  await window.electronAPI?.updaterCheck();
    } catch { /* state already reflects via IPC */ }
  };

  const cfg = (() => {
    switch (state.status) {
      case 'available':
        return {
          variant: 'available',
          Icon:    Download,
          label:   state.version ? `Update ${state.version}` : 'Update available',
          title:   'A new version is available — tap to download',
          spin:    false,
        };
      case 'downloading':
        return {
          variant: 'downloading',
          Icon:    RefreshCw,
          label:   `Downloading ${Math.round(state.progress?.percent || 0)}%`,
          title:   'Update is downloading…',
          spin:    true,
        };
      case 'ready':
        return {
          variant: 'ready',
          Icon:    CheckCircle2,
          label:   'Restart to update',
          title:   'Update downloaded — tap to relaunch + install',
          spin:    false,
        };
      case 'error':
      default:
        return {
          variant: 'error',
          Icon:    AlertCircle,
          label:   'Update failed',
          title:   state.error || 'Update check failed — tap to retry',
          spin:    false,
        };
    }
  })();

  const { variant, Icon, label, title, spin } = cfg;
  const disabled = state.status === 'downloading';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`sb-update-pill sb-update-pill--${variant}`}
    >
      <Icon size={11} className={spin ? 'sb-update-pill-icon--spin' : ''} />
      <span className="sb-update-pill-label">{label}</span>
    </button>
  );
}
