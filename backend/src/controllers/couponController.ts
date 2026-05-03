/**
 * couponController.ts  (Session 45 — catalog only, Session 46 — POS validation)
 *
 * Manages the ManufacturerCoupon catalog — the corpus of coupons retailers
 * accept at the register and submit for reimbursement via scan data feeds.
 *
 * In Session 45:
 *   • CRUD for ManufacturerCoupon rows (manual entry primary)
 *   • CSV import (best-effort; column-tolerant)
 *   • Read-only redemption history endpoints
 *
 * In Session 46:
 *   • POS coupon validation + apply (cashier-app)
 *   • Threshold-aware manager-PIN gate
 *   • Auto-flow into ScanDataSubmission rows
 *
 * Permissions:
 *   coupons.view    — manager+ (catalog read)
 *   coupons.manage  — manager+ (catalog CRUD + import)
 *   coupons.redeem  — cashier+ (POS apply — Session 46)
 *   coupons.approve — manager+ (high-value gate — Session 46)
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

const getOrgId = (req: Request): string | null | undefined =>
  req.orgId || req.user?.orgId;

const num = (v: unknown): number | null =>
  v != null && v !== '' ? Number(v) : null;

const safeDate = (v: unknown): Date | null =>
  v ? new Date(v as string | number | Date) : null;

// ══════════════════════════════════════════════════════════════════════════
// COUPON CATALOG
// ══════════════════════════════════════════════════════════════════════════

export const listCoupons = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as {
      manufacturerId?: string;
      brandFamily?: string;
      active?: string;
      expired?: string;
      search?: string;
      limit?: string;
    };
    const { manufacturerId, brandFamily, active, expired, search, limit } = q;

    const where: Prisma.ManufacturerCouponWhereInput = {
      OR: [{ orgId: orgId ?? undefined }, { orgId: null }], // include platform-wide coupons
    };
    if (manufacturerId) where.manufacturerId = String(manufacturerId);
    if (brandFamily)    where.brandFamily = String(brandFamily);
    if (active === 'true')  where.active = true;
    if (active === 'false') where.active = false;
    if (expired === 'true')  where.expirationDate = { lt: new Date() };
    if (expired === 'false') where.expirationDate = { gte: new Date() };
    if (search) {
      where.AND = [
        { OR: [
          { serialNumber: { contains: String(search) } },
          { displayName:  { contains: String(search), mode: 'insensitive' } },
          { brandFamily:  { contains: String(search), mode: 'insensitive' } },
        ] },
      ];
    }

    const rows = await prisma.manufacturerCoupon.findMany({
      where,
      include: {
        manufacturer: {
          select: { id: true, code: true, name: true, shortName: true, parentMfrCode: true },
        },
        _count: { select: { redemptions: true } },
      },
      orderBy: [{ active: 'desc' }, { expirationDate: 'asc' }],
      take: Math.min(Number(limit) || 200, 1000),
    });

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const getCoupon = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;

    const row = await prisma.manufacturerCoupon.findFirst({
      where: { id, OR: [{ orgId: orgId ?? undefined }, { orgId: null }] },
      include: { manufacturer: true, _count: { select: { redemptions: true } } },
    });
    if (!row) { res.status(404).json({ success: false, error: 'Coupon not found' }); return; }
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

interface CreateCouponBody {
  manufacturerId?: string;
  serialNumber?: string;
  displayName?: string | null;
  brandFamily?: string;
  discountType?: string;
  discountAmount?: number | string;
  effectiveDate?: string | Date | null;
  expirationDate?: string | Date;
  qualifyingUpcs?: unknown[];
  minQty?: number | string | null;
  requiresMultipack?: boolean | string;
  maxPerTx?: number | string | null;
  maxPerCoupon?: number | string | null;
  fundedBy?: string;
}

export const createCoupon = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as CreateCouponBody;
    const {
      manufacturerId,
      serialNumber,
      displayName,
      brandFamily,
      discountType,
      discountAmount,
      effectiveDate,
      expirationDate,
      qualifyingUpcs,
      minQty,
      requiresMultipack,
      maxPerTx,
      maxPerCoupon,
      fundedBy,
    } = body;

    if (!manufacturerId || !serialNumber || !brandFamily || !discountType || discountAmount == null || !expirationDate) {
      res.status(400).json({
        success: false,
        error: 'manufacturerId, serialNumber, brandFamily, discountType, discountAmount, and expirationDate are required',
      });
      return;
    }

    const mfr = await prisma.tobaccoManufacturer.findUnique({ where: { id: String(manufacturerId) } });
    if (!mfr) { res.status(400).json({ success: false, error: 'Unknown manufacturer feed' }); return; }

    if (!['fixed', 'percent'].includes(discountType)) {
      res.status(400).json({ success: false, error: 'discountType must be "fixed" or "percent"' });
      return;
    }

    const dup = await prisma.manufacturerCoupon.findUnique({ where: { serialNumber: String(serialNumber) } });
    if (dup) {
      res.status(409).json({ success: false, error: `Coupon serial ${serialNumber} is already in the catalog` });
      return;
    }

    const row = await prisma.manufacturerCoupon.create({
      data: {
        orgId: orgId ?? undefined,
        manufacturerId,
        serialNumber:    String(serialNumber).trim(),
        displayName:     displayName ? String(displayName).trim() : null,
        brandFamily:     String(brandFamily).trim(),
        discountType,
        discountAmount:  Number(discountAmount),
        effectiveDate:   safeDate(effectiveDate),
        expirationDate:  new Date(expirationDate),
        qualifyingUpcs:  Array.isArray(qualifyingUpcs) ? qualifyingUpcs.map(String) : [],
        minQty:          num(minQty) || 1,
        requiresMultipack: Boolean(requiresMultipack),
        maxPerTx:        num(maxPerTx),
        maxPerCoupon:    num(maxPerCoupon) || 1,
        fundedBy:        fundedBy === 'retailer' ? 'retailer' : 'manufacturer',
        createdById:     req.user?.id || null,
        importedFrom:    'manual',
      },
      include: { manufacturer: true },
    });

    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const updateCoupon = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;

    const existing = await prisma.manufacturerCoupon.findFirst({
      where: { id, OR: [{ orgId: orgId ?? undefined }, { orgId: null }] },
    });
    if (!existing) { res.status(404).json({ success: false, error: 'Coupon not found' }); return; }

    const body = (req.body || {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    const fields: string[] = [
      'displayName', 'brandFamily', 'discountType', 'discountAmount',
      'effectiveDate', 'expirationDate', 'qualifyingUpcs',
      'minQty', 'requiresMultipack', 'maxPerTx', 'maxPerCoupon',
      'fundedBy', 'active',
    ];
    for (const f of fields) {
      if (f in body) data[f] = body[f];
    }
    if (data.discountAmount != null) data.discountAmount = Number(data.discountAmount);
    if (data.effectiveDate) data.effectiveDate = new Date(data.effectiveDate as string | number | Date);
    if (data.expirationDate) data.expirationDate = new Date(data.expirationDate as string | number | Date);
    if (data.qualifyingUpcs && Array.isArray(data.qualifyingUpcs)) data.qualifyingUpcs = (data.qualifyingUpcs as unknown[]).map(String);
    if (data.minQty != null) data.minQty = Number(data.minQty);
    if (data.maxPerTx != null) data.maxPerTx = Number(data.maxPerTx);
    if (data.maxPerCoupon != null) data.maxPerCoupon = Number(data.maxPerCoupon);

    const updated = await prisma.manufacturerCoupon.update({
      where: { id },
      data: data as Prisma.ManufacturerCouponUpdateInput,
      include: { manufacturer: true },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const deleteCoupon = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const existing = await prisma.manufacturerCoupon.findFirst({
      where: { id, OR: [{ orgId: orgId ?? undefined }, { orgId: null }] },
    });
    if (!existing) { res.status(404).json({ success: false, error: 'Coupon not found' }); return; }

    // If any redemptions exist, soft-delete instead (FK preserved for audit trail)
    const redemptionCount = await prisma.couponRedemption.count({ where: { couponId: id } });
    if (redemptionCount > 0) {
      await prisma.manufacturerCoupon.update({ where: { id }, data: { active: false } });
      res.json({ success: true, softDeleted: true, redemptionCount });
      return;
    }

    await prisma.manufacturerCoupon.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// CSV import — column-tolerant (matches common header variants).
// Expected columns (any case, any order):
//   serial / serialNumber / serial_number
//   manufacturer / manufacturerCode / mfr  (matches TobaccoManufacturer.code)
//   brand / brandFamily / family
//   discountType / type    (fixed | percent)
//   discountAmount / amount / value
//   expiration / expirationDate / expDate / expiry
//   qualifyingUpcs (semicolon or pipe separated)
//   minQty / minimumQuantity
//   requiresMultipack (Y / N / true / false)
//   displayName / name
interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; serial?: string; error: string }>;
}

export const importCouponsCsv = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as { rows?: Array<Record<string, unknown>> };
    const rows = body.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ success: false, error: 'rows[] is required' });
      return;
    }

    // Build a code → manufacturer ID lookup
    const mfrs = await prisma.tobaccoManufacturer.findMany({
      where: { active: true },
      select: { id: true, code: true, brandFamilies: true },
    });
    type MfrRow = (typeof mfrs)[number];
    const mfrByCode: Record<string, MfrRow> = Object.fromEntries(mfrs.map((m: MfrRow) => [m.code, m]));

    // Lower-case header lookup helper
    const get = (row: Record<string, unknown>, ...keys: string[]): string | null => {
      for (const k of keys) {
        const lk = Object.keys(row).find((rk) => rk.toLowerCase() === k.toLowerCase());
        if (lk && row[lk] != null && row[lk] !== '') return String(row[lk]).trim();
      }
      return null;
    };

    const results: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

    for (const [i, row] of rows.entries()) {
      try {
        const serial = get(row, 'serial', 'serialnumber', 'serial_number');
        const mfrCode = get(row, 'manufacturer', 'manufacturercode', 'mfr');
        const brand = get(row, 'brand', 'brandfamily', 'family');
        const dType = get(row, 'discounttype', 'type');
        const dAmt = get(row, 'discountamount', 'amount', 'value');
        const expDate = get(row, 'expiration', 'expirationdate', 'expdate', 'expiry');

        if (!serial || !mfrCode || !brand || !dType || !dAmt || !expDate) {
          results.skipped++;
          results.errors.push({ row: i + 1, error: 'Missing required column (serial/manufacturer/brand/discountType/discountAmount/expiration)' });
          continue;
        }

        const mfr = mfrByCode[mfrCode];
        if (!mfr) {
          results.skipped++;
          results.errors.push({ row: i + 1, serial, error: `Unknown manufacturer code: ${mfrCode}` });
          continue;
        }
        if (!['fixed', 'percent'].includes(dType.toLowerCase())) {
          results.skipped++;
          results.errors.push({ row: i + 1, serial, error: `Invalid discountType: ${dType}` });
          continue;
        }

        const upcsRaw = get(row, 'qualifyingupcs', 'upcs');
        const upcs = upcsRaw ? upcsRaw.split(/[;|,]/).map((s) => s.trim()).filter(Boolean) : [];

        const data: Prisma.ManufacturerCouponCreateInput = {
          org: orgId ? { connect: { id: orgId } } : undefined,
          manufacturer:    { connect: { id: mfr.id } },
          serialNumber:      serial,
          displayName:       get(row, 'displayname', 'name'),
          brandFamily:       brand,
          discountType:      dType.toLowerCase(),
          discountAmount:    Number(dAmt),
          expirationDate:    new Date(expDate),
          qualifyingUpcs:    upcs,
          minQty:            Number(get(row, 'minqty', 'minimumquantity')) || 1,
          requiresMultipack: ['y', 'yes', 'true', '1'].includes((get(row, 'requiresmultipack') || 'n').toLowerCase()),
          maxPerTx:          num(get(row, 'maxpertx')),
          maxPerCoupon:      num(get(row, 'maxpercoupon')) || 1,
          fundedBy:          (get(row, 'fundedby') || 'manufacturer').toLowerCase() === 'retailer' ? 'retailer' : 'manufacturer',
          createdById:       req.user?.id || null,
          importedFrom:      'csv',
        } as Prisma.ManufacturerCouponCreateInput;

        const existing = await prisma.manufacturerCoupon.findUnique({ where: { serialNumber: serial } });
        if (existing) {
          // Only update if it belongs to this org (or is platform-wide)
          if (existing.orgId && existing.orgId !== orgId) {
            results.skipped++;
            results.errors.push({ row: i + 1, serial, error: 'Coupon belongs to another org' });
            continue;
          }
          // Strip the `org` connect for update path — orgId stays as-is.
          const { org: _ignoreOrg, manufacturer: _ignoreMfr, ...updateData } = data as Prisma.ManufacturerCouponCreateInput & { org?: unknown; manufacturer?: unknown };
          await prisma.manufacturerCoupon.update({
            where: { id: existing.id },
            data: { ...updateData, manufacturerId: mfr.id } as unknown as Prisma.ManufacturerCouponUpdateInput,
          });
          results.updated++;
        } else {
          await prisma.manufacturerCoupon.create({ data });
          results.created++;
        }
      } catch (err) {
        results.errors.push({ row: i + 1, error: (err as Error).message });
      }
    }

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// VALIDATION  (Session 46 — runtime check at POS)
// ══════════════════════════════════════════════════════════════════════════
interface CartItemIn {
  lineId?: string;
  upc?: string;
  qty?: number | string;
  lineTotal?: number | string;
}

interface ValidateBody {
  serial?: string;
  cartItems?: CartItemIn[];
  existingSerials?: string[];
}

export const validateCoupon = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = (req.headers['x-store-id'] as string | undefined) || req.storeId;
    const body = (req.body || {}) as ValidateBody;
    const { serial, cartItems = [], existingSerials = [] } = body;

    if (!serial) {
      res.status(400).json({ success: false, error: 'serial is required' });
      return;
    }

    const trimmedSerial = String(serial).trim();

    // 1. Already used in this transaction
    if (existingSerials.includes(trimmedSerial)) {
      res.json({
        success: true, valid: false,
        reason: 'This coupon has already been applied to the current transaction.',
      });
      return;
    }

    // 2. Find the coupon (org-scoped + platform-wide)
    const coupon = await prisma.manufacturerCoupon.findFirst({
      where: { serialNumber: trimmedSerial, OR: [{ orgId: orgId ?? undefined }, { orgId: null }] },
      include: { manufacturer: true },
    });
    if (!coupon) {
      res.json({
        success: true, valid: false,
        reason: 'Coupon not found in catalog. Add it under Scan Data → Coupons before redeeming.',
      });
      return;
    }

    // 3. Active flag
    if (!coupon.active) {
      res.json({ success: true, valid: false, reason: 'This coupon has been deactivated.' });
      return;
    }

    // 4. Date window
    const now = new Date();
    if (coupon.effectiveDate && new Date(coupon.effectiveDate) > now) {
      res.json({
        success: true, valid: false,
        reason: `Not valid until ${new Date(coupon.effectiveDate).toLocaleDateString()}.`,
      });
      return;
    }
    if (new Date(coupon.expirationDate) < now) {
      res.json({
        success: true, valid: false,
        reason: `Expired ${new Date(coupon.expirationDate).toLocaleDateString()}.`,
      });
      return;
    }

    // 5. Find qualifying lines in cart
    let qualifyingLines: CartItemIn[] = [];
    if (coupon.qualifyingUpcs && coupon.qualifyingUpcs.length > 0) {
      // Explicit UPC list — match exact
      const upcSet = new Set(coupon.qualifyingUpcs.map(String));
      qualifyingLines = cartItems.filter((it) => it.upc && upcSet.has(String(it.upc)));
    } else {
      // No explicit UPCs → fall back to brand-family tobacco product mapping
      const upcs = cartItems.map((it) => String(it.upc)).filter(Boolean);
      if (upcs.length > 0) {
        const matches = await prisma.tobaccoProductMap.findMany({
          where: {
            orgId: orgId ?? undefined,
            manufacturerId: coupon.manufacturerId,
            brandFamily: coupon.brandFamily,
            masterProduct: { upc: { in: upcs } },
          },
          include: { masterProduct: { select: { upc: true } } },
        });
        type MatchRow = (typeof matches)[number];
        const matchedUpcs = new Set(matches.map((m: MatchRow) => m.masterProduct?.upc).filter(Boolean));
        qualifyingLines = cartItems.filter((it) => matchedUpcs.has(String(it.upc)));
      }
    }

    if (qualifyingLines.length === 0) {
      res.json({
        success: true, valid: false,
        reason: `No qualifying ${coupon.brandFamily} product in cart.`,
        coupon: {
          id: coupon.id, serial: coupon.serialNumber, brandFamily: coupon.brandFamily,
          discountAmount: coupon.discountAmount, discountType: coupon.discountType,
        },
      });
      return;
    }

    // 6. Multipack / minQty check
    const totalQty = qualifyingLines.reduce((s, l) => s + Number(l.qty || 0), 0);
    if (coupon.requiresMultipack && totalQty < coupon.minQty) {
      res.json({
        success: true, valid: false,
        reason: `Coupon requires ${coupon.minQty} qualifying items in cart (currently ${totalQty}).`,
      });
      return;
    }

    // 7. Per-coupon serial cap (most coupons single-use; track via DB redemption count)
    const priorRedemptions = await prisma.couponRedemption.count({
      where: { couponSerial: trimmedSerial, orgId: orgId ?? undefined },
    });
    if (coupon.maxPerCoupon && priorRedemptions >= coupon.maxPerCoupon) {
      res.json({
        success: true, valid: false,
        reason: 'This coupon has already been redeemed the maximum number of times.',
      });
      return;
    }

    // 8. Compute discount value (clamped to qualifying line total)
    const qualifyingLineTotal = qualifyingLines.reduce((s, l) => s + Number(l.lineTotal || 0), 0);
    let computedDiscount = 0;
    if (coupon.discountType === 'percent') {
      computedDiscount = Math.min(qualifyingLineTotal * Number(coupon.discountAmount) / 100, qualifyingLineTotal);
    } else {
      computedDiscount = Math.min(Number(coupon.discountAmount), qualifyingLineTotal);
    }
    computedDiscount = Math.round(computedDiscount * 100) / 100;

    // 9. Threshold check (manager-PIN gate)
    let storeConfig: Record<string, unknown> | null = null;
    if (storeId) {
      const store = await prisma.store.findFirst({ where: { id: storeId, orgId: orgId ?? undefined } });
      storeConfig = (store?.pos as Record<string, unknown> | null) || {};
    }
    const maxVal   = Number(storeConfig?.couponMaxValueWithoutMgr  ?? 5);
    const maxTotal = Number(storeConfig?.couponMaxTotalWithoutMgr  ?? 10);
    const maxCount = Number(storeConfig?.couponMaxCountWithoutMgr  ?? 5);

    let requiresApproval = false;
    let approvalReason: string | null = null;

    if (computedDiscount > maxVal) {
      requiresApproval = true;
      approvalReason = `Coupon value $${computedDiscount.toFixed(2)} exceeds the $${maxVal.toFixed(2)} per-coupon limit.`;
    } else if (existingSerials.length + 1 > maxCount) {
      requiresApproval = true;
      approvalReason = `Adding this coupon would exceed the ${maxCount}-coupon transaction limit.`;
    } else {
      // Cumulative tx total would need to come from the cart (we don't have it here).
      // The cashier-app should ALSO compute the cumulative total locally and gate on
      // maxTotal. We expose maxTotal in the response so the client can do that check.
    }

    res.json({
      success: true, valid: true,
      coupon: {
        id: coupon.id,
        serial: coupon.serialNumber,
        displayName: coupon.displayName,
        brandFamily: coupon.brandFamily,
        manufacturerId: coupon.manufacturerId,
        manufacturerCode: coupon.manufacturer?.code,
        discountType: coupon.discountType,
        discountAmount: Number(coupon.discountAmount),
        fundedBy: coupon.fundedBy,
        requiresMultipack: coupon.requiresMultipack,
        minQty: coupon.minQty,
      },
      qualifyingLines: qualifyingLines.map((l) => ({
        lineId: l.lineId, upc: l.upc, qty: l.qty, lineTotal: l.lineTotal,
      })),
      computedDiscount,
      requiresApproval,
      approvalReason,
      thresholds: { maxVal, maxTotal, maxCount },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// REDEMPTIONS  (read-only in Session 45 — Session 46 ships create-from-POS)
// ══════════════════════════════════════════════════════════════════════════

export const listRedemptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as {
      storeId?: string;
      manufacturerId?: string;
      status?: string;
      search?: string;
      limit?: string;
    };
    const { storeId, manufacturerId, status, search, limit } = q;

    const where: Prisma.CouponRedemptionWhereInput = { orgId: orgId ?? undefined };
    if (storeId)        where.storeId = String(storeId);
    if (manufacturerId) where.manufacturerId = String(manufacturerId);
    if (status === 'submitted')   where.submittedAt   = { not: null };
    if (status === 'pending')     where.submittedAt   = null;
    if (status === 'reimbursed')  where.reimbursedAt  = { not: null };
    if (status === 'rejected')    where.rejectedAt    = { not: null };
    if (search) {
      where.OR = [
        { couponSerial: { contains: String(search) } },
        { brandFamily:  { contains: String(search), mode: 'insensitive' } },
        { transactionId: { contains: String(search) } },
      ];
    }

    const rows = await prisma.couponRedemption.findMany({
      where,
      include: {
        coupon: { select: { id: true, serialNumber: true, displayName: true, brandFamily: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: Math.min(Number(limit) || 200, 1000),
    });

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const getRedemptionStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as { storeId?: string; days?: string };
    const { storeId, days } = q;

    const since = new Date();
    since.setDate(since.getDate() - (Number(days) || 30));

    const where: Prisma.CouponRedemptionWhereInput = {
      orgId: orgId ?? undefined,
      createdAt: { gte: since },
    };
    if (storeId) where.storeId = String(storeId);

    const [total, submitted, reimbursed, totalAmountAgg] = await Promise.all([
      prisma.couponRedemption.count({ where }),
      prisma.couponRedemption.count({ where: { ...where, submittedAt: { not: null } } }),
      prisma.couponRedemption.count({ where: { ...where, reimbursedAt: { not: null } } }),
      prisma.couponRedemption.aggregate({ where, _sum: { discountApplied: true } }),
    ]);

    res.json({
      success: true,
      data: {
        total,
        submitted,
        reimbursed,
        pending: total - submitted,
        totalAmount: Number(totalAmountAgg._sum.discountApplied || 0),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
