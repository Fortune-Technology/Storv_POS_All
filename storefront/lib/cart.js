/**
 * Cart state management — React Context + localStorage.
 *
 * Provides cart state to all components. Persists to localStorage
 * and syncs to the ecom-backend server (debounced, non-blocking).
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { updateCart as syncCartToServer } from './api';

const CartContext = createContext(null);

const STORAGE_KEY = 'storv-cart';
const SYNC_DEBOUNCE_MS = 1500;

function loadFromStorage() {
  if (typeof window === 'undefined') return { items: [], sessionId: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        items: Array.isArray(parsed.items) ? parsed.items : [],
        sessionId: parsed.sessionId || null,
      };
    }
  } catch {}
  return { items: [], sessionId: null };
}

function saveToStorage(items, sessionId) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, sessionId }));
  } catch {}
}

function generateSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const syncTimer = useRef(null);
  const storeSlug = typeof window !== 'undefined' ?
    new URLSearchParams(window.location.search).get('store') || 'demo' : 'demo';

  // Load from localStorage on mount
  useEffect(() => {
    const saved = loadFromStorage();
    setItems(saved.items);
    setSessionId(saved.sessionId);
  }, []);

  // Persist + sync on changes
  useEffect(() => {
    if (items.length === 0 && !sessionId) return;
    saveToStorage(items, sessionId);

    // Debounced server sync
    if (syncTimer.current) clearTimeout(syncTimer.current);
    if (sessionId && items.length > 0) {
      syncTimer.current = setTimeout(() => {
        syncCartToServer(storeSlug, sessionId, items).catch(() => {});
      }, SYNC_DEBOUNCE_MS);
    }
  }, [items, sessionId, storeSlug]);

  const ensureSession = useCallback(() => {
    if (sessionId) return sessionId;
    const newId = generateSessionId();
    setSessionId(newId);
    return newId;
  }, [sessionId]);

  const addItem = useCallback((product, qty = 1) => {
    ensureSession();
    setItems(prev => {
      const existing = prev.find(i => i.productId === product.id);
      if (existing) {
        return prev.map(i =>
          i.productId === product.id
            ? { ...i, qty: i.qty + qty }
            : i
        );
      }
      return [...prev, {
        productId: product.id,
        posProductId: product.posProductId || product.id,
        name: product.name,
        price: Number(product.salePrice || product.retailPrice),
        imageUrl: product.imageUrl || null,
        slug: product.slug,
        qty,
      }];
    });
  }, [ensureSession]);

  const updateQty = useCallback((productId, qty) => {
    if (qty <= 0) {
      setItems(prev => prev.filter(i => i.productId !== productId));
    } else {
      setItems(prev => prev.map(i =>
        i.productId === productId ? { ...i, qty } : i
      ));
    }
  }, []);

  const removeItem = useCallback((productId) => {
    setItems(prev => prev.filter(i => i.productId !== productId));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setSessionId(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const cartCount = items.reduce((sum, i) => sum + i.qty, 0);
  const cartTotal = items.reduce((sum, i) => sum + (i.price * i.qty), 0);

  return (
    <CartContext.Provider value={{
      items,
      sessionId,
      cartCount,
      cartTotal,
      addItem,
      updateQty,
      removeItem,
      clearCart,
      drawerOpen,
      setDrawerOpen,
      storeSlug,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
