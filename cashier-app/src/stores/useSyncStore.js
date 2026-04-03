import { create } from 'zustand';
import { db, enqueueTransaction, getPendingTransactions, markTransactionSynced } from '../db/dexie.js';
import { batchSubmitTransactions } from '../api/pos.js';

export const useSyncStore = create((set, get) => ({
  isOnline:       navigator.onLine,
  pendingCount:   0,
  isSyncing:      false,       // transaction queue sync
  lastSyncAt:     null,

  // Catalog sync state (product/price refresh)
  catalogSyncing: false,
  catalogSyncedAt: null,       // ISO string, set after successful catalog sync

  setOnline:          (v)  => set({ isOnline: v }),
  setCatalogSyncing:  (v)  => set({ catalogSyncing: v }),
  setCatalogSyncedAt: (ts) => set({ catalogSyncedAt: ts }),

  // Load pending count from IndexedDB on startup
  loadPendingCount: async () => {
    const rows = await getPendingTransactions();
    set({ pendingCount: rows.length });
  },

  // Add a completed transaction to the offline queue
  enqueue: async (txPayload) => {
    await enqueueTransaction(txPayload);
    set(s => ({ pendingCount: s.pendingCount + 1 }));
    // Try to sync immediately if online
    if (get().isOnline) get().drainQueue();
  },

  // Drain offline queue → server
  drainQueue: async () => {
    if (get().isSyncing) return;
    const pending = await getPendingTransactions();
    if (!pending.length) return;

    set({ isSyncing: true });
    try {
      const result = await batchSubmitTransactions(pending);
      for (const r of result.results || []) {
        await markTransactionSynced(r.localId);
      }
      const remaining = await getPendingTransactions();
      set({ pendingCount: remaining.length, lastSyncAt: new Date().toISOString() });
    } catch {
      // Will retry on next interval
    } finally {
      set({ isSyncing: false });
    }
  },
}));
