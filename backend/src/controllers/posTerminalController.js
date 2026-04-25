/**
 * POS Terminal Controller
 * Handles cashier-facing operations: catalog snapshot, transactions, session.
 */

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

// ── Helpers ────────────────────────────────────────────────────────────────

const getOrgId   = (req) => req.orgId   || req.user?.orgId;
const getStoreId = (req) => req.query.storeId || req.body?.storeId;

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
export const getCatalogSnapshot = async (req, res) => {
  try {
    const orgId      = getOrgId(req);
    const storeId    = req.query.storeId;
    const since      = req.query.updatedSince ? new Date(req.query.updatedSince) : null;
    const page       = parseInt(req.query.page)  || 1;
    const limit      = Math.min(parseInt(req.query.limit) || 500, 500);
    const skip       = (page - 1) * limit;

    const where = {
      orgId,
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
              orgId,
              updatedAt: { gte: since },
              OR: [{ deleted: true }, { active: false }],
            },
            select: { id: true, updatedAt: true },
          })
        : Promise.resolve([]),
    ]);

    // Flatten into the shape the POS app caches in IndexedDB
    const flat = products.map(p => {
      const sp = p.storeProducts?.[0];
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
        taxRuleId:      p.taxRuleId || null,
        taxClass:       p.taxClass || p.department?.taxClass || 'grocery',
        ebtEligible:    p.ebtEligible || p.department?.ebtEligible || false,
        ageRequired:    p.ageRequired,
        // Deposit — emits per-sell-pack $ (i.e. deposit charged per cart qty=1).
        //
        // The cashier cart does `depositTotal = depositAmount × qty`. Since
        // qty=1 represents ONE sell pack (a 12-pack, a 6-pack, or a single),
        // `depositAmount` must be the deposit for that sell pack — NOT the
        // per-individual-container amount.
        //
        // Sources, priority order (all produce per-sell-pack):
        //   1. MasterProduct.depositPerUnit (per-container) × sell-pack size
        //      — matches the ProductForm UI where depositPerUnit is labelled
        //      "Per unit" and PackVisual computes "Per pack = per unit × count"
        //   2. MasterProduct.caseDeposit / packInCase  (direct: $ per sell pack)
        //      — covers products where the form saved only the case total
        //   3. Legacy DepositRule × sellUnitSize  (pre-Session-9 schema)
        //
        // Every branch resolves to a single per-sell-pack number for the POS
        // to multiply by qty. Without this scaling step, a customer buying
        // a 12-pack would be charged $0.05 deposit instead of $0.60.
        depositAmount: (() => {
          // Resolve the number of individual containers in one sell pack.
          // Prefer the new `unitPack` column; fall back to `sellUnitSize` (legacy
          // mirror); final fallback is 1 (treat as single-container product).
          const sellPackUnits =
            p.unitPack     != null && Number(p.unitPack)     > 0 ? Number(p.unitPack)     :
            p.sellUnitSize != null && Number(p.sellUnitSize) > 0 ? Number(p.sellUnitSize) :
            1;

          // Number of sell packs per vendor case — needed for the caseDeposit
          // fallback. Prefer `packInCase`; fall back to `casePacks` (legacy).
          const packsPerCase =
            p.packInCase != null && Number(p.packInCase) > 0 ? Number(p.packInCase) :
            p.casePacks  != null && Number(p.casePacks)  > 0 ? Number(p.casePacks)  :
            null;

          // Tier 1: explicit per-container deposit × units per sell pack
          if (p.depositPerUnit != null) {
            return Number(p.depositPerUnit) * sellPackUnits;
          }

          // Tier 2: case total ÷ packs per case = per-sell-pack directly
          //   $1.20 case / 2 packs-per-case = $0.60 per 12-pack  ✓
          //   $1.20 case / 24 packs-per-case = $0.05 per single  ✓
          if (p.caseDeposit != null && packsPerCase) {
            return Number(p.caseDeposit) / packsPerCase;
          }

          // Tier 3: legacy DepositRule (pre-Session-9 schema)
          if (p.depositRule) {
            return Number(p.depositRule.depositAmount) * sellPackUnits;
          }

          return null;
        })(),
        depositRuleId:  p.depositRuleId,
        departmentId:   p.departmentId,
        departmentName: p.department?.name || null,
        active:         sp ? sp.active : p.active,
        inStock:        sp ? sp.inStock : true,
        // Pack sizes for the cashier picker — flattened to JSON-friendly shape
        // and persisted on each product row in IndexedDB. The cashier-app's
        // POSScreen.handleScan reads `product.packSizes` and shows
        // PackSizePickerModal when length > 1, or applies the single size
        // silently when length === 1.
        packSizes: (p.packSizes || []).map(ps => ({
          id:           ps.id,
          label:        ps.label,
          unitCount:    ps.unitCount,
          packsPerCase: ps.packsPerCase,
          retailPrice:  Number(ps.retailPrice),
          isDefault:    ps.isDefault,
          sortOrder:    ps.sortOrder,
        })),
        // Flat array of alternate UPC strings only — small, JSON-friendly,
        // and indexed in IndexedDB via a multi-entry `*upcs` index so that
        // both `lookupByUPC` and `searchProducts` resolve any registered
        // barcode (primary OR alternate) without a table scan.
        upcs: (p.upcs || []).map(u => u.upc).filter(Boolean),
        orgId,
        storeId:        storeId || null,
        updatedAt:      p.updatedAt.toISOString(),
      };
    });

    // Tombstones — IDs of products to remove from the local cache.
    // Only present on the first page of an incremental sync.
    const deleted = (tombstones || []).map(t => t.id);

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
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/catalog/active-ids ──────────────────────────────
// Returns ONLY the IDs of currently-active, non-deleted products for this
// org. Used by the cashier-app on every sign-in to reconcile the local
// IndexedDB cache against server truth — prune any local rows whose ID is
// not in the active set. Fixes the case where a store admin deletes 27k
// products on the back-office but the cashier cache still shows them in
// the product counter.
//
// Payload is tiny (~7 bytes per id × 7k products ≈ 50 KB), much cheaper
// than wiping + re-downloading all product data.
export const getCatalogActiveIds = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const rows = await prisma.masterProduct.findMany({
      where:  { orgId, active: true, deleted: false },
      select: { id: true },
    });
    res.json({
      activeIds: rows.map(r => r.id),
      count:     rows.length,
      syncedAt:  new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/deposit-rules ────────────────────────────────────
export const getDepositRules = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const rules = await prisma.depositRule.findMany({
      where: { orgId, active: true },
      orderBy: { minVolumeOz: 'asc' },
    });
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/tax-rules ───────────────────────────────────────
export const getTaxRules = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const rules = await prisma.taxRule.findMany({
      where: { orgId, active: true },
    });
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/transactions ───────────────────────────────────
export const createTransaction = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      storeId, stationId,
      lineItems, lotteryItems, fuelItems, couponRedemptions,
      tenderLines, ageVerifications, notes,
      subtotal, taxTotal, depositTotal, ebtTotal, grandTotal, changeGiven,
      offlineCreatedAt, status,
      shiftId,
      customerId, loyaltyPointsRedeemed,
    } = req.body;

    if (!storeId) return res.status(400).json({ error: 'storeId required' });
    // Allow lottery-only transactions (no regular lineItems)
    if (!lineItems?.length && !lotteryItems?.length && !fuelItems?.length) {
      return res.status(400).json({ error: 'lineItems, lotteryItems, or fuelItems required' });
    }

    // ── Charge-account tender validation ──────────────────────────────────
    // If any tender line uses the 'charge' method, validate the customer can
    // charge it (account enabled + within limit) BEFORE saving the tx. We
    // reserve the balance atomically here so two concurrent stations can't
    // both push a charge over the limit.
    const chargeAmount = _sumChargeTender(tenderLines);
    if (chargeAmount > 0) {
      const r = await _applyChargeTender({ orgId, customerId, chargeAmount });
      if (!r.ok) return res.status(400).json({ error: r.error });
    }

    // Generate a human-readable transaction number
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
    const count = await prisma.transaction.count({ where: { orgId, storeId } });
    const txNumber = `TXN-${dateStr}-${String(count + 1).padStart(6, '0')}`;

    const tx = await prisma.transaction.create({
      data: {
        orgId,
        storeId,
        cashierId:       req.user.id,
        stationId:       stationId || null,
        // shiftId intentionally not stored — Transaction model has no shiftId
        // column. Shift reports query by `createdAt >= shift.openedAt` instead.
        // Adding the column would require a Prisma migration; tracked as a
        // P3 backlog item for accurate per-shift filtering.
        txNumber,
        // Force 'complete' — the cashier-app's offline txQueue marks rows as
        // 'pending' (a LOCAL sync flag, not a real tx state). Honoring it
        // would hide cash sales from EoD/Daily reports. Voids and refunds
        // use their own dedicated endpoints (voidTransaction / createRefund).
        status:          'complete',
        lineItems:       lineItems || [],
        subtotal:        parseFloat(subtotal)     || 0,
        taxTotal:        parseFloat(taxTotal)     || 0,
        depositTotal:    parseFloat(depositTotal) || 0,
        ebtTotal:        parseFloat(ebtTotal)     || 0,
        grandTotal:      parseFloat(grandTotal)   || 0,
        tenderLines:     tenderLines || [],
        changeGiven:     parseFloat(changeGiven)  || 0,
        ageVerifications:ageVerifications || null,
        notes:           notes || null,
        offlineCreatedAt:offlineCreatedAt ? new Date(offlineCreatedAt) : null,
        syncedAt:        new Date(),
      },
    });

    // ── Award / deduct loyalty points (fire-and-forget) ───────────────────
    if (customerId) {
      processTransactionPoints({
        orgId, storeId, customerId,
        lineItems: lineItems || [],
        txId:      tx.id, txNumber,
        loyaltyPointsRedeemed: parseInt(loyaltyPointsRedeemed) || 0,
      }).catch(err => console.error('[loyalty] points error:', err.message));
    }

    // ── Save manufacturer coupon redemptions if present ───────────────────
    // Each redemption row links back to the tx for audit + flows into the
    // daily scan-data submission (Session 47) for mfr reimbursement.
    if (Array.isArray(couponRedemptions) && couponRedemptions.length) {
      try {
        await prisma.couponRedemption.createMany({
          data: couponRedemptions.map(r => ({
            orgId,
            storeId,
            transactionId:       tx.id,
            couponId:            r.couponId || null,
            couponSerial:        String(r.serial || r.couponSerial || ''),
            brandFamily:         r.brandFamily || null,
            manufacturerId:      r.manufacturerId || null,
            discountApplied:     parseFloat(r.discountApplied) || 0,
            qualifyingUpc:       r.qualifyingUpc || null,
            qualifyingQty:       r.qualifyingQty != null ? Number(r.qualifyingQty) : null,
            cashierId:           req.user.id,
            managerApprovedById: r.managerApprovedById || null,
          })),
        });
      } catch (err) {
        console.error('[createTransaction] coupon redemption error:', err.message);
      }
    }

    // ── Save lottery transactions if present ──────────────────────────────
    if (Array.isArray(lotteryItems) && lotteryItems.length) {
      await prisma.lotteryTransaction.createMany({
        data: lotteryItems.map(li => ({
          orgId,
          storeId,
          shiftId:         shiftId || null,
          cashierId:       req.user.id,
          stationId:       stationId || null,
          type:            li.type === 'payout' ? 'payout' : 'sale',
          amount:          Math.abs(parseFloat(li.amount) || 0),
          gameId:          li.gameId || null,
          notes:           li.notes || null,
          posTransactionId: tx.id,
        })),
      });
    }

    // ── Save fuel transactions if present ─────────────────────────────────
    // Each fuel item drives the FIFO inventory service (applySale / applyRefund)
    // so the sale's tank + consumed cost layers are recorded for P&L reports.
    // One row per fuelItem (createMany → per-row create because FIFO result
    // varies per row and we need to persist it on each record).
    if (Array.isArray(fuelItems) && fuelItems.length) {
      const { applySale, applyRefund } = await import('../services/fuelInventory.js');
      for (const fi of fuelItems) {
        const gallons = Math.abs(parseFloat(fi.gallons) || 0);
        let tankId     = null;
        let fifoLayers = null;
        let pumpId     = fi.pumpId || null;

        if (fi.type === 'refund') {
          // V1.5: Pump-aware refund — when cashier refunds by picking an
          // original sale, the cashier-app passes `refundsOf` (original tx id).
          // We look up the original's pumpId + tankId + fifoLayers and credit
          // back to THOSE EXACT layers so COGS and inventory balance.
          let refundCtx = { fifoLayers: Array.isArray(fi.fifoLayers) ? fi.fifoLayers : null, tankId: fi.tankId || null };
          if (fi.refundsOf) {
            const original = await prisma.fuelTransaction.findUnique({
              where: { id: fi.refundsOf },
              select: { pumpId: true, tankId: true, fifoLayers: true, fuelTypeId: true, orgId: true, storeId: true },
            });
            if (original && original.orgId === orgId && original.storeId === storeId) {
              // Scale the original's fifoLayers to match the refunded gallons
              // (partial refund: customer pre-paid $40, filled $27 → refund $13 = X gal)
              const originalGallons = Array.isArray(original.fifoLayers)
                ? original.fifoLayers.reduce((s, l) => s + Number(l.gallons || 0), 0)
                : 0;
              if (originalGallons > 0 && gallons > 0 && gallons <= originalGallons + 0.001) {
                const scale = gallons / originalGallons;
                refundCtx = {
                  fifoLayers: original.fifoLayers.map(l => ({
                    ...l,
                    gallons: Number(l.gallons) * scale,
                    cost:    Number(l.cost || 0) * scale,
                  })),
                  tankId: original.tankId,
                };
              } else {
                refundCtx = { fifoLayers: original.fifoLayers, tankId: original.tankId };
              }
              pumpId = pumpId || original.pumpId;
              tankId = original.tankId;
            }
          }
          if (Array.isArray(refundCtx.fifoLayers) && refundCtx.fifoLayers.length) {
            await applyRefund({ fifoLayers: refundCtx.fifoLayers, tankId: refundCtx.tankId, gallons });
            fifoLayers = refundCtx.fifoLayers;
            tankId     = refundCtx.tankId || null;
          }
        } else if (fi.fuelTypeId) {
          const r = await applySale({
            orgId, storeId,
            fuelTypeId: fi.fuelTypeId,
            gallons,
            pumpId,
          });
          tankId     = r.primaryTankId;
          fifoLayers = r.fifoLayers;
        }

        await prisma.fuelTransaction.create({
          data: {
            orgId,
            storeId,
            shiftId:          shiftId || null,
            cashierId:        req.user.id,
            stationId:        stationId || null,
            type:             fi.type === 'refund' ? 'refund' : 'sale',
            fuelTypeId:       fi.fuelTypeId || null,
            fuelTypeName:     fi.fuelTypeName || 'Fuel',
            gallons,
            pricePerGallon:   Math.abs(parseFloat(fi.pricePerGallon) || 0),
            amount:           Math.abs(parseFloat(fi.amount) || 0),
            entryMode:        fi.entryMode === 'gallons' ? 'gallons' : 'amount',
            taxAmount:        fi.taxAmount != null ? parseFloat(fi.taxAmount) : null,
            notes:            fi.notes || null,
            posTransactionId: tx.id,
            tankId,
            fifoLayers:       fifoLayers || undefined,
            pumpId,
            refundsOf:        fi.refundsOf || null,
          },
        });
      }
    }

    // ── Deduct stock for each sold line item (fire-and-forget) ────────────
    // Only deduct for real products (skip lottery, bottle-return, price-override lines without productId)
    if (Array.isArray(lineItems) && lineItems.length) {
      const stockUpdates = lineItems
        .filter(li => li.productId && !li.isLottery && !li.isFuel && !li.isBottleReturn && li.qty > 0)
        .map(li =>
          prisma.storeProduct.updateMany({
            where: { storeId, masterProductId: li.productId, orgId },
            data:  {
              quantityOnHand: { decrement: li.qty },
              lastStockUpdate: new Date(),
            },
          })
        );
      // Non-blocking — don't hold up the response if stock update fails
      Promise.all(stockUpdates).catch(err =>
        console.error('[createTransaction] stock deduction error:', err.message)
      );
    }

    res.status(201).json(tx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/transactions/batch ─────────────────────────────
// Accepts an array of transactions created offline.
export const batchCreateTransactions = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { transactions } = req.body;

    if (!Array.isArray(transactions) || !transactions.length) {
      return res.status(400).json({ error: 'transactions array required' });
    }

    const results = [];
    const errors  = [];

    for (const tx of transactions) {
      try {
        // Charge-tender validation for offline replay. If a queued tx used
        // the 'charge' method but the customer's account has since been
        // disabled or the limit lowered, we reject this individual tx with
        // an error and continue replaying the rest.
        const chargeAmount = _sumChargeTender(tx.tenderLines);
        if (chargeAmount > 0) {
          const r = await _applyChargeTender({ orgId, customerId: tx.customerId, chargeAmount });
          if (!r.ok) {
            errors.push({ localId: tx.localId, error: r.error });
            continue;
          }
        }

        const today = new Date(tx.offlineCreatedAt || Date.now());
        const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
        const count = await prisma.transaction.count({ where: { orgId, storeId: tx.storeId } });
        const txNumber = tx.txNumber || `TXN-${dateStr}-${String(count + 1).padStart(6, '0')}`;

        const saved = await prisma.transaction.create({
          data: {
            orgId,
            storeId:          tx.storeId,
            cashierId:        req.user.id,
            stationId:        tx.stationId || null,
            txNumber,
            // Force 'complete' — see comment in createTransaction. The
            // cashier-app's local txQueue marks rows as 'pending' which is
            // a sync state, not a real tx state. Honoring it would hide
            // cash sales (which often go through this batch path on a brief
            // network blip) from EoD/Daily reports.
            status:           'complete',
            lineItems:        tx.lineItems || [],
            subtotal:         parseFloat(tx.subtotal)     || 0,
            taxTotal:         parseFloat(tx.taxTotal)     || 0,
            depositTotal:     parseFloat(tx.depositTotal) || 0,
            ebtTotal:         parseFloat(tx.ebtTotal)     || 0,
            grandTotal:       parseFloat(tx.grandTotal)   || 0,
            tenderLines:      tx.tenderLines || [],
            changeGiven:      parseFloat(tx.changeGiven)  || 0,
            ageVerifications: tx.ageVerifications || null,
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
              data: tx.couponRedemptions.map(r => ({
                orgId,
                storeId:             tx.storeId,
                transactionId:       saved.id,
                couponId:            r.couponId || null,
                couponSerial:        String(r.serial || r.couponSerial || ''),
                brandFamily:         r.brandFamily || null,
                manufacturerId:      r.manufacturerId || null,
                discountApplied:     parseFloat(r.discountApplied) || 0,
                qualifyingUpc:       r.qualifyingUpc || null,
                qualifyingQty:       r.qualifyingQty != null ? Number(r.qualifyingQty) : null,
                cashierId:           req.user.id,
                managerApprovedById: r.managerApprovedById || null,
              })),
            });
          } catch (err) {
            console.error('[batchCreateTransactions] coupon redemption error:', err.message);
          }
        }

        // ── Save lottery transactions if present ──────────────────────────
        if (Array.isArray(tx.lotteryItems) && tx.lotteryItems.length) {
          await prisma.lotteryTransaction.createMany({
            data: tx.lotteryItems.map(li => ({
              orgId,
              storeId:         tx.storeId,
              shiftId:         tx.shiftId || null,
              cashierId:       req.user.id,
              stationId:       tx.stationId || null,
              type:            li.type === 'payout' ? 'payout' : 'sale',
              amount:          Math.abs(parseFloat(li.amount) || 0),
              gameId:          li.gameId || null,
              notes:           li.notes || null,
              posTransactionId: saved.id,
            })),
          });
        }

        // ── Save fuel transactions if present ─────────────────────────────
        // FIFO inventory integration + V1.5 pumpId + refundsOf (same pattern
        // as createTransaction above)
        if (Array.isArray(tx.fuelItems) && tx.fuelItems.length) {
          const { applySale, applyRefund } = await import('../services/fuelInventory.js');
          for (const fi of tx.fuelItems) {
            const gallons = Math.abs(parseFloat(fi.gallons) || 0);
            let tankId     = null;
            let fifoLayers = null;
            let pumpId     = fi.pumpId || null;

            if (fi.type === 'refund') {
              let refundCtx = { fifoLayers: Array.isArray(fi.fifoLayers) ? fi.fifoLayers : null, tankId: fi.tankId || null };
              if (fi.refundsOf) {
                const original = await prisma.fuelTransaction.findUnique({
                  where: { id: fi.refundsOf },
                  select: { pumpId: true, tankId: true, fifoLayers: true, orgId: true, storeId: true },
                });
                if (original && original.orgId === orgId && original.storeId === tx.storeId) {
                  const originalGallons = Array.isArray(original.fifoLayers)
                    ? original.fifoLayers.reduce((s, l) => s + Number(l.gallons || 0), 0)
                    : 0;
                  if (originalGallons > 0 && gallons > 0 && gallons <= originalGallons + 0.001) {
                    const scale = gallons / originalGallons;
                    refundCtx = {
                      fifoLayers: original.fifoLayers.map(l => ({
                        ...l,
                        gallons: Number(l.gallons) * scale,
                        cost:    Number(l.cost || 0) * scale,
                      })),
                      tankId: original.tankId,
                    };
                  } else {
                    refundCtx = { fifoLayers: original.fifoLayers, tankId: original.tankId };
                  }
                  pumpId = pumpId || original.pumpId;
                  tankId = original.tankId;
                }
              }
              if (Array.isArray(refundCtx.fifoLayers) && refundCtx.fifoLayers.length) {
                await applyRefund({ fifoLayers: refundCtx.fifoLayers, tankId: refundCtx.tankId, gallons });
                fifoLayers = refundCtx.fifoLayers;
                tankId     = refundCtx.tankId || null;
              }
            } else if (fi.fuelTypeId) {
              const r = await applySale({
                orgId,
                storeId: tx.storeId,
                fuelTypeId: fi.fuelTypeId,
                gallons,
                pumpId,
              });
              tankId     = r.primaryTankId;
              fifoLayers = r.fifoLayers;
            }

            await prisma.fuelTransaction.create({
              data: {
                orgId,
                storeId:          tx.storeId,
                shiftId:          tx.shiftId || null,
                cashierId:        req.user.id,
                stationId:        tx.stationId || null,
                type:             fi.type === 'refund' ? 'refund' : 'sale',
                fuelTypeId:       fi.fuelTypeId || null,
                fuelTypeName:     fi.fuelTypeName || 'Fuel',
                gallons,
                pricePerGallon:   Math.abs(parseFloat(fi.pricePerGallon) || 0),
                amount:           Math.abs(parseFloat(fi.amount) || 0),
                entryMode:        fi.entryMode === 'gallons' ? 'gallons' : 'amount',
                taxAmount:        fi.taxAmount != null ? parseFloat(fi.taxAmount) : null,
                notes:            fi.notes || null,
                posTransactionId: saved.id,
                tankId,
                fifoLayers:       fifoLayers || undefined,
                pumpId,
                refundsOf:        fi.refundsOf || null,
              },
            });
          }
        }

        // Deduct stock for this offline transaction
        if (Array.isArray(tx.lineItems) && tx.lineItems.length) {
          const updates = tx.lineItems
            .filter(li => li.productId && !li.isLottery && !li.isFuel && !li.isBottleReturn && li.qty > 0)
            .map(li =>
              prisma.storeProduct.updateMany({
                where: { storeId: tx.storeId, masterProductId: li.productId, orgId },
                data:  { quantityOnHand: { decrement: li.qty }, lastStockUpdate: new Date() },
              })
            );
          Promise.all(updates).catch(() => {});
        }

        // Award/redeem loyalty points on the replayed offline tx.
        if (tx.customerId) {
          processTransactionPoints({
            orgId, storeId: tx.storeId, customerId: tx.customerId,
            lineItems: tx.lineItems || [],
            txId: saved.id, txNumber: saved.txNumber,
            loyaltyPointsRedeemed: parseInt(tx.loyaltyPointsRedeemed) || 0,
          }).catch(err => console.error('[loyalty] batch points error:', err.message));
        }
      } catch (e) {
        errors.push({ localId: tx.localId, error: e.message });
      }
    }

    res.json({ synced: results.length, errors, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/transactions/:id ────────────────────────────────
export const getTransaction = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const tx = await prisma.transaction.findFirst({
      where: { id: req.params.id, orgId },
    });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/print-network ──────────────────────────────────
// Proxy: receives base64-encoded ESC/POS data and forwards it to a TCP printer.
// Body: { ip: string, port: number, data: string (base64) }
export const printNetworkReceipt = async (req, res) => {
  const { ip, port, data } = req.body;
  if (!ip || !port || !data) {
    return res.status(400).json({ error: 'ip, port, and data are required' });
  }
  try {
    const net = await import('net');
    const buf = Buffer.from(data, 'base64');
    await new Promise((resolve, reject) => {
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
    const code = err.code;
    if (code === 'ECONNREFUSED')  return res.status(503).json({ error: `Printer refused connection at ${ip}:${port}` });
    if (code === 'ETIMEDOUT')     return res.status(503).json({ error: `Printer timed out at ${ip}:${port}` });
    if (code === 'ENETUNREACH')   return res.status(503).json({ error: `Network unreachable — check IP ${ip}` });
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/print-label ─────────────────────────────────────
// Sends ZPL (plain text) to a Zebra label printer over TCP.
// Body: { ip: string, port: number (default 9100), zpl: string }
export const printNetworkLabel = async (req, res) => {
  const { ip, port = 9100, zpl } = req.body;
  if (!ip || !zpl) return res.status(400).json({ error: 'ip and zpl are required' });
  try {
    const net = await import('net');
    const buf = Buffer.from(zpl, 'utf8');
    await new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => { socket.destroy(); reject(new Error('Label printer timeout')); }, 8000);
      socket.connect(Number(port), ip, () => {
        socket.write(buf, () => { socket.end(); clearTimeout(timeout); resolve(); });
      });
      socket.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
    res.json({ ok: true, message: `ZPL sent to ${ip}:${port}` });
  } catch (err) {
    if (err.code === 'ECONNREFUSED') return res.status(503).json({ error: `Label printer refused at ${ip}:${port}` });
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/branding ────────────────────────────────────────
export const getPosBranding = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = req.query.storeId || req.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId required' });
    const store = await prisma.store.findFirst({
      where:  { id: storeId, orgId },
      select: { name: true, branding: true },
    });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json({ storeName: store.name, ...(store.branding || {}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/config ──────────────────────────────────────────
// Returns store's POS layout config (store.pos) + branding (store.branding).
// Requires X-Station-Token OR valid cashier JWT.
export const getPOSConfig = async (req, res) => {
  try {
    const storeId = req.query.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId required' });
    const store = await prisma.store.findFirst({
      where: { id: storeId },
      select: { pos: true, branding: true },
    });
    // Return pos config merged with branding so front-end gets everything in one call
    const posConfig  = (store?.pos      && typeof store.pos      === 'object') ? store.pos      : {};
    const branding   = (store?.branding && typeof store.branding === 'object') ? store.branding : {};
    res.json({ ...posConfig, branding });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PUT /api/pos-terminal/config ──────────────────────────────────────────
// Saves POS config → store.pos  and optionally branding → store.branding.
// Manager/owner/admin only.
export const savePOSConfig = async (req, res) => {
  try {
    const { storeId, config, branding } = req.body;
    if (!storeId || !config) return res.status(400).json({ error: 'storeId and config required' });

    const orgId = req.tenantId || req.user?.orgId;
    const store = await prisma.store.findFirst({ where: { id: storeId, orgId } });
    if (!store) return res.status(404).json({ error: 'Store not found' });

    // Build update payload — only include branding if provided
    const updateData = { pos: config };
    if (branding && typeof branding === 'object') {
      updateData.branding = branding;
    }

    await prisma.store.update({
      where: { id: storeId },
      data:  updateData,
    });

    res.json({ success: true, config, branding: branding || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/transactions ────────────────────────────────────
// List transactions with filters: date, dateFrom, dateTo, cashierId, stationId,
// status, amountMin, amountMax, limit, offset
export const listTransactions = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      storeId, date, dateFrom, dateTo,
      cashierId, stationId, status,
      amountMin, amountMax,
      limit = 200, offset = 0,
    } = req.query;

    const where = { orgId };
    if (storeId)   where.storeId   = storeId;
    if (cashierId) where.cashierId = cashierId;
    if (stationId) where.stationId = stationId;
    // Default: include sales + refunds, exclude voids (matches EoD report
    // semantics so the back-office Transactions page agrees with EoD).
    // Caller can pass `?status=all` to include everything, or any specific
    // status string to filter to that one.
    if (status === 'all') {
      // no filter
    } else if (status) {
      where.status = status;
    } else {
      where.status = { in: ['complete', 'refund'] };
    }

    // Amount range filter on grandTotal
    if (amountMin || amountMax) {
      where.grandTotal = {};
      if (amountMin) where.grandTotal.gte = parseFloat(amountMin);
      if (amountMax) where.grandTotal.lte = parseFloat(amountMax);
    }

    // Date/time window — use local server day boundaries (matches the
    // dashboard / employee report fix in Session 7). `new Date('YYYY-MM-DD')`
    // parses as UTC midnight; calling getFullYear/getMonth/getDate on that
    // returns LOCAL components, which silently shifts the day window by the
    // server's UTC offset and hides transactions made after local midnight.
    // Splitting on `-` and constructing the Date in local time avoids this.
    const startOfLocalDay = (str) => {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d, 0, 0, 0, 0);
    };
    const endOfLocalDay = (str) => {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d, 23, 59, 59, 999);
    };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = startOfLocalDay(dateFrom);
      if (dateTo)   where.createdAt.lte = endOfLocalDay(dateTo);
    } else if (date) {
      where.createdAt = { gte: startOfLocalDay(date), lte: endOfLocalDay(date) };
    }

    // Session 39 Round 4 — server-side sort across the full transaction set.
    // UI column clicks pass ?sortBy=<key>&sortDir=asc|desc. Unknown keys
    // fall back to createdAt-desc so the response shape stays stable.
    const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';
    const TX_SORT_MAP = {
      date:        { createdAt: sortDir },
      txNumber:    { txNumber:  sortDir },
      cashierName: { cashierName: sortDir },
      stationId:   { stationId: sortDir },
      total:       { grandTotal: sortDir },
      status:      { status: sortDir },
    };
    const orderBy = TX_SORT_MAP[req.query.sortBy] || { createdAt: 'desc' };

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

    // Resolve cashier names in one query
    const cashierIds = [...new Set(txs.map(t => t.cashierId).filter(Boolean))];
    const users = cashierIds.length ? await prisma.user.findMany({
      where:  { id: { in: cashierIds } },
      select: { id: true, name: true },
    }) : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

    res.json({
      total,
      transactions: txs.map(t => ({
        ...t,
        subtotal:     Number(t.subtotal     ?? 0),
        taxTotal:     Number(t.taxTotal     ?? 0),
        depositTotal: Number(t.depositTotal ?? 0),
        ebtTotal:     Number(t.ebtTotal     ?? 0),
        grandTotal:   Number(t.grandTotal),
        changeGiven:  Number(t.changeGiven),
        cashierName:  userMap[t.cashierId] || 'Unknown',
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/events ─────────────────────────────────────────
// Logs a business event (No Sale, manager override, etc.) to pos_logs.
// Cashier app sends these fire-and-forget; portal reads them via GET /events.
export const logPosEvent = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      storeId, eventType,
      cashierId, cashierName,
      stationId, stationName,
      note,
    } = req.body;

    if (!eventType) return res.status(400).json({ error: 'eventType required' });

    await prisma.posLog.create({
      data: {
        orgId,
        storeId: storeId || null,
        endpoint:   eventType,           // e.g. 'no_sale'
        method:     'EVENT',             // distinguishes business events from HTTP logs
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
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/events ──────────────────────────────────────────
// Lists business events for the back-office portal.
// Filters: storeId, eventType, dateFrom, dateTo, limit, offset
export const listPosEvents = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      storeId, eventType,
      dateFrom, dateTo,
      limit = 100, offset = 0,
    } = req.query;

    const where = { orgId, method: 'EVENT' };
    if (storeId)   where.storeId  = storeId;
    if (eventType) where.endpoint = eventType;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        const d = new Date(dateFrom);
        where.createdAt.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
      }
      if (dateTo) {
        const d = new Date(dateTo);
        where.createdAt.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      }
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

    res.json({
      total,
      events: rows.map(r => {
        let details = {};
        try { details = r.message ? JSON.parse(r.message) : {}; } catch {}
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
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/transactions/:id/void ──────────────────────────
export const voidTransaction = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { id }   = req.params;
    const { note } = req.body;

    const tx = await prisma.transaction.findFirst({ where: { id, orgId } });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.status === 'voided') return res.status(400).json({ error: 'Transaction already voided' });
    if (tx.status === 'refund') return res.status(400).json({ error: 'Cannot void a refund transaction' });

    const voided = await prisma.transaction.update({
      where: { id },
      data: {
        status:      'voided',
        notes:       note ? `VOID: ${note}` : `VOIDED by ${req.user.name || req.user.email}`,
        voidedAt:    new Date(),
        voidedById:  req.user.id,
      },
    });

    // Reverse any loyalty points earned/redeemed on the original tx, and
    // refund any in-store charge that was posted to a customer's account.
    reverseTransactionPoints({ originalTx: tx, reason: 'void_reverse' })
      .catch(err => console.error('[loyalty] void reverse error:', err.message));
    const chargeAmount = _sumChargeTender(tx.tenderLines);
    if (chargeAmount > 0) {
      // Find the customer linked to this tx via pointsHistory (same lookup
      // approach reverseTransactionPoints uses) and refund their balance.
      _refundChargeOnTx({ orgId, originalTx: tx, chargeAmount })
        .catch(err => console.error('[charge] void refund error:', err.message));
    }

    res.json({ ...voided, grandTotal: Number(voided.grandTotal) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/transactions/:id/refund ────────────────────────
export const createRefund = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { id }  = req.params;
    const { lineItems, tenderLines, note, grandTotal, subtotal, taxTotal, depositTotal } = req.body;

    const orig = await prisma.transaction.findFirst({ where: { id, orgId } });
    if (!orig) return res.status(404).json({ error: 'Original transaction not found' });
    if (orig.status === 'voided') return res.status(400).json({ error: 'Cannot refund a voided transaction' });

    // Generate refund transaction number
    const today   = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
    const count   = await prisma.transaction.count({ where: { orgId, storeId: orig.storeId } });
    const txNumber = `REF-${dateStr}-${String(count + 1).padStart(6, '0')}`;

    const refund = await prisma.transaction.create({
      data: {
        orgId,
        storeId:      orig.storeId,
        cashierId:    req.user.id,
        stationId:    orig.stationId,
        txNumber,
        status:       'refund',
        refundOf:     id,
        lineItems:    lineItems || orig.lineItems || [],
        subtotal:     -(parseFloat(subtotal)      || Number(orig.subtotal)),
        taxTotal:     -(parseFloat(taxTotal)       || Number(orig.taxTotal)),
        depositTotal: -(parseFloat(depositTotal)   || 0),
        ebtTotal:     0,
        grandTotal:   -(parseFloat(grandTotal)     || Number(orig.grandTotal)),
        tenderLines:  tenderLines || [],
        changeGiven:  0,
        notes:        note || `Refund for ${orig.txNumber}`,
        syncedAt:     new Date(),
      },
    });

    // Reverse loyalty + charge effects of the original tx.
    reverseTransactionPoints({ originalTx: orig, reason: 'refund_reverse' })
      .catch(err => console.error('[loyalty] refund reverse error:', err.message));
    const origCharge = _sumChargeTender(orig.tenderLines);
    if (origCharge > 0) {
      _refundChargeOnTx({ orgId, originalTx: orig, chargeAmount: origCharge })
        .catch(err => console.error('[charge] refund reverse error:', err.message));
    }

    res.status(201).json({ ...refund, grandTotal: Number(refund.grandTotal) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/pos-terminal/transactions/open-refund ──────────────────────
// No-receipt refund — creates a standalone refund transaction with no parent.
export const createOpenRefund = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { storeId, lineItems, tenderLines, note, grandTotal, subtotal, taxTotal } = req.body;

    if (!storeId)            return res.status(400).json({ error: 'storeId required' });
    if (!lineItems?.length)  return res.status(400).json({ error: 'lineItems required' });
    if (!grandTotal)         return res.status(400).json({ error: 'grandTotal required' });

    const today   = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
    const count   = await prisma.transaction.count({ where: { orgId, storeId } });
    const txNumber = `REF-${dateStr}-${String(count + 1).padStart(6, '0')}`;

    const refund = await prisma.transaction.create({
      data: {
        orgId,
        storeId,
        cashierId:    req.user.id,
        txNumber,
        status:       'refund',
        lineItems:    lineItems || [],
        subtotal:     -(parseFloat(subtotal)  || parseFloat(grandTotal)),
        taxTotal:     -(parseFloat(taxTotal)  || 0),
        depositTotal: 0,
        ebtTotal:     0,
        grandTotal:   -(parseFloat(grandTotal)),
        tenderLines:  tenderLines || [],
        changeGiven:  0,
        notes:        note || 'No-receipt return',
        syncedAt:     new Date(),
      },
    });

    res.status(201).json({ ...refund, grandTotal: Number(refund.grandTotal) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// NOTE: A legacy `getEndOfDayReport` controller used to live here. It has
// been removed in favour of the comprehensive controller in
// `endOfDayReportController.js` (returns header / payouts[] / tenders[] /
// transactions[] / fuel / reconciliation / totals). The cashier-app and
// back-office both consume the new shape via:
//   - GET /api/reports/end-of-day  (registered in reportsRoutes.js)
//   - GET /api/pos-terminal/end-of-day  (cashier-app alternate path,
//     registered in posTerminalRoutes.js, points at the new controller)

// ── POST /api/pos-terminal/clock ──────────────────────────────────────────
// Clock in or out identified by PIN (no JWT needed — uses station token)
export const clockEvent = async (req, res) => {
  try {
    const { pin, type } = req.body;

    if (!['in', 'out'].includes(type)) return res.status(400).json({ error: 'type must be "in" or "out"' });
    if (!pin || typeof pin !== 'string' || pin.length < 4 || pin.length > 8) {
      return res.status(400).json({ error: 'PIN required (4-8 digits)' });
    }
    if (!/^\d+$/.test(pin)) return res.status(400).json({ error: 'PIN must be numeric' });

    // Identify user by PIN (same logic as pinLogin)
    const stationToken = req.headers['x-station-token'];
    if (!stationToken || typeof stationToken !== 'string' || stationToken.length < 16) {
      return res.status(401).json({ error: 'Station token required' });
    }

    const station = await prisma.station.findUnique({ where: { token: stationToken } });
    if (!station) return res.status(401).json({ error: 'Invalid station token' });

    const bcrypt = await import('bcryptjs');
    const users  = await prisma.user.findMany({
      where: { orgId: station.orgId, posPin: { not: null }, status: 'active' },
      select: { id: true, name: true, posPin: true },
    });

    let matchedUser = null;
    for (const u of users) {
      if (bcrypt.default.compareSync(pin, u.posPin)) { matchedUser = u; break; }
    }
    if (!matchedUser) return res.status(401).json({ error: 'Invalid PIN' });

    // ── Trust only station-side identifiers ────────────────────────────────
    // Never trust client-supplied storeId / stationId. Always force the IDs
    // that are bound to the authenticated station token.
    const effectiveStoreId = station.storeId;
    const effectiveStationId = station.id;

    // ── Duplicate state guard ────────────────────────────────────────────────
    // Find the last clock event for this employee at this store
    const lastEvent = await prisma.clockEvent.findFirst({
      where: { orgId: station.orgId, storeId: effectiveStoreId, userId: matchedUser.id },
      orderBy: { createdAt: 'desc' },
      select: { type: true, createdAt: true },
    });

    if (type === 'in' && lastEvent?.type === 'in') {
      // Already clocked in — don't create a duplicate event
      return res.status(200).json({
        alreadyClockedIn: true,
        userName: matchedUser.name,
        since: lastEvent.createdAt,
      });
    }

    if (type === 'out' && (!lastEvent || lastEvent.type === 'out')) {
      // Not clocked in yet — cannot clock out
      return res.status(200).json({
        notClockedIn: true,
        userName: matchedUser.name,
      });
    }
    // ────────────────────────────────────────────────────────────────────────

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
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/pos-terminal/clock/status ───────────────────────────────────
// Returns the last clock event for a given user (to show clocked-in state)
export const getClockStatus = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = req.query.storeId;
    const userId  = req.query.userId || req.user?.id;

    const last = await prisma.clockEvent.findFirst({
      where:   { orgId, ...(storeId && { storeId }), userId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ clockedIn: last?.type === 'in', lastEvent: last || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
