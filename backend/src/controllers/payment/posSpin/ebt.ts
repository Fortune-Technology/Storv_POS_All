/**
 * POS SPIn — EBT balance inquiry.
 *
 * Separated from transactions/control because it's a read-only operation
 * that doesn't move money. Doesn't write a PaymentTransaction row — the
 * customer's balance is shown to the cashier and that's it.
 */

import type { Request, Response } from 'express';
import { loadMerchantByStation, checkEbtBalance } from '../../../services/paymentProviderFactory.js';
import type { ProviderResult } from './helpers.js';

interface EbtBalanceBody {
  stationId?: string;
  paymentType?: string;
}

/**
 * POST /api/payment/dejavoo/ebt-balance
 *
 * `paymentType` should be 'ebt_food' (default) or 'ebt_cash'. Returns the
 * customer's available balance — the cashier shows this to the customer
 * before tendering, so they know how much to spend.
 */
export const dejavooEbtBalance = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stationId, paymentType } = req.body as EbtBalanceBody;

    if (!stationId) {
      res.status(400).json({ success: false, error: 'stationId is required' });
      return;
    }

    const { merchant, station } = await loadMerchantByStation(stationId);

    const result = await checkEbtBalance(merchant, {
      paymentType: paymentType || 'ebt_food',
      registerId:  station.name || stationId,
    } as Parameters<typeof checkEbtBalance>[1]) as ProviderResult;

    res.json({ success: !!result.approved, result });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooEbtBalance]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};
