/**
 * PO ↔ Invoice Matching Service
 *
 * When an invoice arrives (via scan/upload), this service matches
 * invoice line items to open Purchase Orders for that vendor.
 *
 * Matching cascade:
 *   1. UPC exact match
 *   2. Product name / description fuzzy match
 *   3. Item code / SKU match
 *
 * Outputs pre-filled received quantities + cost variance analysis.
 */

import prisma from '../config/postgres.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

/**
 * Simple Jaccard similarity between two strings (word overlap).
 */
function jaccardSimilarity(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

/**
 * Match an invoice to open Purchase Orders.
 *
 * @param {string} orgId
 * @param {string} storeId
 * @param {string} invoiceId
 * @returns {Promise<Object>} { matchedPO, matchedItems, unmatchedInvoiceItems, costVariances, summary }
 */
export async function matchInvoiceToPO(orgId, storeId, invoiceId) {
  // 1. Load the invoice
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, orgId },
  });
  if (!invoice) throw new Error('Invoice not found');

  const invoiceItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
  const vendorName = (invoice.vendorName || '').trim().toLowerCase();

  // 2. Find matching vendor by name or alias
  const vendors = await prisma.vendor.findMany({
    where: { orgId, active: true },
    select: { id: true, name: true, aliases: true },
  });

  let vendorId = null;
  for (const v of vendors) {
    if (v.name.toLowerCase() === vendorName) { vendorId = v.id; break; }
    if (Array.isArray(v.aliases) && v.aliases.some(a => a.toLowerCase() === vendorName)) { vendorId = v.id; break; }
  }
  // Fuzzy match vendor name
  if (!vendorId) {
    let bestScore = 0;
    for (const v of vendors) {
      const score = jaccardSimilarity(vendorName, v.name);
      if (score > bestScore && score >= 0.6) { bestScore = score; vendorId = v.id; }
      for (const alias of (v.aliases || [])) {
        const aScore = jaccardSimilarity(vendorName, alias);
        if (aScore > bestScore && aScore >= 0.6) { bestScore = aScore; vendorId = v.id; }
      }
    }
  }

  // 3. Find open POs for this vendor
  const poWhere = { orgId, status: { in: ['submitted', 'partial'] } };
  if (storeId) poWhere.storeId = storeId;
  if (vendorId) poWhere.vendorId = vendorId;

  const openPOs = await prisma.purchaseOrder.findMany({
    where: poWhere,
    include: {
      items: { include: { product: { select: { id: true, name: true, upc: true } } } },
      vendor: { select: { id: true, name: true } },
    },
    orderBy: { orderDate: 'desc' },
  });

  if (openPOs.length === 0) {
    return {
      matchedPO: null,
      matchedItems: [],
      unmatchedInvoiceItems: invoiceItems.map((li, i) => ({ ...li, _idx: i })),
      costVariances: [],
      summary: { matched: 0, unmatched: invoiceItems.length, totalVariance: 0 },
    };
  }

  // 4. Build a lookup of all PO items across all open POs
  const poItemPool = [];
  for (const po of openPOs) {
    for (const item of po.items) {
      poItemPool.push({
        poId: po.id,
        poNumber: po.poNumber,
        poItemId: item.id,
        masterProductId: item.masterProductId,
        productName: item.product?.name || '',
        productUpc: item.product?.upc || '',
        qtyOrdered: item.qtyOrdered,
        qtyReceived: item.qtyReceived,
        unitCost: Number(item.unitCost),
        caseCost: Number(item.caseCost),
        _matched: false,
      });
    }
  }

  // 5. Match invoice items to PO items
  const matchedItems = [];
  const unmatchedInvoiceItems = [];
  const costVariances = [];

  for (let idx = 0; idx < invoiceItems.length; idx++) {
    const invItem = invoiceItems[idx];
    const invUpc = (invItem.upc || invItem.UPC || '').replace(/[^0-9]/g, '');
    const invDesc = invItem.description || invItem.name || invItem.productName || '';
    const invSku = invItem.sku || invItem.itemCode || invItem.vendorItemCode || '';
    const invQty = Number(invItem.qty || invItem.qtyReceived || invItem.unitQty || invItem.caseQty || 1);
    const invUnitCost = Number(invItem.unitCost || invItem.cost || 0);
    const invCaseCost = Number(invItem.caseCost || 0);

    let bestMatch = null;
    let bestScore = 0;

    for (const poItem of poItemPool) {
      if (poItem._matched) continue;

      let score = 0;

      // Tier 1: UPC exact match
      if (invUpc && poItem.productUpc && invUpc === poItem.productUpc.replace(/[^0-9]/g, '')) {
        score = 1.0;
      }
      // Tier 2: SKU / item code
      else if (invSku && poItem.masterProductId && invSku === String(poItem.masterProductId)) {
        score = 0.85;
      }
      // Tier 3: Name fuzzy match
      else {
        const nameScore = jaccardSimilarity(invDesc, poItem.productName);
        if (nameScore >= 0.65) score = nameScore * 0.8;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = poItem;
      }
    }

    if (bestMatch && bestScore >= 0.5) {
      bestMatch._matched = true;

      // Cost variance
      const variance = invUnitCost > 0 && bestMatch.unitCost > 0
        ? r4(invUnitCost - bestMatch.unitCost)
        : 0;
      const variancePct = bestMatch.unitCost > 0
        ? r2(Math.abs(variance) / bestMatch.unitCost * 100)
        : 0;
      const varianceFlag = variancePct < 5 ? 'none' : variancePct < 15 ? 'minor' : 'major';

      const matched = {
        _invoiceIdx: idx,
        invoiceItem: invItem,
        poItemId: bestMatch.poItemId,
        poId: bestMatch.poId,
        poNumber: bestMatch.poNumber,
        masterProductId: bestMatch.masterProductId,
        productName: bestMatch.productName,
        productUpc: bestMatch.productUpc,
        qtyOrdered: bestMatch.qtyOrdered,
        qtyAlreadyReceived: bestMatch.qtyReceived,
        qtyFromInvoice: invQty,
        // Cost info
        poUnitCost: bestMatch.unitCost,
        invoiceUnitCost: invUnitCost,
        invoiceCaseCost: invCaseCost,
        costVariance: variance,
        costVariancePct: variancePct,
        varianceFlag,
        matchScore: r2(bestScore),
      };

      matchedItems.push(matched);

      if (varianceFlag !== 'none') {
        costVariances.push({
          productName: bestMatch.productName,
          upc: bestMatch.productUpc,
          poUnitCost: bestMatch.unitCost,
          invoiceUnitCost: invUnitCost,
          variance,
          variancePct,
          flag: varianceFlag,
        });
      }
    } else {
      unmatchedInvoiceItems.push({ ...invItem, _idx: idx });
    }
  }

  // 6. Find the best matching PO (the one with the most matched items)
  const poMatchCounts = {};
  for (const m of matchedItems) {
    poMatchCounts[m.poId] = (poMatchCounts[m.poId] || 0) + 1;
  }
  const bestPOId = Object.entries(poMatchCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || openPOs[0]?.id;
  const matchedPO = openPOs.find(po => po.id === bestPOId) || null;

  // 7. Summary
  const totalVariance = r2(costVariances.reduce((s, v) => s + Math.abs(v.variance), 0));

  return {
    matchedPO: matchedPO ? { id: matchedPO.id, poNumber: matchedPO.poNumber, vendorName: matchedPO.vendor?.name } : null,
    matchedItems,
    unmatchedInvoiceItems,
    costVariances,
    summary: {
      matched: matchedItems.length,
      unmatched: unmatchedInvoiceItems.length,
      totalVariance,
      majorVariances: costVariances.filter(v => v.flag === 'major').length,
      minorVariances: costVariances.filter(v => v.flag === 'minor').length,
    },
  };
}
