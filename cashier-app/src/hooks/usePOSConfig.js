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
  ageVerification: true,
  cartSide: 'right',          // 'right' (default) | 'left'
  cashRounding: 'none',       // 'none' | '0.05'  (round cash change to nearest $0.05)
  actionBarHeight: 'normal',   // 'compact' (48px) | 'normal' (58px) | 'large' (72px)
  quickFolders:    [],          // array of { id, name, emoji, color, sortOrder, items[] }
  shortcuts: {
    priceCheck: true,
    hold: true,
    history: true,
    reprint: false,
    noSale: true,
    discount: true,
    refund: true,
    voidTx: true,
    endOfDay: true,
    bottleReturn: true,
  },
  lottery: {
    enabled:               true,
    cashOnly:              false,
    scanRequiredAtShiftEnd: false,
  },
  quickTender: ['card', 'cash', 'ebt'],
  vendorTenderMethods: [
    { id: 'cash',          label: 'Cash',              enabled: true  },
    { id: 'cheque',        label: 'Cheque',             enabled: true  },
    { id: 'bank_transfer', label: 'Bank Transfer',      enabled: false },
    { id: 'credit_card',   label: 'Credit Card',        enabled: false },
    { id: 'interac',       label: 'Interac e-Transfer', enabled: false },
  ],
  hardware: {
    receiptPrinter: {
      type:   'none',       // 'qz' | 'network' | 'none'
      name:   '',           // QZ printer name
      ip:     '',           // For network printers
      port:   9100,
      width:  '80mm',       // '58mm' | '80mm'
    },
    labelPrinter: {
      type:   'none',       // 'zebra_zpl' | 'dymo' | 'none'
      name:   '',
      ip:     '',
      port:   9100,
    },
    scale: {
      type:      'none',    // 'cas' | 'mettler' | 'avery' | 'generic' | 'none'
      baud:      9600,
      portLabel: '',        // display label
    },
    paxTerminal: {
      enabled: false,
      model:   'A35',       // 'A30' | 'A35'
      ip:      '',
      port:    10009,
    },
    cashDrawer: {
      type:    'none',      // 'printer' | 'none'
    },
  },
};

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function mergeConfig(defaults, data) {
  return {
    ...defaults,
    ...data,
    shortcuts: {
      ...defaults.shortcuts,
      ...(data.shortcuts || {}),
    },
    quickFolders: data.quickFolders || defaults.quickFolders,
    vendorTenderMethods: data.vendorTenderMethods || defaults.vendorTenderMethods,
    lottery: {
      ...defaults.lottery,
      ...(data.lottery || {}),
    },
    hardware: {
      ...defaults.hardware,
      ...(data.hardware || {}),
      receiptPrinter: { ...defaults.hardware.receiptPrinter, ...(data.hardware?.receiptPrinter || {}) },
      labelPrinter:   { ...defaults.hardware.labelPrinter,   ...(data.hardware?.labelPrinter   || {}) },
      scale:          { ...defaults.hardware.scale,          ...(data.hardware?.scale          || {}) },
      paxTerminal:    { ...defaults.hardware.paxTerminal,    ...(data.hardware?.paxTerminal    || {}) },
      cashDrawer:     { ...defaults.hardware.cashDrawer,     ...(data.hardware?.cashDrawer     || {}) },
    },
  };
}

export function usePOSConfig() {
  const storeId = useStationStore(s => s.station?.storeId);
  const [config, setConfig] = useState(DEFAULT_POS_CONFIG);

  useEffect(() => {
    if (!storeId) return;

    const fetchConfig = () => {
      api.get('/pos-terminal/config', { params: { storeId } })
        .then(r => setConfig(mergeConfig(DEFAULT_POS_CONFIG, r.data)))
        .catch(() => {}); // silently use cached defaults
    };

    // Initial fetch
    fetchConfig();

    // Poll every 5 minutes (keeps PWA in sync without a full reload)
    const intervalId = setInterval(fetchConfig, POLL_INTERVAL_MS);

    // Re-fetch immediately when the tab becomes visible again (e.g. returning from background)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchConfig();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [storeId]);

  return config;
}
