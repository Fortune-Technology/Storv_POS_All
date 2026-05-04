/**
 * ExpiryTracker — S73
 *
 * Per-store product expiry-date tracker. Admin can:
 *   1. Scan a product (or search by name/UPC) → enter the expiry date
 *   2. Review the list of products by expiry status (expired / today /
 *      soon / approaching / fresh) sorted by urgency
 *   3. Bulk-tag many products at once (e.g. all dairy received today)
 *   4. Clear expiry tracking for a product (no longer relevant)
 *
 * Drives the data feed for F28 AI promo suggestions ("This dairy expires
 * in 3 days, suggest 25% off").
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Calendar, Search, Plus, Trash2, RefreshCw, Loader, AlertTriangle,
  Clock, CheckCircle, X, Camera, Save, ScanLine, Zap,
} from 'lucide-react';
import { toast } from 'react-toastify';
import {
  listExpiry,
  getExpirySummary,
  setProductExpiry,
  clearProductExpiry,
  searchCatalogProducts,
  getCatalogDepartments,
} from '../services/api';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import BarcodeScannerModal from '../components/BarcodeScannerModal.jsx';
import './ExpiryTracker.css';

// ── Status bucket metadata ──────────────────────────────────────────────
const BUCKETS = [
  { key: 'expired',     label: 'Expired',         color: '#dc2626', textColor: '#fff' },
  { key: 'today',       label: 'Expires today',   color: '#ea580c', textColor: '#fff' },
  { key: 'soon',        label: 'Expires in 1–3d', color: '#f59e0b', textColor: '#fff' },
  { key: 'approaching', label: 'Expires in 4–7d', color: '#fbbf24', textColor: '#0f172a' },
  { key: 'fresh',       label: 'Fresh (>7d)',     color: '#10b981', textColor: '#fff' },
  { key: 'untracked',   label: 'No date set',     color: '#94a3b8', textColor: '#fff' },
];

function StatusChip({ status }) {
  const b = BUCKETS.find(x => x.key === status) || BUCKETS[BUCKETS.length - 1];
  return (
    <span className="et-chip" style={{ background: b.color, color: b.textColor }}>
      {b.label}
    </span>
  );
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Main page ──────────────────────────────────────────────────────────
export default function ExpiryTracker() {
  const confirm = useConfirm();

  const [items, setItems]             = useState([]);
  const [summary, setSummary]         = useState({});
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading]         = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | bucket key
  const [deptFilter,   setDeptFilter]   = useState('');
  const [search,       setSearch]       = useState('');
  const [windowDays,   setWindowDays]   = useState(14);
  const [includeUntracked, setIncludeUntracked] = useState(false);

  // Add/scan modal state
  const [addOpen, setAddOpen]            = useState(false);
  const [scanOpen, setScanOpen]          = useState(false);
  const [searchInput, setSearchInput]    = useState('');
  const [searchResults, setSearchResults]= useState([]);
  const [searching, setSearching]        = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [pendingDate, setPendingDate]    = useState('');
  const [pendingNotes, setPendingNotes]  = useState('');
  const [savingExpiry, setSavingExpiry]  = useState(false);

  // Per-row inline editing
  const [editingProductId, setEditingProductId] = useState(null);
  const [editDate, setEditDate]   = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        window: includeUntracked ? 0 : windowDays,
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(deptFilter ? { departmentId: deptFilter } : {}),
        ...(search.trim() ? { q: search.trim() } : {}),
        ...(includeUntracked ? { includeUntracked: 'true' } : {}),
      };
      const [listRes, summaryRes] = await Promise.all([
        listExpiry(params).catch((err) => {
          toast.error(`Failed to load: ${err.response?.data?.error || err.message}`);
          return { data: [] };
        }),
        getExpirySummary().catch(() => ({ data: {} })),
      ]);
      setItems(listRes?.data || []);
      setSummary(summaryRes?.data || {});
    } finally {
      setLoading(false);
    }
  }, [windowDays, statusFilter, deptFilter, search, includeUntracked]);

  useEffect(() => {
    getCatalogDepartments().then((r) => setDepartments(r?.data || r || [])).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Search products in the add modal ──────────────────────────────
  useEffect(() => {
    if (!searchInput || searchInput.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchCatalogProducts(searchInput.trim());
        const list = Array.isArray(r) ? r : (r?.data || []);
        setSearchResults(list);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // ── Scan callback — auto-find product + open add modal ────────────
  const handleScan = async (code) => {
    setScanOpen(false);
    if (!code) return;
    try {
      const r = await searchCatalogProducts(code);
      const list = Array.isArray(r) ? r : (r?.data || []);
      const exact = list.find((p) =>
        p.upc === code
        || (p.upcs && p.upcs.some((u) => u.upc === code))
      ) || list[0];
      if (!exact) {
        toast.error(`No product found for UPC ${code}`);
        return;
      }
      // Quick-add: open the add modal with this product pre-selected
      setSelectedProduct(exact);
      setPendingDate('');
      setPendingNotes('');
      setAddOpen(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Scan lookup failed');
    }
  };

  const handleSaveAdd = async () => {
    if (!selectedProduct || !pendingDate) {
      toast.error('Select a product and pick an expiry date');
      return;
    }
    setSavingExpiry(true);
    try {
      await setProductExpiry(selectedProduct.id, {
        expiryDate: pendingDate,
        expiryNotes: pendingNotes.trim() || null,
      });
      toast.success(`Expiry set: ${selectedProduct.name} → ${formatDate(pendingDate)}`);
      setAddOpen(false);
      setSelectedProduct(null);
      setSearchInput('');
      setSearchResults([]);
      setPendingDate('');
      setPendingNotes('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSavingExpiry(false);
    }
  };

  const startEdit = (item) => {
    setEditingProductId(item.productId);
    setEditDate(item.expiryDate ? new Date(item.expiryDate).toISOString().slice(0, 10) : '');
    setEditNotes(item.expiryNotes || '');
  };

  const cancelEdit = () => {
    setEditingProductId(null);
    setEditDate('');
    setEditNotes('');
  };

  const saveEdit = async (productId) => {
    if (!editDate) {
      toast.error('Pick a date');
      return;
    }
    setEditSaving(true);
    try {
      await setProductExpiry(productId, {
        expiryDate: editDate,
        expiryNotes: editNotes.trim() || null,
      });
      toast.success('Updated');
      cancelEdit();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setEditSaving(false);
    }
  };

  const handleClear = async (item) => {
    if (!await confirm({
      title: `Clear expiry for "${item.name}"?`,
      message: 'The product will no longer appear in expiry alerts. Inventory + sales tracking are unaffected.',
      confirmLabel: 'Clear expiry',
      danger: true,
    })) return;
    try {
      await clearProductExpiry(item.productId);
      toast.success('Cleared');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Clear failed');
    }
  };

  const totalValueAtRisk = useMemo(() =>
    BUCKETS.filter(b => b.key === 'expired' || b.key === 'today' || b.key === 'soon')
      .reduce((sum, b) => sum + (summary[b.key]?.valueAtRisk || 0), 0)
      .toFixed(2),
  [summary]);

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><Calendar size={22} /></div>
          <div>
            <h1 className="p-title">Expiry Tracker</h1>
            <p className="p-subtitle">Per-store product expiry dates · drives clearance decisions + AI promo suggestions</p>
          </div>
        </div>
        <div className="p-header-actions">
          <button onClick={load} className="pc-refresh-btn" disabled={loading}>
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setScanOpen(true)} className="pc-add-btn et-scan-btn">
            <Camera size={14} /> Scan
          </button>
          <button onClick={() => { setSelectedProduct(null); setSearchInput(''); setPendingDate(''); setPendingNotes(''); setAddOpen(true); }} className="pc-add-btn">
            <Plus size={14} /> Add Date
          </button>
        </div>
      </div>

      {/* ── Summary cards ──────────────────────────────────────── */}
      <div className="et-summary-grid">
        {BUCKETS.filter(b => b.key !== 'fresh' && b.key !== 'untracked').map((b) => {
          const stat = summary[b.key] || { count: 0, valueAtRisk: 0 };
          return (
            <button
              key={b.key}
              className={`et-summary-card ${statusFilter === b.key ? 'et-summary-card--active' : ''}`}
              onClick={() => setStatusFilter(statusFilter === b.key ? 'all' : b.key)}
              style={{ borderColor: b.color, '--bucket': b.color }}
            >
              <div className="et-summary-label">{b.label}</div>
              <div className="et-summary-count" style={{ color: b.color }}>{stat.count}</div>
              {stat.valueAtRisk > 0 && (
                <div className="et-summary-value">${stat.valueAtRisk.toFixed(2)} at risk</div>
              )}
            </button>
          );
        })}
        <div className="et-summary-card et-summary-card--total">
          <div className="et-summary-label">Total at risk (≤3d)</div>
          <div className="et-summary-count" style={{ color: '#dc2626' }}>${totalValueAtRisk}</div>
          <div className="et-summary-value">retail value</div>
        </div>
      </div>

      {/* ── Filter bar ──────────────────────────────────────── */}
      <div className="et-filter-bar">
        <div className="et-filter-search">
          <Search size={13} />
          <input
            placeholder="Search by product name, UPC, or brand…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="et-clear-btn" onClick={() => setSearch('')}>
              <X size={12} />
            </button>
          )}
        </div>
        <select className="et-filter-select" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          <option value="">All departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="et-filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {BUCKETS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
          <option value="tracked">All tracked (any date)</option>
        </select>
        <select className="et-filter-select" value={windowDays} onChange={(e) => setWindowDays(parseInt(e.target.value))}>
          <option value={7}>Within 7 days</option>
          <option value={14}>Within 14 days</option>
          <option value={30}>Within 30 days</option>
          <option value={60}>Within 60 days</option>
          <option value={0}>Any date</option>
        </select>
        <label className="et-checkbox">
          <input type="checkbox" checked={includeUntracked} onChange={e => setIncludeUntracked(e.target.checked)} />
          Show untracked
        </label>
      </div>

      {/* ── List ──────────────────────────────────────── */}
      {loading && (
        <div className="et-loading"><Loader size={18} className="p-spin" /> Loading…</div>
      )}

      {!loading && items.length === 0 && (
        <div className="et-empty">
          <Calendar size={42} className="et-empty-icon" />
          <div className="et-empty-title">No products in this view</div>
          <div className="et-empty-desc">
            Try widening the time window, or click <strong>Add Date</strong> /
            <strong> Scan</strong> to set an expiry on a product.
          </div>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="et-list">
          <div className="et-row et-row--head">
            <div>Product</div>
            <div>Department</div>
            <div className="et-num">On Hand</div>
            <div className="et-num">Retail $</div>
            <div className="et-num">Days</div>
            <div>Expiry Date</div>
            <div>Status</div>
            <div className="et-actions-col">Actions</div>
          </div>

          {items.map((item) => {
            const isEditing = editingProductId === item.productId;
            return (
              <div key={item.productId} className="et-row">
                <div className="et-product">
                  <strong>{item.name}</strong>
                  <span className="et-upc">{item.upc || '—'}</span>
                  {item.expiryNotes && !isEditing && (
                    <span className="et-notes">📝 {item.expiryNotes}</span>
                  )}
                </div>
                <div className="et-dept">
                  {item.department?.name || <span className="et-muted">—</span>}
                </div>
                <div className="et-num">
                  {item.onHand?.toFixed(2) || '0'}
                </div>
                <div className="et-num et-mono">
                  {item.retailValue != null ? `$${item.retailValue.toFixed(2)}` : '—'}
                </div>
                <div className="et-num">
                  {item.daysUntilExpiry == null ? '—' :
                    item.daysUntilExpiry < 0 ? <span style={{ color: '#dc2626' }}>{item.daysUntilExpiry}</span> :
                    item.daysUntilExpiry <= 3 ? <span style={{ color: '#ea580c', fontWeight: 700 }}>{item.daysUntilExpiry}</span> :
                    item.daysUntilExpiry}
                </div>
                <div>
                  {isEditing ? (
                    <input
                      type="date"
                      className="et-date-input"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      autoFocus
                    />
                  ) : (
                    <span className="et-mono">{formatDate(item.expiryDate)}</span>
                  )}
                </div>
                <div>
                  <StatusChip status={item.status} />
                </div>
                <div className="et-actions-col">
                  {isEditing ? (
                    <>
                      <button className="et-btn-icon et-btn-icon--save" onClick={() => saveEdit(item.productId)} disabled={editSaving}>
                        {editSaving ? <Loader size={13} className="p-spin" /> : <Save size={13} />}
                      </button>
                      <button className="et-btn-icon" onClick={cancelEdit}>
                        <X size={13} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="et-btn-icon" title="Edit date" onClick={() => startEdit(item)}>
                        <Calendar size={13} />
                      </button>
                      {item.expiryDate && (
                        <button className="et-btn-icon et-btn-icon--danger" title="Clear expiry" onClick={() => handleClear(item)}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add date modal ───────────────────────────────────── */}
      {addOpen && (
        <div className="et-modal-overlay" onClick={() => setAddOpen(false)}>
          <div className="et-modal" onClick={e => e.stopPropagation()}>
            <div className="et-modal-head">
              <div className="et-modal-title">
                <Calendar size={18} />
                {selectedProduct ? `Set Expiry — ${selectedProduct.name}` : 'Set Product Expiry Date'}
              </div>
              <button onClick={() => setAddOpen(false)} className="et-modal-close"><X size={18} /></button>
            </div>
            <div className="et-modal-body">
              {/* Product picker (skip if scan pre-filled it) */}
              {!selectedProduct && (
                <div className="et-form-row">
                  <label className="et-label">1. Find product</label>
                  <div className="et-search-input-row">
                    <input
                      autoFocus
                      placeholder="Search by name, UPC, or brand…"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      className="et-input"
                    />
                    <button className="et-btn-secondary" onClick={() => setScanOpen(true)}>
                      <ScanLine size={14} /> Scan
                    </button>
                  </div>
                  {searching && (
                    <div className="et-search-status"><Loader size={12} className="p-spin" /> Searching…</div>
                  )}
                  {searchResults.length > 0 && (
                    <div className="et-search-results">
                      {searchResults.slice(0, 8).map((p) => (
                        <button
                          key={p.id}
                          className="et-search-result"
                          onClick={() => { setSelectedProduct(p); setSearchResults([]); setSearchInput(''); }}
                        >
                          <strong>{p.name}</strong>
                          <span>{p.upc || ''}</span>
                          <span className="et-mono">${Number(p.defaultRetailPrice || 0).toFixed(2)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {selectedProduct && (
                <>
                  <div className="et-selected-product">
                    <div>
                      <strong>{selectedProduct.name}</strong>
                      <span className="et-upc">{selectedProduct.upc || ''}</span>
                    </div>
                    <button className="et-btn-secondary et-btn-sm" onClick={() => setSelectedProduct(null)}>
                      Change
                    </button>
                  </div>

                  <div className="et-form-row">
                    <label className="et-label">2. Expiry date *</label>
                    <input
                      autoFocus
                      type="date"
                      className="et-input"
                      value={pendingDate}
                      onChange={(e) => setPendingDate(e.target.value)}
                      min={new Date().toISOString().slice(0, 10)}
                    />
                  </div>

                  <div className="et-form-row">
                    <label className="et-label">3. Notes (optional)</label>
                    <input
                      className="et-input"
                      placeholder="e.g. lot 4823, top shelf, marked clearance"
                      value={pendingNotes}
                      onChange={(e) => setPendingNotes(e.target.value)}
                      maxLength={500}
                    />
                  </div>
                </>
              )}
            </div>
            <div className="et-modal-foot">
              <button onClick={() => setAddOpen(false)} className="et-btn-secondary">Cancel</button>
              <button
                onClick={handleSaveAdd}
                disabled={!selectedProduct || !pendingDate || savingExpiry}
                className="et-btn-primary"
              >
                {savingExpiry ? <Loader size={13} className="p-spin" /> : <Save size={13} />}
                Save Expiry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Scanner modal ────────────────────────────────────── */}
      <BarcodeScannerModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetected={handleScan}
      />
    </div>
  );
}
