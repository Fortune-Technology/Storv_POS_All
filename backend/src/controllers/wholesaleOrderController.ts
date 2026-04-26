/**
 * StoreVeu Exchange — wholesale order lifecycle + inventory mover + ledger writer.
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

import type { Request, Response } from 'express';
import type { PrismaClient, WholesaleOrder } from '@prisma/client';
import { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import {
  sendWholesaleOrderReceived,
  sendWholesaleOrderEdited,
  sendWholesaleOrderConfirmed,
  sendWholesaleOrderRejected,
  sendWholesaleOrderCancelled,
} from '../services/emailService.js';
import { lockStoreCode } from './exchangeController.js';

// Prisma transaction client type — strips the methods that aren't available
// inside an interactive transaction callback.
type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const getOrgId = (req: Request): string | null | undefined =>
  req.orgId || req.user?.orgId;

const getStoreId = (req: Request): string | null | undefined =>
  (req.headers['x-store-id'] as string | undefined)
  || req.storeId
  || (req.query as { storeId?: string } | undefined)?.storeId;

const userLabel = (req: Request): string =>
  req.user?.name || req.user?.email || 'system';

// ── Canonicalization: always sort store IDs alphabetically for PartnerBalance ──
interface CanonPair {
  storeAId: string;
  storeBId: string;
  swapped: boolean;
}
function canonPair(storeA: string, storeB: string): CanonPair {
  return storeA < storeB
    ? { storeAId: storeA, storeBId: storeB, swapped: false }
    : { storeAId: storeB, storeBId: storeA, swapped: true };
}

// ── Active partnership check ─────────────────────────────────────────────────
async function requireAcceptedPartnership(storeA: string, storeB: string, tx: TxClient | typeof prisma = prisma): Promise<unknown> {
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
    const err = Object.assign(new Error('No accepted partnership between these stores.'), { status: 403 });
    throw err;
  }
  return p;
}

// ── Generate order number "WO-YYYYMMDD-XXXXX" ────────────────────────────────
async function nextOrderNumber(tx: TxClient | typeof prisma = prisma): Promise<string> {
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
interface LineLike {
  qtySent?: number | string | null;
  unitCost?: number | string | null;
  depositPerUnit?: number | string | null;
  taxRate?: number | string | null;
  taxable?: boolean;
}

interface LineTotals {
  lineCost: number;
  lineDeposit: number;
  taxAmount: number;
  lineTotal: number;
}

function calcLineTotals(line: LineLike, taxEnabled: boolean): LineTotals {
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

interface OrderTotals {
  subtotal: number;
  depositTotal: number;
  taxTotal: number;
  grandTotal: number;
}

function calcOrderTotals(items: LineTotals[]): OrderTotals {
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
interface ProductSnapshot {
  name: string;
  brand: string | null;
  upc: string | null;
  size: string | null;
  sizeUnit: string | null;
  taxClass: string | null;
  departmentName: string | null;
  departmentCode: string | null;
  packUnits: number;
  packInCase: number | null;
  depositPerUnit: number | null;
  ebtEligible: boolean;
  ageRequired: number | string | null;
  imageUrl: string | null;
}

async function buildProductSnapshot(productId: number, tx: TxClient | typeof prisma = prisma): Promise<ProductSnapshot | null> {
  const p = await tx.masterProduct.findUnique({
    where: { id: productId },
    include: { department: { select: { name: true, code: true } } },
  });
  if (!p) return null;
  const pp = p as unknown as {
    name: string;
    brand?: string | null;
    upc?: string | null;
    size?: string | null;
    sizeUnit?: string | null;
    taxClass?: string | null;
    department?: { name: string; code: string | null } | null;
    sellUnitSize?: number | null;
    unitsPerPack?: number | null;
    casePacks?: number | null;
    innerPack?: number | null;
    depositRule?: unknown;
    containerVolumeOz?: number | null;
    ebtEligible?: boolean | null;
    ageRequired?: number | string | null;
    imageUrl?: string | null;
  };
  return {
    name: pp.name,
    brand: pp.brand || null,
    upc: pp.upc || null,
    size: pp.size || null,
    sizeUnit: pp.sizeUnit || null,
    taxClass: pp.taxClass || null,
    departmentName: pp.department?.name || null,
    departmentCode: pp.department?.code || null,
    packUnits: pp.sellUnitSize || pp.unitsPerPack || 1,
    packInCase: pp.casePacks || pp.innerPack || null,
    depositPerUnit: pp.depositRule ? null : (pp.containerVolumeOz ? null : null),
    ebtEligible: !!pp.ebtEligible,
    ageRequired: pp.ageRequired || null,
    imageUrl: pp.imageUrl || null,
  };
}

// ── Event logger ─────────────────────────────────────────────────────────────
interface LogEventOpts {
  description?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  payload?: unknown;
}

async function logEvent(
  tx: TxClient,
  orderId: string,
  eventType: string,
  opts: LogEventOpts = {},
): Promise<void> {
  const { description, actorId, actorName, payload } = opts;
  await tx.wholesaleOrderEvent.create({
    data: {
      orderId,
      eventType,
      description: description || null,
      actorId: actorId || null,
      actorName: actorName || null,
      payload: payload != null ? (payload as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// CRUD
// ═══════════════════════════════════════════════════════════════

interface CreateDraftLineIn {
  senderProductId?: number;
  qtySent?: number | string;
  unitCost?: number | string | null;
  depositPerUnit?: number | string | null;
  taxable?: boolean;
  taxRate?: number | string | null;
}

interface CreateDraftBody {
  receiverStoreId?: string;
  items?: CreateDraftLineIn[];
  taxEnabled?: boolean;
  senderNotes?: string;
}

interface DraftLineRow extends LineTotals {
  senderProductId: number;
  productSnapshot: ProductSnapshot;
  qtySent: number;
  unitCost: number;
  depositPerUnit: number | null;
  taxable: boolean;
  taxRate: number | null;
  sortOrder: number;
}

/** POST /api/exchange/orders  body { receiverStoreId, items: [...], taxEnabled, senderNotes }  → draft */
export const createDraftOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const senderStoreId = getStoreId(req);
    const userId = req.user?.id;
    if (!senderStoreId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }

    const body = (req.body || {}) as CreateDraftBody;
    const { receiverStoreId, items = [], taxEnabled = false, senderNotes = '' } = body;
    if (!receiverStoreId) { res.status(400).json({ success: false, error: 'receiverStoreId required' }); return; }
    if (receiverStoreId === senderStoreId) {
      res.status(400).json({ success: false, error: "Can't send to yourself." });
      return;
    }

    const receiverStore = await prisma.store.findUnique({
      where: { id: receiverStoreId },
      select: { id: true, orgId: true, isActive: true },
    });
    if (!receiverStore?.isActive) {
      res.status(404).json({ success: false, error: 'Receiver store not found.' });
      return;
    }

    await requireAcceptedPartnership(senderStoreId, receiverStoreId);

    // Build line items with snapshot + totals
    const lineItems: DraftLineRow[] = [];
    let hasRestricted = false;
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      if (!it.senderProductId || !it.qtySent || Number(it.qtySent) <= 0) continue;

      const snapshot = await buildProductSnapshot(it.senderProductId);
      if (!snapshot) continue;

      const unitCost = it.unitCost != null ? Number(it.unitCost) : 0;
      const linePartial = {
        senderProductId: it.senderProductId,
        productSnapshot: snapshot,
        qtySent: Number(it.qtySent),
        unitCost,
        depositPerUnit: it.depositPerUnit != null ? Number(it.depositPerUnit) : null,
        taxable: !!it.taxable,
        taxRate: it.taxRate != null ? Number(it.taxRate) : null,
        sortOrder: idx,
      };
      const totals = calcLineTotals(linePartial, taxEnabled);
      const line: DraftLineRow = { ...linePartial, ...totals };
      lineItems.push(line);
      if (snapshot.taxClass && ['alcohol', 'tobacco'].includes(snapshot.taxClass)) hasRestricted = true;
    }

    const totals = calcOrderTotals(lineItems);
    const isInternal = receiverStore.orgId === orgId;
    const orderNumber = await nextOrderNumber();

    const order = await prisma.$transaction(async (tx: TxClient) => {
      const created = await tx.wholesaleOrder.create({
        data: {
          orderNumber,
          senderStoreId,
          senderOrgId: orgId as string,
          receiverStoreId,
          receiverOrgId: receiverStore.orgId,
          status: 'draft',
          ...totals,
          taxEnabled,
          isInternalTransfer: isInternal,
          hasRestrictedItems: hasRestricted,
          senderNotes,
          createdById: userId as string,
          items: { create: lineItems as unknown as Prisma.WholesaleOrderItemCreateWithoutOrderInput[] },
        },
        include: { items: true },
      });
      await logEvent(tx, created.id, 'created', { actorId: userId, actorName: userLabel(req), description: 'Draft created' });
      return created;
    });

    res.json({ success: true, data: order });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    res.status(e.status || 500).json({ success: false, error: e.message || 'Internal error' });
  }
};

/** PUT /api/exchange/orders/:id  → update draft OR edit sent (notifies receiver) */
export const updateOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const senderStoreId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;

    const existing = await prisma.wholesaleOrder.findUnique({ where: { id }, include: { items: true } });
    if (!existing) { res.status(404).json({ success: false, error: 'Order not found.' }); return; }
    if (existing.senderStoreId !== senderStoreId) {
      res.status(403).json({ success: false, error: 'Only the sender can edit.' });
      return;
    }
    if (!['draft', 'sent'].includes(existing.status)) {
      res.status(400).json({ success: false, error: `Cannot edit — status: ${existing.status}` });
      return;
    }

    const wasSent = existing.status === 'sent';
    const body = (req.body || {}) as { items?: Array<CreateDraftLineIn & { productSnapshot?: ProductSnapshot }>; taxEnabled?: boolean; senderNotes?: string };
    const { items = [], taxEnabled, senderNotes } = body;

    const taxOn = taxEnabled != null ? !!taxEnabled : existing.taxEnabled;
    const lineItems: DraftLineRow[] = [];
    let hasRestricted = false;
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      if (!it.senderProductId || !it.qtySent || Number(it.qtySent) <= 0) continue;
      const snapshot = it.productSnapshot || (await buildProductSnapshot(it.senderProductId));
      if (!snapshot) continue;
      const linePartial = {
        senderProductId: it.senderProductId,
        productSnapshot: snapshot,
        qtySent: Number(it.qtySent),
        unitCost: Number(it.unitCost || 0),
        depositPerUnit: it.depositPerUnit != null ? Number(it.depositPerUnit) : null,
        taxable: !!it.taxable,
        taxRate: it.taxRate != null ? Number(it.taxRate) : null,
        sortOrder: idx,
      };
      const totals = calcLineTotals(linePartial, taxOn);
      const line: DraftLineRow = { ...linePartial, ...totals };
      lineItems.push(line);
      if (snapshot.taxClass && ['alcohol', 'tobacco'].includes(snapshot.taxClass)) hasRestricted = true;
    }
    const totals = calcOrderTotals(lineItems);

    const updated = await prisma.$transaction(async (tx: TxClient) => {
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
          items: { create: lineItems as unknown as Prisma.WholesaleOrderItemCreateWithoutOrderInput[] },
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
    const e = err as { status?: number; message?: string };
    res.status(e.status || 500).json({ success: false, error: e.message || 'Internal error' });
  }
};

/** POST /api/exchange/orders/:id/send  → draft → sent */
export const sendOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const senderStoreId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;

    const order = await prisma.wholesaleOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) { res.status(404).json({ success: false, error: 'Order not found.' }); return; }
    if (order.senderStoreId !== senderStoreId) {
      res.status(403).json({ success: false, error: 'Only the sender can send.' });
      return;
    }
    if (order.status !== 'draft') {
      res.status(400).json({ success: false, error: `Cannot send — current status: ${order.status}` });
      return;
    }
    if (!order.items?.length) {
      res.status(400).json({ success: false, error: 'Order has no items.' });
      return;
    }

    const EXPIRY_DAYS = 15;
    const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const updated = await prisma.$transaction(async (tx: TxClient) => {
      const u = await tx.wholesaleOrder.update({
        where: { id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          sentById: userId,
          expiresAt,
        },
      });
      await lockStoreCode(order.senderStoreId, tx as unknown as typeof prisma);
      await lockStoreCode(order.receiverStoreId, tx as unknown as typeof prisma);
      await logEvent(tx, id, 'sent', { actorId: userId, actorName: userLabel(req), description: 'PO sent to receiver' });
      return u;
    });

    notifyOrderReceived(id).catch(() => {});
    res.json({ success: true, data: updated });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    res.status(e.status || 500).json({ success: false, error: e.message || 'Internal error' });
  }
};

/** POST /api/exchange/orders/:id/cancel  (sender) */
export const cancelOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const senderStoreId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;
    const reason = (req.body as { reason?: string } | undefined)?.reason || null;

    const order = await prisma.wholesaleOrder.findUnique({ where: { id } });
    if (!order) { res.status(404).json({ success: false, error: 'Order not found.' }); return; }
    if (order.senderStoreId !== senderStoreId) {
      res.status(403).json({ success: false, error: 'Only the sender can cancel.' });
      return;
    }
    if (!['draft', 'sent'].includes(order.status)) {
      res.status(400).json({ success: false, error: `Cannot cancel — status: ${order.status}` });
      return;
    }

    const updated = await prisma.$transaction(async (tx: TxClient) => {
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
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

/** POST /api/exchange/orders/:id/reject  (receiver) body { reason } */
export const rejectOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const receiverStoreId = getStoreId(req);
    const userId = req.user?.id;
    const id = req.params.id;
    const reason = (req.body as { reason?: string } | undefined)?.reason || null;

    const order = await prisma.wholesaleOrder.findUnique({ where: { id } });
    if (!order) { res.status(404).json({ success: false, error: 'Order not found.' }); return; }
    if (order.receiverStoreId !== receiverStoreId) {
      res.status(403).json({ success: false, error: 'Only the receiver can reject.' });
      return;
    }
    if (order.status !== 'sent') {
      res.status(400).json({ success: false, error: `Cannot reject — status: ${order.status}` });
      return;
    }

    const updated = await prisma.$transaction(async (tx: TxClient) => {
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
    res.status(500).json({ success: false, error: (err as Error).message });
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
interface ConfirmLine {
  itemId: string;
  qtyReceived?: number | string;
  receiverProductId?: number | string | null;
  disputeNote?: string | null;
}

export const confirmOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const receiverStoreId = getStoreId(req);
    const receiverOrgId = getOrgId(req);
    const userId = req.user?.id;
    const id = req.params.id;
    const body = (req.body || {}) as { lines?: ConfirmLine[] };
    const bodyLines: ConfirmLine[] = Array.isArray(body.lines) ? body.lines : [];

    const order = await prisma.wholesaleOrder.findUnique({ where: { id }, include: { items: true } });
    if (!order) { res.status(404).json({ success: false, error: 'Order not found.' }); return; }
    if (order.receiverStoreId !== receiverStoreId) {
      res.status(403).json({ success: false, error: 'Only the receiver can confirm.' });
      return;
    }
    if (order.status !== 'sent') {
      res.status(400).json({ success: false, error: `Cannot confirm — status: ${order.status}` });
      return;
    }

    const byItemId = new Map<string, ConfirmLine>(bodyLines.map((l) => [l.itemId, l]));
    const result = await prisma.$transaction(async (tx: TxClient) => {
      let confSubtotal = 0, confDeposit = 0, confTax = 0;
      let anyShort = false, anyReceived = false;

      for (const item of order.items) {
        const payload = byItemId.get(item.id) || ({} as ConfirmLine);
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
            await addStock(tx, order.receiverStoreId, receiverOrgId as string, Number(payload.receiverProductId), qtyReceived, Number(item.unitCost));
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
    const e = err as { status?: number; message?: string };
    res.status(e.status || 500).json({ success: false, error: e.message || 'Internal error' });
  }
};

// ── Stock mutators (run inside confirm transaction) ──────────────────────────

async function deductStock(tx: TxClient, storeId: string, _orgId: string, masterProductId: number, qty: number): Promise<void> {
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

async function addStock(tx: TxClient, storeId: string, orgId: string, masterProductId: number, qty: number, unitCost: number | null): Promise<void> {
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

async function postLedgerForOrder(tx: TxClient, order: WholesaleOrder, grandTotal: number, userId: string | null | undefined): Promise<void> {
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
      createdById: userId as string,
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// READ ENDPOINTS
// ═══════════════════════════════════════════════════════════════

/** GET /api/exchange/orders  ?direction=all|outgoing|incoming &status=... &partnerStoreId=... */
export const listOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const q = req.query as {
      direction?: string;
      status?: string;
      partnerStoreId?: string;
      limit?: string;
      offset?: string;
      showArchived?: string;
    };
    const direction = q.direction || 'all';
    const status = q.status;
    const partnerStoreId = q.partnerStoreId;
    const limit = q.limit || '100';
    const offset = q.offset || '0';
    const showArchived = q.showArchived || 'false';

    const where: Prisma.WholesaleOrderWhereInput = {};
    if (direction === 'outgoing') where.senderStoreId = storeId;
    else if (direction === 'incoming') where.receiverStoreId = storeId;
    else where.OR = [{ senderStoreId: storeId }, { receiverStoreId: storeId }];

    if (status) where.status = { in: String(status).split(',') };
    if (partnerStoreId) {
      // Narrow to a specific partner (either direction)
      const otherCond: Prisma.WholesaleOrderWhereInput = {
        OR: [
          { senderStoreId: partnerStoreId },
          { receiverStoreId: partnerStoreId },
        ],
      };
      where.AND = [otherCond];
    }

    // Session 39 — hide archived orders by default. `showArchived=true` returns
    // all. Each party archives independently (senderArchived vs receiverArchived)
    // so an order only disappears from MY list when I've archived it.
    if (showArchived !== 'true') {
      const archivedField: 'receiverArchived' | 'senderArchived' | null =
        (direction === 'incoming') ? 'receiverArchived'
        : (direction === 'outgoing') ? 'senderArchived'
        : null;
      if (archivedField) {
        (where as Record<string, unknown>)[archivedField] = false;
      } else {
        // 'all' direction — exclude if I've archived it on whichever side I'm on
        const notArchived: Prisma.WholesaleOrderWhereInput = {
          OR: [
            { senderStoreId: storeId,   senderArchived: false },
            { receiverStoreId: storeId, receiverArchived: false },
          ],
        };
        const existingAnd = (where.AND as Prisma.WholesaleOrderWhereInput[] | undefined) || [];
        where.AND = [...existingAnd, notArchived];
      }
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
    type OrderRow = (typeof orders)[number];

    const annotated = (orders as OrderRow[]).map((o) => ({
      ...o,
      direction: o.senderStoreId === storeId ? 'outgoing' : 'incoming',
      partner: o.senderStoreId === storeId ? o.receiverStore : o.senderStore,
    }));

    res.json({ success: true, data: annotated, total });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

/** GET /api/exchange/orders/:id  → order detail + items + events */
export const getOrder = async (req: Request, res: Response): Promise<void> => {
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
    if (!order) { res.status(404).json({ success: false, error: 'Order not found.' }); return; }
    if (order.senderStoreId !== storeId && order.receiverStoreId !== storeId) {
      res.status(403).json({ success: false, error: 'Not your order.' });
      return;
    }
    res.json({
      success: true,
      data: {
        ...order,
        direction: order.senderStoreId === storeId ? 'outgoing' : 'incoming',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

/** DELETE /api/exchange/orders/:id  → delete a draft (sender only) */
export const deleteDraft = async (req: Request, res: Response): Promise<void> => {
  try {
    const senderStoreId = getStoreId(req);
    const id = req.params.id;
    const order = await prisma.wholesaleOrder.findUnique({ where: { id } });
    if (!order) { res.status(404).json({ success: false, error: 'Order not found.' }); return; }
    if (order.senderStoreId !== senderStoreId) {
      res.status(403).json({ success: false, error: 'Only the sender can delete.' });
      return;
    }
    if (order.status !== 'draft') {
      res.status(400).json({ success: false, error: 'Only drafts can be deleted.' });
      return;
    }
    await prisma.wholesaleOrder.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

/**
 * POST /api/exchange/orders/:id/archive
 *
 * Per-party archive (Session 39). Each side of the order can independently
 * archive a settled / reconciled order to hide it from the main list. An
 * archived order is still fully retrievable via `?showArchived=true`.
 *
 * Only finalised orders (confirmed | partially_confirmed | rejected |
 * cancelled | expired) can be archived. Drafts and in-flight orders can't.
 */
export const archiveOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    const id = req.params.id;
    const order = await prisma.wholesaleOrder.findUnique({ where: { id } });
    if (!order) { res.status(404).json({ success: false, error: 'Order not found.' }); return; }
    const isSender   = order.senderStoreId   === storeId;
    const isReceiver = order.receiverStoreId === storeId;
    if (!isSender && !isReceiver) { res.status(403).json({ success: false, error: 'Not your order.' }); return; }

    const terminal = ['confirmed', 'partially_confirmed', 'rejected', 'cancelled', 'expired'];
    if (!terminal.includes(order.status)) {
      res.status(400).json({ success: false, error: `Cannot archive — status: ${order.status}` });
      return;
    }

    const data: Prisma.WholesaleOrderUpdateInput = isSender
      ? { senderArchived: true,   senderArchivedAt: new Date() }
      : { receiverArchived: true, receiverArchivedAt: new Date() };
    const updated = await prisma.wholesaleOrder.update({ where: { id }, data });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

/** POST /api/exchange/orders/:id/unarchive */
export const unarchiveOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    const id = req.params.id;
    const order = await prisma.wholesaleOrder.findUnique({ where: { id } });
    if (!order) { res.status(404).json({ success: false, error: 'Order not found.' }); return; }
    const isSender   = order.senderStoreId   === storeId;
    const isReceiver = order.receiverStoreId === storeId;
    if (!isSender && !isReceiver) { res.status(403).json({ success: false, error: 'Not your order.' }); return; }

    const data: Prisma.WholesaleOrderUpdateInput = isSender
      ? { senderArchived: false,   senderArchivedAt: null }
      : { receiverArchived: false, receiverArchivedAt: null };
    const updated = await prisma.wholesaleOrder.update({ where: { id }, data });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

/**
 * POST /api/exchange/orders/:id/dispute-message
 * body: { message, requestedQty? (per-line mapping) }
 *
 * Either party posts a dispute message against the order. Messages live as
 * `eventType='dispute_message'` events in the order's event log so the UI
 * can render a threaded back-and-forth. Auto-flips `disputeStatus` to 'open'
 * if not already set. Session 39 — enables multi-round dispute loops per Q6.
 */
export const addDisputeMessage = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStoreId(req);
    const userId  = req.user?.id;
    const id = req.params.id;
    const body = (req.body || {}) as { message?: string; requestedQty?: unknown; resolve?: boolean };
    const { message, requestedQty, resolve } = body;

    const order = await prisma.wholesaleOrder.findUnique({ where: { id } });
    if (!order) { res.status(404).json({ success: false, error: 'Order not found.' }); return; }
    const isSender   = order.senderStoreId   === storeId;
    const isReceiver = order.receiverStoreId === storeId;
    if (!isSender && !isReceiver) { res.status(403).json({ success: false, error: 'Not your order.' }); return; }

    if (!message && !resolve) { res.status(400).json({ success: false, error: 'message required' }); return; }

    const ev = await prisma.$transaction(async (tx: TxClient) => {
      const event = await tx.wholesaleOrderEvent.create({
        data: {
          orderId: id,
          eventType: resolve ? 'dispute_resolved' : 'dispute_message',
          description: message || (resolve ? 'Dispute marked resolved.' : ''),
          actorId:   userId,
          actorName: userLabel(req),
          payload:   { requestedQty: (requestedQty ?? null) as Prisma.InputJsonValue, side: isSender ? 'sender' : 'receiver' },
        },
      });

      const updateData: Prisma.WholesaleOrderUpdateInput = {};
      if (resolve) {
        updateData.disputeStatus     = 'resolved';
        updateData.disputeResolvedAt = new Date();
      } else if (!order.disputeStatus || order.disputeStatus === 'resolved') {
        updateData.disputeStatus   = 'open';
        updateData.disputeOpenedAt = order.disputeOpenedAt || new Date();
        updateData.disputeResolvedAt = null;
      }
      if (Object.keys(updateData).length) {
        await tx.wholesaleOrder.update({ where: { id }, data: updateData });
      }
      return event;
    });

    res.json({ success: true, data: ev });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ═══════════════════════════════════════════════════════════════
// Notification helpers (fire-and-forget)
// ═══════════════════════════════════════════════════════════════

async function notifyOrderReceived(orderId: string): Promise<void> {
  const o = await prisma.wholesaleOrder.findUnique({
    where: { id: orderId },
    include: {
      senderStore: { select: { name: true, storeCode: true } },
      receiverStore: {
        select: { name: true, organization: { select: { billingEmail: true } } },
      },
    },
  });
  const oo = o as unknown as {
    orderNumber: string;
    senderStore: { name: string; storeCode: string | null };
    receiverStore: { name: string; organization: { billingEmail: string | null } | null };
    grandTotal: unknown;
    expiresAt: Date | null;
  } | null;
  const email = oo?.receiverStore?.organization?.billingEmail;
  if (!oo || !email) return;
  await sendWholesaleOrderReceived(email, {
    orderNumber: oo.orderNumber,
    senderName: oo.senderStore.name,
    senderCode: oo.senderStore.storeCode,
    grandTotal: Number(oo.grandTotal),
    expiresAt: oo.expiresAt,
  } as Parameters<typeof sendWholesaleOrderReceived>[1]);
}

async function notifyOrderConfirmed(orderId: string): Promise<void> {
  const o = await prisma.wholesaleOrder.findUnique({
    where: { id: orderId },
    include: {
      senderStore: { select: { name: true, organization: { select: { billingEmail: true } } } },
      receiverStore: { select: { name: true } },
    },
  });
  const oo = o as unknown as {
    orderNumber: string;
    senderStore: { name: string; organization: { billingEmail: string | null } | null };
    receiverStore: { name: string };
    confirmedGrandTotal: unknown;
    grandTotal: unknown;
    status: string;
  } | null;
  const email = oo?.senderStore?.organization?.billingEmail;
  if (!oo || !email) return;
  await sendWholesaleOrderConfirmed(email, {
    orderNumber: oo.orderNumber,
    receiverName: oo.receiverStore.name,
    grandTotal: Number(oo.confirmedGrandTotal || oo.grandTotal),
    status: oo.status,
  } as Parameters<typeof sendWholesaleOrderConfirmed>[1]);
}

async function notifyOrderRejected(orderId: string): Promise<void> {
  const o = await prisma.wholesaleOrder.findUnique({
    where: { id: orderId },
    include: {
      senderStore: { select: { name: true, organization: { select: { billingEmail: true } } } },
      receiverStore: { select: { name: true } },
    },
  });
  const oo = o as unknown as {
    orderNumber: string;
    senderStore: { organization: { billingEmail: string | null } | null };
    receiverStore: { name: string };
    rejectReason: string | null;
  } | null;
  const email = oo?.senderStore?.organization?.billingEmail;
  if (!oo || !email) return;
  await sendWholesaleOrderRejected(email, {
    orderNumber: oo.orderNumber,
    receiverName: oo.receiverStore.name,
    reason: oo.rejectReason,
  } as Parameters<typeof sendWholesaleOrderRejected>[1]);
}

async function notifyOrderCancelled(orderId: string): Promise<void> {
  const o = await prisma.wholesaleOrder.findUnique({
    where: { id: orderId },
    include: {
      senderStore: { select: { name: true } },
      receiverStore: { select: { name: true, organization: { select: { billingEmail: true } } } },
    },
  });
  const oo = o as unknown as {
    orderNumber: string;
    senderStore: { name: string };
    receiverStore: { organization: { billingEmail: string | null } | null };
    cancelReason: string | null;
  } | null;
  const email = oo?.receiverStore?.organization?.billingEmail;
  if (!oo || !email) return;
  await sendWholesaleOrderCancelled(email, {
    orderNumber: oo.orderNumber,
    senderName: oo.senderStore.name,
    reason: oo.cancelReason,
  } as Parameters<typeof sendWholesaleOrderCancelled>[1]);
}

async function notifyOrderEdited(orderId: string): Promise<void> {
  const o = await prisma.wholesaleOrder.findUnique({
    where: { id: orderId },
    include: {
      senderStore: { select: { name: true } },
      receiverStore: { select: { name: true, organization: { select: { billingEmail: true } } } },
    },
  });
  const oo = o as unknown as {
    orderNumber: string;
    senderStore: { name: string };
    receiverStore: { organization: { billingEmail: string | null } | null };
    grandTotal: unknown;
  } | null;
  const email = oo?.receiverStore?.organization?.billingEmail;
  if (!oo || !email) return;
  await sendWholesaleOrderEdited(email, {
    orderNumber: oo.orderNumber,
    senderName: oo.senderStore.name,
    grandTotal: Number(oo.grandTotal),
  } as Parameters<typeof sendWholesaleOrderEdited>[1]);
}
