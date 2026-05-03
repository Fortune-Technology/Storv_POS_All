/**
 * POS SPIn — customer-facing display handlers.
 *
 * Three endpoints powering the "show line items + branded messages on the
 * customer-facing terminal screen" feature:
 *
 *   POST /api/payment/dejavoo/display/cart    — push live cart updates
 *   POST /api/payment/dejavoo/display/welcome — branded between-customer banner
 *   POST /api/payment/dejavoo/display/thank-you — post-sale acknowledgement
 *   POST /api/payment/dejavoo/display/clear    — reset display to empty
 *
 * Why split from the existing /sale + /lookup-customer routes?
 *   These are cosmetic UX features — they push display state, not money.
 *   Failures here must never block a sale. Keeping them on their own route
 *   prefix (/display/) makes that boundary obvious and lets the cashier-app
 *   handle their network errors with `.catch(() => {})` patterns.
 *
 * All handlers swallow downstream Dejavoo failures so the cashier-app gets
 * a 200 with `{ success: false, message: ... }` rather than a 500. The
 * cashier-app already treats display calls as fire-and-forget; this just
 * makes the contract explicit.
 */
import type { Request, Response } from 'express';
import {
  loadMerchantByStation,
  pushDisplayCart,
  pushDisplayReceipt,
  clearDisplayCart,
} from '../../../services/paymentProviderFactory.js';
import {
  buildWelcomeMarkup,
  buildThankYouMarkup,
  buildBrandedReceiptMarkup,
  type DejavooCart,
} from '../../../services/dejavoo/spin/index.js';
import prisma from '../../../config/postgres.js';

// ── Shared helpers ───────────────────────────────────────────────────────────

interface DisplayBody {
  stationId?: string;
}

/**
 * Resolve the active store name from a stationId via the existing
 * Station → Store relation. Used to inject `<Store_Name>` into welcome
 * and thank-you messages without forcing the cashier-app to send it.
 *
 * Returns the trimmed display name, or 'Our Store' as a safe fallback
 * so receipts never print blank.
 */
async function resolveStoreContext(stationId: string): Promise<{
  storeName: string;
  address?: string;
  phone?: string;
}> {
  try {
    const station = await prisma.station.findUnique({
      where: { id: stationId },
      include: {
        store: {
          select: { name: true, address: true, phone: true },
        },
      },
    });
    const store = station?.store;
    return {
      storeName: (store?.name?.trim()) || 'Our Store',
      address:   store?.address?.trim() || undefined,
      phone:     store?.phone?.trim()   || undefined,
    };
  } catch {
    return { storeName: 'Our Store' };
  }
}

// ── Cart push ────────────────────────────────────────────────────────────────

interface DisplayCartBody extends DisplayBody {
  cart?: DejavooCart;
}

/**
 * POST /api/payment/dejavoo/display/cart
 *
 * Push live cart updates to the customer-facing terminal screen so the
 * customer sees items as they're scanned. Cashier-app debounces these
 * calls — typically one push per cart change with a 500ms debounce.
 *
 * Body:
 *   { stationId, cart: { Items, Amounts, CashPrices } }
 *
 * Response:
 *   { success: bool, message: string }
 *
 * Always 200 — display failures don't bubble. Check `success` for status.
 */
export const dejavooPushCart = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stationId, cart } = req.body as DisplayCartBody;
    if (!stationId) {
      res.status(400).json({ success: false, error: 'stationId is required' });
      return;
    }
    if (!cart || typeof cart !== 'object') {
      res.status(400).json({ success: false, error: 'cart object is required' });
      return;
    }

    const { merchant } = await loadMerchantByStation(stationId);
    const result = await pushDisplayCart(merchant, cart);
    res.json({
      success:    !!result.success,
      message:    result.message,
      statusCode: result.statusCode,
      resultCode: result.resultCode,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.warn('[dejavooPushCart]', e.message || err);
    // Display failures stay 200 — caller is fire-and-forget.
    res.json({
      success: false,
      message: e.message || 'Display push failed',
    });
  }
};

// ── Welcome banner ───────────────────────────────────────────────────────────

interface DisplayWelcomeBody extends DisplayBody {
  /** Override the default subtitle (else "Thank you for stopping by"). */
  subtitle?: string;
  /** Optional QR payload — e.g. loyalty signup URL. */
  qrUrl?: string;
}

/**
 * POST /api/payment/dejavoo/display/welcome
 *
 * Print a branded welcome banner on the terminal's printer between
 * customers. Backend automatically pulls the store name from the
 * cashier's station so the cashier-app doesn't need to send it.
 */
export const dejavooPushWelcome = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stationId, subtitle, qrUrl } = req.body as DisplayWelcomeBody;
    if (!stationId) {
      res.status(400).json({ success: false, error: 'stationId is required' });
      return;
    }

    const { merchant } = await loadMerchantByStation(stationId);
    const ctx = await resolveStoreContext(stationId);

    const markup = buildWelcomeMarkup({
      storeName: ctx.storeName,
      subtitle:  subtitle || ctx.address || undefined,
      qrUrl,
    });

    const result = await pushDisplayReceipt(merchant, markup);
    res.json({
      success:    !!result.success,
      message:    result.message,
      storeName:  ctx.storeName,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.warn('[dejavooPushWelcome]', e.message || err);
    res.json({ success: false, message: e.message || 'Welcome push failed' });
  }
};

// ── Thank-you message ────────────────────────────────────────────────────────

interface DisplayThankYouBody extends DisplayBody {
  customerName?: string;
  total?: number;
  lastFour?: string;
  authCode?: string;
  qrUrl?: string;
}

/**
 * POST /api/payment/dejavoo/display/thank-you
 *
 * Print a "Thank you, <Customer>!" message after a successful sale. Like
 * the welcome banner this resolves the store name server-side.
 */
export const dejavooPushThankYou = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stationId, customerName, total, lastFour, authCode, qrUrl } =
      req.body as DisplayThankYouBody;

    if (!stationId) {
      res.status(400).json({ success: false, error: 'stationId is required' });
      return;
    }

    const { merchant } = await loadMerchantByStation(stationId);
    const ctx = await resolveStoreContext(stationId);

    const markup = buildThankYouMarkup({
      storeName:    ctx.storeName,
      customerName,
      total,
      lastFour,
      authCode,
      qrUrl,
      address:      ctx.address,
      phone:        ctx.phone,
    });

    const result = await pushDisplayReceipt(merchant, markup);
    res.json({
      success: !!result.success,
      message: result.message,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.warn('[dejavooPushThankYou]', e.message || err);
    res.json({ success: false, message: e.message || 'Thank-you push failed' });
  }
};

// ── Full branded receipt ─────────────────────────────────────────────────────

interface DisplayBrandedReceiptBody extends DisplayBody {
  header?: string;
  items: Array<{ name: string; qty: number; price: number; lineTotal: number }>;
  totals: {
    subtotal?: number;
    tax?: number;
    deposit?: number;
    grandTotal: number;
  };
  payment?: {
    method?: string;
    lastFour?: string;
    authCode?: string;
    cardType?: string;
  };
  qrUrl?: string;
  footerMessage?: string;
}

/**
 * POST /api/payment/dejavoo/display/receipt
 *
 * Print a full branded transaction receipt on the terminal printer.
 * Alternative to the cashier-app's own receipt printer (QZ Tray /
 * network) when the merchant uses the P17 as the primary printer.
 */
export const dejavooPushBrandedReceipt = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as DisplayBrandedReceiptBody;
    if (!body.stationId) {
      res.status(400).json({ success: false, error: 'stationId is required' });
      return;
    }
    if (!Array.isArray(body.items) || !body.totals || !Number.isFinite(body.totals.grandTotal)) {
      res.status(400).json({ success: false, error: 'items[] and totals.grandTotal are required' });
      return;
    }

    const { merchant } = await loadMerchantByStation(body.stationId);
    const ctx = await resolveStoreContext(body.stationId);

    const markup = buildBrandedReceiptMarkup({
      storeName:     ctx.storeName,
      address:       ctx.address,
      phone:         ctx.phone,
      header:        body.header,
      items:         body.items,
      totals:        body.totals,
      payment:       body.payment,
      qrUrl:         body.qrUrl,
      footerMessage: body.footerMessage,
    });

    const result = await pushDisplayReceipt(merchant, markup);
    res.json({
      success: !!result.success,
      message: result.message,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.warn('[dejavooPushBrandedReceipt]', e.message || err);
    res.json({ success: false, message: e.message || 'Receipt push failed' });
  }
};

// ── Clear display ────────────────────────────────────────────────────────────

/**
 * POST /api/payment/dejavoo/display/clear
 *
 * Reset the customer-facing display to empty. Called when:
 *   - A transaction completes (after the thank-you message has shown)
 *   - The cart is voided / cleared mid-sale
 *   - Shift closes
 */
export const dejavooClearDisplay = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stationId } = req.body as DisplayBody;
    if (!stationId) {
      res.status(400).json({ success: false, error: 'stationId is required' });
      return;
    }
    const { merchant } = await loadMerchantByStation(stationId);
    const result = await clearDisplayCart(merchant);
    res.json({
      success: !!result.success,
      message: result.message,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.warn('[dejavooClearDisplay]', e.message || err);
    res.json({ success: false, message: e.message || 'Clear-display failed' });
  }
};
