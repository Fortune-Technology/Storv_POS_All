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
        quickFolders: r.data.quickFolders || DEFAULT_POS_CONFIG.quickFolders,
        vendorTenderMethods: r.data.vendorTenderMethods || DEFAULT_POS_CONFIG.vendorTenderMethods,
        hardware: {
          ...DEFAULT_POS_CONFIG.hardware,
          ...(r.data.hardware || {}),
          receiptPrinter: { ...DEFAULT_POS_CONFIG.hardware.receiptPrinter, ...(r.data.hardware?.receiptPrinter || {}) },
          labelPrinter:   { ...DEFAULT_POS_CONFIG.hardware.labelPrinter,   ...(r.data.hardware?.labelPrinter   || {}) },
          scale:          { ...DEFAULT_POS_CONFIG.hardware.scale,          ...(r.data.hardware?.scale          || {}) },
          paxTerminal:    { ...DEFAULT_POS_CONFIG.hardware.paxTerminal,    ...(r.data.hardware?.paxTerminal    || {}) },
          cashDrawer:     { ...DEFAULT_POS_CONFIG.hardware.cashDrawer,     ...(r.data.hardware?.cashDrawer     || {}) },
        },
      }))
      .catch(() => {}); // silently use defaults
  }, [storeId]);

  return config;
}
