/**
 * POS SPIn — money-moving transaction handlers (called from cashier-app).
 *
 *   dejavooSale    POST /api/payment/dejavoo/sale
 *   dejavooRefund  POST /api/payment/dejavoo/refund
 *   dejavooVoid    POST /api/payment/dejavoo/void
 *
 * Each handler:
 *   1. Resolves the merchant from the cashier's stationId
 *   2. Calls the corresponding paymentProviderFactory method
 *   3. Records a PaymentTransaction row regardless of approval
 *   4. Returns `{ success, result, paymentTransactionId }` to the cashier-app
 */

import type { Request, Response } from 'express';
import {
  loadMerchantByStation,
  processSale,
  processRefund,
  processVoid,
} from '../../../services/paymentProviderFactory.js';
import {
  getOrgId,
  getStoreId,
  recordTransaction,
  type ProviderResult,
} from './helpers.js';

interface SaleBody {
  stationId?: string;
  amount?: number | string;
  paymentType?: string;
  invoiceNumber?: string | null;
  posTransactionId?: string | null;
  captureSignature?: boolean;
  // Client-provided referenceId. The cashier-app generates a UUID v4 BEFORE
  // dispatching the sale and passes it here so it can later query Dejavoo's
  // /v2/Payment/Status endpoint by the same id when the HTTP round-trip
  // times out. Without this, a client-side timeout creates an orphaned
  // approved transaction (terminal approved, POS doesn't know). When
  // omitted, backend generates its own (legacy behaviour preserved).
  referenceId?: string;
  // Optional cart payload — itemised cart for customer-facing display on
  // the terminal during the card prompt. Already in Dejavoo's case-correct
  // format (Amounts / Items / CashPrices / etc.) — see Theneo spec
  // POST /v2/Payment/Sale → "Cart" body parameter. The cashier-app builds
  // this from useCartStore items via buildDejavooCart().
  cart?: {
    Amounts?: Array<{ Name: string; Value: number | null }>;
    CashPrices?: Array<{ Name: string; Value: number | null }>;
    Items?: Array<{
      Name: string;
      Price?: number | null;
      UnitPrice?: number | null;
      Quantity?: number | null;
      AdditionalInfo?: string;
      CustomInfos?: Array<{ Name: string; Value: number | null }>;
      Modifiers?: Array<unknown>;
    }>;
  };
}

/** POST /api/payment/dejavoo/sale */
export const dejavooSale = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req) as string;
    const storeId = getStoreId(req);
    const { stationId, amount, paymentType, invoiceNumber, posTransactionId, captureSignature, referenceId, cart } = req.body as SaleBody;

    if (!stationId || !amount) {
      res.status(400).json({ success: false, error: 'stationId and amount are required' });
      return;
    }

    const { merchant, station } = await loadMerchantByStation(stationId);

    const result = await processSale(merchant, {
      amount:           Number(amount),
      paymentType:      paymentType || 'card',
      invoiceNumber:    invoiceNumber || '',
      registerId:       station.name || stationId,
      captureSignature: captureSignature || false,
      ...(referenceId ? { referenceId } : {}),
      // Customer-facing line items shown on the P17 during the card prompt.
      // Already validated to be a plain object by the SaleBody type — pass
      // through verbatim. SPIn's Sale endpoint accepts this as an optional
      // `Cart` param; when missing the prompt just shows the total amount.
      ...(cart && typeof cart === 'object' ? { cart } : {}),
    } as Parameters<typeof processSale>[1]) as ProviderResult;

    // Always record — approved or declined. Audit trail.
    const txRecord = await recordTransaction(orgId, storeId || merchant.storeId, merchant.id, result, {
      type: 'sale',
      amount: Number(amount),
      invoiceNumber,
      posTransactionId,
    });

    res.json({
      success:              !!result.approved,
      result,
      paymentTransactionId: txRecord?.id || null,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooSale]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};

interface RefundBody {
  stationId?: string;
  amount?: number | string;
  paymentType?: string;
  originalReferenceId?: string | null;
  invoiceNumber?: string | null;
}

/** POST /api/payment/dejavoo/refund */
export const dejavooRefund = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req) as string;
    const storeId = getStoreId(req);
    const { stationId, amount, paymentType, originalReferenceId, invoiceNumber } = req.body as RefundBody;

    if (!stationId || !amount) {
      res.status(400).json({ success: false, error: 'stationId and amount are required' });
      return;
    }

    const { merchant, station } = await loadMerchantByStation(stationId);

    const result = await processRefund(merchant, {
      amount:              Number(amount),
      paymentType:         paymentType || 'card',
      originalReferenceId: originalReferenceId || null,
      invoiceNumber:       invoiceNumber || '',
      registerId:          station.name || stationId,
    } as Parameters<typeof processRefund>[1]) as ProviderResult;

    const txRecord = await recordTransaction(orgId, storeId || merchant.storeId, merchant.id, result, {
      type: 'refund',
      amount: Number(amount),
      originalReferenceId,
      invoiceNumber,
    });

    res.json({
      success:              !!result.approved,
      result,
      paymentTransactionId: txRecord?.id || null,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooRefund]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};

interface VoidBody {
  stationId?: string;
  originalReferenceId?: string;
}

/** POST /api/payment/dejavoo/void */
export const dejavooVoid = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req) as string;
    const storeId = getStoreId(req);
    const { stationId, originalReferenceId } = req.body as VoidBody;

    if (!stationId || !originalReferenceId) {
      res.status(400).json({ success: false, error: 'stationId and originalReferenceId are required' });
      return;
    }

    const { merchant, station } = await loadMerchantByStation(stationId);

    const result = await processVoid(merchant, {
      originalReferenceId,
      registerId: station.name || stationId,
    } as Parameters<typeof processVoid>[1]) as ProviderResult;

    const txRecord = await recordTransaction(orgId, storeId || merchant.storeId, merchant.id, result, {
      type: 'void',
      amount: 0,
      originalReferenceId,
    });

    res.json({
      success:              !!result.approved,
      result,
      paymentTransactionId: txRecord?.id || null,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooVoid]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};
