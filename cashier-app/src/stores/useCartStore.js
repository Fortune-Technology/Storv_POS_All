/**
 * Cart store — holds the active transaction state.
 * Supports per-line discounts, order-level discounts, customer attachment, and hold/recall.
 */

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { round2 } from '../utils/taxCalc.js';
import { db } from '../db/dexie.js';

const calcLine = (item) => {
  const effectivePrice = item.discountType === 'percent'
    ? round2(item.unitPrice * (1 - (item.discountValue || 0) / 100))
    : item.discountType === 'amount'
    ? round2(Math.max(0, item.unitPrice - (item.discountValue || 0)))
    : item.unitPrice;
  return {
    ...item,
    effectivePrice,
    lineTotal:    round2(effectivePrice * item.qty),
    depositTotal: item.depositAmount ? round2(item.depositAmount * item.qty) : 0,
  };
};

export const useCartStore = create((set, get) => ({
  items:          [],
  selectedLineId: null,
  scanMode:       'normal',     // 'normal' | 'age_verify'
  pendingProduct: null,
  txNumber:       null,
  flashState:     null,

  // Order-level discount: { type: 'percent'|'amount', value: number }
  orderDiscount: null,

  // Attached customer: { id, name, phone, loyaltyPoints, cardNo }
  customer: null,

  // Ages already verified this transaction (no re-check for same age threshold)
  verifiedAges: [],

  // ── Item management ─────────────────────────────────────────────────────
  addProduct: (product) => {
    const items = get().items;
    const idx   = items.findIndex(i => i.productId === (product.id ?? product.productId));
    if (idx >= 0) {
      set({ items: items.map((item, i) => i === idx ? calcLine({ ...item, qty: item.qty + 1 }) : item) });
      // Track scan frequency in Dexie (non-blocking)
      db.scanFrequency.put({ productId: product.id ?? product.productId })
        .catch(() => {});
      return;
    }
    const newItem = calcLine({
      lineId:          nanoid(8),
      productId:       product.id ?? product.productId,
      upc:             product.upc,
      name:            product.name,
      brand:           product.brand,
      qty:             1,
      unitPrice:       Number(product.retailPrice || 0),
      taxable:         product.taxable ?? true,
      taxClass:        product.taxClass || 'grocery',
      ebtEligible:     product.ebtEligible || false,
      ageRequired:     product.ageRequired || null,
      depositAmount:   product.depositAmount || null,
      depositRuleId:   product.depositRuleId || null,
      priceOverridden: false,
      discountType:    null,
      discountValue:   null,
    });
    set({ items: [...items, newItem] });
    // Track scan frequency
    db.scanFrequency.get(product.id).then(row => {
      if (row) {
        db.scanFrequency.update(product.id, { count: (row.count || 0) + 1, lastAt: Date.now() });
      } else {
        db.scanFrequency.put({ productId: product.id, count: 1, lastAt: Date.now() });
      }
    }).catch(() => {});
  },

  removeItem: (lineId) => {
    set(s => ({
      items:          s.items.filter(i => i.lineId !== lineId),
      selectedLineId: s.selectedLineId === lineId ? null : s.selectedLineId,
    }));
  },

  updateQty: (lineId, qty) => {
    if (qty <= 0) { get().removeItem(lineId); return; }
    set(s => ({ items: s.items.map(i => i.lineId === lineId ? calcLine({ ...i, qty }) : i) }));
  },

  overridePrice: (lineId, price) => {
    set(s => ({
      items: s.items.map(i =>
        i.lineId === lineId
          ? calcLine({ ...i, unitPrice: Number(price), priceOverridden: true, discountType: null, discountValue: null })
          : i
      ),
    }));
  },

  applyLineDiscount: (lineId, type, value) => {
    set(s => ({
      items: s.items.map(i =>
        i.lineId === lineId
          ? calcLine({ ...i, discountType: type, discountValue: Number(value) })
          : i
      ),
    }));
  },

  removeLineDiscount: (lineId) => {
    set(s => ({
      items: s.items.map(i =>
        i.lineId === lineId
          ? calcLine({ ...i, discountType: null, discountValue: null })
          : i
      ),
    }));
  },

  applyOrderDiscount: (type, value) => set({ orderDiscount: { type, value: Number(value) } }),
  removeOrderDiscount: ()          => set({ orderDiscount: null }),

  selectItem:    (lineId) => set({ selectedLineId: lineId }),
  clearSelection: ()      => set({ selectedLineId: null }),

  setCustomer:   (c) => set({ customer: c }),
  clearCustomer: ()  => set({ customer: null }),

  clearCart: () => set({
    items: [], selectedLineId: null, scanMode: 'normal',
    pendingProduct: null, txNumber: null, flashState: null,
    orderDiscount: null, customer: null, verifiedAges: [],
  }),

  // ── Hold & Recall ──────────────────────────────────────────────────────
  holdCart: async (label = '') => {
    const { items, customer, orderDiscount } = get();
    if (!items.length) return;
    await db.heldTransactions.add({
      items, customer, orderDiscount,
      label: label || `Hold ${new Date().toLocaleTimeString()}`,
      heldAt: Date.now(),
      storeId: null,
    });
    get().clearCart();
    return true;
  },

  recallHeld: async (id) => {
    const held = await db.heldTransactions.get(id);
    if (!held) return false;
    set({
      items:         held.items || [],
      customer:      held.customer || null,
      orderDiscount: held.orderDiscount || null,
      selectedLineId: null,
    });
    await db.heldTransactions.delete(id);
    return true;
  },

  // ── Age verification ───────────────────────────────────────────────────
  requestAgeVerify: (product) => set({ scanMode: 'age_verify', pendingProduct: product }),
  cancelAgeVerify:  ()        => set({ scanMode: 'normal',     pendingProduct: null }),
  confirmAgeVerify: () => {
    const p = get().pendingProduct;
    if (p) {
      get().addProduct(p);
      if (p.ageRequired) {
        const ages = get().verifiedAges;
        if (!ages.includes(p.ageRequired)) {
          set(s => ({ verifiedAges: [...s.verifiedAges, p.ageRequired] }));
        }
      }
    }
    set({ scanMode: 'normal', pendingProduct: null });
  },

  addVerifiedAge: (age) => {
    const ages = get().verifiedAges;
    if (!ages.includes(age)) {
      set(s => ({ verifiedAges: [...s.verifiedAges, age] }));
    }
  },

  // ── Scan feedback ──────────────────────────────────────────────────────
  flash: (type) => {
    set({ flashState: type });
    setTimeout(() => set({ flashState: null }), 320);
  },

  setTxNumber: (n) => set({ txNumber: n }),
}));

// ── Derived totals ─────────────────────────────────────────────────────────
export function selectTotals(items, taxRules = [], orderDiscount = null) {
  const subtotal     = round2(items.reduce((s, i) => s + i.lineTotal, 0));
  const depositTotal = round2(items.reduce((s, i) => s + (i.depositTotal || 0), 0));
  const ebtTotal     = round2(items.filter(i => i.ebtEligible).reduce((s, i) => s + i.lineTotal, 0));

  let taxTotal = 0;
  for (const item of items) {
    if (!item.taxable || item.ebtEligible) continue;
    const rule = taxRules.find(r => r.active && matchTax(r.appliesTo, item.taxClass));
    taxTotal += item.lineTotal * (rule ? parseFloat(rule.rate) : 0);
  }
  taxTotal = round2(taxTotal);

  let discountAmount = 0;
  if (orderDiscount) {
    discountAmount = orderDiscount.type === 'percent'
      ? round2(subtotal * orderDiscount.value / 100)
      : round2(Math.min(orderDiscount.value, subtotal));
  }

  const grandTotal = round2(subtotal - discountAmount + depositTotal + taxTotal);

  return { subtotal, discountAmount, depositTotal, ebtTotal, taxTotal, grandTotal };
}

function matchTax(appliesTo, taxClass) {
  if (!appliesTo || appliesTo === 'all') return true;
  return appliesTo.split(',').map(s => s.trim()).includes(taxClass);
}
