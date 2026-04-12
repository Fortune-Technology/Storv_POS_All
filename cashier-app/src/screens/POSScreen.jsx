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
import QuickFoldersPanel    from '../components/pos/QuickFoldersPanel.jsx';
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
import BottleRedemptionModal   from '../components/modals/BottleRedemptionModal.jsx';
import VendorPayoutModal from '../components/modals/VendorPayoutModal.jsx';
import PackSizePickerModal from '../components/modals/PackSizePickerModal.jsx';
import AddProductModal from '../components/modals/AddProductModal.jsx';
import ProductEditModal from '../components/modals/ProductEditModal.jsx';
import TasksPanel      from '../components/modals/TasksPanel.jsx';
import ChatPanel       from '../components/modals/ChatPanel.jsx';
import HardwareSettingsModal from '../components/modals/HardwareSettingsModal.jsx';
import { useLotteryStore } from '../stores/useLotteryStore.js';
import { getLotteryBoxes, getPosBranding, logPosEvent } from '../api/pos.js';

import { useBarcodeScanner } from '../hooks/useBarcodeScanner.js';
import { useProductLookup }  from '../hooks/useProductLookup.js';
import { useCatalogSync }    from '../hooks/useCatalogSync.js';
import { useBranding }       from '../hooks/useBranding.js';
import { useOnlineStatus }   from '../hooks/useOnlineStatus.js';
import { usePOSConfig }      from '../hooks/usePOSConfig.js';
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
    customer, clearCustomer, clearCart,
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

  const requireManager = useManagerStore(s => s.requireManager);
  const { lookup }     = useProductLookup();
  const { manualSync } = useCatalogSync();
  const posConfig      = usePOSConfig();
  const cashier        = useAuthStore(s => s.cashier);

  // ── Hardware (receipt printer, cash drawer) ──────────────────────────────
  const { printReceipt, openDrawer, hasReceiptPrinter, hasCashDrawer, scale, hasScale } = useHardware();

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
    }).catch(() => {});
  }, [hasReceiptPrinter, printReceipt, storeBranding, cashier]);

  // ── No Sale — open drawer + log event ─────────────────────────────────────
  const handleNoSale = useCallback(() => {
    // Open cash drawer
    if (hasCashDrawer) {
      openDrawer().catch(() => {});
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

  // Load active shift on mount. Once load completes and shift is null → auto-show OpenShiftModal.
  const [shiftChecked, setShiftChecked] = useState(false);
  useEffect(() => {
    if (!storeId) return;
    loadActiveShift(storeId).then(() => setShiftChecked(true));
    // Load branding for receipt header
    getPosBranding(storeId).then(b => setStoreBranding(b || {})).catch(() => {});
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
        .catch(() => {});
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
  const [showBottleReturn,   setShowBottleReturn]   = useState(false);
  const [showVendorPayout,   setShowVendorPayout]   = useState(false);
  const [showHardwareSettings, setShowHardwareSettings] = useState(false);
  const [editProduct,        setEditProduct]        = useState(null);  // cart item being quick-edited
  const [showTasks,          setShowTasks]          = useState(false);
  const [showChat,           setShowChat]           = useState(false);
  const [quickTab,           setQuickTab]           = useState('catalog'); // 'catalog' | 'quick'
  const [lotteryActiveBoxes, setLotteryActiveBoxes] = useState([]);
  // Lottery shift reconciliation state
  const [lotteryShiftDone,   setLotteryShiftDone]   = useState(false);
  const [pendingShiftClose,  setPendingShiftClose]  = useState(false);
  // Discount modal: discountTarget = lineId string → line discount, null → order discount
  const [discountTarget,  setDiscountTarget]  = useState(undefined); // undefined = closed

  // Held transaction count — shown as badge on the Hold button
  const [heldCount, setHeldCount] = useState(0);
  const refreshHeldCount = useCallback(() => {
    getHeldTransactions().then(list => setHeldCount(list.length)).catch(() => {});
  }, []);
  useEffect(() => { refreshHeldCount(); }, [refreshHeldCount]);

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
    // If age verification is disabled in store settings, skip check entirely
    if (!posConfig.ageVerification) {
      addProduct(product);
      return;
    }
    if (product.ageRequired && verifiedAges.includes(product.ageRequired)) {
      addProduct(product); // same age threshold already cleared this transaction
    } else if (product.ageRequired) {
      requestAgeVerify(product);
    } else {
      addProduct(product);
    }
  }, [posConfig.ageVerification, verifiedAges, addProduct, requestAgeVerify]);

  // ── Scan error toast ──────────────────────────────────────────────────────
  const [scanError, setScanError]           = useState(null);  // { upc, ts }
  const [addProductUpc, setAddProductUpc]   = useState(null);  // UPC string when manager creates product
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
  const handleLotteryShiftSave = async (data) => {
    await saveLotteryShiftReport(data);
    setLotteryShiftDone(true);
    setShowLotteryShift(false);
    // If this reconciliation was triggered by a shift-close request, proceed now
    if (pendingShiftClose) {
      setPendingShiftClose(false);
      setShowCloseShift(true);
    }
  };

  // Opens LotteryShiftModal after refreshing active boxes (standalone button)
  const handleOpenLotteryShift = () => {
    getLotteryBoxes({ storeId, status: 'active' })
      .then(r => setLotteryActiveBoxes(r?.data || r || []))
      .catch(() => {});
    setShowLotteryShift(true);
  };

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

  // ── Flash background ─────────────────────────────────────────────────────
  const flashBg = flashState === 'hit'
    ? { animation: 'flashGreen .32s ease forwards' }
    : flashState === 'miss'
    ? { animation: 'flashRed .32s ease forwards' }
    : {};

  // ── Show EBT quick-tender button only when there are EBT-eligible items ──
  const showEbtButton = totals.ebtTotal > 0;

  // ── Lottery cash-only: disable Card / EBT quick-tender when enforced ──
  const cashOnlyEnforced = (posConfig.lottery?.cashOnly ?? false) && items.some(i => i.isLottery);

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

          {/* ── Quick Access tab bar ── */}
          {posConfig.quickFolders?.length > 0 && (
            <div style={{
              display: 'flex', borderBottom: '1px solid var(--border)',
              flexShrink: 0, background: 'var(--bg-panel)',
            }}>
              {[
                { key: 'catalog', label: 'CATALOG' },
                { key: 'quick',   label: '⚡ QUICK' },
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
          {quickTab === 'quick' && (
            <QuickFoldersPanel folders={posConfig.quickFolders || []} />
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
                  <CartTotals totals={totals} itemCount={items.length} bagCount={bagCount} />
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
                            <button key={amt} onClick={() => openTender('cash', amt)} style={{ padding: '0.3rem 0.65rem', borderRadius: 7, background: i < 2 ? 'rgba(245,158,11,.08)' : 'var(--bg-input)', border: `1px solid ${i < 2 ? 'rgba(245,158,11,.3)' : 'var(--border)'}`, color: i < 2 ? 'var(--amber)' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer', flexShrink: 0 }}>
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
              <button onClick={() => setShowCustomer(true)} style={{
                flex: 1, background: 'none', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600,
                padding: '2px 0',
              }}>
                <User size={13} />
                Attach customer (optional)
              </button>
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
              {items.length > 0 && (
                <span style={{ marginLeft: 6, fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  · {items.length} item{items.length !== 1 ? 's' : ''}
                </span>
              )}
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

                <CartTotals totals={totals} itemCount={items.length} bagCount={bagCount} />
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
                          onClick={() => openTender('cash', total)}
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
                            onClick={() => openTender('cash', amt)}
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

                    {/* CASH */}
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
        onHold={() => setShowHold(true)}
        onHistory={() => setShowHistory(true)}
        onReprint={() => lastCompletedTx ? setReprintTx(lastCompletedTx) : setShowHistory(true)}
        onNoSale={handleNoSale}
        onDiscount={openOrderDiscount}
        onRefund={() => setShowRefund(true)}
        onVoidTx={() => setShowVoid(true)}
        onEndOfDay={() => setShowEndOfDay(true)}
        onOpenCustomer={() => setShowCustomer(true)}
        onOpenShift={() => setShowOpenShift(true)}
        onCloseShift={() => requireManager('Close Shift', () => {
          const scanReq     = posConfig.lottery?.scanRequiredAtShiftEnd;
          const lotteryOn   = posConfig.lottery?.enabled ?? true;
          const hasBoxes    = lotteryActiveBoxes.length > 0;
          if (scanReq && lotteryOn && hasBoxes && !lotteryShiftDone) {
            // Must reconcile lottery first — refresh boxes then show modal
            getLotteryBoxes({ storeId, status: 'active' })
              .then(r => setLotteryActiveBoxes(r?.data || r || []))
              .catch(() => {});
            setPendingShiftClose(true);
            setShowLotteryShift(true);
          } else {
            setShowCloseShift(true);
          }
        })}
        onCashDrop={() => { setCashDrawerTab('drop'); setShowCashDrawer(true); }}
        onPayout={() => setShowVendorPayout(true)}
        onLottery={() => setShowLottery(true)}
        onLotteryShift={handleOpenLotteryShift}
        lotteryEnabled={posConfig.lottery?.enabled ?? true}
        onBottleReturn={() => setShowBottleReturn(true)}
        onHardwareSettings={() => setShowHardwareSettings(true)}
        onCustomerDisplay={() => {
          if (window.electronAPI?.openCustomerDisplay) {
            window.electronAPI.openCustomerDisplay();
          } else {
            window.open(`${window.location.origin}/#/customer-display`, 'customer-display', 'width=1024,height=768');
          }
        }}
        onTasks={() => setShowTasks(true)}
        onChat={() => setShowChat(true)}
        shiftOpen={!!shift}
        heldCount={heldCount}
        actionBarHeight={({'compact':48,'normal':58,'large':72}[posConfig.actionBarHeight] || 58)}
      />

      {/* ══ Modals ══ */}

      {/* Manager PIN (always mounted, renders when pendingAction is set) */}
      <ManagerPinModal />

      {showHardwareSettings && (
        <HardwareSettingsModal onClose={() => setShowHardwareSettings(false)} />
      )}

      {editProduct && (
        <ProductEditModal item={editProduct} onClose={() => setEditProduct(null)} />
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
          bagFeeInfo={bagFeeInfo}
          bagCount={bagCount}
          bagPrice={bagPrice}
          onClose={closeTender}
          onPrint={hasReceiptPrinter ? handlePrintTx : undefined}
          onComplete={(tx) => {
            setLastCompletedTx(tx);

            // ── Broadcast transaction complete to customer display ─────────
            publishDisplay({
              type: 'transaction_complete',
              txNumber: tx.txNumber,
              change: tx.changeGiven || 0,
            });

            // ── Auto-open cash drawer on cash payment ──────────────────────
            const hasCashTender = tx.tenderLines?.some(t => t.method === 'cash');
            if (hasCashTender && hasCashDrawer) {
              openDrawer().catch(() => {});
            }

            // ── Receipt printing — for cash transactions the change-due screen
            //    shows Print / Skip so the cashier controls it there.
            //    For non-cash (card, EBT, etc.) use the store-level setting.
            if (!hasCashTender && hasReceiptPrinter) {
              const printBehavior = storeBranding.receiptPrintBehavior || 'always';
              if (printBehavior === 'always') {
                handlePrintTx(tx);
              } else if (printBehavior === 'ask') {
                setReceiptAskTx(tx);
              }
              // 'never' → do nothing
            }
          }}
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
        <RefundModal onClose={() => setShowRefund(false)} />
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

      {/* ── Add Product Modal (manager only, triggered from scan-not-found) ── */}
      {addProductUpc && (
        <AddProductModal
          scannedUpc={addProductUpc}
          onCreated={(product) => {
            setAddProductUpc(null);
            // Add newly created product to cart immediately
            addWithAgeCheck({
              ...product,
              retailPrice: product.retailPrice ?? Number(product.defaultRetailPrice ?? 0),
            });
            flash('hit');
          }}
          onClose={() => setAddProductUpc(null)}
        />
      )}
    </div>
  );
}
