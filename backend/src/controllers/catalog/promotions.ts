/**
 * Catalog — Promotions (CRUD + cart-time evaluation).
 * Split from `catalogController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers (5):
 *   - getPromotions      GET    /catalog/promotions
 *   - createPromotion    POST   /catalog/promotions
 *   - updatePromotion    PUT    /catalog/promotions/:id
 *                         (S69 atomic update — date validation up-front,
 *                          single Prisma write, no partial-mutation on validation
 *                          failure)
 *   - deletePromotion    DELETE /catalog/promotions/:id
 *   - evaluatePromotions POST   /catalog/promotions/evaluate
 *                         (cart payload → adjustment list; lowest-effective-price
 *                          wins per line. Mirrors cashier-app's promoEngine.js)
 *
 * Scope model (3-way OR — F5):
 *   - productIds[]       — explicit product list
 *   - departmentIds[]    — department-scoped
 *   - productGroupIds[]  — group-scoped (S56b)
 * A promo qualifies when ANY of the three sets matches the cart line. No
 * org-wide wildcards: a promo with all three empty arrays matches nothing.
 *
 * Deal config (`dealConfig` JSON):
 *   - sale:       { discountType: 'percent' | 'amount' | 'fixed', discountValue }
 *   - bogo:       { buyQty, getQty, getDiscountPercent }
 *   - volume:     { tiers: [{ minQty, discountType, discountValue }] }
 *   - mix_match:  { totalQty, totalPrice }
 *   - combo:      { items: [{ qty, productIds }], comboPrice }
 *   - minPurchaseAmount?: number  (S69/C11c — gates dept/group-scoped promos
 *     by the qualifying-line subtotal; product-only scopes ignore it.)
 *
 * Mix-match guard (S69/C11b): when promoType=mix_match, every selected
 * ProductGroup must have `allowMixMatch=true` or create/update returns 400
 * with `blockingGroups` array so the UI can pick a different scope or type.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { errMsg, errCode } from '../../utils/typeHelpers.js';
import { logAudit } from '../../services/auditService.js';
import { tryParseDate } from '../../utils/safeDate.js';
import {
  getOrgId,
  type PromotionRow,
  type PromoLineItem,
  type PromoAdjustment,
} from './helpers.js';

// ── S69 (C11c) — Promotion dealConfig validator ───────────────────────────
// `minPurchaseAmount` triggers a promo only when the qualifying-line subtotal
// meets the threshold. Allowed only when the promo has at least one
// dept/group scope; pure product-level promos already trigger per-line.
function validateDealConfig(
  raw: unknown,
  scope: { productIds: number[]; departmentIds: number[]; productGroupIds: number[] },
): { error?: string; value?: Record<string, unknown> } {
  if (raw == null) return { value: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'dealConfig must be an object.' };
  }
  const cfg = { ...(raw as Record<string, unknown>) };

  const minRaw = cfg.minPurchaseAmount;
  if (minRaw != null && minRaw !== '') {
    const n = Number(minRaw);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
      return { error: 'minPurchaseAmount must be a positive number under $1,000,000.' };
    }
    const hasDeptOrGroup =
      scope.departmentIds.length > 0 || scope.productGroupIds.length > 0;
    if (!hasDeptOrGroup) {
      return {
        error:
          'minPurchaseAmount is only available for promotions targeting a Department or Product Group. Pure product-level promos trigger per-line and do not need a minimum.',
      };
    }
    cfg.minPurchaseAmount = Math.round(n * 100) / 100;
  } else {
    delete cfg.minPurchaseAmount;
  }

  return { value: cfg };
}

export const getPromotions = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { active, promoType } = req.query;
    const where = {
      orgId,
      ...(active === 'true' && { active: true }),
      ...(active === 'false' && { active: false }),
      ...(promoType && { promoType: promoType as string }),
    };
    const promos = await prisma.promotion.findMany({
      where,
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({ success: true, data: promos });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const createPromotion = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const {
      name,
      promoType,
      description,
      productIds,
      departmentIds,
      productGroupIds,
      dealConfig,
      badgeLabel,
      badgeColor,
      startDate,
      endDate,
      active,
    } = req.body;

    if (!name || !promoType) {
      res.status(400).json({ error: 'name and promoType are required.' });
      return;
    }

    const sd = tryParseDate(res, startDate, 'startDate');
    if (!sd.ok) return;
    const ed = tryParseDate(res, endDate, 'endDate');
    if (!ed.ok) return;

    // S69 (C11b) — block mix_match promos that target groups with allowMixMatch=false
    const groupIdsArr: number[] = Array.isArray(productGroupIds) ? productGroupIds.map(Number) : [];
    if (promoType === 'mix_match' && groupIdsArr.length > 0) {
      const blockingGroups = await prisma.productGroup.findMany({
        where: { orgId, id: { in: groupIdsArr }, allowMixMatch: false },
        select: { id: true, name: true },
      });
      if (blockingGroups.length > 0) {
        res.status(400).json({
          success: false,
          error: `Mix-and-match is disabled for ${blockingGroups.length} of the selected group(s): ${blockingGroups.map((g: { name: string }) => `"${g.name}"`).join(', ')}. Either pick a different scope, choose a different promo type, or enable mix-and-match on the group.`,
          blockingGroups,
        });
        return;
      }
    }

    // S69 (C11c) — minPurchaseAmount only valid when scope is group OR dept
    // (not strictly product-only). Validate dealConfig before persisting.
    const validatedDealConfig = validateDealConfig(dealConfig, {
      productIds: Array.isArray(productIds) ? productIds.map(Number) : [],
      departmentIds: Array.isArray(departmentIds) ? departmentIds.map(Number) : [],
      productGroupIds: groupIdsArr,
    });
    if (validatedDealConfig.error) {
      res.status(400).json({ success: false, error: validatedDealConfig.error });
      return;
    }

    const promo = await prisma.promotion.create({
      data: {
        orgId,
        name,
        promoType,
        description: description ?? null,
        productIds:      Array.isArray(productIds)      ? productIds.map(Number)      : [],
        departmentIds:   Array.isArray(departmentIds)   ? departmentIds.map(Number)   : [],
        productGroupIds: groupIdsArr,
        dealConfig: validatedDealConfig.value ?? {},
        badgeLabel: badgeLabel ?? null,
        badgeColor: badgeColor ?? null,
        startDate: sd.value,
        endDate: ed.value,
        active: active ?? true,
      },
    });

    res.status(201).json({ success: true, data: promo });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updatePromotion = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const existing = await prisma.promotion.findFirst({ where: { id, orgId } });
    if (!existing) {
      res.status(404).json({ error: 'Promotion not found.' });
      return;
    }

    const {
      name,
      promoType,
      description,
      productIds,
      departmentIds,
      productGroupIds,
      dealConfig,
      badgeLabel,
      badgeColor,
      startDate,
      endDate,
      active,
    } = req.body;

    // S69 (C11b) — block mix_match promos that target groups with allowMixMatch=false.
    // Use the merged values (req body OR existing) so a partial update is still validated.
    const mergedPromoType = promoType ?? existing.promoType;
    const mergedGroupIds: number[] = productGroupIds != null
      ? productGroupIds.map(Number)
      : existing.productGroupIds;
    if (mergedPromoType === 'mix_match' && mergedGroupIds.length > 0) {
      const blockingGroups = await prisma.productGroup.findMany({
        where: { orgId: orgId as string, id: { in: mergedGroupIds }, allowMixMatch: false },
        select: { id: true, name: true },
      });
      if (blockingGroups.length > 0) {
        res.status(400).json({
          success: false,
          error: `Mix-and-match is disabled for ${blockingGroups.length} of the selected group(s): ${blockingGroups.map((g: { name: string }) => `"${g.name}"`).join(', ')}. Either pick a different scope, choose a different promo type, or enable mix-and-match on the group.`,
          blockingGroups,
        });
        return;
      }
    }

    // S69 (C11c) — validate dealConfig (incl. minPurchaseAmount) when it changes
    let normalizedDealConfig: unknown = undefined;
    if (dealConfig !== undefined) {
      const validated = validateDealConfig(dealConfig, {
        productIds: productIds != null ? productIds.map(Number) : existing.productIds,
        departmentIds: departmentIds != null ? departmentIds.map(Number) : existing.departmentIds,
        productGroupIds: mergedGroupIds,
      });
      if (validated.error) {
        res.status(400).json({ success: false, error: validated.error });
        return;
      }
      normalizedDealConfig = validated.value;
    }

    // Validate dates BEFORE writing anything. Previous version updated the
    // main fields first and validated dates after — a malformed date would
    // 400 the response while leaving the record half-mutated. Single update
    // below is now atomic.
    const data: Prisma.PromotionUpdateInput = {
      ...(name != null && { name }),
      ...(promoType != null && { promoType }),
      ...(description != null && { description }),
      ...(productIds != null && { productIds: productIds.map(Number) }),
      ...(departmentIds != null && { departmentIds: departmentIds.map(Number) }),
      ...(productGroupIds != null && { productGroupIds: mergedGroupIds }),
      ...(normalizedDealConfig !== undefined && { dealConfig: normalizedDealConfig as Prisma.InputJsonValue }),
      ...(badgeLabel != null && { badgeLabel }),
      ...(badgeColor != null && { badgeColor }),
      ...(active != null && { active }),
    };

    if (startDate !== undefined) {
      const r = tryParseDate(res, startDate, 'startDate');
      if (!r.ok) return;
      data.startDate = r.value;
    }
    if (endDate !== undefined) {
      const r = tryParseDate(res, endDate, 'endDate');
      if (!r.ok) return;
      data.endDate = r.value;
    }

    const updated = await prisma.promotion.update({ where: { id }, data });

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const deletePromotion = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const existing = await prisma.promotion.findFirst({ where: { id, orgId } });
    if (!existing) {
      res.status(404).json({ error: 'Promotion not found.' });
      return;
    }

    await prisma.promotion.delete({ where: { id } });
    res.json({ success: true, message: 'Promotion deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const evaluatePromotions = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { items } = req.body as { items?: PromoLineItem[] };

    if (!Array.isArray(items) || !items.length) {
      res.json({
        success: true,
        data: { lineAdjustments: {}, totalSaving: 0, appliedPromos: [] },
      });
      return;
    }

    const now = new Date();
    const promosRaw = await prisma.promotion.findMany({
      where: {
        orgId,
        active: true,
        OR: [{ startDate: null }, { startDate: { lte: now } }],
        AND: [
          {
            OR: [{ endDate: null }, { endDate: { gte: now } }],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    const promos = promosRaw as PromotionRow[];

    const lineAdjustments: Record<string, PromoAdjustment> = {};
    interface AppliedPromo {
      id: number;
      name: string;
      promoType: string;
      badgeLabel?: string | null;
      badgeColor?: string | null;
    }
    const appliedPromos: AppliedPromo[] = [];

    const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

    const getQualifying = (promo: PromotionRow): PromoLineItem[] =>
      items.filter((item) => {
        if (item.discountEligible === false) return false;
        const hasProd = (promo.productIds?.length ?? 0) > 0;
        const hasDept = (promo.departmentIds?.length ?? 0) > 0;
        if (!hasProd && !hasDept) return true;
        if (hasProd && item.productId != null && promo.productIds.includes(item.productId)) return true;
        if (hasDept && item.departmentId != null && promo.departmentIds.includes(item.departmentId))
          return true;
        return false;
      });

    const makeAdj = (
      promo: PromotionRow,
      dt: string,
      dv: number,
    ): PromoAdjustment => ({
      discountType: dt,
      discountValue: round2(dv),
      promoId: promo.id,
      promoName: promo.name,
      badgeLabel: promo.badgeLabel || promo.name,
      badgeColor: promo.badgeColor || '#f59e0b',
    });

    for (const promo of promos) {
      const cfg = (promo.dealConfig || {}) as Record<string, unknown>;
      const qualifying = getQualifying(promo);
      if (!qualifying.length) continue;

      const result: Record<string, PromoAdjustment> = {};

      if (promo.promoType === 'sale') {
        for (const item of qualifying) {
          if (item.qty < ((cfg.minQty as number) || 1)) continue;
          result[item.lineId] = makeAdj(
            promo,
            (cfg.discountType as string) || 'percent',
            parseFloat(String(cfg.discountValue)) || 0,
          );
        }
      } else if (promo.promoType === 'bogo') {
        const buyQty = (cfg.buyQty as number) || 1;
        const getQty = (cfg.getQty as number) || 1;
        const getDiscount = cfg.getDiscount != null ? (cfg.getDiscount as number) : 100;
        const setSize = buyQty + getQty;
        const units: Array<{ lineId: string; price: number }> = [];
        for (const item of qualifying) {
          for (let i = 0; i < item.qty; i++)
            units.push({ lineId: item.lineId, price: parseFloat(String(item.unitPrice)) });
        }
        units.sort((a, b) => b.price - a.price);
        let numSets = Math.floor(units.length / setSize);
        if (cfg.maxSets) numSets = Math.min(numSets, cfg.maxSets as number);
        const lineDisc: Record<string, number> = {};
        for (let s = 0; s < numSets; s++) {
          const free = units.slice(s * setSize + buyQty, (s + 1) * setSize);
          for (const u of free)
            lineDisc[u.lineId] = (lineDisc[u.lineId] || 0) + (u.price * getDiscount) / 100;
        }
        for (const item of qualifying) {
          if (!lineDisc[item.lineId]) continue;
          result[item.lineId] = makeAdj(promo, 'amount', round2(lineDisc[item.lineId] / item.qty));
        }
      } else if (promo.promoType === 'volume') {
        const totalQty = qualifying.reduce((s, i) => s + i.qty, 0);
        interface VolumeTier {
          minQty: number;
          discountType?: string;
          discountValue?: number | string;
        }
        const tiers = (((cfg.tiers as VolumeTier[]) || []).slice() as VolumeTier[]).sort(
          (a, b) => b.minQty - a.minQty,
        );
        const tier = tiers.find((t) => totalQty >= t.minQty);
        if (tier) {
          for (const item of qualifying) {
            result[item.lineId] = makeAdj(
              promo,
              tier.discountType || 'percent',
              parseFloat(String(tier.discountValue)) || 0,
            );
          }
        }
      } else if (promo.promoType === 'mix_match') {
        const groupSize = (cfg.groupSize as number) || 2;
        const bundlePrice = parseFloat(String(cfg.bundlePrice)) || 0;
        const units: Array<{ lineId: string; price: number }> = [];
        for (const item of qualifying) {
          for (let i = 0; i < item.qty; i++)
            units.push({ lineId: item.lineId, price: parseFloat(String(item.unitPrice)) });
        }
        units.sort((a, b) => a.price - b.price);
        const numGroups = Math.floor(units.length / groupSize);
        if (numGroups > 0) {
          const groupUnits = units.slice(0, numGroups * groupSize);
          const regTotal = groupUnits.reduce((s, u) => s + u.price, 0);
          const totalDisc = Math.max(0, regTotal - numGroups * bundlePrice);
          if (totalDisc > 0) {
            const lineDiscTotal: Record<string, number> = {};
            for (const u of groupUnits)
              lineDiscTotal[u.lineId] =
                (lineDiscTotal[u.lineId] || 0) + (u.price / regTotal) * totalDisc;
            for (const item of qualifying) {
              if (!lineDiscTotal[item.lineId]) continue;
              result[item.lineId] = makeAdj(
                promo,
                'amount',
                round2(lineDiscTotal[item.lineId] / item.qty),
              );
            }
          }
        }
      } else if (promo.promoType === 'combo') {
        interface ComboGroup {
          productIds?: number[];
          minQty?: number;
        }
        const requiredGroups = (cfg.requiredGroups as ComboGroup[]) || [];
        let allSatisfied = true;
        for (const group of requiredGroups) {
          const ids = group.productIds || [];
          const minQty = group.minQty || 1;
          const qty = items
            .filter((i) => i.productId != null && ids.includes(i.productId))
            .reduce((s, i) => s + i.qty, 0);
          if (qty < minQty) {
            allSatisfied = false;
            break;
          }
        }
        if (allSatisfied) {
          const comboIds = requiredGroups.flatMap((g) => g.productIds || []);
          for (const item of items) {
            if (item.productId == null || !comboIds.includes(item.productId)) continue;
            result[item.lineId] = makeAdj(
              promo,
              (cfg.discountType as string) || 'percent',
              parseFloat(String(cfg.discountValue)) || 0,
            );
          }
        }
      }

      if (Object.keys(result).length) {
        for (const [lineId, adj] of Object.entries(result)) {
          const existing = lineAdjustments[lineId];
          const item = items.find((i) => i.lineId === lineId);
          if (!item) continue;
          const newSav =
            adj.discountType === 'percent'
              ? (item.unitPrice * adj.discountValue) / 100
              : adj.discountValue;
          const exSav = existing
            ? existing.discountType === 'percent'
              ? (item.unitPrice * existing.discountValue) / 100
              : existing.discountValue
            : -1;
          if (newSav > exSav) lineAdjustments[lineId] = adj;
        }
        appliedPromos.push({
          id: promo.id,
          name: promo.name,
          promoType: promo.promoType,
          badgeLabel: promo.badgeLabel,
          badgeColor: promo.badgeColor,
        });
      }
    }

    let totalSaving = 0;
    for (const [lineId, adj] of Object.entries(lineAdjustments)) {
      const item = items.find((i) => i.lineId === lineId);
      if (!item) continue;
      if (adj.discountType === 'percent')
        totalSaving += (item.unitPrice * item.qty * adj.discountValue) / 100;
      else if (adj.discountType === 'amount')
        totalSaving += Math.min(adj.discountValue * item.qty, item.unitPrice * item.qty);
      else if (adj.discountType === 'fixed')
        totalSaving += Math.max(0, item.unitPrice * item.qty - adj.discountValue * item.qty);
    }

    res.json({
      success: true,
      data: { lineAdjustments, totalSaving: round2(totalSaving), appliedPromos },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

