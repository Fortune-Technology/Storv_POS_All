/**
 * StoreContext — global active-store state
 *
 * Provides:
 *   stores        — all stores the current user can access
 *   activeStore   — the currently selected store object
 *   activeStoreId — its _id string (persisted in localStorage)
 *   switchStore   — call to change active store
 *   loading       — true while first fetch is in progress
 *   reload        — manually refetch store list
 *
 * The activeStoreId is written to localStorage so:
 *  1. It survives page refreshes
 *  2. api.js interceptor picks it up and sends X-Store-Id header on every request
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getStores } from '../services/api';

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [stores,        setStores]        = useState([]);
  const [activeStoreId, setActiveStoreId] = useState(
    () => localStorage.getItem('activeStoreId') || null
  );
  const [loading, setLoading] = useState(true);

  const loadStores = useCallback(async () => {
    // Only run when user is logged in
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (!user?.token) { setLoading(false); return; }

    try {
      const list = await getStores();
      setStores(list);

      // Auto-select first store if none is saved or saved one no longer exists
      const saved   = localStorage.getItem('activeStoreId');
      const exists  = list.some(s => s._id === saved);

      if (!exists && list.length > 0) {
        const firstId = list[0]._id;
        setActiveStoreId(firstId);
        localStorage.setItem('activeStoreId', firstId);
      }
    } catch {
      // User might not have a tenant yet — ignore
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadStores(); }, [loadStores]);

  const switchStore = (storeId) => {
    setActiveStoreId(storeId);
    localStorage.setItem('activeStoreId', storeId);
  };

  const activeStore = stores.find(s => s._id === activeStoreId) ?? stores[0] ?? null;

  return (
    <StoreContext.Provider value={{
      stores,
      activeStore,
      activeStoreId: activeStore?._id ?? null,
      switchStore,
      loading,
      reload: loadStores,
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export const useStore = () => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
};
