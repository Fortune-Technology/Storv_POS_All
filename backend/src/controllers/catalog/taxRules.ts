/**
 * Catalog — Tax Rules + Deposit Rules + Tax-unmapped diagnostic.
 * Split from `catalogController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers (8):
 *   Tax Rules (4):
 *     - getTaxRules     GET    /catalog/tax-rules
 *     - createTaxRule   POST   /catalog/tax-rules
 *     - updateTaxRule   PUT    /catalog/tax-rules/:id
 *     - deleteTaxRule   DELETE /catalog/tax-rules/:id
 *
 *   Deposit Rules (3):
 *     - getDepositRules    GET  /catalog/deposit-rules
 *     - createDepositRule  POST /catalog/deposit-rules
 *     - updateDepositRule  PUT  /catalog/deposit-rules/:id
 *
 *   Diagnostic (1):
 *     - getTaxUnmappedProducts GET /catalog/products/tax-unmapped
 *       — products that won't resolve a tax rule via the cashier-app's
 *       2-tier lookup (per-product `taxRuleId` → dept membership). Returns
 *       three statuses: STALE_FK (taxRuleId points to a deleted rule),
 *       UNMAPPED (no rule + no dept-tax), AMBIGUOUS (multiple rules cover
 *       the dept).
 *
 * Tax model (S56b): `appliesTo` (legacy class matcher) was removed. Tax rules
 * now match products via `Product.taxRuleId` (FK, highest priority) → fall
 * back to dept membership via `TaxRule.departmentIds[]`. No org-wide wildcards.
 */

import type { Request, Response } from 'express';
import prisma from '../../config/postgres.js';
import { errMsg, errCode } from '../../utils/typeHelpers.js';
import { logAudit } from '../../services/auditService.js';
import { getOrgId, paginationParams, type TaxRuleRow } from './helpers.js';

// ═══════════════════════════════════════════════════════
// TAX RULES
// ═══════════════════════════════════════════════════════

export const getTaxRules = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = (req.query.storeId as string) || null;

    const rules = await prisma.taxRule.findMany({
      where: {
        orgId,
        active: true,
        ...(storeId ? { OR: [{ storeId }, { storeId: null }] } : { storeId: null }),
      },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: rules });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// Normalize departmentIds input — accept number[], string[] (IDs as strings),
// or a single value. Returns a clean number[] with invalid entries dropped.
function normalizeDeptIds(raw: unknown): number[] {
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((v) => (typeof v === 'number' ? v : parseInt(String(v), 10)))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export const createTaxRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const {
      name,
      rate,
      ebtExempt,
      state,
      storeId,
      departmentIds,
    } = req.body;
    // Session 56b — legacy `appliesTo` class matcher removed. Rules now MUST
    // specify which departments they apply to. To create a "tax everything"
    // catch-all, link the rule to every active department in the org.
    // (Session 56 also removed `description` and `county` cosmetic columns.)

    const deptIds = normalizeDeptIds(departmentIds);
    if (!name || rate == null || deptIds.length === 0) {
      res.status(400).json({
        success: false,
        error: 'name, rate, and at least one department are required',
      });
      return;
    }

    const rule = await prisma.taxRule.create({
      data: {
        orgId,
        storeId: storeId || null,
        name,
        rate,
        departmentIds: deptIds,
        ebtExempt: ebtExempt !== false,
        state: state || null,
      },
    });

    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updateTaxRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const body = req.body || {};
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.rate !== undefined) data.rate = body.rate;
    if (body.ebtExempt !== undefined) data.ebtExempt = Boolean(body.ebtExempt);
    if (body.state !== undefined) data.state = body.state || null;
    if (body.storeId !== undefined) data.storeId = body.storeId || null;
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.departmentIds !== undefined)
      data.departmentIds = normalizeDeptIds(body.departmentIds);
    // Session 56b — `appliesTo` body key silently ignored (legacy clients).
    // Session 56  — `description` / `county` body keys silently ignored too.

    const rule = await prisma.taxRule.update({
      where: { id, orgId },
      data,
    });

    res.json({ success: true, data: rule });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Tax rule not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const deleteTaxRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const force = req.query.force === 'true';

    const usageCount = await prisma.masterProduct.count({
      where: { orgId, taxRuleId: id, deleted: false },
    });
    if (usageCount > 0 && !force) {
      res.status(409).json({
        success: false,
        code: 'IN_USE',
        error:
          `Cannot delete: ${usageCount} product(s) have this as their explicit tax rule. ` +
          `Reassign them first, or retry with ?force=true to detach them (they'll fall back to the legacy taxClass matcher).`,
        usageCount,
      });
      return;
    }
    if (force && usageCount > 0) {
      await prisma.masterProduct.updateMany({
        where: { orgId, taxRuleId: id },
        data: { taxRuleId: null },
      });
    }

    await prisma.taxRule.update({ where: { id, orgId }, data: { active: false } });
    res.json({
      success: true,
      message:
        force && usageCount > 0
          ? `Tax rule deactivated; ${usageCount} product(s) detached`
          : 'Tax rule deactivated',
      detachedCount: force ? usageCount : 0,
    });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Tax rule not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ═══════════════════════════════════════════════════════
// DEPOSIT RULES
// ═══════════════════════════════════════════════════════

export const getDepositRules = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const rules = await prisma.depositRule.findMany({
      where: { orgId, active: true },
      orderBy: { minVolumeOz: 'asc' },
    });
    res.json({ success: true, data: rules });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const createDepositRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const { name, description, minVolumeOz, maxVolumeOz, containerTypes, depositAmount, state } =
      req.body;

    if (!name || depositAmount == null) {
      res.status(400).json({ success: false, error: 'name and depositAmount are required' });
      return;
    }

    const rule = await prisma.depositRule.create({
      data: {
        orgId,
        name,
        description: description || null,
        minVolumeOz: minVolumeOz != null ? parseFloat(minVolumeOz) : null,
        maxVolumeOz: maxVolumeOz != null ? parseFloat(maxVolumeOz) : null,
        containerTypes: containerTypes || 'bottle,can',
        depositAmount,
        state: state || null,
      },
    });

    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updateDepositRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const rule = await prisma.depositRule.update({ where: { id, orgId }, data: req.body });
    res.json({ success: true, data: rule });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Deposit rule not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};


// ═══════════════════════════════════════════════════════
// TAX-UNMAPPED PRODUCTS DIAGNOSTIC
// ═══════════════════════════════════════════════════════
interface UnmappedRow {
  id: number;
  name: string;
  upc: string | null | undefined;
  departmentId: number | null | undefined;
  taxClass: string | null | undefined;
  taxRuleId: number | null;
  status: 'STALE_FK' | 'UNMAPPED' | 'AMBIGUOUS';
  suggestions: Array<{ id: number; name: string; rate: number }>;
  reason: string;
}

export const getTaxUnmappedProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { skip, take } = paginationParams(req.query as Record<string, unknown>);

    // Session 56b — Diagnostic rewritten to mirror the cashier-app's 2-tier
    // resolution. A product is "OK" if EITHER:
    //   (1) it has an explicit `taxRuleId` pointing at an active rule, OR
    //   (2) its `departmentId` is in some active rule's `departmentIds[]`.
    // Anything else → UNMAPPED (no rule will fire at checkout = 0% tax).
    // STALE_FK still flags products whose taxRuleId points at an inactive
    // / deleted rule (admin should re-link).
    const rules = (await prisma.taxRule.findMany({
      where: { orgId, active: true },
      select: { id: true, name: true, rate: true, departmentIds: true },
    })) as TaxRuleRow[];
    const ruleIds = new Set(rules.map((r) => r.id));
    // Index: deptId → rules that include that dept (multiple rules CAN target
    // the same dept — that's reported as AMBIGUOUS so the admin can pick).
    const rulesByDept = new Map<number, TaxRuleRow[]>();
    for (const r of rules) {
      for (const did of r.departmentIds || []) {
        if (!rulesByDept.has(did)) rulesByDept.set(did, []);
        rulesByDept.get(did)!.push(r);
      }
    }

    type TaxProductRow = {
      id: number;
      name: string;
      upc: string | null;
      taxClass: string | null;
      taxRuleId: number | null;
      departmentId: number | null;
    };
    const products = (await prisma.masterProduct.findMany({
      where: { orgId, deleted: false },
      select: {
        id: true,
        name: true,
        upc: true,
        taxClass: true,
        taxRuleId: true,
        departmentId: true,
      },
    })) as TaxProductRow[];

    const unmapped: UnmappedRow[] = [];
    const countsByStatus = { STALE_FK: 0, UNMAPPED: 0, AMBIGUOUS: 0, OK: 0 };

    for (const p of products) {
      // Tier 1: explicit taxRuleId override. Must be active.
      if (p.taxRuleId && !ruleIds.has(p.taxRuleId)) {
        unmapped.push({
          id: p.id,
          name: p.name,
          upc: p.upc,
          departmentId: p.departmentId,
          taxClass: p.taxClass,
          taxRuleId: p.taxRuleId,
          status: 'STALE_FK',
          suggestions: [],
          reason: 'taxRuleId points at a rule that is inactive or no longer exists',
        });
        countsByStatus.STALE_FK++;
        continue;
      }
      if (p.taxRuleId) {
        countsByStatus.OK++;
        continue;
      }

      // Tier 2: department-linked. If product's dept appears in any rule's
      // departmentIds[], the cart will resolve a rule at checkout.
      if (p.departmentId != null) {
        const deptRules = rulesByDept.get(p.departmentId);
        if (deptRules && deptRules.length === 1) {
          countsByStatus.OK++;
          continue;
        }
        if (deptRules && deptRules.length > 1) {
          unmapped.push({
            id: p.id,
            name: p.name,
            upc: p.upc,
            departmentId: p.departmentId,
            taxClass: p.taxClass,
            taxRuleId: null,
            status: 'AMBIGUOUS',
            suggestions: deptRules.map((r) => ({ id: r.id, name: r.name, rate: Number(r.rate) })),
            reason: `${deptRules.length} active rules target this department — pick one as a per-product override or remove the dept from the others`,
          });
          countsByStatus.AMBIGUOUS++;
          continue;
        }
      }

      // Neither tier resolved → product will be taxed 0% at checkout.
      unmapped.push({
        id: p.id,
        name: p.name,
        upc: p.upc,
        departmentId: p.departmentId,
        taxClass: p.taxClass,
        taxRuleId: null,
        status: 'UNMAPPED',
        suggestions: [],
        reason: p.departmentId == null
          ? 'No department set and no per-product taxRuleId — product will be taxed 0%.'
          : `Department is not linked to any active tax rule — product will be taxed 0%.`,
      });
      countsByStatus.UNMAPPED++;
    }

    const total = unmapped.length;
    const paged = unmapped.slice(skip, skip + take);

    res.json({
      success: true,
      summary: {
        totalProducts: products.length,
        okCount: countsByStatus.OK,
        unmappedCount: countsByStatus.UNMAPPED,
        ambiguousCount: countsByStatus.AMBIGUOUS,
        staleFkCount: countsByStatus.STALE_FK,
        activeRuleCount: rules.length,
      },
      total,
      skip,
      take,
      data: paged,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};
