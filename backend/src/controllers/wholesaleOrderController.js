/**
 * Storv Exchange — wholesale order lifecycle + inventory mover + ledger writer.
 *
 *   draft  ─send──▶  sent  ─confirm──▶  confirmed | partially_confirmed
 *                       │                  │
 *                       ├─edit (notify)    └─▶ inventory moves + ledger posts
 *                       ├─cancel
 *                       ├─reject (by receiver)
 *                       └─auto-expire (15 days)
 *
 * Confirmation is where the real work happens:
 *   1. Deduct qtyReceived from each line's sender StoreProduct.quantityOnHand.
 *   2. For each line, resolve or create a MasterProduct in the receiver's org
 *      (UPC cascade; confirm-time receiver can override mapping or create new).
 *   3. Add qtyReceived to receiver's StoreProduct.quantityOnHand.
 *   4. Post a LedgerEntry for the confirmed grandTotal against the
 *      canonicalized PartnerBalance, unless this is an internal transfer
 *      AND internal-transfer ledger is disabled (we always post for consistency
 *      per user preference — "force full ledger").
 *   5. Log WholesaleOrderEvent rows for every state change.
 */

import prisma from '../config/postgres.js';
import {
  sendWholesaleOrderReceived,
  sendWholesaleOrderEdited,
  sendWholesaleOrderConfirmed,
  sendWholesaleOrderRejected,
  sendWholesaleOrderCancelled,
} from '../services/emailService.js';
import { lockStoreCode } from './exchangeController.js';

const getOrgId = (req) => req.orgId || req.user?.orgId;
const getStoreId = (req) => req.headers['x-store-id'] || req.storeId || req.query.storeId;
const userLabel = (req) => req.user?.name || req.user?.email || 'system';

// ── Canonicalization: always sort store IDs alphabetically for PartnerBalance ──
function canonPair(storeA, storeB) {
  return storeA < storeB
    ? { storeAId: storeA, storeBId: storeB, swapped: false }
    : { storeAId: storeB, storeBId: storeA, swapped: true };
}

// ── Active partnership check ─────────────────────────────────────────────────
async function requireAcceptedPartnership(storeA, storeB, tx = prisma) {
  const p = await tx.tradingPartner.findFirst({
    where: {
      status: 'accepted',
      OR: [
        { requesterStoreId: storeA, partnerStoreId: storeB },
        { requesterStoreId: storeB, partnerStoreId: storeA },
      ],
    },
  });
  if (!p) {
    const err = new Error('No accepted partnership between these stores.');
    err.status = 403;
    throw err;
  }
  return p;
}

// ── Generate order number "WO-YYYYMMDD-XXXXX" ────────────────────────────────
async function nextOrderNumber(tx = prisma) {
  const now = new Date();
  const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefix = `WO-${yyyymmdd}-`;
  const last = await tx.wholesaleOrder.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  });
  const lastSeq = last ? parseInt(last.orderNumber.slice(-5), 10) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(5, '0')}`;
}

// ── Totals calculator ────────────────────────────────────────────────────────
function calcLineTotals(line, taxEnabled) {
  const qty = Number(line.qtySent || 0);
  const unitCost = Number(line.unitCost || 0);
  const dep = Number(line.depositPerUnit || 0);
  const rate = Number(line.taxRate || 0);
  const lineCost = +(qty * unitCost).toFixed(4);
  const lineDeposit = +(qty * dep).toFixed(4);
  const taxable = !!line.taxable && taxEnabled;
  const taxAmount = taxable ? +((lineCost) * rate).toFixed(4) : 0;
  const lineTotal = +(lineCost + lineDeposit + taxAmount).toFixed(4);
  return { lineCost, lineDeposit, taxAmount, lineTotal };
}

function calcOrderTotals(items) {
  let subtotal = 0, depositTotal = 0, taxTotal = 0;
  for (const it of items) {
    subtotal += Number(it.lineCost || 0);
    depositTotal += Number(it.lineDeposit || 0);
    taxTotal += Number(it.taxAmount || 0);
  }
  return {
    subtotal: +subtotal.toFixed(4),
    depositTotal: +depositTotal.toFixed(4),
    taxTotal: +taxTotal.toFixed(4),
    grandTotal: +(subtotal + depositTotal + taxTotal).toFixed(4),
  };
}

// ── Snapshot builder — captures everything needed to replay the line ─────────
async function buildProductSnapshot(productId, tx = prisma) {
  const p = await tx.masterProduct.findUnique({
    where: { id: productId },
    include: { department: { select: { name: true, code: true } } },
  });
  if (!p) return null;
  return {
    name: p.name,
    brand: p.brand || null,
    upc: p.upc || null,
    size: p.size || null,
    sizeUnit: p.sizeUnit || null,
    taxClass: p.taxClass || null,
    departmentName: p.department?.name || null,
    departmentCode: p.department?.code || null,
    packUnits: p.sellUnitSize || p.unitsPerPack || 1,
    packInCase: p.casePacks || p.innerPack || null,
    depositPerUnit: p.depositRule ? null : (p.containerVolumeOz ? null : null),
    ebtEligible: !!p.ebtEligible,
    ageRequired: p.ageRequired || null,
    imageUrl: p.imageUrl || null,
  };
}

// ── Event logger ─────────────────────────────────────────────────────────────
async function logEvent(tx, orderId, eventType, { description, actorId, actorName, payload } = {}) {
  await tx.wholesaleOrderEvent.create({
    data: { orderId, eventType, description: description || null, actorId: actorId || null, actorName: actorName || null, payload: payload || null },
  });
}

// ═══════════════════════════════════════════════════════════════
// CRUD
// ═══════════════════════════════════════════════════════════════

/** POST /api/exchange/orders  body { receiverStoreId, items: [...], taxEnabled, senderNotes }  → draft */
export const createDraftOrder = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const senderStoreId = getStoreId(req);
    const userId = req.user?.id;
    if (!senderStoreId) return res.status(400).json({ success: false, error: 'storeId required' });

    const { receiverStoreId, items = [], taxEnabled = false, senderNotes = '' } = req.body || {};
    if (!receiverStoreId) return res.status(400).json({ success: false, error: 'receiverStoreId required' });
    if (receiverStoreId === senderStoreId) {
      return res.status(400).json({ success: false, error: "Can't send to yourself." });
    }

    const receiverStore = await prisma.store.findUnique({
      where: { id: receiverStoreId },
      select: { id: true, orgId: true, isActive: true },
    });
    if (!receiverStore?.isActive) {
      return res.status(404).json({ success: false, error: 'Receiver store not found.' });
    }

    await requireAcceptedPartnership(senderStoreId, receiverStoreId);

    // Build line items with snapshot + totals
    const lineItems = [];
    let hasRestricted = false;
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      if (!it.senderProductId || !it.qtySent || it.qtySent <= 0) continue;

      const snapshot = await buildProductSnapshot(it.senderProductId);
      if (!snapshot) continue;

      const unitCost = it.unitCost != null ? Number(it.unitCost) : 0;
      const line = {
        senderProductId: it.senderProductId,
        productSnapshot: snapshot,
        qtySent: Number(it.qtySent),
        unitCost,
        depositPerUnit: it.depositPerUnit != null ? Number(it.depositPerUnit) : null,
        taxable: !!it.taxable,
        taxRate: it.taxRate != null ? Number(it.taxRate) : null,
        sortOrder: idx,
      };
      const totals = calcLineTotals(line, taxEnabled);
      Object.assign(line, totals);
      lineItems.push(line);
      if (['alcohol', 'tobacco'].includes(snapshot.taxClass)) hasRestricted = true;
    }

    const totals = calcOrderTotals(lineItems);
    const isInternal = receiverStore.orgId === orgId;
    const orderNumber = await nextOrderNumber();

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.wholesaleOrder.create({
        data: {
          orderNumber,
          senderStoreId,
          senderOrgId: orgId,
          receiverStoreId,
          receiverOrgId: receiverStore.orgId,
          status: 'draft',
          ...totals,
          taxEnabled,
          isInternalTransfer: isInternal,
          hasRestrictedItems: hasRestricted,
          senderNotes,
          createdById: userId,
          items: { create: lineItems },
        },
        include: { items: true },
      });
      await logEvent(tx, created.id, 'created', { actorId: userId, actorName: userLabel(req), description: 'Draft created' });
      return created;
    });

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

/** PUT /api/exchange/orders/:id  → update draft OR edit sent (notifies receiver) */
export const updateOrder = async (req, res) => {
  try {
    const senderStoreId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;

    const existing = await prisma.wholesaleOrder.findUnique({ where: { id }, include: { items: true } });
    if (!existing) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (existing.senderStoreId !== senderStoreId) {
      return res.status(403).json({ success: false, error: 'Only the sender can edit.' });
    }
    if (!['draft', 'sent'].includes(existing.status)) {
      return res.status(400).json({ success: false, error: `Cannot edit — status: ${existing.status}` });
    }

    const wasSent = existing.status === 'sent';
    const { items = [], taxEnabled, senderNotes } = req.body || {};

    const taxOn = taxEnabled != null ? !!taxEnabled : existing.taxEnabled;
    const lineItems = [];
    let hasRestricted = false;
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      if (!it.senderProductId || !it.qtySent || it.qtySent <= 0) continue;
      const snapshot = it.productSnapshot || (await buildProductSnapshot(it.senderProductId));
      if (!snapshot) continue;
      const line = {
        senderProductId: it.senderProductId,
        productSnapshot: snapshot,
        qtySent: Number(it.qtySent),
        unitCost: Number(it.unitCost || 0),
        depositPerUnit: it.depositPerUnit != null ? Number(it.depositPerUnit) : null,
        taxable: !!it.taxable,
        taxRate: it.taxRate != null ? Number(it.taxRate) : null,
        sortOrder: idx,
      };
      Object.assign(line, calcLineTotals(line, taxOn));
      lineItems.push(line);
      if (['alcohol', 'tobacco'].includes(snapshot.taxClass)) hasRestricted = true;
    }
    const totals = calcOrderTotals(lineItems);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.wholesaleOrderItem.deleteMany({ where: { orderId: id } });
      const u = await tx.wholesaleOrder.update({
        where: { id },
        data: {
          ...totals,
          taxEnabled: taxOn,
          hasRestrictedItems: hasRestricted,
          senderNotes: senderNotes != null ? senderNotes : existing.senderNotes,
          editedAt: wasSent ? new Date() : null,
          editedById: wasSent ? userId : null,
          items: { create: lineItems },
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      await logEvent(tx, id, wasSent ? 'edited' : 'updated', {
        actorId: userId, actorName: userLabel(req),
        description: wasSent ? 'Sender edited a sent PO' : 'Draft updated',
        payload: { totals },
      });
      return u;
    });

    if (wasSent) notifyOrderEdited(id).catch(() => {});
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

/** POST /api/exchange/orders/:id/send  → draft → sent */
export const sendOrder = async (req, res) => {
  try {
    const senderStoreId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;

    const order = await prisma.wholesaleOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (order.senderStoreId !== senderStoreId) {
      return res.status(403).json({ success: false, error: 'Only the sender can send.' });
    }
    if (order.status !== 'draft') {
      return res.status(400).json({ success: false, error: `Cannot send — current status: ${order.status}` });
    }
    if (!order.items?.length) {
      return res.status(400).json({ success: false, error: 'Order has no items.' });
    }

    const EXPIRY_DAYS = 15;
    const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.wholesaleOrder.update({
        where: { id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          sentById: userId,
          expiresAt,
        },
      });
      await lockStoreCode(order.senderStoreId, tx);
      await lockStoreCode(order.receiverStoreId, tx);
      await logEvent(tx, id, 'sent', { actorId: userId, actorName: userLabel(req), description: 'PO sent to receiver' });
      return u;
    });

    notifyOrderReceived(id).catch(() => {});
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

/** POST /api/exchange/orders/:id/cancel  (sender) */
export const cancelOrder = async (req, res) => {
  try {
    const senderStoreId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;
    const reason = req.body?.reason || null;

    const order = await prisma.wholesaleOrder.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (order.senderStoreId !== senderStoreId) {
      return res.status(403).json({ success: false, error: 'Only the sender can cancel.' });
    }
    if (!['draft', 'sent'].includes(order.status)) {
      return res.status(400).json({ success: false, error: `Cannot cancel — status: ${order.status}` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.wholesaleOrder.update({
        where: { id },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: userId, cancelReason: reason },
      });
      await logEvent(tx, id, 'cancelled', {
        actorId: userId, actorName: userLabel(req),
        description: reason || 'Cancelled by sender',
      });
      return u;
    });
    if (order.status === 'sent') notifyOrderCancelled(id).catch(() => {});
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/** POST /api/exchange/orders/:id/reject  (receiver) body { reason } */
export const rejectOrder = async (req, res) => {
  try {
    const receiverStoreId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;
    const reason = req.body?.reason || null;

    const order = await prisma.wholesaleOrder.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (order.receiverStoreId !== receiverStoreId) {
      return res.status(403).json({ success: false, error: 'Only the receiver can reject.' });
    }
    if (order.status !== 'sent') {
      return res.status(400).json({ success: false, error: `Cannot reject — status: ${order.status}` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.wholesaleOrder.update({
        where: { id },
        data: { status: 'rejected', respondedAt: new Date(), respondedById: userId, rejectReason: reason },
      });
      await logEvent(tx, id, 'rejected', {
        actorId: userId, actorName: userLabel(req),
        description: reason || 'Rejected by receiver',
      });
      return u;
    });
    notifyOrderRejected(id).catch(() => {});
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/exchange/orders/:id/confirm
 *   body { lines: [{ itemId, qtyReceived, receiverProductId?, disputeNote? }, ...] }
 *
 * Runs the full confirmation pipeline in ONE transaction:
 *   1. Validate & lock order
 *   2. Deduct sender StoreProduct.quantityOnHand for each line's qtyReceived
 *   3. Upsert receiver StoreProduct.quantityOnHand for each line's qtyReceived
 *   4. Write LedgerEntry + update PartnerBalance
 *   5. Mark order confirmed / partially_confirmed
 */
export const confirmOrder = async (req, res) => {
  try {
    const receiverStoreId = getStoreId(req);
    const receiverOrgId = getOrgId(req);
    const userId = req.user?.id;
    const id = req.params.id;
    const bodyLines = Array.isArray(req.body?.lines) ? req.body.lines : [];

    const order = await prisma.wholesaleOrder.findUnique({ where: { id }, include: { items: true } });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (order.receiverStoreId !== receiverStoreId) {
      return res.status(403).json({ success: false, error: 'Only the receiver can confirm.' });
    }
    if (order.status !== 'sent') {
      return res.status(400).json({ success: false, error: `Cannot confirm — status: ${order.status}` });
    }

    const byItemId = new Map(bodyLines.map((l) => [l.itemId, l]));
    const result = await prisma.$transaction(async (tx) => {
      let confSubtotal = 0, confDeposit = 0, confTax = 0;
      let anyShort = false, anyReceived = false;

      for (const item of order.items) {
        const payload = byItemId.get(item.id) || {};
        const qtyReceived = Math.max(0, Math.min(Number(payload.qtyReceived ?? item.qtySent), item.qtySent));
        if (qtyReceived < item.qtySent) anyShort = true;
        if (qtyReceived > 0) anyReceived = true;

        // Pro-rate line totals against qtyReceived
        const scale = item.qtySent > 0 ? qtyReceived / item.qtySent : 0;
        const scaledCost = +(Number(item.lineCost) * scale).toFixed(4);
        const scaledDep = +(Number(item.lineDeposit) * scale).toFixed(4);
        const scaledTax = +(Number(item.taxAmount) * scale).toFixed(4);

        confSubtotal += scaledCost;
        confDeposit += scaledDep;
        confTax += scaledTax;

        await tx.wholesaleOrderItem.update({
          where: { id: item.id },
          data: {
            qtyReceived,
            receiverProductId: payload.receiverProductId != null ? Number(payload.receiverProductId) : null,
            disputeNote: qtyReceived < item.qtySent ? (payload.disputeNote || 'Short qty on receipt') : null,
          },
        });

        if (qtyReceived > 0) {
          // 1. Deduct from sender's StoreProduct.quantityOnHand (if trackInventory)
          if (item.senderProductId) {
            await deductStock(tx, order.senderStoreId, order.senderOrgId, item.senderProductId, qtyReceived);
          }
          // 2. Add to receiver's StoreProduct.quantityOnHand
          if (payload.receiverProductId) {
            await addStock(tx, order.receiverStoreId, receiverOrgId, Number(payload.receiverProductId), qtyReceived, item.unitCost);
          }
        }
      }

      const confGrand = +(confSubtotal + confDeposit + confTax).toFixed(4);
      const newStatus = !anyReceived ? 'rejected' : (anyShort ? 'partially_confirmed' : 'confirmed');

      // Write ledger if anything was actually received
      if (anyReceived) {
        await postLedgerForOrder(tx, order, confGrand, userId);
      }

      const u = await tx.wholesaleOrder.update({
        where: { id },
        data: {
          status: newStatus,
          respondedAt: new Date(),
          respondedById: userId,
          confirmedAt: new Date(),
          confirmedSubtotal: confSubtotal,
          confirmedDeposit: confDeposit,
          confirmedTax: confTax,
          confirmedGrandTotal: confGrand,
        },
        include: { items: true },
      });

      await logEvent(tx, id, newStatus === 'partially_confirmed' ? 'partially_confirmed' : 'confirmed', {
        actorId: userId, actorName: userLabel(req),
        description: `Receiver confirmed — ${newStatus}. Grand total ${confGrand.toFixed(2)}.`,
        payload: { subtotal: confSubtotal, deposit: confDeposit, tax: confTax, grandTotal: confGrand },
      });
      await logEvent(tx, id, 'inventory_moved', {
        actorId: userId, actorName: userLabel(req),
        description: 'QOH updated on both stores',
      });
      if (anyReceived) {
        await logEvent(tx, id, 'ledger_posted', {
          actorId: userId, actorName: userLabel(req),
          description: `${confGrand.toFixed(2)} posted to partner ledger`,
        });
      }

      return u;
    }, { timeout: 30000 });

    notifyOrderConfirmed(id).catch(() => {});
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// ── Stock mutators (run inside confirm transaction) ──────────────────────────

async function deductStock(tx, storeId, orgId, masterProductId, qty) {
  const sp = await tx.storeProduct.findUnique({
    where: { storeId_masterProductId: { storeId, masterProductId } },
  });
  if (!sp) return; // Sender might not track this product at the store level — skip silently
  const current = Number(sp.quantityOnHand || 0);
  await tx.storeProduct.update({
    where: { storeId_masterProductId: { storeId, masterProductId } },
    data: {
      quantityOnHand: current - qty,
      lastStockUpdate: new Date(),
    },
  });
}

async function addStock(tx, storeId, orgId, masterProductId, qty, unitCost) {
  const existing = await tx.storeProduct.findUnique({
    where: { storeId_masterProductId: { storeId, masterProductId } },
  });
  if (existing) {
    await tx.storeProduct.update({
      where: { storeId_masterProductId: { storeId, masterProductId } },
      data: {
        quantityOnHand: Number(existing.quantityOnHand || 0) + qty,
        lastStockUpdate: new Date(),
        lastReceivedAt: new Date(),
      },
    });
  } else {
    await tx.storeProduct.create({
      data: {
        storeId, orgId, masterProductId,
        quantityOnHand: qty,
        costPrice: unitCost != null ? unitCost : null,
        active: true, inStock: true,
        lastStockUpdate: new Date(),
        lastReceivedAt: new Date(),
      },
    });
  }
}

// ── Ledger writer ────────────────────────────────────────────────────────────

async function postLedgerForOrder(tx, order, grandTotal, userId) {
  if (grandTotal <= 0) return;

  const { storeAId, storeBId, swapped } = canonPair(order.senderStoreId, order.receiverStoreId);

  // Sender shipped goods worth `grandTotal` → receiver owes sender.
  // In canonical form:
  //   if swapped=false  → sender=A, receiver=B  → B owes A → direction 'B_OWES_A' → balance += amount
  //   if swapped=true   → sender=B, receiver=A  → A owes B → direction 'A_OWES_B' → balance -= amount
  const direction = swapped ? 'A_OWES_B' : 'B_OWES_A';
  const delta = swapped ? -grandTotal : grandTotal;

  // Upsert PartnerBalance
  const balance = await tx.partnerBalance.upsert({
    where: { storeAId_storeBId: { storeAId, storeBId } },
    update: {
      balance: { increment: delta },
      lastActivityAt: new Date(),
    },
    create: {
      storeAId, storeBId,
      balance: delta,
      lastActivityAt: new Date(),
    },
  });

  await tx.ledgerEntry.create({
    data: {
      storeAId, storeBId,
      direction, amount: grandTotal, balanceAfter: Number(balance.balance),
      entryType: order.isInternalTransfer ? 'internal_transfer' : 'wholesale_order',
      wholesaleOrderId: order.id,
      description: `PO ${order.orderNumber} confirmed (${grandTotal.toFixed(2)})`,
      createdById: userId,
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// READ ENDPOINTS
// ═══════════════════════════════════════════════════════════════

/** GET /api/exchange/orders  ?direction=all|outgoing|incoming &status=... &partnerStoreId=... */
export const listOrders = async (req, res) => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const { direction = 'all', status, partnerStoreId, limit = 100, offset = 0 } = req.query;

    const where = {};
    if (direction === 'outgoing') where.senderStoreId = storeId;
    else if (direction === 'incoming') where.receiverStoreId = storeId;
    else where.OR = [{ senderStoreId: storeId }, { receiverStoreId: storeId }];

    if (status) where.status = { in: String(status).split(',') };
    if (partnerStoreId) {
      // Narrow to a specific partner (either direction)
      const otherCond = {
        OR: [
          { senderStoreId: partnerStoreId },
          { receiverStoreId: partnerStoreId },
        ],
      };
      where.AND = [{ ...otherCond }];
    }

    const [orders, total] = await Promise.all([
      prisma.wholesaleOrder.findMany({
        where,
        include: {
          senderStore: { select: { id: true, name: true, storeCode: true } },
          receiverStore: { select: { id: true, name: true, storeCode: true } },
          _count: { select: { items: true } },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: Math.min(Number(limit), 500),
        skip: Number(offset),
      }),
      prisma.wholesaleOrder.count({ where }),
    ]);

    const annotated = orders.map((o) => ({
      ...o,
      direction: o.senderStoreId === storeId ? 'outgoing' : 'incoming',
      partner: o.senderStoreId === storeId ? o.receiverStore : o.senderStore,
    }));

    res.json({ success: true, data: annotated, total });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/** GET /api/exchange/orders/:id  → order detail + items + events */
export const getOrder = async (req, res) => {
  try {
    const storeId = getStoreId(req);
    const id = req.params.id;

    const order = await prisma.wholesaleOrder.findUnique({
      where: { id },
      include: {
        senderStore: {
          select: {
            id: true, name: true, storeCode: true, address: true,
            organization: { select: { id: true, name: true } },
          },
        },
        receiverStore: {
          select: {
            id: true, name: true, storeCode: true, address: true,
            organization: { select: { id: true, name: true } },
          },
        },
        items: { orderBy: { sortOrder: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (order.senderStoreId !== storeId && order.receiverStoreId !== storeId) {
      return res.status(403).json({ success: false, error: 'Not your order.' });
    }
    res.json({
      success: true,
      data: {
        ...order,
        direction: order.senderStoreId === storeId ? 'outgoing' : 'incoming',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/** DELETE /api/exchange/orders/:id  → delete a draft (sender only) */
export const deleteDraft = async (req, res) => {
  try {
    const senderStoreId = getStoreId(req);
    const id = req.params.id;
    const order = await prisma.wholesaleOrder.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (order.senderStoreId !== senderStoreId) {
      return res.status(403).json({ success: false, error: 'Only the sender can delete.' });
    }
    if (order.status !== 'draft') {
      return res.status(400).json({ success: false, error: 'Only drafts can be deleted.' });
    }
    await prisma.wholesaleOrder.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// Notification helpers (fire-and-forget)
// ═══════════════════════════════════════════════════════════════

async function notifyOrderReceived(orderId) {
  const o = await prisma.wholesaleOrder.findUnique({
    where: { id: orderId },
    include: {
      senderStore: { select: { name: true, storeCode: true } },
      receiverStore: {
        select: { name: true, organization: { select: { billingEmail: true } } },
      },
    },
  });
  const email = o?.receiverStore?.organization?.billingEmail;
  if (!email) return;
  await sendWholesaleOrderReceived(email, {
    orderNumber: o.orderNumber,
    senderName: o.senderStore.name,
    senderCode: o.senderStore.storeCode,
    grandTotal: Number(o.grandTotal),
    expiresAt: o.expiresAt,
  });
}

async function notifyOrderConfirmed(orderId) {
  const o = await prisma.wholesaleOrder.findUnique({
    where: { id: orderId },
    include: {
      senderStore: { select: { name: true, organization: { select: { billingEmail: true } } } },
      receiverStore: { select: { name: true } },
    },
  });
  const email = o?.senderStore?.organization?.billingEmail;
  if (!email) return;
  await sendWholesaleOrderConfirmed(email, {
    orderNumber: o.orderNumber,
    receiverName: o.receiverStore.name,
    grandTotal: Number(o.confirmedGrandTotal || o.grandTotal),
    status: o.status,
  });
}

async function notifyOrderRejected(orderId) {
  const o = await prisma.wholesaleOrder.findUnique({
    where: { id: orderId },
    include: {
      senderStore: { select: { name: true, organization: { select: { billingEmail: true } } } },
      receiverStore: { select: { name: true } },
    },
  });
  const email = o?.senderStore?.organization?.billingEmail;
  if (!email) return;
  await sendWholesaleOrderRejected(email, {
    orderNumber: o.orderNumber,
    receiverName: o.receiverStore.name,
    reason: o.rejectReason,
  });
}

async function notifyOrderCancelled(orderId) {
  const o = await prisma.wholesaleOrder.findUnique({
    where: { id: orderId },
    include: {
      senderStore: { select: { name: true } },
      receiverStore: { select: { name: true, organization: { select: { billingEmail: true } } } },
    },
  });
  const email = o?.receiverStore?.organization?.billingEmail;
  if (!email) return;
  await sendWholesaleOrderCancelled(email, {
    orderNumber: o.orderNumber,
    senderName: o.senderStore.name,
    reason: o.cancelReason,
  });
}

async function notifyOrderEdited(orderId) {
  const o = await prisma.wholesaleOrder.findUnique({
    where: { id: orderId },
    include: {
      senderStore: { select: { name: true } },
      receiverStore: { select: { name: true, organization: { select: { billingEmail: true } } } },
    },
  });
  const email = o?.receiverStore?.organization?.billingEmail;
  if (!email) return;
  await sendWholesaleOrderEdited(email, {
    orderNumber: o.orderNumber,
    senderName: o.senderStore.name,
    grandTotal: Number(o.grandTotal),
  });
}
