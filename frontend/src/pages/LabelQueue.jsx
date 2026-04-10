/**
 * LabelQueue — Manage pending shelf-label prints
 *
 * Shows items grouped by reason (price change, new product, sale, manual).
 * Supports bulk select, print, dismiss, inline price editing, and manual
 * product add via search.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getLabelQueue,
  getLabelQueueCount,
  addToLabelQueue,
  printLabelQueue,
  dismissLabelQueue,
} from '../services/api';
import api from '../services/api';
import { toast } from 'react-toastify';
import {
  Tag, Printer, X, Search, Plus, CheckSquare, Square,
  ChevronDown, ChevronUp, Package, Clock, AlertCircle, Check,
} from 'lucide-react';
import '../styles/portal.css';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function ageHours(dateStr) {
  if (!dateStr) return 0;
  return (Date.now() - new Date(dateStr).getTime()) / 3600000;
}

function fmt(n) {
  return n == null ? '—' : `$${Number(n).toFixed(2)}`;
}

const REASON_META = {
  price_change: { label: 'Price Changes', badge: 'p-badge-amber', color: '#d97706', bg: 'rgba(245,158,11,0.06)' },
  new_product:  { label: 'New Products',  badge: 'p-badge-blue',  color: '#2563eb', bg: 'rgba(59,130,246,0.06)' },
  sale_started: { label: 'Sales',         badge: 'p-badge-purple', color: '#7c3aed', bg: 'rgba(124,58,237,0.06)' },
  sale_ended:   { label: 'Sales',         badge: 'p-badge-purple', color: '#7c3aed', bg: 'rgba(124,58,237,0.06)' },
  manual:       { label: 'Manual',        badge: 'p-badge-gray',  color: 'var(--text-muted)', bg: 'var(--bg-tertiary)' },
};

const GROUP_ORDER = ['price_change', 'new_product', 'sale', 'manual'];

function groupItems(items) {
  const groups = { price_change: [], new_product: [], sale: [], manual: [] };
  (items || []).forEach(item => {
    const r = item.reason;
    if (r === 'price_change') groups.price_change.push(item);
    else if (r === 'new_product') groups.new_product.push(item);
    else if (r === 'sale_started' || r === 'sale_ended') groups.sale.push(item);
    else groups.manual.push(item);
  });
  return groups;
}

// ─── Inline Price Editor ─────────────────────────────────────────────────────

function PriceEditor({ item, onSaved }) {
  const product = item.product || item;
  const productId = product._id || product.id;

  // Determine the initial display price
  const initialPrice = item.reason === 'price_change'
    ? (item.newPrice ?? item.metadata?.newPrice ?? product.retailPrice)
    : (product.retailPrice ?? product.defaultRetailPrice);

  const [value, setValue] = useState(
    initialPrice != null ? Number(initialPrice).toFixed(2) : ''
  );
  const [saving, setSaving] = useState(false);
  const [originalValue] = useState(
    initialPrice != null ? Number(initialPrice).toFixed(2) : ''
  );

  const hasChanged = value !== originalValue && value.trim() !== '';

  const handleSave = async () => {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) {
      toast.error('Invalid price');
      return;
    }
    setSaving(true);
    try {
      await api.put('/catalog/products/' + productId, { defaultRetailPrice: num });
      toast.success('Price updated');
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update price');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && hasChanged) handleSave();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
      {item.reason === 'price_change' && (
        <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)', fontSize: '0.78rem', marginRight: 2 }}>
          {fmt(item.oldPrice ?? item.metadata?.oldPrice)}
        </span>
      )}
      {item.reason === 'sale_started' && (
        <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.78rem', marginRight: 2 }}>SALE</span>
      )}
      {item.reason === 'sale_ended' && (
        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginRight: 2 }}>Ended →</span>
      )}
      <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>$</span>
      <input
        className="p-input"
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        style={{
          width: 72,
          padding: '0.2rem 0.35rem',
          fontSize: '0.84rem',
          fontWeight: 600,
          textAlign: 'right',
        }}
      />
      {hasChanged && (
        <button
          className="p-btn p-btn-success p-btn-sm"
          onClick={handleSave}
          disabled={saving}
          title="Save price"
          style={{ padding: '0.15rem 0.35rem', minWidth: 0, lineHeight: 1 }}
        >
          <Check size={13} />
        </button>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function LabelQueue({ embedded }) {
  const [items, setItems] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [collapsed, setCollapsed] = useState({});

  // Search state
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef(null);
  const debounceRef = useRef(null);
  const scanBufferRef = useRef('');
  const scanTimerRef = useRef(null);
  const searchInputRef = useRef(null);

  // ── Fetch queue ──────────────────────────────────────────────────────────
  const fetchQueue = useCallback(async () => {
    try {
      const [data, countData] = await Promise.all([
        getLabelQueue({ status: 'pending' }),
        getLabelQueueCount(),
      ]);
      setItems(Array.isArray(data) ? data : data?.items || []);
      setPendingCount(typeof countData === 'number' ? countData : countData?.count || 0);
    } catch (err) {
      console.error('Failed to load label queue', err);
      toast.error('Failed to load label queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  // ── Search with debounce ─────────────────────────────────────────────────
  useEffect(() => {
    if (!searchTerm.trim()) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get('/catalog/products/search', { params: { q: searchTerm, limit: 10 } });
        const prods = res.data?.data || res.data?.products || [];
        setSearchResults(Array.isArray(prods) ? prods : []);
        setSearchOpen(true);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchTerm]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Add product manually ─────────────────────────────────────────────────
  const handleAddProduct = async (productId) => {
    try {
      await addToLabelQueue({ productIds: [productId] });
      toast.success('Added to label queue');
      setSearchTerm('');
      setSearchOpen(false);
      fetchQueue();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to add product');
    }
  };

  // ── Barcode scanner auto-detect ─────────────────────────────────────────
  // Scanners input chars very fast (<50ms between chars) and end with Enter.
  // We detect this pattern: if input arrives fast + ends with Enter + looks
  // like a UPC (6-14 digits), auto-search and add without manual selection.
  const handleScannerInput = useCallback(async (barcode) => {
    const clean = barcode.replace(/[\s\-\.]/g, '');
    if (clean.length < 6 || clean.length > 14 || !/^\d+$/.test(clean)) return;

    toast.info(`Scanning: ${clean}...`, { autoClose: 1500 });
    try {
      const res = await api.get('/catalog/products/search', { params: { q: clean, limit: 1 } });
      const products = res.data?.data || res.data?.products || [];
      if (products.length > 0) {
        const p = products[0];
        await addToLabelQueue({ productIds: [p._id || p.id] });
        const price = p.defaultRetailPrice || p.retailPrice;
        toast.success(`Added: ${p.name}${price ? ` — $${Number(price).toFixed(2)}` : ''}`, { autoClose: 2500 });
        fetchQueue();
      } else {
        toast.warn(`No product found for UPC: ${clean}`);
      }
    } catch {
      toast.error('Scan lookup failed');
    }
    setSearchTerm('');
  }, [fetchQueue]);

  // Global keydown listener for barcode scanner
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Only intercept when search input is focused or nothing is focused
      const active = document.activeElement;
      const isSearchFocused = active === searchInputRef.current;
      const isBodyOrNull = !active || active === document.body;
      if (!isSearchFocused && !isBodyOrNull) return;

      if (e.key === 'Enter') {
        const buf = scanBufferRef.current.trim();
        if (buf.length >= 6) {
          e.preventDefault();
          handleScannerInput(buf);
        }
        scanBufferRef.current = '';
        clearTimeout(scanTimerRef.current);
        return;
      }

      // Only accumulate printable single chars (scanner sends chars rapidly)
      if (e.key.length === 1) {
        scanBufferRef.current += e.key;
        clearTimeout(scanTimerRef.current);
        // Reset buffer after 100ms of no input (human typing is slower)
        scanTimerRef.current = setTimeout(() => { scanBufferRef.current = ''; }, 100);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleScannerInput]);

  // ── Selection helpers ────────────────────────────────────────────────────
  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map(i => i._id || i.id)));
  };

  const toggleGroup = (groupKey) => {
    setCollapsed(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  // ── Bulk actions ─────────────────────────────────────────────────────────
  const handlePrint = async () => {
    if (selected.size === 0) { toast.warn('Select items to print'); return; }
    try {
      await printLabelQueue({ ids: Array.from(selected) });
      toast.success(`Printed ${selected.size} label(s)`);
      setSelected(new Set());
      fetchQueue();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Print failed');
    }
  };

  const handleDismiss = async (ids) => {
    const toRemove = ids || Array.from(selected);
    if (toRemove.length === 0) { toast.warn('Select items to dismiss'); return; }
    try {
      await dismissLabelQueue({ ids: toRemove });
      toast.success(`Dismissed ${toRemove.length} item(s)`);
      setSelected(new Set());
      fetchQueue();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Dismiss failed');
    }
  };

  // ── Grouped data ─────────────────────────────────────────────────────────
  const groups = groupItems(items);

  // ── Stats ────────────────────────────────────────────────────────────────
  const stats = {
    total: items.length,
    priceChanges: groups.price_change.length,
    newProducts: groups.new_product.length,
    sales: groups.sale.length,
    manual: groups.manual.length,
  };

  // ── Age background tint ──────────────────────────────────────────────────
  const ageBg = (dateStr) => {
    const h = ageHours(dateStr);
    if (h > 48) return 'rgba(239,68,68,0.06)';
    if (h > 24) return 'rgba(245,158,11,0.06)';
    return 'transparent';
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const content = (
    <div className="p-page">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><Tag size={20} /></div>
          <div>
            <h1 className="p-header-title">Label Queue</h1>
            <p className="p-header-subtitle">Pending shelf labels to print</p>
          </div>
        </div>
        <div className="p-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className={`p-badge ${pendingCount > 0 ? 'p-badge-amber' : 'p-badge-gray'}`}
            style={{ fontWeight: 700, fontSize: '1.1rem', padding: '0.35rem 0.85rem', minWidth: 44 }}
          >
            {pendingCount}
          </span>
          <button className="p-btn p-btn-primary" onClick={handlePrint} disabled={selected.size === 0}>
            <Printer size={14} style={{ marginRight: 6 }} />
            Print Selected
          </button>
          <button className="p-btn p-btn-ghost" onClick={() => handleDismiss()} disabled={selected.size === 0}>
            <X size={14} style={{ marginRight: 6 }} />
            Dismiss Selected
          </button>
        </div>
      </div>

      {/* ── Stats Bar ───────────────────────────────────────────────── */}
      {!loading && items.length > 0 && (
        <div className="p-stat-grid" style={{ marginBottom: '1.25rem' }}>
          <div className="p-stat-card">
            <div className="p-stat-label">Total Pending</div>
            <div className="p-stat-value">{stats.total}</div>
          </div>
          <div className="p-stat-card">
            <div className="p-stat-label">Price Changes</div>
            <div className="p-stat-value" style={{ color: '#d97706' }}>{stats.priceChanges}</div>
          </div>
          <div className="p-stat-card">
            <div className="p-stat-label">New Products</div>
            <div className="p-stat-value" style={{ color: '#2563eb' }}>{stats.newProducts}</div>
          </div>
          <div className="p-stat-card">
            <div className="p-stat-label">Sales</div>
            <div className="p-stat-value" style={{ color: '#7c3aed' }}>{stats.sales}</div>
          </div>
        </div>
      )}

      {/* ── Manual Add Section ──────────────────────────────────────── */}
      <div className="p-card" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Plus size={14} />
            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Add Product</span>
          </div>
          <span className="p-badge p-badge-green" style={{ fontSize: '0.62rem' }}>Scanner Ready</span>
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
          Type to search or scan a barcode — scanned UPCs are added automatically
        </div>
        <div ref={searchRef} style={{ position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              ref={searchInputRef}
              className="p-input"
              style={{ paddingLeft: 32, width: '100%', maxWidth: 480 }}
              placeholder="Search by name, UPC, SKU... or scan barcode to auto-add"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onFocus={() => { if (searchResults.length) setSearchOpen(true); }}
              autoFocus
            />
          </div>
          {searchOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, maxWidth: 520,
              background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
              borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
              zIndex: 50, maxHeight: 340, overflowY: 'auto',
            }}>
              {searching && (
                <div style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Searching...</div>
              )}
              {!searching && searchResults.length === 0 && (
                <div style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No products found</div>
              )}
              {searchResults.map(p => {
                const price = p.defaultRetailPrice || p.retailPrice;
                const cost  = p.defaultCostPrice || p.costPrice;
                return (
                  <div
                    key={p._id || p.id}
                    onClick={() => handleAddProduct(p._id || p.id)}
                    style={{
                      padding: '0.55rem 1rem', cursor: 'pointer', display: 'flex', alignItems: 'center',
                      gap: '0.75rem', borderBottom: '1px solid var(--border-light)',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--brand-05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.84rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center', marginTop: 1 }}>
                        {p.brand && <span>{p.brand}</span>}
                        {p.brand && p.upc && <span>&middot;</span>}
                        {p.upc && <span style={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{p.upc}</span>}
                        {p.size && <span>&middot; {p.size}{p.sizeUnit || ''}</span>}
                        {p.department?.name && <span>&middot; {p.department.name}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                        {price ? `$${Number(price).toFixed(2)}` : '—'}
                      </div>
                      {cost && (
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                          Cost: ${Number(cost).toFixed(2)}
                        </div>
                      )}
                    </div>
                    <Plus size={15} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Queue Content ───────────────────────────────────────────── */}
      {loading ? (
        <div className="p-empty">
          <Clock size={32} />
          <p>Loading label queue...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="p-empty">
          <CheckSquare size={40} />
          <p style={{ fontSize: '1.05rem', fontWeight: 600 }}>All caught up!</p>
          <p>No labels pending.</p>
        </div>
      ) : (
        <>
          {GROUP_ORDER.map(groupKey => {
            const grpItems = groups[groupKey];
            if (!grpItems || grpItems.length === 0) return null;

            const meta = groupKey === 'sale'
              ? REASON_META.sale_started
              : REASON_META[groupKey];
            const isCollapsed = collapsed[groupKey];

            return (
              <div key={groupKey} className="p-card" style={{ marginBottom: '1rem', overflow: 'hidden' }}>
                {/* Group Header */}
                <div
                  onClick={() => toggleGroup(groupKey)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.65rem 1rem', background: meta.bg,
                    borderBottom: isCollapsed ? 'none' : '1px solid var(--border-color)',
                    cursor: 'pointer', userSelect: 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0,
                    }} />
                    <span style={{ fontWeight: 700, fontSize: '0.85rem', color: meta.color }}>
                      {meta.label}
                    </span>
                    <span className={`p-badge ${meta.badge}`}>
                      {grpItems.length}
                    </span>
                  </div>
                  {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </div>

                {/* Table */}
                {!isCollapsed && (
                  <div className="p-table-wrap">
                    <table className="p-table" style={{ marginBottom: 0 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 36 }}></th>
                          <th>Product</th>
                          <th>Brand</th>
                          <th>UPC</th>
                          <th>Price</th>
                          <th>Added</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {grpItems.map(item => {
                          const id = item._id || item.id;
                          const isSelected = selected.has(id);
                          const product = item.product || item;
                          const h = ageHours(item.createdAt);

                          return (
                            <tr key={id} style={{ background: ageBg(item.createdAt) }}>
                              {/* Checkbox */}
                              <td style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => toggleSelect(id)}>
                                {isSelected
                                  ? <CheckSquare size={16} style={{ color: 'var(--accent-primary)' }} />
                                  : <Square size={16} style={{ color: 'var(--text-muted)' }} />}
                              </td>

                              {/* Product Name */}
                              <td className="p-td-strong">{product.name || '—'}</td>

                              {/* Brand */}
                              <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                                {product.brand || '—'}
                              </td>

                              {/* UPC */}
                              <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                {product.upc || '—'}
                              </td>

                              {/* Price — inline editor */}
                              <td>
                                <PriceEditor item={item} onSaved={fetchQueue} />
                              </td>

                              {/* Time Added */}
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    {timeAgo(item.createdAt)}
                                  </span>
                                  {h > 48 && (
                                    <AlertCircle size={13} style={{ color: '#ef4444' }} />
                                  )}
                                  {h > 24 && h <= 48 && (
                                    <AlertCircle size={13} style={{ color: '#d97706' }} />
                                  )}
                                </div>
                              </td>

                              {/* Dismiss */}
                              <td style={{ textAlign: 'center' }}>
                                <button
                                  className="p-btn p-btn-danger p-btn-sm"
                                  onClick={() => handleDismiss([id])}
                                  title="Dismiss"
                                  style={{ padding: '0.2rem', minWidth: 0, background: 'none', border: 'none' }}
                                >
                                  <X size={15} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Bottom Actions ─────────────────────────────────────────── */}
          <div className="p-card" style={{
            padding: '0.75rem 1rem', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem',
          }}>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
              onClick={toggleSelectAll}
            >
              {selected.size === items.length && items.length > 0
                ? <CheckSquare size={16} style={{ color: 'var(--accent-primary)' }} />
                : <Square size={16} style={{ color: 'var(--text-muted)' }} />}
              Select All
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="p-btn p-btn-primary" onClick={handlePrint} disabled={selected.size === 0}>
                <Printer size={14} style={{ marginRight: 6 }} />
                Print Selected{selected.size > 0 ? ` (${selected.size})` : ''}
              </button>
              <button className="p-btn p-btn-ghost" onClick={() => handleDismiss()} disabled={selected.size === 0}>
                <X size={14} style={{ marginRight: 6 }} />
                Dismiss Selected
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  return content;
}
