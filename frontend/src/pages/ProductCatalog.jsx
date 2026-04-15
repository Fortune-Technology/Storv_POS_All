/**
 * ProductCatalog — Organization-level product list.
 * Add / edit navigates to the full-page ProductForm.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  getCatalogProducts, searchCatalogProducts,
  deleteCatalogProduct,
  getCatalogDepartments,
  getCatalogPromotions,
  bulkDeleteCatalogProducts,
  bulkSetDepartment,
  bulkToggleActive,
  bulkUpdateCatalogProducts,
  deleteAllCatalogProducts,
} from '../services/api';
import { toast } from 'react-toastify';
import {
  Search, Plus, Edit2, Trash2, ChevronLeft, ChevronRight,
  Package, Loader, RefreshCw, Copy, CheckSquare, Square,
  XCircle, Tag, ToggleLeft, DollarSign, Layers, AlertTriangle,
} from 'lucide-react';
import { useSetupStatus } from '../hooks/useSetupStatus';
import { SetupGuide } from '../components/SetupGuide';
import './ProductCatalog.css';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmt$ = (v) => (v == null || v === '' ? '—' : '$' + Number(v).toFixed(2));

const calcMargin = (cost, retail) => {
  const c = parseFloat(cost), r = parseFloat(retail);
  if (!c || !r || r <= 0) return null;
  return ((r - c) / r) * 100;
};

const TAX_CLASSES = [
  { value: 'grocery',     label: 'Grocery',     color: '#10b981' },
  { value: 'alcohol',     label: 'Alcohol',     color: '#6366f1' },
  { value: 'tobacco',     label: 'Tobacco',     color: '#64748b' },
  { value: 'hot_food',    label: 'Hot Food',    color: '#f97316' },
  { value: 'standard',    label: 'Standard',    color: '#3b82f6' },
  { value: 'non_taxable', label: 'Non-Tax',     color: '#94a3b8' },
  { value: 'none',        label: 'No Tax',      color: '#94a3b8' },
];

const packSummary = (p) => {
  const su = p.sellUnit || 'each';
  const cp = p.casePacks  || p.innerPack    || 1;
  const us = p.sellUnitSize || p.unitsPerPack || 1;
  if (su === 'case') return `${us}pk case`;
  if (su === 'pack' && cp > 1) return `${cp}×${us}pk`;
  if (cp > 1) return `${cp} singles`;
  return 'Single';
};

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function ProductCatalog() {
  const navigate = useNavigate();
  const setup    = useSetupStatus();
  const [guideDismissed, setGuideDismissed] = useState(false);

  const [products,    setProducts]    = useState([]);
  const [departments, setDepartments] = useState([]);
  const [promotions,  setPromotions]  = useState([]);
  const [pagination,  setPagination]  = useState({ page:1, pages:1, total:0 });
  const [loading,     setLoading]     = useState(false);
  const [q,           setQ]           = useState('');
  const [filters,     setFilters]     = useState({ departmentId:'', taxClass:'', active:'true' });
  const [page,        setPage]        = useState(1);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkAction,  setBulkAction]  = useState(null); // 'delete' | 'department' | 'active' | 'price' | null
  const [bulkDeptId,  setBulkDeptId]  = useState('');
  const [bulkPrice,   setBulkPrice]   = useState('');
  const [bulkActive,  setBulkActive]  = useState(true);
  const [bulkSaving,  setBulkSaving]  = useState(false);

  // Delete All state
  const [showDeleteAll,    setShowDeleteAll]    = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState('');
  const [deleteAllPermanent, setDeleteAllPermanent] = useState(false);
  const [deleteAllSaving,  setDeleteAllSaving]  = useState(false);

  const debounceRef = useRef(null);

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleSelectAll = () => {
    if (selectedIds.size === products.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(products.map(p => p.id)));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkDelete = async () => {
    setBulkSaving(true);
    try {
      await bulkDeleteCatalogProducts([...selectedIds]);
      toast.success(`${selectedIds.size} product(s) deleted`);
      clearSelection(); setBulkAction(null);
      loadProducts(q, page, filters);
    } catch (e) { toast.error(e.response?.data?.error || 'Bulk delete failed'); }
    finally { setBulkSaving(false); }
  };

  const handleBulkDepartment = async () => {
    if (!bulkDeptId) { toast.error('Select a department'); return; }
    setBulkSaving(true);
    try {
      await bulkSetDepartment([...selectedIds], parseInt(bulkDeptId));
      toast.success(`${selectedIds.size} product(s) updated`);
      clearSelection(); setBulkAction(null);
      loadProducts(q, page, filters);
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setBulkSaving(false); }
  };

  const handleBulkActive = async (active) => {
    setBulkSaving(true);
    try {
      await bulkToggleActive([...selectedIds], active);
      toast.success(`${selectedIds.size} product(s) set to ${active ? 'active' : 'inactive'}`);
      clearSelection(); setBulkAction(null);
      loadProducts(q, page, filters);
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setBulkSaving(false); }
  };

  const handleDeleteAll = async () => {
    if (deleteAllConfirm !== 'DELETE ALL') {
      toast.error('Type DELETE ALL exactly to confirm');
      return;
    }
    setDeleteAllSaving(true);
    try {
      const res = await deleteAllCatalogProducts('DELETE ALL', deleteAllPermanent);
      toast.success(`${res.deleted} product(s) ${deleteAllPermanent ? 'permanently deleted' : 'soft-deleted'}`);
      setShowDeleteAll(false);
      setDeleteAllConfirm('');
      setDeleteAllPermanent(false);
      clearSelection();
      loadProducts(q, page, filters);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Delete all failed');
    } finally {
      setDeleteAllSaving(false);
    }
  };

  const handleBulkPrice = async () => {
    const price = parseFloat(bulkPrice);
    if (isNaN(price)) { toast.error('Enter a valid price'); return; }
    setBulkSaving(true);
    try {
      await bulkUpdateCatalogProducts([...selectedIds].map(id => ({ id, defaultRetailPrice: price })));
      toast.success(`${selectedIds.size} product(s) price updated to $${price.toFixed(2)}`);
      clearSelection(); setBulkAction(null); setBulkPrice('');
      loadProducts(q, page, filters);
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setBulkSaving(false); }
  };

  const loadSupport = useCallback(async () => {
    try {
      const [d, p] = await Promise.all([getCatalogDepartments(), getCatalogPromotions({ active:'true' })]);
      setDepartments((d?.data || d) ?? []);
      setPromotions((p?.data || p) ?? []);
    } catch { /* non-fatal */ }
  }, []);

  const loadProducts = useCallback(async (search, pg, filt) => {
    setLoading(true);
    try {
      const params = { page:pg, limit:50, ...filt };
      const res = search?.trim()
        ? await searchCatalogProducts(search, params)
        : await getCatalogProducts(params);
      const raw = res?.data || res;
      setProducts(raw?.products || raw?.data || raw || []);
      setPagination({ page:raw?.page||pg, pages:raw?.pages||1, total:raw?.total||0 });
    } catch { toast.error('Failed to load products'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadSupport(); }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadProducts(q, page, filters), 350);
    return () => clearTimeout(debounceRef.current);
  }, [q, page, filters]);

  const handleDelete = async (product) => {
    if (!window.confirm(`Delete "${product.name}"?`)) return;
    try {
      await deleteCatalogProduct(product.id);
      setProducts(ps => ps.filter(p => p.id !== product.id));
      toast.success('Product deleted');
    } catch (e) { toast.error(e.response?.data?.error || 'Delete failed'); }
  };

  const activePromos = (productId) => {
    const now = new Date();
    return promotions.filter(p =>
      p.active && p.productIds?.includes(productId) &&
      (!p.endDate || new Date(p.endDate) > now)
    );
  };

  return (
      <div className="p-page">

        {/* ── Top bar ── */}
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <Package size={22} />
            </div>
            <div>
              <h1 className="p-title">Product Catalog</h1>
              <p className="p-subtitle">
                {pagination.total > 0 ? `${pagination.total} products` : 'Organization-level master catalog'}
              </p>
            </div>
          </div>
          <div className="p-header-actions">
            <button onClick={() => { loadProducts(q, page, filters); loadSupport(); }} className="pc-refresh-btn">
              <RefreshCw size={14} />
            </button>
            {pagination.total > 0 && (
              <button
                onClick={() => setShowDeleteAll(true)}
                className="p-btn p-btn-ghost"
                style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                title="Delete all products in this organization"
              >
                <Trash2 size={14} /> Delete All
              </button>
            )}
            <button onClick={() => navigate('/portal/catalog/new')} className="pc-add-btn">
              <Plus size={14} /> Add Product
            </button>
          </div>
        </div>

        {/* ── Setup guide (shown during onboarding phase) ── */}
        {!setup.loading && !guideDismissed && setup.stage <= 2 && (
          <div className="pc-setup">
            <SetupGuide
              stage={setup.stage}
              storeCount={setup.storeCount}
              productCount={setup.productCount}
              onDismiss={() => setGuideDismissed(true)}
            />
          </div>
        )}

        {/* ── Filters ── */}
        <div className="pc-filters">
          <div className="pc-search-wrap">
            <Search size={14} className="pc-search-icon" />
            <input
              className="pc-search-input"
              placeholder="Search name, UPC, brand…"
              value={q} onChange={e => { setQ(e.target.value); setPage(1); }} />
          </div>
          <select className="pc-filter-select" value={filters.departmentId}
            onChange={e => { setFilters(f=>({...f,departmentId:e.target.value})); setPage(1); }}>
            <option value="">All Departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="pc-filter-select" value={filters.taxClass}
            onChange={e => { setFilters(f=>({...f,taxClass:e.target.value})); setPage(1); }}>
            <option value="">All Tax Classes</option>
            {TAX_CLASSES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="pc-filter-select" value={filters.active}
            onChange={e => { setFilters(f=>({...f,active:e.target.value})); setPage(1); }}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
            <option value="">All</option>
          </select>
        </div>

        {/* ── Bulk Action Bar ── */}
        {selectedIds.size > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 1rem',
            background: 'rgba(61,86,181,0.08)', border: '1px solid rgba(61,86,181,0.2)',
            borderRadius: 8, marginBottom: '0.75rem',
          }}>
            <CheckSquare size={15} color="var(--accent-primary)" />
            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--accent-primary)' }}>
              {selectedIds.size} selected
            </span>
            <div style={{ flex: 1 }} />
            <button className="p-btn p-btn-danger p-btn-xs" onClick={() => setBulkAction('delete')}>
              <Trash2 size={11} /> Delete
            </button>
            <button className="p-btn p-btn-secondary p-btn-xs" onClick={() => setBulkAction('department')}>
              <Layers size={11} /> Set Dept
            </button>
            <button className="p-btn p-btn-secondary p-btn-xs" onClick={() => setBulkAction('price')}>
              <DollarSign size={11} /> Set Price
            </button>
            <button className="p-btn p-btn-secondary p-btn-xs" onClick={() => handleBulkActive(true)}>
              <ToggleLeft size={11} /> Activate
            </button>
            <button className="p-btn p-btn-ghost p-btn-xs" onClick={() => handleBulkActive(false)}>
              Deactivate
            </button>
            <button className="p-btn p-btn-ghost p-btn-xs" onClick={clearSelection} style={{ marginLeft: 8 }}>
              <XCircle size={11} /> Clear
            </button>
          </div>
        )}

        {/* ── Bulk Action Modals ── */}
        {bulkAction === 'delete' && (
          <div style={{
            padding: '1rem', marginBottom: '0.75rem', borderRadius: 8,
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
          }}>
            <div style={{ fontWeight: 700, color: '#ef4444', marginBottom: 8 }}>
              Delete {selectedIds.size} product(s)?
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 12 }}>
              This will soft-delete (mark as inactive + deleted). Products can be recovered by re-importing.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="p-btn p-btn-ghost p-btn-sm" onClick={() => setBulkAction(null)}>Cancel</button>
              <button className="p-btn p-btn-danger p-btn-sm" onClick={handleBulkDelete} disabled={bulkSaving}>
                {bulkSaving ? <Loader size={12} className="p-spin" /> : <Trash2 size={12} />} Delete {selectedIds.size} Products
              </button>
            </div>
          </div>
        )}

        {bulkAction === 'department' && (
          <div style={{
            padding: '1rem', marginBottom: '0.75rem', borderRadius: 8,
            background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              Set department for {selectedIds.size} product(s)
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select className="p-input" style={{ width: 250 }} value={bulkDeptId} onChange={e => setBulkDeptId(e.target.value)}>
                <option value="">— Select department —</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button className="p-btn p-btn-ghost p-btn-sm" onClick={() => setBulkAction(null)}>Cancel</button>
              <button className="p-btn p-btn-primary p-btn-sm" onClick={handleBulkDepartment} disabled={bulkSaving || !bulkDeptId}>
                {bulkSaving ? <Loader size={12} className="p-spin" /> : <Layers size={12} />} Apply
              </button>
            </div>
          </div>
        )}

        {bulkAction === 'price' && (
          <div style={{
            padding: '1rem', marginBottom: '0.75rem', borderRadius: 8,
            background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              Set retail price for {selectedIds.size} product(s)
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: 700 }}>$</span>
                <input className="p-input" type="number" step="0.01" min="0" value={bulkPrice} onChange={e => setBulkPrice(e.target.value)}
                  placeholder="0.00" style={{ width: 140, paddingLeft: 24 }} />
              </div>
              <button className="p-btn p-btn-ghost p-btn-sm" onClick={() => setBulkAction(null)}>Cancel</button>
              <button className="p-btn p-btn-primary p-btn-sm" onClick={handleBulkPrice} disabled={bulkSaving || !bulkPrice}>
                {bulkSaving ? <Loader size={12} className="p-spin" /> : <DollarSign size={12} />} Apply
              </button>
            </div>
          </div>
        )}

        {/* ── Table ── */}
        <div className="pc-table-wrap">
          {loading ? (
            <div className="pc-loading">
              <Loader size={18} className="p-spin" /> Loading…
            </div>
          ) : products.length === 0 ? (
            <div className="pc-empty">
              <Package size={40} className="pc-empty-icon" />
              <div className="pc-empty-title">No products found</div>
              <div className="pc-empty-desc">
                Add your first product or adjust your filters.
              </div>
              <button onClick={() => navigate('/portal/catalog/new')} className="pc-empty-add-btn">
                <Plus size={14} /> Add First Product
              </button>
            </div>
          ) : (
            <table className="pc-table">
              <thead>
                <tr>
                  <th style={{ width: 32, padding: '0.35rem 0.5rem' }}>
                    <button onClick={toggleSelectAll} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: selectedIds.size === products.length && products.length > 0 ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
                      {selectedIds.size === products.length && products.length > 0 ? <CheckSquare size={15} /> : <Square size={15} />}
                    </button>
                  </th>
                  {['Product','Pack','Cost','Retail','Margin','Department','Tax','Flags',''].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map(p => {
                  const dept    = departments.find(d => d.id === p.departmentId);
                  const promos  = activePromos(p.id);
                  const isSelected = selectedIds.has(p.id);
                  return (
                    <tr key={p.id} style={isSelected ? { background: 'rgba(61,86,181,0.06)' } : undefined}>

                      {/* Checkbox */}
                      <td style={{ width: 32, padding: '0.35rem 0.5rem' }}>
                        <button onClick={() => toggleSelect(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: isSelected ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
                          {isSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                        </button>
                      </td>

                      {/* Name + brand + UPC */}
                      <td className="pc-td-name"
                        onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        <div className="pc-product-name">{p.name}</div>
                        {p.brand && <div className="pc-product-brand">{p.brand}</div>}
                        {p.upc   && <div className="pc-product-upc">{p.upc}</div>}
                        {promos.length > 0 && (
                          <span className="pc-promo-badge" style={{ background:(promos[0].badgeColor||'#ef4444')+'25',
                            color:promos[0].badgeColor||'#ef4444' }}>
                            {promos[0].badgeLabel || promos[0].promoType.toUpperCase()}
                          </span>
                        )}
                      </td>

                      {/* Pack */}
                      <td className="pc-td-nowrap"
                        onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        <span className={`pc-pack-text ${(p.pack||0)>1 ? 'pc-pack-active' : 'pc-pack-muted'}`}>
                          {packSummary(p)}
                        </span>
                      </td>

                      {/* Cost */}
                      <td className="pc-td-mono"
                        onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        {fmt$(p.defaultCostPrice)}
                      </td>

                      {/* Retail */}
                      <td className="pc-td-bold"
                        onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        {fmt$(p.defaultRetailPrice)}
                      </td>

                      {/* Margin */}
                      <td className="pc-td-nowrap"
                        onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        <MarginBadge cost={p.defaultCostPrice} retail={p.defaultRetailPrice} />
                      </td>

                      {/* Dept */}
                      <td onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        {dept ? (
                          <span className="pc-dept-badge" style={{ background:(dept.color||'#6366f1')+'20', color:dept.color||'#6366f1' }}>
                            {dept.name}
                          </span>
                        ) : <span className="pc-pack-muted">—</span>}
                      </td>

                      {/* Tax */}
                      <td onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        <TaxBadge tc={p.taxClass} />
                      </td>

                      {/* Flags */}
                      <td onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        <div className="pc-flag-wrap">
                          {p.ebtEligible   && <Flag color="#10b981">EBT</Flag>}
                          {p.ageRequired   && <Flag color="#ef4444">{p.ageRequired}+</Flag>}
                          {p.depositRuleId && <Flag color="#06b6d4">DEP</Flag>}
                          {p.byWeight      && <Flag color="#8b5cf6">LB</Flag>}
                        </div>
                      </td>

                      {/* Actions */}
                      <td>
                        <div className="pc-action-btns">
                          <button title="Edit"
                            onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}
                            className="pc-action-btn">
                            <Edit2 size={13} />
                          </button>
                          <button title="Delete"
                            onClick={() => handleDelete(p)}
                            className="pc-action-btn delete">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination ── */}
        {pagination.pages > 1 && (
          <div className="pc-pagination">
            <button disabled={page<=1} onClick={() => setPage(p=>p-1)} className="pc-pagination-btn">
              <ChevronLeft size={14} />
            </button>
            <span className="pc-pagination-text">
              Page {page} of {pagination.pages} · {pagination.total} products
            </span>
            <button disabled={page>=pagination.pages} onClick={() => setPage(p=>p+1)} className="pc-pagination-btn">
              <ChevronRight size={14} />
            </button>
          </div>
        )}

      {/* ── Delete All Modal ── */}
      {showDeleteAll && (
        <div
          onClick={() => !deleteAllSaving && setShowDeleteAll(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-secondary)',
              border: '2px solid rgba(239,68,68,0.4)',
              borderRadius: 12,
              padding: '1.5rem',
              maxWidth: 520,
              width: '100%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'rgba(239,68,68,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <AlertTriangle size={24} color="#ef4444" />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#ef4444' }}>
                  Delete ALL Products
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {pagination.total} product{pagination.total !== 1 ? 's' : ''} will be affected
                </div>
              </div>
            </div>

            <div style={{
              padding: '0.75rem 1rem',
              background: 'rgba(239,68,68,0.06)',
              borderRadius: 8,
              fontSize: '0.82rem',
              color: 'var(--text-primary)',
              lineHeight: 1.5,
              marginBottom: '1rem',
            }}>
              This will delete <strong>every product</strong> in your organization across all stores.
              {deleteAllPermanent ? (
                <> This action <strong style={{ color: '#ef4444' }}>CANNOT be undone</strong>. All product records, inventory levels, and UPCs will be permanently erased.</>
              ) : (
                <> Products will be marked as inactive and hidden, but can be recovered by re-importing.</>
              )}
            </div>

            {/* Permanent delete toggle */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '0.5rem 0.75rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 6,
              cursor: 'pointer',
              marginBottom: '1rem',
              fontSize: '0.82rem',
            }}>
              <input
                type="checkbox"
                checked={deleteAllPermanent}
                onChange={(e) => setDeleteAllPermanent(e.target.checked)}
                disabled={deleteAllSaving}
              />
              <span>
                <strong>Permanently delete</strong> (cannot be undone — blocked if any products are referenced by POs)
              </span>
            </label>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>
                Type <span style={{ color: '#ef4444', fontFamily: 'monospace' }}>DELETE ALL</span> to confirm
              </label>
              <input
                type="text"
                value={deleteAllConfirm}
                onChange={(e) => setDeleteAllConfirm(e.target.value)}
                placeholder="DELETE ALL"
                disabled={deleteAllSaving}
                autoFocus
                style={{
                  width: '100%', padding: '0.6rem 0.85rem',
                  background: 'var(--bg-tertiary)',
                  border: `1px solid ${deleteAllConfirm === 'DELETE ALL' ? '#ef4444' : 'var(--border-color)'}`,
                  borderRadius: 6,
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  fontFamily: 'monospace',
                  letterSpacing: '0.05em',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="p-btn p-btn-ghost"
                onClick={() => { setShowDeleteAll(false); setDeleteAllConfirm(''); setDeleteAllPermanent(false); }}
                disabled={deleteAllSaving}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAll}
                disabled={deleteAllSaving || deleteAllConfirm !== 'DELETE ALL'}
                style={{
                  padding: '0.6rem 1.25rem',
                  borderRadius: 6,
                  border: 'none',
                  background: deleteAllConfirm === 'DELETE ALL' && !deleteAllSaving ? '#ef4444' : 'rgba(239,68,68,0.3)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: deleteAllConfirm === 'DELETE ALL' && !deleteAllSaving ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {deleteAllSaving ? <Loader size={13} className="p-spin" /> : <Trash2 size={13} />}
                {deleteAllSaving ? 'Deleting...' : `Delete All ${pagination.total} Products`}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Micro-styles
// ─────────────────────────────────────────────────────────────────────────────

const Flag = ({ color, children }) => (
  <span className="pc-flag" style={{ background:color+'18', color }}>
    {children}
  </span>
);

const MarginBadge = ({ cost, retail }) => {
  const m = calcMargin(cost, retail);
  if (m === null) return <span className="pc-pack-muted">—</span>;
  const color = m >= 30 ? '#10b981' : m >= 20 ? '#f59e0b' : '#ef4444';
  return (
    <span className="pc-margin-badge" style={{ background:color+'18', color }}>
      {m.toFixed(1)}%
    </span>
  );
};

const TaxBadge = ({ tc }) => {
  const t = TAX_CLASSES.find(x => x.value === tc) || TAX_CLASSES[4];
  return (
    <span className="pc-tax-badge" style={{ background:t.color+'18', color:t.color }}>
      {t.label}
    </span>
  );
};
