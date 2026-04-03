/**
 * ProductCatalog — Organization-level product list.
 * Add / edit navigates to the full-page ProductForm.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
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

const MarginBadge = ({ cost, retail }) => {
  const m = calcMargin(cost, retail);
  if (m === null) return <span style={{ color:'var(--text-muted)' }}>—</span>;
  const color = m >= 30 ? '#10b981' : m >= 20 ? '#f59e0b' : '#ef4444';
  return (
    <span style={{ fontSize:'0.72rem', fontWeight:700, padding:'2px 7px',
      borderRadius:4, background:color+'18', color }}>
      {m.toFixed(1)}%
    </span>
  );
};

const TaxBadge = ({ tc }) => {
  const t = TAX_CLASSES.find(x => x.value === tc) || TAX_CLASSES[4];
  return (
    <span style={{ fontSize:'0.68rem', fontWeight:600, padding:'2px 6px',
      borderRadius:4, background:t.color+'18', color:t.color }}>
      {t.label}
    </span>
  );
};

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
    <div className="layout-container">
      <Sidebar />
      <main className="main-content" style={{ padding:0 }}>

        {/* ── Top bar ── */}
        <div style={{ padding:'1.25rem 1.75rem 0', display:'flex', alignItems:'center',
          justifyContent:'space-between', gap:'1rem', flexWrap:'wrap' }}>
          <div>
            <h1 style={{ fontSize:'1.2rem', fontWeight:700, margin:0 }}>Product Catalog</h1>
            <p style={{ fontSize:'0.78rem', color:'var(--text-muted)', margin:'2px 0 0' }}>
              {pagination.total > 0 ? `${pagination.total} products` : 'Organization-level master catalog'}
            </p>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => { loadProducts(q, page, filters); loadSupport(); }}
              style={{ background:'none', border:'1px solid var(--border-color)', borderRadius:6,
                padding:'0.45rem', cursor:'pointer', color:'var(--text-muted)', display:'flex', alignItems:'center' }}>
              <RefreshCw size={14} />
            </button>
            <button onClick={() => navigate('/portal/catalog/new')}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'0.5rem 1rem',
                borderRadius:6, border:'none', background:'var(--accent-primary)', color:'#fff',
                cursor:'pointer', fontSize:'0.85rem', fontWeight:600 }}>
              <Plus size={14} /> Add Product
            </button>
          </div>
        </div>

        {/* ── Setup guide (shown during onboarding phase) ── */}
        {!setup.loading && !guideDismissed && setup.stage <= 2 && (
          <div style={{ paddingTop:'1rem' }}>
            <SetupGuide
              stage={setup.stage}
              storeCount={setup.storeCount}
              productCount={setup.productCount}
              onDismiss={() => setGuideDismissed(true)}
            />
          </div>
        )}

        {/* ── Filters ── */}
        <div style={{ padding:'1rem 1.75rem', display:'flex', gap:'0.75rem', flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ position:'relative', flex:1, minWidth:220 }}>
            <Search size={14} style={{ position:'absolute', left:10, top:'50%',
              transform:'translateY(-50%)', color:'var(--text-muted)' }} />
            <input
              style={{ width:'100%', paddingLeft:32, paddingRight:12, height:36,
                border:'1px solid var(--border-color)', borderRadius:6,
                background:'var(--bg-secondary)', color:'var(--text-primary)', fontSize:'0.85rem' }}
              placeholder="Search name, UPC, brand…"
              value={q} onChange={e => { setQ(e.target.value); setPage(1); }} />
          </div>
          <select style={filterSelect} value={filters.departmentId}
            onChange={e => { setFilters(f=>({...f,departmentId:e.target.value})); setPage(1); }}>
            <option value="">All Departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select style={filterSelect} value={filters.taxClass}
            onChange={e => { setFilters(f=>({...f,taxClass:e.target.value})); setPage(1); }}>
            <option value="">All Tax Classes</option>
            {TAX_CLASSES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select style={filterSelect} value={filters.active}
            onChange={e => { setFilters(f=>({...f,active:e.target.value})); setPage(1); }}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
            <option value="">All</option>
          </select>
        </div>

        {/* ── Table ── */}
        <div style={{ overflowX:'auto', padding:'0 1.75rem' }}>
          {loading ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
              padding:'4rem', color:'var(--text-muted)', gap:8 }}>
              <Loader size={18} style={{ animation:'spin 1s linear infinite' }} /> Loading…
            </div>
          ) : products.length === 0 ? (
            <div style={{ textAlign:'center', padding:'4rem', color:'var(--text-muted)' }}>
              <Package size={40} style={{ opacity:.25, marginBottom:12 }} />
              <div style={{ fontWeight:600, marginBottom:4 }}>No products found</div>
              <div style={{ fontSize:'0.82rem', marginBottom:'1rem' }}>
                Add your first product or adjust your filters.
              </div>
              <button onClick={() => navigate('/portal/catalog/new')}
                style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'0.5rem 1.25rem',
                  borderRadius:6, border:'none', background:'var(--accent-primary)', color:'#fff',
                  cursor:'pointer', fontSize:'0.85rem', fontWeight:600 }}>
                <Plus size={14} /> Add First Product
              </button>
            </div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
              <thead>
                <tr style={{ borderBottom:'1px solid var(--border-color)' }}>
                  {['Product','Pack','Cost','Retail','Margin','Department','Tax','Flags',''].map(h => (
                    <th key={h} style={{ textAlign:'left', padding:'0.5rem 0.75rem', fontSize:'0.65rem',
                      fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em',
                      color:'var(--text-muted)', whiteSpace:'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map(p => {
                  const dept    = departments.find(d => d.id === p.departmentId);
                  const promos  = activePromos(p.id);
                  return (
                    <tr key={p.id}
                      style={{ borderBottom:'1px solid var(--border-color)', cursor:'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background='var(--bg-tertiary)'}
                      onMouseLeave={e => e.currentTarget.style.background=''}>

                      {/* Name + brand + UPC */}
                      <td style={{ padding:'0.6rem 0.75rem', maxWidth:240 }}
                        onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        <div style={{ fontWeight:600, fontSize:'0.83rem', lineHeight:1.3 }}>{p.name}</div>
                        {p.brand && <div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>{p.brand}</div>}
                        {p.upc   && <div style={{ fontSize:'0.68rem', color:'var(--text-muted)', fontFamily:'monospace' }}>{p.upc}</div>}
                        {promos.length > 0 && (
                          <span style={{ fontSize:'0.65rem', fontWeight:700, padding:'1px 6px', borderRadius:3, marginTop:2,
                            display:'inline-block', background:(promos[0].badgeColor||'#ef4444')+'25',
                            color:promos[0].badgeColor||'#ef4444' }}>
                            {promos[0].badgeLabel || promos[0].promoType.toUpperCase()}
                          </span>
                        )}
                      </td>

                      {/* Pack */}
                      <td style={{ padding:'0.6rem 0.75rem', whiteSpace:'nowrap' }}
                        onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        <span style={{ fontSize:'0.75rem', fontWeight:600,
                          color:(p.pack||0)>1?'var(--accent-primary)':'var(--text-muted)' }}>
                          {packSummary(p)}
                        </span>
                      </td>

                      {/* Cost */}
                      <td style={{ padding:'0.6rem 0.75rem', fontFamily:'monospace', whiteSpace:'nowrap' }}
                        onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        {fmt$(p.defaultCostPrice)}
                      </td>

                      {/* Retail */}
                      <td style={{ padding:'0.6rem 0.75rem', fontFamily:'monospace', fontWeight:700, whiteSpace:'nowrap' }}
                        onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        {fmt$(p.defaultRetailPrice)}
                      </td>

                      {/* Margin */}
                      <td style={{ padding:'0.6rem 0.75rem', whiteSpace:'nowrap' }}
                        onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        <MarginBadge cost={p.defaultCostPrice} retail={p.defaultRetailPrice} />
                      </td>

                      {/* Dept */}
                      <td style={{ padding:'0.6rem 0.75rem' }}
                        onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        {dept ? (
                          <span style={{ fontSize:'0.72rem', fontWeight:600, padding:'2px 8px', borderRadius:4,
                            background:(dept.color||'#6366f1')+'20', color:dept.color||'#6366f1' }}>
                            {dept.name}
                          </span>
                        ) : <span style={{ color:'var(--text-muted)', fontSize:'0.75rem' }}>—</span>}
                      </td>

                      {/* Tax */}
                      <td style={{ padding:'0.6rem 0.75rem' }}
                        onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        <TaxBadge tc={p.taxClass} />
                      </td>

                      {/* Flags */}
                      <td style={{ padding:'0.6rem 0.75rem' }}
                        onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                        <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
                          {p.ebtEligible   && <Flag color="#10b981">EBT</Flag>}
                          {p.ageRequired   && <Flag color="#ef4444">{p.ageRequired}+</Flag>}
                          {p.depositRuleId && <Flag color="#06b6d4">DEP</Flag>}
                          {p.byWeight      && <Flag color="#8b5cf6">LB</Flag>}
                        </div>
                      </td>

                      {/* Actions */}
                      <td style={{ padding:'0.6rem 0.75rem' }}>
                        <div style={{ display:'flex', gap:4 }}>
                          <button title="Edit"
                            onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}
                            style={actionBtn}>
                            <Edit2 size={13} />
                          </button>
                          <button title="Delete"
                            onClick={() => handleDelete(p)}
                            style={{ ...actionBtn, color:'#ef4444' }}>
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
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            padding:'1.25rem', borderTop:'1px solid var(--border-color)' }}>
            <button disabled={page<=1} onClick={() => setPage(p=>p-1)} style={{ ...actionBtn, opacity:page<=1?.4:1 }}>
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>
              Page {page} of {pagination.pages} · {pagination.total} products
            </span>
            <button disabled={page>=pagination.pages} onClick={() => setPage(p=>p+1)} style={{ ...actionBtn, opacity:page>=pagination.pages?.4:1 }}>
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Micro-styles
// ─────────────────────────────────────────────────────────────────────────────

const Flag = ({ color, children }) => (
  <span style={{ fontSize:'0.62rem', fontWeight:700, padding:'1px 5px',
    borderRadius:3, background:color+'18', color }}>
    {children}
  </span>
);

const filterSelect = {
  height:36, border:'1px solid var(--border-color)', borderRadius:6,
  background:'var(--bg-secondary)', color:'var(--text-primary)', fontSize:'0.82rem',
  padding:'0 0.75rem', cursor:'pointer',
};

const actionBtn = {
  background:'none', border:'1px solid var(--border-color)', borderRadius:5,
  cursor:'pointer', padding:'0.25rem 0.45rem', color:'var(--text-muted)',
  display:'flex', alignItems:'center',
};
