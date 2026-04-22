/**
 * IndexedDB schema via Dexie.js
 * All offline data lives here.
 */

import Dexie from 'dexie';

export const db = new Dexie('FutureFoodsPOS');

db.version(1).stores({
  products:     '++id, upc, orgId, storeId, departmentId, updatedAt, active',
  taxRules:     '++id, orgId, storeId',
  depositRules: '++id, orgId',
  txQueue:      '++localId, status, createdAt, storeId, txNumber',
  txHistory:    'id, txNumber, storeId, cashierId, createdAt',
  syncMeta:     'key',
});

db.version(2).stores({
  products:          '++id, upc, orgId, storeId, departmentId, updatedAt, active',
  taxRules:          '++id, orgId, storeId',
  depositRules:      '++id, orgId',
  txQueue:           '++localId, status, createdAt, storeId, txNumber',
  txHistory:         'id, txNumber, storeId, cashierId, createdAt',
  syncMeta:          'key',
  heldTransactions:  '++id, storeId, heldAt',
  scanFrequency:     'productId, count, lastAt',
});

// Version 3: dedicated departments table so showInPOS + sortOrder are available in POS
db.version(3).stores({
  products:          '++id, upc, orgId, storeId, departmentId, updatedAt, active',
  taxRules:          '++id, orgId, storeId',
  depositRules:      '++id, orgId',
  txQueue:           '++localId, status, createdAt, storeId, txNumber',
  txHistory:         'id, txNumber, storeId, cashierId, createdAt',
  syncMeta:          'key',
  heldTransactions:  '++id, storeId, heldAt',
  scanFrequency:     'productId, count, lastAt',
  departments:       'id, orgId, active, sortOrder',
});

// Version 4: promotions sync
db.version(4).stores({
  products:          '++id, upc, orgId, storeId, departmentId, updatedAt, active',
  taxRules:          '++id, orgId, storeId',
  depositRules:      '++id, orgId',
  txQueue:           '++localId, status, createdAt, storeId, txNumber',
  txHistory:         'id, txNumber, storeId, cashierId, createdAt',
  syncMeta:          'key',
  heldTransactions:  '++id, storeId, heldAt',
  scanFrequency:     'productId, count, lastAt',
  departments:       'id, orgId, active, sortOrder',
  promotions:        'id, orgId, active, promoType',
});

// Version 5: offline cashier login cache
// cashiers.pinHash = SHA-256(raw PIN) — allows offline PIN verification
// without ever storing the plain PIN text
db.version(5).stores({
  products:          '++id, upc, orgId, storeId, departmentId, updatedAt, active',
  taxRules:          '++id, orgId, storeId',
  depositRules:      '++id, orgId',
  txQueue:           '++localId, status, createdAt, storeId, txNumber',
  txHistory:         'id, txNumber, storeId, cashierId, createdAt',
  syncMeta:          'key',
  heldTransactions:  '++id, storeId, heldAt',
  scanFrequency:     'productId, count, lastAt',
  departments:       'id, orgId, active, sortOrder',
  promotions:        'id, orgId, active, promoType',
  cashiers:          'id, orgId, storeId',
});

// ── helpers ────────────────────────────────────────────────────────────────

export async function getLastSync(key) {
  const row = await db.syncMeta.get(key);
  return row?.value || null;
}

export async function setLastSync(key, isoString) {
  await db.syncMeta.put({ key, value: isoString });
}

export async function lookupByUPC(upc, storeId) {
  if (!upc) return null;
  const { upcVariants } = await import('../utils/upc.js');
  const variants = upcVariants(upc);
  if (!variants.length) return null;

  // Try store-specific first across all variants, then fall back to any storeId
  for (const v of variants) {
    const hit = await db.products
      .where('upc').equals(v)
      .and(p => p.storeId === storeId && p.active !== false)
      .first();
    if (hit) return decorateProductWithDeptTaxClass(hit);
  }
  for (const v of variants) {
    const hit = await db.products
      .where('upc').equals(v)
      .and(p => p.active !== false)
      .first();
    if (hit) return decorateProductWithDeptTaxClass(hit);
  }
  return null;
}

export async function searchProducts(query, storeId, limit = 30) {
  const q = query.trim().toLowerCase();
  const results = await db.products
    .filter(p =>
      (p.storeId === storeId || !p.storeId) &&
      p.active !== false &&
      (p.name?.toLowerCase().includes(q) ||
       p.brand?.toLowerCase().includes(q) ||
       p.upc?.includes(q))
    )
    .limit(limit)
    .toArray();
  return Promise.all(results.map(decorateProductWithDeptTaxClass));
}

// ── Product → Department taxClass fallback ──────────────────────────────
// Tax precedence at the register (useCartStore.selectTotals):
//   1. Product.taxClass (explicit override on the product)
//   2. Department.taxClass (inherited — when product doesn't set one)
//   3. null → no rule matches → no tax (unless an "all" rule exists)
//
// Applied at read time rather than stored on the product so that editing a
// department's taxClass in the portal takes effect immediately on next scan
// (no per-product re-resolution needed). Keeps the cached product row
// untouched; the fallback is a derived view.
export async function decorateProductWithDeptTaxClass(product) {
  if (!product || product.taxClass) return product;
  if (!product.departmentId) return product;
  try {
    const dept = await db.departments.get(product.departmentId);
    if (dept?.taxClass) {
      return { ...product, taxClass: dept.taxClass };
    }
  } catch { /* no-op — return raw product */ }
  return product;
}

export async function upsertProducts(products) {
  await db.products.bulkPut(products);
}

// Remove products from the local cache by id. Used to apply tombstones from
// the snapshot endpoint when products are soft-deleted or deactivated in the
// back office. Without this, deleted products linger in the local cache forever
// because the snapshot just stops returning them — there's no implicit "delete"
// signal in upsert-only sync.
export async function deleteProducts(ids) {
  if (!ids?.length) return;
  await db.products.bulkDelete(ids);
}

// Reconcile the local products table against the authoritative list of active
// product IDs from the backend. Any local row whose id is NOT in the active
// set is removed. Complement to the tombstone stream — the tombstone stream
// only covers products updated since the last sync, while this reconciliation
// covers the "cashier has been offline for weeks / cleared Dexie and re-seeded
// across multiple import batches" case. Called on every sign-in so the local
// cache never drifts.
//
// Returns the number of stale rows removed.
export async function reconcileProducts(activeIds) {
  if (!Array.isArray(activeIds)) return 0;
  const activeSet = new Set(activeIds);
  const localIds = await db.products.toCollection().primaryKeys();
  const stale = localIds.filter(id => !activeSet.has(id));
  if (stale.length) await db.products.bulkDelete(stale);
  return stale.length;
}

export async function enqueueTransaction(tx) {
  return db.txQueue.add({ ...tx, status: 'pending', createdAt: new Date().toISOString() });
}

export async function getPendingTransactions() {
  return db.txQueue.where('status').equals('pending').toArray();
}

export async function markTransactionSynced(localId) {
  await db.txQueue.update(localId, { status: 'synced' });
}

export async function getHeldTransactions(storeId) {
  if (storeId) {
    return db.heldTransactions.where('storeId').equals(storeId).sortBy('heldAt');
  }
  return db.heldTransactions.orderBy('heldAt').toArray();
}

export async function deleteHeldTransaction(id) {
  return db.heldTransactions.delete(id);
}

export async function getFrequentProducts(limit = 12) {
  const freq = await db.scanFrequency.orderBy('count').reverse().limit(limit * 2).toArray();
  const ids  = freq.map(f => f.productId);
  if (!ids.length) {
    // Fallback: return first N active products from catalog
    return db.products.filter(p => p.active !== false).limit(limit).toArray();
  }
  const products = await db.products
    .where('id').anyOf(ids)
    .filter(p => p.active !== false)
    .toArray();
  // Sort by scan frequency order
  const idxMap = Object.fromEntries(ids.map((id, i) => [id, i]));
  return products.sort((a, b) => (idxMap[a.id] ?? 999) - (idxMap[b.id] ?? 999)).slice(0, limit);
}

export async function upsertDepartments(depts) {
  await db.departments.bulkPut(depts);
}

// Replace the entire departments table with the supplied list. Used by the
// catalog sync to handle deletions — since departments come back as a small
// full list (not paginated), the simplest correctness fix is wipe + replace.
export async function replaceDepartments(depts) {
  await db.transaction('rw', db.departments, async () => {
    await db.departments.clear();
    if (depts?.length) await db.departments.bulkPut(depts);
  });
}

export async function getDepartments() {
  // Prefer the dedicated departments table (includes showInPOS, sortOrder, active)
  const stored = await db.departments
    .filter(d => d.active !== false)
    .sortBy('sortOrder');
  if (stored.length > 0) return stored;

  // Fallback: derive from product rows (no showInPOS — used before first sync)
  const products = await db.products.filter(p => p.active !== false).toArray();
  const map = new Map();
  for (const p of products) {
    if (p.departmentId && p.departmentName && !map.has(p.departmentId)) {
      map.set(p.departmentId, { id: p.departmentId, name: p.departmentName, showInPOS: true });
    }
  }
  return [...map.values()];
}

export async function getProductsByDepartment(departmentId, limit = 60) {
  return db.products
    .where('departmentId').equals(departmentId)
    .filter(p => p.active !== false)
    .limit(limit)
    .toArray();
}

export async function upsertPromotions(promos) {
  await db.promotions.bulkPut(promos);
}

// Replace the entire promotions table — same rationale as replaceDepartments.
export async function replacePromotions(promos) {
  await db.transaction('rw', db.promotions, async () => {
    await db.promotions.clear();
    if (promos?.length) await db.promotions.bulkPut(promos);
  });
}

export async function getActivePromotions() {
  const now = Date.now();
  return db.promotions.filter(p => {
    if (!p.active) return false;
    if (p.startDate && new Date(p.startDate).getTime() > now) return false;
    if (p.endDate   && new Date(p.endDate).getTime()   < now) return false;
    return true;
  }).toArray();
}

// ── Offline cashier cache ──────────────────────────────────────────────────
// cashierData should include: id, name, role, storeId, orgId, token, pinHash
export async function cacheCashierLocally(cashierData) {
  await db.cashiers.put({ ...cashierData, cachedAt: new Date().toISOString() });
}

// Find a cashier whose pinHash matches the SHA-256 of the entered PIN
export async function findCashierByPinHash(pinHash) {
  return db.cashiers.filter(c => c.pinHash === pinHash).first();
}

// Count locally cached products (for offline status display)
export async function countCachedProducts() {
  return db.products.filter(p => p.active !== false).count();
}
