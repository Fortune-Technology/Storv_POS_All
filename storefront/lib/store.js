/**
 * Store context — provides branding, config, and store slug
 * to all pages and components.
 */

import { createContext, useContext } from 'react';

const StoreContext = createContext(null);

export function StoreProvider({ store, children }) {
  return (
    <StoreContext.Provider value={store}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  return useContext(StoreContext);
}
