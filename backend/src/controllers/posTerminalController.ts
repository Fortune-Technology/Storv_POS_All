/**
 * POS Terminal Controller
 * Handles cashier-facing operations: catalog snapshot, transactions, session.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import {
  processTransactionPoints,
  reverseTransactionPoints,
} from '../services/loyaltyService.js';
import {
  applyChargeTender as _applyChargeTender,
  refundChargeOnTx  as _refundChargeOnTx,
  sumChargeTender   as _sumChargeTender,
} from '../services/chargeAccountService.js';
import { logAudit } from '../services/auditService.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const getOrgId = (req: Request): string | null | undefined =>
  req.orgId || req.user?.orgId;

interface CartLineItem {
  productId?: number | string | null;
  qty?: number | string | null;
  isLottery?: boolean;
  isFuel?: boolean;
  isBottleReturn?: boolean;
  [k: string]: unknown;
}

interface TenderLine {
  method?: string | null;
  amount?: number | string | null;
  [k: string]: unknown;
}

interface LotteryItem {
  type?: string;
  amount?: number | string | null;
  gameId?: string | null;
  notes?: string | null;
  [k: string]: unknown;
}

interface FuelItem {
  type?: string;
  fuelTypeId?: string | null;
  fuelTypeName?: string | null;
  gallons?: number | string | null;
  pricePerGallon?: number | string | null;
  amount?: number | string | null;
  entryMode?: string;
  taxAmount?: number | string | null;
  notes?: string | null;
  pumpId?: string | null;
  refundsOf?: string | null;
  fifoLayers?: FifoLayer[] | null;
  tankId?: string | null;
}

interface FifoLayer {
  gallons?: number | string | null;
  cost?: number | string | null;
  [k: string]: unknown;
}

interface CouponRedemptionPayload {
  serial?: string;
  couponSerial?: string;
  couponId?: string | null;
  brandFamily?: string | null;
  manufacturerId?: string | null;
  discountApplied?: number | string | null;
  qualifyingUpc?: string | null;
  qualifyingQty?: number | string | null;
  managerApprovedById?: string | null;
}

// Charge-account helpers are now in services/chargeAccountService.js — see imports above.

// ── GET /api/pos-terminal/catalog/snapshot ─────────────────────────────────
// Returns flat denormalised product list for IndexedDB seeding.
// Supports ?updatedSince=ISO for incremental sync.
//
// Tombstones: when `since` is supplied (incremental sync), the response also
// includes deleted/inactive products updated since that timestamp, marked with
// `_deleted: true`. The cashier-app uses these to purge stale rows from the
// local IndexedDB cache. Without this, soft-deleted products would persist
// forever in the local cache.
export const getCatalogSnapshot = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId      = getOrgId(req);
    const q = req.query as { storeId?: string; updatedSince?: string; page?: string; limit?: string };
    const storeId    = q.storeId;
    const since      = q.updatedSince ? new Date(q.updatedSince) : null;
    const page       = parseInt(q.page || '1') || 1;
    const limit      = Math.min(parseInt(q.limit || '500') || 500, 500);
    const skip       = (page - 1) * limit;

    const where: Prisma.MasterProductWhereInput = {
      orgId: orgId ?? undefined,
      active: true,
      deleted: false,
      ...(since && { updatedAt: { gte: since } }),
    };

    const [total, products, tombstones] = await Promise.all([
      prisma.masterProduct.count({ where }),
      prisma.masterProduct.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          department:  { select: { id: true, name: true, color: true, taxClass: true, ebtEligible: true } },
          depositRule: { select: { id: true, name: true, depositAmount: true } },
          storeProducts: storeId ? {
            where:  { storeId, active: true },
            select: { retailPrice: true, costPrice: true, active: true, inStock: true, quantityOnHand: true },
            take:   1,
          } : false,
          // Cashier pack-size picker — when a scanned product has 2+ pack sizes
          // configured (e.g. single can / 6-pack / 12-pack), the cashier-app
          // shows PackSizePickerModal instead of adding a default. Without
          // including this here, the snapshot would lack packSizes and the
          // picker logic in POSScreen.handleScan would silently never fire.
          packSizes: {
            select: { id: true, label: true, unitCount: true, packsPerCase: true, retailPrice: true, isDefault: true, sortOrder: true },
            orderBy: { sortOrder: 'asc' },
          },
          // Alternate UPCs — same product, different barcodes (case label vs
          // single-can label, manufacturer rebrand, regional variants). The
          // cashier-app indexes both the primary `upc` AND every entry from
          // this list so a scan / search of any registered barcode resolves
          // to the same product.
          upcs: { select: { upc: true } },
        },
      }),
      // Only fetch tombstones on incremental syncs (since != null) AND on the
      // FIRST page. They're sent once at the head of the paginated stream.
      since && page === 1
        ? prisma.masterProduct.findMany({
            where: {
              orgId: orgId ?? undefined,
              updatedAt: { gte: since },
              OR: [{ deleted: true }, { active: false }],
            },
            select: { id: true, updatedAt: true },
          })
        : Promise.resolve([]),
    ]);

    // Flatten into the shape the POS app caches in IndexedDB
    type ProductRow = (typeof products)[number];
    interface PackSizeRow {
      id: string;
      label: string | null;
      unitCount: number;
      packsPerCase: number | null;
      retailPrice: unknown;
      isDefault: boolean;
      sortOrder: number;
    }
    const flat = (products as ProductRow[]).map((p) => {
      const sp = p.storeProducts?.[0];
      const pp = p as unknown as ProductRow & {
        unitPack?: number | null;
        packInCase?: number | null;
        depositPerUnit?: unknown;
        caseDeposit?: unknown;
        packSizes?: PackSizeRow[];
        upcs?: { upc: string | null }[];
        depositRule?: { depositAmount: unknown } | null;
        depositRuleId?: string | null;
        taxRuleId?: string | null;
      };
      return {
        id:             p.id,
        upc:            p.upc,
        name:           p.name,
        brand:          p.brand,
        size:           p.size,
        sizeUnit:       p.sizeUnit,
        sellUnit:       p.sellUnit,
        sellUnitSize:   p.sellUnitSize,
        casePacks:      p.casePacks,
        retailPrice:    sp?.retailPrice != null ? Number(sp.retailPrice) : (p.defaultRetailPrice != null ? Number(p.defaultRetailPrice) : null),
        quantityOnHand: sp?.quantityOnHand != null ? Number(sp.quantityOnHand) : null,
        taxable:        p.taxable,
        // Session 40 Phase 1 — strict-FK tax. Both fields sent so the cashier's
        // selectTotals can try taxRuleId first, then dept-linked rule, then
        // fall back to taxClass string match.
        taxRuleId:      pp.taxRuleId || null,
        taxClass:       p.taxClass || p.department?.taxClass || 'grocery',
        ebtEligible:    p.ebtEligible || p.department?.ebtEligible || false,
        ageRequired:    p.ageRequired,
        // Deposit — emits per-sell-pack $ (see legacy js file for full notes).
        depositAmount: (() => {
          const sellPackUnits =
            pp.unitPack     != null && Number(pp.unitPack)     > 0 ? Number(pp.unitPack)     :
            p.sellUnitSize != null && Number(p.sellUnitSize) > 0 ? Number(p.sellUnitSize) :
            1;

          const packsPerCase =
            pp.packInCase != null && Number(pp.packInCase) > 0 ? Number(pp.packInCase) :
            p.casePacks  != null && Number(p.casePacks)  > 0 ? Number(p.casePacks)  :
            null;

          if (pp.depositPerUnit != null) {
            return Number(pp.depositPerUnit) * sellPackUnits;
          }

          if (pp.caseDeposit != null && packsPerCase) {
            return Number(pp.caseDeposit) / packsPerCase;
          }

          if (pp.depositRule) {
            return Number(pp.depositRule.depositAmount) * sellPackUnits;
          }

          return null;
        })(),
        depositRuleId:  pp.depositRuleId,
        departmentId:   p.departmentId,
        departmentName: p.department?.name || null,
        active:         sp ? sp.active : p.active,
        inStock:        sp ? sp.inStock : true,
        // Pack sizes for the cashier picker
        packSizes: (pp.packSizes || []).map((ps: PackSizeRow) => ({
          id:           ps.id,
          label:        ps.label,
          unitCount:    ps.unitCount,
          packsPerCase: ps.packsPerCase,
          retailPrice:  Number(ps.retailPrice),
          isDefault:    ps.isDefault,
          sortOrder:    ps.sortOrder,
        })),
        // Flat array of alternate UPC strings only.
        upcs: (pp.upcs || []).map((u: { upc: string | null }) => u.upc).filter(Boolean),
        orgId,
        storeId:        storeId || null,
        updatedAt:      p.updatedAt.toISOString(),
      };
    });

    // Tombstones — IDs of products to remove from the local cache.
    // Only present on the first page of an incremental sync.
    type TombRow = { id: number };
    const deleted = ((tombstones || []) as TombRow[]).map((t) => t.id);

    res.json({
      data:  flat,
      deleted,
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── GET /api/pos-terminal/catalog/active-ids ──────────────────────────────
export const getCatalogActiveIds = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const rows = await prisma.masterProduct.findMany({
      where:  { orgId: orgId ?? undefined, active: true, deleted: false },
      select: { id: true },
    });
    type Row = (typeof rows)[number];
    res.json({
      activeIds: (rows as Row[]).map((r) => r.id),
      count:     rows.length,
      syncedAt:  new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── GET /api/pos-terminal/deposit-rules ────────────────────────────────────
export const getDepositRules = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const rules = await prisma.depositRule.findMany({
      where: { orgId: orgId ?? undefined, active: true },
      orderBy: { minVolumeOz: 'asc' },
    });
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── GET /api/pos-terminal/tax-rules ───────────────────────────────────────
export const getTaxRules = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const rules = await prisma.taxRule.findMany({
      where: { orgId: orgId ?? undefined, active: true },
    });
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── POST /api/pos-terminal/transactions ───────────────────────────────────
interface CreateTxBody {
  storeId?: string;
  stationId?: string | null;
  lineItems?: CartLineItem[];
  lotteryItems?: LotteryItem[];
  fuelItems?: FuelItem[];
  couponRedemptions?: CouponRedemptionPayload[];
  tenderLines?: TenderLine[];
  ageVerifications?: unknown;
  notes?: string | null;
  subtotal?: number | string;
  taxTotal?: number | string;
  depositTotal?: number | string;
  ebtTotal?: number | string;
  grandTotal?: number | string;
  changeGiven?: number | string;
  offlineCreatedAt?: string | Date | null;
  status?: string;
  shiftId?: string | null;
  customerId?: string | null;
  loyaltyPointsRedeemed?: number | string | null;
}

export const createTransaction = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as CreateTxBody;
    const {
      storeId, stationId,
      lineItems, lotteryItems, fuelItems, couponRedemptions,
      tenderLines, ageVerifications, notes,
      subtotal, taxTotal, depositTotal, ebtTotal, grandTotal, changeGiven,
      offlineCreatedAt,
      shiftId,
      customerId, loyaltyPointsRedeemed,
    } = body;

    if (!storeId) { res.status(400).json({ error: 'storeId required' }); return; }
    // Allow lottery-only transactions (no regular lineItems)
    if (!lineItems?.length && !lotteryItems?.length && !fuelItems?.length) {
      res.status(400).json({ error: 'lineItems, lotteryItems, or fuelItems required' });
      return;
    }

    // ── Charge-account tender validation ──────────────────────────────────
    const chargeAmount = _sumChargeTender(tenderLines as Parameters<typeof _sumChargeTender>[0]);
    if (chargeAmount > 0) {
      const r = await _applyChargeTender({ orgId: orgId as string, customerId, chargeAmount } as Parameters<typeof _applyChargeTender>[0]);
      if (!r.ok) { res.status(400).json({ error: r.error }); return; }
    }

    // Generate a human-readable transaction number
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const count = await prisma.transaction.count({ where: { orgId: orgId ?? undefined, storeId } });
    const txNumber = `TXN-${dateStr}-${String(count + 1).padStart(6, '0')}`;

    const tx = await prisma.transaction.create({
      data: {
        orgId: orgId as string,
        storeId,
        cashierId:       req.user!.id,
        stationId:       stationId || null,
        // shiftId intentionally not stored — Transaction model has no shiftId
        // column. Shift reports query by `createdAt >= shift.openedAt` instead.
        txNumber,
        // Force 'complete' — the cashier-app's offline txQueue marks rows as
        // 'pending' (a LOCAL sync flag, not a real tx state). Honoring it
        // would hide cash sales from EoD/Daily reports.
        status:          'complete',
        lineItems:       (lineItems || []) as unknown as Prisma.InputJsonValue,
        subtotal:        parseFloat(String(subtotal))     || 0,
        taxTotal:        parseFloat(String(taxTotal))     || 0,
        depositTotal:    parseFloat(String(depositTotal)) || 0,
        ebtTotal:        parseFloat(String(ebtTotal))     || 0,
        grandTotal:      parseFloat(String(grandTotal))   || 0,
        tenderLines:     (tenderLines || []) as unknown as Prisma.InputJsonValue,
        changeGiven:     parseFloat(String(changeGiven))  || 0,
        ageVerifications: (ageVerifications || null) as Prisma.InputJsonValue | null,
        notes:           notes || null,
        offlineCreatedAt: offlineCreatedAt ? new Date(offlineCreatedAt) : null,
        syncedAt:        new Date(),
      },
    });

    // ── Award / deduct loyalty points (fire-and-forget) ───────────────────
    if (customerId) {
      processTransactionPoints({
        orgId: orgId as string, storeId, customerId,
        lineItems: (lineItems || []) as unknown as Parameters<typeof processTransactionPoints>[0]['lineItems'],
        txId:      tx.id, txNumber,
        loyaltyPointsRedeemed: parseInt(String(loyaltyPointsRedeemed)) || 0,
      } as Parameters<typeof processTransactionPoints>[0]).catch((err: Error) => console.error('[loyalty] points error:', err.message));
    }

    // ── Save manufacturer coupon redemptions if present ───────────────────
    if (Array.isArray(couponRedemptions) && couponRedemptions.length) {
      try {
        await prisma.couponRedemption.createMany({
          data: couponRedemptions.map((r) => ({
            orgId: orgId as string,
            storeId,
            transactionId:       tx.id,
            couponId:            r.couponId || null,
            couponSerial:        String(r.serial || r.couponSerial || ''),
            brandFamily:         r.brandFamily || null,
            manufacturerId:      r.manufacturerId || null,
            discountApplied:     parseFloat(String(r.discountApplied)) || 0,
            qualifyingUpc:       r.qualifyingUpc || null,
            qualifyingQty:       r.qualifyingQty != null ? Number(r.qualifyingQty) : null,
            cashierId:           req.user!.id,
            managerApprovedById: r.managerApprovedById || null,
          })),
        });
      } catch (err) {
        console.error('[createTransaction] coupon redemption error:', (err as Error).message);
      }
    }

    // ── Save lottery transactions if present ──────────────────────────────
    if (Array.isArray(lotteryItems) && lotteryItems.length) {
      await prisma.lotteryTransaction.createMany({
        data: lotteryItems.map((li) => ({
          orgId: orgId as string,
          storeId,
          shiftId:         shiftId || null,
          cashierId:       req.user!.id,
          stationId:       stationId || null,
          type:            li.type === 'payout' ? 'payout' : 'sale',
          amount:          Math.abs(parseFloat(String(li.amount)) || 0),
          gameId:          li.gameId || null,
          notes:           li.notes || null,
          posTransactionId: tx.id,
        })),
      });
    }

    // ── Save fuel transactions if present ─────────────────────────────────
    if (Array.isArray(fuelItems) && fuelItems.length) {
      const { applySale, applyRefund } = await import('../services/fuelInventory.js');
      for (const fi of fuelItems) {
        const gallons = Math.abs(parseFloat(String(fi.gallons)) || 0);
        let tankId: string | null = null;
        let fifoLayers: FifoLayer[] | null = null;
        let pumpId = fi.pumpId || null;

        if (fi.type === 'refund') {
          // V1.5: Pump-aware refund — when cashier refunds by picking an
          // original sale, the cashier-app passes `refundsOf` (original tx id).
          let refundCtx: { fifoLayers: FifoLayer[] | null; tankId: string | null } = {
            fifoLayers: Array.isArray(fi.fifoLayers) ? fi.fifoLayers : null,
            tankId: fi.tankId || null,
          };
          if (fi.refundsOf) {
            const original = await prisma.fuelTransaction.findUnique({
              where: { id: fi.refundsOf },
              select: { pumpId: true, tankId: true, fifoLayers: true, fuelTypeId: true, orgId: true, storeId: true },
            });
            if (original && original.orgId === orgId && original.storeId === storeId) {
              const origLayers = (Array.isArray(original.fifoLayers) ? original.fifoLayers : []) as unknown as FifoLayer[];
              const originalGallons = origLayers.reduce((s, l) => s + Number(l.gallons || 0), 0);
              if (originalGallons > 0 && gallons > 0 && gallons <= originalGallons + 0.001) {
                const scale = gallons / originalGallons;
                refundCtx = {
                  fifoLayers: origLayers.map((l) => ({
                    ...l,
                    gallons: Number(l.gallons) * scale,
                    cost:    Number(l.cost || 0) * scale,
                  })),
                  tankId: original.tankId,
                };
              } else {
                refundCtx = { fifoLayers: origLayers, tankId: original.tankId };
              }
              pumpId = pumpId || original.pumpId;
              tankId = original.tankId;
            }
          }
          if (Array.isArray(refundCtx.fifoLayers) && refundCtx.fifoLayers.length) {
            await applyRefund({ fifoLayers: refundCtx.fifoLayers, tankId: refundCtx.tankId, gallons } as unknown as Parameters<typeof applyRefund>[0]);
            fifoLayers = refundCtx.fifoLayers;
            tankId     = refundCtx.tankId || null;
          }
        } else if (fi.fuelTypeId) {
          const r = await applySale({
            orgId: orgId as string, storeId,
            fuelTypeId: fi.fuelTypeId,
            gallons,
            pumpId,
          } as Parameters<typeof applySale>[0]) as unknown as { primaryTankId: string | null; fifoLayers: FifoLayer[] };
          tankId     = r.primaryTankId;
          fifoLayers = r.fifoLayers;
        }

        await prisma.fuelTransaction.create({
          data: {
            orgId: orgId as string,
            storeId,
            shiftId:          shiftId || null,
            cashierId:        req.user!.id,
            stationId:        stationId || null,
            type:             fi.type === 'refund' ? 'refund' : 'sale',
            fuelTypeId:       fi.fuelTypeId || null,
            fuelTypeName:     fi.fuelTypeName || 'Fuel',
            gallons,
            pricePerGallon:   Math.abs(parseFloat(String(fi.pricePerGallon)) || 0),
            amount:           Math.abs(parseFloat(String(fi.amount)) || 0),
            entryMode:        fi.entryMode === 'gallons' ? 'gallons' : 'amount',
            taxAmount:        fi.taxAmount != null ? parseFloat(String(fi.taxAmount)) : null,
            notes:            fi.notes || null,
            posTransactionId: tx.id,
            tankId,
            fifoLayers:       (fifoLayers || undefined) as unknown as Prisma.InputJsonValue | undefined,
            pumpId,
            refundsOf:        fi.refundsOf || null,
          },
        });
      }
    }

    // ── Deduct stock for each sold line item (fire-and-forget) ────────────
    if (Array.isArray(lineItems) && lineItems.length) {
      const stockUpdates = lineItems
        .filter((li) => li.productId && !li.isLottery && !li.isFuel && !li.isBottleReturn && Number(li.qty) > 0)
        .map((li) =>
          prisma.storeProduct.updateMany({
            where: { storeId, masterProductId: Number(li.productId), orgId: orgId ?? undefined },
            data:  {
              quantityOnHand: { decrement: Number(li.qty) },
              lastStockUpdate: new Date(),
            },
          }),
        );
      // Non-blocking — don't hold up the response if stock update fails
      Promise.all(stockUpdates).catch((err: Error) =>
        console.error('[createTransaction] stock deduction error:', err.message),
      );
    }

    res.status(201).json(tx);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── POST /api/pos-terminal/transactions/batch ─────────────────────────────
interface BatchTx extends CreateTxBody {
  localId?: string | number;
  txNumber?: string;
}

export const batchCreateTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as { transactions?: BatchTx[] };
    const { transactions } = body;

    if (!Array.isArray(transactions) || !transactions.length) {
      res.status(400).json({ error: 'transactions array required' });
      return;
    }

    interface BatchResult { localId?: string | number; id: string; txNumber: string }
    interface BatchError { localId?: string | number; error: string }
    const results: BatchResult[] = [];
    const errors: BatchError[]  = [];

    for (const tx of transactions) {
      try {
        const chargeAmount = _sumChargeTender(tx.tenderLines as Parameters<typeof _sumChargeTender>[0]);
        if (chargeAmount > 0) {
          const r = await _applyChargeTender({ orgId: orgId as string, customerId: tx.customerId, chargeAmount } as Parameters<typeof _applyChargeTender>[0]);
          if (!r.ok) {
            errors.push({ localId: tx.localId, error: r.error || 'charge failed' });
            continue;
          }
        }

        const today = new Date(tx.offlineCreatedAt || Date.now());
        const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
        const count = await prisma.transaction.count({ where: { orgId: orgId ?? undefined, storeId: tx.storeId } });
        const txNumber = tx.txNumber || `TXN-${dateStr}-${String(count + 1).padStart(6, '0')}`;

        const saved = await prisma.transaction.create({
          data: {
            orgId: orgId as string,
            storeId:          tx.storeId as string,
            cashierId:        req.user!.id,
            stationId:        tx.stationId || null,
            txNumber,
            // Force 'complete' — see comment in createTransaction.
            status:           'complete',
            lineItems:        (tx.lineItems || []) as unknown as Prisma.InputJsonValue,
            subtotal:         parseFloat(String(tx.subtotal))     || 0,
            taxTotal:         parseFloat(String(tx.taxTotal))     || 0,
            depositTotal:     parseFloat(String(tx.depositTotal)) || 0,
            ebtTotal:         parseFloat(String(tx.ebtTotal))     || 0,
            grandTotal:       parseFloat(String(tx.grandTotal))   || 0,
            tenderLines:      (tx.tenderLines || []) as unknown as Prisma.InputJsonValue,
            changeGiven:      parseFloat(String(tx.changeGiven))  || 0,
            ageVerifications: (tx.ageVerifications || null) as Prisma.InputJsonValue | null,
            notes:            tx.notes || null,
            offlineCreatedAt: tx.offlineCreatedAt ? new Date(tx.offlineCreatedAt) : null,
            syncedAt:         new Date(),
          },
        });
        results.push({ localId: tx.localId, id: saved.id, txNumber: saved.txNumber });

        // ── Save coupon redemptions if present ────────────────────────────
        if (Array.isArray(tx.couponRedemptions) && tx.couponRedemptions.length) {
          try {
            await prisma.couponRedemption.createMany({
              data: tx.couponRedemptions.map((r) => ({
                orgId: orgId as string,
                storeId:             tx.storeId as string,
                transactionId:       saved.id,
                couponId:            r.couponId || null,
                couponSerial:        String(r.serial || r.couponSerial || ''),
                brandFamily:         r.brandFamily || null,
                manufacturerId:      r.manufacturerId || null,
                discountApplied:     parseFloat(String(r.discountApplied)) || 0,
                qualifyingUpc:       r.qualifyingUpc || null,
                qualifyingQty:       r.qualifyingQty != null ? Number(r.qualifyingQty) : null,
                cashierId:           req.user!.id,
                managerApprovedById: r.managerApprovedById || null,
              })),
            });
          } catch (err) {
            console.error('[batchCreateTransactions] coupon redemption error:', (err as Error).message);
          }
        }

        // ── Save lottery transactions if present ──────────────────────────
        if (Array.isArray(tx.lotteryItems) && tx.lotteryItems.length) {
          await prisma.lotteryTransaction.createMany({
            data: tx.lotteryItems.map((li) => ({
              orgId: orgId as string,
              storeId:         tx.storeId as string,
              shiftId:         tx.shiftId || null,
              cashierId:       req.user!.id,
              stationId:       tx.stationId || null,
              type:            li.type === 'payout' ? 'payout' : 'sale',
              amount:          Math.abs(parseFloat(String(li.amount)) || 0),
              gameId:          li.gameId || null,
              notes:           li.notes || null,
              posTransactionId: saved.id,
            })),
          });
        }

        // ── Save fuel transactions if present ─────────────────────────────
        if (Array.isArray(tx.fuelItems) && tx.fuelItems.length) {
          const { applySale, applyRefund } = await import('../services/fuelInventory.js');
          for (const fi of tx.fuelItems) {
            const gallons = Math.abs(parseFloat(String(fi.gallons)) || 0);
            let tankId: string | null = null;
            let fifoLayers: FifoLayer[] | null = null;
            let pumpId = fi.pumpId || null;

            if (fi.type === 'refund') {
              let refundCtx: { fifoLayers: FifoLayer[] | null; tankId: string | null } = {
                fifoLayers: Array.isArray(fi.fifoLayers) ? fi.fifoLayers : null,
                tankId: fi.tankId || null,
              };
              if (fi.refundsOf) {
                const original = await prisma.fuelTransaction.findUnique({
                  where: { id: fi.refundsOf },
                  select: { pumpId: true, tankId: true, fifoLayers: true, orgId: true, storeId: true },
                });
                if (original && original.orgId === orgId && original.storeId === tx.storeId) {
                  const origLayers = (Array.isArray(original.fifoLayers) ? original.fifoLayers : []) as unknown as FifoLayer[];
                  const originalGallons = origLayers.reduce((s, l) => s + Number(l.gallons || 0), 0);
                  if (originalGallons > 0 && gallons > 0 && gallons <= originalGallons + 0.001) {
                    const scale = gallons / originalGallons;
                    refundCtx = {
                      fifoLayers: origLayers.map((l) => ({
                        ...l,
                        gallons: Number(l.gallons) * scale,
                        cost:    Number(l.cost || 0) * scale,
                      })),
                      tankId: original.tankId,
                    };
                  } else {
                    refundCtx = { fifoLayers: origLayers, tankId: original.tankId };
                  }
                  pumpId = pumpId || original.pumpId;
                  tankId = original.tankId;
                }
              }
              if (Array.isArray(refundCtx.fifoLayers) && refundCtx.fifoLayers.length) {
                await applyRefund({ fifoLayers: refundCtx.fifoLayers, tankId: refundCtx.tankId, gallons } as unknown as Parameters<typeof applyRefund>[0]);
                fifoLayers = refundCtx.fifoLayers;
                tankId     = refundCtx.tankId || null;
              }
            } else if (fi.fuelTypeId) {
              const r = await applySale({
                orgId: orgId as string,
                storeId: tx.storeId as string,
                fuelTypeId: fi.fuelTypeId,
                gallons,
                pumpId,
              } as Parameters<typeof applySale>[0]) as unknown as { primaryTankId: string | null; fifoLayers: FifoLayer[] };
              tankId     = r.primaryTankId;
              fifoLayers = r.fifoLayers;
            }

            await prisma.fuelTransaction.create({
              data: {
                orgId: orgId as string,
                storeId:          tx.storeId as string,
                shiftId:          tx.shiftId || null,
                cashierId:        req.user!.id,
                stationId:        tx.stationId || null,
                type:             fi.type === 'refund' ? 'refund' : 'sale',
                fuelTypeId:       fi.fuelTypeId || null,
                fuelTypeName:     fi.fuelTypeName || 'Fuel',
                gallons,
                pricePerGallon:   Math.abs(parseFloat(String(fi.pricePerGallon)) || 0),
                amount:           Math.abs(parseFloat(String(fi.amount)) || 0),
                entryMode:        fi.entryMode === 'gallons' ? 'gallons' : 'amount',
                taxAmount:        fi.taxAmount != null ? parseFloat(String(fi.taxAmount)) : null,
                notes:            fi.notes || null,
                posTransactionId: saved.id,
                tankId,
                fifoLayers:       (fifoLayers || undefined) as unknown as Prisma.InputJsonValue | undefined,
                pumpId,
                refundsOf:        fi.refundsOf || null,
              },
            });
          }
        }

        // Deduct stock for this offline transaction
        if (Array.isArray(tx.lineItems) && tx.lineItems.length) {
          const updates = tx.lineItems
            .filter((li) => li.productId && !li.isLottery && !li.isFuel && !li.isBottleReturn && Number(li.qty) > 0)
            .map((li) =>
              prisma.storeProduct.updateMany({
                where: { storeId: tx.storeId, masterProductId: Number(li.productId), orgId: orgId ?? undefined },
                data:  { quantityOnHand: { decrement: Number(li.qty) }, lastStockUpdate: new Date() },
              }),
            );
          Promise.all(updates).catch(() => {});
        }

        // Award/redeem loyalty points on the replayed offline tx.
        if (tx.customerId) {
          processTransactionPoints({
            orgId: orgId as string, storeId: tx.storeId, customerId: tx.customerId,
            lineItems: (tx.lineItems || []) as unknown as Parameters<typeof processTransactionPoints>[0]['lineItems'],
            txId: saved.id, txNumber: saved.txNumber,
            loyaltyPointsRedeemed: parseInt(String(tx.loyaltyPointsRedeemed)) || 0,
          } as Parameters<typeof processTransactionPoints>[0]).catch((err: Error) => console.error('[loyalty] batch points error:', err.message));
        }
      } catch (e) {
        errors.push({ localId: tx.localId, error: (e as Error).message });
      }
    }

    res.json({ synced: results.length, errors, results });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── GET /api/pos-terminal/transactions/:id ────────────────────────────────
export const getTransaction = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const tx = await prisma.transaction.findFirst({
      where: { id: req.params.id, orgId: orgId ?? undefined },
    });
    if (!tx) { res.status(404).json({ error: 'Transaction not found' }); return; }
    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── POST /api/pos-terminal/print-network ──────────────────────────────────
// Proxy: receives base64-encoded ESC/POS data and forwards it to a TCP printer.
// Body: { ip: string, port: number, data: string (base64) }
export const printNetworkReceipt = async (req: Request, res: Response): Promise<void> => {
  const body = (req.body || {}) as { ip?: string; port?: number; data?: string };
  const { ip, port, data } = body;
  if (!ip || !port || !data) {
    res.status(400).json({ error: 'ip, port, and data are required' });
    return;
  }
  try {
    const net = await import('net');
    const buf = Buffer.from(data, 'base64');
    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Print timeout — printer unreachable'));
      }, 6000);

      socket.connect(Number(port), ip, () => {
        socket.write(buf, () => {
          socket.end();
          clearTimeout(timeout);
          resolve();
        });
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    res.json({ ok: true });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'ECONNREFUSED')  { res.status(503).json({ error: `Printer refused connection at ${ip}:${port}` }); return; }
    if (e.code === 'ETIMEDOUT')     { res.status(503).json({ error: `Printer timed out at ${ip}:${port}` }); return; }
    if (e.code === 'ENETUNREACH')   { res.status(503).json({ error: `Network unreachable — check IP ${ip}` }); return; }
    res.status(500).json({ error: e.message || 'Print failed' });
  }
};

// ── POST /api/pos-terminal/print-label ─────────────────────────────────────
// Sends ZPL (plain text) to a Zebra label printer over TCP.
// Body: { ip: string, port: number (default 9100), zpl: string }
export const printNetworkLabel = async (req: Request, res: Response): Promise<void> => {
  const body = (req.body || {}) as { ip?: string; port?: number; zpl?: string };
  const { ip, port = 9100, zpl } = body;
  if (!ip || !zpl) { res.status(400).json({ error: 'ip and zpl are required' }); return; }
  try {
    const net = await import('net');
    const buf = Buffer.from(zpl, 'utf8');
    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => { socket.destroy(); reject(new Error('Label printer timeout')); }, 8000);
      socket.connect(Number(port), ip, () => {
        socket.write(buf, () => { socket.end(); clearTimeout(timeout); resolve(); });
      });
      socket.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
    res.json({ ok: true, message: `ZPL sent to ${ip}:${port}` });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'ECONNREFUSED') { res.status(503).json({ error: `Label printer refused at ${ip}:${port}` }); return; }
    res.status(500).json({ error: e.message || 'Label print failed' });
  }
};

// ── GET /api/pos-terminal/branding ────────────────────────────────────────
export const getPosBranding = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = (req.query as { storeId?: string }).storeId || req.storeId;
    if (!storeId) { res.status(400).json({ error: 'storeId required' }); return; }
    const store = await prisma.store.findFirst({
      where:  { id: storeId, orgId: orgId ?? undefined },
      select: { name: true, branding: true },
    });
    if (!store) { res.status(404).json({ error: 'Store not found' }); return; }
    const branding = (store.branding && typeof store.branding === 'object') ? (store.branding as Record<string, unknown>) : {};
    res.json({ storeName: store.name, ...branding });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── GET /api/pos-terminal/config ──────────────────────────────────────────
// Returns store's POS layout config (store.pos) + branding (store.branding).
// Requires X-Station-Token OR valid cashier JWT.
export const getPOSConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = (req.query as { storeId?: string }).storeId;
    if (!storeId) { res.status(400).json({ error: 'storeId required' }); return; }
    const store = await prisma.store.findFirst({
      where: { id: storeId },
      select: { pos: true, branding: true },
    });
    // Return pos config merged with branding so front-end gets everything in one call
    const posConfig: Record<string, unknown> = (store?.pos      && typeof store.pos      === 'object') ? (store.pos      as Record<string, unknown>) : {};
    const branding: Record<string, unknown>  = (store?.branding && typeof store.branding === 'object') ? (store.branding as Record<string, unknown>) : {};
    res.json({ ...posConfig, branding });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── PUT /api/pos-terminal/config ──────────────────────────────────────────
// Saves POS config → store.pos  and optionally branding → store.branding.
// Manager/owner/admin only.
export const savePOSConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body || {}) as { storeId?: string; config?: unknown; branding?: unknown };
    const { storeId, config, branding } = body;
    if (!storeId || !config) { res.status(400).json({ error: 'storeId and config required' }); return; }

    const orgId = req.tenantId || req.user?.orgId;
    const store = await prisma.store.findFirst({ where: { id: storeId, orgId: orgId ?? undefined } });
    if (!store) { res.status(404).json({ error: 'Store not found' }); return; }

    // Build update payload — only include branding if provided
    const updateData: Prisma.StoreUpdateInput = { pos: config as Prisma.InputJsonValue };
    if (branding && typeof branding === 'object') {
      updateData.branding = branding as Prisma.InputJsonValue;
    }

    await prisma.store.update({
      where: { id: storeId },
      data:  updateData,
    });

    // Settings change audit. Full pos JSON would be too noisy in the audit
    // feed — record which top-level config sections changed instead. The
    // before-state is `store.pos` from the findFirst above (snapshot before
    // the update lands).
    try {
      const prevPos = (store.pos && typeof store.pos === 'object')
        ? (store.pos as Record<string, unknown>)
        : {};
      const nextPos = (config && typeof config === 'object')
        ? (config as Record<string, unknown>)
        : {};
      const changedKeys: string[] = [];
      const allKeys = new Set([...Object.keys(prevPos), ...Object.keys(nextPos)]);
      for (const k of allKeys) {
        if (JSON.stringify(prevPos[k]) !== JSON.stringify(nextPos[k])) changedKeys.push(k);
      }
      const brandingChanged = !!(branding && typeof branding === 'object');
      if (changedKeys.length > 0 || brandingChanged) {
        logAudit(req, 'settings_change', 'pos_config', store.id, {
          storeName: store.name,
          changedKeys,
          brandingChanged,
        });
      }
    } catch {
      // Diff failure must never block the save response.
    }

    res.json({ success: true, config, branding: branding || null });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── GET /api/pos-terminal/transactions ────────────────────────────────────
export const listTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as {
      storeId?: string; date?: string; dateFrom?: string; dateTo?: string;
      cashierId?: string; stationId?: string; status?: string;
      amountMin?: string; amountMax?: string;
      limit?: string; offset?: string;
      sortBy?: string; sortDir?: string;
    };
    const {
      storeId, date, dateFrom, dateTo,
      cashierId, stationId, status,
      amountMin, amountMax,
    } = q;
    const limit = q.limit || '200';
    const offset = q.offset || '0';

    const where: Prisma.TransactionWhereInput = { orgId: orgId ?? undefined };
    if (storeId)   where.storeId   = storeId;
    if (cashierId) where.cashierId = cashierId;
    if (stationId) where.stationId = stationId;
    // Default: include sales + refunds, exclude voids (matches EoD report
    // semantics so the back-office Transactions page agrees with EoD).
    if (status === 'all') {
      // no filter
    } else if (status) {
      where.status = status;
    } else {
      where.status = { in: ['complete', 'refund'] };
    }

    // Amount range filter on grandTotal
    if (amountMin || amountMax) {
      const range: Prisma.DecimalFilter = {};
      if (amountMin) range.gte = parseFloat(amountMin);
      if (amountMax) range.lte = parseFloat(amountMax);
      where.grandTotal = range;
    }

    // Date/time window — use local server day boundaries (matches the
    // dashboard / employee report fix in Session 7).
    const startOfLocalDay = (str: string): Date => {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d, 0, 0, 0, 0);
    };
    const endOfLocalDay = (str: string): Date => {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d, 23, 59, 59, 999);
    };
    if (dateFrom || dateTo) {
      const range: Prisma.DateTimeFilter = {};
      if (dateFrom) range.gte = startOfLocalDay(dateFrom);
      if (dateTo)   range.lte = endOfLocalDay(dateTo);
      where.createdAt = range;
    } else if (date) {
      where.createdAt = { gte: startOfLocalDay(date), lte: endOfLocalDay(date) };
    }

    // Session 39 Round 4 — server-side sort across the full transaction set.
    const sortDir: 'asc' | 'desc' = q.sortDir === 'asc' ? 'asc' : 'desc';
    const TX_SORT_MAP: Record<string, Prisma.TransactionOrderByWithRelationInput> = {
      date:        { createdAt: sortDir },
      txNumber:    { txNumber:  sortDir },
      cashierName: { cashierId: sortDir },
      stationId:   { stationId: sortDir },
      total:       { grandTotal: sortDir },
      status:      { status: sortDir },
    };
    const orderBy: Prisma.TransactionOrderByWithRelationInput =
      (q.sortBy && TX_SORT_MAP[q.sortBy]) || { createdAt: 'desc' };

    const [total, txs] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        orderBy,
        take:    Math.min(parseInt(limit) || 200, 1000),
        skip:    parseInt(offset) || 0,
        select: {
          id: true, txNumber: true, status: true,
          subtotal: true, taxTotal: true, depositTotal: true,
          ebtTotal: true, grandTotal: true,
          tenderLines: true, changeGiven: true,
          lineItems: true, cashierId: true, stationId: true,
          refundOf: true, voidedAt: true, notes: true,
          offlineCreatedAt: true, createdAt: true,
        },
      }),
    ]);
    type TxRow = (typeof txs)[number];

    // Resolve cashier names in one query
    const cashierIds = [...new Set((txs as TxRow[]).map((t) => t.cashierId).filter((x): x is string => Boolean(x)))];
    interface UserRow { id: string; name: string }
    const users = cashierIds.length ? await prisma.user.findMany({
      where:  { id: { in: cashierIds } },
      select: { id: true, name: true },
    }) : [];
    const userMap = Object.fromEntries((users as UserRow[]).map((u) => [u.id, u.name]));

    res.json({
      total,
      transactions: (txs as TxRow[]).map((t) => ({
        ...t,
        subtotal:     Number(t.subtotal     ?? 0),
        taxTotal:     Number(t.taxTotal     ?? 0),
        depositTotal: Number(t.depositTotal ?? 0),
        ebtTotal:     Number(t.ebtTotal     ?? 0),
        grandTotal:   Number(t.grandTotal),
        changeGiven:  Number(t.changeGiven),
        cashierName:  (t.cashierId && userMap[t.cashierId]) || 'Unknown',
      })),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── POST /api/pos-terminal/events ─────────────────────────────────────────
// Logs a business event (No Sale, manager override, etc.) to pos_logs.
export const logPosEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as {
      storeId?: string; eventType?: string;
      cashierId?: string; cashierName?: string;
      stationId?: string; stationName?: string;
      note?: string;
    };
    const { storeId, eventType, cashierId, cashierName, stationId, stationName, note } = body;

    if (!eventType) { res.status(400).json({ error: 'eventType required' }); return; }

    await prisma.posLog.create({
      data: {
        orgId: orgId as string,
        storeId: storeId || null,
        endpoint:   eventType,
        method:     'EVENT',
        status:     'success',
        statusCode: null,
        message:    JSON.stringify({
          cashierId, cashierName,
          stationId, stationName,
          note: note || null,
        }),
      },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── GET /api/pos-terminal/events ──────────────────────────────────────────
export const listPosEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as {
      storeId?: string; eventType?: string;
      dateFrom?: string; dateTo?: string;
      limit?: string; offset?: string;
    };
    const { storeId, eventType, dateFrom, dateTo } = q;
    const limit = q.limit || '100';
    const offset = q.offset || '0';

    const where: Prisma.PosLogWhereInput = { orgId: orgId ?? undefined, method: 'EVENT' };
    if (storeId)   where.storeId  = storeId;
    if (eventType) where.endpoint = eventType;

    if (dateFrom || dateTo) {
      const range: Prisma.DateTimeFilter = {};
      if (dateFrom) {
        const d = new Date(dateFrom);
        range.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
      }
      if (dateTo) {
        const d = new Date(dateTo);
        range.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      }
      where.createdAt = range;
    }

    const [total, rows] = await Promise.all([
      prisma.posLog.count({ where }),
      prisma.posLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take:    Math.min(parseInt(limit) || 100, 500),
        skip:    parseInt(offset) || 0,
        include: { store: { select: { id: true, name: true } } },
      }),
    ]);
    type LogRow = (typeof rows)[number];

    res.json({
      total,
      events: (rows as LogRow[]).map((r) => {
        let details: { cashierName?: string; cashierId?: string; stationId?: string; stationName?: string; note?: string } = {};
        try { details = r.message ? JSON.parse(r.message) : {}; } catch { /* ignore */ }
        return {
          id:          r.id,
          eventType:   r.endpoint,
          storeId:     r.storeId,
          storeName:   r.store?.name || null,
          cashierName: details.cashierName || null,
          cashierId:   details.cashierId   || null,
          stationId:   details.stationId   || null,
          stationName: details.stationName || null,
          note:        details.note        || null,
          createdAt:   r.createdAt,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── POST /api/pos-terminal/transactions/:id/void ──────────────────────────
export const voidTransaction = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id }   = req.params;
    const { note } = (req.body || {}) as { note?: string };

    const tx = await prisma.transaction.findFirst({ where: { id, orgId: orgId ?? undefined } });
    if (!tx) { res.status(404).json({ error: 'Transaction not found' }); return; }
    if (tx.status === 'voided') { res.status(400).json({ error: 'Transaction already voided' }); return; }
    if (tx.status === 'refund') { res.status(400).json({ error: 'Cannot void a refund transaction' }); return; }

    const voided = await prisma.transaction.update({
      where: { id },
      data: {
        status:      'voided',
        notes:       note ? `VOID: ${note}` : `VOIDED by ${req.user?.name || req.user?.email}`,
        voidedAt:    new Date(),
        voidedById:  req.user!.id,
      },
    });

    // Reverse loyalty + charge effects of the original tx.
    reverseTransactionPoints({ originalTx: tx, reason: 'void_reverse' } as Parameters<typeof reverseTransactionPoints>[0])
      .catch((err: Error) => console.error('[loyalty] void reverse error:', err.message));
    const chargeAmount = _sumChargeTender(tx.tenderLines as Parameters<typeof _sumChargeTender>[0]);
    if (chargeAmount > 0) {
      _refundChargeOnTx({ orgId: orgId as string, originalTx: tx, chargeAmount } as Parameters<typeof _refundChargeOnTx>[0])
        .catch((err: Error) => console.error('[charge] void refund error:', err.message));
    }

    res.json({ ...voided, grandTotal: Number(voided.grandTotal) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── POST /api/pos-terminal/transactions/:id/refund ────────────────────────
interface RefundBody {
  lineItems?: CartLineItem[];
  tenderLines?: TenderLine[];
  note?: string;
  grandTotal?: number | string;
  subtotal?: number | string;
  taxTotal?: number | string;
  depositTotal?: number | string;
}

export const createRefund = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id }  = req.params;
    const body = (req.body || {}) as RefundBody;
    const { lineItems, tenderLines, note, grandTotal, subtotal, taxTotal, depositTotal } = body;

    const orig = await prisma.transaction.findFirst({ where: { id, orgId: orgId ?? undefined } });
    if (!orig) { res.status(404).json({ error: 'Original transaction not found' }); return; }
    if (orig.status === 'voided') { res.status(400).json({ error: 'Cannot refund a voided transaction' }); return; }

    // Generate refund transaction number
    const today   = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const count   = await prisma.transaction.count({ where: { orgId: orgId ?? undefined, storeId: orig.storeId } });
    const txNumber = `REF-${dateStr}-${String(count + 1).padStart(6, '0')}`;

    const refund = await prisma.transaction.create({
      data: {
        orgId: orgId as string,
        storeId:      orig.storeId,
        cashierId:    req.user!.id,
        stationId:    orig.stationId,
        txNumber,
        status:       'refund',
        refundOf:     id,
        lineItems:    ((lineItems || orig.lineItems) || []) as unknown as Prisma.InputJsonValue,
        subtotal:     -(parseFloat(String(subtotal))     || Number(orig.subtotal)),
        taxTotal:     -(parseFloat(String(taxTotal))      || Number(orig.taxTotal)),
        depositTotal: -(parseFloat(String(depositTotal))   || 0),
        ebtTotal:     0,
        grandTotal:   -(parseFloat(String(grandTotal))    || Number(orig.grandTotal)),
        tenderLines:  (tenderLines || []) as unknown as Prisma.InputJsonValue,
        changeGiven:  0,
        notes:        note || `Refund for ${orig.txNumber}`,
        syncedAt:     new Date(),
      },
    });

    // Reverse loyalty + charge effects of the original tx.
    reverseTransactionPoints({ originalTx: orig, reason: 'refund_reverse' } as Parameters<typeof reverseTransactionPoints>[0])
      .catch((err: Error) => console.error('[loyalty] refund reverse error:', err.message));
    const origCharge = _sumChargeTender(orig.tenderLines as Parameters<typeof _sumChargeTender>[0]);
    if (origCharge > 0) {
      _refundChargeOnTx({ orgId: orgId as string, originalTx: orig, chargeAmount: origCharge } as Parameters<typeof _refundChargeOnTx>[0])
        .catch((err: Error) => console.error('[charge] refund reverse error:', err.message));
    }

    res.status(201).json({ ...refund, grandTotal: Number(refund.grandTotal) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── POST /api/pos-terminal/transactions/open-refund ──────────────────────
// No-receipt refund — creates a standalone refund transaction with no parent.
interface OpenRefundBody {
  storeId?: string;
  lineItems?: CartLineItem[];
  tenderLines?: TenderLine[];
  note?: string;
  grandTotal?: number | string;
  subtotal?: number | string;
  taxTotal?: number | string;
}

export const createOpenRefund = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as OpenRefundBody;
    const { storeId, lineItems, tenderLines, note, grandTotal, subtotal, taxTotal } = body;

    if (!storeId)            { res.status(400).json({ error: 'storeId required' }); return; }
    if (!lineItems?.length)  { res.status(400).json({ error: 'lineItems required' }); return; }
    if (!grandTotal)         { res.status(400).json({ error: 'grandTotal required' }); return; }

    const today   = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const count   = await prisma.transaction.count({ where: { orgId: orgId ?? undefined, storeId } });
    const txNumber = `REF-${dateStr}-${String(count + 1).padStart(6, '0')}`;

    const refund = await prisma.transaction.create({
      data: {
        orgId: orgId as string,
        storeId,
        cashierId:    req.user!.id,
        txNumber,
        status:       'refund',
        lineItems:    (lineItems || []) as unknown as Prisma.InputJsonValue,
        subtotal:     -(parseFloat(String(subtotal))  || parseFloat(String(grandTotal))),
        taxTotal:     -(parseFloat(String(taxTotal))  || 0),
        depositTotal: 0,
        ebtTotal:     0,
        grandTotal:   -(parseFloat(String(grandTotal))),
        tenderLines:  (tenderLines || []) as unknown as Prisma.InputJsonValue,
        changeGiven:  0,
        notes:        note || 'No-receipt return',
        syncedAt:     new Date(),
      },
    });

    res.status(201).json({ ...refund, grandTotal: Number(refund.grandTotal) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// NOTE: A legacy `getEndOfDayReport` controller used to live here. It has
// been removed in favour of the comprehensive controller in
// `endOfDayReportController.js` (returns header / payouts[] / tenders[] /
// transactions[] / fuel / reconciliation / totals). The cashier-app and
// back-office both consume the new shape via:
//   - GET /api/reports/end-of-day  (registered in reportsRoutes.js)
//   - GET /api/pos-terminal/end-of-day  (cashier-app alternate path)

// ── POST /api/pos-terminal/clock ──────────────────────────────────────────
// Clock in or out identified by PIN (no JWT needed — uses station token)
export const clockEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body || {}) as { pin?: string; type?: string };
    const { pin, type } = body;

    if (!type || !['in', 'out'].includes(type)) { res.status(400).json({ error: 'type must be "in" or "out"' }); return; }
    if (!pin || typeof pin !== 'string' || pin.length < 4 || pin.length > 8) {
      res.status(400).json({ error: 'PIN required (4-8 digits)' });
      return;
    }
    if (!/^\d+$/.test(pin)) { res.status(400).json({ error: 'PIN must be numeric' }); return; }

    // Identify user by PIN (same logic as pinLogin)
    const stationToken = req.headers['x-station-token'];
    if (!stationToken || typeof stationToken !== 'string' || stationToken.length < 16) {
      res.status(401).json({ error: 'Station token required' });
      return;
    }

    const station = await prisma.station.findUnique({ where: { token: stationToken } });
    if (!station) { res.status(401).json({ error: 'Invalid station token' }); return; }

    const bcryptModule = await import('bcryptjs');
    const users  = await prisma.user.findMany({
      where: { orgId: station.orgId, posPin: { not: null }, status: 'active' },
      select: { id: true, name: true, posPin: true },
    });
    type UserPinRow = (typeof users)[number];

    let matchedUser: UserPinRow | null = null;
    for (const u of users as UserPinRow[]) {
      if (u.posPin && bcryptModule.default.compareSync(pin, u.posPin)) { matchedUser = u; break; }
    }
    if (!matchedUser) { res.status(401).json({ error: 'Invalid PIN' }); return; }

    // ── Trust only station-side identifiers ────────────────────────────────
    const effectiveStoreId = station.storeId;
    const effectiveStationId = station.id;

    // ── Duplicate state guard ────────────────────────────────────────────────
    const lastEvent = await prisma.clockEvent.findFirst({
      where: { orgId: station.orgId, storeId: effectiveStoreId, userId: matchedUser.id },
      orderBy: { createdAt: 'desc' },
      select: { type: true, createdAt: true },
    });

    if (type === 'in' && lastEvent?.type === 'in') {
      // Already clocked in — don't create a duplicate event
      res.status(200).json({
        alreadyClockedIn: true,
        userName: matchedUser.name,
        since: lastEvent.createdAt,
      });
      return;
    }

    if (type === 'out' && (!lastEvent || lastEvent.type === 'out')) {
      // Not clocked in yet — cannot clock out
      res.status(200).json({
        notClockedIn: true,
        userName: matchedUser.name,
      });
      return;
    }

    const event = await prisma.clockEvent.create({
      data: {
        orgId:     station.orgId,
        storeId:   effectiveStoreId,
        userId:    matchedUser.id,
        stationId: effectiveStationId,
        type,
      },
    });

    res.status(201).json({
      userName:  matchedUser.name,
      type,
      createdAt: event.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

// ── GET /api/pos-terminal/clock/status ───────────────────────────────────
// Returns the last clock event for a given user (to show clocked-in state)
export const getClockStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const q = req.query as { storeId?: string; userId?: string };
    const storeId = q.storeId;
    const userId  = q.userId || req.user?.id;

    const last = await prisma.clockEvent.findFirst({
      where:   { orgId: orgId ?? undefined, ...(storeId && { storeId }), userId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ clockedIn: last?.type === 'in', lastEvent: last || null });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};
