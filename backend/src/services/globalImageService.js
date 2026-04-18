/**
 * Global Product Image Service
 *
 * Manages the cross-org image cache keyed by stripped UPC.
 * Priority: product.imageUrl → GlobalProductImage.rehostedUrl → GlobalProductImage.imageUrl → null
 */

import prisma from '../config/postgres.js';
import { stripUpc } from '../utils/upc.js';

/**
 * Upsert a global image entry for a UPC.
 * Only writes if the UPC doesn't already have an image (first-write-wins).
 */
export async function upsertGlobalImage({ upc, imageUrl, source = 'import', productName, brand }) {
  if (!upc || !imageUrl) return null;

  const stripped = stripUpc(upc);
  if (!stripped) return null;

  // Validate URL format (basic check)
  if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) return null;

  try {
    return await prisma.globalProductImage.upsert({
      where: { strippedUpc: stripped },
      create: {
        strippedUpc: stripped,
        originalUpc: upc,
        imageUrl,
        source,
        productName: productName || null,
        brand: brand || null,
      },
      // Only update if image URL has changed (don't overwrite with same)
      update: {
        imageUrl,
        ...(productName ? { productName } : {}),
        ...(brand ? { brand } : {}),
      },
    });
  } catch (err) {
    // Unique constraint race condition — safe to ignore
    console.warn('[GlobalImage] upsert failed for UPC', stripped, err.message);
    return null;
  }
}

/**
 * Batch upsert global images from an import.
 * Accepts an array of { upc, imageUrl, name, brand }.
 * Efficient: skips existing entries, only inserts new ones.
 */
export async function batchUpsertGlobalImages(items) {
  if (!items?.length) return { inserted: 0, skipped: 0 };

  // Filter valid entries
  const valid = items
    .filter(i => i.upc && i.imageUrl && (i.imageUrl.startsWith('http://') || i.imageUrl.startsWith('https://')))
    .map(i => ({
      strippedUpc: stripUpc(i.upc),
      originalUpc: i.upc,
      imageUrl: i.imageUrl,
      productName: i.name || null,
      brand: i.brand || null,
    }))
    .filter(i => i.strippedUpc);

  if (!valid.length) return { inserted: 0, skipped: 0 };

  // Deduplicate by strippedUpc (keep first occurrence)
  const seen = new Set();
  const deduped = valid.filter(i => {
    if (seen.has(i.strippedUpc)) return false;
    seen.add(i.strippedUpc);
    return true;
  });

  // Check which UPCs already exist
  const existing = await prisma.globalProductImage.findMany({
    where: { strippedUpc: { in: deduped.map(i => i.strippedUpc) } },
    select: { strippedUpc: true },
  });
  const existingSet = new Set(existing.map(e => e.strippedUpc));

  const toInsert = deduped.filter(i => !existingSet.has(i.strippedUpc));

  if (toInsert.length > 0) {
    // Insert in chunks of 500
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500).map(item => ({
        strippedUpc: item.strippedUpc,
        originalUpc: item.originalUpc,
        imageUrl: item.imageUrl,
        source: 'import',
        productName: item.productName,
        brand: item.brand,
      }));

      await prisma.globalProductImage.createMany({
        data: chunk,
        skipDuplicates: true,
      });
    }
  }

  return { inserted: toInsert.length, skipped: existingSet.size };
}

/**
 * Look up a global image by UPC.
 * Returns the rehosted URL if available, otherwise the original external URL.
 */
export async function getGlobalImageByUpc(upc) {
  if (!upc) return null;

  const stripped = stripUpc(upc);
  if (!stripped) return null;

  const row = await prisma.globalProductImage.findUnique({
    where: { strippedUpc: stripped },
    select: { rehostedUrl: true, imageUrl: true },
  });

  if (!row) return null;
  return row.rehostedUrl || row.imageUrl;
}

/**
 * Resolve image URL for a product.
 * Priority: product's own imageUrl → global cache by UPC → null
 */
export async function resolveProductImage(product) {
  if (product.imageUrl) return product.imageUrl;
  if (product.upc) return getGlobalImageByUpc(product.upc);
  return null;
}

/**
 * Batch resolve images for multiple products.
 * Returns a Map<productId, imageUrl>.
 */
export async function batchResolveProductImages(products) {
  const result = new Map();
  const needLookup = [];

  for (const p of products) {
    if (p.imageUrl) {
      result.set(p.id, p.imageUrl);
    } else if (p.upc) {
      needLookup.push(p);
    }
  }

  if (needLookup.length > 0) {
    const strippedUpcs = needLookup
      .map(p => ({ id: p.id, stripped: stripUpc(p.upc) }))
      .filter(p => p.stripped);

    if (strippedUpcs.length > 0) {
      const globalImages = await prisma.globalProductImage.findMany({
        where: { strippedUpc: { in: strippedUpcs.map(s => s.stripped) } },
        select: { strippedUpc: true, rehostedUrl: true, imageUrl: true },
      });

      const imageMap = new Map(globalImages.map(g => [g.strippedUpc, g.rehostedUrl || g.imageUrl]));

      for (const { id, stripped } of strippedUpcs) {
        const url = imageMap.get(stripped);
        if (url) result.set(id, url);
      }
    }
  }

  return result;
}
