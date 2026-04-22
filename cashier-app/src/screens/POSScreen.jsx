/**
 * POSScreen — three-zone layout (cart on RIGHT for right-hand cashiers)
 *
 * ┌─ StatusBar ──────────────────────────────────────────────────────────────┐
 * │ LEFT 58%  (search + categories/quick-items + selected-item strip)        │
 * │            │  RIGHT 42% (customer + cart items + totals + quick tender)  │
 * ├─ ActionBar (58px, full width) ───────────────────────────────────────────┤
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Search, X, User, UserX,
  DollarSign, Trash2, Tag, Star,
  CreditCard, Banknote, Leaf,
  Hash,
} from 'lucide-react';

import StatusBar            from '../components/layout/StatusBar.jsx';
import CartItem             from '../components/cart/CartItem.jsx';
import CartTotals           from '../components/cart/CartTotals.jsx';
import BagFeeRow            from '../components/cart/BagFeeRow.jsx';
import TenderModal          from '../components/tender/TenderModal.jsx';
import AgeVerificationModal from '../components/modals/AgeVerificationModal.jsx';
import ActionBar            from '../components/pos/ActionBar.jsx';
import CategoryPanel        from '../components/pos/CategoryPanel.jsx';
import QuickButtonRenderer  from '../components/pos/QuickButtonRenderer.jsx';
import { useQuickButtonLayout } from '../hooks/useQuickButtonLayout.js';
import NumpadModal          from '../components/pos/NumpadModal.jsx';
import ManagerPinModal      from '../components/modals/ManagerPinModal.jsx';
import DiscountModal        from '../components/modals/DiscountModal.jsx';
import HoldRecallModal      from '../components/modals/HoldRecallModal.jsx';
import CustomerLookupModal  from '../components/modals/CustomerLookupModal.jsx';
import PriceCheckModal      from '../components/modals/PriceCheckModal.jsx';
import TransactionHistoryModal from '../components/modals/TransactionHistoryModal.jsx';
import VoidModal               from '../components/modals/VoidModal.jsx';
import RefundModal             from '../components/modals/RefundModal.jsx';
import EndOfDayModal           from '../components/modals/EndOfDayModal.jsx';
import ReprintReceiptModal     from '../components/modals/ReprintReceiptModal.jsx';
import OpenShiftModal          from '../components/modals/OpenShiftModal.jsx';
import CloseShiftModal         from '../components/modals/CloseShiftModal.jsx';
import CashDrawerModal         from '../components/modals/CashDrawerModal.jsx';
import LotteryModal            from '../components/modals/LotteryModal.jsx';
import LotteryShiftModal       from '../components/modals/LotteryShiftModal.jsx';
import FuelModal                from '../components/modals/FuelModal.jsx';
import BottleRedemptionModal   from '../components/modals/BottleRedemptionModal.jsx';
import VendorPayoutModal from '../components/modals/VendorPayoutModal.jsx';
import PackSizePickerModal from '../components/modals/PackSizePickerModal.jsx';
// Session 39 Round 3 — 1:1 visual port of portal ProductForm replaces the
// older AddProductModal. The old modal is still in the tree for any code
// still referencing it, but the scan-not-found flow now uses the full form.
import AddProductModal from '../components/modals/AddProductModal.jsx';
import ProductFormModal from '../components/modals/ProductFormModal.jsx';
import BarcodeScannerModal from '../components/BarcodeScannerModal.jsx';
import ProductEditModal from '../components/modals/ProductEditModal.jsx';
import OpenItemModal from '../components/modals/OpenItemModal.jsx';
import TasksPanel      from '../components/modals/TasksPanel.jsx';
import ChatPanel       from '../components/modals/ChatPanel.jsx';
import HardwareSettingsModal from '../components/modals/HardwareSettingsModal.jsx';
import { useLotteryStore } from '../stores/useLotteryStore.js';
import { getLotteryBoxes, getPosBranding, logPosEvent } from '../api/pos.js';
import * as posApi from '../api/pos.js';
import api from '../api/client.js';
import { nanoid } from 'nanoid';
import { playErrorBeep } from '../utils/sound.js';
import ChangeDueOverlay from '../components/pos/ChangeDueOverlay.jsx';

import { useBarcodeScanner } from '../hooks/useBarcodeScanner.js';
import { useProductLookup }  from '../hooks/useProductLookup.js';
import { useCatalogSync }    from '../hooks/useCatalogSync.js';
import { useBranding }       from '../hooks/useBranding.js';
import { useOnlineStatus }   from '../hooks/useOnlineStatus.js';
import { usePOSConfig }      from '../hooks/usePOSConfig.js';
import { useFuelSettings }   from '../hooks/useFuelSettings.js';
import { useHardware }       from '../hooks/useHardware.js';
import { useCustomerDisplayPublisher } from '../hooks/useBroadcastSync.js';
import { useCartStore, selectTotals } from '../stores/useCartStore.js';
import { useManagerStore }   from '../stores/useManagerStore.js';
import { useShiftStore }     from '../stores/useShiftStore.js';
import { useStationStore }   from '../stores/useStationStore.js';
import { useSyncStore }      from '../stores/useSyncStore.js';
import { useAuthStore }      from '../stores/useAuthStore.js';
import { db, searchProducts, getActivePromotions, getHeldTransactions } from '../db/dexie.js';
import { evaluatePromotions }  from '../utils/promoEngine.js';
import { fmt$ }              from '../utils/formatters.js';
import { getSmartCashPresets } from '../utils/cashPresets.js';
import './POSScreen.css';

export default function POSScreen() {
  const {
    items, selectedLineId, scanMode,
    addProduct, removeItem, updateQty, overridePrice,
    selectItem, clearSelection, requestAgeVerify,
    flash, flashState,
    customer, setCustomer, clearCustomer, clearCart,
    orderDiscount, removeOrderDiscount,
    loyaltyRedemption, removeLoyaltyRedemption,
    verifiedAges,
    bagCount, incrementBags, decrementBags,
  } = useCartStore();

  const promotions        = useCartStore(s => s.promotions);
  const setPromotions     = useCartStore(s => s.setPromotions);
  const applyPromoResults = useCartStore(s => s.applyPromoResults);
  const promoResults      = useCartStore(s => s.promoResults);

  // Watch catalog sync timestamp so promos reload after every sync
  const catalogSyncedAt   = useSyncStore(s => s.catalogSyncedAt);
  const isOnline          = useSyncStore(s => s.isOnline);
  const enqueueTx         = useSyncStore(s => s.enqueue);

  const requireManager = useManagerStore(s => s.requireManager);
  const { lookup }     = useProductLookup();
  const { manualSync } = useCatalogSync();
  const posConfig      = usePOSConfig();
  const fuel           = useFuelSettings();
  const cashier        = useAuthStore(s => s.cashier);

  // ── Hardware (receipt printer, cash drawer) ──────────────────────────────
  const { printReceipt, openDrawer, printShelfLabel, hasReceiptPrinter, hasCashDrawer, hasLabelPrinter, scale, hasScale } = useHardware();

  // ── Shift / Cash Drawer ─────────────────────────────────────────────────
  const station = useStationStore(s => s.station);
  const storeId = station?.storeId;
  const { shift, loading: shiftLoading, loadActiveShift } = useShiftStore();
  const logout = useAuthStore(s => s.logout);

  // ── Lottery store ────────────────────────────────────────────────────────
  const {
    games: lotteryGames,
    sessionSales, sessionPayouts,
    loadGames:       loadLotteryGames,
    recordSale:      recordLotterySale,
    recordPayout:    recordLotteryPayout,
    saveShiftReport: saveLotteryShiftReport,
    resetSession:    resetLotterySession,
  } = useLotteryStore();

  // ── Customer Display broadcast ───────────────────────────────────────────
  const { publish: publishDisplay } = useCustomerDisplayPublisher();

  // Store branding — used for receipt header
  const [storeBranding, setStoreBranding] = useState({});

  // Terminal / EBT state — declared early because handleTerminalPhoneLookup / handleEbtBalance
  // useCallbacks below reference these in their dependency arrays. Moving them later
  // triggers a temporal-dead-zone ReferenceError on first render.
  const [terminalLookupBusy, setTerminalLookupBusy] = useState(false);
  const [dejavooEbtEnabled, setDejavooEbtEnabled]   = useState(false);
  const [ebtBalanceResult, setEbtBalanceResult]     = useState(null); // { amount, type } or null

  // ── Shared receipt print helper — used by auto-print, ask-prompt, reprint, history ──
  const handlePrintTx = useCallback((tx) => {
    if (!hasReceiptPrinter || !tx) return;
    const allItems = [
      ...(tx.lineItems || []).map(i => ({
        name:           i.name,
        qty:            i.qty,
        unitPrice:      i.unitPrice,
        lineTotal:      i.lineTotal,
        discountAmount: i.discountAmount || 0,
      })),
      ...(tx.lotteryItems || []).map(i => ({
        name:        i.notes || (i.type === 'payout' ? 'Lottery Payout' : 'Lottery Sale'),
        isLottery:   true,
        lotteryType: i.type,
        lineTotal:   i.type === 'payout' ? -(i.amount || 0) : (i.amount || 0),
      })),
    ];
    const primaryTender = tx.tenderLines?.[0] || {};
    const totalTendered = tx.tenderLines?.reduce((s, t) => s + (t.amount || 0), 0) || tx.grandTotal;
    printReceipt({
      storeName:           storeBranding.storeName    || storeBranding.name || '',
      storeAddress:        storeBranding.storeAddress || '',
      storePhone:          storeBranding.storePhone   || '',
      storeTaxId:          storeBranding.storeTaxId   || '',
      paperWidth:          storeBranding.receiptPaperWidth       || '80mm',
      taxIdLabel:          storeBranding.taxIdLabel               || 'Tax ID',
      storeEmail:          storeBranding.storeEmail               || '',
      storeWebsite:        storeBranding.storeWebsite             || '',
      headerLine1:         storeBranding.receiptHeaderLine1       || '',
      headerLine2:         storeBranding.receiptHeaderLine2       || '',
      showCashier:         storeBranding.receiptShowCashier       !== false,
      showTransactionId:   storeBranding.receiptShowTransactionId !== false,
      showItemCount:       Boolean(storeBranding.receiptShowItemCount),
      showTaxBreakdown:    Boolean(storeBranding.receiptShowTaxBreakdown),
      showSavings:         storeBranding.receiptShowSavings       !== false,
      footerLine1:         storeBranding.receiptFooterLine1       || '',
      footerLine2:         storeBranding.receiptFooterLine2       || '',
      showReturnPolicy:    Boolean(storeBranding.receiptShowReturnPolicy),
      returnPolicy:        storeBranding.receiptReturnPolicy      || '',
      footerMessage:       storeBranding.receiptFooter            || 'Thank you! Please come again.',
      cashierName:    tx.cashierName || cashier?.name || cashier?.email || 'Cashier',
      invoiceNumber:  tx.txNumber,
      date:           tx.offlineCreatedAt || tx.createdAt || Date.now(),
      items:          allItems,
      subtotal:       tx.subtotal,
      totalTax:       tx.taxTotal,
      totalDeposit:   tx.depositTotal,
      total:          tx.grandTotal,
      tenderMethod:   primaryTender.method?.replace('_', ' ') || '',
      amountTendered: totalTendered,
      changeDue:      tx.changeGiven || 0,
      authCode:       tx.authCode,
      cardType:       tx.cardType,
      lastFour:       tx.lastFour,
    }).catch((err) => {
      // Receipt printer failure — surface to cashier via scan-error toast
      // so they know the receipt didn't print (common issue: offline USB / wrong IP).
      console.warn('[POS] receipt print failed:', err);
      setScanError({ upc: 'Receipt print failed — check printer connection', ts: Date.now() });
      if (scanErrorTimer.current) clearTimeout(scanErrorTimer.current);
      scanErrorTimer.current = setTimeout(() => setScanError(null), 4000);
    });
  }, [hasReceiptPrinter, printReceipt, storeBranding, cashier]);

  // ── No Sale — open drawer + log event ─────────────────────────────────────
  const handleNoSale = useCallback(() => {
    // Open cash drawer
    if (hasCashDrawer) {
      openDrawer().catch((err) => console.warn('[POS] drawer open failed:', err));
    }
    // Log to back-office (fire-and-forget, never blocks cashier)
    logPosEvent({
      storeId,
      eventType:   'no_sale',
      cashierId:   cashier?.id,
      cashierName: cashier?.name || cashier?.email || 'Unknown',
      stationId:   station?.stationId,
      stationName: station?.stationName,
      note:        'Cash drawer opened — No Sale',
    });
  }, [hasCashDrawer, openDrawer, storeId, cashier, station]);

  // ── Dejavoo Terminal Phone Lookup ────────────────────────────────────────
  // Prompts customer on the terminal to enter their phone number, then
  // searches local Customer table and auto-attaches the match to the cart.
  // Lets the cashier keep scanning while the customer types on the terminal.
  const handleTerminalPhoneLookup = useCallback(async () => {
    if (terminalLookupBusy) return;
    if (!station?.id) {
      setScanError({ upc: 'No station — cannot prompt terminal', ts: Date.now() });
      if (scanErrorTimer.current) clearTimeout(scanErrorTimer.current);
      scanErrorTimer.current = setTimeout(() => setScanError(null), 3000);
      return;
    }
    setTerminalLookupBusy(true);
    try {
      const res = await posApi.dejavooLookupCustomer({
        stationId: station.id,
        title:     'Loyalty Lookup',
        prompt:    'Enter phone number',
        minLength: 7,
        maxLength: 15,
        timeoutSec: 45,
      });
      if (res?.success && res.customer) {
        // Map API response shape to cart store expectations
        setCustomer({
          id:             res.customer.id,
          name:           [res.customer.firstName, res.customer.lastName].filter(Boolean).join(' ') || res.customer.phone || 'Customer',
          phone:          res.customer.phone,
          email:          res.customer.email,
          loyaltyPoints:  res.customer.loyaltyPoints,
          balance:        res.customer.balance,
          discount:       res.customer.discount,
        });
        // The customer chip appearing in the cart header is its own confirmation
      } else if (res?.notFound) {
        // Offer cashier the quick-create option
        setScanError({ upc: `Phone ${res.phone} — no customer found. Use "Attach customer" to create.`, ts: Date.now() });
        if (scanErrorTimer.current) clearTimeout(scanErrorTimer.current);
        scanErrorTimer.current = setTimeout(() => setScanError(null), 5000);
      } else {
        setScanError({ upc: res?.message || 'Customer did not enter phone', ts: Date.now() });
        if (scanErrorTimer.current) clearTimeout(scanErrorTimer.current);
        scanErrorTimer.current = setTimeout(() => setScanError(null), 4000);
      }
    } catch (err) {
      console.warn('[POS] terminal phone lookup failed:', err);
      setScanError({ upc: err?.response?.data?.error || err.message || 'Terminal lookup failed', ts: Date.now() });
      if (scanErrorTimer.current) clearTimeout(scanErrorTimer.current);
      scanErrorTimer.current = setTimeout(() => setScanError(null), 4000);
    } finally {
      setTerminalLookupBusy(false);
    }
  }, [terminalLookupBusy, station, setCustomer]);

  // Load Dejavoo merchant status once so we know whether to show EBT button
  useEffect(() => {
    posApi.dejavooMerchantStatus()
      .then(s => setDejavooEbtEnabled(!!(s?.configured && s?.provider === 'dejavoo' && s?.ebtEnabled)))
      .catch(() => setDejavooEbtEnabled(false));
  }, []);

  // ── EBT Balance check — prompts customer on terminal to swipe EBT card ───
  const handleEbtBalance = useCallback(async () => {
    if (!station?.id) {
      setScanError({ upc: 'No station — cannot check EBT balance', ts: Date.now() });
      if (scanErrorTimer.current) clearTimeout(scanErrorTimer.current);
      scanErrorTimer.current = setTimeout(() => setScanError(null), 3000);
      return;
    }
    // Ask which account to check
    const choice = window.confirm('EBT Balance Check:\n\nOK = Food Stamp (SNAP)\nCancel = Cash Benefit');
    const paymentType = choice ? 'ebt_food' : 'ebt_cash';
    try {
      const r = await posApi.dejavooEbtBalance({ stationId: station.id, paymentType });
      const amt = r?.result?.totalAmount ?? r?.result?.amount;
      if (r?.success && amt != null) {
        setEbtBalanceResult({
          type: paymentType === 'ebt_food' ? 'SNAP / Food Stamp' : 'Cash Benefit',
          amount: amt,
          last4: r.result?.last4,
        });
      } else {
        setScanError({ upc: r?.result?.message || 'Could not read EBT balance', ts: Date.now() });
        if (scanErrorTimer.current) clearTimeout(scanErrorTimer.current);
        scanErrorTimer.current = setTimeout(() => setScanError(null), 4000);
      }
    } catch (err) {
      setScanError({ upc: err?.response?.data?.error || err.message || 'EBT balance failed', ts: Date.now() });
      if (scanErrorTimer.current) clearTimeout(scanErrorTimer.current);
      scanErrorTimer.current = setTimeout(() => setScanError(null), 4000);
    }
  }, [station]);

  // Load active shift on mount. Once load completes and shift is null → auto-show OpenShiftModal.
  const [shiftChecked, setShiftChecked] = useState(false);
  useEffect(() => {
    if (!storeId) return;
    loadActiveShift(storeId)
      .then(() => setShiftChecked(true))
      .catch((err) => {
        console.error('[POS] loadActiveShift failed:', err);
        setScanError({ upc: 'Could not load shift — check network connection', ts: Date.now() });
        if (scanErrorTimer.current) clearTimeout(scanErrorTimer.current);
        scanErrorTimer.current = setTimeout(() => setScanError(null), 5000);
        setShiftChecked(true); // allow the open-shift modal to appear anyway
      });
    // Load branding for receipt header (cosmetic — warn only)
    getPosBranding(storeId)
      .then(b => setStoreBranding(b || {}))
      .catch((err) => console.warn('[POS] branding load failed:', err));
  }, [storeId]); // eslint-disable-line

  // Auto-open shift modal when: check is done AND no active shift
  useEffect(() => {
    if (shiftChecked && !shiftLoading && shift === null) {
      setShowOpenShift(true);
    }
  }, [shiftChecked, shiftLoading, shift]);

  // Load lottery games and active boxes when shift opens
  useEffect(() => {
    if (shift && storeId) {
      loadLotteryGames(storeId);
      getLotteryBoxes({ storeId, status: 'active' })
        .then(r => setLotteryActiveBoxes(r?.data || r || []))
        .catch((err) => console.warn('[POS] lottery box load failed:', err));
    }
  }, [shift?.id, storeId]); // eslint-disable-line

  // Reset lottery reconciliation flag when shift changes (new shift = fresh start)
  useEffect(() => { setLotteryShiftDone(false); }, [shift?.id]);

  // ── Midnight auto-close ──────────────────────────────────────────────────
  // When a shift is open and midnight arrives:
  //   1. Auto-close the shift (note: "Auto-closed at midnight")
  //   2. Log the cashier out so the next person must open a new shift
  useEffect(() => {
    if (!shift?.id) return;

    const now       = new Date();
    const midnight  = new Date(now);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    const timerId = setTimeout(async () => {
      // Re-read current state inside the callback to avoid stale closure
      const { shift: currentShift, closeShift: closeFn } = useShiftStore.getState();
      if (!currentShift) return; // Already closed manually

      const result = await closeFn({
        closingAmount:  0,
        closingNote:    'Auto-closed at midnight',
      }).catch(() => null);

      // Log out regardless of close result so the register prompts a new shift open
      useAuthStore.getState().logout();
    }, msUntilMidnight);

    return () => clearTimeout(timerId);
  }, [shift?.id]); // eslint-disable-line

  useOnlineStatus();
  useBranding();

  // ── Modal visibility ────────────────────────────────────────────────────
  const [showTender,       setShowTender]       = useState(false);
  const [tenderInitMethod, setTenderInitMethod] = useState(null);  // 'cash' | 'card' | 'ebt'
  const [tenderInitCash,   setTenderInitCash]   = useState(null);  // pre-fill cash amount
  const [showHold,        setShowHold]        = useState(false);
  const [showCustomer,    setShowCustomer]    = useState(false);
  const [showPriceCheck,  setShowPriceCheck]  = useState(false);
  const [showHistory,    setShowHistory]    = useState(false);
  const [showVoid,       setShowVoid]       = useState(false);
  const [showRefund,     setShowRefund]     = useState(false);
  const [showEndOfDay,   setShowEndOfDay]   = useState(false);
  // Cash drawer / shift modals
  const [showOpenShift,   setShowOpenShift]   = useState(false);
  const [showCloseShift,  setShowCloseShift]  = useState(false);
  const [showCashDrawer,  setShowCashDrawer]  = useState(false);
  const [cashDrawerTab,   setCashDrawerTab]   = useState('drop'); // 'drop' | 'payout'
  // Lottery modals
  const [showLottery,        setShowLottery]        = useState(false);
  const [showLotteryShift,   setShowLotteryShift]   = useState(false);
  // Fuel modal
  const [fuelModalMode,      setFuelModalMode]      = useState(null);  // null | 'sale' | 'refund'
  const [showBottleReturn,   setShowBottleReturn]   = useState(false);
  const [showVendorPayout,   setShowVendorPayout]   = useState(false);
  const [showHardwareSettings, setShowHardwareSettings] = useState(false);
  const [editProduct,        setEditProduct]        = useState(null);  // cart item being quick-edited
  const [showTasks,          setShowTasks]          = useState(false);
  const [showChat,           setShowChat]           = useState(false);
  const [chatUnread,         setChatUnread]         = useState(0);
  // Quick Buttons is the default view. If a store has not configured a
  // WYSIWYG layout yet, we fall back to 'catalog' via the effect below.
  const [quickTab,           setQuickTab]           = useState('buttons'); // 'catalog' | 'buttons'
  const { layout: quickButtonLayout } = useQuickButtonLayout(storeId);
  const hasQuickButtons = Array.isArray(quickButtonLayout?.tree) && quickButtonLayout.tree.length > 0;
  // When hasQuickButtons becomes false (store hasn't configured Quick Buttons
  // yet), ensure we're not stuck on an empty BUTTONS tab — fall back to catalog.
  useEffect(() => {
    if (!hasQuickButtons && quickTab === 'buttons') setQuickTab('catalog');
  }, [hasQuickButtons, quickTab]);
  const [lotteryActiveBoxes, setLotteryActiveBoxes] = useState([]);
  // Lottery shift reconciliation state
  const [lotteryShiftDone,   setLotteryShiftDone]   = useState(false);
  const [pendingShiftClose,  setPendingShiftClose]  = useState(false);
  // Discount modal: discountTarget = lineId string → line discount, null → order discount
  const [discountTarget,  setDiscountTarget]  = useState(undefined); // undefined = closed

  // Held transaction count — shown as badge on the Hold button
  const [heldCount, setHeldCount] = useState(0);
  const refreshHeldCount = useCallback(() => {
    getHeldTransactions()
      .then(list => setHeldCount(list.length))
      .catch((err) => console.warn('[POS] held tx load failed:', err));
  }, []);
  useEffect(() => { refreshHeldCount(); }, [refreshHeldCount]);

  // ── Poll chat unread — badge on ActionBar + audio nudge ─────────────────
  const chatUnreadRef = useRef(chatUnread);
  useEffect(() => {
    const poll = () => {
      if (showChat) return; // panel is open, skip
      api.get('/chat/unread').then(res => {
        const count = res.data?.count || 0;
        // Audio nudge when count increases
        if (count > chatUnreadRef.current) {
          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'sine'; osc.frequency.value = 880;
            gain.gain.value = 0.08;
            osc.start(); osc.stop(ctx.currentTime + 0.12);
          } catch {}
        }
        chatUnreadRef.current = count;
        setChatUnread(count);
      }).catch((err) => console.warn('[POS] chat poll failed:', err?.message));
    };
    poll();
    const iv = setInterval(poll, 15000);
    return () => clearInterval(iv);
  }, [showChat]);

  // Last completed transaction — used by Reprint button to print without opening history
  const [lastCompletedTx, setLastCompletedTx] = useState(null);
  const [reprintTx,       setReprintTx]       = useState(null);
  const [receiptAskTx,    setReceiptAskTx]    = useState(null); // 'ask' behaviour prompt

  // ── Numpad ─────────────────────────────────────────────────────────────
  // numpad: { mode, title, value, onConfirm } | null
  const [numpad, setNumpad] = useState(null);

  // ── Search state ─────────────────────────────────────────────────────────
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch,    setShowSearch]    = useState(false);
  const searchRef = useRef(null);

  // ── Tax rules (from IndexedDB) ───────────────────────────────────────────
  const [taxRules, setTaxRules] = useState([]);
  useEffect(() => { db.taxRules.toArray().then(setTaxRules); }, []);

  // ── Load promotions from IndexedDB ─────────────────────────────────────────
  // Re-runs every time catalogSyncedAt changes (initial sync + every 15-min refresh)
  // so newly created/edited promos are picked up without a page reload.
  useEffect(() => {
    getActivePromotions()
      .then(promos => setPromotions(promos || []))
      .catch(() => {});
  }, [catalogSyncedAt, setPromotions]); // eslint-disable-line

  // ── Re-evaluate promotions whenever cart items change ─────────────────────
  useEffect(() => {
    if (!promotions.length || !items.length) {
      if (promoResults.appliedPromos?.length) {
        applyPromoResults({ lineAdjustments: {}, totalSaving: 0, appliedPromos: [] });
      }
      return;
    }
    const cartItems = items.map(i => ({
      lineId:          i.lineId,
      productId:       i.productId,
      departmentId:    i.departmentId || null,
      qty:             i.qty,
      unitPrice:       i.unitPrice,
      discountEligible: i.discountEligible !== false,
    }));
    const results = evaluatePromotions(cartItems, promotions);
    applyPromoResults(results);
  }, [items.map(i => `${i.lineId}:${i.qty}`).join(','), promotions]); // eslint-disable-line

  // ── Derived ──────────────────────────────────────────────────────────────
  // Combine order discount + loyalty redemption into a single dollar-off value
  const rawSubtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  let _dollarOff = 0;
  if (orderDiscount) {
    _dollarOff += orderDiscount.type === 'percent'
      ? rawSubtotal * orderDiscount.value / 100
      : orderDiscount.value;
  }
  if (loyaltyRedemption) {
    _dollarOff += loyaltyRedemption.discountType === 'dollar_off'
      ? loyaltyRedemption.discountValue
      : rawSubtotal * loyaltyRedemption.discountValue / 100;
  }
  const effectiveDiscount = _dollarOff > 0
    ? { type: 'amount', value: Math.round(_dollarOff * 100) / 100 }
    : null;
  // Bag fee
  const bagPrice = posConfig.bagFee?.pricePerBag || 0;
  const rawBagTotal = Math.round(bagCount * bagPrice * 100) / 100;
  const bagFeeInfo = bagCount > 0 ? {
    bagTotal:     rawBagTotal,
    ebtEligible:  posConfig.bagFee?.ebtEligible  || false,
    discountable: posConfig.bagFee?.discountable || false,
  } : null;
  const totals       = selectTotals(items, taxRules, effectiveDiscount, bagFeeInfo);
  const selectedItem = items.find(i => i.lineId === selectedLineId);

  // ── Broadcast to customer display ───────────────────────────────────────
  useEffect(() => {
    if (items.length === 0) {
      publishDisplay({ type: 'idle' });
    } else {
      publishDisplay({
        type: 'cart_update',
        items,
        totals,
        bagCount,
        bagPrice,
        customer,
        loyaltyRedemption,
        orderDiscount,
        promoResults,
        storeName: storeBranding?.storeName || storeBranding?.name || '',
      });
    }
  }, [items, totals, bagCount, customer, loyaltyRedemption, orderDiscount, promoResults, storeBranding]);

  // ── Age-check helper: skip if already verified this transaction ──────────
  const addWithAgeCheck = useCallback((product) => {
    // Apply store-level age override for tobacco / alcohol items.
    // Per-product `ageRequired` is overridden by the store-wide policy so
    // cashiers always enforce the same minimum across the catalog.
    const taxClass = (product.taxClass || product.department?.taxClass || '').toLowerCase();
    const storeAge = taxClass === 'tobacco' ? posConfig.ageLimits?.tobacco
                   : taxClass === 'alcohol' ? posConfig.ageLimits?.alcohol
                   : null;
    const effectiveAge = storeAge != null && storeAge > 0
      ? storeAge
      : (product.ageRequired || null);
    const enforced = effectiveAge != null
      ? { ...product, ageRequired: effectiveAge }
      : product;

    // If age verification is disabled in store settings, skip check entirely
    if (!posConfig.ageVerification) {
      addProduct(enforced);
      return;
    }
    if (enforced.ageRequired && verifiedAges.includes(enforced.ageRequired)) {
      addProduct(enforced); // same age threshold already cleared this transaction
    } else if (enforced.ageRequired) {
      requestAgeVerify(enforced);
    } else {
      addProduct(enforced);
    }
  }, [posConfig.ageVerification, posConfig.ageLimits, verifiedAges, addProduct, requestAgeVerify]);

  // ── Scan error toast ──────────────────────────────────────────────────────
  const [scanError, setScanError]           = useState(null);  // { upc, ts }
  const [addProductUpc, setAddProductUpc]   = useState(null);  // UPC string when manager creates product
  const [showOpenItem, setShowOpenItem]     = useState(false); // Manual item entry modal
  const [showCameraScan, setShowCameraScan] = useState(false); // Tablet/phone camera scan
  const scanErrorTimer = useRef(null);

  // ── Scale weight warning (by-weight product scanned without stable weight) ──
  const [scaleWeightWarning, setScaleWeightWarning] = useState(null);
  const scaleWarnTimer = useRef(null);
  useEffect(() => () => clearTimeout(scaleWarnTimer.current), []);

  const showScanError = useCallback((upc) => {
    clearTimeout(scanErrorTimer.current);
    setScanError({ upc, ts: Date.now() });
    scanErrorTimer.current = setTimeout(() => setScanError(null), 4000);
  }, []);
  useEffect(() => () => clearTimeout(scanErrorTimer.current), []);

  // ── Pack size picker ──────────────────────────────────────────────────────
  const [packPickerProduct, setPackPickerProduct] = useState(null); // pending product awaiting size selection

  const handlePackSizeSelect = useCallback((product, size) => {
    setPackPickerProduct(null);
    addWithAgeCheck({
      ...product,
      retailPrice: Number(size.retailPrice),
      qty: 1,
      packSizeLabel: size.label,
      packSizeId: size.id,
      unitCount: size.unitCount,
    });
    flash('hit');
  }, [addWithAgeCheck, flash]);

  // ── Barcode scan ─────────────────────────────────────────────────────────
  const handleScan = useCallback(async (raw) => {
    if (scanMode !== 'normal') return;

    // Change-due overlay open → dismiss it and continue (start new transaction)
    if (changeDueRef.current) {
      setChangeDueTx(null);
      setChangeDueAmt(0);
      setChangeDueRefund(false);
      // Fall through and process the scan as the first item of a new sale
    }

    // Tender modal open → reject scan, beep, show toast
    if (showTenderRef.current) {
      playErrorBeep();
      flash('miss');
      showScanError(raw);
      return;
    }

    const { product } = await lookup(raw);
    if (!product) {
      flash('miss');
      showScanError(raw);
      return;
    }
    // If multiple pack sizes are configured, show picker instead of adding immediately
    if (Array.isArray(product.packSizes) && product.packSizes.length > 1) {
      setPackPickerProduct(product);
      return;
    }
    // If exactly one pack size, use it silently
    if (Array.isArray(product.packSizes) && product.packSizes.length === 1) {
      const size = product.packSizes[0];
      addWithAgeCheck({
        ...product,
        retailPrice: Number(size.retailPrice),
        packSizeLabel: size.label,
        packSizeId: size.id,
        unitCount: size.unitCount,
      });
      flash('hit');
      return;
    }
    // If by-weight product, use scale weight as quantity
    if (product.byWeight) {
      if (scale?.weight > 0 && scale?.stable) {
        const weightQty = scale.weight;
        addWithAgeCheck({ ...product, qty: weightQty, unitPrice: product.retailPrice, retailPrice: product.retailPrice });
        flash('hit');
      } else {
        flash('miss');
        setScaleWeightWarning('Place item on scale first');
        clearTimeout(scaleWarnTimer.current);
        scaleWarnTimer.current = setTimeout(() => setScaleWeightWarning(null), 3000);
      }
      return;
    }
    addWithAgeCheck({ ...product, retailPrice: product.retailPrice });
    flash('hit');
  }, [scanMode, lookup, addWithAgeCheck, flash, showScanError, scale]);

  useBarcodeScanner(handleScan, scanMode === 'normal');

  // ── Product search ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    searchProducts(searchQuery, storeId).then(setSearchResults);
  }, [searchQuery, storeId]);

  const handleSearchSelect = (product) => {
    addWithAgeCheck(product);
    setSearchQuery('');
    setSearchResults([]);
    setShowSearch(false);
    flash('hit');
  };

  // ── Numpad helpers ───────────────────────────────────────────────────────
  const openQtyNumpad = () => {
    if (!selectedItem) return;
    setNumpad({
      mode: 'qty',
      title: `Qty — ${selectedItem.name}`,
      value: String(selectedItem.qty),
      onConfirm: (val) => { updateQty(selectedLineId, val); setNumpad(null); },
    });
  };

  const openPriceNumpad = () => {
    if (!selectedItem) return;
    setNumpad({
      mode: 'price',
      title: `Price Override — ${selectedItem.name}`,
      value: String(selectedItem.unitPrice),
      onConfirm: (val) => {
        requireManager('Price Override', () => overridePrice(selectedLineId, val));
        setNumpad(null);
      },
    });
  };

  // ── Discount helpers ─────────────────────────────────────────────────────
  const openLineDiscount  = () => requireManager('Line Discount',  () => setDiscountTarget(selectedLineId));
  const openOrderDiscount = () => requireManager('Order Discount', () => setDiscountTarget(null));

  // ── Lottery handlers ─────────────────────────────────────────────────────
  // 3f — pending-action dispatch after the lottery shift is reconciled.
  // Previously only handled 'closeShift'; now also supports 'endOfDay' so
  // both actions can gate on the scanRequiredAtShiftEnd flag.
  const [pendingAfterLottery, setPendingAfterLottery] = useState(null); // null | 'closeShift' | 'endOfDay'

  const handleLotteryShiftSave = async (data) => {
    await saveLotteryShiftReport(data);
    setLotteryShiftDone(true);
    setShowLotteryShift(false);
    // If reconciliation was triggered by a gated action, proceed now.
    const next = pendingAfterLottery;
    setPendingAfterLottery(null);
    setPendingShiftClose(false);  // legacy alias
    if (next === 'closeShift')    setShowCloseShift(true);
    else if (next === 'endOfDay') setShowEndOfDay(true);
  };

  // Opens LotteryShiftModal after refreshing active boxes (standalone button)
  const handleOpenLotteryShift = () => {
    getLotteryBoxes({ storeId, status: 'active' })
      .then(r => setLotteryActiveBoxes(r?.data || r || []))
      .catch(() => {});
    setShowLotteryShift(true);
  };

  /**
   * 3f — shared gate for shift-end actions that must reconcile lottery first.
   * Call with the intent ('closeShift' | 'endOfDay') and a fallback action.
   * If the gate is OFF or lottery is already reconciled, runs the fallback.
   * Otherwise opens LotteryShiftModal and remembers the intent to resume.
   */
  const withLotteryReconciliationGate = useCallback((intent, fallback) => {
    const scanReq   = posConfig.lottery?.scanRequiredAtShiftEnd;
    const lotteryOn = posConfig.lottery?.enabled ?? true;
    const hasBoxes  = lotteryActiveBoxes.length > 0;
    if (scanReq && lotteryOn && hasBoxes && !lotteryShiftDone) {
      getLotteryBoxes({ storeId, status: 'active' })
        .then(r => setLotteryActiveBoxes(r?.data || r || []))
        .catch(() => {});
      setPendingAfterLottery(intent);
      setPendingShiftClose(intent === 'closeShift');  // legacy alias
      setShowLotteryShift(true);
    } else {
      fallback();
    }
  }, [posConfig.lottery, lotteryActiveBoxes, lotteryShiftDone, storeId]);

  // ── Quick-button action dispatch ─────────────────────────────────────────
  // The WYSIWYG builder lets admins drop "Action" tiles onto the home grid.
  // Each tile carries an `actionKey` (validated server-side against
  // VALID_ACTIONS) — here we map it to the existing POSScreen handler.
  // Unknown keys are a no-op + console.warn (e.g. if the portal catalog
  // adds an action before we wire it here).
  const handleQuickAction = useCallback((actionKey) => {
    switch (actionKey) {
      case 'discount':           requireManager('Apply Discount', () => setDiscountTarget(null)); break;
      case 'void':               requireManager('Void Transaction', () => setShowVoid(true)); break;
      case 'refund':             requireManager('Refund Sale', () => setShowRefund(true)); break;
      case 'open_drawer':
      case 'no_sale':            handleNoSale(); break;
      case 'print_last_receipt':
        if (lastCompletedTx) setReprintTx(lastCompletedTx);
        else setShowHistory(true);
        break;
      case 'customer_lookup':
      case 'customer_add':       setShowCustomer(true); break;
      case 'price_check':        setShowPriceCheck(true); break;
      case 'hold':
      case 'recall':             setShowHold(true); break;
      case 'cash_drop':          setCashDrawerTab('drop'); setShowCashDrawer(true); break;
      case 'payout':             setShowVendorPayout(true); break;
      case 'end_of_day':         setShowEndOfDay(true); break;
      case 'lottery_sale':       setShowLottery(true); break;
      case 'fuel_sale':          setFuelModalMode('sale'); break;
      case 'bottle_return':      setShowBottleReturn(true); break;
      case 'manual_entry':       setShowOpenItem(true); break;
      case 'clock_event':        console.warn('clock_event from quick-button not supported — use PIN login screen'); break;
      default:                   console.warn(`[QuickButtons] unknown actionKey: ${actionKey}`);
    }
  }, [requireManager, handleNoSale, lastCompletedTx]);

  // ── Quick tender helpers ─────────────────────────────────────────────────
  // cashAmt: optional pre-fill for cash amount (from on-screen quick-cash buttons)
  const openTender = (method, cashAmt = null) => {
    setTenderInitMethod(method);
    setTenderInitCash(cashAmt);
    setShowTender(true);
  };

  const closeTender = () => {
    setShowTender(false);
    setTenderInitMethod(null);
    setTenderInitCash(null);
  };

  // ── Change Due Overlay state ────────────────────────────────────────────
  // When a cash sale completes we render <ChangeDueOverlay /> instead of
  // showing the change inside TenderModal. The overlay auto-closes after 5s
  // and any barcode scan dismisses it (and starts a new transaction).
  const [changeDueTx,     setChangeDueTx]     = useState(null);
  const [changeDueAmt,    setChangeDueAmt]    = useState(0);
  const [changeDueRefund, setChangeDueRefund] = useState(false);
  const changeDueRef = useRef(null);
  useEffect(() => { changeDueRef.current = changeDueTx; }, [changeDueTx]);

  // Mirror showTender into a ref so handleScan (a useCallback) can read the
  // current value without being re-created every time the modal opens/closes.
  const showTenderRef = useRef(false);
  useEffect(() => { showTenderRef.current = showTender; }, [showTender]);

  const dismissChangeDue = useCallback(() => {
    setChangeDueTx(null);
    setChangeDueAmt(0);
    setChangeDueRefund(false);
  }, []);

  // Shared post-sale routine — broadcast to display, drawer, receipt, change overlay.
  const handleSaleCompleted = useCallback((tx, change) => {
    setLastCompletedTx(tx);
    publishDisplay({
      type: 'transaction_complete',
      txNumber: tx.txNumber,
      change: change || tx.changeGiven || 0,
    });

    const hasCashTender = tx.tenderLines?.some(t => t.method === 'cash');
    if (hasCashTender && hasCashDrawer) {
      openDrawer().catch(() => {});
    }

    // Non-cash auto-print (cash flow uses the overlay's Print button)
    if (!hasCashTender && hasReceiptPrinter) {
      const printBehavior = storeBranding.receiptPrintBehavior || 'always';
      if (printBehavior === 'always') {
        handlePrintTx(tx);
      } else if (printBehavior === 'ask') {
        setReceiptAskTx(tx);
      }
    }

    // Show ChangeDueOverlay whenever cash was tendered (refund or change)
    const refund = (tx.grandTotal ?? 0) < -0.005;
    if (refund || (change && change > 0.005) || hasCashTender) {
      setChangeDueTx(tx);
      setChangeDueAmt(refund ? Math.abs(tx.grandTotal) : (change || 0));
      setChangeDueRefund(refund);
    }

    // Snap back to Quick Buttons after every transaction — Quick Buttons is
    // the canonical default view. Cashier may have drilled into the Catalog
    // during the sale; this resets them for the next customer.
    if (hasQuickButtons) setQuickTab('buttons');
  }, [hasCashDrawer, hasReceiptPrinter, openDrawer, publishDisplay, storeBranding, handlePrintTx, hasQuickButtons]);

  // Quick-cash submit — bypasses TenderModal entirely.
  // Used by on-screen quick-cash buttons and the plain CASH button (exact total).
  const quickCashSubmit = useCallback(async (cashAmt) => {
    if (!items.length) return;
    if (!storeId) return;

    const grandTotal = totals.grandTotal;
    const isRefund   = grandTotal < -0.005;

    // For refunds (net-negative cart, e.g. bottle returns): cash goes OUT
    // to the customer. Record cash tender as the absolute amount (matches
    // TenderModal.complete() refund semantics) and "change" is what's
    // physically handed back.
    let tendered, change;
    if (isRefund) {
      const absRefund = Math.abs(grandTotal);
      tendered = absRefund;          // line records cash disbursed
      change   = absRefund;           // overlay shows the refund amount
    } else {
      tendered = Math.max(Number(cashAmt) || 0, grandTotal);
      change   = Math.max(0, Math.round((tendered - grandTotal) * 100) / 100);
    }

    const txNumber = `TXN-${Date.now().toString(36).toUpperCase()}`;
    const txLineItems = items.filter(i => !i.isLottery && !i.isFuel);
    if (bagCount > 0 && bagPrice > 0) {
      const bt = Math.round(bagCount * bagPrice * 100) / 100;
      txLineItems.push({
        isBagFee:        true,
        name:            'Bag Fee',
        qty:             bagCount,
        unitPrice:       bagPrice,
        effectivePrice:  bagPrice,
        lineTotal:       bt,
        depositTotal:    0,
        taxable:         false,
        ebtEligible:     posConfig.bagFee?.ebtEligible || false,
        discountEligible:false,
      });
    }

    const finalLines = isRefund
      ? [{ method: 'cash', amount: tendered, note: 'Refund/Bottle Return' }]
      : [{ method: 'cash', amount: tendered }];
    const payload = {
      localId: nanoid(),
      storeId,
      stationId: station?.id || null,
      shiftId: shift?.id || null,
      txNumber,
      lineItems: txLineItems,
      lotteryItems: items.filter(i => i.isLottery).map(i => ({
        type:   i.lotteryType,
        amount: Math.abs(i.lineTotal),
        gameId: i.gameId || undefined,
        notes:  i.name,
      })),
      fuelItems: items.filter(i => i.isFuel).map(i => ({
        type:           i.fuelType,
        fuelTypeId:     i.fuelTypeId || undefined,
        fuelTypeName:   i.fuelTypeName || 'Fuel',
        gallons:        Math.abs(Number(i.gallons) || 0),
        pricePerGallon: Math.abs(Number(i.pricePerGallon) || 0),
        amount:         Math.abs(Number(i.lineTotal)  || 0),
        entryMode:      i.entryMode || 'amount',
        taxAmount:      Math.abs(Number(i.taxAmount)  || 0),
      })),
      tenderLines: finalLines,
      changeGiven: change,
      offlineCreatedAt: new Date().toISOString(),
      ...(customer?.id ? { customerId: customer.id } : {}),
      ...(loyaltyRedemption ? { loyaltyPointsRedeemed: loyaltyRedemption.pointsCost } : {}),
      ...totals,
    };

    let savedTx = payload;
    try {
      if (isOnline) {
        const saved = await submitTransaction(payload);
        savedTx = { ...payload, id: saved.id, txNumber: saved.txNumber || txNumber };
      } else {
        await enqueueTx(payload);
        savedTx = { ...payload };
      }
    } catch {
      try { await enqueueTx(payload); } catch {}
      savedTx = { ...payload };
    }

    clearCart();
    handleSaleCompleted(savedTx, change);
  }, [items, totals, storeId, bagCount, bagPrice, posConfig.bagFee, customer, loyaltyRedemption, isOnline, enqueueTx, clearCart, handleSaleCompleted]);

  // Flash animation — driven by the className on `.pos-left-pane`
  // (see POSScreen.css keyframes). The previous inline-style copy was
  // removed in Session 39 to avoid duplicate animation triggers that
  // caused visible "blinking" on some offline scan paths.

  // ── Show EBT quick-tender button only when there are EBT-eligible items ──
  const showEbtButton = totals.ebtTotal > 0;

  // ── Lottery cash-only enforcement (3f) ─────────────────────────────────
  // Card quick-tender is only fully disabled when the cart is PURE lottery
  // (all items are lottery). For MIXED carts we now allow the cashier to
  // open TenderModal — the modal enforces a cash-floor for the lottery
  // portion and allows card to cover the non-lottery remainder.
  const lotteryCashOnlyActive = !!(posConfig.lottery?.cashOnly ?? false) && items.some(i => i.isLottery);
  const lotteryLineTotal = items.filter(i => i.isLottery)
    .reduce((s, i) => s + Math.abs(Number(i.lineTotal || 0)), 0);
  const nonLotteryLineTotal = items.filter(i => !i.isLottery)
    .reduce((s, i) => s + Math.abs(Number(i.lineTotal || 0)), 0);
  const isPureLotteryCart = lotteryCashOnlyActive && nonLotteryLineTotal < 0.005 && lotteryLineTotal > 0;
  // Legacy alias — only TRULY block card when the cart is 100% lottery.
  const cashOnlyEnforced = isPureLotteryCart;

  // ── Layout preset config ──────────────────────────────────────────────────
  const layoutCfg = useMemo(() => {
    switch (posConfig.layout) {
      case 'express':
        return {
          searchOrder: 1, cartOrder: 2,
          searchWidth: '32%', cartWidth: '68%',
          showDepts: false, showQuick: false,
          counterMode: false,
        };
      case 'classic': // Cart on LEFT, categories on RIGHT
        return {
          searchOrder: 2, cartOrder: 1,
          searchWidth: '60%', cartWidth: '40%',
          showDepts: posConfig.showDepartments !== false,
          showQuick: posConfig.showQuickAdd    !== false,
          counterMode: false,
        };
      case 'minimal':
        return {
          searchOrder: 1, cartOrder: 2,
          searchWidth: '40%', cartWidth: '60%',
          showDepts: false, showQuick: false,
          counterMode: false,
        };
      case 'counter': // Cart LEFT · Search + Tender RIGHT (right-hand cashier optimised)
        return {
          searchOrder: 2, cartOrder: 1,
          searchWidth: '60%', cartWidth: '40%',
          showDepts: posConfig.showDepartments !== false,
          showQuick: posConfig.showQuickAdd    !== false,
          counterMode: true,   // tender/totals render in search pane; strip renders in cart pane
        };
      default: // modern
        return {
          searchOrder: 1, cartOrder: 2,
          searchWidth: '58%', cartWidth: '42%',
          showDepts: posConfig.showDepartments !== false,
          showQuick: posConfig.showQuickAdd    !== false,
          counterMode: false,
        };
    }
  }, [posConfig.layout, posConfig.showDepartments, posConfig.showQuickAdd]);

  return (
    <div className="pos-shell">
      <StatusBar onRefresh={manualSync} />

      {/* ── Scale weight strip ──────────────────────────────────────────── */}
      {hasScale && scale.connected && (
        <div className="pos-scale-strip">
          <span className="pos-scale-icon">{'\u2696\uFE0F'}</span>
          <span className="pos-scale-weight">{scale.formattedWeight}</span>
          {scale.stable && <span className="pos-scale-stable">STABLE</span>}
          {!scale.stable && scale.weight > 0 && <span className="pos-scale-moving">...</span>}
        </div>
      )}

      {/* ── Midnight shift warning ───────────────────────────────────────── */}
      {shift?._crossedMidnight && (
        <div className="pos-midnight-warn">
          \u26A0 This shift was opened before midnight — please close it and open a new shift for today.
        </div>
      )}

      {/* ── Age verification policy chips (store-level) ──────────────────── */}
      {(posConfig.ageLimits?.tobacco > 0 || posConfig.ageLimits?.alcohol > 0) && (
        <div className="pos-age-policy">
          <span className="pos-age-policy-label">Age Policy:</span>
          {posConfig.ageLimits?.tobacco > 0 && (
            <span className="pos-age-chip pos-age-chip--tobacco">
              Tobacco {posConfig.ageLimits.tobacco}+
            </span>
          )}
          {posConfig.ageLimits?.alcohol > 0 && (
            <span className="pos-age-chip pos-age-chip--alcohol">
              Alcohol {posConfig.ageLimits.alcohol}+
            </span>
          )}
        </div>
      )}

      {/* ── Scan-error toast ─────────────────────────────────────────────── */}
      {scanError && (
        <div className="pos-scan-error">
          <span style={{ fontSize: '1rem' }}>\u26A0</span>
          <span>
            Not found: <span className="pos-scan-error-upc">{scanError.upc}</span>
          </span>
          <button
            onClick={() => {
              const upc = scanError.upc;
              setScanError(null);
              requireManager('Add New Product', () => setAddProductUpc(upc));
            }}
            className="pos-scan-error-add"
          >
            + Add Product
          </button>
        </div>
      )}

      {/* ── Scale weight warning toast ─────────────────────────────────── */}
      {scaleWeightWarning && (
        <div className="pos-scan-error" style={{ background: '#78350f' }}>
          <span style={{ fontSize: '1rem' }}>{'\u2696\uFE0F'}</span>
          <span>{scaleWeightWarning}</span>
        </div>
      )}

      {/* ── Content row ── */}
      <div className="pos-content">

        {/* ══════════════════════════════════════════
            LEFT PANE — Search + Category / Quick-Add
        ══════════════════════════════════════════ */}
        <div
          className={`pos-left-pane ${flashState === 'hit' ? 'pos-left-pane--flash-hit' : flashState === 'miss' ? 'pos-left-pane--flash-miss' : ''}`}
          style={{
            width: layoutCfg.searchWidth,
            order: layoutCfg.searchOrder,
            borderRight: layoutCfg.searchOrder === 1 ? '1px solid var(--border)' : 'none',
            borderLeft: layoutCfg.searchOrder === 2 ? '1px solid var(--border)' : 'none',
          }}
        >

          {/* Search bar */}
          <div style={{
            padding: '0.625rem 0.875rem',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
            position: 'relative',
          }}>
            <div style={{ position: 'relative' }}>
              <Search size={15} color="var(--text-muted)" style={{
                position: 'absolute', left: 12, top: '50%',
                transform: 'translateY(-50%)', pointerEvents: 'none',
              }} />
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setShowSearch(true); }}
                onFocus={() => setShowSearch(true)}
                onBlur={() => setTimeout(() => setShowSearch(false), 160)}
                placeholder="Search products or scan barcode…"
                style={{
                  width: '100%', paddingLeft: '2.25rem',
                  height: 40, fontSize: '0.875rem',
                  boxSizing: 'border-box',
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); setShowSearch(false); }}
                  style={{
                    position: 'absolute', right: 10, top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none', border: 'none',
                    color: 'var(--text-muted)', cursor: 'pointer', padding: 4,
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Search dropdown */}
            {showSearch && searchResults.length > 0 && (
              <div className="pos-search-dropdown">
                {searchResults.map(p => (
                  <button
                    key={p.id}
                    onMouseDown={() => handleSearchSelect(p)}
                    style={{
                      width: '100%', padding: '0.65rem 1rem',
                      textAlign: 'left', background: 'none', border: 'none',
                      display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', cursor: 'pointer',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{p.upc}</div>
                    </div>
                    <span style={{
                      fontWeight: 700, color: 'var(--green)',
                      fontSize: '0.875rem', flexShrink: 0, marginLeft: 12,
                    }}>
                      {fmt$(p.retailPrice)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── POS tab bar ── shown only when a Quick Buttons layout
              exists. Stores without one see the catalog full-height. */}
          {hasQuickButtons && (
            <div style={{
              display: 'flex', borderBottom: '1px solid var(--border)',
              flexShrink: 0, background: 'var(--bg-panel)',
            }}>
              {[
                { key: 'buttons', label: '▦ QUICK BUTTONS', show: true },
                { key: 'catalog', label: 'CATALOG',        show: true },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setQuickTab(tab.key)}
                  style={{
                    flex: 1, height: 34, background: 'none', border: 'none',
                    borderBottom: `2px solid ${quickTab === tab.key ? 'var(--green)' : 'transparent'}`,
                    color: quickTab === tab.key ? 'var(--green)' : 'var(--text-muted)',
                    fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.05em',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* Category panel (flex: 1 so it fills the remaining space) */}
          {quickTab === 'catalog' && (
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <CategoryPanel
                config={{
                  showDepartments: layoutCfg.showDepts,
                  showQuickAdd: layoutCfg.showQuick,
                  hiddenDepartments: posConfig.hiddenDepartments || [],
                }}
                onAddProduct={(product) => {
                  addWithAgeCheck(product);
                  flash('hit');
                }}
              />
            </div>
          )}
          {quickTab === 'buttons' && hasQuickButtons && (
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <QuickButtonRenderer layout={quickButtonLayout} onAction={handleQuickAction} />
            </div>
          )}

          {/* ── Selected-item action strip (bottom, only when item selected) ── */}
          {selectedItem && !layoutCfg.counterMode && (
            <div style={{
              flexShrink: 0,
              padding: '0.55rem 0.875rem',
              borderTop: '1px solid var(--border)',
              background: 'rgba(122,193,67,.04)',
              display: 'flex', gap: 6, alignItems: 'center',
            }}>
              {/* Item label */}
              <div style={{
                flex: 1, minWidth: 0,
                fontSize: '0.8rem', fontWeight: 600,
                color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {selectedItem.name}
                <span style={{
                  marginLeft: 8, fontSize: '0.7rem',
                  color: 'var(--text-muted)', fontWeight: 400,
                }}>
                  {fmt$(selectedItem.unitPrice)} × {selectedItem.qty}
                </span>
              </div>

              {/* QTY button → numpad */}
              <button onClick={openQtyNumpad} style={{
                padding: '0.3rem 0.65rem', borderRadius: 7,
                background: 'var(--bg-input)', color: 'var(--text-secondary)',
                border: 'none', cursor: 'pointer',
                fontWeight: 600, fontSize: '0.72rem',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Hash size={11} /> QTY
              </button>

              {/* PRICE button → numpad (manager-guarded inside openPriceNumpad confirm) */}
              <button onClick={openPriceNumpad} style={{
                padding: '0.3rem 0.65rem', borderRadius: 7,
                background: selectedItem.priceOverridden
                  ? 'rgba(99,179,237,.12)'
                  : 'var(--bg-input)',
                border: selectedItem.priceOverridden
                  ? '1px solid rgba(99,179,237,.35)'
                  : 'none',
                color: selectedItem.priceOverridden ? 'var(--blue)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 600, fontSize: '0.72rem',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <DollarSign size={11} /> Price
              </button>

              {/* Discount */}
              <button onClick={openLineDiscount} style={{
                padding: '0.3rem 0.65rem', borderRadius: 7,
                background: selectedItem.discountType
                  ? 'rgba(245,158,11,.15)'
                  : 'var(--bg-input)',
                border: selectedItem.discountType
                  ? '1px solid rgba(245,158,11,.35)'
                  : 'none',
                color: selectedItem.discountType ? 'var(--amber)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 600, fontSize: '0.72rem',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Tag size={11} />
                {selectedItem.discountType ? 'Edit Disc.' : 'Discount'}
              </button>

              {/* Void */}
              <button onClick={() => { removeItem(selectedLineId); clearSelection(); }} style={{
                padding: '0.3rem 0.65rem', borderRadius: 7,
                background: 'var(--red-dim)', color: 'var(--red)',
                border: '1px solid rgba(224,63,63,.3)', cursor: 'pointer',
                fontWeight: 700, fontSize: '0.72rem',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Trash2 size={11} /> Void
              </button>

              {/* Deselect */}
              <button onClick={clearSelection} style={{
                padding: '0.3rem', borderRadius: 7,
                background: 'var(--bg-input)', color: 'var(--text-muted)',
                border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center',
              }}>
                <X size={13} />
              </button>
            </div>
          )}

          {/* ── Totals + Quick Tender — counterMode only ── */}
          {layoutCfg.counterMode && (
            <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)' }}>
              {items.length > 0 ? (
                <>
                  {orderDiscount && (
                    <div style={{
                      margin: '0.4rem 0.75rem 0',
                      padding: '0.4rem 0.75rem',
                      background: 'rgba(245,158,11,.08)',
                      borderRadius: 8,
                      border: '1px solid rgba(245,158,11,.25)',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <Tag size={11} color="var(--amber)" />
                      <span style={{ flex: 1, fontSize: '0.72rem', color: 'var(--amber)', fontWeight: 700 }}>
                        Order Discount:{' '}
                        {orderDiscount.type === 'percent'
                          ? `${orderDiscount.value}% off`
                          : `${fmt$(orderDiscount.value)} off`}
                      </span>
                      <button onClick={removeOrderDiscount} style={{ background: 'none', border: 'none', color: 'var(--amber)', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}>
                        <X size={11} />
                      </button>
                    </div>
                  )}
                  {loyaltyRedemption && (
                    <div style={{
                      margin: '0.3rem 0.75rem 0',
                      padding: '0.4rem 0.75rem',
                      background: 'rgba(122,193,67,.07)',
                      borderRadius: 8,
                      border: '1px solid rgba(122,193,67,.25)',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <Star size={11} color="var(--green)" />
                      <span style={{ flex: 1, fontSize: '0.72rem', color: 'var(--green)', fontWeight: 700 }}>
                        {loyaltyRedemption.rewardName}:{' '}
                        {loyaltyRedemption.discountType === 'dollar_off'
                          ? `${fmt$(loyaltyRedemption.discountValue)} off`
                          : `${loyaltyRedemption.discountValue}% off`}
                        <span style={{ fontWeight: 400, marginLeft: 4, color: 'var(--text-muted)' }}>
                          ({loyaltyRedemption.pointsCost.toLocaleString()} pts)
                        </span>
                      </span>
                      <button onClick={removeLoyaltyRedemption} style={{ background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}>
                        <X size={11} />
                      </button>
                    </div>
                  )}
                  <CartTotals totals={totals} itemCount={items.reduce((s, i) => s + (i.qty || 1), 0)} bagCount={bagCount} />
                  {posConfig.bagFee?.enabled && items.length > 0 && (
                    <BagFeeRow bagCount={bagCount} onIncrement={incrementBags} onDecrement={decrementBags} bagPrice={bagPrice} bagTotal={totals.bagTotal || 0} />
                  )}
                  {/* Quick cash in counterMode */}
                  {(() => {
                    const cp = getSmartCashPresets(totals.grandTotal);
                    return (
                      <div style={{ padding: '0.25rem 0.75rem 0.4rem' }}>
                        <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', marginBottom: 5 }}>QUICK CASH</div>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {cp.map((amt, i) => (
                            <button key={amt} onClick={() => quickCashSubmit(amt)} style={{ padding: '0.3rem 0.65rem', borderRadius: 7, background: i < 2 ? 'rgba(245,158,11,.08)' : 'var(--bg-input)', border: `1px solid ${i < 2 ? 'rgba(245,158,11,.3)' : 'var(--border)'}`, color: i < 2 ? 'var(--amber)' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer', flexShrink: 0 }}>
                              {fmt$(amt)}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  <div style={{ padding: '0.5rem 0.75rem 0.75rem' }}>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: showEbtButton ? '1fr 1fr 1fr' : '1fr 1fr',
                      gap: 8,
                    }}>
                      <button
                        onClick={() => !cashOnlyEnforced && openTender('card')}
                        disabled={cashOnlyEnforced}
                        title={cashOnlyEnforced ? 'Lottery items — cash only' : undefined}
                        style={{ height: 56, borderRadius: 12, background: cashOnlyEnforced ? 'var(--bg-input)' : 'rgba(99,179,237,.12)', border: `1px solid ${cashOnlyEnforced ? 'var(--border)' : 'rgba(99,179,237,.3)'}`, color: cashOnlyEnforced ? 'var(--text-muted)' : 'var(--blue)', fontWeight: 800, fontSize: '0.8rem', cursor: cashOnlyEnforced ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, transition: 'background .1s', opacity: cashOnlyEnforced ? 0.45 : 1 }}
                      >
                        <CreditCard size={16} /><span>CARD</span>
                      </button>
                      <button onClick={() => openTender('cash')} style={{ height: 56, borderRadius: 12, background: 'rgba(122,193,67,.12)', border: '1px solid rgba(122,193,67,.3)', color: 'var(--green)', fontWeight: 800, fontSize: '0.8rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, transition: 'background .1s' }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(122,193,67,.2)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'rgba(122,193,67,.12)'; }}>
                        <Banknote size={16} /><span>CASH</span>
                      </button>
                      {showEbtButton && (
                        <button onClick={() => openTender('ebt')} style={{ height: 56, borderRadius: 12, background: 'rgba(52,211,153,.1)', border: '1px solid rgba(52,211,153,.3)', color: '#34d399', fontWeight: 800, fontSize: '0.8rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, transition: 'background .1s' }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(52,211,153,.18)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'rgba(52,211,153,.1)'; }}>
                          <Leaf size={16} /><span>EBT</span>
                        </button>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ padding: '0.75rem' }}>
                  <div style={{ height: 56, borderRadius: 'var(--r-lg)', background: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600 }}>
                    No items
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════
            RIGHT PANE — Customer + Cart + Totals + Quick Tender
        ══════════════════════════════════════════ */}
        <div style={{
          width: layoutCfg.cartWidth, display: 'flex', flexDirection: 'column',
          order: layoutCfg.cartOrder,
          background: 'var(--bg-panel)',
        }}>

          {/* Customer bar */}
          <div style={{
            flexShrink: 0,
            padding: '0.5rem 0.875rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 8,
            minHeight: 40,
            background: customer ? 'rgba(122,193,67,.04)' : 'transparent',
          }}>
            {customer ? (
              <>
                <User size={13} color="var(--green)" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '0.78rem', fontWeight: 700,
                    color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {customer.name}
                  </div>
                  {customer.loyaltyPoints != null && (
                    <div style={{ fontSize: '0.65rem', color: 'var(--green)', fontWeight: 600 }}>
                      {customer.loyaltyPoints} pts
                    </div>
                  )}
                </div>
                <button
                  onClick={clearCustomer}
                  title="Remove customer"
                  style={{
                    background: 'none', border: 'none',
                    color: 'var(--text-muted)', cursor: 'pointer',
                    padding: 4, display: 'flex', alignItems: 'center',
                  }}
                >
                  <UserX size={13} />
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setShowCustomer(true)} style={{
                  flex: 1, background: 'none', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600,
                  padding: '2px 0',
                }}>
                  <User size={13} />
                  Attach customer (optional)
                </button>
                {/* Prompt customer on the Dejavoo terminal to enter phone — instant lookup */}
                <button
                  onClick={handleTerminalPhoneLookup}
                  disabled={terminalLookupBusy}
                  title="Prompt customer on terminal to enter phone number"
                  style={{
                    background: terminalLookupBusy ? 'rgba(59,130,246,.04)' : 'rgba(59,130,246,.10)',
                    border: '1px solid rgba(59,130,246,.25)',
                    borderRadius: 4,
                    cursor: terminalLookupBusy ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 4,
                    color: 'var(--blue, #3b82f6)',
                    fontSize: '0.7rem', fontWeight: 700,
                    padding: '3px 8px',
                    flexShrink: 0,
                  }}
                >
                  📱 {terminalLookupBusy ? 'Waiting…' : 'Phone on terminal'}
                </button>
              </>
            )}
          </div>

          {/* Cart header */}
          <div style={{
            flexShrink: 0,
            padding: '0.55rem 0.875rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
              Cart
            </span>
            {items.length > 0 && (
              <button onClick={clearCart} style={{
                background: 'none', border: 'none',
                color: 'var(--text-muted)', fontSize: '0.7rem',
                fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 3,
                padding: '2px 6px',
              }}>
                <X size={11} /> Clear
              </button>
            )}
          </div>

          {/* Cart items list */}
          <div
            className="pos-cart-list scroll"
            onClick={e => { if (e.target === e.currentTarget) clearSelection(); }}
          >
            {items.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '3rem 1rem',
                color: 'var(--text-muted)', opacity: 0.35,
              }}>
                <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🛒</div>
                <div style={{ fontSize: '0.85rem' }}>Cart is empty</div>
              </div>
            ) : (
              items.map(item => (
                <CartItem
                  key={item.lineId}
                  item={item}
                  selected={item.lineId === selectedLineId}
                  onSelect={selectItem}
                  onEdit={(itm) => setEditProduct(itm)}
                />
              ))
            )}
          </div>

          {/* ── Selected-item strip in counterMode (lives in cart pane) ── */}
          {selectedItem && layoutCfg.counterMode && (
            <div style={{
              flexShrink: 0,
              padding: '0.55rem 0.875rem',
              borderTop: '1px solid var(--border)',
              background: 'rgba(122,193,67,.04)',
              display: 'flex', gap: 6, alignItems: 'center',
            }}>
              <div style={{
                flex: 1, minWidth: 0,
                fontSize: '0.8rem', fontWeight: 600,
                color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {selectedItem.name}
                <span style={{ marginLeft: 8, fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                  {fmt$(selectedItem.unitPrice)} × {selectedItem.qty}
                </span>
              </div>
              <button onClick={openQtyNumpad} style={{
                padding: '0.3rem 0.65rem', borderRadius: 7,
                background: 'var(--bg-input)', color: 'var(--text-secondary)',
                border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Hash size={11} /> QTY
              </button>
              <button onClick={openPriceNumpad} style={{
                padding: '0.3rem 0.65rem', borderRadius: 7,
                background: selectedItem.priceOverridden ? 'rgba(99,179,237,.12)' : 'var(--bg-input)',
                border: selectedItem.priceOverridden ? '1px solid rgba(99,179,237,.35)' : 'none',
                color: selectedItem.priceOverridden ? 'var(--blue)' : 'var(--text-secondary)',
                cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <DollarSign size={11} /> Price
              </button>
              <button onClick={openLineDiscount} style={{
                padding: '0.3rem 0.65rem', borderRadius: 7,
                background: selectedItem.discountType ? 'rgba(245,158,11,.15)' : 'var(--bg-input)',
                border: selectedItem.discountType ? '1px solid rgba(245,158,11,.35)' : 'none',
                color: selectedItem.discountType ? 'var(--amber)' : 'var(--text-secondary)',
                cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Tag size={11} />
                {selectedItem.discountType ? 'Edit Disc.' : 'Discount'}
              </button>
              <button onClick={() => { removeItem(selectedLineId); clearSelection(); }} style={{
                padding: '0.3rem 0.65rem', borderRadius: 7,
                background: 'var(--red-dim)', color: 'var(--red)',
                border: '1px solid rgba(224,63,63,.3)', cursor: 'pointer',
                fontWeight: 700, fontSize: '0.72rem',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Trash2 size={11} /> Void
              </button>
              <button onClick={clearSelection} style={{
                padding: '0.3rem', borderRadius: 7,
                background: 'var(--bg-input)', color: 'var(--text-muted)',
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
              }}>
                <X size={13} />
              </button>
            </div>
          )}

          {/* Totals + Quick Tender — hidden in counterMode (shown in search pane instead) */}
          {!layoutCfg.counterMode && (
          <div style={{ flexShrink: 0 }}>
            {items.length > 0 && (
              <>
                {/* Order discount badge */}
                {orderDiscount && (
                  <div style={{
                    margin: '0 0.75rem 0.4rem',
                    padding: '0.4rem 0.75rem',
                    background: 'rgba(245,158,11,.08)',
                    borderRadius: 8,
                    border: '1px solid rgba(245,158,11,.25)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <Tag size={11} color="var(--amber)" />
                    <span style={{ flex: 1, fontSize: '0.72rem', color: 'var(--amber)', fontWeight: 700 }}>
                      Order Discount:{' '}
                      {orderDiscount.type === 'percent'
                        ? `${orderDiscount.value}% off`
                        : `${fmt$(orderDiscount.value)} off`}
                    </span>
                    <button
                      onClick={removeOrderDiscount}
                      style={{
                        background: 'none', border: 'none',
                        color: 'var(--amber)', cursor: 'pointer',
                        padding: 2, display: 'flex', alignItems: 'center',
                      }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                )}
                {loyaltyRedemption && (
                  <div style={{
                    margin: '0 0.75rem 0.4rem',
                    padding: '0.4rem 0.75rem',
                    background: 'rgba(122,193,67,.07)',
                    borderRadius: 8,
                    border: '1px solid rgba(122,193,67,.25)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <Star size={11} color="var(--green)" />
                    <span style={{ flex: 1, fontSize: '0.72rem', color: 'var(--green)', fontWeight: 700 }}>
                      {loyaltyRedemption.rewardName}:{' '}
                      {loyaltyRedemption.discountType === 'dollar_off'
                        ? `${fmt$(loyaltyRedemption.discountValue)} off`
                        : `${loyaltyRedemption.discountValue}% off`}
                      <span style={{ fontWeight: 400, marginLeft: 4, color: 'var(--text-muted)' }}>
                        ({loyaltyRedemption.pointsCost.toLocaleString()} pts)
                      </span>
                    </span>
                    <button
                      onClick={removeLoyaltyRedemption}
                      style={{
                        background: 'none', border: 'none',
                        color: 'var(--green)', cursor: 'pointer',
                        padding: 2, display: 'flex', alignItems: 'center',
                      }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                )}

                <CartTotals totals={totals} itemCount={items.reduce((s, i) => s + (i.qty || 1), 0)} bagCount={bagCount} />
                {posConfig.bagFee?.enabled && items.length > 0 && (
                  <BagFeeRow bagCount={bagCount} onIncrement={incrementBags} onDecrement={decrementBags} bagPrice={bagPrice} bagTotal={totals.bagTotal || 0} />
                )}

                {/* ── On-screen Quick Cash presets ── */}
                {(() => {
                  const total = totals.grandTotal;
                  const cashPresets = getSmartCashPresets(total);
                  return (
                    <div style={{ padding: '0.25rem 0.75rem 0.5rem' }}>
                      <div style={{
                        fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-muted)',
                        letterSpacing: '0.07em', marginBottom: 5,
                      }}>
                        QUICK CASH
                      </div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {/* Exact amount button — shows dollar figure, not the word "Exact" */}
                        <button
                          onClick={() => quickCashSubmit(total)}
                          style={{
                            padding: '0.3rem 0.65rem', borderRadius: 7,
                            background: 'var(--bg-input)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-secondary)',
                            fontWeight: 700, fontSize: '0.75rem',
                            cursor: 'pointer', flexShrink: 0,
                            display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.2,
                          }}
                        >
                          <span>{fmt$(total)}</span>
                          <span style={{ fontSize: '0.5rem', opacity: 0.6, fontWeight: 600 }}>EXACT</span>
                        </button>
                        {/* Smart presets — first two (nickel + quarter round) in amber */}
                        {cashPresets.map((amt, i) => (
                          <button
                            key={amt}
                            onClick={() => quickCashSubmit(amt)}
                            style={{
                              padding: '0.3rem 0.65rem', borderRadius: 7,
                              background: i < 2 ? 'rgba(245,158,11,.08)' : 'var(--bg-input)',
                              border: `1px solid ${i < 2 ? 'rgba(245,158,11,.3)' : 'var(--border)'}`,
                              color: i < 2 ? 'var(--amber)' : 'var(--text-secondary)',
                              fontWeight: 700, fontSize: '0.75rem',
                              cursor: 'pointer', flexShrink: 0,
                            }}
                          >
                            {fmt$(amt)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* ── Quick Tender Buttons ── */}
                <div style={{ padding: '0.5rem 0.75rem 0.75rem' }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: showEbtButton ? '1fr 1fr 1fr' : '1fr 1fr',
                    gap: 8,
                  }}>
                    {/* CARD — disabled when lottery cash-only is enforced */}
                    <button
                      onClick={() => !cashOnlyEnforced && openTender('card')}
                      disabled={cashOnlyEnforced}
                      title={cashOnlyEnforced ? 'Lottery items — cash only' : undefined}
                      style={{
                        height: 56, borderRadius: 12,
                        background: cashOnlyEnforced ? 'var(--bg-input)' : 'rgba(99,179,237,.12)',
                        border: `1px solid ${cashOnlyEnforced ? 'var(--border)' : 'rgba(99,179,237,.3)'}`,
                        color: cashOnlyEnforced ? 'var(--text-muted)' : 'var(--blue)',
                        fontWeight: 800, fontSize: '0.8rem',
                        cursor: cashOnlyEnforced ? 'not-allowed' : 'pointer',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 2,
                        opacity: cashOnlyEnforced ? 0.45 : 1,
                        transition: 'background .1s, border-color .1s',
                      }}
                      onMouseEnter={e => {
                        if (!cashOnlyEnforced) {
                          e.currentTarget.style.background = 'rgba(99,179,237,.2)';
                          e.currentTarget.style.borderColor = 'rgba(99,179,237,.5)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!cashOnlyEnforced) {
                          e.currentTarget.style.background = 'rgba(99,179,237,.12)';
                          e.currentTarget.style.borderColor = 'rgba(99,179,237,.3)';
                        }
                      }}
                    >
                      <CreditCard size={16} />
                      <span>CARD</span>
                    </button>

                    {/* CASH — opens TenderModal for manual amount entry + split payments */}
                    <button
                      onClick={() => openTender('cash')}
                      style={{
                        height: 56, borderRadius: 12,
                        background: 'rgba(122,193,67,.12)',
                        border: '1px solid rgba(122,193,67,.3)',
                        color: 'var(--green)',
                        fontWeight: 800, fontSize: '0.8rem',
                        cursor: 'pointer',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 2,
                        transition: 'background .1s, border-color .1s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(122,193,67,.2)';
                        e.currentTarget.style.borderColor = 'rgba(122,193,67,.5)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(122,193,67,.12)';
                        e.currentTarget.style.borderColor = 'rgba(122,193,67,.3)';
                      }}
                    >
                      <Banknote size={16} />
                      <span>CASH</span>
                    </button>

                    {/* EBT — only shown when cart has EBT-eligible items */}
                    {showEbtButton && (
                      <button
                        onClick={() => openTender('ebt')}
                        style={{
                          height: 56, borderRadius: 12,
                          background: 'rgba(52,211,153,.1)',
                          border: '1px solid rgba(52,211,153,.3)',
                          color: '#34d399',
                          fontWeight: 800, fontSize: '0.8rem',
                          cursor: 'pointer',
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center', gap: 2,
                          transition: 'background .1s, border-color .1s',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'rgba(52,211,153,.18)';
                          e.currentTarget.style.borderColor = 'rgba(52,211,153,.5)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'rgba(52,211,153,.1)';
                          e.currentTarget.style.borderColor = 'rgba(52,211,153,.3)';
                        }}
                      >
                        <Leaf size={16} />
                        <span>EBT</span>
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Placeholder when cart is empty — keeps the bottom area from collapsing */}
            {items.length === 0 && (
              <div style={{ padding: '0.75rem' }}>
                <div style={{
                  height: 56, borderRadius: 'var(--r-lg)',
                  background: 'var(--bg-input)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600,
                }}>
                  No items
                </div>
              </div>
            )}
          </div>
          )}
        </div>
      </div>

      {/* ══ Bottom Action Bar (full width) ══ */}
      <ActionBar
        enabledShortcuts={posConfig.shortcuts}
        onPriceCheck={() => setShowPriceCheck(true)}
        onOpenItem={() => setShowOpenItem(true)}
        onScanCamera={() => setShowCameraScan(true)}
        onHold={() => setShowHold(true)}
        onHistory={() => setShowHistory(true)}
        onReprint={() => lastCompletedTx ? setReprintTx(lastCompletedTx) : setShowHistory(true)}
        onNoSale={handleNoSale}
        onDiscount={openOrderDiscount}
        onRefund={() => setShowRefund(true)}
        onVoidTx={() => setShowVoid(true)}
        onEndOfDay={() => withLotteryReconciliationGate('endOfDay', () => setShowEndOfDay(true))}
        onOpenCustomer={() => setShowCustomer(true)}
        onOpenShift={() => setShowOpenShift(true)}
        onCloseShift={() => requireManager('Close Shift', () => {
          withLotteryReconciliationGate('closeShift', () => setShowCloseShift(true));
        })}
        onCashDrop={() => { setCashDrawerTab('drop'); setShowCashDrawer(true); }}
        onPayout={() => setShowVendorPayout(true)}
        onLottery={() => setShowLottery(true)}
        onLotteryShift={handleOpenLotteryShift}
        lotteryEnabled={posConfig.lottery?.enabled ?? true}
        onFuelSale={() => setFuelModalMode('sale')}
        onFuelRefund={() => setFuelModalMode('refund')}
        fuelEnabled={fuel.settings?.enabled === true}
        fuelRefundsEnabled={fuel.settings?.allowRefunds !== false}
        onBottleReturn={() => setShowBottleReturn(true)}
        onHardwareSettings={() => setShowHardwareSettings(true)}
        onAdminPortal={() => {
          // PIN-SSO into portal — use the freshly-authenticated manager's
          // token (captured by ManagerPinModal in useManagerStore) and
          // open the portal's /impersonate landing page. This guarantees
          // the user lands as themselves (their permissions, their stores)
          // instead of inheriting whatever stale session existed in that
          // browser's localStorage.
          const auth = useManagerStore.getState().managerAuth;
          const portalUrl = import.meta.env.VITE_PORTAL_URL || 'http://localhost:5173';

          let url;
          if (auth?.token && auth?.id) {
            const user = {
              id:       auth.id,
              name:     auth.name,
              email:    auth.email,
              role:     auth.role,
              orgId:    auth.orgId,
              storeIds: auth.storeId ? [auth.storeId] : [],
            };
            const userParam = encodeURIComponent(JSON.stringify(user));
            url = `${portalUrl}/impersonate?token=${auth.token}&user=${userParam}`;
          } else {
            // Fallback — no captured auth (e.g. manager session valid via
            // a stale flag but no auth object). Worst case: portal loads
            // its existing localStorage session or bounces to /login.
            console.warn('[BackOffice] no managerAuth — falling back to plain portal URL');
            url = `${portalUrl}/portal/realtime`;
          }

          // In Electron, open in the user's default browser so the portal
          // session works (cookies, localStorage, auto-refresh) and doesn't
          // render blank in a fresh BrowserWindow.
          if (window.electronAPI?.openExternal) {
            window.electronAPI.openExternal(url);
          } else {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        }}
        onCustomerDisplay={() => {
          if (window.electronAPI?.openCustomerDisplay) {
            window.electronAPI.openCustomerDisplay();
          } else {
            window.open(`${window.location.origin}/#/customer-display`, 'customer-display', 'width=1024,height=768');
          }
        }}
        onTasks={() => setShowTasks(true)}
        onChat={() => { setChatUnread(0); chatUnreadRef.current = 0; setShowChat(true); }}
        chatUnread={chatUnread}
        onEbtBalance={handleEbtBalance}
        ebtEnabled={!!dejavooEbtEnabled}
        shiftOpen={!!shift}
        heldCount={heldCount}
        actionBarHeight={({'compact':48,'normal':58,'large':72}[posConfig.actionBarHeight] || 58)}
      />

      {/* ══ Modals ══ */}

      {/* Manager PIN (always mounted, renders when pendingAction is set) */}
      <ManagerPinModal />

      {/* EBT Balance result overlay (auto-dismiss on click) */}
      {ebtBalanceResult && (
        <div
          onClick={() => setEbtBalanceResult(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1500,
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 14, padding: '2rem 2.5rem',
              textAlign: 'center', boxShadow: '0 20px 50px rgba(0,0,0,.3)',
              minWidth: 320,
            }}
          >
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>
              EBT Balance
            </div>
            <div style={{ fontSize: '0.9rem', color: '#475569', marginBottom: 4 }}>
              {ebtBalanceResult.type}
            </div>
            {ebtBalanceResult.last4 && (
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: 12 }}>
                Card •••• {ebtBalanceResult.last4}
              </div>
            )}
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: '#16a34a', letterSpacing: '-0.02em' }}>
              ${Number(ebtBalanceResult.amount).toFixed(2)}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 16 }}>
              Tap anywhere to close
            </div>
          </div>
        </div>
      )}

      {showHardwareSettings && (
        <HardwareSettingsModal onClose={() => setShowHardwareSettings(false)} />
      )}

      {editProduct && (
        <ProductEditModal
          item={editProduct}
          hasLabelPrinter={hasLabelPrinter}
          onPrintLabel={hasLabelPrinter ? printShelfLabel : null}
          onClose={() => setEditProduct(null)}
        />
      )}

      {showTasks && <TasksPanel onClose={() => setShowTasks(false)} />}
      {showChat && <ChatPanel onClose={() => setShowChat(false)} />}

      {showTender && (
        <TenderModal
          taxRules={taxRules}
          initMethod={tenderInitMethod}
          initCashAmount={tenderInitCash}
          cashRounding={posConfig.cashRounding || 'none'}
          lotteryCashOnly={posConfig.lottery?.cashOnly || false}
          fuelCashOnly={fuel.settings?.cashOnly || false}
          bagFeeInfo={bagFeeInfo}
          bagCount={bagCount}
          bagPrice={bagPrice}
          onClose={closeTender}
          onPrint={hasReceiptPrinter ? handlePrintTx : undefined}
          onComplete={(tx, change) => handleSaleCompleted(tx, change)}
        />
      )}

      {/* Change-due overlay — shown after every cash sale (quick or modal). */}
      {/* Auto-closes after 5s; any barcode scan dismisses it via handleScan. */}
      {changeDueTx && (
        <ChangeDueOverlay
          tx={changeDueTx}
          changeDue={changeDueAmt}
          isRefund={changeDueRefund}
          onClose={dismissChangeDue}
          onPrint={hasReceiptPrinter ? handlePrintTx : undefined}
        />
      )}

      {scanMode === 'age_verify' && <AgeVerificationModal />}

      {discountTarget !== undefined && (
        <DiscountModal
          lineId={discountTarget}
          onClose={() => setDiscountTarget(undefined)}
        />
      )}

      {showHold && (
        <HoldRecallModal onClose={() => { setShowHold(false); refreshHeldCount(); }} />
      )}

      {showCustomer && (
        <CustomerLookupModal onClose={() => setShowCustomer(false)} />
      )}

      {showPriceCheck && (
        <PriceCheckModal onClose={() => setShowPriceCheck(false)} />
      )}

      {numpad && (
        <NumpadModal
          mode={numpad.mode}
          title={numpad.title}
          value={numpad.value}
          onChange={(v) => setNumpad(prev => prev ? { ...prev, value: v } : null)}
          onConfirm={numpad.onConfirm}
          onCancel={() => setNumpad(null)}
        />
      )}

      {showHistory && (
        <TransactionHistoryModal
          onClose={() => setShowHistory(false)}
          onPrintTx={(tx) => handlePrintTx(tx)}
          onViewTx={(tx)  => { setShowHistory(false); setReprintTx(tx); }}
        />
      )}

      {reprintTx && (
        <ReprintReceiptModal
          tx={reprintTx}
          onPrint={handlePrintTx}
          onClose={() => setReprintTx(null)}
        />
      )}

      {/* ── "Ask for receipt" prompt (receiptPrintBehavior = 'ask') ── */}
      {receiptAskTx && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(0,0,0,.72)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '1rem',
        }}>
          <div style={{
            background: 'var(--bg-panel)',
            borderRadius: 20, padding: '2rem 2rem 1.5rem',
            width: '100%', maxWidth: 360, textAlign: 'center',
            border: '1px solid var(--border-light)',
            boxShadow: '0 32px 80px rgba(0,0,0,.65)',
          }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🧾</div>
            <div style={{ fontWeight: 800, fontSize: '1.15rem', marginBottom: 6 }}>Print Receipt?</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              {receiptAskTx.txNumber} · {(receiptAskTx.grandTotal < 0 ? '-' : '') + '$' + Math.abs(receiptAskTx.grandTotal || 0).toFixed(2)}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { handlePrintTx(receiptAskTx); setReceiptAskTx(null); }}
                style={{
                  flex: 2, padding: '0.9rem', borderRadius: 12,
                  background: 'var(--green)', color: '#fff',
                  fontWeight: 800, fontSize: '0.95rem', border: 'none', cursor: 'pointer',
                }}
              >
                Print Receipt
              </button>
              <button
                onClick={() => setReceiptAskTx(null)}
                style={{
                  flex: 1, padding: '0.9rem', borderRadius: 12,
                  background: 'var(--bg-input)', color: 'var(--text-secondary)',
                  fontWeight: 600, fontSize: '0.9rem', border: 'none', cursor: 'pointer',
                }}
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {showVoid && (
        <VoidModal
          items={items}
          totals={totals}
          onConfirm={() => { clearCart(); clearSelection(); }}
          onClose={() => setShowVoid(false)}
        />
      )}

      {showRefund && (
        <RefundModal storeId={storeId} onClose={() => setShowRefund(false)} />
      )}

      {showEndOfDay && (
        <EndOfDayModal onClose={() => setShowEndOfDay(false)} />
      )}

      {/* ── Shift / Cash Drawer Modals ── */}
      {/* When auto-shown (no shift), don't allow dismissal — cashier must open a shift */}
      {showOpenShift && storeId && (
        <OpenShiftModal
          storeId={storeId}
          onClose={shift ? () => setShowOpenShift(false) : null}
          onOpened={() => setShowOpenShift(false)}
        />
      )}

      {showCloseShift && (
        <CloseShiftModal
          onClose={() => setShowCloseShift(false)}
          onClosed={() => setShowCloseShift(false)}
        />
      )}

      {showCashDrawer && (
        <CashDrawerModal
          defaultTab={cashDrawerTab}
          onClose={() => setShowCashDrawer(false)}
          onPrint={hasReceiptPrinter ? handlePrintTx : undefined}
        />
      )}

      {/* ── Lottery Modal (combined Sale + Payout) ── */}
      <LotteryModal
        open={showLottery}
        games={lotteryGames}
        onClose={() => setShowLottery(false)}
      />

      {/* ── Fuel Modal (sale or refund) ── */}
      <FuelModal
        open={!!fuelModalMode}
        mode={fuelModalMode || 'sale'}
        fuelTypes={fuel.types}
        defaultEntryMode={fuel.settings?.defaultEntryMode || 'amount'}
        defaultFuelTypeId={fuel.settings?.defaultFuelTypeId}
        onClose={() => setFuelModalMode(null)}
      />
      {showLotteryShift && (
        <LotteryShiftModal
          open
          shiftId={shift?.id}
          activeBoxes={lotteryActiveBoxes}
          sessionSales={sessionSales}
          sessionPayouts={sessionPayouts}
          scanRequired={posConfig.lottery?.scanRequiredAtShiftEnd || false}
          pendingShiftClose={pendingShiftClose}
          onSave={handleLotteryShiftSave}
          onClose={() => { setShowLotteryShift(false); setPendingShiftClose(false); }}
        />
      )}

      {/* ── Bottle Redemption Modal ── */}
      {showBottleReturn && (
        <BottleRedemptionModal
          onClose={() => setShowBottleReturn(false)}
          onComplete={() => setShowBottleReturn(false)}
        />
      )}

      {/* ── Vendor Payout Modal ── */}
      {showVendorPayout && (
        <VendorPayoutModal
          onClose={() => setShowVendorPayout(false)}
          onComplete={(tx) => { setShowVendorPayout(false); }}
        />
      )}

      {/* ── Pack Size Picker Modal ── */}
      {packPickerProduct && (
        <PackSizePickerModal
          product={packPickerProduct}
          onSelect={(size) => handlePackSizeSelect(packPickerProduct, size)}
          onCancel={() => { setPackPickerProduct(null); flash('miss'); }}
        />
      )}

      {/* ── Open Item / Manual Entry Modal ── */}
      {showOpenItem && <OpenItemModal onClose={() => setShowOpenItem(false)} />}

      {/* ── Add Product Modal (manager only, triggered from scan-not-found) ──
          Session 39 — swapped from AddProductModal to the full 1:1 ported
          ProductFormModal so cashiers see the exact same form as back-office. */}
      {addProductUpc && (
        <ProductFormModal
          scannedUpc={addProductUpc}
          onClose={() => setAddProductUpc(null)}
          onSaved={(product) => {
            setAddProductUpc(null);
            if (!product) return;
            // Add newly created product to cart immediately
            addWithAgeCheck({
              ...product,
              retailPrice: product.retailPrice ?? Number(product.defaultRetailPrice ?? 0),
            });
            flash('hit');
          }}
        />
      )}

      {/* Camera barcode scanner — for tablets / phones without a handheld
          scanner. Detected code flows through handleScan like any keyboard
          wedge scan (age gate, pack-size picker, add-product fallback all fire). */}
      <BarcodeScannerModal
        open={showCameraScan}
        onClose={() => setShowCameraScan(false)}
        onDetected={(code) => {
          setShowCameraScan(false);
          handleScan(code);
        }}
        title="Scan product barcode"
      />
    </div>
  );
}
