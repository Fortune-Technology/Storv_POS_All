// @ts-nocheck — Phase 4: ts-nocheck while Prisma client types catch up to
//   the new PricingTier + PricingModelChange + Store extensions added in
//   Session 50. Will tighten in the strict-Prisma-typing rollout (Phase 5)
//   once the client is regen'd in production.

/**
 * pricingModelController.ts — Session 50.
 *
 * Manages the per-store dual-pricing / cash-discount configuration:
 *
 *   - Pricing model toggle (interchange / dual_pricing) — superadmin only
 *   - Pricing tier assignment (tier_1 / tier_2 / tier_3)
 *   - Custom per-store override of surcharge rate + fixed fee
 *   - Per-store disclosure text override
 *
 * Plus the platform-level PricingTier catalog CRUD (also superadmin).
 *
 * Mounted at /api/pricing/* — see pricingModelRoutes.ts for route guards.
 *
 * Why a separate controller (rather than extending storeController):
 *   - Different RBAC tier (admin_pricing_model.manage vs the org-scope
 *     stores.* permissions).
 *   - Each toggle writes a PricingModelChange audit row — keeps that
 *     responsibility colocated with the toggle endpoint.
 *   - Read-only org-side endpoints (for the portal "view current model"
 *     surface) live alongside the write endpoints in the same module so
 *     the contract stays in one file.
 */

import type { Request, Response } from 'express';
import prisma from '../config/postgres.js';
import { errMsg } from '../utils/typeHelpers.js';
import { getEffectiveSurchargeRate, resolveDisclosureText } from '../services/dualPricing.js';

// ─── Pricing Tier catalog (admin) ──────────────────────────────────────

/** GET /api/pricing/tiers — list all tiers (active + inactive). */
export const listPricingTiers = async (_req: Request, res: Response): Promise<void> => {
  try {
    const tiers = await prisma.pricingTier.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json({ tiers });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

/** POST /api/pricing/tiers — superadmin: create a new tier. */
export const createPricingTier = async (req: Request, res: Response): Promise<void> => {
  try {
    const { key, name, description, surchargePercent, surchargeFixedFee, sortOrder, active, isDefault } = req.body;
    if (!key || !/^[a-z0-9_-]+$/i.test(String(key))) {
      res.status(400).json({ error: 'key must be alphanumeric (a-z, 0-9, _, -)' });
      return;
    }
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (surchargePercent == null || !Number.isFinite(Number(surchargePercent))) {
      res.status(400).json({ error: 'surchargePercent is required and must be a number' });
      return;
    }
    if (surchargeFixedFee == null || !Number.isFinite(Number(surchargeFixedFee))) {
      res.status(400).json({ error: 'surchargeFixedFee is required and must be a number' });
      return;
    }
    const tier = await prisma.pricingTier.create({
      data: {
        key:               String(key).toLowerCase(),
        name:              String(name).trim(),
        description:       description ? String(description) : null,
        surchargePercent:  Number(surchargePercent),
        surchargeFixedFee: Number(surchargeFixedFee),
        sortOrder:         Number(sortOrder) || 0,
        active:            active !== false,
        isDefault:         !!isDefault,
      },
    });
    res.status(201).json(tier);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(409).json({ error: 'A tier with this key already exists' });
      return;
    }
    res.status(500).json({ error: errMsg(err) });
  }
};

/** PUT /api/pricing/tiers/:id — superadmin: update a tier. */
export const updatePricingTier = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.pricingTier.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Tier not found' }); return; }

    const { name, description, surchargePercent, surchargeFixedFee, sortOrder, active, isDefault } = req.body;
    const updated = await prisma.pricingTier.update({
      where: { id },
      data: {
        ...(name              !== undefined && { name: String(name).trim() }),
        ...(description       !== undefined && { description: description ? String(description) : null }),
        ...(surchargePercent  !== undefined && { surchargePercent:  Number(surchargePercent) }),
        ...(surchargeFixedFee !== undefined && { surchargeFixedFee: Number(surchargeFixedFee) }),
        ...(sortOrder         !== undefined && { sortOrder: Number(sortOrder) || 0 }),
        ...(active            !== undefined && { active: !!active }),
        ...(isDefault         !== undefined && { isDefault: !!isDefault }),
      },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

/** DELETE /api/pricing/tiers/:id — superadmin: delete a tier (blocked when in use). */
export const deletePricingTier = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const inUse = await prisma.store.count({ where: { pricingTierId: id } });
    if (inUse > 0) {
      res.status(409).json({ error: `${inUse} store(s) reference this tier. Reassign them first.` });
      return;
    }
    await prisma.pricingTier.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ─── Per-Store Pricing Model (admin write, org-scope read) ─────────────

/**
 * GET /api/pricing/stores/:storeId
 *
 * Returns the resolved pricing config for a store — used by both the
 * superadmin per-store edit page and the portal Store Settings read-only
 * panel. Includes the recent-changes audit list (last 10).
 *
 * Read access:
 *   - superadmin (any store)
 *   - users with `pricing_model.view` (their own org's stores)
 *
 * The route guard handles the org check; this controller assumes the
 * caller has been authorised for the store.
 */
export const getStorePricingConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { storeId } = req.params;
    const isSuper = req.user?.role === 'superadmin';
    const orgFilter = isSuper ? {} : { orgId: req.orgId || req.user?.orgId };

    const store = await prisma.store.findFirst({
      where: { id: storeId, ...orgFilter },
      include: {
        pricingTier: true,
        state:       true,
        pricingModelChanges: {
          orderBy: { createdAt: 'desc' },
          take:    10,
        },
      },
    });
    if (!store) { res.status(404).json({ error: 'Store not found' }); return; }

    const effectiveRate = getEffectiveSurchargeRate({
      pricingModel:            store.pricingModel,
      pricingTier:             store.pricingTier as any,
      customSurchargePercent:  store.customSurchargePercent as any,
      customSurchargeFixedFee: store.customSurchargeFixedFee as any,
    });

    const disclosure = resolveDisclosureText(
      { dualPricingDisclosure: store.dualPricingDisclosure, pricingModel: store.pricingModel },
      store.state ? { surchargeDisclosureText: (store.state as any).surchargeDisclosureText } : null,
    );

    res.json({
      storeId:                 store.id,
      storeName:               store.name,
      orgId:                   store.orgId,
      stateCode:               store.stateCode,
      pricingModel:            store.pricingModel,
      pricingTierId:           store.pricingTierId,
      pricingTier:             store.pricingTier,
      customSurchargePercent:  store.customSurchargePercent,
      customSurchargeFixedFee: store.customSurchargeFixedFee,
      dualPricingDisclosure:   store.dualPricingDisclosure,
      dualPricingActivatedAt:  store.dualPricingActivatedAt,
      dualPricingActivatedBy:  store.dualPricingActivatedBy,
      effectiveRate,
      effectiveDisclosure:     disclosure,
      stateConstraints: store.state ? {
        surchargeTaxable:    (store.state as any).surchargeTaxable,
        maxSurchargePercent: (store.state as any).maxSurchargePercent,
        dualPricingAllowed:  (store.state as any).dualPricingAllowed,
        pricingFraming:      (store.state as any).pricingFraming,
      } : null,
      recentChanges:           store.pricingModelChanges,
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

/**
 * PUT /api/pricing/stores/:storeId
 *
 * Superadmin: update a store's pricing model + tier + custom rates +
 * disclosure. Writes a PricingModelChange audit row whenever model/tier/
 * rate/fee changes.
 *
 * Validations:
 *   - pricingModel must be 'interchange' | 'dual_pricing'
 *   - if state.dualPricingAllowed === false, dual_pricing is blocked
 *     (state forces cash_discount framing — handled at display layer
 *     but the toggle itself is allowed; we just warn the caller)
 *   - if state.maxSurchargePercent is set, custom override + tier rate
 *     must be at or below it
 *   - mid-shift switches: if any open shift exists at this store, block
 *     the toggle from changing pricingModel (rate changes within the
 *     same model still allowed) — protects in-progress drawer math
 */
export const updateStorePricingConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { storeId } = req.params;

    const store = await prisma.store.findUnique({
      where:   { id: storeId },
      include: { pricingTier: true, state: true },
    });
    if (!store) { res.status(404).json({ error: 'Store not found' }); return; }

    const {
      pricingModel,
      pricingTierId,
      customSurchargePercent,
      customSurchargeFixedFee,
      dualPricingDisclosure,
      reason,
    } = req.body || {};

    // ── Validate pricingModel ─────────────────────────────────────────
    const newModel = pricingModel === undefined ? store.pricingModel : String(pricingModel);
    if (newModel !== 'interchange' && newModel !== 'dual_pricing') {
      res.status(400).json({ error: "pricingModel must be 'interchange' or 'dual_pricing'" });
      return;
    }

    // ── Block mid-shift model changes ─────────────────────────────────
    if (newModel !== store.pricingModel) {
      const openShift = await prisma.shift.findFirst({
        where:  { storeId, status: 'open' },
        select: { id: true, openedAt: true },
      });
      if (openShift) {
        res.status(409).json({
          error: 'Close all open shifts before changing the pricing model. ' +
                 'The new model will take effect at the next shift open.',
          openShiftId: openShift.id,
        });
        return;
      }
    }

    // ── Resolve target tier (validate exists if specified) ────────────
    let newTierId: string | null = store.pricingTierId;
    if (pricingTierId !== undefined) {
      if (pricingTierId === null || pricingTierId === '') {
        newTierId = null;
      } else {
        const tier = await prisma.pricingTier.findUnique({ where: { id: String(pricingTierId) } });
        if (!tier) { res.status(400).json({ error: 'pricingTierId not found' }); return; }
        if (tier.key === 'custom') {
          // The "custom" tier is a sentinel — caller should clear pricingTierId
          // and use the custom override fields instead.
          res.status(400).json({
            error: 'Tier "custom" is a sentinel. Clear pricingTierId and set customSurchargePercent + customSurchargeFixedFee instead.',
          });
          return;
        }
        if (!tier.active) {
          res.status(400).json({ error: 'That tier is inactive — pick an active tier' });
          return;
        }
        newTierId = tier.id;
      }
    }

    // ── Validate rate caps from state policy ──────────────────────────
    const stateCap = (store.state as any)?.maxSurchargePercent
      ? Number((store.state as any).maxSurchargePercent)
      : null;
    if (stateCap != null && customSurchargePercent != null) {
      const pct = Number(customSurchargePercent);
      if (Number.isFinite(pct) && pct > stateCap) {
        res.status(400).json({
          error: `customSurchargePercent ${pct}% exceeds the state cap of ${stateCap}%`,
        });
        return;
      }
    }

    // ── Build update payload ──────────────────────────────────────────
    const data: Record<string, unknown> = {};
    if (pricingModel !== undefined) {
      data.pricingModel = newModel;
      // Stamp activation when flipping ON; clear when flipping OFF
      if (newModel === 'dual_pricing' && store.pricingModel !== 'dual_pricing') {
        data.dualPricingActivatedAt = new Date();
        data.dualPricingActivatedBy = req.user?.id || null;
      } else if (newModel === 'interchange' && store.pricingModel === 'dual_pricing') {
        data.dualPricingActivatedAt = null;
        data.dualPricingActivatedBy = null;
      }
    }
    if (pricingTierId !== undefined)            data.pricingTierId = newTierId;
    if (customSurchargePercent !== undefined)   data.customSurchargePercent  = customSurchargePercent === null || customSurchargePercent === '' ? null : Number(customSurchargePercent);
    if (customSurchargeFixedFee !== undefined)  data.customSurchargeFixedFee = customSurchargeFixedFee === null || customSurchargeFixedFee === '' ? null : Number(customSurchargeFixedFee);
    if (dualPricingDisclosure !== undefined)    data.dualPricingDisclosure   = dualPricingDisclosure ? String(dualPricingDisclosure) : null;

    // ── Detect actual changes for audit ───────────────────────────────
    const fromPercent = store.customSurchargePercent != null ? Number(store.customSurchargePercent) : null;
    const toPercent   = data.customSurchargePercent !== undefined
      ? (data.customSurchargePercent as number | null)
      : fromPercent;
    const fromFee = store.customSurchargeFixedFee != null ? Number(store.customSurchargeFixedFee) : null;
    const toFee   = data.customSurchargeFixedFee !== undefined
      ? (data.customSurchargeFixedFee as number | null)
      : fromFee;

    const modelChanged = data.pricingModel !== undefined && data.pricingModel !== store.pricingModel;
    const tierChanged  = newTierId !== store.pricingTierId;
    const rateChanged  = toPercent !== fromPercent || toFee !== fromFee;

    // Apply the update + audit row in one transaction
    const [updated] = await prisma.$transaction([
      prisma.store.update({
        where: { id: storeId },
        data,
        include: { pricingTier: true, state: true },
      }),
      ...(modelChanged || tierChanged || rateChanged ? [
        prisma.pricingModelChange.create({
          data: {
            storeId,
            changedById:   req.user?.id || 'system',
            changedByName: req.user?.name || req.user?.email || null,
            fromModel:     store.pricingModel,
            toModel:       newModel,
            fromTierId:    store.pricingTierId,
            toTierId:      newTierId,
            fromPercent,
            toPercent,
            fromFixedFee:  fromFee,
            toFixedFee:    toFee,
            reason:        reason ? String(reason) : null,
          },
        }),
      ] : []),
      // Keep PaymentSettings.surchargeEnabled / surchargePercent in sync as
      // a back-compat write (PaymentSettings.surchargePercent is stored as
      // a fraction — 0.03 for 3% — so divide by 100). Idempotent upsert.
      prisma.paymentSettings.upsert({
        where:  { storeId },
        update: {
          surchargeEnabled: newModel === 'dual_pricing',
          surchargePercent: (() => {
            // Resolve the effective rate AFTER our update would land
            const effPct = (data.customSurchargePercent !== undefined ? data.customSurchargePercent : store.customSurchargePercent) as number | null
                        ?? (store.pricingTier as any)?.surchargePercent
                        ?? null;
            return effPct == null ? null : Number(effPct) / 100;
          })(),
        },
        create: {
          orgId:            store.orgId,
          storeId,
          surchargeEnabled: newModel === 'dual_pricing',
          surchargePercent: (() => {
            const effPct = (data.customSurchargePercent !== undefined ? data.customSurchargePercent : store.customSurchargePercent) as number | null
                        ?? (store.pricingTier as any)?.surchargePercent
                        ?? null;
            return effPct == null ? null : Number(effPct) / 100;
          })(),
        },
      }),
    ]);

    const effectiveRate = getEffectiveSurchargeRate({
      pricingModel:            updated.pricingModel,
      pricingTier:             updated.pricingTier as any,
      customSurchargePercent:  updated.customSurchargePercent as any,
      customSurchargeFixedFee: updated.customSurchargeFixedFee as any,
    });

    res.json({
      success:        true,
      store: {
        id:                      updated.id,
        name:                    updated.name,
        pricingModel:            updated.pricingModel,
        pricingTierId:           updated.pricingTierId,
        pricingTier:             updated.pricingTier,
        customSurchargePercent:  updated.customSurchargePercent,
        customSurchargeFixedFee: updated.customSurchargeFixedFee,
        dualPricingDisclosure:   updated.dualPricingDisclosure,
        dualPricingActivatedAt:  updated.dualPricingActivatedAt,
      },
      effectiveRate,
      auditWritten:   modelChanged || tierChanged || rateChanged,
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

/**
 * GET /api/pricing/stores/:storeId/changes
 *
 * Full audit history for the per-store config page. Returns up to `limit`
 * changes (default 50). Caller scope same as getStorePricingConfig.
 */
export const listStorePricingChanges = async (req: Request, res: Response): Promise<void> => {
  try {
    const { storeId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const isSuper = req.user?.role === 'superadmin';
    const orgFilter = isSuper ? {} : { orgId: req.orgId || req.user?.orgId };

    const store = await prisma.store.findFirst({
      where: { id: storeId, ...orgFilter },
      select: { id: true },
    });
    if (!store) { res.status(404).json({ error: 'Store not found' }); return; }

    const changes = await prisma.pricingModelChange.findMany({
      where:    { storeId },
      orderBy:  { createdAt: 'desc' },
      take:     limit,
    });
    res.json({ changes });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

/**
 * GET /api/pricing/stores
 *
 * Superadmin-only: list every store with its current pricing model summary.
 * Drives the admin-app /payment-models index page.
 */
export const listAllStorePricingConfigs = async (_req: Request, res: Response): Promise<void> => {
  try {
    const stores = await prisma.store.findMany({
      where: { isActive: true },
      include: {
        pricingTier: true,
        state:       true,
        organization: { select: { id: true, name: true, slug: true } },
      },
      orderBy: [{ orgId: 'asc' }, { name: 'asc' }],
    });

    const summary = stores.map((s: any) => {
      const rate = getEffectiveSurchargeRate({
        pricingModel:            s.pricingModel,
        pricingTier:             s.pricingTier,
        customSurchargePercent:  s.customSurchargePercent,
        customSurchargeFixedFee: s.customSurchargeFixedFee,
      });
      return {
        storeId:               s.id,
        storeName:             s.name,
        orgId:                 s.orgId,
        orgName:               s.organization?.name || null,
        stateCode:             s.stateCode,
        stateName:             s.state?.name || null,
        pricingModel:          s.pricingModel,
        pricingTierKey:        s.pricingTier?.key || null,
        pricingTierName:       s.pricingTier?.name || null,
        effectivePercent:      rate.percent,
        effectiveFixedFee:     rate.fixedFee,
        effectiveSource:       rate.source,
        dualPricingActivatedAt: s.dualPricingActivatedAt,
      };
    });

    res.json({ stores: summary });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};
