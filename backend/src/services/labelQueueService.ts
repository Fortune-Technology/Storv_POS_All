/**
 * Label Queue Service
 *
 * Manages a queue of product labels that need to be printed due to
 * price changes, new products, sales, or manual requests.
 */

import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

interface UpsertData {
  reason: string;
  oldPrice: number | null;
  newPrice: number | null;
}

// ── Helper: safe upsert that handles nullable storeId ─────────────────────
// Prisma can't use compound unique with null values in upsert where clause,
// so we do a findFirst + create/update pattern instead.
async function upsertQueueItem(
  orgId: string,
  storeId: string | null | undefined,
  productId: string,
  data: UpsertData,
) {
  const existing = await prisma.labelQueue.findFirst({
    where: {
      orgId,
      storeId: storeId || null,
      masterProductId: productId,
      status: 'pending',
    },
  });

  if (existing) {
    return prisma.labelQueue.update({
      where: { id: existing.id },
      data: {
        reason:   data.reason,
        oldPrice: data.oldPrice,
        newPrice: data.newPrice,
        addedAt:  new Date(),
      },
    });
  }

  return prisma.labelQueue.create({
    data: {
      orgId,
      storeId:         storeId || null,
      masterProductId: productId,
      reason:          data.reason,
      oldPrice:        data.oldPrice,
      newPrice:        data.newPrice,
      status:          'pending',
    },
  });
}

// ─────────────────────────────────────────────────
// 1. Queue label for a price change
// ─────────────────────────────────────────────────

type Numeric = number | string | null | undefined;

const toFloat = (v: Numeric): number | null =>
  v == null || v === '' ? null : (Number.isFinite(parseFloat(String(v))) ? parseFloat(String(v)) : null);

export const queueLabelForPriceChange = async (
  orgId: string,
  storeId: string | null | undefined,
  productId: string,
  oldPrice: Numeric,
  newPrice: Numeric,
) => {
  if (oldPrice != null && newPrice != null && parseFloat(String(oldPrice)) === parseFloat(String(newPrice))) return null;
  return upsertQueueItem(orgId, storeId, productId, {
    reason:   'price_change',
    oldPrice: toFloat(oldPrice),
    newPrice: toFloat(newPrice),
  });
};

// ─────────────────────────────────────────────────
// 2. Queue label for a new product
// ─────────────────────────────────────────────────

export const queueLabelForNewProduct = async (
  orgId: string,
  productId: string,
  retailPrice: Numeric,
) => {
  return upsertQueueItem(orgId, null, productId, {
    reason:   'new_product',
    oldPrice: null,
    newPrice: toFloat(retailPrice),
  });
};

// ─────────────────────────────────────────────────
// 3. Queue label for a sale starting/ending
// ─────────────────────────────────────────────────

export const queueLabelForSale = async (
  orgId: string,
  storeId: string | null | undefined,
  productId: string,
  regularPrice: Numeric,
  salePrice: Numeric,
  isSaleEnding: boolean,
) => {
  return upsertQueueItem(orgId, storeId, productId, {
    reason:   isSaleEnding ? 'sale_ended' : 'sale_started',
    oldPrice: toFloat(regularPrice),
    newPrice: toFloat(salePrice),
  });
};

// ─────────────────────────────────────────────────
// 4. Add manual item(s) to the queue
// ─────────────────────────────────────────────────

export const addManualItem = async (
  orgId: string,
  storeId: string | null | undefined,
  productId: string,
) => {
  const product = await prisma.masterProduct.findFirst({
    where: { id: productId, orgId },
    select: { defaultRetailPrice: true },
  });

  return upsertQueueItem(orgId, storeId, productId, {
    reason:   'manual',
    oldPrice: null,
    newPrice: product?.defaultRetailPrice != null ? parseFloat(String(product.defaultRetailPrice)) : null,
  });
};

// ─────────────────────────────────────────────────
// 5. Get label queue (pending items with product details)
// ─────────────────────────────────────────────────

export interface LabelQueueFilters {
  status?: string;
  reason?: string;
  search?: string;
}

export const getLabelQueue = async (
  orgId: string,
  storeId: string | null | undefined,
  filters: LabelQueueFilters = {},
) => {
  // Looser local shape so we can `delete` keys when juggling AND/OR;
  // narrowed at the prisma call site below.
  const where: Record<string, unknown> = { orgId, status: filters.status || 'pending' };

  // Include org-wide items (storeId=null) + store-specific
  if (storeId) {
    where.OR = [{ storeId }, { storeId: null }];
    // Move orgId and status inside AND to avoid conflict with OR
    delete where.orgId;
    delete where.status;
    where.AND = [
      { orgId },
      { status: filters.status || 'pending' },
    ];
  }

  if (filters.reason) where.reason = filters.reason;

  if (filters.search) {
    const searchFilter: Prisma.LabelQueueWhereInput = {
      product: {
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { upc:  { contains: filters.search, mode: 'insensitive' } },
          { brand:{ contains: filters.search, mode: 'insensitive' } },
        ],
      },
    };
    if (Array.isArray(where.AND)) (where.AND as unknown[]).push(searchFilter);
    else where.AND = [searchFilter];
  }

  const items = await prisma.labelQueue.findMany({
    where: where as Prisma.LabelQueueWhereInput,
    include: {
      product: {
        select: {
          id: true, name: true, upc: true, brand: true,
          size: true, sizeUnit: true,
          defaultRetailPrice: true, defaultCostPrice: true,
          department: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ addedAt: 'desc' }],
    take: 500,
  });

  // Group by reason
  type QueueRow = (typeof items)[number];
  const groups = {
    price_change: items.filter((i: QueueRow) => i.reason === 'price_change'),
    new_product:  items.filter((i: QueueRow) => i.reason === 'new_product'),
    sale_started: items.filter((i: QueueRow) => i.reason === 'sale_started'),
    sale_ended:   items.filter((i: QueueRow) => i.reason === 'sale_ended'),
    manual:       items.filter((i: QueueRow) => i.reason === 'manual'),
  };

  return { items, groups, total: items.length };
};

// ─────────────────────────────────────────────────
// 6. Get pending count (for badge)
// ─────────────────────────────────────────────────

export const getQueueCount = async (orgId: string, storeId: string | null | undefined) => {
  const where: Record<string, unknown> = { orgId, status: 'pending' };
  if (storeId) {
    delete where.orgId;
    delete where.status;
    where.AND = [{ orgId }, { status: 'pending' }];
    where.OR = [{ storeId }, { storeId: null }];
  }
  return prisma.labelQueue.count({ where: where as Prisma.LabelQueueWhereInput });
};

// ─────────────────────────────────────────────────
// 7. Mark items as printed
// ─────────────────────────────────────────────────

export const markAsPrinted = async (ids: Array<string | number>, userId: string) => {
  const intIds = ids.map((id) => parseInt(String(id)));

  // First, clear any old printed/dismissed entries for these products
  // to avoid unique constraint conflict (orgId, storeId, productId, status)
  const pending = await prisma.labelQueue.findMany({
    where: { id: { in: intIds } },
    select: { orgId: true, storeId: true, masterProductId: true },
  });

  if (pending.length > 0) {
    for (const p of pending) {
      await prisma.labelQueue.deleteMany({
        where: {
          orgId: p.orgId,
          storeId: p.storeId,
          masterProductId: p.masterProductId,
          status: { in: ['printed', 'dismissed'] },
        },
      }).catch(() => {});
    }
  }

  return prisma.labelQueue.updateMany({
    where: { id: { in: intIds } },
    data: { status: 'printed', printedAt: new Date(), printedBy: userId },
  });
};

// ─────────────────────────────────────────────────
// 8. Dismiss items
// ─────────────────────────────────────────────────

export const dismissItems = async (ids: Array<string | number>) => {
  const intIds = ids.map((id) => parseInt(String(id)));

  // Clear old dismissed entries to avoid unique constraint conflict
  const pending = await prisma.labelQueue.findMany({
    where: { id: { in: intIds } },
    select: { orgId: true, storeId: true, masterProductId: true },
  });

  for (const p of pending) {
    await prisma.labelQueue.deleteMany({
      where: {
        orgId: p.orgId,
        storeId: p.storeId,
        masterProductId: p.masterProductId,
        status: 'dismissed',
      },
    }).catch(() => {});
  }

  return prisma.labelQueue.updateMany({
    where: { id: { in: intIds } },
    data: { status: 'dismissed' },
  });
};

// ─────────────────────────────────────────────────
// 9. Clear old printed/dismissed items
// ─────────────────────────────────────────────────

export const clearOldItems = async (orgId: string, daysOld: number = 30) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  return prisma.labelQueue.deleteMany({
    where: {
      orgId,
      status: { in: ['printed', 'dismissed'] },
      addedAt: { lt: cutoff },
    },
  });
};
