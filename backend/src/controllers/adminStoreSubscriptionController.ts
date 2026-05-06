/**
 * adminStoreSubscriptionController.ts
 *
 * S80 Phase 3b — Superadmin endpoints for per-store subscriptions.
 * Lists every StoreSubscription across all orgs, allows plan/addon updates,
 * status changes, and the test-mode "Mark Paid" action.
 *
 * All endpoints require superadmin (verified at the route level).
 */
import type { Request, Response, NextFunction } from 'express';
import prisma from '../config/postgres.js';
import { generateStoreInvoice, markInvoicePaidTestMode } from '../services/billingService.js';
import { loadInvoiceContext, renderInvoicePdf } from '../services/invoicePdf.js';
import { sendInvoiceEmail } from '../services/notifications/email.js';

function isSuperadmin(req: Request): boolean {
  return req.user?.role === 'superadmin';
}

/* GET /api/admin/store-subscriptions
   Query: ?status=&orgId=&search=&page=&limit= */
export const listStoreSubscriptions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }

    const status = (req.query.status as string) || '';
    const orgId  = (req.query.orgId  as string) || '';
    const search = (req.query.search as string) || '';
    const page   = Math.max(1, parseInt(String(req.query.page  || '1')) || 1);
    const limit  = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50')) || 50));

    const where: any = {};
    if (status) where.status = status;
    if (orgId)  where.orgId = orgId;

    // For text search we filter by store name OR org name. Done as a
    // post-filter since Prisma doesn't expose a single `OR` on related fields
    // with the cleanest API and the data set is small.
    const subs: any[] = await (prisma as any).storeSubscription.findMany({
      where,
      include: {
        store:        { select: { id: true, name: true, isActive: true } },
        organization: { select: { id: true, name: true, slug: true } },
        plan:         { include: { addons: { where: { isActive: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: limit + 1, // peek for hasMore
      skip: (page - 1) * limit,
    });

    const filtered = search
      ? subs.filter((s: any) =>
          (s.store?.name || '').toLowerCase().includes(search.toLowerCase()) ||
          (s.organization?.name || '').toLowerCase().includes(search.toLowerCase()))
      : subs;

    const hasMore = filtered.length > limit;
    const rows = filtered.slice(0, limit).map((s: any) => {
      const purchased: string[] = Array.isArray(s.extraAddons) ? s.extraAddons : [];
      const purchasedAddons = (s.plan?.addons || []).filter((a: any) => purchased.includes(a.key));
      const baseCost = Number(s.basePriceOverride ?? s.plan?.basePrice ?? 0);
      const addonsCost = purchasedAddons.reduce((acc: number, a: any) => acc + Number(a.price || 0), 0);
      return {
        id: s.id,
        storeId: s.storeId,
        storeName: s.store?.name,
        storeActive: !!s.store?.isActive,
        orgId: s.orgId,
        orgName: s.organization?.name,
        orgSlug: s.organization?.slug,
        plan: s.plan ? {
          id: s.plan.id, slug: s.plan.slug, name: s.plan.name,
          basePrice: Number(s.plan.basePrice ?? 0),
        } : null,
        purchasedAddons: purchased,
        availableAddons: (s.plan?.addons || []).map((a: any) => ({
          key: a.key, label: a.label, price: Number(a.price || 0),
        })),
        status: s.status,
        trialEndsAt: s.trialEndsAt,
        currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd,
        registerCount: s.registerCount,
        monthlyTotal: Number((baseCost + addonsCost).toFixed(2)),
        paymentMasked: s.paymentMasked,
        paymentMethod: s.paymentMethod,
        retryCount: s.retryCount || 0,
        nextRetryAt: s.nextRetryAt,
        createdAt: s.createdAt,
      };
    });

    // Approximate total: superadmin filters drive the data, count separately
    const total: number = await (prisma as any).storeSubscription.count({ where });

    res.json({ data: rows, meta: { total, page, limit, hasMore } });
  } catch (err) { next(err); }
};

/* GET /api/admin/store-subscriptions/:id
   Detailed view + invoice list for one StoreSubscription. */
export const getStoreSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }

    const sub: any = await (prisma as any).storeSubscription.findUnique({
      where: { id: req.params.id },
      include: {
        store:        { select: { id: true, name: true, isActive: true, address: true } },
        organization: { select: { id: true, name: true, slug: true } },
        plan:         { include: { addons: { where: { isActive: true } } } },
      },
    });
    if (!sub) { res.status(404).json({ error: 'Subscription not found.' }); return; }

    const invoices: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "invoiceNumber", "periodStart", "periodEnd",
              "baseAmount", "discountAmount", "totalAmount",
              status, "paidAt", "createdAt", notes
         FROM billing_invoices
        WHERE "storeSubscriptionId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 50`,
      sub.id,
    );

    res.json({ subscription: sub, invoices });
  } catch (err) { next(err); }
};

/* PATCH /api/admin/store-subscriptions/:id
   Body: { planId?, status?, basePriceOverride?, registerCount?, extraAddons?,
           trialEndsAt?, currentPeriodEnd?, discountType?, discountValue?,
           discountNote?, discountExpiry? }
   Superadmin can override any field. */
export const updateStoreSubscriptionAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const body = req.body as any;

    const data: any = {};
    const stringFields = ['status', 'discountType', 'discountNote'];
    for (const f of stringFields) if (body[f] !== undefined) data[f] = body[f];
    if (body.planId)             data.planId = body.planId;
    if (body.registerCount != null) data.registerCount = body.registerCount;
    if (body.basePriceOverride !== undefined) data.basePriceOverride = body.basePriceOverride === '' ? null : body.basePriceOverride;
    if (body.discountValue !== undefined)     data.discountValue = body.discountValue === '' ? null : body.discountValue;
    if (body.trialEndsAt !== undefined)       data.trialEndsAt = body.trialEndsAt ? new Date(body.trialEndsAt) : null;
    if (body.currentPeriodEnd !== undefined)  data.currentPeriodEnd = body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : null;
    if (body.discountExpiry !== undefined)    data.discountExpiry = body.discountExpiry ? new Date(body.discountExpiry) : null;
    if (Array.isArray(body.extraAddons))      data.extraAddons = body.extraAddons;

    if (Object.keys(data).length === 0) {
      res.json({ ok: true, unchanged: true });
      return;
    }

    const updated = await (prisma as any).storeSubscription.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ ok: true, subscription: updated });
  } catch (err) { next(err); }
};

/* POST /api/admin/store-subscriptions/:id/generate-invoice
   Generate the next monthly invoice for this store. Idempotent. */
export const adminGenerateStoreInvoice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const result = await generateStoreInvoice(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to generate invoice.' });
  }
};

/* POST /api/admin/billing/invoices/:id/mark-paid-test-mode
   Test-mode payment bypass — flips invoice to paid + sub to active.
   Replaces the still-unimplemented chargeSubscription path during QA. */
export const adminMarkInvoicePaid = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const note = (req.body?.note as string) || '';
    const result = await markInvoicePaidTestMode(req.params.id, note);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to mark invoice paid.' });
  }
};

/* GET /api/admin/billing/invoices/:id/pdf
   Streams the rendered invoice PDF as a download. Same data source as the
   Send Invoice email so both surfaces stay in sync. */
export const adminDownloadInvoicePdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const ctx = await loadInvoiceContext(req.params.id);
    const pdf = await renderInvoicePdf(ctx);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${ctx.invoice.invoiceNumber}.pdf"`);
    res.setHeader('Content-Length', pdf.length.toString());
    res.send(pdf);
  } catch (err: any) {
    if (err?.status === 404) { res.status(404).json({ error: err.message }); return; }
    next(err);
  }
};

/* POST /api/admin/billing/invoices/:id/send
   Renders the same PDF and emails it. Recipients = org billingEmail + every
   `owner` user on the store, deduped. Optional `cc` field on the body
   appends extra addresses (e.g. AP department). */
export const adminSendInvoiceEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isSuperadmin(req)) { res.status(403).json({ error: 'Superadmin only.' }); return; }
    const extraCc: string | string[] | undefined = req.body?.cc;

    const ctx = await loadInvoiceContext(req.params.id);
    const pdf = await renderInvoicePdf(ctx);

    // Resolve recipients. Org billing email is the primary; store owners get cc.
    // Falls back to the user.email of the user that owns the store.
    const recipients = new Set<string>();
    const ccs = new Set<string>();

    if (ctx.org?.billingEmail) recipients.add(String(ctx.org.billingEmail).trim());

    if (ctx.store?.id) {
      const ownerUsers = await prisma.user.findMany({
        where: { stores: { some: { storeId: ctx.store.id } } },
        select: { email: true, role: true },
      });
      for (const u of ownerUsers) {
        if (!u.email) continue;
        // Org billing email is the canonical "to". Owners go on cc.
        if (recipients.size === 0) recipients.add(u.email);
        else ccs.add(u.email);
      }
      // Store-record `ownerId` (S77 era) is also a primary contact.
      if (ctx.store.ownerId) {
        const owner = await prisma.user.findUnique({ where: { id: ctx.store.ownerId }, select: { email: true } });
        if (owner?.email) (recipients.size === 0 ? recipients : ccs).add(owner.email);
      }
    }

    if (recipients.size === 0) {
      res.status(400).json({ error: 'No billing email or store owner email found for this invoice. Set a billing email on the organization or assign an owner to the store.' });
      return;
    }

    // Append admin-supplied cc(s).
    if (extraCc) {
      const list = Array.isArray(extraCc) ? extraCc : [extraCc];
      for (const addr of list) {
        if (typeof addr === 'string' && addr.trim()) ccs.add(addr.trim());
      }
    }

    // Strip any cc addresses that are also primary recipients.
    for (const r of recipients) ccs.delete(r);

    const sent = await sendInvoiceEmail({
      to: [...recipients],
      cc: ccs.size > 0 ? [...ccs] : undefined,
      invoiceNumber: ctx.invoice.invoiceNumber,
      storeName: ctx.store?.name || null,
      orgName: ctx.org?.name || null,
      totalAmount: Number(ctx.invoice.totalAmount ?? 0),
      periodStart: ctx.invoice.periodStart,
      periodEnd: ctx.invoice.periodEnd,
      status: ctx.invoice.status,
      pdfBuffer: pdf,
    });

    res.json({
      ok: sent,
      recipients: [...recipients],
      cc: [...ccs],
      // `sent: false` happens when SMTP isn't configured. The endpoint still
      // returns 200 so the UI can surface a useful "skipped" state to admins.
      message: sent
        ? `Invoice ${ctx.invoice.invoiceNumber} emailed to ${recipients.size} recipient(s).`
        : 'SMTP is not configured — email was not sent. PDF still downloadable via Get Invoice.',
    });
  } catch (err: any) {
    if (err?.status === 404) { res.status(404).json({ error: err.message }); return; }
    next(err);
  }
};
