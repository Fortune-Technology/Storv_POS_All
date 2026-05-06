/**
 * Invoice PDF generator — S81 Phase 1 of the "Get Invoice / Send Invoice" feature.
 *
 * Renders a BillingInvoice as a clean professional PDF using PDFKit (already a
 * dependency, used for contracts + purchase orders elsewhere). The output is a
 * Buffer the caller can stream to an HTTP download OR attach to an email.
 *
 * Source-of-truth shape: pulls all data from Prisma at render time so a single
 * `invoiceId` produces a consistent PDF whether the user clicks Get Invoice in
 * the admin panel or receives it via the Send Invoice email. No formatting
 * drift between the two paths.
 *
 * Layout (single-page A4 unless line items overflow):
 *   1. Branded header — Storeveu wordmark + "INVOICE" badge
 *   2. Meta block — invoice number, billing period, dates, status pill
 *   3. Bill-to + bill-from columns
 *   4. Line item table — base subscription, addons, registers, discount
 *   5. Totals block — subtotal / discount / total / paid
 *   6. Footer — payment status note + reference numbers (if paid)
 */
import PDFDocument from 'pdfkit';
import prisma from '../config/postgres.js';

// Brand palette — keep in sync with the portal's --accent-primary tokens.
const BRAND = {
  primary: '#3d56b5',
  primaryDark: '#324793',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  rowAlt: '#f8fafc',
  paid: '#16a34a',
  pending: '#f59e0b',
  failed: '#dc2626',
};

interface InvoiceContext {
  invoice: any;
  store: any;
  org: any;
  plan: any;
  addons: Array<{ key: string; label: string; price: number }>;
  registerCount: number;
  basePriceOverride: number | null;
  discountNote: string | null;
}

/**
 * Loads the full data graph for a single invoice. Throws if not found.
 * Centralized so the PDF download endpoint and the email-send endpoint
 * read from exactly the same source — invoice content can never diverge.
 */
export async function loadInvoiceContext(invoiceId: string): Promise<InvoiceContext> {
  const invoice = await prisma.billingInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      storeSubscription: {
        include: {
          store: true,
          organization: true,
          plan: { include: { addons: { where: { isActive: true } } } },
        },
      },
      subscription: { // legacy org sub fallback
        include: {
          organization: true,
          plan: { include: { addons: { where: { isActive: true } } } },
        },
      },
    },
  });
  if (!invoice) {
    const err: any = new Error('Invoice not found');
    err.status = 404;
    throw err;
  }

  // S80+ per-store invoices populate storeSubscription. Legacy invoices populate
  // subscription. Normalise to a single shape regardless of which link is set.
  const storeSub = (invoice as any).storeSubscription;
  const orgSub   = (invoice as any).subscription;

  let store: any = null;
  let org: any = null;
  let plan: any = null;
  let addons: Array<{ key: string; label: string; price: number }> = [];
  let registerCount = 1;
  let basePriceOverride: number | null = null;

  if (storeSub) {
    store = storeSub.store;
    org   = storeSub.organization;
    plan  = storeSub.plan;
    registerCount = storeSub.registerCount ?? 1;
    basePriceOverride = storeSub.basePriceOverride ? Number(storeSub.basePriceOverride) : null;
    const purchased: string[] = Array.isArray(storeSub.extraAddons) ? storeSub.extraAddons : [];
    const allAddons = (plan?.addons || []) as Array<{ key: string; label?: string; name?: string; price?: any }>;
    addons = allAddons
      .filter(a => purchased.includes(a.key))
      .map(a => ({ key: a.key, label: a.label || a.name || a.key, price: Number(a.price ?? 0) }));
  } else if (orgSub) {
    org   = (orgSub as any).organization;
    plan  = (orgSub as any).plan;
    // Legacy org subs don't track per-store addons cleanly — render plan only.
  }

  return {
    invoice,
    store,
    org,
    plan,
    addons,
    registerCount,
    basePriceOverride,
    discountNote: storeSub?.discountNote || null,
  };
}

/**
 * Build the invoice PDF and resolve to a Buffer.
 * Caller decides: stream to HTTP (`res.send(buffer)`) or attach to email.
 */
export function renderInvoicePdf(ctx: InvoiceContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 48, info: {
        Title: `Invoice ${ctx.invoice.invoiceNumber}`,
        Author: 'Storeveu',
        Subject: `Subscription invoice for ${ctx.store?.name || ctx.org?.name || 'Customer'}`,
      }});
      const chunks: Buffer[] = [];
      doc.on('data', (c: unknown) => chunks.push(c as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      drawHeader(doc, ctx);
      drawMetaAndParties(doc, ctx);
      const tableEndY = drawLineItems(doc, ctx);
      drawTotals(doc, ctx, tableEndY);
      drawFooter(doc, ctx);

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Layout helpers                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

function drawHeader(doc: any /* PDFDocument — ambient pdfkit.d.ts doesn't expose PDFKit namespace */, _ctx: InvoiceContext) {
  // Brand strip (color block left + wordmark)
  doc.save();
  doc.rect(48, 48, 6, 32).fill(BRAND.primary);
  doc.restore();

  doc.font('Helvetica-Bold').fontSize(22).fillColor(BRAND.text).text('storeveu', 64, 50);
  doc.font('Helvetica').fontSize(9).fillColor(BRAND.muted).text('Modern POS for independent retail', 64, 76);

  // INVOICE badge top-right
  doc.font('Helvetica-Bold').fontSize(28).fillColor(BRAND.primary).text('INVOICE', 380, 48, { width: 167, align: 'right' });

  // Top divider
  doc.moveTo(48, 100).lineTo(547, 100).strokeColor(BRAND.border).lineWidth(1).stroke();
}

function drawMetaAndParties(doc: any /* PDFDocument — ambient pdfkit.d.ts doesn't expose PDFKit namespace */, ctx: InvoiceContext) {
  const { invoice, store, org } = ctx;

  // Meta block (right column)
  const metaX = 380;
  let y = 116;
  const metaRow = (label: string, value: string) => {
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.muted).text(label, metaX, y, { width: 80 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND.text).text(value, metaX + 80, y, { width: 90, align: 'right' });
    y += 16;
  };
  metaRow('Invoice #', invoice.invoiceNumber);
  metaRow('Issued', fmtDate(invoice.createdAt));
  metaRow('Period', `${fmtDate(invoice.periodStart)} – ${fmtDate(invoice.periodEnd)}`);
  if (invoice.paidAt) metaRow('Paid on', fmtDate(invoice.paidAt));

  // Status pill (right-aligned)
  const status = String(invoice.status || 'pending').toLowerCase();
  const pillColor = status === 'paid' ? BRAND.paid : status === 'failed' ? BRAND.failed : BRAND.pending;
  doc.save();
  doc.roundedRect(metaX + 80, y + 4, 90, 18, 9).fill(pillColor);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff').text(status.toUpperCase(), metaX + 80, y + 8, { width: 90, align: 'center' });
  doc.restore();

  // Bill-from / Bill-to (left column)
  let leftY = 116;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND.muted).text('FROM', 48, leftY);
  leftY += 14;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND.text).text('Storeveu Inc.', 48, leftY);
  leftY += 14;
  doc.font('Helvetica').fontSize(9).fillColor(BRAND.muted).text('billing@storeveu.com', 48, leftY);
  leftY += 28;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND.muted).text('BILL TO', 48, leftY);
  leftY += 14;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND.text).text(store?.name || org?.name || 'Customer', 48, leftY);
  leftY += 14;
  if (org?.name && store?.name) {
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.muted).text(org.name, 48, leftY);
    leftY += 12;
  }
  if (store?.address) {
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.muted).text(store.address, 48, leftY, { width: 280 });
    leftY += 14;
  }
  if (org?.billingEmail) {
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.muted).text(org.billingEmail, 48, leftY);
    leftY += 12;
  }

  // Force cursor below both columns before the table draws.
  doc.y = Math.max(y + 32, leftY + 16);
}

interface LineItem { description: string; qty: number; unit: number; total: number; }

function buildLineItems(ctx: InvoiceContext): LineItem[] {
  const { plan, addons, registerCount, basePriceOverride, invoice } = ctx;
  const items: LineItem[] = [];

  const planBase = basePriceOverride !== null
    ? basePriceOverride
    : Number(plan?.basePrice ?? 0);

  if (plan) {
    items.push({
      description: `${plan.name} subscription — base monthly fee${basePriceOverride !== null ? ' (override)' : ''}`,
      qty: 1,
      unit: planBase,
      total: planBase,
    });
  }

  // Per-register surcharge — modeled as separate line when > 1 register.
  if (registerCount > 1) {
    const perRegister = Number(plan?.pricePerRegister ?? 0);
    if (perRegister > 0) {
      const extra = registerCount - (plan?.includedRegisters ?? 1);
      if (extra > 0) {
        items.push({
          description: `Extra registers (${extra} × $${perRegister.toFixed(2)})`,
          qty: extra,
          unit: perRegister,
          total: extra * perRegister,
        });
      }
    }
  }

  for (const a of addons) {
    items.push({ description: `Add-on: ${a.label}`, qty: 1, unit: a.price, total: a.price });
  }

  // Discount as a negative line so the total reconciles.
  const discount = Number(invoice.discountAmount ?? 0);
  if (discount > 0) {
    items.push({ description: 'Promotional discount', qty: 1, unit: -discount, total: -discount });
  }

  // Failsafe — if nothing else, emit one line for the invoice total so the
  // PDF is never empty (legacy org subs without rich plan data).
  if (items.length === 0) {
    items.push({
      description: 'Subscription charge',
      qty: 1,
      unit: Number(invoice.totalAmount ?? 0),
      total: Number(invoice.totalAmount ?? 0),
    });
  }

  return items;
}

function drawLineItems(doc: any /* PDFDocument — ambient pdfkit.d.ts doesn't expose PDFKit namespace */, ctx: InvoiceContext): number {
  const items = buildLineItems(ctx);

  let y = doc.y + 12;
  // Header row
  doc.save();
  doc.rect(48, y, 499, 24).fill(BRAND.primary);
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff');
  doc.text('Description', 56, y + 8, { width: 285 });
  doc.text('Qty',         341, y + 8, { width: 40, align: 'right' });
  doc.text('Unit',        385, y + 8, { width: 70, align: 'right' });
  doc.text('Amount',      459, y + 8, { width: 80, align: 'right' });
  y += 24;

  // Body rows
  doc.font('Helvetica').fontSize(10).fillColor(BRAND.text);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (i % 2 === 0) {
      doc.save();
      doc.rect(48, y, 499, 22).fill(BRAND.rowAlt);
      doc.restore();
    }
    doc.fillColor(BRAND.text)
      .text(item.description, 56, y + 6, { width: 285 })
      .text(String(item.qty), 341, y + 6, { width: 40, align: 'right' })
      .text(money(item.unit),  385, y + 6, { width: 70, align: 'right' })
      .text(money(item.total), 459, y + 6, { width: 80, align: 'right' });
    y += 22;
  }

  // Bottom divider
  doc.moveTo(48, y).lineTo(547, y).strokeColor(BRAND.border).lineWidth(1).stroke();
  return y + 8;
}

function drawTotals(doc: any /* PDFDocument — ambient pdfkit.d.ts doesn't expose PDFKit namespace */, ctx: InvoiceContext, startY: number) {
  const { invoice } = ctx;
  const total = Number(invoice.totalAmount ?? 0);
  const base  = Number(invoice.baseAmount ?? total);
  const discount = Number(invoice.discountAmount ?? 0);

  let y = startY + 8;
  const line = (label: string, value: string, opts: { strong?: boolean; color?: string } = {}) => {
    const labelColor = opts.strong ? BRAND.text : BRAND.muted;
    const valueColor = opts.color || BRAND.text;
    doc.font(opts.strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.strong ? 12 : 10);
    doc.fillColor(labelColor).text(label, 360, y, { width: 100, align: 'right' });
    doc.fillColor(valueColor).text(value, 469, y, { width: 78, align: 'right' });
    y += opts.strong ? 22 : 16;
  };

  line('Subtotal', money(base));
  if (discount > 0) line('Discount', `−${money(discount)}`, { color: BRAND.paid });

  // Strong total bar
  doc.save();
  doc.rect(360, y, 187, 32).fill(BRAND.primary);
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff').text('TOTAL', 368, y + 9, { width: 80 });
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#ffffff').text(money(total), 460, y + 9, { width: 80, align: 'right' });
  y += 40;

  // Paid stamp (when paid)
  if (String(invoice.status).toLowerCase() === 'paid') {
    doc.save();
    doc.roundedRect(360, y, 187, 24, 4).fill('rgba(22,163,74,0.10)' as any).fillColor(BRAND.paid);
    doc.restore();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND.paid).text(`PAID — ${fmtDate(invoice.paidAt)}`, 360, y + 7, { width: 187, align: 'center' });
  }
}

function drawFooter(doc: any /* PDFDocument — ambient pdfkit.d.ts doesn't expose PDFKit namespace */, ctx: InvoiceContext) {
  const footerY = 760;
  doc.moveTo(48, footerY - 8).lineTo(547, footerY - 8).strokeColor(BRAND.border).lineWidth(1).stroke();

  doc.font('Helvetica').fontSize(8).fillColor(BRAND.muted)
    .text(`Questions? Reply to this invoice or email billing@storeveu.com.`, 48, footerY, { width: 499, align: 'center' });
  doc.text(`This invoice was generated automatically by Storeveu — invoice #${ctx.invoice.invoiceNumber}`, 48, footerY + 14, { width: 499, align: 'center' });
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Formatters                                                             */
/* ─────────────────────────────────────────────────────────────────────── */
function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Number(n) || 0).toFixed(2)}`;
}
function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
