/**
 * Cart state management — React Context + localStorage.
 *
 * Provides cart state to all components. Persists to localStorage
 * and syncs to the ecom-backend server (debounced, non-blocking).
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { updateCart as syncCartToServer } from './api';
import type { CartItem, Product } from './types';

interface CartContextValue {
  items: CartItem[];
  sessionId: string | null;
  cartCount: number;
  cartTotal: number;
  addItem: (product: Product, qty?: number) => void;
  updateQty: (productId: string, qty: number) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  storeSlug: string;
}

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = 'storv-cart';
const SYNC_DEBOUNCE_MS = 1500;

interface PersistedCart {
  items: CartItem[];
  sessionId: string | null;
}

function loadFromStorage(): PersistedCart {
  if (typeof window === 'undefined') return { items: [], sessionId: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedCart>;
      return {
        items: Array.isArray(parsed.items) ? parsed.items : [],
        sessionId: parsed.sessionId || null,
      };
    }
  } catch {
    // Ignore corrupted localStorage
  }
  return { items: [], sessionId: null };
}

function saveToStorage(items: CartItem[], sessionId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, sessionId }));
  } catch {
    // Ignore quota errors
  }
}

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

interface CartProviderProps {
  children: ReactNode;
}

export function CartProvider({ children }: CartProviderProps) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storeSlug: string =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('store') || 'demo'
      : 'demo';

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
        syncCartToServer(storeSlug, sessionId, items).catch(() => {
          // Non-blocking — we retry on next mutation
        });
      }, SYNC_DEBOUNCE_MS);
    }
  }, [items, sessionId, storeSlug]);

  const ensureSession = useCallback((): string => {
    if (sessionId) return sessionId;
    const newId = generateSessionId();
    setSessionId(newId);
    return newId;
  }, [sessionId]);

  const addItem = useCallback(
    (product: Product, qty: number = 1): void => {
      ensureSession();
      setItems((prev) => {
        const existing = prev.find((i) => i.productId === product.id);
        if (existing) {
          return prev.map((i) =>
            i.productId === product.id ? { ...i, qty: i.qty + qty } : i
          );
        }
        return [
          ...prev,
          {
            productId: product.id,
            posProductId: product.posProductId || product.id,
            name: product.name,
            price: Number(product.salePrice ?? product.retailPrice),
            imageUrl: product.imageUrl || null,
            slug: product.slug,
            qty,
          },
        ];
      });
    },
    [ensureSession]
  );

  const updateQty = useCallback((productId: string, qty: number): void => {
    if (qty <= 0) {
      setItems((prev) => prev.filter((i) => i.productId !== productId));
    } else {
      setItems((prev) =>
        prev.map((i) => (i.productId === productId ? { ...i, qty } : i))
      );
    }
  }, []);

  const removeItem = useCallback((productId: string): void => {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  }, []);

  const clearCart = useCallback((): void => {
    setItems([]);
    setSessionId(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const cartCount = items.reduce((sum, i) => sum + i.qty, 0);
  const cartTotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);

  return (
    <CartContext.Provider
      value={{
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
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
