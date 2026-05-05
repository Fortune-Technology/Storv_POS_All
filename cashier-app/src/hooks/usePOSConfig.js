/**
 * Fetches the POS layout config for this station's store.
 * Falls back to DEFAULT_POS_CONFIG if server unreachable.
 */
import { useState, useEffect } from 'react';
import { useStationStore } from '../stores/useStationStore.js';
import api from '../api/client.js';

export const DEFAULT_POS_CONFIG = {
  layout: 'modern',           // 'modern' | 'express' | 'classic' | 'minimal' | 'counter'
  // Per-station layout overrides. Keys are Station IDs, values are one of
  // the layout preset keys above. When a station id is present in this map,
  // it overrides the store-level `layout` for that register only. Cashiers
  // at stations NOT in this map fall back to the store `layout`. The admin
  // sets this in POS Settings → Layout Preset (Back-office).
  stationLayouts: {},
  showDepartments: true,
  showQuickAdd: true,
  numpadEnabled: true,
  ageVerification: true,
  cartSide: 'right',          // 'right' (default) | 'left'
  cashRounding: 'none',       // 'none' | '0.05'  (round cash change to nearest $0.05)
  actionBarHeight: 'normal',   // 'compact' (48px) | 'normal' (58px) | 'large' (72px)
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
  bagFee: {
    enabled:      true,
    pricePerBag:  0.05,
    ebtEligible:  false,
    discountable: false,
  },
  lottery: {
    enabled:               true,
    cashOnly:              false,
    scanRequiredAtShiftEnd: false,
  },
  // Store-level age verification policy. Overrides per-product `ageRequired`
  // for items whose taxClass matches. Configurable in back-office Store Settings.
  ageLimits: {
    tobacco: 21,
    alcohol: 21,
  },
  // C3 (S79) — customer-facing display theme. POSScreen broadcasts this on
  // every cart_update; CustomerDisplayScreen applies a `cds-root--light`
  // modifier class to override its CSS variables when 'light'. Default
  // 'dark' preserves the existing across-counter look.
  customerDisplay: {
    theme: 'dark',  // 'dark' | 'light'
  },
  // Manufacturer-coupon redemption thresholds (Session 46). When any limit is
  // exceeded by a single coupon or the cumulative cart, the cashier must enter
  // the manager PIN before the coupon is applied.
  couponMaxValueWithoutMgr: 5,    // single-coupon $ ceiling
  couponMaxTotalWithoutMgr: 10,   // cumulative-tx coupon $ ceiling
  couponMaxCountWithoutMgr: 5,    // coupon-count-per-tx ceiling
  // Session 50/51 — Dual Pricing / Cash Discount config. Populated by the
  // backend's getPOSConfig handler from the Store + State + PricingTier rows.
  // Default ('interchange', no surcharge) preserves existing-store behavior.
  dualPricing: {
    pricingModel:            'interchange',  // 'interchange' | 'dual_pricing'
    customSurchargePercent:  null,
    customSurchargeFixedFee: null,
    dualPricingDisclosure:   null,
    refundSurcharge:         false,          // Session 52 — refund-includes-surcharge policy
    pricingTier:             null,           // { key, name, surchargePercent, surchargeFixedFee }
    state:                   null,           // { code, surchargeTaxable, maxSurchargePercent, dualPricingAllowed, pricingFraming, surchargeDisclosureText }
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
      // If true, this station polls the backend queue and prints routed ZPL
      // jobs via Zebra Browser Print (local). Required when the portal is
      // served from a public HTTPS origin (Chrome LNA block).
      acceptRoutedJobs: false,
      // Preferred Zebra Browser Print printer name. Empty = use first available.
      zebraName: '',
    },
    scale: {
      type:      'none',    // 'cas' | 'mettler' | 'avery' | 'datalogic' | 'generic' | 'none'
      connection:'serial',  // 'serial' (USB Web Serial) | 'tcp' (Serial-over-LAN)
      baud:      9600,
      ip:        '',        // for TCP/Serial-over-LAN connection
      port:      4001,      // TCP port (common for serial-to-ethernet adapters)
      portLabel: '',        // display label
      weightUnit:'lbs',     // 'lbs' | 'kg'
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
    stationLayouts: {
      ...(defaults.stationLayouts || {}),
      ...(data.stationLayouts || {}),
    },
    shortcuts: {
      ...defaults.shortcuts,
      ...(data.shortcuts || {}),
    },
    vendorTenderMethods: data.vendorTenderMethods || defaults.vendorTenderMethods,
    bagFee: {
      ...defaults.bagFee,
      ...(data.bagFee || {}),
    },
    lottery: {
      ...defaults.lottery,
      ...(data.lottery || {}),
    },
    ageLimits: {
      ...defaults.ageLimits,
      ...(data.ageLimits || {}),
    },
    // Session 50/51 — Deep-merge so partial server payloads don't wipe nested
    // pricingTier / state objects. When server sends a fresh dualPricing block
    // (always populated by getPOSConfig) it fully replaces the nested objects;
    // when missing (legacy server) we keep the interchange default.
    dualPricing: data.dualPricing
      ? {
          ...defaults.dualPricing,
          ...data.dualPricing,
          pricingTier: data.dualPricing.pricingTier || null,
          state:       data.dualPricing.state || null,
        }
      : defaults.dualPricing,
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
