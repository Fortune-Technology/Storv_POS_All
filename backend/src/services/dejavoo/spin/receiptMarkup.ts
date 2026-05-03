/**
 * Dejavoo SPIn — printer-markup builders for branded receipts and customer
 * messages.
 *
 * These return Dejavoo's printer-markup strings (the value that goes into the
 * `Printer` field of POST /v2/Common/Printer). The markup is a tag-based
 * format documented in the SPIn spec — supported tags:
 *
 *   <L>...</L>     left-aligned line
 *   <C>...</C>     centered line
 *   <R>...</R>     right-aligned line
 *   <LG>...</LG>   large text wrapper (~ double height)
 *   <B>...</B>     bold text wrapper
 *   <INV>...</INV> inverted (white-on-black) wrapper
 *   <CD>...</CD>   condensed text wrapper
 *   <BR/>          line break
 *   <IMG>b64</IMG> PNG image, base64-encoded (no data: prefix)
 *   <QR>text</QR>  QR code containing text
 *
 * Wrappers nest: `<LG><B><L>Big bold left</L></B></LG>`.
 *
 * Each builder produces a self-contained markup string ready to drop into
 * `pushReceipt()` from `customerDisplay.ts`. Splitting these out keeps the
 * service module thin (HTTP only) and lets us unit-test the formatting in
 * isolation.
 */

/** Inputs for the welcome / between-customers banner. */
export interface WelcomeOpts {
  /** Store display name — center of the banner. Required. */
  storeName: string;
  /** Optional second line: store address or marketing tagline. */
  subtitle?: string;
  /** Optional QR code payload (e.g. loyalty signup URL). */
  qrUrl?: string;
}

/** Inputs for the post-sale thank-you receipt. */
export interface ThankYouOpts {
  storeName: string;
  /** Customer first name from the attached profile, or generic if missing. */
  customerName?: string;
  /** Total amount of the completed sale (display only). */
  total?: number;
  /** Last 4 of the card used (display only). */
  lastFour?: string;
  /** Auth code from processor (display only — not the receipt of record). */
  authCode?: string;
  /** Optional URL for return policy / receipt link / loyalty signup. */
  qrUrl?: string;
  /** Optional address line — printed under the storeName. */
  address?: string;
  /** Optional phone line. */
  phone?: string;
}

/** Inputs for a full branded transaction receipt. */
export interface BrandedReceiptOpts {
  storeName: string;
  address?: string;
  phone?: string;
  /** Header line: tx number / date / cashier — printed above items. */
  header?: string;
  items: Array<{ name: string; qty: number; price: number; lineTotal: number }>;
  totals: {
    subtotal?: number;
    tax?: number;
    deposit?: number;
    grandTotal: number;
  };
  payment?: {
    method?: string;       // 'CARD' | 'CASH' | etc.
    lastFour?: string;
    authCode?: string;
    cardType?: string;
  };
  qrUrl?: string;
  /** Footer marketing copy (e.g. "Save 10% — sign up at..."). */
  footerMessage?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format a dollar amount as right-aligned `$N.NN`. */
const fmt$ = (n: number | undefined | null): string => {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  const v = Number(n);
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
};

/**
 * Escape characters that might confuse Dejavoo's tag parser.
 * `<` / `>` / `&` could collide with the markup tags, so we replace any
 * literal angle brackets in user-supplied content with safe Unicode
 * lookalikes. Keeps store names like "Fish & Chips" + "<Welcome>" safe.
 */
const safe = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '‹') // single left-pointing angle quotation
    .replace(/>/g, '›') // single right-pointing angle quotation
    .replace(/\s+/g, ' ')
    .trim();

/** Center text within paper width — receipt printers wrap automatically
 *  but the `<C>` tag handles centering for us; we just truncate. */
const clip = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, max - 1) + '…';

// ── Public builders ──────────────────────────────────────────────────────────

/**
 * Welcome banner — prints when the terminal is idle between customers.
 *
 * Used by the cashier-app to push a branded message after a sale completes,
 * so the customer sees "Welcome to <store>!" on the receipt printer rather
 * than a stale prior receipt.
 */
export function buildWelcomeMarkup(opts: WelcomeOpts): string {
  const lines: string[] = [];
  lines.push('<C><LG><B>Welcome!</B></LG></C>');
  lines.push('<BR/>');
  lines.push(`<C><LG>${safe(clip(opts.storeName, 32))}</LG></C>`);
  if (opts.subtitle) {
    lines.push(`<C>${safe(clip(opts.subtitle, 40))}</C>`);
  }
  lines.push('<BR/>');
  if (opts.qrUrl) {
    lines.push(`<C><QR>${safe(opts.qrUrl)}</QR></C>`);
    lines.push('<BR/>');
  }
  lines.push('<C><CD>Have a great day</CD></C>');
  lines.push('<BR/><BR/>');
  return lines.join('');
}

/**
 * Thank-you message — short, prints right after a sale completes.
 *
 * For long branded receipts use `buildBrandedReceiptMarkup` instead. This
 * is the lightweight version meant for the always-visible printer line
 * after the official receipt has already been printed (or when receipt
 * printing is disabled and we just want to acknowledge the customer).
 */
export function buildThankYouMarkup(opts: ThankYouOpts): string {
  const lines: string[] = [];
  lines.push(`<C><LG><B>Thank You${opts.customerName ? `, ${safe(clip(opts.customerName, 14))}` : ''}!</B></LG></C>`);
  lines.push('<BR/>');
  lines.push(`<C>${safe(clip(opts.storeName, 32))}</C>`);
  if (opts.address) lines.push(`<C><CD>${safe(clip(opts.address, 40))}</CD></C>`);
  if (opts.phone)   lines.push(`<C><CD>${safe(opts.phone)}</CD></C>`);
  lines.push('<BR/>');
  if (opts.total != null) {
    lines.push(`<C><B>Sale: ${fmt$(opts.total)}</B></C>`);
  }
  if (opts.lastFour) {
    lines.push(`<C><CD>Card ending in ${safe(opts.lastFour)}</CD></C>`);
  }
  if (opts.authCode) {
    lines.push(`<C><CD>Auth: ${safe(opts.authCode)}</CD></C>`);
  }
  lines.push('<BR/>');
  if (opts.qrUrl) {
    lines.push('<C><CD>Scan for details:</CD></C>');
    lines.push(`<C><QR>${safe(opts.qrUrl)}</QR></C>`);
    lines.push('<BR/>');
  }
  lines.push('<C><B>Please come again</B></C>');
  lines.push('<BR/><BR/><BR/>');
  return lines.join('');
}

/**
 * Full branded transaction receipt — store header, item list, totals,
 * payment summary, optional QR + footer.
 *
 * Optional alternative to the cashier-app's own receipt printer (QZ Tray /
 * network printing). When the merchant uses the P17's built-in printer as
 * the primary receipt printer, this is what gets called after a sale.
 */
export function buildBrandedReceiptMarkup(opts: BrandedReceiptOpts): string {
  const lines: string[] = [];

  // Header
  lines.push(`<C><LG><B>${safe(clip(opts.storeName, 32))}</B></LG></C>`);
  if (opts.address) lines.push(`<C><CD>${safe(clip(opts.address, 40))}</CD></C>`);
  if (opts.phone)   lines.push(`<C><CD>${safe(opts.phone)}</CD></C>`);
  if (opts.header)  lines.push(`<C><CD>${safe(clip(opts.header, 40))}</CD></C>`);
  lines.push('<L>--------------------------------</L>');

  // Items
  for (const it of (opts.items || [])) {
    const name = safe(clip(it.name, 32));
    const qty  = Number(it.qty || 1);
    const lineTotal = Number(it.lineTotal || (it.price * qty) || 0);
    if (qty !== 1) {
      const unitPrice = Number(it.price || 0);
      lines.push(`<L>${name}</L>`);
      lines.push(`<L>  ${qty} x ${fmt$(unitPrice)}</L><R>${fmt$(lineTotal)}</R>`);
    } else {
      lines.push(`<L>${name}</L><R>${fmt$(lineTotal)}</R>`);
    }
  }
  lines.push('<L>--------------------------------</L>');

  // Totals
  if (opts.totals.subtotal != null) {
    lines.push(`<L>Subtotal</L><R>${fmt$(opts.totals.subtotal)}</R>`);
  }
  if (opts.totals.tax != null && opts.totals.tax > 0) {
    lines.push(`<L>Tax</L><R>${fmt$(opts.totals.tax)}</R>`);
  }
  if (opts.totals.deposit != null && opts.totals.deposit > 0) {
    lines.push(`<L>Deposit</L><R>${fmt$(opts.totals.deposit)}</R>`);
  }
  lines.push(`<LG><B><L>TOTAL</L><R>${fmt$(opts.totals.grandTotal)}</R></B></LG>`);

  // Payment
  if (opts.payment) {
    lines.push('<BR/>');
    const method = safe(opts.payment.method || 'PAYMENT');
    if (opts.payment.lastFour) {
      lines.push(`<L>${method} ending ${safe(opts.payment.lastFour)}</L>`);
    } else {
      lines.push(`<L>${method}</L>`);
    }
    if (opts.payment.cardType) lines.push(`<L>${safe(opts.payment.cardType)}</L>`);
    if (opts.payment.authCode) lines.push(`<L>Auth: ${safe(opts.payment.authCode)}</L>`);
  }

  // Footer
  lines.push('<BR/>');
  lines.push(`<C><B>Thank you for shopping at</B></C>`);
  lines.push(`<C><B>${safe(clip(opts.storeName, 32))}!</B></C>`);
  if (opts.footerMessage) {
    lines.push(`<C><CD>${safe(clip(opts.footerMessage, 80))}</CD></C>`);
  }
  if (opts.qrUrl) {
    lines.push('<BR/>');
    lines.push(`<C><QR>${safe(opts.qrUrl)}</QR></C>`);
  }
  lines.push('<BR/><BR/><BR/>');
  return lines.join('');
}
