/**
 * Fetches and applies store branding on login, then polls every 5 min.
 * Branding is applied by mutating CSS custom properties on :root.
 */

import { useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore.js';
import { getPosBranding } from '../api/pos.js';
import { applyBranding, DEFAULT_BRANDING } from '../utils/branding.js';

const POLL_MS = 5 * 60 * 1000; // 5 min

export function useBranding() {
  const cashier = useAuthStore(s => s.cashier);

  useEffect(() => {
    const storeId = cashier?.storeId;

    const apply = async () => {
      if (!storeId) { applyBranding(DEFAULT_BRANDING); return; }
      try {
        const config = await getPosBranding(storeId);
        applyBranding(config);
      } catch {
        applyBranding(DEFAULT_BRANDING);
      }
    };

    apply();
    const id = setInterval(apply, POLL_MS);
    return () => clearInterval(id);
  }, [cashier?.storeId]);
}
