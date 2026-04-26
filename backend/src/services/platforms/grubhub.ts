/**
 * Grubhub Adapter — Stub
 * -----------------------
 * Placeholder until the Grubhub for Restaurants integration is built.
 * Every method returns a structured error so callers handle it gracefully.
 */

import type { PlatformAdapter } from './adapterInterface.js';

const STUB_MSG = 'Grubhub integration coming soon. Contact support.';

const grubhub: PlatformAdapter = {
  testConnection: async () => ({ ok: false, error: STUB_MSG }),
  syncInventory:  async () => ({ synced: 0, failed: 0, errors: [STUB_MSG] }),
  confirmOrder:   async () => ({ confirmed: false, error: STUB_MSG }),
  markReady:      async () => ({ success: false, error: STUB_MSG }),
  cancelOrder:    async () => ({ cancelled: false, error: STUB_MSG }),
  getMenu:        async () => ({ menu: null, error: STUB_MSG }),
  updateHours:    async () => ({ updated: false, error: STUB_MSG }),
};

export default grubhub;
