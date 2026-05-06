// ─────────────────────────────────────────────────
// Vendor Pipeline — unified list endpoint (S80)
//
// Replaces the two separate /admin/vendor-onboardings + /admin/contracts list
// surfaces with a single per-vendor row that derives a unified `pipelineStatus`
// from the join between VendorOnboarding and the latest Contract.
//
// One row per VendorOnboarding (the stable per-vendor anchor). Vendors without
// onboardings are not in the pipeline yet.
//
// Status derivation (latest contract wins; onboarding state used only when no
// contract exists):
//   no contract + onboarding.status='rejected' → 'rejected'
//   no contract + (any other onboarding state)  → 'submitted'
//   contract.status='draft'                      → 'drafts'
//   contract.status IN ('sent','viewed')         → 'sent'
//   contract.status='signed'                     → 'signed'
//   contract.status='countersigned'              → 'activated'
//   contract.status IN ('cancelled','expired')   → 'rejected'  (consolidated)
//
// `viewCount` reflects the number of `viewed` ContractEvent rows on the latest
// contract — drives the eye icon next to Sent rows.
// ─────────────────────────────────────────────────
import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

// Prisma row types — derived from the includes below so they stay in sync.
type ContractRow = Prisma.ContractGetPayload<{
  include: { template: { select: { id: true; name: true } } };
}>;
type OnboardingRow = Prisma.VendorOnboardingGetPayload<{
  include: {
    user: { select: { id: true; name: true; email: true; phone: true; status: true; createdAt: true } };
  };
}>;

const PIPELINE_STATUSES = ['submitted', 'drafts', 'sent', 'signed', 'activated', 'rejected'] as const;
type PipelineStatus = typeof PIPELINE_STATUSES[number];

function deriveStatus(
  onboardingStatus: string,
  latestContractStatus: string | null,
): PipelineStatus {
  if (!latestContractStatus) {
    if (onboardingStatus === 'rejected') return 'rejected';
    return 'submitted';
  }
  switch (latestContractStatus) {
    case 'draft':         return 'drafts';
    case 'sent':
    case 'viewed':        return 'sent';
    case 'signed':        return 'signed';
    case 'countersigned': return 'activated';
    case 'cancelled':
    case 'expired':       return 'rejected';
    default:              return 'submitted';
  }
}

function isPipelineStatus(s: unknown): s is PipelineStatus {
  return typeof s === 'string' && (PIPELINE_STATUSES as readonly string[]).includes(s);
}

// ── @desc    Admin: unified vendor pipeline list (one row per onboarding)
// ── @route   GET /api/admin/vendor-pipeline
// ── @query   status?  one of submitted | drafts | sent | signed | activated | rejected
// ── @access  Superadmin only
export const adminListPipeline = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Superadmin only.' });
      return;
    }

    const filterStatus = isPipelineStatus(req.query.status) ? req.query.status : null;

    // Fetch every onboarding with its full latest contract joined.
    // 200 cap matches the existing listOnboardings/listContracts pattern; we
    // can paginate later if any single tenant has more than ~200 vendors.
    const onboardings: OnboardingRow[] = await prisma.vendorOnboarding.findMany({
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true },
        },
      },
      take: 500,
    });

    if (onboardings.length === 0) {
      res.json({ rows: [], countsByStatus: emptyCounts() });
      return;
    }

    const userIds = onboardings.map((o: OnboardingRow) => o.userId);

    // Latest contract per user. Order by createdAt desc + take 1 per user.
    // Prisma doesn't have a clean "latest per group" — `distinct` works here
    // because we order by createdAt desc within the same userId.
    const latestContracts: ContractRow[] = await prisma.contract.findMany({
      where: { userId: { in: userIds } },
      orderBy: [{ userId: 'asc' }, { createdAt: 'desc' }],
      distinct: ['userId'],
      include: {
        template: { select: { id: true, name: true } },
      },
    });
    const contractByUserId = new Map<string, ContractRow>(
      latestContracts.map((c: ContractRow) => [c.userId, c]),
    );

    // View counts — `viewed` events on the latest contract. One groupBy call
    // covers every contract we just loaded.
    const contractIds = latestContracts.map((c: ContractRow) => c.id);
    const viewEvents = contractIds.length
      ? await prisma.contractEvent.groupBy({
          by: ['contractId'],
          where: { contractId: { in: contractIds }, eventType: 'viewed' },
          _count: { _all: true },
        })
      : [];
    const viewCountByContractId = new Map<string, number>(
      viewEvents.map((v: { contractId: string; _count: { _all: number } }) => [v.contractId, v._count._all]),
    );

    // Build the unified rows.
    const rows = onboardings.map((o: OnboardingRow) => {
      const c = contractByUserId.get(o.userId) ?? null;
      const pipelineStatus = deriveStatus(o.status, c?.status ?? null);
      const viewCount = c ? (viewCountByContractId.get(c.id) ?? 0) : 0;

      // Used for sort + the "last activity" column.
      const lastActivityAt =
        c?.activatedAt
        ?? c?.signedAt
        ?? c?.viewedAt
        ?? c?.sentAt
        ?? c?.createdAt
        ?? o.submittedAt
        ?? o.createdAt;

      return {
        id: o.id,                           // stable per-vendor anchor for selection
        pipelineStatus,
        onboarding: o,
        latestContract: c,
        viewCount,
        // Convenience fields hoisted to the top so the list table doesn't
        // have to dig through the nested objects.
        userId: o.userId,
        userName: o.user.name,
        userEmail: o.user.email,
        businessName: o.businessLegalName ?? o.user.name,
        lastActivityAt,
        // Most recent rejection reason — onboarding's takes priority because
        // the contract may have been cancelled with no admin-supplied reason.
        rejectionReason: o.rejectionReason ?? c?.cancelReason ?? null,
      };
    });

    // Count by status BEFORE filtering so the tab badges show every count
    // regardless of which tab is currently selected.
    const countsByStatus = emptyCounts();
    for (const r of rows) countsByStatus[r.pipelineStatus as PipelineStatus]++;

    const filteredRows = filterStatus
      ? rows.filter((r: { pipelineStatus: PipelineStatus }) => r.pipelineStatus === filterStatus)
      : rows;

    res.json({ rows: filteredRows, countsByStatus });
  } catch (err) { next(err); }
};

function emptyCounts(): Record<PipelineStatus, number> {
  return { submitted: 0, drafts: 0, sent: 0, signed: 0, activated: 0, rejected: 0 };
}
