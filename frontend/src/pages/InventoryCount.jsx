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
  createInventoryAdjustment,
  listInventoryAdjustments,
  getAdjustmentSummary,
} from '../services/api';
import { toast } from 'react-toastify';
import CameraScanButton from '../components/CameraScanButton';
import {
  Scan, Search, Package, Plus, Minus, CheckCircle,
  RefreshCw, X, ChevronDown, ChevronUp, BarChart2,
  AlertCircle, Loader, History, ClipboardList, DollarSign,
  Trash2, TrendingDown,
} from 'lucide-react';
import './InventoryCount.css';
import SortableHeader from '../components/SortableHeader';
import { useTableSort } from '../hooks/useTableSort';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n) {
  return n == null ? 'N/A' : Number(n).toFixed(2);
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
        <>
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
          <CameraScanButton
            onScan={(code) => {
              setQuery(code);
              search(code);
            }}
            title="Scan with camera"
          />
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
      </>
  );
};

/* ════════════════════════════════════════════════════════════
   ADJUSTMENTS TAB — Shrinkage & Inventory Corrections
════════════════════════════════════════════════════════════ */

const ADJUSTMENT_REASONS = [
  { value: 'shrinkage', label: 'Shrinkage (Unknown Loss)' },
  { value: 'theft', label: 'Theft' },
  { value: 'damage', label: 'Damage' },
  { value: 'spoilage', label: 'Spoilage' },
  { value: 'expired', label: 'Expired' },
  { value: 'count_correction', label: 'Count Correction' },
  { value: 'found', label: 'Found / Extra Stock' },
  { value: 'return', label: 'Customer Return to Shelf' },
];

const AdjustmentsTab = () => {
  const [adjustments, setAdjustments] = useState([]);
  // Session 39 Round 3 — column sort (default: newest first)
  const adjSort = useTableSort(adjustments, {
    initial: 'date',
    initialDir: 'desc',
    accessors: {
      date:   (a) => new Date(a.createdAt),
      name:   (a) => a.product?.name || '',
      upc:    (a) => a.product?.upc  || '',
      change: (a) => Number(a.adjustmentQty || 0),
      before: (a) => Number(a.previousQty   || 0),
      after:  (a) => Number(a.newQty        || 0),
      reason: (a) => a.reason || '',
    },
  });
  const [summary, setSummary]         = useState(null);
  const [loading, setLoading]         = useState(true);
  const [showCreate, setShowCreate]   = useState(false);
  const [searchQ, setSearchQ]         = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [form, setForm] = useState({ qty: '', reason: 'shrinkage', notes: '' });
  const [saving, setSaving] = useState(false);
  const searchTimer = useRef(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [adjRes, sumRes] = await Promise.all([
        listInventoryAdjustments({ limit: 100 }),
        getAdjustmentSummary(),
      ]);
      setAdjustments(adjRes.adjustments || []);
      setSummary(sumRes);
    } catch { toast.error('Failed to load adjustments'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSearch = (q) => {
    setSearchQ(q);
    clearTimeout(searchTimer.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await searchCatalogProducts({ q: q.trim() });
        setSearchResults((res.data || res.products || res).slice(0, 8));
      } catch { setSearchResults([]); }
    }, 300);
  };

  const handleCreate = async () => {
    if (!selectedProduct || !form.qty) { toast.error('Select a product and enter quantity'); return; }
    setSaving(true);
    try {
      await createInventoryAdjustment({
        masterProductId: selectedProduct.id,
        adjustmentQty: parseInt(form.qty),
        reason: form.reason,
        notes: form.notes || undefined,
      });
      toast.success('Adjustment recorded');
      setShowCreate(false);
      setSelectedProduct(null);
      setForm({ qty: '', reason: 'shrinkage', notes: '' });
      setSearchQ('');
      fetchData();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed to create adjustment'); }
    finally { setSaving(false); }
  };

  return (
    <>
      {/* Summary cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
          <div className="p-card" style={{ padding: '0.85rem', textAlign: 'center' }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Shrinkage</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#ef4444' }}>{summary.totalUnits} units</div>
          </div>
          <div className="p-card" style={{ padding: '0.85rem', textAlign: 'center' }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Est. Value Lost</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f59e0b' }}>${Number(summary.totalValue || 0).toFixed(2)}</div>
          </div>
          <div className="p-card" style={{ padding: '0.85rem', textAlign: 'center' }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Adjustments</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>{summary.totalAdjustments}</div>
          </div>
          {(summary.byReason || []).slice(0, 1).map(r => (
            <div key={r.reason} className="p-card" style={{ padding: '0.85rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Top Reason</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)', textTransform: 'capitalize' }}>{r.reason.replace(/_/g, ' ')}</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{r.units} units · ${Number(r.value).toFixed(2)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Action bar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: '0.75rem' }}>
        <button className="p-btn p-btn-ghost" onClick={fetchData} disabled={loading}>
          <RefreshCw size={15} /> Refresh
        </button>
        <button className="p-btn p-btn-primary p-btn-sm" onClick={() => setShowCreate(true)}>
          <Plus size={13} /> Record Adjustment
        </button>
      </div>

      {/* Create adjustment inline form */}
      {showCreate && (
        <div className="p-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Record Inventory Adjustment</span>
            <button className="p-btn p-btn-ghost p-btn-xs" onClick={() => setShowCreate(false)}><X size={13} /></button>
          </div>

          {/* Product search */}
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>PRODUCT</label>
            {selectedProduct ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.75rem', background: 'var(--bg-tertiary)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
                <Package size={14} />
                <span style={{ fontWeight: 600, flex: 1 }}>{selectedProduct.name}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{selectedProduct.upc}</span>
                <button onClick={() => { setSelectedProduct(null); setSearchQ(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex' }}><X size={14} /></button>
              </div>
            ) : (
              <>
                <input className="p-input" value={searchQ} onChange={e => handleSearch(e.target.value)} placeholder="Search by name, UPC, or SKU..." />
                {searchResults.length > 0 && (
                  <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: 'auto', background: 'var(--bg-secondary)' }}>
                    {searchResults.map(p => (
                      <button key={p.id} onClick={() => { setSelectedProduct(p); setSearchResults([]); setSearchQ(''); }}
                        style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border-color)', padding: '0.5rem 0.75rem', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{p.upc || ''} {p.department?.name ? `· ${p.department.name}` : ''}</div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>QTY CHANGE</label>
              <input className="p-input" type="number" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                placeholder="-5 for shrink, +3 for found" />
            </div>
            <div>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>REASON</label>
              <select className="p-input" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}>
                {ADJUSTMENT_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>NOTES (optional)</label>
            <input className="p-input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Found damaged in back room" />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="p-btn p-btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="p-btn p-btn-primary" onClick={handleCreate} disabled={saving || !selectedProduct || !form.qty}>
              {saving ? <Loader size={13} className="p-spin" /> : <CheckCircle size={13} />} Record Adjustment
            </button>
          </div>
        </div>
      )}

      {loading && <div className="p-loading" style={{ justifyContent: 'center' }}><Loader size={16} className="p-spin" /> Loading adjustments...</div>}

      {!loading && adjustments.length === 0 && (
        <div className="p-empty"><TrendingDown size={40} /> No inventory adjustments recorded yet.</div>
      )}

      {!loading && adjustments.length > 0 && (
        <div className="p-card">
          <div className="p-table-wrap">
            <table className="p-table">
              <thead>
                <tr>
                  <SortableHeader label="Date"    sortKey="date"    sort={adjSort} />
                  <SortableHeader label="Product" sortKey="name"    sort={adjSort} />
                  <SortableHeader label="UPC"     sortKey="upc"     sort={adjSort} />
                  <SortableHeader label="Change"  sortKey="change"  sort={adjSort} />
                  <SortableHeader label="Before"  sortKey="before"  sort={adjSort} />
                  <SortableHeader label="After"   sortKey="after"   sort={adjSort} />
                  <SortableHeader label="Reason"  sortKey="reason"  sort={adjSort} />
                  <SortableHeader label="Notes" sortable={false} />
                </tr>
              </thead>
              <tbody>
                {adjSort.sorted.map(adj => (
                  <tr key={adj.id}>
                    <td style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                      {new Date(adj.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="p-td-strong">{adj.product?.name || `#${adj.masterProductId}`}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{adj.product?.upc || '--'}</td>
                    <td style={{ fontWeight: 700, color: adj.adjustmentQty < 0 ? '#ef4444' : '#22c55e' }}>
                      {adj.adjustmentQty > 0 ? '+' : ''}{adj.adjustmentQty}
                    </td>
                    <td>{adj.previousQty}</td>
                    <td style={{ fontWeight: 600 }}>{adj.newQty}</td>
                    <td><span className="p-badge p-badge-gray" style={{ textTransform: 'capitalize' }}>{(adj.reason || '').replace(/_/g, ' ')}</span></td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{adj.notes || '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
};

/* ════════════════════════════════════════════════════════════
   MAIN WRAPPER — Tabs (Count + Adjustments)
════════════════════════════════════════════════════════════ */

const InventoryCountPage = () => {
  const [tab, setTab] = useState('count');

  return (
    <div className="p-page ic-main">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><ClipboardList size={22} /></div>
          <div>
            <h1 className="p-title">Inventory</h1>
            <p className="p-subtitle">Count stock, record adjustments & track shrinkage</p>
          </div>
        </div>
      </div>

      <div className="p-tabs">
        {[
          { key: 'count', label: 'Quick Count', icon: Scan },
          { key: 'adjustments', label: 'Adjustments & Shrinkage', icon: TrendingDown },
        ].map(({ key, label, icon: Icon }) => (
          <button key={key} className={`p-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === 'count' && <InventoryCount />}
      {tab === 'adjustments' && <AdjustmentsTab />}
    </div>
  );
};

export default InventoryCountPage;
