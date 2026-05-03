/**
 * useUpdaterState — subscribe to electron-updater state from the renderer.
 *
 * Returns { state, isActionable } where isActionable === true only when
 * a user can do something useful (download / install / retry). Components
 * that conditionally render based on update activity should use this to
 * avoid mounting an empty container when nothing's happening.
 *
 * Returns { state: null, isActionable: false } in non-Electron contexts.
 */

import { useEffect, useState } from 'react';

const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.updaterGetState;
const ACTIONABLE = new Set(['available', 'downloading', 'ready', 'error']);

export function useUpdaterState() {
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!isElectron) return undefined;
    let unsubscribe = null;
    window.electronAPI.updaterGetState().then(setState).catch(() => {});
    unsubscribe = window.electronAPI.onUpdaterState((s) => setState(s));
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  return {
    state,
    isActionable: !!state && ACTIONABLE.has(state.status),
  };
}
