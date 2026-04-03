/**
 * useSetupStatus
 *
 * Checks the org's readiness in a single call.
 * Returns an object that every page can use to show contextual guidance.
 *
 * Stages:
 *   0 — no stores yet          → catalog is "offline" (products saved but not live)
 *   1 — has stores, no catalog  → catalog needs products
 *   2 — has stores + products   → operational; show store inventory guidance
 *   3 — fully set up            → nothing to prompt
 */

import { useState, useEffect, useCallback } from 'react';
import { getStores } from '../services/api';
import { getCatalogProducts, getCatalogDepartments } from '../services/api';

export function useSetupStatus() {
  const [status, setStatus] = useState({
    loading:     true,
    stores:      [],       // Store[]
    storeCount:  0,
    productCount:0,
    deptCount:   0,
    hasStores:   false,
    hasProducts: false,
    hasDepts:    false,
    stage:       -1,       // -1 = loading
  });

  const refresh = useCallback(async () => {
    try {
      const [storesRes, productsRes, deptsRes] = await Promise.all([
        getStores().catch(() => []),
        getCatalogProducts({ limit: 1 }).catch(() => null),
        getCatalogDepartments({ limit: 1 }).catch(() => []),
      ]);

      const stores      = (storesRes?.data || storesRes) ?? [];
      const productMeta = productsRes?.data || productsRes;
      const productCount= productMeta?.total ?? (Array.isArray(productMeta) ? productMeta.length : 0);
      const depts       = (deptsRes?.data || deptsRes) ?? [];

      const hasStores   = stores.length > 0;
      const hasProducts = productCount > 0;
      const hasDepts    = depts.length  > 0;

      const stage =
        !hasStores   ? 0 :   // no stores
        !hasProducts ? 1 :   // has stores, no catalog
        2;                   // operational

      setStatus({
        loading: false,
        stores,
        storeCount:   stores.length,
        productCount,
        deptCount:    depts.length,
        hasStores,
        hasProducts,
        hasDepts,
        stage,
      });
    } catch {
      setStatus(s => ({ ...s, loading: false, stage: 0 }));
    }
  }, []);

  useEffect(() => { refresh(); }, []);

  return { ...status, refresh };
}
