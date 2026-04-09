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
    if (hit) return hit;
  }
  for (const v of variants) {
    const hit = await db.products
      .where('upc').equals(v)
      .and(p => p.active !== false)
      .first();
    if (hit) return hit;
  }
  return null;
}

export async function searchProducts(query, storeId, limit = 30) {
  const q = query.trim().toLowerCase();
  return db.products
    .filter(p =>
      (p.storeId === storeId || !p.storeId) &&
      p.active !== false &&
      (p.name?.toLowerCase().includes(q) ||
       p.brand?.toLowerCase().includes(q) ||
       p.upc?.includes(q))
    )
    .limit(limit)
    .toArray();
}

export async function upsertProducts(products) {
  await db.products.bulkPut(products);
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
