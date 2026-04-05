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
import Sidebar from '../components/Sidebar';
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
  AlertCircle, Loader, History,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function normalizeUPC(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return String(raw).trim();
  if (digits.length > 14) return digits.slice(-14);
  return digits.padStart(14, '0');
}

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

  return (
    <div style={{
      background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
      borderRadius: 12, padding: '1.25rem', marginBottom: '1rem',
    }}>
      {/* Product info */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 3 }}>{product.name}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {product.upc    && <span>UPC: {product.upc}</span>}
            {product.sku    && <span>SKU: {product.sku}</span>}
            {product.brand  && <span>{product.brand}</span>}
            {product.department?.name && (
              <span style={{ color: 'var(--accent-primary)' }}>{product.department.name}</span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{
            fontSize: '1.75rem', fontWeight: 800, lineHeight: 1,
            color: isNeg ? '#ef4444' : isLow ? '#f59e0b' : '#10b981',
          }}>
            {qty != null ? qty.toFixed(qty % 1 === 0 ? 0 : 2) : '?'}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            {qty == null ? 'Not tracked' : 'On Hand'}
          </div>
          {isNeg && <div style={{ fontSize: '0.65rem', color: '#ef4444', fontWeight: 700 }}>⚠ Negative</div>}
          {isLow && !isNeg && <div style={{ fontSize: '0.65rem', color: '#f59e0b', fontWeight: 700 }}>⚠ Low stock</div>}
        </div>
      </div>

      {/* Prices */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.82rem', flexWrap: 'wrap' }}>
        {(storeProduct?.retailPrice ?? product.defaultRetailPrice) != null && (
          <span><span style={{ color: 'var(--text-muted)' }}>Retail: </span><strong>${fmt(storeProduct?.retailPrice ?? product.defaultRetailPrice)}</strong></span>
        )}
        {(storeProduct?.costPrice ?? product.defaultCostPrice) != null && (
          <span><span style={{ color: 'var(--text-muted)' }}>Cost: </span><strong>${fmt(storeProduct?.costPrice ?? product.defaultCostPrice)}</strong></span>
        )}
        {product.casePacks && (
          <span><span style={{ color: 'var(--text-muted)' }}>Case: </span><strong>{product.casePacks} units</strong></span>
        )}
      </div>

      {/* Count controls */}
      {mode === 'adjust' ? (
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            onClick={() => onAdjust(-1)}
            style={{ width: 44, height: 44, borderRadius: 8, border: '1px solid #ef4444', background: 'rgba(239,68,68,0.1)',
              color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Minus size={20} />
          </button>
          <div style={{ flex: 1, textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Tap − or + to adjust by 1 case, or use quick buttons:
          </div>
          <button
            onClick={() => onAdjust(1)}
            style={{ width: 44, height: 44, borderRadius: 8, border: '1px solid #10b981', background: 'rgba(16,185,129,0.1)',
              color: '#10b981', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Plus size={20} />
          </button>
        </div>
      ) : (
        <CountInput onSet={onSetCount} currentQty={qty} />
      )}

      {/* Quick adjust buttons */}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        {mode === 'adjust' && [1, 2, 3, 6, 12, 24].map(n => (
          <button key={n} onClick={() => onAdjust(n)}
            style={{ padding: '5px 14px', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
              background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8' }}>
            +{n}
          </button>
        ))}
        {mode === 'adjust' && [-1, -6, -12].map(n => (
          <button key={n} onClick={() => onAdjust(n)}
            style={{ padding: '5px 14px', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
            {n}
          </button>
        ))}
      </div>

      {/* Custom amount input */}
      {mode === 'adjust' && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', alignItems: 'center' }}>
          <input
            type="number"
            inputMode="decimal"
            step="1"
            value={customAdj}
            onChange={e => setCustomAdj(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyCustom()}
            onWheel={e => e.target.blur()}
            placeholder="Custom ± amount  (e.g. +47 or -3)"
            style={{
              flex: 1, padding: '9px 12px', borderRadius: 8,
              border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
              fontSize: '0.88rem', color: 'var(--text-primary)', outline: 'none',
              colorScheme: 'dark',
            }}
          />
          <button
            onClick={applyCustom}
            style={{
              padding: '9px 18px', borderRadius: 8, border: 'none',
              background: customAdj && !isNaN(parseFloat(customAdj)) ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
              color: customAdj && !isNaN(parseFloat(customAdj)) ? '#fff' : 'var(--text-muted)',
              fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem', flexShrink: 0,
              transition: 'all 0.15s',
            }}
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
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <div style={{ flex: 1 }}>
        <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
          Set Count (absolute)
        </label>
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
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 8,
            border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
            fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>
      <button
        onClick={handle}
        style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'var(--accent-primary)',
          color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem', flexShrink: 0, marginTop: 22 }}>
        <CheckCircle size={18} />
      </button>
    </div>
  );
}

// ─── RecentHistory ────────────────────────────────────────────────────────────
function RecentHistory({ history }) {
  if (!history.length) return null;
  return (
    <div style={{ marginTop: '1rem' }}>
      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: 5 }}>
        <History size={12} /> Recent adjustments
      </div>
      {history.slice(0, 5).map((h, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderRadius: 6, background: 'var(--bg-tertiary)', marginBottom: 4, fontSize: '0.8rem' }}>
          <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.productName}</span>
          <span style={{ color: h.adjustment > 0 ? '#10b981' : '#ef4444', fontWeight: 700, marginLeft: 8, flexShrink: 0 }}>
            {h.adjustment > 0 ? '+' : ''}{h.adjustment} {h.mode === 'count' ? '(set)' : ''}
          </span>
          <span style={{ color: 'var(--text-muted)', marginLeft: 8, flexShrink: 0, fontSize: '0.72rem' }}>
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
      // Pass the raw term directly — the backend's UPC variant matcher handles
      // 12/13/14-digit normalization. Pre-padding to 14 digits here was causing
      // "00082928223365" to miss products stored as "082928223365".
      const result = await searchCatalogProducts(term);
      const products = Array.isArray(result) ? result : (result?.data || []);
      setResults(products);

      // If exactly 1 result (e.g. barcode scan), auto-select it
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

  // On Enter key — immediate search (for barcode scanners which end with \n)
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
      toast.success(`✅ ${selected.product.name}: ${delta > 0 ? '+' : ''}${delta} → ${Number(newQty).toFixed(0)} on hand`);
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
      toast.success(`✅ ${selected.product.name}: count set to ${Number(finalQty).toFixed(0)}`);
    } catch (err) {
      toast.error('Count update failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content" style={{ maxWidth: 640, margin: '0 auto', padding: '1.5rem 1rem' }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.3rem' }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BarChart2 size={20} color="var(--accent-primary)" />
            </div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>Inventory Count</h1>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginLeft: 52 }}>
            Scan barcodes or search to quickly update stock levels
          </p>
        </div>

        {/* ── Mode toggle ── */}
        <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-secondary)', borderRadius: 10, padding: 4, marginBottom: '1.25rem', border: '1px solid var(--border-color)' }}>
          {[['adjust', '± Adjust', 'Add or subtract from current'], ['count', '# Set Count', 'Enter absolute on-hand count']].map(([key, label, desc]) => (
            <button key={key} onClick={() => setMode(key)} style={{
              flex: 1, padding: '10px', borderRadius: 7, border: 'none', cursor: 'pointer',
              textAlign: 'center',
              background: mode === key ? 'var(--accent-primary)' : 'transparent',
              color: mode === key ? '#fff' : 'var(--text-muted)',
              transition: 'all 0.15s',
            }}>
              <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{label}</div>
              <div style={{ fontSize: '0.65rem', opacity: 0.75, marginTop: 1 }}>{desc}</div>
            </button>
          ))}
        </div>

        {/* ── Scan / Search input ── */}
        <div style={{ position: 'relative', marginBottom: '1rem' }}>
          <Scan size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            ref={scanInputRef}
            type="text"
            inputMode="text"
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleQueryKeyDown}
            placeholder="Scan barcode or type product name / UPC…"
            style={{
              width: '100%', padding: '14px 14px 14px 42px', borderRadius: 10,
              border: '2px solid var(--accent-primary)',
              background: 'var(--bg-secondary)', fontSize: '1rem',
              color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
            }}
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults([]); scanInputRef.current?.focus(); }}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* ── Search results ── */}
        {isSearching && (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
            <Loader size={22} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        )}
        {!isSearching && results.length > 0 && (
          <div style={{ marginBottom: '1rem', border: '1px solid var(--border-color)', borderRadius: 10, overflow: 'hidden' }}>
            {results.slice(0, 10).map((p, i) => (
              <div key={p.id} onClick={() => { selectProduct(p); setQuery(''); setResults([]); }}
                style={{ padding: '0.875rem 1rem', cursor: 'pointer', borderBottom: i < results.length - 1 ? '1px solid var(--border-color)' : 'none',
                  background: 'var(--bg-secondary)', transition: 'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
              >
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{p.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '1rem', marginTop: 2 }}>
                  {p.upc && <span>UPC: {p.upc}</span>}
                  {p.sku && <span>SKU: {p.sku}</span>}
                  {p.department?.name && <span>{p.department.name}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {!isSearching && query && results.length === 0 && (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            <AlertCircle size={20} style={{ marginBottom: 6, display: 'block', margin: '0 auto 6px' }} />
            No products found for &quot;{query}&quot;
          </div>
        )}

        {/* ── Selected product ── */}
        {selected && !isSaving && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Selected Product
              </span>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
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
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            <Loader size={24} style={{ animation: 'spin 1s linear infinite' }} />
            <p style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>Updating inventory…</p>
          </div>
        )}

        {/* ── History ── */}
        {history.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <button onClick={() => setShowHistory(h => !h)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.5rem', padding: 0 }}>
              <History size={13} /> Recent ({history.length})
              {showHistory ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {showHistory && <RecentHistory history={history} />}
          </div>
        )}

        {/* ── Empty state ── */}
        {!selected && !query && history.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
            <Scan size={48} style={{ opacity: 0.15, marginBottom: '1rem', display: 'block', margin: '0 auto 1rem' }} />
            <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.5rem' }}>Ready to scan</p>
            <p style={{ fontSize: '0.85rem', maxWidth: 280, margin: '0 auto' }}>
              Point a barcode scanner at a product or type a name to look it up and update inventory.
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

export default InventoryCount;
