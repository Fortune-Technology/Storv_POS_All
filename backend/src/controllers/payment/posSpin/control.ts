/**
 * POS SPIn — terminal control + status endpoints (no money moves).
 *
 *   dejavooCancel             POST /api/payment/dejavoo/cancel
 *                             Abort an in-flight transaction (cashier hits
 *                             Cancel while terminal is prompting customer)
 *   dejavooTerminalStatus     POST /api/payment/dejavoo/terminal-status
 *                             Live ping a specific station's terminal
 *   dejavooTransactionStatus  POST /api/payment/dejavoo/status
 *                             Look up a single transaction by referenceId
 *   dejavooSettle             POST /api/payment/dejavoo/settle
 *                             Close the current batch on the terminal
 */

import type { Request, Response } from 'express';
import {
  loadMerchantByStation,
  cancelTransaction,
  checkTerminalStatus,
  checkTransactionStatus,
  settleBatch,
} from '../../../services/paymentProviderFactory.js';
import type { ProviderResult } from './helpers.js';

interface CancelBody {
  stationId?: string;
  referenceId?: string;
}

/** POST /api/payment/dejavoo/cancel */
export const dejavooCancel = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stationId, referenceId } = req.body as CancelBody;

    if (!stationId) {
      res.status(400).json({ success: false, error: 'stationId is required' });
      return;
    }

    const { merchant } = await loadMerchantByStation(stationId);

    const result = await cancelTransaction(
      merchant,
      { referenceId } as Parameters<typeof cancelTransaction>[1],
    );

    res.json({ success: true, result });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooCancel]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};

/**
 * POST /api/payment/dejavoo/terminal-status
 *
 * Cashier-app uses this to verify the terminal is reachable before kicking
 * off a sale. Different from the admin Test button which uses the merchant
 * directly — this one resolves merchant from the cashier's `stationId`.
 */
export const dejavooTerminalStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stationId } = req.body as { stationId?: string };

    if (!stationId) {
      res.status(400).json({ success: false, error: 'stationId is required' });
      return;
    }

    const { merchant } = await loadMerchantByStation(stationId);

    const result = await checkTerminalStatus(merchant) as ProviderResult;

    res.json({ success: !!result.connected, result });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooTerminalStatus]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};

/**
 * POST /api/payment/dejavoo/status
 *
 * Look up a previous transaction's status by `referenceId`. Used when the
 * cashier-app's network drops mid-sale and wants to confirm whether the
 * sale actually went through before retrying.
 */
export const dejavooTransactionStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stationId, referenceId } = req.body as { stationId?: string; referenceId?: string };

    if (!stationId || !referenceId) {
      res.status(400).json({ success: false, error: 'stationId and referenceId are required' });
      return;
    }

    const { merchant } = await loadMerchantByStation(stationId);

    const result = await checkTransactionStatus(
      merchant,
      { referenceId } as Parameters<typeof checkTransactionStatus>[1],
    );

    res.json({ success: true, result });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooTransactionStatus]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};

/**
 * POST /api/payment/dejavoo/settle
 *
 * Close the current batch on the terminal. Typically end-of-shift — settles
 * all approved transactions and zeroes the open batch.
 */
export const dejavooSettle = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stationId } = req.body as { stationId?: string };

    if (!stationId) {
      res.status(400).json({ success: false, error: 'stationId is required' });
      return;
    }

    const { merchant } = await loadMerchantByStation(stationId);

    const result = await settleBatch(merchant) as ProviderResult;

    res.json({ success: !!result.approved, result });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooSettle]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};
