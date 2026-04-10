/**
 * InventoryCount — Quick mobile-friendly inventory counting tool
 *
 * Features:
 *  - Barcode scanner (USB / camera — autofocus input captures scanned codes)
 *  - Product lookup by UPC, name, or SKU
 *  - Shows current stock level + recent adjustment history
 *  - Count mode: set absolute count  |  Adjust mode: add / subtract
 *  - Works great on phones for physical inventory counts
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  searchCatalogProducts,
  getStoreInventory,
  adjustStoreStock,
  upsertStoreInventory,
} from '../services/api';
import { toast } from 'react-toastify';
import {
  Scan, Search, Package, Plus, Minus, CheckCircle,
  RefreshCw, X, ChevronDown, ChevronUp, BarChart2,
  AlertCircle, Loader, History, ClipboardList,
} from 'lucide-react';
import './InventoryCount.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n) {
  return n == null ? '—' : Number(n).toFixed(2);
}

// ─── ProductCard ──────────────────────────────────────────────────────────────
function ProductCard({ product, storeProduct, onAdjust, onSetCount, mode }) {
  const [customAdj, setCustomAdj] = useState('');
  const qty    = storeProduct?.quantityOnHand != null ? Number(storeProduct.quantityOnHand) : null;
  const isLow  = qty != null && qty <= (product.reorderPoint || 2);
  const isNeg  = qty != null && qty < 0;

  const applyCustom = () => {
    const n = parseFloat(customAdj);
    if (isNaN(n) || n === 0) { toast.error('Enter a valid non-zero number'); return; }
    onAdjust(n);
    setCustomAdj('');
  };

  const customValid = customAdj && !isNaN(parseFloat(customAdj));

  return (
    <div className="ic-product-card">
      {/* Product info */}
      <div className="ic-product-info">
        <div className="ic-product-details">
          <div className="ic-product-name">{product.name}</div>
          <div className="ic-product-meta">
            {product.upc    && <span>UPC: {product.upc}</span>}
            {product.sku    && <span>SKU: {product.sku}</span>}
            {product.brand  && <span>{product.brand}</span>}
            {product.department?.name && (
              <span className="ic-product-dept">{product.department.name}</span>
            )}
          </div>
        </div>
        <div className="ic-product-qty-wrap">
          <div className={`ic-product-qty ${isNeg ? 'negative' : isLow ? 'low' : 'ok'}`}>
            {qty != null ? qty.toFixed(qty % 1 === 0 ? 0 : 2) : '?'}
          </div>
          <div className="ic-product-qty-label">
            {qty == null ? 'Not tracked' : 'On Hand'}
          </div>
          {isNeg && <div className="ic-product-warning negative">⚠ Negative</div>}
          {isLow && !isNeg && <div className="ic-product-warning low">⚠ Low stock</div>}
        </div>
      </div>

      {/* Prices */}
      <div className="ic-prices">
        {(storeProduct?.retailPrice ?? product.defaultRetailPrice) != null && (
          <span><span className="ic-price-label">Retail: </span><strong>${fmt(storeProduct?.retailPrice ?? product.defaultRetailPrice)}</strong></span>
        )}
        {(storeProduct?.costPrice ?? product.defaultCostPrice) != null && (
          <span><span className="ic-price-label">Cost: </span><strong>${fmt(storeProduct?.costPrice ?? product.defaultCostPrice)}</strong></span>
        )}
        {product.casePacks && (
          <span><span className="ic-price-label">Case: </span><strong>{product.casePacks} units</strong></span>
        )}
      </div>

      {/* Count controls */}
      {mode === 'adjust' ? (
        <div className="ic-adjust-row">
          <button onClick={() => onAdjust(-1)} className="ic-adjust-btn-minus">
            <Minus size={20} />
          </button>
          <div className="ic-adjust-hint">
            Tap − or + to adjust by 1 case, or use quick buttons:
          </div>
          <button onClick={() => onAdjust(1)} className="ic-adjust-btn-plus">
            <Plus size={20} />
          </button>
        </div>
      ) : (
        <CountInput onSet={onSetCount} currentQty={qty} />
      )}

      {/* Quick adjust buttons */}
      <div className="ic-quick-btns">
        {mode === 'adjust' && [1, 2, 3, 6, 12, 24].map(n => (
          <button key={n} onClick={() => onAdjust(n)} className="ic-quick-plus">
            +{n}
          </button>
        ))}
        {mode === 'adjust' && [-1, -6, -12].map(n => (
          <button key={n} onClick={() => onAdjust(n)} className="ic-quick-minus">
            {n}
          </button>
        ))}
      </div>

      {/* Custom amount input */}
      {mode === 'adjust' && (
        <div className="ic-custom-row">
          <input
            type="number"
            inputMode="decimal"
            step="1"
            value={customAdj}
            onChange={e => setCustomAdj(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyCustom()}
            onWheel={e => e.target.blur()}
            placeholder="Custom ± amount  (e.g. +47 or -3)"
            className="ic-custom-input"
          />
          <button
            onClick={applyCustom}
            className={`ic-custom-apply ${customValid ? 'ready' : 'disabled'}`}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

// ─── CountInput ───────────────────────────────────────────────────────────────
function CountInput({ onSet, currentQty }) {
  const [val, setVal] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const handle = () => {
    const n = parseFloat(val);
    if (isNaN(n)) { toast.error('Enter a valid number'); return; }
    onSet(n);
    setVal('');
  };

  return (
    <div className="ic-count-row">
      <div className="ic-count-field">
        <label className="ic-count-label">Set Count (absolute)</label>
        <input
          ref={ref}
          type="number"
          inputMode="decimal"
          min="0"
          step="1"
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handle()}
          onWheel={e => e.target.blur()}
          placeholder={currentQty != null ? `Current: ${currentQty}` : 'Enter count'}
          className="ic-count-input"
        />
      </div>
      <button onClick={handle} className="ic-count-submit">
        <CheckCircle size={18} />
      </button>
    </div>
  );
}

// ─── RecentHistory ────────────────────────────────────────────────────────────
function RecentHistory({ history }) {
  if (!history.length) return null;
  return (
    <div className="ic-recent">
      <div className="ic-recent-label">
        <History size={12} /> Recent adjustments
      </div>
      {history.slice(0, 5).map((h, i) => (
        <div key={i} className="ic-recent-row">
          <span className="ic-recent-name">{h.productName}</span>
          <span className={`ic-recent-adj ${h.adjustment > 0 ? 'positive' : 'negative'}`}>
            {h.adjustment > 0 ? '+' : ''}{h.adjustment} {h.mode === 'count' ? '(set)' : ''}
          </span>
          <span className="ic-recent-qty">
            {h.newQty?.toFixed ? h.newQty.toFixed(0) : h.newQty} on hand
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main InventoryCount page ─────────────────────────────────────────────────
const InventoryCount = () => {
  const [query,        setQuery]        = useState('');
  const [results,      setResults]      = useState([]);
  const [isSearching,  setIsSearching]  = useState(false);
  const [selected,     setSelected]     = useState(null);      // { product, storeProduct }
  const [mode,         setMode]         = useState('adjust');  // 'adjust' | 'count'
  const [isSaving,     setIsSaving]     = useState(false);
  const [history,      setHistory]      = useState([]);
  const [showHistory,  setShowHistory]  = useState(true);
  const scanInputRef = useRef(null);
  const searchTimer  = useRef(null);

  // Auto-focus the scan input on mount
  useEffect(() => { scanInputRef.current?.focus(); }, []);

  const search = useCallback(async (q) => {
    const term = q.trim();
    if (!term) { setResults([]); return; }
    setIsSearching(true);
    try {
      const result = await searchCatalogProducts(term);
      const products = Array.isArray(result) ? result : (result?.data || []);
      setResults(products);

      if (products.length === 1) {
        await selectProduct(products[0]);
        setQuery('');
        setResults([]);
        scanInputRef.current?.focus();
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  }, []); // eslint-disable-line

  const handleQueryChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => search(v), 350);
  };

  const handleQueryKeyDown = (e) => {
    if (e.key === 'Enter') {
      clearTimeout(searchTimer.current);
      search(query);
    }
  };

  const selectProduct = async (product) => {
    const storeId = localStorage.getItem('activeStoreId');
    let storeProduct = null;
    if (storeId) {
      try {
        const inv = await getStoreInventory({ masterProductId: product.id, storeId });
        const data = Array.isArray(inv) ? inv : (inv?.data || []);
        storeProduct = data[0] || null;
      } catch (_) {}
    }
    setSelected({ product, storeProduct });
    setResults([]);
  };

  const handleAdjust = async (delta) => {
    if (!selected) return;
    setIsSaving(true);
    try {
      const res = await adjustStoreStock({
        masterProductId: selected.product.id,
        adjustment:      delta,
        reason:          'Inventory count — manual adjustment',
      });
      const newQty = res?.newQty ?? ((Number(selected.storeProduct?.quantityOnHand) || 0) + delta);
      setHistory(h => [{
        productName: selected.product.name,
        adjustment:  delta,
        newQty,
        mode:        'adjust',
        ts:          Date.now(),
      }, ...h]);
      setSelected(s => ({
        ...s,
        storeProduct: { ...(s.storeProduct || {}), quantityOnHand: newQty },
      }));
      toast.success(`${selected.product.name}: ${delta > 0 ? '+' : ''}${delta} → ${Number(newQty).toFixed(0)} on hand`);
    } catch (err) {
      toast.error('Adjustment failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetCount = async (newCount) => {
    if (!selected) return;
    const current = Number(selected.storeProduct?.quantityOnHand) || 0;
    const delta   = newCount - current;
    setIsSaving(true);
    try {
      const res = await upsertStoreInventory({
        masterProductId: selected.product.id,
        quantityOnHand:  newCount,
      });
      const finalQty = res?.data?.quantityOnHand ?? newCount;
      setHistory(h => [{
        productName: selected.product.name,
        adjustment:  delta,
        newQty:      finalQty,
        mode:        'count',
        ts:          Date.now(),
      }, ...h]);
      setSelected(s => ({
        ...s,
        storeProduct: { ...(s.storeProduct || {}), quantityOnHand: finalQty },
      }));
      toast.success(`${selected.product.name}: count set to ${Number(finalQty).toFixed(0)}`);
    } catch (err) {
      toast.error('Count update failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsSaving(false);
    }
  };

  return (
      <div className="p-page ic-main">

        {/* ── Header ── */}
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <ClipboardList size={22} />
            </div>
            <div>
              <h1 className="p-title">Inventory Count</h1>
              <p className="p-subtitle">Scan barcodes or search to quickly update stock levels</p>
            </div>
          </div>
          <div className="p-header-actions"></div>
        </div>

        {/* ── Mode toggle ── */}
        <div className="ic-mode-toggle">
          {[['adjust', '± Adjust', 'Add or subtract from current'], ['count', '# Set Count', 'Enter absolute on-hand count']].map(([key, label, desc]) => (
            <button key={key} onClick={() => setMode(key)} className={`ic-mode-btn ${mode === key ? 'active' : ''}`}>
              <div className="ic-mode-label">{label}</div>
              <div className="ic-mode-desc">{desc}</div>
            </button>
          ))}
        </div>

        {/* ── Scan / Search input ── */}
        <div className="ic-scan-wrap">
          <Scan size={18} className="ic-scan-icon" />
          <input
            ref={scanInputRef}
            type="text"
            inputMode="text"
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleQueryKeyDown}
            placeholder="Scan barcode or type product name / UPC…"
            className="ic-scan-input"
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults([]); scanInputRef.current?.focus(); }} className="ic-scan-clear">
              <X size={16} />
            </button>
          )}
        </div>

        {/* ── Search results ── */}
        {isSearching && (
          <div className="ic-loading">
            <Loader size={22} className="p-spin" />
          </div>
        )}
        {!isSearching && results.length > 0 && (
          <div className="ic-results">
            {results.slice(0, 10).map((p) => (
              <div key={p.id} onClick={() => { selectProduct(p); setQuery(''); setResults([]); }}
                className="ic-result-item">
                <div className="ic-result-name">{p.name}</div>
                <div className="ic-result-meta">
                  {p.upc && <span>UPC: {p.upc}</span>}
                  {p.sku && <span>SKU: {p.sku}</span>}
                  {p.department?.name && <span>{p.department.name}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {!isSearching && query && results.length === 0 && (
          <div className="ic-no-results">
            <AlertCircle size={20} className="ic-empty-icon" />
            No products found for &quot;{query}&quot;
          </div>
        )}

        {/* ── Selected product ── */}
        {selected && !isSaving && (
          <>
            <div className="ic-selected-header">
              <span className="ic-selected-label">Selected Product</span>
              <button onClick={() => setSelected(null)} className="ic-close-btn">
                <X size={16} />
              </button>
            </div>
            <ProductCard
              product={selected.product}
              storeProduct={selected.storeProduct}
              onAdjust={handleAdjust}
              onSetCount={handleSetCount}
              mode={mode}
            />
          </>
        )}
        {selected && isSaving && (
          <div className="ic-saving">
            <Loader size={24} className="p-spin" />
            <p>Updating inventory…</p>
          </div>
        )}

        {/* ── History ── */}
        {history.length > 0 && (
          <div className="ic-history-section">
            <button onClick={() => setShowHistory(h => !h)} className="ic-history-toggle">
              <History size={13} /> Recent ({history.length})
              {showHistory ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {showHistory && <RecentHistory history={history} />}
          </div>
        )}

        {/* ── Empty state ── */}
        {!selected && !query && history.length === 0 && (
          <div className="ic-empty">
            <Scan size={48} className="ic-empty-icon" />
            <p className="ic-empty-title">Ready to scan</p>
            <p className="ic-empty-desc">
              Point a barcode scanner at a product or type a name to look it up and update inventory.
            </p>
          </div>
        )}
      </div>
  );
};

export default InventoryCount;
