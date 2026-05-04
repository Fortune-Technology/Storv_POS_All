/**
 * S77 Phase 2 — Contract controller
 *
 * Three audiences, three surfaces:
 *
 * 1. Vendor self-service (auth required, gate-tolerant):
 *      GET    /contracts/me                — list of contracts assigned to me
 *      GET    /contracts/me/:id            — fetch one contract for signing
 *      POST   /contracts/me/:id/sign       — submit signature → generate PDF
 *      GET    /contracts/me/:id/pdf        — download own signed PDF
 *
 * 2. Admin (superadmin):
 *      GET    /admin/contracts             — list all contracts (status filter)
 *      GET    /admin/contracts/:id         — fetch one with full audit trail
 *      POST   /admin/contracts             — generate a draft from onboarding
 *      PATCH  /admin/contracts/:id         — edit draft mergeValues
 *      POST   /admin/contracts/:id/send    — flip draft → sent + email
 *      POST   /admin/contracts/:id/cancel  — void
 *      POST   /admin/contracts/:id/activate — Approve & Activate (assigns plan + flips user.vendorApproved)
 *      GET    /admin/contracts/:id/pdf     — download
 *
 * 3. Templates (superadmin):
 *      GET    /admin/contract-templates                — list all
 *      GET    /admin/contract-templates/:id            — fetch with versions
 *      POST   /admin/contract-templates                — create
 *      PATCH  /admin/contract-templates/:id            — update name/description/active
 *      POST   /admin/contract-templates/:id/versions   — publish a new version
 */
import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import prisma from '../config/postgres.js';
import { logAudit } from '../services/auditService.js';
import { renderContract, buildFullHtmlDocument } from '../services/contractRender.js';
import { generateContractPdf } from '../services/contractPdf.js';
import { sendContractReady, sendContractActivated } from '../services/notifications/email.js';

// ── Helpers ───────────────────────────────────────────────────────────
function genSigningToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function isSuperadmin(req: Request): boolean {
  return req.user?.role === 'superadmin';
}

async function logEvent(contractId: string, eventType: string, req: Request | null, meta?: Record<string, any>) {
  try {
    await prisma.contractEvent.create({
      data: {
        contractId,
        eventType,
        actorId: req?.user?.id ?? null,
        actorRole: req?.user?.role === 'superadmin' ? 'admin' : (req?.user ? 'vendor' : 'system'),
        ipAddress: req?.ip ?? null,
        userAgent: req?.headers?.['user-agent'] as string ?? null,
        meta: meta ?? undefined,
      },
    });
  } catch (err) {
    console.warn('[contract] event log failed:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────
// ADMIN — Templates
// ─────────────────────────────────────────────────────────────────────

export const adminListTemplates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const templates = await prisma.contractTemplate.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: { id: true, versionNumber: true, status: true, publishedAt: true, changeNotes: true },
        },
      },
    });
    res.json({ templates });
  } catch (err) { next(err); }
};

export const adminGetTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const template = await prisma.contractTemplate.findUnique({
      where: { id: req.params.id },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
        },
      },
    });
    if (!template) { res.status(404).json({ error: 'Template not found.' }); return; }
    res.json({ template });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────
// ADMIN — Contracts
// ─────────────────────────────────────────────────────────────────────

const ALLOWED_STATUSES = ['draft', 'sent', 'viewed', 'signed', 'countersigned', 'cancelled', 'expired'];

export const adminListContracts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const where = status && ALLOWED_STATUSES.includes(status) ? { status } : {};
    const contracts = await prisma.contract.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      include: {
        user: { select: { id: true, name: true, email: true, status: true } },
        template: { select: { id: true, name: true } },
      },
    });
    const counts = await prisma.contract.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const countsByStatus: Record<string, number> = {};
    for (const c of counts) countsByStatus[c.status] = c._count._all;
    res.json({ contracts, countsByStatus });
  } catch (err) { next(err); }
};

export const adminGetContract = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, status: true, onboardingSubmitted: true, contractSigned: true, vendorApproved: true } },
        template: { select: { id: true, name: true, slug: true } },
        templateVersion: { select: { id: true, versionNumber: true, mergeFields: true } },
        events: { orderBy: { createdAt: 'desc' } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!contract) { res.status(404).json({ error: 'Contract not found.' }); return; }

    // Render the body HTML for admin preview (without signature placeholders).
    const renderedHtml = renderContract(
      contract.bodyHtmlSnapshot,
      contract.templateVersion?.mergeFields as any ?? {},
      contract.mergeValues as any,
      { withSignature: false },
    );

    res.json({ contract, renderedHtml });
  } catch (err) { next(err); }
};

export const adminCreateContract = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }

    const { vendorOnboardingId, userId, templateId, mergeValues } = req.body as {
      vendorOnboardingId?: string;
      userId?: string;
      templateId?: string;
      mergeValues?: Record<string, any>;
    };

    if (!userId) { res.status(400).json({ error: 'userId is required.' }); return; }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) { res.status(404).json({ error: 'User not found.' }); return; }

    // Resolve template — default if none specified.
    const template = templateId
      ? await prisma.contractTemplate.findUnique({ where: { id: templateId } })
      : await prisma.contractTemplate.findFirst({ where: { isDefault: true, active: true } });
    if (!template) { res.status(400).json({ error: 'No active default template found. Run seedContractTemplates.' }); return; }

    // Most recent published version of the template.
    const tv = await prisma.contractTemplateVersion.findFirst({
      where: { templateId: template.id, status: 'published' },
      orderBy: { versionNumber: 'desc' },
    });
    if (!tv) { res.status(400).json({ error: 'Template has no published version.' }); return; }

    const signingToken = genSigningToken();

    const contract = await prisma.contract.create({
      data: {
        vendorOnboardingId: vendorOnboardingId ?? null,
        userId,
        templateId: template.id,
        templateVersionId: tv.id,
        bodyHtmlSnapshot: tv.bodyHtml,
        mergeValues: mergeValues ?? {},
        status: 'draft',
        signingToken,
        createdById: req.user!.id,
      },
    });

    await logEvent(contract.id, 'generated', req, { templateVersion: tv.versionNumber });
    await logAudit(req, 'create', 'contract', contract.id, { templateId: template.id, version: tv.versionNumber, userId });

    res.status(201).json({ contract });
  } catch (err) { next(err); }
};

export const adminUpdateContract = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const existing = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Contract not found.' }); return; }
    if (!['draft', 'sent', 'viewed'].includes(existing.status)) {
      res.status(409).json({ error: `Cannot edit contract in status '${existing.status}'.` });
      return;
    }
    const { mergeValues } = req.body as { mergeValues?: Record<string, any> };
    if (!mergeValues || typeof mergeValues !== 'object') {
      res.status(400).json({ error: 'mergeValues is required.' });
      return;
    }
    const contract = await prisma.contract.update({
      where: { id: req.params.id },
      data: { mergeValues },
    });
    await logEvent(contract.id, 'draft_updated', req);
    res.json({ contract });
  } catch (err) { next(err); }
};

export const adminSendContract = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const existing = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: { user: true, template: true },
    });
    if (!existing) { res.status(404).json({ error: 'Contract not found.' }); return; }
    if (existing.status !== 'draft') {
      res.status(409).json({ error: `Cannot send a contract in status '${existing.status}'.` });
      return;
    }
    const contract = await prisma.contract.update({
      where: { id: req.params.id },
      data: { status: 'sent', sentAt: new Date() },
    });
    await logEvent(contract.id, 'sent', req, { recipientEmail: existing.user.email });

    // Send the "contract ready to sign" email. Best-effort — failures don't
    // block the status flip; the admin can use the Resend button afterwards.
    const emailSent = await sendContractReady(existing.user.email, {
      signerName: existing.user.name,
      templateName: existing.template?.name || 'Merchant Services Agreement',
      contractId: contract.id,
      signingToken: contract.signingToken,
      generatedByName: req.user?.name ?? null,
    });
    await logEvent(contract.id, emailSent ? 'email_sent' : 'email_failed', req, {
      recipientEmail: existing.user.email,
      transport: 'smtp',
    });

    res.json({ contract, emailSent });
  } catch (err) { next(err); }
};

/**
 * Resend the "contract ready" email without changing status. Useful when the
 * first send went to spam, or when the vendor lost the link.
 * Allowed for status in {sent, viewed} — once signed/cancelled there's no
 * point re-sending. Generates a fresh `email_resent` audit event.
 */
export const adminResendContract = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const existing = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: { user: true, template: true },
    });
    if (!existing) { res.status(404).json({ error: 'Contract not found.' }); return; }
    if (!['sent', 'viewed'].includes(existing.status)) {
      res.status(409).json({ error: `Cannot resend a contract in status '${existing.status}'.` });
      return;
    }
    const emailSent = await sendContractReady(existing.user.email, {
      signerName: existing.user.name,
      templateName: existing.template?.name || 'Merchant Services Agreement',
      contractId: existing.id,
      signingToken: existing.signingToken,
      generatedByName: req.user?.name ?? null,
    });
    await logEvent(existing.id, emailSent ? 'email_resent' : 'email_failed', req, {
      recipientEmail: existing.user.email,
      manual: true,
    });
    res.json({ emailSent, recipientEmail: existing.user.email });
  } catch (err) { next(err); }
};

export const adminCancelContract = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const { reason } = req.body as { reason?: string };
    const existing = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Contract not found.' }); return; }
    if (['signed', 'countersigned', 'cancelled'].includes(existing.status)) {
      res.status(409).json({ error: `Cannot cancel contract in status '${existing.status}'.` });
      return;
    }
    const contract = await prisma.contract.update({
      where: { id: req.params.id },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason || null },
    });
    await logEvent(contract.id, 'cancelled', req, { reason: reason || null });
    res.json({ contract });
  } catch (err) { next(err); }
};

/**
 * Approve & Activate — final admin step. Flips user.vendorApproved=true,
 * stores the assigned PricingTier, and counter-signs the contract.
 */
export const adminActivateContract = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const { pricingTierId } = req.body as { pricingTierId?: string };

    const existing = await prisma.contract.findUnique({ where: { id: req.params.id }, include: { user: true } });
    if (!existing) { res.status(404).json({ error: 'Contract not found.' }); return; }
    if (existing.status !== 'signed') {
      res.status(409).json({ error: `Contract must be 'signed' to activate (currently '${existing.status}').` });
      return;
    }

    // Validate the pricing tier (allowed to be null for trial / custom).
    if (pricingTierId) {
      const tier = await prisma.pricingTier.findUnique({ where: { id: pricingTierId } });
      if (!tier || !tier.active) { res.status(400).json({ error: 'Invalid pricing tier.' }); return; }
    }

    // S77 Phase 2 — On activation we ALSO:
    //   • Promote role 'staff' → 'owner' so they have permissions for their
    //     forthcoming organisation. Without this, they land on the portal
    //     with `staff` perms (which lack dashboard.view) and get locked out.
    //   • Detach from the placeholder "Default" org by setting orgId=null,
    //     forcing them through the existing /onboarding wizard which creates
    //     their real organisation via POST /api/tenants.
    // The placeholder default org is identified by slug='default'.
    const placeholderOrg = await prisma.organization.findFirst({ where: { slug: 'default' } });
    const isOnPlaceholder = placeholderOrg && existing.user.orgId === placeholderOrg.id;

    const [contract] = await prisma.$transaction([
      prisma.contract.update({
        where: { id: req.params.id },
        data: {
          status: 'countersigned',
          assignedPricingTierId: pricingTierId ?? null,
          activatedAt: new Date(),
          activatedById: req.user!.id,
        },
      }),
      prisma.user.update({
        where: { id: existing.userId },
        data: {
          status: 'active',
          contractSigned: true,
          vendorApproved: true,
          // Promote to owner — they're the merchant who'll own their org.
          role: existing.user.role === 'staff' ? 'owner' : existing.user.role,
          // Clear placeholder org so the existing /onboarding wizard runs.
          ...(isOnPlaceholder ? { orgId: null } : {}),
        },
      }),
      // Mirror the activation to the related VendorOnboarding row if present
      ...(existing.vendorOnboardingId
        ? [prisma.vendorOnboarding.update({
            where: { id: existing.vendorOnboardingId },
            data: { status: 'approved', suggestedPricingTierId: pricingTierId ?? null },
          })]
        : []),
    ]);

    await logEvent(contract.id, 'activated', req, { pricingTierId: pricingTierId ?? null });
    await logAudit(req, 'activate', 'contract', contract.id, { pricingTierId, userId: existing.userId });

    // Notify the vendor that their account is live (best-effort).
    let pricingTierName: string | null = null;
    if (pricingTierId) {
      const tier = await prisma.pricingTier.findUnique({ where: { id: pricingTierId }, select: { name: true } });
      pricingTierName = tier?.name ?? null;
    }
    const emailSent = await sendContractActivated(existing.user.email, {
      signerName: existing.user.name,
      pricingTierName,
    });
    await logEvent(contract.id, emailSent ? 'activation_email_sent' : 'activation_email_failed', req);

    res.json({ contract, emailSent });
  } catch (err) { next(err); }
};

export const adminDownloadPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!contract || !contract.signedPdfPath) {
      res.status(404).json({ error: 'Signed PDF not available.' });
      return;
    }
    await logEvent(contract.id, 'downloaded', req);
    res.download(contract.signedPdfPath, `contract-${contract.id}.pdf`);
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────
// VENDOR — own contracts
// ─────────────────────────────────────────────────────────────────────

export const vendorListMyContracts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Not authorized.' }); return; }
    const contracts = await prisma.contract.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, status: true, sentAt: true, signedAt: true, createdAt: true,
        signingToken: true, // OK to expose to the assigned vendor
        template: { select: { name: true } },
      },
    });
    res.json({ contracts });
  } catch (err) { next(err); }
};

export const vendorGetMyContract = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Not authorized.' }); return; }

    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: {
        template: { select: { id: true, name: true, slug: true } },
        templateVersion: { select: { id: true, versionNumber: true, mergeFields: true } },
      },
    });
    if (!contract) { res.status(404).json({ error: 'Contract not found.' }); return; }
    if (contract.userId !== userId) { res.status(403).json({ error: 'Not your contract.' }); return; }

    // Token check — if a token is provided in the query string it must match.
    const tokenInQuery = typeof req.query.token === 'string' ? req.query.token : null;
    if (tokenInQuery && tokenInQuery !== contract.signingToken) {
      res.status(403).json({ error: 'Invalid signing token.' });
      return;
    }

    // Render the body for display (no signature substitution yet).
    const renderedHtml = renderContract(
      contract.bodyHtmlSnapshot,
      contract.templateVersion?.mergeFields as any ?? {},
      contract.mergeValues as any,
      { withSignature: false },
    );

    // First-view tracking.
    if (contract.status === 'sent' && !contract.viewedAt) {
      await prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'viewed', viewedAt: new Date() },
      });
      await logEvent(contract.id, 'viewed', req);
      contract.status = 'viewed';
      contract.viewedAt = new Date();
    } else if (['sent', 'viewed'].includes(contract.status)) {
      await logEvent(contract.id, 'viewed', req);
    }

    res.json({ contract, renderedHtml });
  } catch (err) { next(err); }
};

export const vendorSignMyContract = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Not authorized.' }); return; }

    const {
      signerName, signerTitle, signerEmail, signatureDataUrl,
      bankName, bankRoutingLast4, bankAccountLast4,
    } = req.body as {
      signerName?: string;
      signerTitle?: string;
      signerEmail?: string;
      signatureDataUrl?: string;
      bankName?: string;
      bankRoutingLast4?: string;
      bankAccountLast4?: string;
    };

    if (!signerName || signerName.trim().length < 2) { res.status(400).json({ error: 'Signer name is required.' }); return; }
    if (!signatureDataUrl || !signatureDataUrl.startsWith('data:image/')) { res.status(400).json({ error: 'Signature image is required.' }); return; }
    if (signatureDataUrl.length > 1_500_000) { res.status(400).json({ error: 'Signature image too large.' }); return; }

    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: {
        templateVersion: { select: { mergeFields: true } },
      },
    });
    if (!contract) { res.status(404).json({ error: 'Contract not found.' }); return; }
    if (contract.userId !== userId) { res.status(403).json({ error: 'Not your contract.' }); return; }
    if (!['sent', 'viewed'].includes(contract.status)) {
      res.status(409).json({ error: `Cannot sign a contract in status '${contract.status}'.` });
      return;
    }

    const signedAt = new Date();
    const signerIp = req.ip ?? null;
    const signerUa = (req.headers['user-agent'] as string) ?? null;

    // Merge bank info into mergeValues so it shows on the rendered/PDF copy.
    const updatedMergeValues = {
      ...(contract.mergeValues as any || {}),
      bank: {
        name: bankName || null,
        routingLast4: bankRoutingLast4 || null,
        accountLast4: bankAccountLast4 || null,
      },
      signature: {
        signerName,
        signerTitle: signerTitle || '',
        signerEmail: signerEmail || '',
        signedAt: signedAt.toISOString(),
        signerIp,
        imageHtml: `<img src="${signatureDataUrl}" alt="Signature" style="max-height: 56px; max-width: 280px;" />`,
      },
    };

    // ── Critical path: persist the signature ───────────────────────────
    // Anything below this point is best-effort and runs after we respond.
    // The legal record (signedAt + signerName + signatureDataUrl) is now
    // persisted; the vendor sees success regardless of PDF / email hiccups.
    const updated = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        status: 'signed',
        signedAt,
        signerName,
        signerTitle: signerTitle || null,
        signerEmail: signerEmail || null,
        signatureDataUrl,
        signerIp,
        signerUserAgent: signerUa,
        mergeValues: updatedMergeValues,
      },
    });

    // Log the signed event immediately so the audit trail is correct
    // regardless of what fails afterwards.
    await logEvent(updated.id, 'signed', req, { signerName });
    await logAudit(req, 'sign', 'contract', updated.id, { signerName });

    // Respond NOW — vendor sees instant success.
    res.json({ contract: updated });

    // ── Background tasks (won't affect response) ───────────────────────
    // Wrapped in setImmediate so any uncaught error doesn't take the request
    // down with it. Each step has its own try/catch and logs to ContractEvent.
    setImmediate(async () => {
      // 1) Flip the user-side flag.
      try {
        await prisma.user.update({ where: { id: userId }, data: { contractSigned: true } });
      } catch (err: any) {
        console.warn('[contract] user.contractSigned update failed:', err?.message);
        await logEvent(updated.id, 'post_sign_user_update_failed', null, { error: String(err?.message ?? err) });
      }

      // 2) Mirror to onboarding status.
      if (contract.vendorOnboardingId) {
        try {
          await prisma.vendorOnboarding.update({
            where: { id: contract.vendorOnboardingId },
            data: { status: 'contract_signed' },
          });
        } catch (err: any) {
          console.warn('[contract] onboarding status update failed:', err?.message);
          await logEvent(updated.id, 'post_sign_onboarding_update_failed', null, { error: String(err?.message ?? err) });
        }
      }

      // 3) Generate PDF — slowest step, hence backgrounded.
      try {
        const renderedHtml = renderContract(
          updated.bodyHtmlSnapshot,
          contract.templateVersion?.mergeFields as any ?? {},
          updatedMergeValues,
          { withSignature: true },
        );
        const fullDoc = buildFullHtmlDocument(renderedHtml);
        const pdf = await generateContractPdf(updated.id, fullDoc);
        await prisma.contract.update({ where: { id: updated.id }, data: { signedPdfPath: pdf.filePath } });
        await logEvent(updated.id, 'pdf_generated', null, { path: pdf.filePath, size: pdf.size });
      } catch (err: any) {
        console.error('[contract] PDF generation failed:', err?.message);
        await logEvent(updated.id, 'pdf_failed', null, { error: String(err?.message ?? err) });
      }
    });
  } catch (err: any) {
    // Surface the actual error message so the frontend toast is meaningful.
    // Falls through to next() only for truly unexpected exceptions.
    if (!res.headersSent) {
      console.error('[contract] sign failed:', err);
      res.status(500).json({ error: err?.message || 'Failed to record signature.' });
    } else {
      next(err);
    }
  }
};

export const vendorDownloadMyPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Not authorized.' }); return; }
    const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!contract || contract.userId !== userId) { res.status(404).json({ error: 'Contract not found.' }); return; }
    if (!contract.signedPdfPath) { res.status(404).json({ error: 'PDF not yet generated.' }); return; }
    await logEvent(contract.id, 'downloaded', req);
    res.download(contract.signedPdfPath, `contract-${contract.id}.pdf`);
  } catch (err) { next(err); }
};
