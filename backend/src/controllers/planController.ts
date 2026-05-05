/**
 * S78 — Plan & Module controller
 *
 * Three audiences:
 *
 * 1. Authenticated user — entitlement lookup (used by sidebar + route guard):
 *      GET /plans/me/modules                 → { modules: [{key, routePaths}] }
 *
 * 2. Admin (superadmin) — Plan CRUD:
 *      GET    /admin/plans                   list with module count
 *      GET    /admin/plans/:id               detail with full module list
 *      POST   /admin/plans                   create
 *      PATCH  /admin/plans/:id               update fields + module assignment
 *      DELETE /admin/plans/:id               soft delete (active=false)
 *
 * 3. Admin — Module CRUD (catalog management):
 *      GET    /admin/modules                 list all with active flag
 *      POST   /admin/modules                 register a new module
 *      PATCH  /admin/modules/:id             update name/category/routePaths
 *      DELETE /admin/modules/:id             soft delete (refused on isCore)
 */
import type { Request, Response, NextFunction } from 'express';
import prisma from '../config/postgres.js';
import { logAudit } from '../services/auditService.js';

function isSuperadmin(req: Request): boolean {
  return req.user?.role === 'superadmin';
}

// ─────────────────────────────────────────────────
// 0. Public — list public+active plans for the marketing /pricing page
// ─────────────────────────────────────────────────
export const getPublicPlans = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: [{ sortOrder: 'asc' }, { basePrice: 'asc' }],
      include: {
        addons: { where: { isActive: true } },
        modules: {
          include: {
            module: {
              select: {
                id: true, key: true, name: true, description: true,
                category: true, icon: true, isCore: true, sortOrder: true, active: true,
              },
            },
          },
        },
      },
    });

    // Map down to the wire shape used by the marketing /pricing page.
    // Filters out inactive modules + dedup core (always included).
    const result = (plans as any[]).map((p) => {
      const modules = (p.modules || [])
        .map((pm: any) => pm.module)
        .filter((m: any) => m && m.active)
        .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

      // Group features by module category for the comparison table
      const grouped: Record<string, Array<{ key: string; name: string; description: string | null; isCore: boolean }>> = {};
      for (const m of modules) {
        (grouped[m.category] ||= []).push({
          key: m.key,
          name: m.name,
          description: m.description,
          isCore: m.isCore,
        });
      }

      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        tagline: p.tagline,
        description: p.description,
        basePrice: Number(p.basePrice ?? 0),
        annualPrice: p.annualPrice == null ? null : Number(p.annualPrice),
        isCustomPriced: !!p.isCustomPriced,
        currency: p.currency || 'USD',
        pricePerStore: Number(p.pricePerStore ?? 0),
        pricePerRegister: Number(p.pricePerRegister ?? 0),
        includedStores: p.includedStores ?? 1,
        includedRegisters: p.includedRegisters ?? 1,
        maxUsers: p.maxUsers,
        trialDays: p.trialDays ?? 0,
        highlighted: !!p.highlighted,
        isDefault: !!p.isDefault,
        sortOrder: p.sortOrder ?? 0,
        moduleCount: modules.length,
        modules: modules.map((m: any) => ({
          key: m.key,
          name: m.name,
          description: m.description,
          category: m.category,
          icon: m.icon,
          isCore: m.isCore,
        })),
        modulesByCategory: grouped,
        addons: (p.addons || []).map((a: any) => ({
          key: a.key,
          name: a.name,
          description: a.description,
          monthlyPrice: Number(a.monthlyPrice ?? 0),
        })),
      };
    });

    // Build a global category list (ordered) so the marketing page can render
    // the comparison table consistently even when one plan omits a category.
    const allCategories = await prisma.platformModule.findMany({
      where: { active: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      select: { key: true, name: true, description: true, category: true, isCore: true, sortOrder: true },
    });
    const categoryOrder: string[] = [];
    const categoryMap: Record<string, Array<{ key: string; name: string; description: string | null; isCore: boolean }>> = {};
    for (const m of allCategories) {
      if (!categoryMap[m.category]) {
        categoryMap[m.category] = [];
        categoryOrder.push(m.category);
      }
      categoryMap[m.category].push({
        key: m.key,
        name: m.name,
        description: m.description,
        isCore: m.isCore,
      });
    }

    res.json({
      plans: result,
      categories: categoryOrder.map((cat) => ({ name: cat, modules: categoryMap[cat] })),
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────
// 1. Vendor entitlement (any authenticated user)
// ─────────────────────────────────────────────────
export const getMyModules = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Not authorized.' }); return; }

    // Superadmin shortcut: every active module.
    if (req.user?.role === 'superadmin') {
      const all = await prisma.platformModule.findMany({
        where: { active: true },
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
        select: { key: true, name: true, category: true, routePaths: true, icon: true, isCore: true },
      });
      res.json({
        modules: all,
        plan: { name: 'Platform Superadmin', slug: 'superadmin', source: 'superadmin' },
        moduleKeys: all.map((m: any) => m.key),
        routePaths: all.flatMap((m: any) => m.routePaths),
      });
      return;
    }

    // Resolve the active org → its OrgSubscription → SubscriptionPlan → modules.
    const activeOrgId = req.orgId;
    if (!activeOrgId) {
      // No active org yet (e.g. fresh signup pre-onboarding). Grant only
      // core modules so they can reach Account / Support / Billing.
      const core = await prisma.platformModule.findMany({
        where: { active: true, isCore: true },
        orderBy: [{ sortOrder: 'asc' }],
        select: { key: true, name: true, category: true, routePaths: true, icon: true, isCore: true },
      });
      res.json({
        modules: core,
        plan: null,
        moduleKeys: core.map((m: any) => m.key),
        routePaths: core.flatMap((m: any) => m.routePaths),
        warning: 'no_active_org',
      });
      return;
    }

    const sub = await prisma.orgSubscription.findUnique({
      where: { orgId: activeOrgId },
      include: {
        plan: {
          include: {
            modules: {
              include: {
                module: {
                  select: { id: true, key: true, name: true, category: true, routePaths: true, icon: true, isCore: true, active: true, sortOrder: true },
                },
              },
            },
          },
        },
      },
    });

    let planModules: Array<{ id: string; key: string; name: string; category: string; routePaths: string[]; icon: string | null; isCore: boolean; sortOrder: number }> = [];
    let planSummary: { name: string; slug: string; source: string } | null = null;

    if (sub?.plan) {
      planModules = (sub.plan.modules as any[])
        .map((pm: any) => pm.module)
        .filter((m: any) => m.active);
      planSummary = { name: sub.plan.name, slug: sub.plan.slug, source: 'subscription' };
    } else {
      // Fallback: org has no OrgSubscription yet. Use the default plan.
      const defaultPlan = await prisma.subscriptionPlan.findFirst({
        where: { isDefault: true, isActive: true },
        include: {
          modules: {
            include: {
              module: {
                select: { id: true, key: true, name: true, category: true, routePaths: true, icon: true, isCore: true, active: true, sortOrder: true },
              },
            },
          },
        },
      });
      if (defaultPlan) {
        planModules = (defaultPlan.modules as any[])
          .map((pm: any) => pm.module)
          .filter((m: any) => m.active);
        planSummary = { name: defaultPlan.name, slug: defaultPlan.slug, source: 'default_fallback' };
      }
    }

    // Always merge core modules in (defensive — even if a plan doesn't list them).
    const coreModules = await prisma.platformModule.findMany({
      where: { active: true, isCore: true },
      select: { id: true, key: true, name: true, category: true, routePaths: true, icon: true, isCore: true, sortOrder: true },
    });

    const merged = new Map<string, typeof planModules[number]>();
    for (const m of planModules) merged.set(m.id, m);
    for (const m of coreModules) if (!merged.has(m.id)) merged.set(m.id, m);

    const modules = Array.from(merged.values()).sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );

    res.json({
      modules,
      plan: planSummary,
      moduleKeys: modules.map(m => m.key),
      routePaths: modules.flatMap(m => m.routePaths),
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────
// 2. Admin — SubscriptionPlan CRUD
// ─────────────────────────────────────────────────

export const adminListPlans = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const plans = await prisma.subscriptionPlan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { modules: true, subscriptions: true } },
        modules: {
          include: { module: { select: { id: true, key: true, name: true, category: true } } },
        },
      },
    });
    res.json({ plans });
  } catch (err) { next(err); }
};

export const adminGetPlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: req.params.id },
      include: {
        modules: {
          include: { module: true },
          orderBy: { module: { sortOrder: 'asc' } },
        },
        _count: { select: { subscriptions: true } },
      },
    });
    if (!plan) { res.status(404).json({ error: 'Plan not found.' }); return; }
    res.json({ plan });
  } catch (err) { next(err); }
};

interface PlanUpsertBody {
  slug?: string;
  name?: string;
  tagline?: string | null;
  description?: string | null;
  basePrice?: number;
  annualPrice?: number | null;
  isCustomPriced?: boolean;
  currency?: string;
  pricePerStore?: number;
  pricePerRegister?: number;
  includedStores?: number;
  includedRegisters?: number;
  maxUsers?: number | null;
  trialDays?: number;
  isPublic?: boolean;
  isActive?: boolean;
  highlighted?: boolean;
  isDefault?: boolean;
  sortOrder?: number;
  /** Module IDs to assign to this plan. Replaces existing assignments. */
  moduleIds?: string[];
}

function clean(body: PlanUpsertBody): Partial<PlanUpsertBody> {
  // Whitelist + drop unset.
  const out: any = {};
  const numFields = ['basePrice', 'annualPrice', 'pricePerStore', 'pricePerRegister', 'includedStores', 'includedRegisters', 'maxUsers', 'trialDays', 'sortOrder'];
  const boolFields = ['isCustomPriced', 'isPublic', 'isActive', 'highlighted', 'isDefault'];
  const strFields  = ['slug', 'name', 'tagline', 'description', 'currency'];
  for (const f of numFields) if (body[f as keyof PlanUpsertBody] !== undefined) out[f] = body[f as keyof PlanUpsertBody];
  for (const f of boolFields) if (body[f as keyof PlanUpsertBody] !== undefined) out[f] = !!body[f as keyof PlanUpsertBody];
  for (const f of strFields) if (body[f as keyof PlanUpsertBody] !== undefined) out[f] = body[f as keyof PlanUpsertBody];
  return out;
}

export const adminCreatePlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const body = (req.body || {}) as PlanUpsertBody;
    if (!body.slug || !body.name) {
      res.status(400).json({ error: 'slug and name are required.' });
      return;
    }
    const data = clean(body) as any;
    if (data.basePrice === undefined) data.basePrice = 0;
    if (!data.includedStores) data.includedStores = 1;
    if (!data.includedRegisters) data.includedRegisters = 1;

    const plan = await prisma.subscriptionPlan.create({ data });

    // Optional module assignment
    if (Array.isArray(body.moduleIds)) {
      await prisma.planModule.createMany({
        data: body.moduleIds.map(moduleId => ({ planId: plan.id, moduleId })),
        skipDuplicates: true,
      });
    }

    await logAudit(req, 'create', 'subscription_plan', plan.id, { slug: plan.slug, moduleCount: body.moduleIds?.length || 0 });
    res.status(201).json({ plan });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(400).json({ error: 'A plan with that slug already exists.' });
      return;
    }
    next(err);
  }
};

export const adminUpdatePlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const body = (req.body || {}) as PlanUpsertBody;
    const existing = await prisma.subscriptionPlan.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Plan not found.' }); return; }

    const data = clean(body);
    if (Object.keys(data).length > 0) {
      await prisma.subscriptionPlan.update({ where: { id: req.params.id }, data: data as any });
    }

    // Module assignment — replace if explicitly supplied.
    if (Array.isArray(body.moduleIds)) {
      await prisma.$transaction([
        prisma.planModule.deleteMany({ where: { planId: req.params.id } }),
        prisma.planModule.createMany({
          data: body.moduleIds.map(moduleId => ({ planId: req.params.id, moduleId })),
          skipDuplicates: true,
        }),
      ]);
    }

    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: req.params.id },
      include: {
        modules: { include: { module: true } },
        _count: { select: { subscriptions: true } },
      },
    });

    await logAudit(req, 'update', 'subscription_plan', req.params.id, {
      changedFields: Object.keys(data),
      moduleAssignmentChanged: Array.isArray(body.moduleIds),
    });
    res.json({ plan });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(400).json({ error: 'A plan with that slug already exists.' });
      return;
    }
    next(err);
  }
};

export const adminDeletePlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { subscriptions: true } } },
    });
    if (!plan) { res.status(404).json({ error: 'Plan not found.' }); return; }
    if (plan._count.subscriptions > 0) {
      res.status(409).json({ error: `Cannot delete: ${plan._count.subscriptions} org(s) are subscribed to this plan. Move them to a different plan first.` });
      return;
    }
    await prisma.subscriptionPlan.update({ where: { id: req.params.id }, data: { isActive: false, isPublic: false } });
    await logAudit(req, 'delete', 'subscription_plan', req.params.id, { soft: true });
    res.json({ success: true });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────
// 3. Admin — PlatformModule CRUD
// ─────────────────────────────────────────────────

export const adminListModules = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const modules = await prisma.platformModule.findMany({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });
    // Group by category for the admin UI's grouped multi-select.
    const grouped: Record<string, typeof modules> = {};
    for (const m of modules) {
      (grouped[m.category] ??= []).push(m);
    }
    res.json({ modules, grouped });
  } catch (err) { next(err); }
};

export const adminCreateModule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const { key, name, category, routePaths, description, icon, isCore, sortOrder } = req.body || {};
    if (!key || !name || !category) {
      res.status(400).json({ error: 'key, name, and category are required.' });
      return;
    }
    const mod = await prisma.platformModule.create({
      data: {
        key, name, category,
        routePaths: Array.isArray(routePaths) ? routePaths : [],
        description: description ?? null,
        icon: icon ?? null,
        isCore: !!isCore,
        sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
        active: true,
      },
    });
    await logAudit(req, 'create', 'platform_module', mod.id, { key });
    res.status(201).json({ module: mod });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(400).json({ error: 'A module with that key already exists.' });
      return;
    }
    next(err);
  }
};

export const adminUpdateModule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const { name, category, routePaths, description, icon, isCore, sortOrder, active } = req.body || {};
    const data: any = {};
    if (name !== undefined)        data.name = name;
    if (category !== undefined)    data.category = category;
    if (Array.isArray(routePaths)) data.routePaths = routePaths;
    if (description !== undefined) data.description = description;
    if (icon !== undefined)        data.icon = icon;
    if (isCore !== undefined)      data.isCore = !!isCore;
    if (sortOrder !== undefined)   data.sortOrder = sortOrder;
    if (active !== undefined)      data.active = !!active;
    const mod = await prisma.platformModule.update({ where: { id: req.params.id }, data });
    await logAudit(req, 'update', 'platform_module', mod.id, { changedFields: Object.keys(data) });
    res.json({ module: mod });
  } catch (err) { next(err); }
};

export const adminDeleteModule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const mod = await prisma.platformModule.findUnique({ where: { id: req.params.id } });
    if (!mod) { res.status(404).json({ error: 'Module not found.' }); return; }
    if (mod.isCore) {
      res.status(409).json({ error: 'Cannot delete a core module. Mark it inactive via update if needed.' });
      return;
    }
    // Soft delete — also unlinks from plans via active=false on the read path.
    await prisma.platformModule.update({ where: { id: req.params.id }, data: { active: false } });
    await logAudit(req, 'delete', 'platform_module', mod.id, { soft: true });
    res.json({ success: true });
  } catch (err) { next(err); }
};
