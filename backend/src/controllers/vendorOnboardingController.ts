// ─────────────────────────────────────────────────
// Vendor Onboarding controller — S77 Phase 1
//
// Two surfaces:
//   1. /api/vendor-onboarding/me  — vendor's own questionnaire (draft + submit)
//   2. /api/admin/vendor-onboardings — superadmin review queue
//
// Phase 2 (contract) and Phase 3 (signing + plan assignment) will extend
// the workflow but the read/list endpoints here stay stable.
// ─────────────────────────────────────────────────
import type { Request, Response, NextFunction } from 'express';
import prisma from '../config/postgres.js';
import { logAudit } from '../services/auditService.js';

// Allowed enum-ish values — server-side validation guards. Keep in sync
// with the frontend wizard's option lists.
const BUSINESS_TYPES = ['LLC', 'Corp', 'SoleProp', 'Partnership', 'Nonprofit', 'Other'];
const YEARS_IN_BUSINESS = ['<1', '1-3', '3-5', '5-10', '10+'];
const INDUSTRIES = ['convenience', 'liquor', 'grocery', 'gas_station', 'restaurant', 'smoke_shop', 'other'];
const STORE_RANGES = ['1', '2-5', '6-10', '11+'];
const VOLUME_RANGES = ['0-50k', '50k-200k', '200k-500k', '500k-1m', '1m+'];
const POS_VENDORS = ['None', 'NCR', 'Verifone', 'Square', 'Clover', 'Shopify', 'Other'];
const TIMELINES = ['immediate', '1month', '3months', 'exploring'];
const HEAR_ABOUT = ['search', 'referral', 'event', 'social', 'partner', 'other'];
const ALLOWED_MODULES = [
  'pos_core', 'lottery', 'fuel', 'ecommerce', 'marketplace', 'exchange',
  'loyalty', 'scan_data', 'ai_assistant', 'vendor_orders', 'invoice_ocr',
  'multi_store', 'predictions',
];
const ALLOWED_STATUSES = [
  'draft', 'submitted', 'reviewed', 'contract_sent',
  'contract_signed', 'approved', 'rejected',
];

interface OnboardingBody {
  fullName?: string;
  email?: string;
  phone?: string | null;
  businessLegalName?: string | null;
  dbaName?: string | null;
  businessAddress?: string | null;
  businessCity?: string | null;
  businessState?: string | null;
  businessZip?: string | null;
  businessType?: string | null;
  ein?: string | null;
  yearsInBusiness?: string | null;
  industry?: string | null;
  numStoresRange?: string | null;
  numStoresExact?: number | null;
  numRegistersPerStore?: number | null;
  monthlyVolumeRange?: string | null;
  avgTxPerDay?: number | null;
  currentPOS?: string | null;
  goLiveTimeline?: string | null;
  requestedModules?: string[];
  // S80 Phase 3 — plan + addons (interest only; admin reads at approval time)
  selectedPlanSlug?: string | null;
  selectedAddonKeys?: string[];
  estimatedMonthlyTotal?: number | string | null;
  hardwareNeeds?: Record<string, unknown>;
  hearAboutUs?: string | null;
  referralSource?: string | null;
  specialRequirements?: string | null;
  agreedToTerms?: boolean;
  currentStep?: number;
}

function pickEnum(value: string | null | undefined, allowed: string[]): string | null {
  if (value == null) return null;
  return allowed.includes(value) ? value : null;
}

function intOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.floor(n) : null;
}

function trimOrNull(v: unknown, max = 500): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

// Build the persisted shape from the inbound body. Used by both upsert
// (draft save) and submit. Any field not explicitly listed is dropped.
function shapeOnboarding(body: OnboardingBody, userEmail: string, userName: string) {
  return {
    fullName:           trimOrNull(body.fullName, 200) || userName,
    email:              trimOrNull(body.email, 200) || userEmail,
    phone:              trimOrNull(body.phone, 30),
    businessLegalName:  trimOrNull(body.businessLegalName, 200),
    dbaName:            trimOrNull(body.dbaName, 200),
    businessAddress:    trimOrNull(body.businessAddress, 300),
    businessCity:       trimOrNull(body.businessCity, 100),
    businessState:      trimOrNull(body.businessState, 2),
    businessZip:        trimOrNull(body.businessZip, 10),
    businessType:       pickEnum(body.businessType ?? null, BUSINESS_TYPES),
    ein:                trimOrNull(body.ein, 20),
    yearsInBusiness:    pickEnum(body.yearsInBusiness ?? null, YEARS_IN_BUSINESS),
    industry:           pickEnum(body.industry ?? null, INDUSTRIES),
    numStoresRange:     pickEnum(body.numStoresRange ?? null, STORE_RANGES),
    numStoresExact:     intOrNull(body.numStoresExact),
    numRegistersPerStore: intOrNull(body.numRegistersPerStore),
    monthlyVolumeRange: pickEnum(body.monthlyVolumeRange ?? null, VOLUME_RANGES),
    avgTxPerDay:        intOrNull(body.avgTxPerDay),
    currentPOS:         pickEnum(body.currentPOS ?? null, POS_VENDORS),
    goLiveTimeline:     pickEnum(body.goLiveTimeline ?? null, TIMELINES),
    requestedModules:   Array.isArray(body.requestedModules)
                          ? body.requestedModules.filter((m): m is string => typeof m === 'string' && ALLOWED_MODULES.includes(m))
                          : [],
    hardwareNeeds:      (body.hardwareNeeds && typeof body.hardwareNeeds === 'object') ? body.hardwareNeeds : {},
    hearAboutUs:        pickEnum(body.hearAboutUs ?? null, HEAR_ABOUT),
    referralSource:     trimOrNull(body.referralSource, 200),
    specialRequirements: trimOrNull(body.specialRequirements, 5000),
    agreedToTerms:      body.agreedToTerms === true,
    currentStep:        intOrNull(body.currentStep) ?? 1,
  };
}

// S80 Phase 3 — pull the plan-picker fields out of the body separately, since
// the Prisma client may not yet know about them (DLL lock). We persist them
// via a raw UPDATE after the typed upsert.
function shapePlanPicker(body: OnboardingBody) {
  return {
    selectedPlanSlug:
      body.selectedPlanSlug == null ? null : String(body.selectedPlanSlug).slice(0, 50),
    selectedAddonKeys: Array.isArray(body.selectedAddonKeys)
      ? body.selectedAddonKeys.filter((k): k is string => typeof k === 'string').slice(0, 50)
      : [],
    estimatedMonthlyTotal:
      body.estimatedMonthlyTotal == null
        ? null
        : Number.isFinite(Number(body.estimatedMonthlyTotal))
          ? Number(body.estimatedMonthlyTotal)
          : null,
  };
}

// Raw UPDATE for the plan-picker fields. Idempotent — always runs after the
// typed upsert. Safe even if the row has just been created (matches by userId).
async function persistPlanPicker(userId: string, picker: ReturnType<typeof shapePlanPicker>) {
  const addonKeysLiteral = `{${picker.selectedAddonKeys.map(k => `"${k.replace(/"/g, '\\"')}"`).join(',')}}`;
  await prisma.$executeRawUnsafe(
    `UPDATE vendor_onboardings
        SET "selectedPlanSlug"      = $1,
            "selectedAddonKeys"     = $2::text[],
            "estimatedMonthlyTotal" = $3,
            "updatedAt"             = NOW()
      WHERE "userId" = $4`,
    picker.selectedPlanSlug,
    addonKeysLiteral,
    picker.estimatedMonthlyTotal,
    userId,
  );
}

// ── @desc    Get current vendor's own onboarding draft (creates one if absent)
// ── @route   GET /api/vendor-onboarding/me
// ── @access  Authenticated (any status)
export const getMyOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Not authorized' }); return; }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true, onboardingSubmitted: true, contractSigned: true, vendorApproved: true },
    });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    let onboarding = await prisma.vendorOnboarding.findUnique({ where: { userId } });

    // Lazy create the draft on first GET so the wizard can PUT immediately.
    if (!onboarding) {
      onboarding = await prisma.vendorOnboarding.create({
        data: {
          userId,
          fullName: user.name,
          email: user.email,
          phone: user.phone,
          status: 'draft',
          currentStep: 1,
        },
      });
    }

    res.json({
      onboarding,
      userFlags: {
        onboardingSubmitted: user.onboardingSubmitted,
        contractSigned: user.contractSigned,
        vendorApproved: user.vendorApproved,
      },
    });
  } catch (err) { next(err); }
};

// ── @desc    Save draft (any field; partial allowed)
// ── @route   PUT /api/vendor-onboarding/me
// ── @access  Authenticated (status doesn't matter — pre-portal)
export const updateMyOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Not authorized' }); return; }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, onboardingSubmitted: true },
    });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    // Once submitted, the questionnaire is locked from further vendor edits.
    // (Admin can still amend via a future endpoint if needed.)
    if (user.onboardingSubmitted) {
      res.status(409).json({ error: 'Onboarding already submitted — cannot edit.' });
      return;
    }

    const data = shapeOnboarding(req.body || {}, user.email, user.name);
    const picker = shapePlanPicker(req.body || {});

    // Typed Prisma upsert on the legacy field set (its client doesn't yet
    // know about the plan-picker columns). Plan-picker fields persisted via
    // a follow-up raw UPDATE in `persistPlanPicker` so the typed call doesn't
    // reject Unknown args at runtime.
    const onboarding = await prisma.vendorOnboarding.upsert({
      where: { userId },
      create: { userId, status: 'draft', ...data },
      update: { ...data, status: 'draft' },
    });
    await persistPlanPicker(userId, picker);

    // Re-read so the response includes the new fields.
    const fresh: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM vendor_onboardings WHERE id = $1 LIMIT 1`,
      onboarding.id,
    );
    res.json({ onboarding: fresh[0] || onboarding });
  } catch (err) { next(err); }
};

// ── @desc    Submit the questionnaire — locks user out until admin approves
// ── @route   POST /api/vendor-onboarding/me/submit
// ── @access  Authenticated
export const submitMyOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Not authorized' }); return; }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, onboardingSubmitted: true },
    });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    if (user.onboardingSubmitted) {
      res.status(409).json({ error: 'Onboarding already submitted.' });
      return;
    }

    // Persist any final edits the wizard sent in this same request.
    const data = shapeOnboarding(req.body || {}, user.email, user.name);
    const picker = shapePlanPicker(req.body || {});

    // Minimal completeness check — the wizard is in charge of full validation.
    if (!data.businessLegalName) {
      res.status(400).json({ error: 'Business legal name is required.' });
      return;
    }
    if (!data.industry) {
      res.status(400).json({ error: 'Please select your industry.' });
      return;
    }
    if (!data.requestedModules.includes('pos_core') && data.requestedModules.length === 0) {
      res.status(400).json({ error: 'Please select at least one module of interest.' });
      return;
    }
    if (!data.agreedToTerms) {
      res.status(400).json({ error: 'You must agree to the terms of service to continue.' });
      return;
    }

    const onboarding = await prisma.vendorOnboarding.upsert({
      where: { userId },
      create: {
        userId,
        ...data,
        status: 'submitted',
        submittedAt: new Date(),
      },
      update: {
        ...data,
        status: 'submitted',
        submittedAt: new Date(),
      },
    });
    // S80 Phase 3 — persist plan-picker fields via raw SQL (typed client may
    // not yet know about them; columns exist via migration).
    await persistPlanPicker(userId, picker);

    // Flip the user flag so the protect middleware + frontend gate can rely on
    // a single boolean instead of joining VendorOnboarding on every request.
    await prisma.user.update({
      where: { id: userId },
      data: { onboardingSubmitted: true },
    });

    await logAudit(req, 'submit', 'vendor_onboarding', onboarding.id, {
      industry: onboarding.industry,
      numStoresRange: onboarding.numStoresRange,
      modules: onboarding.requestedModules,
    });

    res.json({ onboarding, message: 'Onboarding submitted — your account is awaiting administrator review.' });
  } catch (err) { next(err); }
};

// ── @desc    Admin: list all submissions (filterable by status)
// ── @route   GET /api/admin/vendor-onboardings
// ── @access  Superadmin only
export const adminListOnboardings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Superadmin only.' });
      return;
    }

    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const where = status && ALLOWED_STATUSES.includes(status) ? { status } : {};

    const onboardings = await prisma.vendorOnboarding.findMany({
      where,
      orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true },
        },
      },
      take: 200,
    });

    // Counts by status for the tab badges.
    const counts = await prisma.vendorOnboarding.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const countsByStatus: Record<string, number> = {};
    for (const row of counts) countsByStatus[row.status] = row._count._all;

    res.json({ onboardings, countsByStatus });
  } catch (err) { next(err); }
};

// ── @desc    Admin: get onboarding submission by USER id (used by user-row eye button)
// ── @route   GET /api/admin/vendor-onboardings/by-user/:userId
// ── @access  Superadmin only
// Returns 404 + a clear `notFound:true` flag when the user has never started
// the questionnaire — frontend uses this to disable the button.
export const adminGetOnboardingByUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Superadmin only.' });
      return;
    }

    const onboarding = await prisma.vendorOnboarding.findUnique({
      where: { userId: req.params.userId },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true, onboardingSubmitted: true, contractSigned: true, vendorApproved: true },
        },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!onboarding) {
      res.status(404).json({ error: 'No onboarding submission for this user.', notFound: true });
      return;
    }

    res.json({ onboarding });
  } catch (err) { next(err); }
};

// ── @desc    Admin: get one onboarding submission with full detail
// ── @route   GET /api/admin/vendor-onboardings/:id
// ── @access  Superadmin only
export const adminGetOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Superadmin only.' });
      return;
    }

    const onboarding = await prisma.vendorOnboarding.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true, onboardingSubmitted: true, contractSigned: true, vendorApproved: true },
        },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!onboarding) { res.status(404).json({ error: 'Onboarding not found.' }); return; }

    res.json({ onboarding });
  } catch (err) { next(err); }
};

// ── @desc    Admin: update review fields (notes, suggestedTier, mark reviewed/rejected)
// ── @route   PATCH /api/admin/vendor-onboardings/:id
// ── @access  Superadmin only
export const adminUpdateOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Superadmin only.' });
      return;
    }

    const { status, adminNotes, rejectionReason, suggestedPricingTierId } = req.body as {
      status?: string;
      adminNotes?: string | null;
      rejectionReason?: string | null;
      suggestedPricingTierId?: string | null;
    };

    const existing = await prisma.vendorOnboarding.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Onboarding not found.' }); return; }

    const updates: Record<string, unknown> = {};
    if (status && ALLOWED_STATUSES.includes(status)) {
      updates.status = status;
      // Stamp reviewer + timestamp the first time we transition out of submitted.
      if (existing.status === 'submitted' && status !== 'submitted') {
        updates.reviewedAt = new Date();
        updates.reviewedById = req.user.id;
      }
    }
    if (adminNotes !== undefined)         updates.adminNotes = trimOrNull(adminNotes, 5000);
    if (rejectionReason !== undefined)    updates.rejectionReason = trimOrNull(rejectionReason, 5000);
    if (suggestedPricingTierId !== undefined) updates.suggestedPricingTierId = suggestedPricingTierId || null;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No fields to update.' });
      return;
    }

    const onboarding = await prisma.vendorOnboarding.update({
      where: { id: req.params.id },
      data: updates,
    });

    await logAudit(req, 'update', 'vendor_onboarding', onboarding.id, updates);

    res.json({ onboarding });
  } catch (err) { next(err); }
};
