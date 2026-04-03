/**
 * Fetches the POS layout config for this station's store.
 * Falls back to DEFAULT_POS_CONFIG if server unreachable.
 */
import { useState, useEffect } from 'react';
import { useStationStore } from '../stores/useStationStore.js';
import api from '../api/client.js';

export const DEFAULT_POS_CONFIG = {
  layout: 'modern',           // 'modern' | 'express' | 'classic' | 'minimal' | 'counter'
  showDepartments: true,
  showQuickAdd: true,
  numpadEnabled: true,
  cartSide: 'right',          // 'right' (default) | 'left'
  cashRounding: 'none',       // 'none' | '0.05'  (round cash change to nearest $0.05)
  shortcuts: {
    priceCheck: true,
    hold: true,
    reprint: false,
    noSale: true,
    discount: true,
    refund: true,
    voidTx: true,
    endOfDay: true,
  },
  quickTender: ['card', 'cash', 'ebt'],
};

export function usePOSConfig() {
  const storeId = useStationStore(s => s.station?.storeId);
  const [config, setConfig] = useState(DEFAULT_POS_CONFIG);

  useEffect(() => {
    if (!storeId) return;
    api.get('/pos-terminal/config', { params: { storeId } })
      .then(r => setConfig({
        ...DEFAULT_POS_CONFIG,
        ...r.data,
        shortcuts: {
          ...DEFAULT_POS_CONFIG.shortcuts,
          ...(r.data.shortcuts || {}),
        },
      }))
      .catch(() => {}); // silently use defaults
  }, [storeId]);

  return config;
}
