/**
 * billingService.js
 * Core billing calculations and charge execution.
 * Storv acts as the merchant for subscription and equipment payments.
 */

import prisma from '../config/postgres.js';
import { getMerchantConfig, gatewayAuth } from './cardPointeService.js';

const STORV_ORG_ID = process.env.STORV_ORG_ID;
export const FREE_SHIPPING_THRESHOLD = 500;
export const FLAT_SHIPPING = 25;

// ── Invoice number sequence ──────────────────────────────────────────────────
export async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const count = await prisma.billingInvoice.count({
    where: { invoiceNumber: { startsWith: `INV-${year}-` } },
  });
  return `INV-${year}-${String(count + 1).padStart(5, '0')}`;
}

// ── Equipment order number sequence ──────────────────────────────────────────
export async function nextOrderNumber() {
  const year = new Date().getFullYear();
  const count = await prisma.equipmentOrder.count({
    where: { orderNumber: { startsWith: `EQ-${year}-` } },
  });
  return `EQ-${year}-${String(count + 1).padStart(5, '0')}`;
}

// ── Calculate monthly invoice amount ─────────────────────────────────────────
export function calculateInvoiceAmount(subscription) {
  const plan = subscription.plan;

  // Base price (per-org override or plan default)
  let base = Number(subscription.basePriceOverride ?? plan.basePrice);

  // Extra stores/registers beyond plan included counts
  const extraStores = Math.max(0, subscription.storeCount - plan.includedStores);
  const extraRegs   = Math.max(0, subscription.registerCount - plan.includedRegisters);
  base += extraStores * Number(plan.pricePerStore);
  base += extraRegs   * Number(plan.pricePerRegister);

  // Add-ons selected by this org
  const addonTotal = (subscription.extraAddons || []).reduce((sum, key) => {
    const addon = (plan.addons || []).find(a => a.key === key);
    return sum + (addon ? Number(addon.price) : 0);
  }, 0);
  base += addonTotal;

  // Discount (fixed or percent, optionally time-limited)
  let discount = 0;
  if (subscription.discountType && subscription.discountValue) {
    const expiry = subscription.discountExpiry;
    if (!expiry || new Date(expiry) > new Date()) {
      if (subscription.discountType === 'fixed') {
        discount = Math.min(Number(subscription.discountValue), base);
      } else if (subscription.discountType === 'percent') {
        discount = base * (Number(subscription.discountValue) / 100);
      }
    }
  }

  const total = Math.max(0, base - discount);
  return { base, discount, total };
}

// ── Charge subscription via Storv's own CardPointe merchant ──────────────────
export async function chargeSubscription(subscription, amount, invoiceNumber) {
  if (!STORV_ORG_ID) throw new Error('STORV_ORG_ID not configured in environment');
  if (!subscription.paymentToken) throw new Error('No payment method on file for this subscription');

  const merchant = await getMerchantConfig(STORV_ORG_ID);
  if (!merchant) throw new Error('Storv merchant CardPointe credentials not configured');

  const amountCents = Math.round(amount * 100);

  const result = await gatewayAuth(merchant, {
    amount:   amountCents,
    account:  subscription.paymentToken,
    ecomind:  'R',              // recurring indicator
    orderid:  invoiceNumber,
    name:     subscription.organization?.name || 'Storv Subscriber',
    currency: 'USD',
  });

  if (result.respstat !== 'A') {
    throw new Error(result.resptext || `Payment declined (${result.respcode || 'unknown'})`);
  }

  return result; // { retref, authcode, respstat, ... }
}

// ── Charge equipment order via Storv's CardPointe merchant ───────────────────
export async function chargeEquipmentOrder(paymentToken, amount, orderNumber, customerName) {
  if (!STORV_ORG_ID) throw new Error('STORV_ORG_ID not configured in environment');

  const merchant = await getMerchantConfig(STORV_ORG_ID);
  if (!merchant) throw new Error('Storv merchant CardPointe credentials not configured');

  const amountCents = Math.round(amount * 100);

  const result = await gatewayAuth(merchant, {
    amount:   amountCents,
    account:  paymentToken,
    ecomind:  'E',              // ecommerce
    orderid:  orderNumber,
    name:     customerName,
    currency: 'USD',
  });

  if (result.respstat !== 'A') {
    throw new Error(result.resptext || `Payment declined (${result.respcode || 'unknown'})`);
  }

  return result;
}
