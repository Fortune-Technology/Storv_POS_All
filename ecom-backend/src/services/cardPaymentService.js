/**
 * cardPaymentService.js
 *
 * Calls the main POS backend to charge a CardPointe token obtained from
 * the CardSecure.js iFrame tokenizer on the storefront.
 *
 * Architecture:
 *   storefront → CardSecure.js iFrame → token
 *   storefront POST token → ecom-backend checkout
 *   ecom-backend → this service → POS backend /payment/ecom/charge
 *   POS backend → CardPointe Gateway API → approved/declined
 *
 * The POS backend owns all CardPointe merchant credentials. ecom-backend
 * delegates payment processing to it (same pattern as stockCheckService).
 */

import axios from 'axios';

const POS_BACKEND_URL   = process.env.POS_BACKEND_URL   || 'http://localhost:5000';
const INTERNAL_API_KEY  = process.env.INTERNAL_API_KEY  || '';

/**
 * Charge a CardPointe card token via the POS backend.
 *
 * @param {object} opts
 * @param {string} opts.token      CardPointe token from CardSecure.js iFrame
 * @param {number} opts.amount     Dollar amount (e.g. 26.94)
 * @param {string} opts.storeId    POS store ID (used to look up merchant credentials)
 * @param {string} [opts.orderRef] Order number for reconciliation
 * @param {string} [opts.expiry]   MMYY — required for some card types
 * @param {string} [opts.cvv]      CVV (optional — CardPointe accepts without for tokenized cards)
 *
 * @returns {{ approved: boolean, retref?: string, authCode?: string,
 *             lastFour?: string, acctType?: string, respcode?: string, resptext?: string }}
 */
export async function chargeCardToken({ token, amount, storeId, orderRef, expiry, cvv }) {
  const resp = await axios.post(
    `${POS_BACKEND_URL}/api/payment/ecom/charge`,
    { token, amount, storeId, orderRef, expiry, cvv },
    {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(INTERNAL_API_KEY ? { 'x-internal-key': INTERNAL_API_KEY } : {}),
      },
    }
  );

  return resp.data;
}
