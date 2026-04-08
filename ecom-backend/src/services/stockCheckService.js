/**
 * Stock check service — synchronous call to POS backend at checkout time.
 * This is the critical POS↔ecom coupling point: the ecom-backend asks the
 * POS backend whether stock is available before confirming an order.
 */

import axios from 'axios';

const POS_BACKEND_URL = process.env.POS_BACKEND_URL || 'http://localhost:5000';

/**
 * Check stock availability with the POS backend.
 *
 * @param {string} storeId
 * @param {Array<{ posProductId: number, requestedQty: number }>} items
 * @returns {{ available: boolean, items: Array<{ posProductId, quantityOnHand, available }> }}
 */
export async function checkStockWithPOS(storeId, items) {
  try {
    const resp = await axios.post(
      `${POS_BACKEND_URL}/api/catalog/ecom-stock-check`,
      { storeId, items },
      {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    return resp.data;
  } catch (err) {
    console.error('[stock-check] POS backend call failed:', err.message);

    // If POS is unreachable, fail open (allow order) but flag it.
    // This prevents e-commerce from going down when POS is offline.
    return {
      available: true,
      fallback: true,
      items: items.map(i => ({
        posProductId: i.posProductId,
        requestedQty: i.requestedQty,
        quantityOnHand: null,
        available: true,
      })),
    };
  }
}
