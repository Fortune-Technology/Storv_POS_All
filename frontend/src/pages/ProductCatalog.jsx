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
} from '../services/api';
import { toast } from 'react-toastify';
import {
  Search, Plus, Edit2, Trash2, ChevronLeft, ChevronRight,
  Package, Loader, RefreshCw, Copy,
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

  const debounceRef = useRef(null);

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
                  {['Product','Pack','Cost','Retail','Margin','Department','Tax','Flags',''].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map(p => {
                  const dept    = departments.find(d => d.id === p.departmentId);
                  const promos  = activePromos(p.id);
                  return (
                    <tr key={p.id}>

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
