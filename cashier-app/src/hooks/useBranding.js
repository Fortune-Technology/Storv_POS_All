/**
 * Fetches and applies store branding on login, then polls every 5 min.
 * Branding is applied by mutating CSS custom properties on :root.
 */

import { useEffect } from 'react';
import { useStationStore } from '../stores/useStationStore.js';
import { getPosBranding } from '../api/pos.js';
import { applyBranding, loadCachedBranding } from '../utils/branding.js';

const POLL_MS = 5 * 60 * 1000; // 5 min

/**
 * Fetches and applies store branding for the paired station.
 *
 * Reads storeId from the persisted station (not the cashier session) so
 * branding applies on the StationSetup / PinLogin screens too — before
 * any PIN entry. Synchronous cache restore happens at module import in
 * branding.js; this hook keeps the cache fresh from the API.
 */
export function useBranding() {
  const station = useStationStore(s => s.station);

  useEffect(() => {
    const storeId = station?.storeId;
    if (!storeId) return; // station not paired yet — keep cached defaults

    const apply = async () => {
      try {
        const config = await getPosBranding(storeId);
        applyBranding(config);
      } catch {
        // Network error — keep last cached branding (no fallback to defaults
        // so we don't flash dark when the API is briefly unavailable).
        const cached = loadCachedBranding();
        if (cached) applyBranding(cached);
      }
    };

    apply();
    const id = setInterval(apply, POLL_MS);
    return () => clearInterval(id);
  }, [station?.storeId]);
}
