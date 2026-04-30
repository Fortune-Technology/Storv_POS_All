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
  const baseLineTotal = round2(effectivePrice * item.qty);

  // Manufacturer coupon discount (Session 46) — applied LAST, after promo + manual.
  // Stored as a fixed $ amount on the line; persists through qty/price changes.
  const couponAmt = Number(item.manufacturerCouponAmount) || 0;
  const lineTotal = round2(Math.max(0, baseLineTotal - couponAmt));

  return {
    ...item,
    effectivePrice,
    lineTotal,
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

  // Bag count for this transaction
  bagCount: 0,

  // Loyalty redemption applied to this transaction:
  // { rewardId, rewardName, pointsCost, discountType: 'dollar_off'|'pct_off', discountValue }
  loyaltyRedemption: null,

  // Ages already verified this transaction (no re-check for same age threshold)
  verifiedAges: [],

  // Active promotions + results
  promotions:    [],   // raw promo records from IndexedDB
  promoResults:  { lineAdjustments: {}, totalSaving: 0, appliedPromos: [] },

  // Manufacturer coupon redemptions for THIS transaction (Session 46).
  // Each entry: { couponId, serial, brandFamily, manufacturerId, discountApplied,
  //               qualifyingLineId, qualifyingUpc, qualifyingQty,
  //               managerApprovedById?, displayName? }
  // Persisted on the line via `manufacturerCouponAmount` + `manufacturerCouponSerial`
  // so totals stay correct through qty/price changes.
  couponRedemptions: [],

  // ── Item management ─────────────────────────────────────────────────────
  addProduct: (product) => {
    const { items, promotions } = get();
    // Dedup key is (productId, packSizeId) — same product picked at the SAME
    // pack size stacks qty (correct: scanning Single twice = qty 2). Same
    // product picked at a DIFFERENT pack must be its own line because price /
    // unit count / deposit-per-unit all differ per pack. Prior to this fix
    // the dedup was productId-only, which silently collapsed multi-pack picks
    // into the first-picked pack's line and inherited its price + deposit.
    const incomingProductId = product.id ?? product.productId;
    const incomingPackId    = product.packSizeId ?? null;
    const idx = items.findIndex(i =>
      i.productId === incomingProductId &&
      (i.packSizeId ?? null) === incomingPackId
    );
    let nextItems;
    if (idx >= 0) {
      nextItems = items.map((item, i) => i === idx ? calcLine({ ...item, qty: item.qty + 1 }) : item);
      db.scanFrequency.put({ productId: incomingProductId }).catch(() => {});
    } else {
      const newItem = calcLine({
        lineId:           nanoid(8),
        productId:        incomingProductId,
        upc:              product.upc,
        name:             product.name,
        brand:            product.brand,
        qty:              1,
        unitPrice:        Number(product.retailPrice || 0),
        taxable:          product.taxable ?? true,
        // Session 40 Phase 1 — strict-FK tax. `taxRuleId` is authoritative;
        // `taxClass` kept as the legacy fallback matcher. selectTotals checks
        // taxRuleId first, then dept-linked rule, then taxClass match.
        taxRuleId:        product.taxRuleId || null,
        taxClass:         product.taxClass || 'grocery',
        ebtEligible:      product.ebtEligible || false,
        ageRequired:      product.ageRequired || null,
        depositAmount:    product.depositAmount || null,
        depositRuleId:    product.depositRuleId || null,
        departmentId:     product.departmentId || null,
        discountEligible: product.discountEligible !== false,
        quantityOnHand:   product.quantityOnHand != null ? Number(product.quantityOnHand) : null,
        // Pack-size metadata — required for the dedup key above to work on
        // subsequent adds (otherwise both lines compare null === null and
        // collide). Also surfaces in the cart UI as a small chip so the
        // cashier sees which pack was picked.
        packSizeId:       incomingPackId,
        packSizeLabel:    product.packSizeLabel || null,
        unitCount:        product.unitCount != null ? Number(product.unitCount) : null,
        priceOverridden:  false,
        discountType:     null,
        discountValue:    null,
        promoAdjustment:  null,
      });
      nextItems = [...items, newItem];
      db.scanFrequency.get(incomingProductId).then(row => {
        if (row) db.scanFrequency.update(incomingProductId, { count: (row.count || 0) + 1, lastAt: Date.now() });
        else     db.scanFrequency.put({ productId: incomingProductId, count: 1, lastAt: Date.now() });
      }).catch(() => {});
    }
    const { items: promoItems, promoResults } = withPromos(nextItems, promotions);
    set({ items: promoItems, promoResults });
  },

  // ── Open Item (manual entry — no catalog product) ────────────────────────
  // Used for misc items that don't have a barcode, like "Coffee" or custom amounts.
  addOpenItem: ({ name, price, taxRuleId = null, taxClass = 'standard', taxable = true, departmentId = null }) => {
    const { items, promotions } = get();
    const newItem = calcLine({
      lineId:           nanoid(8),
      productId:        null,
      upc:              null,
      name:             name || 'Open Item',
      brand:            null,
      qty:              1,
      unitPrice:        Number(price) || 0,
      taxable:          !!taxable,
      // Open items can also carry an explicit taxRuleId if the UI supplies one
      // (e.g. a "Generic Tobacco" quick-entry button). Otherwise falls through
      // to the taxClass matcher as before.
      taxRuleId:        taxRuleId || null,
      taxClass:         taxClass || 'standard',
      ebtEligible:      false,
      ageRequired:      null,
      depositAmount:    null,
      depositRuleId:    null,
      departmentId:     departmentId ? parseInt(departmentId) : null,
      discountEligible: true,
      priceOverridden:  false,
      discountType:     null,
      discountValue:    null,
      promoAdjustment:  null,
      isOpenItem:       true,
    });
    const nextItems = [...items, newItem];
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

  addFuelItem: ({
    fuelType, type = 'sale',
    gallons, pricePerGallon, amount,
    entryMode = 'amount', taxAmount = 0, notes,
    pumpId = null, pumpNumber = null,   // V1.5: pump attribution
    refundsOf = null,                    // V1.5: refund → original sale id
  }) => {
    // type: 'sale' (positive) | 'refund' (negative)
    // gallons + pricePerGallon + amount must all be set; the modal computes whichever is missing
    const sign = type === 'refund' ? -1 : 1;
    const gal  = Math.abs(Number(gallons) || 0);
    const ppg  = Math.abs(Number(pricePerGallon) || 0);
    const amt  = sign * Math.abs(Number(amount) || (gal * ppg));
    const tax  = sign * Math.abs(Number(taxAmount) || 0);
    const pumpBadge = pumpNumber ? ` · Pump ${pumpNumber}` : '';
    const item = {
      lineId:           nanoid(8),
      isFuel:           true,
      fuelType:         type,                      // 'sale' | 'refund'
      fuelTypeId:       fuelType?.id || null,
      fuelTypeName:     fuelType?.name || 'Fuel',
      fuelGradeLabel:   fuelType?.gradeLabel || null,
      gallons:          sign * gal,
      pricePerGallon:   ppg,
      entryMode,
      // V1.5
      pumpId,
      pumpNumber,
      refundsOf,
      name:             type === 'refund'
                          ? `⛽ Fuel Refund — ${fuelType?.name || 'Fuel'}${pumpBadge}`
                          : `⛽ ${fuelType?.name || 'Fuel'}${fuelType?.gradeLabel ? ' (' + fuelType.gradeLabel + ')' : ''}${pumpBadge}`,
      qty:              1,
      unitPrice:        amt,
      effectivePrice:   amt,
      lineTotal:        amt,
      // Fuel tax is recorded on the FuelTransaction record, not via cart-level tax engine
      // (jurisdictions vary; most fuel taxes are pump-price-inclusive)
      taxable:          false,
      taxAmount:        tax,
      ebtEligible:      false,
      depositAmount:    null,
      depositTotal:     0,
      discountEligible: false,
      discountType:     null,
      discountValue:    null,
      promoAdjustment:  null,
      notes:            notes || null,
    };
    set(s => ({ items: [...s.items, item] }));
  },

  // Add a single product as a refund line — qty defaults to 1, lineTotal
  // is forced negative. Mirrors the bottle-return pattern but uses real
  // product attributes (productId, taxable, ebt) so refund analytics +
  // inventory sync see them correctly.
  //
  // Tax + deposit fields are set to NEGATIVE values so the cart subtotal /
  // tax / deposit aggregators return the right signed amounts. Existing
  // negative-grand-total handling in TenderModal (Session 19 — bottle
  // returns) routes net-negative carts through the "REFUND DUE TO
  // CUSTOMER" path, which works for refund lines too.
  addRefundItem: (product, qty = 1) => {
    if (!product) return;
    const unitPrice = Number(product.retailPrice) || 0;
    const q         = Math.max(1, qty);
    const lineTotal = -(unitPrice * q);
    const item = {
      lineId:           nanoid(8),
      isRefundItem:     true,
      productId:        product.id,
      upc:              product.upc || null,
      name:             `↩ Refund – ${product.name || 'Item'}`,
      qty:              -q,                       // negative qty so reports see it as a return
      unitPrice:        unitPrice,
      effectivePrice:   unitPrice,
      lineTotal,
      taxable:          !!product.taxable,
      ebtEligible:      !!product.ebtEligible,
      depositAmount:    null,
      depositTotal:     0,
      discountEligible: false,
      discountType:     null,
      discountValue:    null,
      promoAdjustment:  null,
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

  // ── Manufacturer Coupons (Session 46) ────────────────────────────────────
  // Apply a validated coupon to a specific qualifying line.
  // Caller is responsible for passing the validation result from the backend
  // (which already includes the computed discount + qualifying line list).
  //
  // Args:
  //   coupon:           { id, serial, brandFamily, manufacturerId, displayName, discountType, discountAmount, fundedBy }
  //   qualifyingLineId: line in cart to attach to (one of validation.qualifyingLines)
  //   computedDiscount: $ amount (already clamped to line total by backend)
  //   managerApprovedById: optional — set when threshold required manager PIN
  applyCoupon: ({ coupon, qualifyingLineId, computedDiscount, managerApprovedById = null }) => {
    set(s => {
      const line = s.items.find(i => i.lineId === qualifyingLineId);
      if (!line) return s;

      const discountToApply = Number(computedDiscount) || 0;
      if (discountToApply <= 0) return s;

      const rawItems = s.items.map(i => {
        if (i.lineId !== qualifyingLineId) return i;
        const existing = Number(i.manufacturerCouponAmount) || 0;
        const totalCoupon = round2(existing + discountToApply);
        return calcLine({
          ...i,
          manufacturerCouponAmount: totalCoupon,
          manufacturerCouponSerial: coupon.serial,
        });
      });
      const { items, promoResults } = withPromos(rawItems, s.promotions);

      const redemption = {
        couponId:        coupon.id,
        serial:          coupon.serial,
        brandFamily:     coupon.brandFamily,
        manufacturerId:  coupon.manufacturerId,
        displayName:     coupon.displayName || null,
        discountApplied: discountToApply,
        qualifyingLineId,
        qualifyingUpc:   line.upc,
        qualifyingQty:   line.qty,
        managerApprovedById,
        appliedAt:       Date.now(),
      };

      return {
        items,
        promoResults,
        couponRedemptions: [...s.couponRedemptions, redemption],
      };
    });
  },

  // Remove a coupon by serial. Reduces the line's manufacturerCouponAmount
  // by exactly the redemption's discountApplied. If multiple coupons stacked
  // on one line, only the matching redemption is removed.
  removeCoupon: (serial) => {
    set(s => {
      const target = s.couponRedemptions.find(r => r.serial === serial);
      if (!target) return s;

      const rawItems = s.items.map(i => {
        if (i.lineId !== target.qualifyingLineId) return i;
        const existing = Number(i.manufacturerCouponAmount) || 0;
        const reduced  = round2(Math.max(0, existing - target.discountApplied));
        // Find any other redemption still on this line — keep its serial as the display
        const otherSerials = s.couponRedemptions
          .filter(r => r.serial !== serial && r.qualifyingLineId === i.lineId)
          .map(r => r.serial);
        return calcLine({
          ...i,
          manufacturerCouponAmount: reduced,
          manufacturerCouponSerial: otherSerials[otherSerials.length - 1] || null,
        });
      });
      const { items, promoResults } = withPromos(rawItems, s.promotions);

      return {
        items,
        promoResults,
        couponRedemptions: s.couponRedemptions.filter(r => r.serial !== serial),
      };
    });
  },

  selectItem:    (lineId) => set({ selectedLineId: lineId }),
  clearSelection: ()      => set({ selectedLineId: null }),

  setCustomer:   (c) => set({ customer: c }),
  clearCustomer: ()  => set({ customer: null, loyaltyRedemption: null }),

  // Loyalty redemption
  applyLoyaltyRedemption: (redemption) => {
    // redemption: { rewardId, rewardName, pointsCost, discountType, discountValue }
    set({ loyaltyRedemption: redemption });
  },
  removeLoyaltyRedemption: () => set({ loyaltyRedemption: null }),

  // Bag count
  incrementBags:  () => set(s => ({ bagCount: s.bagCount + 1 })),
  decrementBags:  () => set(s => ({ bagCount: Math.max(0, s.bagCount - 1) })),
  setBagCount:    (n) => set({ bagCount: Math.max(0, n) }),

  clearCart: () => set({
    items: [], selectedLineId: null, scanMode: 'normal',
    pendingProduct: null, txNumber: null, flashState: null,
    orderDiscount: null, customer: null, loyaltyRedemption: null, verifiedAges: [],
    bagCount: 0,
    promoResults: { lineAdjustments: {}, totalSaving: 0, appliedPromos: [] },
    couponRedemptions: [],
  }),

  // ── Hold & Recall ──────────────────────────────────────────────────────
  holdCart: async (label = '') => {
    const { items, customer, orderDiscount, loyaltyRedemption, bagCount, couponRedemptions } = get();
    if (!items.length) return;
    await db.heldTransactions.add({
      items, customer, orderDiscount, loyaltyRedemption, bagCount, couponRedemptions,
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
      items:              held.items || [],
      customer:           held.customer || null,
      orderDiscount:      held.orderDiscount || null,
      loyaltyRedemption:  held.loyaltyRedemption || null,
      bagCount:           held.bagCount || 0,
      couponRedemptions:  held.couponRedemptions || [],
      selectedLineId:     null,
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

// ── Shared "effective discount" builder ────────────────────────────────────
// Combines all three discount sources (customer standing %, manual order
// discount, loyalty redemption) into a single dollar-amount value that can
// be passed to `selectTotals(items, taxRules, effectiveDiscount, bagFeeInfo)`.
//
// Used by POSScreen (live cart total) and TenderModal (final checkout total)
// so both screens always agree on the math.
//
// Returns null when nothing reduces the cart, otherwise:
//   { type: 'amount', value, sources: [{ kind, amount, label }] }
// `sources` is purely informational — selectTotals ignores it. The cashier-
// app surfaces it in the cart panel and on the customer-facing display so
// the cashier can explain "why is the total lower than the subtotal".
export function computeEffectiveDiscount({ items, customer, orderDiscount, loyaltyRedemption }) {
  const rawSubtotal = items.reduce((s, i) => s + (i.lineTotal || 0), 0);
  if (rawSubtotal <= 0) return null;

  let dollarOff = 0;
  const sources = [];

  // Customer standing discount — stored as Decimal(5,4) (e.g. 0.0500 = 5%).
  // Applied first so subsequent calculations work off the discounted base.
  // Only applied to the *positive* subtotal — net-negative carts (refunds)
  // skip this so the customer doesn't get penalised on a return.
  const cdRate = Number(customer?.discount || 0);
  if (cdRate > 0 && rawSubtotal > 0) {
    const amt = Math.round(rawSubtotal * cdRate * 100) / 100;
    dollarOff += amt;
    sources.push({ kind: 'customer', amount: amt, label: `${(cdRate * 100).toFixed(cdRate >= 0.1 ? 0 : 1)}% loyalty` });
  }

  if (orderDiscount) {
    const amt = orderDiscount.type === 'percent'
      ? Math.round(rawSubtotal * orderDiscount.value / 100 * 100) / 100
      : Math.min(orderDiscount.value, rawSubtotal);
    dollarOff += amt;
    sources.push({
      kind: 'manual',
      amount: amt,
      label: orderDiscount.type === 'percent' ? `${orderDiscount.value}% off` : `$${amt.toFixed(2)} off`,
    });
  }

  if (loyaltyRedemption) {
    const amt = loyaltyRedemption.discountType === 'dollar_off'
      ? Number(loyaltyRedemption.discountValue) || 0
      : Math.round(rawSubtotal * (Number(loyaltyRedemption.discountValue) || 0) / 100 * 100) / 100;
    dollarOff += amt;
    sources.push({
      kind: 'redemption',
      amount: amt,
      label: loyaltyRedemption.rewardName || 'Reward redeemed',
    });
  }

  if (dollarOff <= 0) return null;
  // Never let the combined discount exceed the subtotal — selectTotals also
  // clamps but this keeps the displayed dollarOff honest.
  const cappedOff = Math.min(dollarOff, rawSubtotal);
  return {
    type:    'amount',
    value:   Math.round(cappedOff * 100) / 100,
    sources,
  };
}

// ── Derived totals ─────────────────────────────────────────────────────────
// bagFeeInfo: { bagTotal, ebtEligible, discountable } | null
//
// Session 51 — added optional 5th param `dualPricing` (the config block from
// usePOSConfig). When supplied AND pricingModel === 'dual_pricing', the
// returned object includes the surcharge math used by TenderModal:
//   baseSubtotal   — post-discount subtotal (= what tax + surcharge are computed against)
//   cardSurcharge  — surcharge that WOULD apply if the cashier picks card/debit
//   cardSurchargeTax — sales tax on the surcharge (when state.surchargeTaxable)
//   cashGrandTotal — what customer pays with cash/EBT/check
//   cardGrandTotal — what customer pays with credit/debit
//   potentialSavings — cardGrandTotal − cashGrandTotal (always >= 0)
//
// When dualPricing is null OR pricingModel === 'interchange', these fields
// equal grandTotal / 0 / 0 / grandTotal / grandTotal / 0 — i.e. no behavioural
// change for stores that haven't enabled dual pricing.
export function selectTotals(items, taxRules = [], orderDiscount = null, bagFeeInfo = null, dualPricing = null) {
  const subtotal     = round2(items.reduce((s, i) => s + i.lineTotal, 0));
  const depositTotal = round2(items.reduce((s, i) => s + (i.depositTotal || 0), 0));

  let taxTotal = 0;
  for (const item of items) {
    if (!item.taxable || item.ebtEligible) continue;
    // Session 40 Phase 1 resolution order (strict-FK migration):
    //   1. Product-level explicit FK: item.taxRuleId → rule (per-product override)
    //   2. Department-linked rule via TaxRule.departmentIds[] (Option B)
    //   3. Legacy string match on appliesTo ↔ item.taxClass
    //   4. rate = 0 (no rule matched)
    // Every tier requires the rule to be `active: true`.
    const productRule = item.taxRuleId
      ? taxRules.find(r => r.active && Number(r.id) === Number(item.taxRuleId))
      : null;
    const deptRule = !productRule && item.departmentId
      ? taxRules.find(r => r.active && Array.isArray(r.departmentIds) && r.departmentIds.includes(Number(item.departmentId)))
      : null;
    const rule = productRule
      || deptRule
      || taxRules.find(r => r.active && (!r.departmentIds || r.departmentIds.length === 0) && matchTax(r.appliesTo, item.taxClass));
    taxTotal += item.lineTotal * (rule ? parseFloat(rule.rate) : 0);
  }
  taxTotal = round2(taxTotal);

  let discountAmount = 0;
  if (orderDiscount) {
    discountAmount = orderDiscount.type === 'percent'
      ? round2(subtotal * orderDiscount.value / 100)
      : round2(Math.min(orderDiscount.value, subtotal));
  }

  // Bag fee calculation
  const rawBagTotal = bagFeeInfo?.bagTotal || 0;
  let effectiveBagTotal = rawBagTotal;
  if (rawBagTotal > 0 && bagFeeInfo?.discountable && orderDiscount?.type === 'percent') {
    effectiveBagTotal = round2(rawBagTotal * (1 - orderDiscount.value / 100));
  }

  // EBT eligible: items + bags if configured
  const itemEbtTotal = round2(items.filter(i => i.ebtEligible).reduce((s, i) => s + i.lineTotal, 0));
  const ebtTotal = round2(itemEbtTotal + (bagFeeInfo?.ebtEligible ? effectiveBagTotal : 0));

  const grandTotal = round2(subtotal - discountAmount + depositTotal + taxTotal + effectiveBagTotal);

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

  // Session 51 — Dual Pricing math.
  //
  // baseSubtotal  = subtotal − discount + bag (what tax + surcharge
  //                 are computed against). Lottery + fuel + bottle-return
  //                 lines are NOT excluded here because they're already
  //                 represented in `subtotal` via lineTotal — the controller-
  //                 side surcharge tools strip those line types from the
  //                 baseSubtotal it persists. For UI purposes the TenderModal
  //                 typically displays the same combined figure.
  //
  // The cashGrandTotal == grandTotal when there's no dual pricing — kept as
  // separate field so consumers can switch by tender without re-doing math.
  const baseSubtotal = round2(subtotal - discountAmount + effectiveBagTotal);

  let cardSurcharge = 0;
  let cardSurchargeTax = 0;
  let surchargeRate = 0;
  let surchargeFixedFee = 0;
  let surchargeTaxable = false;
  let rateSource = 'none';

  if (dualPricing && dualPricing.pricingModel === 'dual_pricing' && baseSubtotal > 0) {
    // Resolve effective rate (custom > tier > zero) — same priority as backend.
    const tier        = dualPricing.pricingTier;
    const customPct   = dualPricing.customSurchargePercent;
    const customFee   = dualPricing.customSurchargeFixedFee;
    const usingCustom = customPct != null && customFee != null;

    if (usingCustom) {
      surchargeRate     = Number(customPct) || 0;
      surchargeFixedFee = Number(customFee) || 0;
      rateSource        = 'custom';
    } else if (tier) {
      surchargeRate     = Number(tier.surchargePercent)  || 0;
      surchargeFixedFee = Number(tier.surchargeFixedFee) || 0;
      rateSource        = 'tier';
    }

    if (surchargeRate > 0 || surchargeFixedFee > 0) {
      cardSurcharge = round2((baseSubtotal * surchargeRate) / 100 + surchargeFixedFee);
      surchargeTaxable = !!dualPricing.state?.surchargeTaxable;

      // Effective tax rate for surcharge — use the cart's blended tax rate so
      // the surcharge tax matches the rate actually applied to taxable items.
      // Falls back to 0 when nothing is taxable (no tax to mirror onto surcharge).
      const taxableSubtotal = items
        .filter(i => i.taxable && !i.ebtEligible)
        .reduce((s, i) => s + i.lineTotal, 0);
      const blendedTaxRate = taxableSubtotal > 0 ? taxTotal / taxableSubtotal : 0;
      if (surchargeTaxable && blendedTaxRate > 0) {
        cardSurchargeTax = round2(cardSurcharge * blendedTaxRate);
      }
    }
  }

  const cashGrandTotal = grandTotal;
  const cardGrandTotal = round2(grandTotal + cardSurcharge + cardSurchargeTax);
  const potentialSavings = round2(cardGrandTotal - cashGrandTotal);

  return {
    subtotal, discountAmount, depositTotal, ebtTotal, taxTotal, grandTotal,
    promoSaving, bagTotal: effectiveBagTotal,
    // Session 51 — dual pricing
    baseSubtotal,
    cardSurcharge,
    cardSurchargeTax,
    surchargeRate,
    surchargeFixedFee,
    surchargeTaxable,
    rateSource,
    cashGrandTotal,
    cardGrandTotal,
    potentialSavings,
  };
}

// Wildcard rule `appliesTo` values that apply to ANY taxable item. `none` is
// treated as a wildcard because the default "General Sales Tax" seed ships
// with `appliesTo='none'` and was historically used as a catch-all. `standard`
// is the default taxClass on new products, so treating it as a wildcard on
// rule side too lets retailers create a single rule that catches everything.
const TAX_RULE_WILDCARDS = new Set(['', 'all', 'any', '*', 'standard', 'none']);

function matchTax(appliesTo, taxClass) {
  const applied = String(appliesTo || '').toLowerCase().trim();
  if (TAX_RULE_WILDCARDS.has(applied)) return true;
  const list = applied.split(',').map(s => s.trim()).filter(Boolean);
  if (list.includes(String(taxClass || '').toLowerCase().trim())) return true;
  // If any entry is a wildcard, the rule applies universally
  return list.some(x => TAX_RULE_WILDCARDS.has(x));
}
