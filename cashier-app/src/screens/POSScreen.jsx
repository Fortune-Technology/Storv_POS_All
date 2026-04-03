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
  DollarSign, Trash2, Tag,
  CreditCard, Banknote, Leaf,
  Hash,
} from 'lucide-react';

import StatusBar            from '../components/layout/StatusBar.jsx';
import CartItem             from '../components/cart/CartItem.jsx';
import CartTotals           from '../components/cart/CartTotals.jsx';
import TenderModal          from '../components/tender/TenderModal.jsx';
import AgeVerificationModal from '../components/modals/AgeVerificationModal.jsx';
import ActionBar            from '../components/pos/ActionBar.jsx';
import CategoryPanel        from '../components/pos/CategoryPanel.jsx';
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

import { useBarcodeScanner } from '../hooks/useBarcodeScanner.js';
import { useProductLookup }  from '../hooks/useProductLookup.js';
import { useCatalogSync }    from '../hooks/useCatalogSync.js';
import { useBranding }       from '../hooks/useBranding.js';
import { useOnlineStatus }   from '../hooks/useOnlineStatus.js';
import { usePOSConfig }      from '../hooks/usePOSConfig.js';
import { useCartStore, selectTotals } from '../stores/useCartStore.js';
import { useManagerStore }   from '../stores/useManagerStore.js';
import { db, searchProducts } from '../db/dexie.js';
import { fmt$ }              from '../utils/formatters.js';
import { getSmartCashPresets } from '../utils/cashPresets.js';

export default function POSScreen() {
  const {
    items, selectedLineId, scanMode,
    addProduct, removeItem, updateQty, overridePrice,
    selectItem, clearSelection, requestAgeVerify,
    flash, flashState,
    customer, clearCustomer, clearCart,
    orderDiscount, removeOrderDiscount,
    verifiedAges,
  } = useCartStore();

  const requireManager = useManagerStore(s => s.requireManager);
  const { lookup }     = useProductLookup();
  const { manualSync } = useCatalogSync();
  const posConfig      = usePOSConfig();

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
  // Discount modal: discountTarget = lineId string → line discount, null → order discount
  const [discountTarget,  setDiscountTarget]  = useState(undefined); // undefined = closed

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

  // ── Derived ──────────────────────────────────────────────────────────────
  const totals       = selectTotals(items, taxRules, orderDiscount);
  const selectedItem = items.find(i => i.lineId === selectedLineId);

  // ── Age-check helper: skip if already verified this transaction ──────────
  const addWithAgeCheck = useCallback((product) => {
    if (product.ageRequired && verifiedAges.includes(product.ageRequired)) {
      addProduct(product); // same age threshold already cleared this transaction
    } else if (product.ageRequired) {
      requestAgeVerify(product);
    } else {
      addProduct(product);
    }
  }, [verifiedAges, addProduct, requestAgeVerify]);

  // ── Barcode scan ─────────────────────────────────────────────────────────
  const handleScan = useCallback(async (raw) => {
    if (scanMode !== 'normal') return;
    const { product } = await lookup(raw);
    if (!product) { flash('miss'); return; }
    addWithAgeCheck({ ...product, retailPrice: product.retailPrice });
    flash('hit');
  }, [scanMode, lookup, addWithAgeCheck, flash]);

  useBarcodeScanner(handleScan, scanMode === 'normal');

  // ── Product search ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    searchProducts(searchQuery, null).then(setSearchResults);
  }, [searchQuery]);

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
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-base)', overflow: 'hidden',
    }}>
      <StatusBar onRefresh={manualSync} />

      {/* ── Content row ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ══════════════════════════════════════════
            LEFT PANE — Search + Category / Quick-Add
        ══════════════════════════════════════════ */}
        <div style={{
          width: layoutCfg.searchWidth, display: 'flex', flexDirection: 'column',
          order: layoutCfg.searchOrder,
          borderRight: layoutCfg.searchOrder === 1 ? '1px solid var(--border)' : 'none',
          borderLeft: layoutCfg.searchOrder === 2 ? '1px solid var(--border)' : 'none',
          ...flashBg,
        }}>

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
              <div style={{
                position: 'absolute', zIndex: 50,
                left: '0.875rem',
                right: '0.875rem',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--r-md)',
                marginTop: 4, maxHeight: 300, overflowY: 'auto',
                boxShadow: '0 8px 32px rgba(0,0,0,.45)',
              }}>
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

          {/* Category panel (flex: 1 so it fills the remaining space) */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <CategoryPanel
              config={{
                showDepartments: layoutCfg.showDepts,
                showQuickAdd: layoutCfg.showQuick,
              }}
              onAddProduct={(product) => {
                addWithAgeCheck(product);
                flash('hit');
              }}
            />
          </div>

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
                  <CartTotals totals={totals} itemCount={items.length} />
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
                      <button onClick={() => openTender('card')} style={{ height: 56, borderRadius: 12, background: 'rgba(99,179,237,.12)', border: '1px solid rgba(99,179,237,.3)', color: 'var(--blue)', fontWeight: 800, fontSize: '0.8rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, transition: 'background .1s' }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,179,237,.2)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,179,237,.12)'; }}>
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
            className="scroll"
            style={{ flex: 1, padding: '0.4rem 0.5rem', overflowY: 'auto' }}
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

                <CartTotals totals={totals} itemCount={items.length} />

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
                    {/* CARD */}
                    <button
                      onClick={() => openTender('card')}
                      style={{
                        height: 56, borderRadius: 12,
                        background: 'rgba(99,179,237,.12)',
                        border: '1px solid rgba(99,179,237,.3)',
                        color: 'var(--blue)',
                        fontWeight: 800, fontSize: '0.8rem',
                        cursor: 'pointer',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 2,
                        transition: 'background .1s, border-color .1s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(99,179,237,.2)';
                        e.currentTarget.style.borderColor = 'rgba(99,179,237,.5)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(99,179,237,.12)';
                        e.currentTarget.style.borderColor = 'rgba(99,179,237,.3)';
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
        onReprint={() => setShowHistory(true)}
        onNoSale={() => {}}
        onDiscount={openOrderDiscount}
        onRefund={() => setShowRefund(true)}
        onVoidTx={() => setShowVoid(true)}
        onEndOfDay={() => setShowEndOfDay(true)}
        onOpenCustomer={() => setShowCustomer(true)}
      />

      {/* ══ Modals ══ */}

      {/* Manager PIN (always mounted, renders when pendingAction is set) */}
      <ManagerPinModal />

      {showTender && (
        <TenderModal
          taxRules={taxRules}
          initMethod={tenderInitMethod}
          initCashAmount={tenderInitCash}
          cashRounding={posConfig.cashRounding || 'none'}
          onClose={closeTender}
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
        <HoldRecallModal onClose={() => setShowHold(false)} />
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
        <TransactionHistoryModal onClose={() => setShowHistory(false)} />
      )}

      {showVoid && (
        <VoidModal onClose={() => setShowVoid(false)} />
      )}

      {showRefund && (
        <RefundModal onClose={() => setShowRefund(false)} />
      )}

      {showEndOfDay && (
        <EndOfDayModal onClose={() => setShowEndOfDay(false)} />
      )}
    </div>
  );
}
