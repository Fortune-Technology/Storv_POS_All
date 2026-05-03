/**
 * POS SPIn — customer phone-number lookup via terminal prompt.
 *
 * Used by the cashier-app's loyalty flow. Cashier taps "Lookup customer"
 * → terminal prompts the customer to type their phone number on the
 * terminal keypad → we get the value back → we search our Customer table
 * → return the match (or notFound: true) so the cashier can either attach
 * the customer to the sale or quick-create them.
 *
 * Why on the terminal vs the cashier's screen?
 *   - Privacy: customer types their own number; cashier never sees it on
 *     their screen.
 *   - Hygiene: keeps the customer-facing data entry on the customer-side
 *     hardware.
 */

import type { Request, Response } from 'express';
import prisma from '../../../config/postgres.js';
import { loadMerchantByStation, promptUserInput } from '../../../services/paymentProviderFactory.js';
import { getOrgId, type ProviderResult } from './helpers.js';

interface LookupCustomerBody {
  stationId?: string;
  title?: string;
  prompt?: string;
  minLength?: number;
  maxLength?: number;
  timeoutSec?: number;
}

/**
 * POST /api/payment/dejavoo/lookup-customer
 *
 * Returns one of:
 *   { success: true, customer: {...} }                ← matched a customer
 *   { success: true, notFound: true, phone: '...' }   ← no match — cashier can quick-create
 *   { success: false, reason: '...', message: '...' } ← user cancelled or input invalid
 */
export const dejavooLookupCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const { stationId, title, prompt, minLength, maxLength, timeoutSec } = req.body as LookupCustomerBody;

    if (!stationId) {
      res.status(400).json({ success: false, error: 'stationId is required' });
      return;
    }

    const { merchant } = await loadMerchantByStation(stationId);

    // Prompt customer on the terminal for phone input
    const result = await promptUserInput(merchant, {
      title:      title     || 'Loyalty Lookup',
      prompt:     prompt    || 'Enter phone number',
      inputType:  'Numeric',
      minLength:  minLength ?? 7,
      maxLength:  maxLength ?? 15,
      timeoutSec: timeoutSec ?? 45,
    } as Parameters<typeof promptUserInput>[1]) as ProviderResult;

    if (!result.approved || !result.value) {
      res.json({
        success: false,
        reason:  result.statusCode === '1012' ? 'cancelled' : 'no_input',
        message: result.message || 'No phone number entered',
      });
      return;
    }

    // Normalize — strip everything but digits; keep last 10 for US phone match
    const digits = String(result.value).replace(/\D/g, '');
    if (digits.length < 7) {
      res.json({
        success: false,
        reason:  'invalid_format',
        message: 'Phone number too short',
        rawValue: result.value,
      });
      return;
    }

    const last10 = digits.slice(-10);

    // Search Customer table — match by phone field containing those digits.
    // We pull up to 50 candidates and filter client-side because phone
    // numbers in the DB may have varying formats (parens, dashes, country
    // code), so a `contains` query alone wouldn't reliably match.
    const candidates = await prisma.customer.findMany({
      where: {
        orgId,
        phone: { not: null },
      },
      select: {
        id: true, firstName: true, lastName: true,
        phone: true, email: true,
        loyaltyPoints: true, balance: true, discount: true,
      },
      take: 50,
    });

    type CandidateRow = (typeof candidates)[number];
    const match = candidates.find((c: CandidateRow) => {
      const cDigits = String(c.phone || '').replace(/\D/g, '');
      return cDigits.endsWith(last10);
    });

    if (!match) {
      res.json({
        success:  true,
        notFound: true,
        phone:    digits,
        message:  'No customer found with this phone — cashier can create a new one',
      });
      return;
    }

    res.json({
      success: true,
      customer: {
        id:            match.id,
        firstName:     match.firstName,
        lastName:      match.lastName,
        phone:         match.phone,
        email:         match.email,
        loyaltyPoints: match.loyaltyPoints,
        balance:       match.balance,
        discount:      match.discount,
      },
      phoneEntered: digits,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('[dejavooLookupCustomer]', err);
    res.status(e.status || 500).json({ success: false, error: e.message || String(err) });
  }
};
