/**
 * State Controller
 *
 * Superadmin-managed US-state catalog. Each State record carries the
 * defaults that a Store inherits the first time (or any time) its owner
 * picks a state in Store Settings: sales-tax rate, bottle-deposit rules,
 * lottery commission, alcohol / tobacco age limits.
 *
 * Two endpoint groups:
 *   /api/states/*            — superadmin CRUD for the catalog
 *   /api/states/public       — read-only list for the store dropdown
 *                              (any authenticated user, scoped to country=US)
 *   /api/stores/:id/apply-state-defaults  — mounted in storeRoutes
 */

import type { Request, Response } from 'express';
import prisma from '../config/postgres.js';
import { errMsg, errCode } from '../utils/typeHelpers.js';

// ── GET /api/states ─────────────────────────────────────────────────────
export const listStates = async (req: Request, res: Response): Promise<void> => {
  try {
    const { country = 'US', active } = req.query;
    const where: Record<string, unknown> = { country };
    if (active === 'true') where.active = true;

    const states = await prisma.state.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    res.json({ states });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── GET /api/states/:code ───────────────────────────────────────────────
export const getState = async (req: Request, res: Response): Promise<void> => {
  try {
    const state = await prisma.state.findUnique({ where: { code: req.params.code.toUpperCase() } });
    if (!state) {
      res.status(404).json({ error: 'State not found' });
      return;
    }
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── POST /api/states ────────────────────────────────────────────────────
export const createState = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      code, name, country, defaultTaxRate, defaultLotteryCommission,
      instantSalesCommRate, instantCashingCommRate, machineSalesCommRate, machineCashingCommRate,
      alcoholAgeLimit, tobaccoAgeLimit, bottleDepositRules, lotteryGameStubs,
      lotteryPackSizeRules,
      notes, active,
    } = req.body;

    if (!code || !/^[A-Z]{2}$/.test(String(code).toUpperCase())) {
      res.status(400).json({ error: 'code must be a 2-letter US state code' });
      return;
    }
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const state = await prisma.state.create({
      data: {
        code: String(code).toUpperCase(),
        name: String(name).trim(),
        country: country || 'US',
        defaultTaxRate:           defaultTaxRate != null ? Number(defaultTaxRate) : null,
        defaultLotteryCommission: defaultLotteryCommission != null ? Number(defaultLotteryCommission) : null,
        instantSalesCommRate:     instantSalesCommRate     != null ? Number(instantSalesCommRate)     : null,
        instantCashingCommRate:   instantCashingCommRate   != null ? Number(instantCashingCommRate)   : null,
        machineSalesCommRate:     machineSalesCommRate     != null ? Number(machineSalesCommRate)     : null,
        machineCashingCommRate:   machineCashingCommRate   != null ? Number(machineCashingCommRate)   : null,
        alcoholAgeLimit:          alcoholAgeLimit != null ? Number(alcoholAgeLimit) : 21,
        tobaccoAgeLimit:          tobaccoAgeLimit != null ? Number(tobaccoAgeLimit) : 21,
        bottleDepositRules:       Array.isArray(bottleDepositRules) ? bottleDepositRules : [],
        lotteryGameStubs:         Array.isArray(lotteryGameStubs) ? lotteryGameStubs : [],
        // Pack-size rules must be an array of { maxPrice, packSize } objects.
        // Empty array = use backend default (DEFAULT_PACK_SIZE_RULES).
        lotteryPackSizeRules:     Array.isArray(lotteryPackSizeRules)
          ? (lotteryPackSizeRules as Array<{ maxPrice?: number | string; packSize?: number | string }>)
              .filter((r) => Number.isFinite(Number(r?.maxPrice)) && Number.isFinite(Number(r?.packSize)))
              .map((r) => ({ maxPrice: Number(r.maxPrice), packSize: Number(r.packSize) }))
          : [],
        notes:                    notes ? String(notes) : null,
        active:                   active !== false,
      },
    });
    res.status(201).json(state);
  } catch (err) {
    if (errCode(err) === 'P2002') {
      res.status(409).json({ error: 'State with this code already exists' });
      return;
    }
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── PUT /api/states/:code ───────────────────────────────────────────────
export const updateState = async (req: Request, res: Response): Promise<void> => {
  try {
    const code = req.params.code.toUpperCase();
    const existing = await prisma.state.findUnique({ where: { code } });
    if (!existing) {
      res.status(404).json({ error: 'State not found' });
      return;
    }

    const {
      name, country, defaultTaxRate, defaultLotteryCommission,
      instantSalesCommRate, instantCashingCommRate, machineSalesCommRate, machineCashingCommRate,
      alcoholAgeLimit, tobaccoAgeLimit, bottleDepositRules, lotteryGameStubs,
      lotteryPackSizeRules,
      notes, active,
    } = req.body;

    const state = await prisma.state.update({
      where: { code },
      data: {
        ...(name != null && { name: String(name).trim() }),
        ...(country != null && { country: String(country) }),
        ...(defaultTaxRate !== undefined && { defaultTaxRate: defaultTaxRate != null ? Number(defaultTaxRate) : null }),
        ...(defaultLotteryCommission !== undefined && { defaultLotteryCommission: defaultLotteryCommission != null ? Number(defaultLotteryCommission) : null }),
        ...(instantSalesCommRate   !== undefined && { instantSalesCommRate:   instantSalesCommRate   != null ? Number(instantSalesCommRate)   : null }),
        ...(instantCashingCommRate !== undefined && { instantCashingCommRate: instantCashingCommRate != null ? Number(instantCashingCommRate) : null }),
        ...(machineSalesCommRate   !== undefined && { machineSalesCommRate:   machineSalesCommRate   != null ? Number(machineSalesCommRate)   : null }),
        ...(machineCashingCommRate !== undefined && { machineCashingCommRate: machineCashingCommRate != null ? Number(machineCashingCommRate) : null }),
        ...(alcoholAgeLimit !== undefined && { alcoholAgeLimit: Number(alcoholAgeLimit) }),
        ...(tobaccoAgeLimit !== undefined && { tobaccoAgeLimit: Number(tobaccoAgeLimit) }),
        ...(bottleDepositRules !== undefined && { bottleDepositRules: Array.isArray(bottleDepositRules) ? bottleDepositRules : [] }),
        ...(lotteryGameStubs !== undefined && { lotteryGameStubs: Array.isArray(lotteryGameStubs) ? lotteryGameStubs : [] }),
        ...(lotteryPackSizeRules !== undefined && {
          lotteryPackSizeRules: Array.isArray(lotteryPackSizeRules)
            ? (lotteryPackSizeRules as Array<{ maxPrice?: number | string; packSize?: number | string }>)
                .filter((r) => Number.isFinite(Number(r?.maxPrice)) && Number.isFinite(Number(r?.packSize)))
                .map((r) => ({ maxPrice: Number(r.maxPrice), packSize: Number(r.packSize) }))
            : [],
        }),
        ...(notes !== undefined && { notes: notes ? String(notes) : null }),
        ...(active !== undefined && { active: Boolean(active) }),
      },
    });
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── DELETE /api/states/:code ────────────────────────────────────────────
export const deleteState = async (req: Request, res: Response): Promise<void> => {
  try {
    const code = req.params.code.toUpperCase();
    // Blocked when any store references the state — soft-deactivate instead
    const inUse = await prisma.store.count({ where: { stateCode: code } });
    if (inUse > 0) {
      res.status(409).json({
        error: `${inUse} store(s) reference this state. Deactivate the state instead of deleting.`,
      });
      return;
    }
    await prisma.state.delete({ where: { code } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── POST /api/stores/:id/apply-state-defaults ──────────────────────────
// Mounted in storeRoutes. Pushes the store's current state's defaults
// into TaxRule / DepositRule / LotterySettings / POS-config ageLimits.
// Called automatically when a store's stateCode changes AND on demand via
// the "Apply State Defaults" button in Store Settings.
//
// Strategy (idempotent):
//   - TaxRule: upsert a "Default Sales Tax" rule matching defaultTaxRate
//   - DepositRule: wipe current rules for this store + bulk-create from
//     state.bottleDepositRules (only when non-empty; skips otherwise)
//   - LotterySettings: upsert state code + commissionRate
//   - Store.pos.ageLimits: patch merged ageLimits into POS config JSON
export const applyStateDefaults = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = req.params.id;
    const orgId = req.orgId || req.user?.orgId;

    const store = await prisma.store.findFirst({
      where: { id: storeId, orgId },
      include: { state: true },
    });
    if (!store) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }
    if (!store.stateCode || !store.state) {
      res.status(400).json({ error: 'Store has no state selected — set stateCode first' });
      return;
    }

    const s = store.state;
    const applied: Record<string, unknown> = {};

    // 1. Tax rule — upsert "Default Sales Tax" scoped to this store
    //    TaxRule stores `rate` as a decimal (0.0625 = 6.25%).
    if (s.defaultTaxRate != null) {
      const rate = Number(s.defaultTaxRate);
      const existingTax = await prisma.taxRule.findFirst({
        where: { orgId, storeId, name: 'Default Sales Tax' },
      });
      if (existingTax) {
        await prisma.taxRule.update({
          where: { id: existingTax.id },
          data:  { rate, active: true, state: s.code },
        });
      } else {
        await prisma.taxRule.create({
          data: {
            orgId, storeId,
            name:       'Default Sales Tax',
            rate,
            appliesTo:  'all',
            ebtExempt:  true,
            state:      s.code,
            active:     true,
          },
        });
      }
      applied.taxRate = rate;
    }

    // 2. Bottle-deposit rules — DepositRule is org-scoped (not store-scoped)
    //    but carries a `state` column. Replace all rules for this org+state
    //    rather than this org+store, so every store in the same state
    //    shares the same catalog of container/volume tiers.
    interface DepositRuleInput {
      name?: string;
      containerType?: string;
      containerTypes?: string;
      minVolumeOz?: number | string | null;
      maxVolumeOz?: number | string | null;
      depositAmount?: number | string;
    }
    const rules = (Array.isArray(s.bottleDepositRules) ? s.bottleDepositRules : []) as DepositRuleInput[];
    if (rules.length > 0) {
      await prisma.depositRule.deleteMany({ where: { orgId, state: s.code } });
      await prisma.depositRule.createMany({
        data: rules.map((r) => ({
          orgId,
          name:           r.name || `${s.name} – ${r.containerType || 'bottle'} ${r.minVolumeOz || 0}-${r.maxVolumeOz || '∞'}oz`,
          minVolumeOz:    r.minVolumeOz != null ? Number(r.minVolumeOz) : null,
          maxVolumeOz:    r.maxVolumeOz != null ? Number(r.maxVolumeOz) : null,
          containerTypes: r.containerType
            ? String(r.containerType)
            : (r.containerTypes || 'bottle,can'),
          depositAmount:  Number(r.depositAmount) || 0,
          state:          s.code,
          active:         true,
        })),
        skipDuplicates: true,
      });
      applied.depositRules = rules.length;
    }

    // 3. Lottery settings — upsert state + commission
    const existingLot = await prisma.lotterySettings.findFirst({ where: { orgId, storeId } });
    const lotData = {
      state: s.code,
      commissionRate: s.defaultLotteryCommission != null ? Number(s.defaultLotteryCommission) : 0.05,
    };
    if (existingLot) {
      await prisma.lotterySettings.update({ where: { id: existingLot.id }, data: lotData });
    } else {
      await prisma.lotterySettings.create({
        data: { orgId, storeId, ...lotData, enabled: false },
      });
    }
    applied.lotteryState = s.code;

    // 4. POS config ageLimits — merge into store.pos JSON
    const pos = (store.pos && typeof store.pos === 'object' ? store.pos : {}) as Record<string, unknown>;
    const newPos = {
      ...pos,
      ageLimits: {
        ...((pos.ageLimits as Record<string, unknown>) || {}),
        tobacco: s.tobaccoAgeLimit,
        alcohol: s.alcoholAgeLimit,
      },
    };
    await prisma.store.update({ where: { id: storeId }, data: { pos: newPos } });
    applied.ageLimits = { tobacco: s.tobaccoAgeLimit, alcohol: s.alcoholAgeLimit };

    res.json({ success: true, stateCode: s.code, applied });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};

// ── PUT /api/stores/:id/state ───────────────────────────────────────────
// Sets a store's stateCode. Does NOT auto-apply defaults — caller invokes
// applyStateDefaults separately (so the UI can confirm before overwriting
// tax/deposit rules that may have been customised).
export const setStoreState = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = req.params.id;
    const orgId = req.orgId || req.user?.orgId;
    const { stateCode } = req.body;

    const store = await prisma.store.findFirst({ where: { id: storeId, orgId } });
    if (!store) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    const code = stateCode ? String(stateCode).toUpperCase() : null;
    if (code) {
      const state = await prisma.state.findUnique({ where: { code } });
      if (!state) {
        res.status(404).json({ error: 'State not found' });
        return;
      }
    }

    const updated = await prisma.store.update({
      where: { id: storeId },
      data:  { stateCode: code },
      include: { state: true },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
};
