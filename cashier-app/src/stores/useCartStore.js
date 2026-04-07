/**
 * Cart store — holds the active transaction state.
 * Supports per-line discounts, order-level discounts, customer attachment, and hold/recall.
 */

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { round2 } from '../utils/taxCalc.js';
import { db } from '../db/dexie.js';
import { evaluatePromotions } from '../utils/promoEngine.js';

// ── Inline promo evaluation — runs synchronously inside store actions ──────
// Returns { items, promoResults } with adjustments baked in, no extra render.
function withPromos(items, promotions) {
  if (!promotions?.length || !items?.length) {
    const cleaned = items.map(i => i.promoAdjustment ? calcLine({ ...i, promoAdjustment: null }) : i);
    return { items: cleaned, promoResults: { lineAdjustments: {}, totalSaving: 0, appliedPromos: [] } };
  }
  const cartItems = items.map(i => ({
    lineId:           i.lineId,
    productId:        i.productId,
    departmentId:     i.departmentId || null,
    qty:              i.qty,
    unitPrice:        i.unitPrice,
    discountEligible: i.discountEligible !== false,
  }));
  const results = evaluatePromotions(cartItems, promotions);
  const adjs    = results.lineAdjustments || {};
  const updated = items.map(item => {
    const adj    = adjs[item.lineId] || null;
    const prevId = item.promoAdjustment?.promoId ?? null;
    const newId  = adj?.promoId ?? null;
    const prevV  = item.promoAdjustment?.discountValue ?? null;
    const newV   = adj?.discountValue ?? null;
    if (prevId === newId && prevV === newV) return item; // unchanged — avoid extra render
    return calcLine({ ...item, promoAdjustment: adj });
  });
  return { items: updated, promoResults: results };
}

const calcLine = (item) => {
  // Manual discount applied by cashier/manager
  const manualPrice = item.discountType === 'percent'
    ? round2(item.unitPrice * (1 - (item.discountValue || 0) / 100))
    : item.discountType === 'amount'
    ? round2(Math.max(0, item.unitPrice - (item.discountValue || 0)))
    : item.unitPrice;

  // Promo discount auto-applied by promotion engine
  const promoAdj = item.promoAdjustment;
  const afterPromo = promoAdj
    ? promoAdj.discountType === 'percent'
      ? round2(manualPrice * (1 - (promoAdj.discountValue || 0) / 100))
      : promoAdj.discountType === 'amount'
      ? round2(Math.max(0, manualPrice - (promoAdj.discountValue || 0)))
      : promoAdj.discountType === 'fixed'
      ? round2(Math.max(0, promoAdj.discountValue || 0))
      : manualPrice
    : manualPrice;

  const effectivePrice = afterPromo;
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

  // Active promotions + results
  promotions:    [],   // raw promo records from IndexedDB
  promoResults:  { lineAdjustments: {}, totalSaving: 0, appliedPromos: [] },

  // ── Item management ─────────────────────────────────────────────────────
  addProduct: (product) => {
    const { items, promotions } = get();
    const idx = items.findIndex(i => i.productId === (product.id ?? product.productId));
    let nextItems;
    if (idx >= 0) {
      nextItems = items.map((item, i) => i === idx ? calcLine({ ...item, qty: item.qty + 1 }) : item);
      db.scanFrequency.put({ productId: product.id ?? product.productId }).catch(() => {});
    } else {
      const newItem = calcLine({
        lineId:           nanoid(8),
        productId:        product.id ?? product.productId,
        upc:              product.upc,
        name:             product.name,
        brand:            product.brand,
        qty:              1,
        unitPrice:        Number(product.retailPrice || 0),
        taxable:          product.taxable ?? true,
        taxClass:         product.taxClass || 'grocery',
        ebtEligible:      product.ebtEligible || false,
        ageRequired:      product.ageRequired || null,
        depositAmount:    product.depositAmount || null,
        depositRuleId:    product.depositRuleId || null,
        departmentId:     product.departmentId || null,
        discountEligible: product.discountEligible !== false,
        priceOverridden:  false,
        discountType:     null,
        discountValue:    null,
        promoAdjustment:  null,
      });
      nextItems = [...items, newItem];
      db.scanFrequency.get(product.id).then(row => {
        if (row) db.scanFrequency.update(product.id, { count: (row.count || 0) + 1, lastAt: Date.now() });
        else     db.scanFrequency.put({ productId: product.id, count: 1, lastAt: Date.now() });
      }).catch(() => {});
    }
    const { items: promoItems, promoResults } = withPromos(nextItems, promotions);
    set({ items: promoItems, promoResults });
  },

  addLotteryItem: ({ lotteryType, amount, gameId, gameName, notes }) => {
    // lotteryType: 'sale' | 'payout'
    // Sale = positive amount (customer pays), Payout = negative (we pay customer)
    const amt = lotteryType === 'payout' ? -Math.abs(Number(amount)) : Math.abs(Number(amount));
    const item = {
      lineId:          nanoid(8),
      isLottery:       true,
      lotteryType,
      gameId:          gameId || null,
      name:            lotteryType === 'payout'
                         ? `Lottery Payout${notes ? ' — ' + notes : ''}`
                         : `🎟️ ${gameName || 'Lottery'}`,
      qty:             1,
      unitPrice:       amt,
      effectivePrice:  amt,
      lineTotal:       amt,
      taxable:         false,
      ebtEligible:     false,
      depositAmount:   null,
      depositTotal:    0,
      discountEligible: false,
      discountType:    null,
      discountValue:   null,
      promoAdjustment: null,
    };
    set(s => ({ items: [...s.items, item] }));
  },

  addBottleReturnItems: (lines) => {
    // lines: [{ rule: {id, name, depositAmount}, qty: number, lineTotal: number }]
    const items = lines.map(l => ({
      lineId:           nanoid(8),
      isBottleReturn:   true,
      name:             `♻️ Bottle Return – ${l.rule.name}`,
      qty:              l.qty,
      unitPrice:        -Number(l.rule.depositAmount),
      effectivePrice:   -Number(l.rule.depositAmount),
      lineTotal:        -Math.abs(l.lineTotal),
      depositTotal:     0,
      taxable:          false,
      ebtEligible:      false,
      depositAmount:    null,
      discountEligible: false,
      discountType:     null,
      discountValue:    null,
      promoAdjustment:  null,
    }));
    set(s => ({ items: [...s.items, ...items] }));
  },

  removeItem: (lineId) => {
    set(s => {
      const rawItems = s.items.filter(i => i.lineId !== lineId);
      const { items, promoResults } = withPromos(rawItems, s.promotions);
      return {
        items,
        promoResults,
        selectedLineId: s.selectedLineId === lineId ? null : s.selectedLineId,
        verifiedAges:   items.length === 0 ? [] : s.verifiedAges,
      };
    });
  },

  updateQty: (lineId, qty) => {
    if (qty <= 0) { get().removeItem(lineId); return; }
    set(s => {
      const rawItems = s.items.map(i => i.lineId === lineId ? calcLine({ ...i, qty }) : i);
      const { items, promoResults } = withPromos(rawItems, s.promotions);
      return { items, promoResults };
    });
  },

  overridePrice: (lineId, price) => {
    set(s => {
      const rawItems = s.items.map(i =>
        i.lineId === lineId
          ? calcLine({ ...i, unitPrice: Number(price), priceOverridden: true, discountType: null, discountValue: null })
          : i
      );
      const { items, promoResults } = withPromos(rawItems, s.promotions);
      return { items, promoResults };
    });
  },

  applyLineDiscount: (lineId, type, value) => {
    set(s => {
      const rawItems = s.items.map(i =>
        i.lineId === lineId ? calcLine({ ...i, discountType: type, discountValue: Number(value) }) : i
      );
      const { items, promoResults } = withPromos(rawItems, s.promotions);
      return { items, promoResults };
    });
  },

  removeLineDiscount: (lineId) => {
    set(s => {
      const rawItems = s.items.map(i =>
        i.lineId === lineId ? calcLine({ ...i, discountType: null, discountValue: null }) : i
      );
      const { items, promoResults } = withPromos(rawItems, s.promotions);
      return { items, promoResults };
    });
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
    promoResults: { lineAdjustments: {}, totalSaving: 0, appliedPromos: [] },
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

  setPromotions: (promos) => {
    set(s => {
      const { items, promoResults } = withPromos(s.items, promos);
      return { promotions: promos, items, promoResults };
    });
  },

  applyPromoResults: (results) => {
    set(s => {
      const adjs = results.lineAdjustments || {};
      const updatedItems = s.items.map(item => {
        const adj = adjs[item.lineId] || null;
        if (adj === item.promoAdjustment) return item; // no change
        return calcLine({ ...item, promoAdjustment: adj });
      });
      return { items: updatedItems, promoResults: results };
    });
  },

  clearPromoResults: () => {
    set(s => ({
      promoResults: { lineAdjustments: {}, totalSaving: 0, appliedPromos: [] },
      items: s.items.map(item => calcLine({ ...item, promoAdjustment: null })),
    }));
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

  // Promo savings already factored into item effectivePrices / lineTotals
  // We compute separately for display in totals
  const promoSaving = round2(items.reduce((s, item) => {
    if (!item.promoAdjustment) return s;
    const adj = item.promoAdjustment;
    const reg = item.unitPrice * item.qty;
    if (adj.discountType === 'percent') return s + round2(item.unitPrice * item.qty * adj.discountValue / 100);
    if (adj.discountType === 'amount')  return s + round2(Math.min(adj.discountValue * item.qty, reg));
    if (adj.discountType === 'fixed')   return s + round2(Math.max(0, reg - adj.discountValue * item.qty));
    return s;
  }, 0));

  return { subtotal, discountAmount, depositTotal, ebtTotal, taxTotal, grandTotal, promoSaving };
}

function matchTax(appliesTo, taxClass) {
  if (!appliesTo || appliesTo === 'all') return true;
  return appliesTo.split(',').map(s => s.trim()).includes(taxClass);
}
