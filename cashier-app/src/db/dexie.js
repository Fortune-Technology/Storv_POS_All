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
  // Try store-specific first, fall back to any storeId
  const exact = await db.products
    .where('upc').equals(upc)
    .and(p => p.storeId === storeId && p.active !== false)
    .first();
  if (exact) return exact;
  return db.products
    .where('upc').equals(upc)
    .and(p => p.active !== false)
    .first();
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

export async function getDepartments() {
  const products = await db.products.filter(p => p.active !== false).toArray();
  const map = new Map();
  for (const p of products) {
    if (p.departmentId && p.departmentName && !map.has(p.departmentId)) {
      map.set(p.departmentId, { id: p.departmentId, name: p.departmentName });
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
