/**
 * useQuickButtonLayout
 *
 * Loads the per-store quick-button layout (built in the portal
 * WYSIWYG) and refreshes it on a 5-min poll + on tab visibility. Mirrors
 * the sync pattern used by `usePOSConfig.js` so admin edits propagate
 * without requiring a cashier to restart the app.
 *
 * Returns `{ layout, loading, loaded, refresh }` where `layout.tree` is
 * the flat tile array and `layout.gridCols` is the column count
 * (default 6). `loaded` flips to true after the first fetch completes
 * (success OR failure) so callers can distinguish the initial empty
 * default from a confirmed empty layout — critical for the POS tab
 * default-view logic.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getQuickButtonLayout } from '../api/pos.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const EMPTY_LAYOUT = { tree: [], gridCols: 6, rowHeight: 56, name: 'Main Screen' };

export function useQuickButtonLayout(storeId) {
  const [layout, setLayout]   = useState(EMPTY_LAYOUT);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded]   = useState(false);
  const mountedRef = useRef(true);

  const fetch = useCallback(async () => {
    if (!storeId) { setLayout(EMPTY_LAYOUT); return; } // don't mark loaded — we haven't actually checked
    setLoading(true);
    try {
      const data = await getQuickButtonLayout(storeId);
      if (!mountedRef.current) return;
      setLayout({
        tree:      Array.isArray(data?.tree) ? data.tree : [],
        gridCols:  data?.gridCols  || 6,
        rowHeight: data?.rowHeight || 56,
        name:      data?.name      || 'Main Screen',
      });
    } catch (err) {
      // 404 is fine — no layout yet
      if (err?.response?.status !== 404) {
        console.warn('useQuickButtonLayout fetch failed:', err.message);
      }
      setLayout(EMPTY_LAYOUT);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setLoaded(true);
      }
    }
  }, [storeId]);

  useEffect(() => {
    mountedRef.current = true;
    fetch();

    const iv = setInterval(fetch, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetch();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      mountedRef.current = false;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetch]);

  return { layout, loading, loaded, refresh: fetch };
}
