/**
 * Store context — provides branding, config, and store slug
 * to all pages and components.
 */

import { createContext, useContext, ReactNode } from 'react';
import type { Store } from './types';

const StoreContext = createContext<Store | null>(null);

interface StoreProviderProps {
  store: Store | null;
  children: ReactNode;
}

export function StoreProvider({ store, children }: StoreProviderProps) {
  return (
    <StoreContext.Provider value={store}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): Store | null {
  return useContext(StoreContext);
}
