/**
 * TenderModal v7 — side-by-side layout, phone-style numpad, no scrolling.
 *
 * Amount state stores raw DIGITS (phone-terminal style):
 *   typing "589" → $5.89   |   backspace → $0.58
 *   pressing $30 preset   → digits "3000" → display "$30.00"
 *
 * Layout: left column (context) + right column (numpad) — no scrolling needed.
 *
 * Screens:
 *   change       → full-width change-due card
 *   card-quick   → full-width tap-terminal card
 *   manual_card  → side-by-side dedicated
 *   manual_ebt   → side-by-side dedicated
 *   entry        → side-by-side full modal (numpad hidden for 'card' method)
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  X, DollarSign, CreditCard, Leaf, Smartphone,
  MoreHorizontal, Check, RotateCcw,
  RefreshCw, Trash2, PlusCircle, Wifi, WifiOff,
  UserCheck,
} from 'lucide-react';
import NumPadInline, { digitsToNumber, numberToDigits } from '../pos/NumPadInline.jsx';
import { useCartStore, selectTotals, computeEffectiveDiscount } from '../../stores/useCartStore.js';
import { useSyncStore }  from '../../stores/useSyncStore.js';
import { useAuthStore }  from '../../stores/useAuthStore.js';
import { submitTransaction } from '../../api/pos.js';
import * as posApi from '../../api/pos.js';
import { useConfirm } from '../../hooks/useConfirmDialog.jsx';
import { fmt$, fmtDate, fmtTime, fmtTxNumber } from '../../utils/formatters.js';
import { getSmartCashPresets, applyRounding } from '../../utils/cashPresets.js';
import { describeDejavooError } from '../../utils/dejavooErrorCodes.js';
import { buildDejavooCart } from '../../utils/dejavooCart.js';
import { nanoid } from 'nanoid';
import { useHardware, loadHardwareConfig } from '../../hooks/useHardware.js';
import { useStationStore } from '../../stores/useStationStore.js';
import './TenderModal.css';

// ── Method definitions ────────────────────────────────────────────────────────
const METHODS = [
  { id: 'cash',        label: 'Cash',        Icon: DollarSign,     color: 'var(--green)',          bg: 'rgba(122,193,67,.15)',  border: 'rgba(122,193,67,.4)'  },
  { id: 'card',        label: 'Card',        Icon: CreditCard,     color: 'var(--blue)',           bg: 'rgba(59,130,246,.15)',  border: 'rgba(59,130,246,.4)'  },
  { id: 'ebt',         label: 'EBT',         Icon: Leaf,           color: '#34d399',               bg: 'rgba(52,211,153,.13)',  border: 'rgba(52,211,153,.4)'  },
  { id: 'manual_card', label: 'Manual Card', Icon: Smartphone,     color: 'var(--text-secondary)', bg: 'rgba(255,255,255,.07)', border: 'rgba(255,255,255,.18)'},
  { id: 'manual_ebt',  label: 'Manual EBT',  Icon: Leaf,           color: '#6ee7b7',               bg: 'rgba(110,231,183,.1)',  border: 'rgba(110,231,183,.3)' },
  // Charge: house-account tender. Only shown when the attached customer has
  // instoreChargeEnabled=true. Backend validates against balanceLimit and
  // increments Customer.balance atomically so concurrent terminals can't
  // both push a charge over the limit. Voids/refunds decrement the balance.
  { id: 'charge',      label: 'Charge',      Icon: UserCheck,      color: '#a855f7',               bg: 'rgba(168,85,247,.13)',  border: 'rgba(168,85,247,.4)'  },
  { id: 'other',       label: 'Other',       Icon: MoreHorizontal, color: 'var(--text-secondary)', bg: 'rgba(255,255,255,.07)', border: 'rgba(255,255,255,.18)'},
];
const BY_ID       = Object.fromEntries(METHODS.map(m => [m.id, m]));
// All methods can now accept partial amounts. Integrated card/ebt partials
// charge the Dejavoo/PAX terminal for the entered amount when the cashier
// clicks "Add & Continue", so Card+Card and Card+EBT splits work natively.
const HAS_AMOUNT  = ['cash', 'card', 'ebt', 'manual_card', 'manual_ebt', 'charge', 'other'];
// Methods that route through the integrated payment terminal
const USES_TERMINAL = ['card', 'ebt'];
const GIVES_CHANGE = ['cash'];
// Session 51 — Tender methods that trigger the dual-pricing surcharge.
// Mirrors backend/src/services/dualPricing.ts CARD_TENDERS. Used to decide
// when grandTotal should swap to the card-inclusive total.
const CARD_SURCHARGE_TENDERS = new Set(['card', 'credit', 'debit', 'manual_card']);

// Style helpers kept as shortcuts referencing CSS classes
const s = {
  backdrop: 'tm-backdrop',
  hdr: 'tm-header',
  closeBtn: 'tm-close-btn',
  splitAddBtn: 'tm-split-add-btn',
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function TenderModal({
  onClose,
  onComplete,              // optional: called with (completedTx) after transaction saves
  onPrint,                 // optional: (tx) → send directly to hardware printer
  taxRules       = [],
  initMethod     = null,
  initCashAmount = null,   // numeric dollar amount from quick-cash buttons
  cashRounding   = 'none',
  lotteryCashOnly = false,
  fuelCashOnly    = false,
  bagFeeInfo     = null,   // { bagTotal, ebtEligible, discountable } | null
  bagCount       = 0,
  bagPrice       = 0,
  shiftId        = null,   // active Shift.id — attached to the saved transaction
  dualPricing    = null,   // Session 51 — { pricingModel, pricingTier, customSurcharge*, state, ... } from usePOSConfig
}) {
  const confirm = useConfirm();
  const { items, clearCart, customer, loyaltyRedemption, orderDiscount, couponRedemptions } = useCartStore();

  // Single source of truth for cart-level discount math (customer standing %
  // + manual order discount + loyalty redemption). Same helper POSScreen uses
  // so the cart total and the tender total never disagree.
  const effectiveCombinedDiscount = useMemo(
    () => computeEffectiveDiscount({ items, customer, orderDiscount, loyaltyRedemption }),
    [items, customer, orderDiscount, loyaltyRedemption]
  );

  // Session 51 — passing `dualPricing` enables cashGrandTotal / cardGrandTotal /
  // cardSurcharge / potentialSavings on `totals`. When the store runs the
  // 'interchange' model (default), these all collapse to the existing
  // grandTotal so legacy code paths see no change.
  //
  // The `grandTotal` returned here is always the CASH total. Below (after
  // `splits` + `method` states are declared) we override it with the
  // card-inclusive total when the active/committed tender uses a card. All
  // downstream math (remaining, change, terminal charge amount, canComplete)
  // automatically picks up the correct value.
  const totals = selectTotals(items, taxRules, effectiveCombinedDiscount, bagFeeInfo, dualPricing);
  const isDualPricing = dualPricing?.pricingModel === 'dual_pricing';
  const hasLotteryItems  = items.some(i => i.isLottery);
  const hasFuelItems     = items.some(i => i.isFuel);

  // 3f — lottery cash-only enforcement now handles MIXED carts correctly:
  // when the cart has BOTH lottery and non-lottery items, we no longer block
  // all card tenders. Instead we compute the lottery portion as a "cash floor"
  // that must be covered by cash, and let the rest of the cart use any tender.
  const lotteryAmount = Math.max(0, items.filter(i => i.isLottery)
    .reduce((s, i) => s + Math.abs(Number(i.lineTotal || 0)), 0));
  const fuelAmount = Math.max(0, items.filter(i => i.isFuel)
    .reduce((s, i) => s + Math.abs(Number(i.lineTotal || 0)), 0));
  const cashMinFloor = (lotteryCashOnly && hasLotteryItems ? lotteryAmount : 0)
                     + (fuelCashOnly    && hasFuelItems    ? fuelAmount    : 0);
  const cashMinFloorR = Math.round(cashMinFloor * 100) / 100;
  const hasCashFloor = cashMinFloorR > 0.005;

  // Cart is pure lottery/fuel-only (every item falls under a cash-only
  // category). Keep the original strict behaviour — only cash allowed.
  const isPureCashOnlyCart = hasCashFloor &&
    (totals.grandTotal > 0 && Math.abs(cashMinFloorR - totals.grandTotal) < 0.01);

  // ── Charge-account eligibility ────────────────────────────────────────────
  // The 'charge' tender requires (a) a customer attached, (b) charge account
  // enabled on that customer, and (c) at least some headroom under the
  // balanceLimit. We surface the available room so the cashier can split
  // (e.g. $80 charge + $20 cash when the limit is reached).
  const customerBalance      = Number(customer?.balance || 0);
  const customerBalanceLimit = Number(customer?.balanceLimit || 0);
  const customerChargeOpen   = !!customer?.instoreChargeEnabled;
  const customerChargeRoom   = customerChargeOpen
    ? Math.max(0, Math.round((customerBalanceLimit - customerBalance) * 100) / 100)
    : 0;
  // When the limit is 0 we treat that as "unlimited" (matches back-office
  // semantics: 0/blank limit field means no cap).
  const chargeAllowed = customerChargeOpen && (customerBalanceLimit <= 0 || customerChargeRoom > 0.005);

  const cashier  = useAuthStore(s => s.cashier);
  const { isOnline, enqueue } = useSyncStore();

  // Integrated card / EBT need a live backend round-trip (Dejavoo cloud or
  // a PAX-via-backend call). When the cashier-app is offline, these can't
  // possibly succeed — disable them upfront instead of silently failing
  // mid-charge. Manual card / Manual EBT (cashier confirmed-by-eye on a
  // separate device) and Cash still work.
  const allowedMethods = isPureCashOnlyCart
    ? METHODS.filter(m => m.id === 'cash')
    : METHODS.filter(m => {
        if (m.id === 'charge' && !chargeAllowed) return false;
        if (!isOnline && (m.id === 'card' || m.id === 'ebt')) return false;
        return true;
      });
  const station  = useStationStore(s => s.station);

  // ── State ──────────────────────────────────────────────────────────────────
  const [splits,  setSplits]  = useState([]);
  // When lottery cash-only is enforced, always start on cash regardless of initMethod
  const [method,  setMethod]  = useState(
    isPureCashOnlyCart
      ? 'cash'
      // When the cashier-app is offline, integrated card/EBT are gated out.
      // Drop into Cash so the modal opens on a usable screen; the cashier
      // can switch to Manual Card if they want to confirm a charge made on
      // a separate device.
      : (!isOnline && (initMethod === 'card' || initMethod === 'ebt')
          ? 'cash'
          : (initMethod || (totals.ebtTotal > 0 && isOnline ? 'ebt' : 'cash')))
  );
  const [payStatus,   setPayStatus]   = useState(null); // null | 'waiting' | 'approved' | 'declined' | 'error'
  const [payResult,   setPayResult]   = useState(null);
  const hw = loadHardwareConfig();
  const hasPAX = !!(hw?.paxTerminal?.enabled && hw?.paxTerminal?.ip);

  // Dejavoo merchant status — null until loaded; { configured, provider, ebtEnabled, ... }
  const [dejavooStatus, setDejavooStatus] = useState(null);
  // Dejavoo last-transaction tracking so we can abort an in-flight charge
  const [djReferenceId,    setDjReferenceId]    = useState(null);
  const [djPaymentTxId,    setDjPaymentTxId]    = useState(null);
  // Last offline-mode warning from SPIn (P17 stores-and-forwards)
  const [djOfflineWarning, setDjOfflineWarning] = useState(false);
  const djLoadedRef = useRef(false);

  useEffect(() => {
    if (djLoadedRef.current) return;
    djLoadedRef.current = true;
    // Pass storeId via header so the backend can resolve the right merchant.
    // Without it, /merchant-status returns { configured: false } and the
    // cashier-app silently treats every card swipe as "approved" without
    // actually charging — see chargeTerminal() fallback below.
    const storeIdHere = cashier?.storeId || cashier?.stores?.[0]?.storeId;
    posApi.dejavooMerchantStatus(storeIdHere)
      .then(s => setDejavooStatus(s))
      .catch(() => setDejavooStatus({ configured: false }));
  }, [cashier]); // eslint-disable-line

  // If connection drops while the cashier is on the card / EBT screen, slide
  // them back to Cash so they don't tap "Charge" against a dead network.
  // Doesn't touch any in-flight payment — payStatus === 'waiting' already
  // blocks UI changes via the existing complete() flow.
  useEffect(() => {
    if (!isOnline && (method === 'card' || method === 'ebt') && payStatus !== 'waiting') {
      setMethod('cash');
      setAmount('');
      setNote('');
    }
  }, [isOnline, method, payStatus]);

  const hasDejavoo    = !!(dejavooStatus?.configured && dejavooStatus?.provider === 'dejavoo' && dejavooStatus?.hasTpn);
  const ebtEnabled    = hasDejavoo ? !!dejavooStatus?.ebtEnabled : true;
  // Signature threshold is now per-merchant (PaymentMerchant may add it later).
  // Default $25 matches typical processor requirement.
  const signatureThreshold = 25;

  // ── Session 51 — Dual Pricing tender-aware total override ─────────────
  // When the active method (or any committed split) is a card tender, swap
  // grandTotal to the card-inclusive figure so all downstream math reflects
  // what's actually charged. When mixed (e.g. $50 cash + $50 card split),
  // we still use the card-inclusive total since ANY card portion triggers
  // the surcharge per industry practice.
  //
  // We mutate the `totals` object in place (it was created locally by
  // selectTotals — not React state, so safe) so existing references keep
  // working. The override applies only when isDualPricing is true.
  const _splitsHasCard = splits.some(s => CARD_SURCHARGE_TENDERS.has(s.method));
  const _activeIsCard  = CARD_SURCHARGE_TENDERS.has(method);
  const _usesCardTender = isDualPricing && (_splitsHasCard || _activeIsCard);
  if (_usesCardTender && totals.cardGrandTotal != null) {
    totals.grandTotal = totals.cardGrandTotal;
  }

  // amount = raw digit string. "2694" → $26.94  (phone-terminal style)
  const [amount,  setAmount]  = useState(initCashAmount ? numberToDigits(initCashAmount) : '');
  const [note,    setNote]    = useState('');
  const [saving,  setSaving]  = useState(false);

  const [screen,       setScreen]       = useState('entry');
  const [completedTx,  setCompletedTx]  = useState(null);
  const [completedChg, setCompletedChg] = useState(0);

  // ── Derived values ─────────────────────────────────────────────────────────
  const totalSplit = splits.reduce((s, l) => s + l.amount, 0);
  const remaining  = Math.max(0, Math.round((totals.grandTotal - totalSplit) * 100) / 100);
  const activeAmt  = digitsToNumber(amount);  // digit string → dollars

  const isRefundTx = totals.grandTotal < -0.005;

  const rawChange = isRefundTx
    ? Math.abs(totals.grandTotal)
    : (GIVES_CHANGE.includes(method) && activeAmt > remaining ? activeAmt - remaining : 0);
  const change = applyRounding(rawChange, cashRounding);

  const presets = useMemo(() => getSmartCashPresets(remaining), [remaining]);

  // 3f — effective cash committed so far (splits[cash] + current cash entry)
  const cashFromSplits = splits.filter(s => s.method === 'cash').reduce((s, l) => s + l.amount, 0);
  const cashEntryActive = method === 'cash' ? Math.min(activeAmt, remaining) : 0;
  const cashCommitted = Math.round((cashFromSplits + cashEntryActive) * 100) / 100;
  const cashFloorShortfall = hasCashFloor
    ? Math.max(0, Math.round((cashMinFloorR - cashCommitted) * 100) / 100)
    : 0;

  // Cap the charge amount at the customer's remaining limit so the cashier
  // can't accidentally tender more than the account supports.
  const chargeMaxFromLimit = customerBalanceLimit > 0 ? customerChargeRoom : Infinity;

  const canComplete = useMemo(() => {
    if (isRefundTx) return true;  // refund/bottle return: always completeable
    // 3f — enforce cash floor from lottery/fuel items before letting card
    // tender close out the cart.
    if (cashFloorShortfall > 0.005) return false;
    if (totalSplit >= totals.grandTotal - 0.005) return true;   // fully covered by splits
    if (method === 'manual_card') return remaining > 0;
    if (USES_TERMINAL.includes(method)) {
      // Integrated card/ebt: if cashier typed an amount, they want to charge exactly that.
      // If no amount typed, charge the full remaining. Either needs remaining > 0.
      return remaining > 0;
    }
    if (GIVES_CHANGE.includes(method)) return activeAmt >= remaining - 0.005;
    if (method === 'manual_ebt') return activeAmt > 0;
    if (method === 'charge') {
      if (!chargeAllowed) return false;
      // Cashier may type a partial; default to full remaining when blank.
      const want = activeAmt > 0 ? activeAmt : remaining;
      return want > 0 && want <= chargeMaxFromLimit + 0.005;
    }
    if (method === 'other') return activeAmt > 0;
    return false;
  }, [isRefundTx, cashFloorShortfall, method, activeAmt, remaining, totalSplit, totals.grandTotal, chargeAllowed, chargeMaxFromLimit]);

  // Auto-fire the pinpad when the cashier picks Card or EBT.
  //
  // Why: prior UX required two taps — pick Card → tap "Complete & Charge".
  // The cashier-app's purpose is the second tap; the terminal already shows
  // the customer the amount on its own screen, so the cashier shouldn't have
  // to confirm it on our side first. Auto-fire on method change cuts the
  // round-trip in half.
  //
  // Guards to NOT auto-fire (when manual flow is what the cashier wants):
  //   - terminal not configured  → let the user hit Complete and see the
  //     proper "no terminal configured" decline message
  //   - amount typed on numpad   → cashier wants a partial charge, not full
  //   - payStatus already set    → a charge is already in flight / declined /
  //     approved, never double-fire
  //   - remaining ≈ 0            → nothing to charge
  //   - already auto-fired this method  → ref guard prevents loops if the
  //     effect re-runs (e.g. dejavooStatus async load)
  //
  // NOTE: prior versions ALSO blocked when `splits.length > 0` to keep
  // mid-split flows manual. We removed that guard because of the smart
  // next-method advance in `addSplitLine`: after a partial cash split
  // commits, we auto-suggest 'card' for the remaining balance. Blocking
  // auto-fire there forced the cashier back to clicking Complete or the
  // big split-add CTA, defeating the convenience. Distinguishing partial
  // vs full charge is now done by the `amount` guard alone — if the
  // cashier typed something, they want partial; if not, they want the
  // full remaining (auto-fire). Splits don't change that signal.
  //
  // ALSO NOTE: must live AFTER `hasDejavoo`, `ebtEnabled`, `amount`, `saving`,
  // and `remaining` are declared — the dep array is evaluated synchronously
  // during render, and any const referenced before its declaration triggers
  // a TDZ ReferenceError. Earlier placement broke first mount.
  const cardAutoFireRef = useRef(null);
  useEffect(() => {
    // Reset the guard whenever the cashier switches AWAY from card/ebt so a
    // later switch back can auto-fire fresh.
    if (method !== 'card' && method !== 'ebt') {
      cardAutoFireRef.current = null;
      return;
    }
    if (cardAutoFireRef.current === method) return;          // already fired for this method
    if (!hasDejavoo && !hasPAX) return;                       // no integration → manual flow + hard-fail
    if (method === 'ebt' && !ebtEnabled) return;              // EBT disabled at merchant
    if (amount) return;                                       // cashier typed an amount → wants partial
    if (payStatus != null) return;                            // already charging / done
    if (remaining < 0.005) return;                            // nothing to charge
    if (saving) return;                                       // post-charge save in progress
    cardAutoFireRef.current = method;
    // Use a microtask delay so the UI shows the "method = card" highlight
    // before the terminal call begins. Pure UX polish.
    Promise.resolve().then(() => complete());
    // Note: complete is referenced via closure — we don't list it as a dep
    // because that would re-run this effect every render. The ref guard
    // ensures we only call it once per method-selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, hasDejavoo, hasPAX, ebtEnabled, amount, payStatus, remaining, saving]);

  /**
   * Centralised "retry the failed/declined sale" handler.
   *
   * The sale-fired-but-failed flow leaves a few stateful traps that ALL need
   * resetting for a retry to actually re-fire:
   *
   *   - payStatus: 'declined' → null   (UI no longer shows decline screen)
   *   - payResult: error obj → null    (clears the From-Terminal text below)
   *   - cardAutoFireRef.current → null (otherwise the auto-fire effect sees
   *                                     "already fired for this method" and
   *                                     short-circuits — this was the bug
   *                                     reported in live testing where the
   *                                     second tap never reached the device)
   *
   * After retry-reset, the auto-fire effect re-evaluates conditions and
   * fires Sale again automatically when method=card/ebt + remaining > 0
   * + terminal configured + online. Cashier doesn't need a separate tap.
   *
   * Also: as a UX bonus, fire-and-forget pushes the cart back to the
   * terminal display so the customer screen returns to the cart view
   * before the new payment prompt overlays — covers the "terminal stuck
   * on stale failed-payment screen" symptom from the live test.
   */
  const handleRetry = () => {
    setPayStatus(null);
    setPayResult(null);
    setDjPaymentTxId(null);
    setDjReferenceId(null);
    setDjOfflineWarning(false);
    cardAutoFireRef.current = null;
    // Re-push the cart to bring the terminal back to the cart view so the
    // customer doesn't sit on a stale "Payment Declined" screen. Same
    // gates as the cart-sync hook — silent on failure.
    if (hasDejavoo && station?.id && isOnline) {
      const cart = buildDejavooCart(items, totals, { chargeAmount: remaining });
      if (cart) {
        posApi.dejavooPushCart({ stationId: station.id, cart }).catch(err => {
          console.warn('[TenderModal] retry cart-push failed', err?.message);
        });
      }
    }
  };

  const canAddSplit = HAS_AMOUNT.includes(method) && activeAmt > 0 && activeAmt < remaining - 0.005;

  // Numpad shows for every method now (card/ebt can accept partial amounts)
  const showNumpad  = HAS_AMOUNT.includes(method);

  const storeId  = cashier?.storeId || cashier?.stores?.[0]?.storeId;
  const txNumber = `TXN-${Date.now().toString(36).toUpperCase()}`;

  // ── Helpers ────────────────────────────────────────────────────────────────
  const switchMethod = (id) => { setMethod(id); setAmount(''); setNote(''); };

  /**
   * Charge the integrated payment terminal (Dejavoo or PAX) for a specific
   * amount. Used by both addSplitLine (partial) and complete (final).
   * Returns: { approved, result, offlineAccepted } on success
   * Throws:  on network/config error. On decline, returns { approved: false, result }.
   */
  const chargeTerminal = async (chargeAmount, chargeMethod) => {
    // Hard-stop integrated card / EBT when offline. The backend round-trip to
    // /payment/dejavoo/sale (or /payment/pax/sale) cannot succeed without
    // network — better to surface a clear error than to let axios time out
    // and have the cashier wonder if the card was charged. Manual card /
    // Manual EBT explicitly do NOT route through the terminal.
    if (!isOnline && (chargeMethod === 'card' || chargeMethod === 'ebt')) {
      return {
        approved: false,
        result: {
          approved: false,
          message:
            'Cashier-app is offline. Card / EBT requires a live connection to the payment terminal. Switch to Cash or Manual Card.',
        },
        paymentTransactionId: null,
        referenceId: null,
        offlineAccepted: false,
      };
    }
    if (hasDejavoo) {
      // PaymentType — Dejavoo SPIn enum is case-sensitive per Theneo docs.
      // 'Credit' is the canonical value for a generic card sale (matches the
      // sample request in the spec); 'Card' is a generic chooser that requires
      // multiple payment apps installed on the terminal and triggers
      // StatusCode 1003 "Not Supported" on UAT merchants where only Credit is
      // provisioned. Backend also normalizes — sending the canonical value
      // here keeps the payload self-documenting.
      const paymentType = chargeMethod === 'ebt' ? 'EBT_Food' : 'Credit';
      // CLIENT-GENERATED REFERENCE ID — critical for timeout recovery.
      // We pre-mint a UUID v4, send it in the body, AND remember it locally so
      // that if the HTTP round-trip times out (network blip, slow card-read,
      // etc.) we can still query Dejavoo's /v2/Payment/Status with this same
      // id and reconcile the actual outcome. Without this, the cashier-app
      // had no way to recover from timeouts → orphaned approved sales.
      // The crypto-quality randomness is fine because Dejavoo treats this as
      // an opaque batch-unique key (their docs say "alphanumeric, 1-50 chars").
      const refId =
        (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
        // Fallback for older browsers — UUID v4 via Math.random
        ('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        }));
      // Build the customer-facing cart payload so the P17 displays line
      // items + cart amounts during the card prompt. Dejavoo's terminal
      // shows this as a scrollable list — much better trust UX than a
      // bare total. We pass `chargeAmount` separately so split-tender
      // partials show "Charging Now: $X" alongside the cart's grand total.
      // Falls back to null on empty / malformed cart, in which case the
      // request omits the Cart object and the terminal falls back to its
      // default "Sale $X.XX" prompt.
      const cartForTerminal = buildDejavooCart(items, totals, {
        chargeAmount: Math.abs(chargeAmount),
      });
      try {
        const resp = await posApi.dejavooSale({
          stationId:     station?.id,
          amount:        Math.abs(chargeAmount),
          invoiceNumber: txNumber,
          paymentType,
          referenceId:   refId,
          captureSignature: Number(chargeAmount) >= Number(signatureThreshold),
          ...(cartForTerminal ? { cart: cartForTerminal } : {}),
        });
        const result = resp?.result || resp || {};
        const raw    = result._raw || {};
        const offlineAccepted = result.approved && (
          raw.OfflineMode === true || raw.StoredOffline === true ||
          result.message?.toLowerCase().includes('offline')
        );
        return {
          approved: !!result.approved,
          result,
          paymentTransactionId: resp?.paymentTransactionId || null,
          referenceId: result.referenceId || refId,
          offlineAccepted,
        };
      } catch (err) {
        // Timeout / network error during the sale POST. The terminal MAY have
        // approved before our HTTP socket gave up — recover by querying status.
        // axios sets err.code='ECONNABORTED' for timeouts, no response body.
        const isTimeoutOrNetwork = !err?.response;
        if (!isTimeoutOrNetwork) throw err;  // real HTTP error → bubble up

        // Reconciliation pass — give Dejavoo cloud + the device a moment to
        // converge, then query Status with our pre-minted referenceId.
        // We try up to 3 times with backoff; the device may need a few
        // seconds after the customer dips/taps the card.
        await new Promise(r => setTimeout(r, 1500));
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const statusResp = await posApi.dejavooTransactionStatus({
              stationId: station?.id,
              referenceId: refId,
            });
            const sresult = statusResp?.result || statusResp || {};
            // Dejavoo returns approved=true with full card data once the
            // transaction has settled in the cloud. If still not found,
            // attempt again. If permanently not found (3 fails), surface
            // a "verify on terminal" prompt.
            if (sresult.approved) {
              return {
                approved: true,
                result: { ...sresult, _recoveredFromTimeout: true },
                paymentTransactionId: statusResp?.paymentTransactionId || null,
                referenceId: refId,
                offlineAccepted: false,
              };
            }
            // Cloud says explicit decline (not "not found") — treat as decline
            const code = String(sresult.statusCode || '');
            if (code && !/not\s*found/i.test(`${sresult.message || ''} ${sresult.detailedMessage || ''}`)) {
              return {
                approved: false,
                result: sresult,
                paymentTransactionId: null,
                referenceId: refId,
                offlineAccepted: false,
              };
            }
            // Otherwise (status not found yet): wait + retry
            await new Promise(r => setTimeout(r, 2000));
          } catch (statusErr) {
            // Status call itself failed — fall through to next attempt
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        // Couldn't reconcile — return a "needs manual verification" result.
        // Cashier-app's decline UI will show the headline + checklist.
        return {
          approved: false,
          result: {
            approved: false,
            message: 'Verification needed',
            detailedMessage:
              `Network timed out before we could confirm the sale. Check the terminal — if it shows APPROVED, do NOT retry; manager should manually record the sale. ReferenceId: ${refId}`,
            statusCode: '2007',
            resultCode: '2',
            referenceId: refId,
          },
          paymentTransactionId: null,
          referenceId: refId,
          offlineAccepted: false,
        };
      }
    }
    if (hasPAX && chargeMethod === 'card') {
      const resp = await posApi.paxSale({
        amount: chargeAmount,
        invoiceNumber: txNumber,
        edcType: '02',
        stationId: station?.id,
      });
      return {
        approved: !!resp.approved,
        result: resp.data || resp,
        paymentTransactionId: resp?.paymentTransactionId || null,
        referenceId: resp?.data?.referenceId || null,
        offlineAccepted: false,
      };
    }

    // ── No terminal configured ─────────────────────────────────────────────
    // Used to silently return `approved: true` here, which made the cart
    // close + receipt screen show without ever charging the card. That's
    // a footgun: cashier thinks the sale went through, customer leaves,
    // no money was charged.
    //
    // Now: hard-fail for card / ebt. Only the `manual_card` / `manual_ebt`
    // tender modes (where the cashier explicitly entered the card data
    // themselves on a separate device) should bypass terminal integration.
    if (chargeMethod === 'manual_card' || chargeMethod === 'manual_ebt') {
      return {
        approved: true,
        result: { message: 'Manual entry — cashier confirms charge' },
        paymentTransactionId: null,
        referenceId: null,
        offlineAccepted: false,
      };
    }
    return {
      approved: false,
      result: {
        approved: false,
        message: 'No payment terminal configured for this store. Set up Dejavoo or PAX in admin → Payments → Merchants, then activate.',
      },
      paymentTransactionId: null,
      referenceId: null,
      offlineAccepted: false,
    };
  };

  const [splitCharging, setSplitCharging] = useState(false);

  const addSplitLine = async () => {
    if (!HAS_AMOUNT.includes(method) || activeAmt <= 0 || splitCharging) return;
    const m = BY_ID[method];
    const commitAmount = Math.min(activeAmt, remaining);

    // For integrated card/ebt, charge terminal BEFORE committing the split.
    // Only commit on approval so the split lines mirror actual terminal charges.
    if (USES_TERMINAL.includes(method) && (hasDejavoo || hasPAX)) {
      setSplitCharging(true);
      setPayStatus('waiting');
      try {
        const r = await chargeTerminal(commitAmount, method);
        if (!r.approved) {
          setPayStatus('declined');
          setPayResult(r.result);
          return;
        }
        setPayStatus(null);
        setPayResult(null);
        setSplits(prev => [...prev, {
          id: nanoid(), method,
          label: note ? `${m.label} (${note})` : m.label,
          amount: commitAmount,
          paymentTransactionId: r.paymentTransactionId,
          referenceId: r.referenceId,
          lastFour: r.result.last4,
          cardType: r.result.cardType,
          authCode: r.result.authCode,
          entryMode: r.result.entryType,
          provider: hasDejavoo ? 'dejavoo' : 'pax',
          offlineAccepted: r.offlineAccepted,
        }]);
      } catch (err) {
        setPayStatus('error');
        setPayResult({ message: err?.response?.data?.error || err.message });
        return;
      } finally {
        setSplitCharging(false);
      }
    } else {
      setSplits(prev => [...prev, {
        id: nanoid(), method,
        label: note ? `${m.label} (${note})` : m.label,
        amount: commitAmount,
      }]);
    }
    setAmount(''); setNote('');

    // Smart next-method advance after a split commits.
    //
    // Old behaviour reset to 'cash' unconditionally, forcing the cashier
    // to manually pick the next tender every single time. New behaviour
    // picks the most likely next tender based on what was just committed,
    // so the typical "$X cash + $Y card" flow becomes one tap less:
    //
    //   cash committed         → suggest card (most common follow-on)
    //   manual_card committed  → suggest card (finish on integrated terminal)
    //   ebt / manual_ebt cmt'd → suggest cash (EBT covers food; cash for non-food)
    //   card committed         → suggest cash (already paid most; small balance)
    //   charge committed       → suggest cash (e.g. charge + cash tip)
    //   other committed        → suggest cash
    //
    // If the suggestion isn't in `allowedMethods` (e.g. card suggested but
    // offline, or card suggested but cash-only enforced), fall back to cash.
    // Cash is always allowed.
    const newRemaining = remaining - commitAmount;
    if (newRemaining > 0.005) {
      const suggestion =
        method === 'cash'         ? 'card' :
        method === 'manual_card'  ? 'card' :
        method === 'manual_ebt'   ? 'cash' :
        method === 'ebt'          ? 'cash' :
        method === 'card'         ? 'cash' :
        method === 'charge'       ? 'cash' :
        'cash';
      const allowed = allowedMethods.some(m2 => m2.id === suggestion);
      setMethod(allowed ? suggestion : 'cash');
    } else {
      // Fully covered — leave the cashier on cash so the Complete button
      // is the obvious next action; the auto-fire effect won't re-trigger
      // because remaining ≈ 0.
      setMethod('cash');
    }
  };

  const removeSplit = async (id) => {
    const line = splits.find(s => s.id === id);
    if (!line) return;
    // If this split charged the terminal, void it there too
    if (line.paymentTransactionId && USES_TERMINAL.includes(line.method)) {
      if (!await confirm({
        title: `Void ${line.method.toUpperCase()} charge?`,
        message: `Void the ${fmt$(line.amount)} charge on the terminal. This reverses the transaction at the processor and cannot be undone.`,
        confirmLabel: 'Void',
        danger: true,
      })) return;
      try {
        await posApi.dejavooVoid({
          stationId: station?.id,
          paymentTransactionId: line.paymentTransactionId,
          referenceId: line.referenceId || undefined,
        });
      } catch (err) {
        alert(`Terminal void failed: ${err?.response?.data?.error || err.message}. The split was NOT removed — please void manually on the terminal.`);
        return;
      }
    }
    setSplits(prev => prev.filter(l => l.id !== id));
  };

  const finish = (finalTx, cashChange) => {
    // Pass both the tx and the change amount so POSScreen can render
    // the unified ChangeDueOverlay (with auto-close + scan interrupt).
    onComplete?.(finalTx, cashChange);
    clearCart();
    onClose();
    setSaving(false);
  };

  const complete = async () => {
    if (!canComplete || saving) return;

    // ── Final terminal charge (Card / EBT) — only for the outstanding balance,
    // NOT the full grand total. Prior splits already charged their portions
    // via addSplitLine → chargeTerminal, so we only need to charge what's
    // still remaining when the cashier hits Complete with method=card/ebt.
    //
    // CRITICAL: when integration is NOT configured (hasDejavoo=false AND
    // hasPAX=false) and the cashier is using card/ebt, we MUST hard-fail
    // here. Previously we only entered this block when an integration was
    // configured, which meant a no-integration card sale fell straight
    // through to the "save POS transaction" step → silent success →
    // receipt screen, with NO money charged. That bug let cashiers
    // accidentally close out card sales without actually charging.
    if (USES_TERMINAL.includes(method) && !hasDejavoo && !hasPAX) {
      setPayStatus('declined');
      setPayResult({
        approved: false,
        message: 'No payment terminal configured',
        detailedMessage: 'Set up Dejavoo or PAX in admin → Payments → Merchants and activate the merchant before accepting card or EBT.',
        statusCode: '',
        resultCode: '',
      });
      return;
    }

    let finalTerminalResult = null;
    let finalTerminalTxId = null;
    if (USES_TERMINAL.includes(method) && (hasDejavoo || hasPAX) && payStatus !== 'approved') {
      const finalAmount = remaining;
      if (finalAmount > 0.005) {
        setPayStatus('waiting');
        setDjOfflineWarning(false);
        try {
          const r = await chargeTerminal(finalAmount, method);
          setDjReferenceId(r.referenceId || null);
          setDjPaymentTxId(r.paymentTransactionId || null);
          if (r.offlineAccepted) setDjOfflineWarning(true);
          if (!r.approved) {
            setPayStatus('declined');
            setPayResult(r.result);
            return;
          }
          setPayStatus('approved');
          setPayResult(r.result);
          finalTerminalResult = r.result;
          finalTerminalTxId = r.paymentTransactionId;
        } catch (err) {
          setPayStatus('error');
          setPayResult({ message: err?.response?.data?.error || err.message });
          return;
        }
      }
    }

    // Reset pay status before saving POS transaction
    setPayStatus(null);
    setPayResult(null);

    setSaving(true);

    // Preserve terminal metadata from prior committed splits
    const finalLines = splits.map(s => ({
      method: s.method,
      label:  s.label,
      amount: s.amount,
      ...(s.paymentTransactionId ? { paymentTransactionId: s.paymentTransactionId } : {}),
      ...(s.referenceId ? { referenceId: s.referenceId } : {}),
      ...(s.lastFour   ? { lastFour: s.lastFour } : {}),
      ...(s.cardType   ? { acctType: s.cardType } : {}),
      ...(s.authCode   ? { authCode: s.authCode } : {}),
      ...(s.entryMode  ? { entryMode: s.entryMode } : {}),
      ...(s.provider   ? { provider: s.provider } : {}),
      ...(s.offlineAccepted ? { offlineAccepted: true } : {}),
    }));
    if (isRefundTx) {
      // Refund transaction: cash is disbursed to customer
      finalLines.push({ method: 'cash', amount: Math.abs(totals.grandTotal), note: 'Refund/Bottle Return' });
    } else if (USES_TERMINAL.includes(method) || method === 'manual_card') {
      const line = { method, amount: remaining };
      if (finalTerminalResult) {
        if (finalTerminalTxId)            line.paymentTransactionId = finalTerminalTxId;
        if (finalTerminalResult.referenceId) line.referenceId = finalTerminalResult.referenceId;
        if (finalTerminalResult.last4)    line.lastFour = finalTerminalResult.last4;
        if (finalTerminalResult.cardType) line.acctType = finalTerminalResult.cardType;
        if (finalTerminalResult.authCode) line.authCode = finalTerminalResult.authCode;
        if (finalTerminalResult.entryType) line.entryMode = finalTerminalResult.entryType;
        line.provider = hasDejavoo ? 'dejavoo' : 'pax';
      }
      finalLines.push(line);
    } else if (method === 'charge') {
      // Charge defaults to full remaining when no explicit amount typed —
      // matches the cash/card "tap and complete" UX. Cap at the customer's
      // available limit so the backend won't 400 us.
      const want = Math.min(
        activeAmt > 0 ? activeAmt : remaining,
        chargeMaxFromLimit,
      );
      finalLines.push({ method: 'charge', amount: Math.round(want * 100) / 100, ...(note ? { note } : {}) });
    } else if (activeAmt > 0) {
      finalLines.push({ method, amount: activeAmt, ...(note ? { note } : {}) });
    }

    // Build line items, adding synthetic bag-fee entry if applicable
    const txLineItems = items.filter(i => !i.isLottery && !i.isFuel);
    if (bagCount > 0 && bagPrice > 0) {
      const bt = Math.round(bagCount * bagPrice * 100) / 100;
      txLineItems.push({
        isBagFee:     true,
        name:         'Bag Fee',
        qty:          bagCount,
        unitPrice:    bagPrice,
        effectivePrice: bagPrice,
        lineTotal:    bt,
        depositTotal: 0,
        taxable:      false,
        ebtEligible:  bagFeeInfo?.ebtEligible || false,
        discountEligible: false,
      });
    }

    // Session 51 — Dual Pricing snapshot. Surcharge fires when ANY finalLine
    // is a card tender. We persist the snapshot fields under their backend
    // column names (pricingModel / baseSubtotal / surcharge* / surchargeTax*)
    // so the Transaction row reflects the policy at sale time. This trail
    // keeps refunds + receipt reprints + EoD reports honest even after the
    // store later flips back to interchange.
    const finalLinesUseCard = finalLines.some(l => CARD_SURCHARGE_TENDERS.has(l.method));
    const dualPricingSnapshot = isDualPricing
      ? {
          pricingModel:       'dual_pricing',
          baseSubtotal:       totals.baseSubtotal,
          surchargeAmount:    finalLinesUseCard ? totals.cardSurcharge    : 0,
          surchargeTaxAmount: finalLinesUseCard ? totals.cardSurchargeTax : 0,
          surchargeRate:      totals.surchargeRate,
          surchargeFixedFee:  totals.surchargeFixedFee,
          surchargeTaxable:   !!totals.surchargeTaxable,
        }
      : { pricingModel: 'interchange' };

    const payload = {
      localId: nanoid(), storeId, txNumber,
      stationId: station?.id || null,
      shiftId: shiftId || null,
      lineItems: txLineItems,
      lotteryItems: items.filter(i => i.isLottery).map(i => ({
        type:   i.lotteryType,
        amount: Math.abs(i.lineTotal),
        gameId: i.gameId || undefined,
        notes:  i.name,
      })),
      fuelItems: items.filter(i => i.isFuel).map(i => ({
        type:           i.fuelType,                    // 'sale' | 'refund'
        fuelTypeId:     i.fuelTypeId || undefined,
        fuelTypeName:   i.fuelTypeName || 'Fuel',
        gallons:        Math.abs(Number(i.gallons) || 0),
        pricePerGallon: Math.abs(Number(i.pricePerGallon) || 0),
        amount:         Math.abs(Number(i.lineTotal)  || 0),
        entryMode:      i.entryMode || 'amount',
        taxAmount:      Math.abs(Number(i.taxAmount)  || 0),
        pumpId:         i.pumpId    || undefined,      // V1.5
        refundsOf:      i.refundsOf || undefined,      // V1.5
      })),
      // Manufacturer coupon redemptions (Session 46)
      couponRedemptions: (couponRedemptions || []).map(r => ({
        couponId:            r.couponId,
        serial:              r.serial,
        brandFamily:         r.brandFamily,
        manufacturerId:      r.manufacturerId,
        discountApplied:     r.discountApplied,
        qualifyingUpc:       r.qualifyingUpc,
        qualifyingQty:       r.qualifyingQty,
        managerApprovedById: r.managerApprovedById || undefined,
      })),
      tenderLines: finalLines,
      changeGiven: change,
      offlineCreatedAt: new Date().toISOString(),
      ...(customer?.id ? { customerId: customer.id } : {}),
      ...(loyaltyRedemption ? { loyaltyPointsRedeemed: loyaltyRedemption.pointsCost } : {}),
      ...totals,
      ...dualPricingSnapshot,
    };

    // (Terminal metadata is now applied inline per-split when each charge
    // completes — see the splits.map() above and the final-line push.)

    try {
      if (isOnline) {
        const saved = await submitTransaction(payload);
        finish({ ...payload, id: saved.id, txNumber: saved.txNumber || txNumber }, change);
      } else {
        await enqueue(payload);
        finish({ ...payload, txNumber }, change);
      }
    } catch {
      await enqueue(payload);
      finish({ ...payload, txNumber }, change);
    }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // SCREEN: CHANGE DUE
  // ════════════════════════════════════════════════════════════════════════════
  if (screen === 'change' && completedTx) {
    const handleDone  = () => { clearCart(); onClose(); };
    const handlePrint = () => { if (onPrint) onPrint(completedTx); clearCart(); onClose(); };
    const hasCashTender = completedTx.tenderLines?.some(t => t.method === 'cash');
    const tenderLines   = completedTx.tenderLines || [];
    const multiTender   = tenderLines.length > 1;

    return (
      <div className="tm-backdrop">
        <div style={{ width: '100%', maxWidth: 400, background: 'var(--bg-panel)', borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(122,193,67,.3)', boxShadow: '0 32px 80px rgba(0,0,0,.7)' }}>

          {/* Header */}
          <div style={{ background: 'rgba(122,193,67,.1)', borderBottom: '1px solid rgba(122,193,67,.2)', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Check size={15} color="#0f1117" strokeWidth={3} />
            </div>
            <span style={{ fontWeight: 800, color: isRefundTx ? '#34d399' : 'var(--green)', fontSize: '0.95rem' }}>
              {isRefundTx ? 'Refund Complete' : 'Sale Complete'}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{fmtTxNumber(completedTx.txNumber)}</span>
          </div>

          {/* Change amount */}
          <div style={{ padding: '1.5rem 1.5rem 0.75rem', textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 8 }}>
              {isRefundTx ? 'REFUND DUE TO CUSTOMER' : 'CHANGE DUE'}
            </div>
            <div style={{ fontSize: '4.5rem', fontWeight: 900, color: isRefundTx ? '#34d399' : 'var(--green)', letterSpacing: '-0.03em', lineHeight: 1 }}>{fmt$(completedChg)}</div>
            {cashRounding === '0.05' && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>Rounded to nearest $0.05</div>
            )}
          </div>

          {/* Tender breakdown */}
          <div style={{ margin: '0.5rem 1.25rem 0.75rem', background: 'var(--bg-input)', borderRadius: 10, padding: '0.6rem 0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: multiTender ? 6 : 0 }}>
              <span>Total charged</span>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{fmt$(totals.grandTotal)}</span>
            </div>
            {multiTender && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2 }}>
                {tenderLines.map((t, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 2 }}>
                    <span>{t.method.replace(/_/g, ' ').toUpperCase()}</span>
                    <span>{fmt$(t.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {!multiTender && tenderLines[0] && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {tenderLines[0].method.replace(/_/g, ' ').toUpperCase()}: {fmt$(tenderLines[0].amount)}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ padding: '0 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {hasCashTender && onPrint ? (
              <>
                <button onClick={handlePrint} className="tm-big-btn" style={{ background: 'var(--green)' }}>
                  <Check size={18} /> Print Receipt &amp; Done
                </button>
                <button onClick={handleDone} style={{ width: '100%', padding: '0.875rem', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, cursor: 'pointer' }}>
                  <RefreshCw size={16} /> Skip — New Sale
                </button>
              </>
            ) : (
              <button onClick={handleDone} className="tm-big-btn" style={{ background: 'var(--green)' }}>
                <RefreshCw size={18} /> Done — New Sale
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCREEN: CARD QUICK MODE (no numpad — just confirm)
  // Skipped when lottery cash-only is enforced — falls through to entry modal
  // ════════════════════════════════════════════════════════════════════════════
  if (initMethod === 'card' && splits.length === 0 && !isPureCashOnlyCart) {
    const isWaiting  = payStatus === 'waiting';
    const isApproved = payStatus === 'approved';
    const isDeclined = payStatus === 'declined' || payStatus === 'error';

    return (
      <div className="tm-backdrop">
        <div className="tm-modal tm-modal--narrow" style={{ border: `1px solid ${isApproved ? 'rgba(122,193,67,.4)' : isDeclined ? 'rgba(224,63,63,.4)' : 'rgba(59,130,246,.3)'}` }}>
          <div className="tm-header" style={{ background: isApproved ? 'rgba(122,193,67,.06)' : isDeclined ? 'rgba(224,63,63,.06)' : 'rgba(59,130,246,.06)', borderBottomColor: isApproved ? 'rgba(122,193,67,.2)' : isDeclined ? 'rgba(224,63,63,.2)' : 'rgba(59,130,246,.18)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CreditCard size={16} color={isApproved ? 'var(--green)' : isDeclined ? 'var(--red)' : 'var(--blue)'} />
              <span style={{ fontWeight: 800, fontSize: '0.95rem', color: isApproved ? 'var(--green)' : isDeclined ? 'var(--red)' : 'var(--blue)' }}>
                {isApproved ? 'Card Approved' : isDeclined ? 'Card Declined' : 'Card Payment'}
              </span>
            </div>
            <button onClick={onClose} className="tm-close-btn"><X size={16} /></button>
          </div>

          <div style={{ padding: '2rem 1.5rem 1rem', textAlign: 'center' }}>
            {/* Amount */}
            <div style={{ fontSize: '3.25rem', fontWeight: 900, color: isApproved ? 'var(--green)' : isDeclined ? 'var(--red)' : 'var(--blue)', letterSpacing: '-0.02em' }}>
              {fmt$(totals.grandTotal)}
            </div>

            {/* Status message */}
            {!isWaiting && !isApproved && !isDeclined && (
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: '0.88rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                {hasDejavoo
                  ? <><Wifi size={15} color="var(--blue)" /> Tap / swipe / insert on terminal</>
                  : <><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', display: 'inline-block', opacity: 0.8 }} /> Tap / swipe / insert on terminal</>
                }
              </div>
            )}

            {/* Terminal provider label */}
            {hasDejavoo && !isWaiting && !isApproved && !isDeclined && (
              <div style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Dejavoo {dejavooStatus?.environment === 'prod' ? '' : '(UAT)'} · Terminal ready
              </div>
            )}

            {/* Waiting spinner */}
            {isWaiting && (
              <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <RotateCcw size={28} color="var(--blue)" style={{ animation: 'spin 1s linear infinite' }} />
                <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Waiting for card…
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Customer: tap, swipe, or insert card on terminal
                </div>
              </div>
            )}

            {/* Approved — show card info */}
            {isApproved && payResult && (
              <div style={{ marginTop: 16, padding: '0.875rem 1rem', borderRadius: 10, background: 'rgba(122,193,67,.08)', border: '1px solid rgba(122,193,67,.25)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--green)', fontWeight: 700, letterSpacing: '0.06em' }}>APPROVED</div>
                {/* Dejavoo returns cardType; CardPointe returns acctType. Fall back across both. */}
                {(payResult.acctType || payResult.cardType) && (
                  <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {payResult.acctType || payResult.cardType} •••• {payResult.lastFour || payResult.last4}
                  </div>
                )}
                {(payResult.entryMode || payResult.entryType) && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {(payResult.entryMode || payResult.entryType).toString().toUpperCase()} · Auth: {payResult.authCode || '—'}
                  </div>
                )}
                {payResult.signatureCaptured && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--green)', marginTop: 2 }}>
                    ✓ Signature captured
                  </div>
                )}
                {/* P17 offline store-and-forward warning */}
                {djOfflineWarning && (
                  <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 6, background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <WifiOff size={12} color="#f59e0b" />
                    <span style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 600 }}>
                      Accepted offline — will sync when terminal reconnects
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Declined / error — translated through dejavooErrorCodes.js so
                the cashier sees a human-readable headline + actionable hint
                instead of raw "Code: 1 / Canceled" text. The full Dejavoo
                response is still surfaced below for support diagnostics. */}
            {isDeclined && (() => {
              const desc = describeDejavooError(payResult);
              const rawMsg    = desc.raw.message;
              const rawDetail = desc.raw.detailedMessage;
              const showCode  = desc.statusCode || desc.resultCode;
              return (
                <div style={{ marginTop: 16, padding: '0.875rem 1rem', borderRadius: 10, background: 'rgba(224,63,63,.08)', border: '1px solid rgba(224,63,63,.25)' }}>
                  {/* Cashier-friendly headline + hint */}
                  <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--red)' }}>
                    {desc.headline}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>
                    {desc.hint}
                  </div>
                  {/* Setup-class errors get the additional checklist for fixing the integration. */}
                  {desc.setup && (
                    <div style={{ marginTop: 8, padding: '0.6rem 0.8rem', borderRadius: 8, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--amber)', marginBottom: 4 }}>
                        Configuration issue — check this:
                      </div>
                      <ul style={{ margin: '0 0 0 18px', padding: 0, fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        <li>P17 is powered on, on its WiFi/Ethernet, showing "Listening for transaction…"</li>
                        <li>TPN, Register ID and Auth Key in admin → Payments match the device</li>
                        <li>The device serial is paired to this TPN in the iPOSpays portal</li>
                        <li>Sale capability is enabled for this merchant (UAT accounts often need this flipped on)</li>
                      </ul>
                    </div>
                  )}
                  {/* Raw Dejavoo response — small, separate, for support. */}
                  {(rawMsg || rawDetail) && (
                    <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,.03)', borderLeft: '2px solid var(--border)' }}>
                      <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                        From terminal
                      </div>
                      {rawMsg && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                          {rawMsg}
                        </div>
                      )}
                      {rawDetail && rawDetail !== rawMsg && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 1 }}>
                          {rawDetail}
                        </div>
                      )}
                    </div>
                  )}
                  {showCode && (
                    <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace', opacity: 0.7 }}>
                      {desc.statusCode && (<>StatusCode: {desc.statusCode}</>)}
                      {desc.statusCode && desc.resultCode && (<>{' · '}</>)}
                      {desc.resultCode && (<>ResultCode: {desc.resultCode}</>)}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          <div style={{ padding: '0 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {isApproved ? (
              /* After approved — complete the POS transaction */
              <button onClick={complete} disabled={saving} className="tm-big-btn" style={{ background: saving ? undefined : 'var(--green)' }}>
                {saving
                  ? <><RotateCcw size={18} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
                  : <><Check size={18} /> Confirm &amp; Complete Sale</>}
              </button>
            ) : isDeclined ? (
              /* Declined — retry or switch method */
              <>
                <button
                  onClick={handleRetry}
                  className="tm-big-btn" style={{ background: 'var(--blue, #3b82f6)' }}
                >
                  <RotateCcw size={18} /> Try Again
                </button>
                <button onClick={() => { handleRetry(); switchMethod('cash'); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer', padding: '4px 0' }}>
                  Use a different payment method
                </button>
              </>
            ) : isWaiting ? (
              /* Waiting — show cancel only */
              <button
                onClick={() => {
                  setPayStatus(null); setPayResult(null);
                  setDjPaymentTxId(null);
                  setDjOfflineWarning(false);
                  if (hasDejavoo && station?.id) {
                    posApi.dejavooCancel({
                      stationId: station.id,
                      referenceId: djReferenceId,
                    }).catch(() => {});
                    setDjReferenceId(null);
                  }
                }}
                style={{ width: '100%', padding: '0.875rem', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' }}
              >
                Cancel
              </button>
            ) : (
              /* Idle — kick off payment */
              <>
                <button onClick={complete} disabled={saving} className="tm-big-btn" style={{ background: saving ? undefined : 'var(--blue, #3b82f6)' }}>
                  {saving
                    ? <><RotateCcw size={18} style={{ animation: 'spin 1s linear infinite' }} /> Processing…</>
                    : hasDejavoo
                      ? <><CreditCard size={18} /> Charge Terminal — {fmt$(totals.grandTotal)}</>
                      : <><Check size={18} /> Payment Complete — Confirm</>}
                </button>
                <button onClick={() => switchMethod('cash')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer', padding: '4px 0' }}>
                  Split payment or other method
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCREEN: MANUAL CARD — side-by-side
  // ════════════════════════════════════════════════════════════════════════════
  if (method === 'manual_card' && splits.length === 0 && !initMethod) {
    return (
      <div className="tm-backdrop">
        <div className="tm-modal" style={{ maxWidth: 620 }}>
          {/* Header */}
          <div className="tm-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Smartphone size={16} color="var(--text-secondary)" />
              <div>
                <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Manual Card</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>No terminal — enter amount manually</div>
              </div>
            </div>
            <button onClick={onClose} className="tm-close-btn"><X size={16} /></button>
          </div>

          {/* Side-by-side body */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left — context */}
            <div style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
              {/* Amount to charge */}
              <div style={{ background: 'rgba(59,130,246,.06)', border: '1px solid rgba(59,130,246,.18)', borderRadius: 12, padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 6 }}>CHARGE AMOUNT</div>
                <div style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--blue)', letterSpacing: '-0.02em' }}>{fmt$(remaining)}</div>
              </div>
              {/* Charge-full shortcut */}
              <button
                onClick={() => setAmount(numberToDigits(remaining))}
                style={{
                  width: '100%', padding: '0.875rem', borderRadius: 10, cursor: 'pointer',
                  background: activeAmt === remaining && amount ? 'rgba(59,130,246,.12)' : 'var(--bg-input)',
                  border: `1.5px solid ${activeAmt === remaining && amount ? 'rgba(59,130,246,.4)' : 'var(--border)'}`,
                  color: activeAmt === remaining && amount ? 'var(--blue)' : 'var(--text-primary)',
                  fontWeight: 700, fontSize: '0.9rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'all .12s',
                }}
              >
                <Check size={14} /> Charge full — {fmt$(remaining)}
              </button>
              {activeAmt > 0 && activeAmt < remaining - 0.005 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--amber)', textAlign: 'center', fontWeight: 600 }}>
                  Remaining {fmt$(remaining - activeAmt)} needs another method
                </div>
              )}
            </div>
            {/* Right — numpad */}
            <div className="tm-numpad-col">
              <NumPadInline value={amount} onChange={setAmount} accentColor="var(--blue, #3b82f6)" />
            </div>
          </div>

          {/* Footer */}
          <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {canAddSplit && (
              <button onClick={addSplitLine} className="tm-split-add-btn">
                <PlusCircle size={14} /> Add {fmt$(activeAmt)} Manual Card — pay {fmt$(remaining - activeAmt)} with another method
              </button>
            )}
            <button onClick={complete} disabled={!canComplete || saving} className="tm-big-btn" style={{ background: (!canComplete || saving) ? undefined : 'var(--blue, #3b82f6)' }}>
              {saving ? <><RotateCcw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processing…</> : <><CreditCard size={16} /> Complete Manual Card — {fmt$(Math.min(activeAmt || remaining, remaining))}</>}
            </button>
            <button onClick={() => switchMethod('cash')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'center' }}>
              ← Back to payment methods
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCREEN: MANUAL EBT — side-by-side
  // ════════════════════════════════════════════════════════════════════════════
  if (method === 'manual_ebt' && splits.length === 0 && !initMethod) {
    const ebtMax = Math.min(totals.ebtTotal, remaining);
    return (
      <div className="tm-backdrop">
        <div className="tm-modal" style={{ maxWidth: 620 }}>
          {/* Header */}
          <div className="tm-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Leaf size={16} color="#6ee7b7" />
              <div>
                <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Manual EBT</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Enter EBT amount manually</div>
              </div>
            </div>
            <button onClick={onClose} className="tm-close-btn"><X size={16} /></button>
          </div>

          {/* Side-by-side body */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left */}
            <div style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
              {totals.ebtTotal > 0 && (
                <div style={{ background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.25)', borderRadius: 12, padding: '0.875rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Leaf size={13} color="#34d399" />
                    <span style={{ fontSize: '0.82rem', color: '#34d399', fontWeight: 600 }}>EBT eligible</span>
                  </div>
                  <span style={{ fontWeight: 900, color: '#34d399', fontSize: '1.1rem' }}>{fmt$(totals.ebtTotal)}</span>
                </div>
              )}
              {/* Use-full shortcut */}
              <button
                onClick={() => setAmount(numberToDigits(ebtMax))}
                style={{
                  width: '100%', padding: '0.875rem', borderRadius: 10, cursor: 'pointer',
                  background: activeAmt === ebtMax && amount ? 'rgba(52,211,153,.15)' : 'var(--bg-input)',
                  border: `1.5px solid ${activeAmt === ebtMax && amount ? 'rgba(52,211,153,.4)' : 'var(--border)'}`,
                  color: '#34d399', fontWeight: 700, fontSize: '0.9rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'all .12s',
                }}
              >
                <Leaf size={14} /> Use full EBT — {fmt$(ebtMax)}
              </button>
              {activeAmt > 0 && activeAmt < remaining - 0.005 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--amber)', textAlign: 'center', fontWeight: 600 }}>
                  Remaining {fmt$(remaining - activeAmt)} needs cash or card
                </div>
              )}
            </div>
            {/* Right — numpad */}
            <div className="tm-numpad-col">
              <NumPadInline value={amount} onChange={setAmount} accentColor="#34d399" />
            </div>
          </div>

          {/* Footer */}
          <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {canAddSplit && (
              <button onClick={addSplitLine} className="tm-split-add-btn" style={{ background: 'rgba(52,211,153,.06)', border: '1px solid rgba(52,211,153,.2)', color: '#34d399' }}>
                <PlusCircle size={14} /> Add {fmt$(activeAmt)} EBT — Pay {fmt$(remaining - activeAmt)} with cash/card
              </button>
            )}
            <button onClick={complete} disabled={!canComplete || saving} className="tm-big-btn" style={{ background: (!canComplete || saving) ? undefined : '#34d399' }}>
              {saving ? <><RotateCcw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processing…</> : <><Check size={16} /> Complete with Manual EBT</>}
            </button>
            <button onClick={() => switchMethod('cash')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'center' }}>
              ← Back to payment methods
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCREEN: FULL ENTRY MODAL — side-by-side
  //   Left  → order info, splits, method chips, method-specific context
  //   Right → NumPadInline (hidden for 'card' method)
  // ════════════════════════════════════════════════════════════════════════════
  const activeM    = BY_ID[method];
  const padColor   = method === 'ebt'        ? '#34d399'
                   : method === 'manual_ebt' ? '#6ee7b7'
                   : method === 'manual_card'? 'var(--blue, #3b82f6)'
                   : 'var(--green)';

  return (
    <div className="tm-backdrop">
      <div className="tm-modal tm-modal--wide">

        {/* Header — title and right-side amount summary adapt to split state.
            When the cashier has started a split (any committed lines), the
            title shifts from "Tender" → "Split Payment · N collected" and
            the amount column shows the OUTSTANDING balance (remaining)
            highlighted in amber, with the cart total below in muted text.
            That way the cashier always sees what's left to charge without
            scrolling back to the splits panel. */}
        <div className="tm-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, lineHeight: 1.15 }}>
            <span style={{ fontWeight: 800, fontSize: '1rem' }}>
              {splits.length > 0
                ? `Split Payment · ${splits.length} collected`
                : 'Tender'}
            </span>
            {splits.length > 0 && (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                {remaining > 0.005 ? `Pay ${fmt$(remaining)} more to complete` : 'Fully paid · ready to confirm'}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {splits.length > 0 && remaining > 0.005 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.05 }}>
                <span style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--amber)' }}>{fmt$(remaining)}</span>
                <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  of {fmt$(totals.grandTotal)} total
                </span>
              </div>
            ) : (
              <span style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--green)' }}>{fmt$(totals.grandTotal)}</span>
            )}
            <button onClick={onClose} className="tm-close-btn"><X size={16} /></button>
          </div>
        </div>

        {/* Body — side by side */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ── Left column ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Offline banner — integrated card / EBT can't reach Dejavoo cloud
                without network, so we tell the cashier upfront which paths still
                work. Kept at the top of the scroll column so it's never below
                the fold even on small POS displays. */}
            {!isOnline && (
              <div style={{
                background: 'rgba(220,38,38,0.08)',
                border: '1px solid rgba(220,38,38,0.3)',
                borderRadius: 10,
                padding: '0.6rem 0.875rem',
                display: 'flex', alignItems: 'flex-start', gap: 8,
              }}>
                <WifiOff size={16} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: '0.78rem', lineHeight: 1.35 }}>
                  <div style={{ fontWeight: 800, color: '#dc2626', marginBottom: 2 }}>
                    No network — Card & EBT unavailable
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    Cash, Manual Card, Manual EBT, Charge, and Other still work.
                    Card / EBT need a live connection to the payment terminal.
                  </div>
                </div>
              </div>
            )}

            {/* Session 51 — Dual Pricing summary banner.
                Shows when the store runs the dual_pricing model AND the cart
                has a positive total (skip refunds). Surfaces both totals so
                the cashier sees what the customer pays for each tender path
                BEFORE picking a method. The active method's total is
                highlighted; the other is muted. */}
            {isDualPricing && totals.cashGrandTotal > 0.005 && !isRefundTx && (
              <div className="tm-dual-pricing-banner" style={{
                background: _usesCardTender
                  ? 'linear-gradient(180deg, rgba(245,158,11,0.06) 0%, rgba(245,158,11,0.02) 100%)'
                  : 'linear-gradient(180deg, rgba(34,197,94,0.06) 0%, rgba(34,197,94,0.02) 100%)',
                border: `1.5px solid ${_usesCardTender ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.3)'}`,
                borderRadius: 12,
                padding: '0.625rem 0.875rem',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                    {dualPricing?.state?.pricingFraming === 'cash_discount' ? 'CASH DISCOUNT' : 'DUAL PRICING'}
                  </span>
                  {totals.surchargeRate > 0 && (
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                      +{Number(totals.surchargeRate).toFixed(2)}% + ${Number(totals.surchargeFixedFee || 0).toFixed(2)} on card
                    </span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div style={{
                    background: !_usesCardTender ? 'rgba(34,197,94,0.12)' : 'transparent',
                    border: `1px solid ${!_usesCardTender ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: 8,
                    padding: '0.45rem 0.625rem',
                  }}>
                    <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 2 }}>
                      CASH / EBT
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 900, color: !_usesCardTender ? 'var(--green)' : 'var(--text-secondary)' }}>
                      {fmt$(totals.cashGrandTotal)}
                    </div>
                  </div>
                  <div style={{
                    background: _usesCardTender ? 'rgba(245,158,11,0.12)' : 'transparent',
                    border: `1px solid ${_usesCardTender ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: 8,
                    padding: '0.45rem 0.625rem',
                  }}>
                    <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 2 }}>
                      CARD / DEBIT
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 900, color: _usesCardTender ? '#f59e0b' : 'var(--text-secondary)' }}>
                      {fmt$(totals.cardGrandTotal)}
                    </div>
                    {totals.cardSurcharge > 0 && (
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        incl. +{fmt$(totals.cardSurcharge + (totals.cardSurchargeTax || 0))} surcharge
                      </div>
                    )}
                  </div>
                </div>
                {totals.potentialSavings > 0.005 && !_usesCardTender && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--green)', fontWeight: 700, textAlign: 'center', marginTop: 2 }}>
                    Customer saves {fmt$(totals.potentialSavings)} by paying cash
                  </div>
                )}
              </div>
            )}

            {/* Committed splits — sticky progress card.
                When ANY split is committed, this is the most important UI on
                the screen, so we make it visually loud:
                  - Top-of-column "Split in progress" banner with the
                    progress bar so cashier sees how much is collected at a glance
                  - Each line item shows method icon, label, last-4 (for cards),
                    "✓ Charged on terminal" badge for paid card splits
                  - Per-line remove (X) button — clears the split (auto-voids
                    on terminal for card splits via existing removeSplit logic)
                  - Bottom row reiterates "Remaining $X to pay" so the cashier
                    knows exactly what's left when picking the next method */}
            {splits.length > 0 && (() => {
              const collected = totalSplit;
              const target    = totals.grandTotal;
              const pctPaid   = target > 0 ? Math.min(100, Math.round((collected / target) * 100)) : 100;
              return (
                <div className="tm-split-progress" style={{
                  background:    'linear-gradient(180deg, rgba(122,193,67,.08) 0%, rgba(122,193,67,.02) 100%)',
                  border:        '1.5px solid rgba(122,193,67,.3)',
                  borderRadius:  12,
                  padding:       '0.625rem 0.875rem',
                  position:      'sticky',
                  top:           0,
                  zIndex:        2,
                  // Soft shadow so the card lifts off the body content when
                  // the cashier scrolls down through the method picker
                  boxShadow:     '0 2px 8px rgba(0,0,0,0.18)',
                }}>
                  {/* Header row: count + collected amount */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Check size={13} color="var(--green)" />
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--green)' }}>
                        {splits.length} payment{splits.length === 1 ? '' : 's'} collected
                      </span>
                    </div>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                      {fmt$(collected)} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>of {fmt$(target)}</span>
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 4, background: 'rgba(255,255,255,.08)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{
                      width:      `${pctPaid}%`,
                      height:     '100%',
                      background: pctPaid >= 100 ? 'var(--green)' : 'linear-gradient(90deg, var(--green) 0%, #4ade80 100%)',
                      transition: 'width .25s ease',
                    }} />
                  </div>
                  {/* Per-line breakdown */}
                  {splits.map(line => {
                    const m = BY_ID[line.method]; const Icon = m?.Icon || DollarSign;
                    const terminalCharged = !!line.paymentTransactionId;
                    return (
                      <div key={line.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '0.32rem 0',
                        borderTop: '1px dashed rgba(255,255,255,.06)',
                      }}>
                        <Icon size={13} color={m?.color || 'var(--text-secondary)'} style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: '0.78rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.label}</span>
                          {line.lastFour && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'monospace', flexShrink: 0 }}>••{line.lastFour}</span>}
                          {terminalCharged && <Wifi size={10} color="var(--green)" title="Charged on terminal" style={{ flexShrink: 0 }} />}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: '0.85rem', flexShrink: 0 }}>{fmt$(line.amount)}</span>
                        <button
                          onClick={() => removeSplit(line.id)}
                          title={terminalCharged ? `Void ${fmt$(line.amount)} on terminal` : 'Remove split line'}
                          style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: '2px 4px', flexShrink: 0 }}
                        ><Trash2 size={12} /></button>
                      </div>
                    );
                  })}
                  {/* Remaining-to-pay callout */}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    paddingTop: '0.5rem', marginTop: '0.4rem',
                    borderTop: '1px solid rgba(255,255,255,.08)',
                  }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      {remaining > 0.005 ? 'Still owed' : 'Status'}
                    </span>
                    <span style={{
                      fontWeight: 900,
                      fontSize: remaining > 0.005 ? '1rem' : '0.92rem',
                      color: remaining > 0.005 ? 'var(--amber)' : 'var(--green)',
                    }}>
                      {remaining > 0.005 ? fmt$(remaining) : '✓ Fully Paid'}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Method selector */}
            <div>
              <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 6 }}>PAYMENT METHOD</div>
              {/* 3f — show actionable cash-floor enforcement.
                  For pure cash-only carts: "only cash allowed".
                  For mixed carts: "cash portion: $X / card OK for the rest". */}
              {lotteryCashOnly && hasLotteryItems && (
                <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '7px 12px', marginBottom: 10, fontSize: '0.78rem', color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span>🎟️ Lottery ({fmt$(lotteryAmount)}) must be paid in cash.</span>
                  {!isPureCashOnlyCart && (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                      Rest of cart ({fmt$(Math.max(0, totals.grandTotal - lotteryAmount))}) can use any tender.
                    </span>
                  )}
                  {cashFloorShortfall > 0.005 && (
                    <span style={{ color: '#dc2626', fontWeight: 700, marginLeft: 'auto' }}>
                      Cash short: {fmt$(cashFloorShortfall)}
                    </span>
                  )}
                </div>
              )}
              {fuelCashOnly && hasFuelItems && (
                <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '7px 12px', marginBottom: 10, fontSize: '0.78rem', color: '#dc2626', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span>⛽ Fuel ({fmt$(fuelAmount)}) must be paid in cash.</span>
                  {!isPureCashOnlyCart && (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                      Rest of cart ({fmt$(Math.max(0, totals.grandTotal - fuelAmount))}) can use any tender.
                    </span>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {allowedMethods.map(m => {
                  const Icon = m.Icon; const active = method === m.id;
                  return (
                    <button key={m.id} onClick={() => switchMethod(m.id)} style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '0.45rem 0.8rem', borderRadius: 20,
                      background: active ? m.bg : 'var(--bg-input)',
                      border: `1.5px solid ${active ? m.border : 'var(--border)'}`,
                      color: active ? m.color : 'var(--text-muted)',
                      fontWeight: active ? 700 : 500, fontSize: '0.78rem',
                      cursor: 'pointer', flexShrink: 0, transition: 'all .12s',
                    }}>
                      <Icon size={12} />{m.label}
                      {hasPAX && m.id === 'card' && <span style={{ fontSize: '0.6rem', background: '#1e3a5f', color: '#60a5fa', borderRadius: 4, padding: '1px 5px', marginLeft: 4, fontWeight: 700 }}>PAX</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── CASH: quick presets + change preview ── */}
            {method === 'cash' && (
              <>
                {/* Split shortcuts — pre-fill the numpad with a fraction of
                    remaining so the cashier doesn't have to mentally compute
                    halves / thirds before committing a partial cash split.
                    Only shown when:
                      - No splits committed yet (otherwise we have a
                        differently-shaped remaining; presets are less useful)
                      - Cart is large enough that splitting actually makes
                        sense ($5+ remaining; below that just pay cash)
                      - Cashier hasn't typed anything yet (preset wouldn't
                        replace partial input cleanly) */}
                {splits.length === 0 && remaining >= 5 && !amount && (
                  <div>
                    <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 6 }}>
                      SPLIT THIS PAYMENT
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Half',   factor: 0.5,    sub: '50/50 split' },
                        { label: 'Third',  factor: 1 / 3,  sub: '33% cash' },
                        { label: 'Two-Thirds', factor: 2 / 3, sub: '67% cash' },
                      ].map(p => {
                        // Round to nearest dollar for cleaner cash splits.
                        // Cashiers handle rounding mentally; under-shoot is
                        // safer than over-shoot (split-add caps at remaining).
                        const splitAmt = Math.max(1, Math.floor(remaining * p.factor));
                        const restAmt  = Math.max(0, Math.round((remaining - splitAmt) * 100) / 100);
                        return (
                          <button
                            key={p.label}
                            onClick={() => setAmount(numberToDigits(splitAmt))}
                            style={{
                              padding: '0.5rem 0.75rem', borderRadius: 8,
                              background: 'rgba(168,85,247,.08)',
                              border: '1px solid rgba(168,85,247,.3)',
                              color: '#a855f7',
                              fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
                              display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.25,
                            }}
                            title={`Pay ${fmt$(splitAmt)} cash, then ${fmt$(restAmt)} on another method`}
                          >
                            <span>{p.label}</span>
                            <span style={{ fontSize: '0.6rem', opacity: 0.85, fontWeight: 600 }}>
                              {fmt$(splitAmt)} + {fmt$(restAmt)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 6 }}>QUICK CASH</div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {/* Exact */}
                    <button onClick={() => setAmount(numberToDigits(remaining))} style={{
                      padding: '0.5rem 0.75rem', borderRadius: 8,
                      background: activeAmt === remaining && amount ? 'var(--green)' : 'var(--bg-input)',
                      color: activeAmt === remaining && amount ? '#0f1117' : 'var(--text-secondary)',
                      border: `1px solid ${activeAmt === remaining && amount ? 'var(--green)' : 'var(--border)'}`,
                      fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.25,
                    }}>
                      <span>{fmt$(remaining)}</span>
                      <span style={{ fontSize: '0.46rem', opacity: 0.65, fontWeight: 600 }}>EXACT</span>
                    </button>
                    {/* Smart presets */}
                    {presets.map((amt, i) => (
                      <button key={amt} onClick={() => setAmount(numberToDigits(amt))} style={{
                        padding: '0.5rem 0.75rem', borderRadius: 8,
                        background: activeAmt === amt ? 'var(--green)' : i < 2 ? 'rgba(245,158,11,.08)' : 'var(--bg-card)',
                        color: activeAmt === amt ? '#0f1117' : i < 2 ? 'var(--amber)' : 'var(--text-secondary)',
                        border: `1px solid ${activeAmt === amt ? 'var(--green)' : i < 2 ? 'rgba(245,158,11,.3)' : 'var(--border)'}`,
                        fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
                      }}>
                        {fmt$(amt)}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Change preview */}
                {change > 0 && (
                  <div style={{ padding: '0.75rem 1rem', borderRadius: 10, background: 'rgba(122,193,67,.08)', border: '1px solid rgba(122,193,67,.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--green)', fontSize: '0.85rem' }}>Change Due</div>
                      {cashRounding === '0.05' && rawChange !== change && (
                        <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)' }}>Rounded from {fmt$(rawChange)}</div>
                      )}
                    </div>
                    <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--green)' }}>{fmt$(change)}</span>
                  </div>
                )}
              </>
            )}

            {/* ── CARD: terminal prompt (full left area) ── */}
            {method === 'card' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '1rem', background: 'rgba(59,130,246,.05)', borderRadius: 12, border: '1px solid rgba(59,130,246,.18)', textAlign: 'center' }}>
                <CreditCard size={44} color="var(--blue)" style={{ opacity: .65 }} />
                <div style={{ fontSize: '1.9rem', fontWeight: 900, color: 'var(--blue)', letterSpacing: '-0.02em' }}>{fmt$(remaining)}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Tap / swipe / insert on terminal</div>
              </div>
            )}

            {/* ── EBT: eligible band + shortcut ── */}
            {method === 'ebt' && (
              <>
                {totals.ebtTotal > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.6rem 0.875rem', borderRadius: 8, background: 'rgba(52,211,153,.07)', border: '1px solid rgba(52,211,153,.2)' }}>
                    <Leaf size={13} color="#34d399" />
                    <span style={{ fontSize: '0.8rem', color: '#34d399', fontWeight: 600, flex: 1 }}>EBT eligible: {fmt$(totals.ebtTotal)}</span>
                    <button onClick={() => setAmount(numberToDigits(Math.min(totals.ebtTotal, remaining)))} style={{ background: '#34d399', border: 'none', borderRadius: 6, color: '#0f1117', padding: '0.2rem 0.7rem', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>
                      Use full
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── MANUAL CARD (in split flow) ── */}
            {method === 'manual_card' && splits.length > 0 && (
              <button onClick={() => setAmount(numberToDigits(remaining))} style={{ width: '100%', padding: '0.75rem', borderRadius: 10, cursor: 'pointer', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Check size={14} /> Charge full remaining — {fmt$(remaining)}
              </button>
            )}

            {/* ── MANUAL EBT (in split flow) ── */}
            {method === 'manual_ebt' && splits.length > 0 && (
              <button onClick={() => setAmount(numberToDigits(Math.min(totals.ebtTotal, remaining)))} style={{ width: '100%', padding: '0.75rem', borderRadius: 10, cursor: 'pointer', background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.25)', color: '#34d399', fontWeight: 700, fontSize: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Leaf size={14} /> Full EBT — {fmt$(Math.min(totals.ebtTotal, remaining))}
              </button>
            )}

            {/* ── OTHER: note text ── */}
            {method === 'other' && (
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Note: Gift Card, Check #1234…"
                style={{ width: '100%', fontSize: '0.9rem', borderRadius: 8, padding: '0.65rem 0.875rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
              />
            )}

          </div>{/* end left column */}

          {/* ── Right column — numpad (only for amount-entry methods) ── */}
          {showNumpad && (
            <div className="tm-numpad-col">
              <NumPadInline value={amount} onChange={setAmount} accentColor={padColor} />
            </div>
          )}

        </div>{/* end side-by-side body */}

        {/* Footer — split-add and complete buttons.
            When the typed amount is less than remaining (canAddSplit=true),
            the split CTA is now the PRIMARY footer button (full-width, big,
            same prominence as the Complete button), because in that flow
            the cashier's intent is to split, not to fail the complete-button
            "amount must equal remaining" gate. The Complete button drops
            to secondary when a partial amount is typed, so cashier doesn't
            accidentally tap Complete when the cart isn't fully covered. */}
        <div style={{ padding: '0.875rem 1rem', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {canAddSplit && (
            <button
              onClick={addSplitLine}
              disabled={splitCharging}
              className="tm-big-btn tm-split-add-cta"
              style={{
                background: splitCharging ? undefined : (USES_TERMINAL.includes(method) ? 'var(--blue, #3b82f6)' : padColor),
                opacity: splitCharging ? 0.6 : 1,
              }}
            >
              {splitCharging
                ? <><RotateCcw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Charging terminal for {fmt$(activeAmt)}…</>
                : USES_TERMINAL.includes(method)
                  ? <><CreditCard size={16} /> Charge {fmt$(activeAmt)} on Card · then pay {fmt$(remaining - activeAmt)} more</>
                  : <><PlusCircle size={16} /> Add {fmt$(activeAmt)} {activeM?.label} · then pay {fmt$(remaining - activeAmt)} more</>}
            </button>
          )}
          {/* When a split CTA is showing, the primary Complete is demoted to
              a thin secondary button — cashier shouldn't be one tap away from
              completing on a partial amount. */}
          <button
            onClick={complete}
            disabled={!canComplete || saving || splitCharging}
            className={canAddSplit ? 'tm-secondary-btn' : 'tm-big-btn'}
            style={{
              background: canAddSplit
                ? 'transparent'
                : ((!canComplete || saving || splitCharging) ? undefined : (method === 'card' ? 'var(--blue, #3b82f6)' : padColor)),
              border: canAddSplit ? '1px solid var(--border)' : undefined,
              color:  canAddSplit ? 'var(--text-secondary)' : undefined,
              fontSize: canAddSplit ? '0.85rem' : undefined,
              padding:  canAddSplit ? '0.55rem 1rem' : undefined,
            }}
          >
            {saving
              ? <><RotateCcw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processing…</>
              : canAddSplit
                ? `Complete with full ${fmt$(remaining)} on this method instead`
                : method === 'card'
                  ? <><CreditCard size={16} /> Complete Card — {fmt$(remaining)}</>
                  : change > 0
                    ? <>Complete Sale · Change: {fmt$(change)}</>
                    : 'Complete Sale'
            }
          </button>
        </div>

        {/* PAX Terminal Payment Overlay */}
        {payStatus && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 100,
            background: 'rgba(11,13,20,0.97)', borderRadius: 'inherit',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '2rem', textAlign: 'center',
          }}>
            {/* Always-visible close button on the overlay so the cashier
                isn't stuck — clicking it dismisses the overlay AND closes
                the entire TenderModal back to the cart. They can edit the
                cart, swap items, or pick a different tender from scratch.
                Hidden during the in-flight 'waiting' state because killing
                the overlay mid-charge would leave the terminal in an
                inconsistent state — the existing Cancel button there
                properly aborts via Dejavoo's /AbortTransaction endpoint. */}
            {payStatus !== 'waiting' && (
              <button
                onClick={() => {
                  // Reset payment state, then close the modal entirely.
                  // handleRetry resets state but doesn't close — wrap with onClose.
                  setPayStatus(null);
                  setPayResult(null);
                  cardAutoFireRef.current = null;
                  if (typeof onClose === 'function') onClose();
                }}
                title="Close"
                style={{
                  position: 'absolute', top: 12, right: 12, zIndex: 101,
                  width: 32, height: 32, borderRadius: 16,
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#e8eaf0', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <X size={16} />
              </button>
            )}

            {payStatus === 'waiting' && (
              <>
                <div style={{ fontSize: '4rem', marginBottom: '1rem', animation: 'pulse 1.5s ease-in-out infinite' }}>💳</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#e8eaf0', marginBottom: 8 }}>
                  Waiting for Customer
                </div>
                <div style={{ color: '#6b7280', fontSize: '0.9rem', lineHeight: 1.7, marginBottom: '2rem' }}>
                  Please tap, insert, or swipe card<br />on the payment terminal
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4b5563', fontSize: '0.8rem' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', animation: 'blink 1s step-end infinite' }} />
                  Processing on terminal…
                </div>
                <button
                  onClick={() => { setPayStatus(null); setPayResult(null); }}
                  style={{ marginTop: '2rem', padding: '8px 20px', borderRadius: 8, border: '1px solid rgba(239,68,68,.3)', background: 'transparent', color: '#f87171', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}
                >
                  Cancel
                </button>
              </>
            )}

            {payStatus === 'approved' && (
              <>
                <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>✅</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#4ade80', marginBottom: 6 }}>Payment Approved</div>
                {payResult?.authCode && <div style={{ color: '#6b7280', fontSize: '0.8rem', marginBottom: 4 }}>Auth: {payResult.authCode}</div>}
                {payResult?.cardType && <div style={{ color: '#6b7280', fontSize: '0.8rem', marginBottom: 4 }}>{payResult.cardType} ****{payResult.lastFour}</div>}
                <div style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: 8 }}>Completing transaction…</div>
              </>
            )}

            {payStatus === 'declined' && (() => {
              // Some Dejavoo responses send Message: 'Error' (literally the
              // word "Error") with no further detail — that's noise, not
              // information. Fall back to the cashier-friendly default in
              // that case. Same fallback for empty / 1-2 char messages.
              const rawMsg = payResult?.message || '';
              const detail = payResult?.detailedMessage || '';
              const useless = !rawMsg || rawMsg.length < 4 || /^error$/i.test(rawMsg.trim());
              const displayMsg = useless
                ? 'The card was declined or the transaction could not complete. Please try a different card or payment method.'
                : (detail && detail !== rawMsg ? `${rawMsg} — ${detail}` : rawMsg);
              return (
                <>
                  <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>❌</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f87171', marginBottom: 8 }}>Payment Declined</div>
                  <div style={{ color: '#6b7280', fontSize: '0.87rem', marginBottom: '1.5rem', lineHeight: 1.6, maxWidth: 360 }}>
                    {displayMsg}
                  </div>
                  {/* Two-button row matches the error state — cashier always
                      has both "retry on same method" and "switch to cash"
                      paths. Closes the loop on the "stuck on declined" UX bug. */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => { handleRetry(); switchMethod('cash'); }}
                      style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'transparent', color: '#cbd5e1', fontSize: '0.87rem', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Use a Different Method
                    </button>
                    <button
                      onClick={handleRetry}
                      style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: '#3d56b5', color: '#fff', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' }}
                    >
                      Try Again
                    </button>
                  </div>
                </>
              );
            })()}

            {payStatus === 'error' && (() => {
              const rawMsg = payResult?.message || '';
              const useless = !rawMsg || rawMsg.length < 4 || /^error$/i.test(rawMsg.trim());
              const displayMsg = useless
                ? 'Could not reach the payment terminal. Check the device is powered on and connected to the internet, then retry.'
                : rawMsg;
              return (
                <>
                  <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>⚠️</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f87171', marginBottom: 8 }}>Terminal Error</div>
                  <div style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '1.5rem', lineHeight: 1.6, maxWidth: 360 }}>
                    {displayMsg}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { handleRetry(); switchMethod('cash'); }} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'transparent', color: '#cbd5e1', fontSize: '0.87rem', cursor: 'pointer', fontWeight: 600 }}>
                      Use Cash Instead
                    </button>
                    <button onClick={handleRetry} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: '#3d56b5', color: '#fff', fontWeight: 700, fontSize: '0.87rem', cursor: 'pointer' }}>
                      Retry
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Animations moved to TenderModal.css */}

      </div>
    </div>
  );
}
