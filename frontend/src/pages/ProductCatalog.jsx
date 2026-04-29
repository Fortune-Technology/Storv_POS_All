/**
 * ProductCatalog — Organization-level product list.
 * Add / edit navigates to the full-page ProductForm.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';

import {
  getCatalogProducts, searchCatalogProducts,
  deleteCatalogProduct,
  getCatalogDepartments,
  getCatalogPromotions,
  bulkDeleteCatalogProducts,
  bulkSetDepartment,
  bulkToggleActive,
  bulkUpdateCatalogProducts,
  // deleteAllCatalogProducts moved to superadmin / admin-app per ops policy
  // (see admin-app/src/pages/AdminOrganizations.tsx → "Wipe Catalog").
  getPOSConfig,
  updatePOSConfig,
  exportProductsCsv,
} from '../services/api';
import { toast } from 'react-toastify';
import {
  Search, Plus, Edit2, Trash2, ChevronLeft, ChevronRight,
  Package, Loader, RefreshCw, Copy, CheckSquare, Square,
  XCircle, Tag, ToggleLeft, DollarSign, Layers, Settings, X,
  Camera, Download,
} from 'lucide-react';
import { useSetupStatus } from '../hooks/useSetupStatus';
import { SetupGuide } from '../components/SetupGuide';
import { usePermissions } from '../hooks/usePermissions';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import SortableHeader from '../components/SortableHeader';
import { useTableSort } from '../hooks/useTableSort';
import AdvancedFilter, { applyAdvancedFilters } from '../components/AdvancedFilter';
import './ProductCatalog.css';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmt$ = (v) => (v == null || v === '' ? 'N/A' : '$' + Number(v).toFixed(2));

const calcMargin = (cost, retail) => {
  const c = parseFloat(cost), r = parseFloat(retail);
  if (!c || !r || r <= 0) return null;
  return ((r - c) / r) * 100;
};

const TAX_CLASSES = [
  { value: 'grocery',     label: 'Grocery',     color: '#10b981' },
  { value: 'alcohol',     label: 'Alcohol',     color: 'var(--accent-primary)' },
  { value: 'tobacco',     label: 'Tobacco',     color: '#64748b' },
  { value: 'hot_food',    label: 'Hot Food',    color: '#f97316' },
  { value: 'standard',    label: 'Standard',    color: '#3b82f6' },
  { value: 'non_taxable', label: 'Non-Tax',     color: '#94a3b8' },
  { value: 'none',        label: 'No Tax',      color: '#94a3b8' },
];

// Session 39 Round 3 — configuration for the AdvancedFilter drawer.
// `departments` is passed in so the Department enum dropdown stays live.
const PRODUCT_FILTER_FIELDS = (departments) => [
  { key: 'name',               label: 'Product Name',  type: 'string' },
  { key: 'upc',                label: 'UPC',           type: 'string', placeholder: 'e.g. 0080686006374' },
  { key: 'brand',              label: 'Brand',         type: 'string' },
  { key: 'departmentId',       label: 'Department',    type: 'enum',
    options: [{ value: '', label: '— None —' }, ...(departments || []).map(d => ({ value: String(d.id), label: d.name }))] },
  { key: 'taxClass',           label: 'Tax Class',     type: 'enum',
    options: TAX_CLASSES.map(t => ({ value: t.value, label: t.label })) },
  { key: 'defaultRetailPrice', label: 'Retail Price',  type: 'number', step: '0.01' },
  { key: 'defaultCostPrice',   label: 'Cost Price',    type: 'number', step: '0.01' },
  { key: 'margin',             label: 'Margin (%)',    type: 'number', step: '0.1' },
  { key: 'quantityOnHand',     label: 'Qty On Hand',   type: 'number' },
  { key: 'ebtEligible',        label: 'EBT Eligible',  type: 'boolean' },
  { key: 'ageRequired',        label: 'Age Restricted',type: 'number' },
  { key: 'depositPerUnit',     label: 'Deposit / Unit',type: 'number', step: '0.01' },
  { key: 'active',             label: 'Active',        type: 'boolean' },
  { key: 'trackInventory',     label: 'Track Inventory',type: 'boolean' },
];

// Accessor map for advanced-filter — computes `margin` on the fly since the
// row doesn't store it. Everything else falls through to `row[key]`.
const PRODUCT_FILTER_CONFIG = {
  margin: { accessor: (p) => calcMargin(p.defaultCostPrice, p.defaultRetailPrice) },
};

// Session 39 Round 4 — server-backed sort keys. Must stay in sync with
// PRODUCT_SORT_MAP in backend/src/controllers/catalogController.js.
// Keys NOT in this set still sort via client-side useTableSort over the
// currently-loaded page (margin + onHand fall into this bucket because
// they're computed / per-store values).
const SERVER_SORT_KEYS = new Set(['name', 'pack', 'cost', 'retail', 'department', 'vendor']);

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
// Catalog Columns — store-configurable.  "Product", "Flags", "Actions" are
// always-on. The rest can be toggled by manager+ via the gear icon and saved
// per-store in store.pos.catalogColumns.
// ─────────────────────────────────────────────────────────────────────────────
const CATALOG_COLUMNS = [
  { key: 'pack',       label: 'Pack',       defaultOn: false },
  { key: 'cost',       label: 'Cost',       defaultOn: false },
  { key: 'retail',     label: 'Retail',     defaultOn: true  },
  { key: 'margin',     label: 'Margin',     defaultOn: false },
  { key: 'department', label: 'Department', defaultOn: true  },
  { key: 'onHand',     label: 'On Hand',    defaultOn: true  },
  { key: 'vendor',     label: 'Vendor',     defaultOn: false },
];
const DEFAULT_VISIBLE_COLS = CATALOG_COLUMNS.filter(c => c.defaultOn).map(c => c.key);

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function ProductCatalog() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const setup    = useSetupStatus();
  const { can } = usePermissions();
  const canCreate = can('products.create');
  const canEdit   = can('products.edit');
  const canDelete = can('products.delete');
  const [guideDismissed, setGuideDismissed] = useState(false);

  const [products,    setProducts]    = useState([]);
  const [departments, setDepartments] = useState([]);
  const [promotions,  setPromotions]  = useState([]);
  const [pagination,  setPagination]  = useState({ page:1, pages:1, total:0 });
  const [loading,     setLoading]     = useState(false);
  const [q,           setQ]           = useState('');
  const [filters,     setFilters]     = useState({ departmentId:'', taxClass:'', active:'true' });
  // Session 39 Round 3 — advanced multi-criteria filters applied client-side
  // over the currently-loaded page. Narrows the displayed set further than
  // the basic dept/tax/active filter row above.
  const [advFilters,  setAdvFilters]  = useState([]);
  const [page,        setPage]        = useState(1);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkAction,  setBulkAction]  = useState(null); // 'delete' | 'department' | 'active' | 'price' | null
  const [bulkDeptId,  setBulkDeptId]  = useState('');
  const [bulkPrice,   setBulkPrice]   = useState('');
  const [bulkActive,  setBulkActive]  = useState(true);
  const [bulkSaving,  setBulkSaving]  = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Delete-all state removed — feature moved to admin-app (superadmin only).

  // Active store ID (for On Hand lookup) and per-store column config
  const [activeStoreId,    setActiveStoreId]    = useState(localStorage.getItem('activeStoreId') || '');
  const [visibleCols,      setVisibleCols]      = useState(DEFAULT_VISIBLE_COLS);
  const [posConfigCache,   setPosConfigCache]   = useState(null);
  const [showColsModal,    setShowColsModal]    = useState(false);
  const [colsSaving,       setColsSaving]       = useState(false);

  const debounceRef = useRef(null);

  // Load catalogColumns from store.pos when store changes
  useEffect(() => {
    if (!activeStoreId) return;
    let mounted = true;
    getPOSConfig(activeStoreId)
      .then(cfg => {
        if (!mounted) return;
        setPosConfigCache(cfg);
        const cols = Array.isArray(cfg?.catalogColumns) ? cfg.catalogColumns : null;
        setVisibleCols(cols && cols.length ? cols : DEFAULT_VISIBLE_COLS);
      })
      .catch(() => { /* fall back to defaults */ });
    return () => { mounted = false; };
  }, [activeStoreId]);

  // Re-read activeStoreId on storage change (StoreSwitcher updates it)
  useEffect(() => {
    const onStorage = () => setActiveStoreId(localStorage.getItem('activeStoreId') || '');
    window.addEventListener('storage', onStorage);
    // Also poll every 2s in same-tab StoreSwitcher case
    const id = setInterval(() => {
      const cur = localStorage.getItem('activeStoreId') || '';
      setActiveStoreId(prev => prev === cur ? prev : cur);
    }, 2000);
    return () => { window.removeEventListener('storage', onStorage); clearInterval(id); };
  }, []);

  const saveColumns = async (newCols) => {
    if (!activeStoreId) {
      toast.error('Select an active store to save column preferences');
      return;
    }
    setColsSaving(true);
    try {
      const merged = { ...(posConfigCache || {}), catalogColumns: newCols };
      await updatePOSConfig({ storeId: activeStoreId, config: merged });
      setVisibleCols(newCols);
      setPosConfigCache(merged);
      setShowColsModal(false);
      toast.success('Column preferences saved');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save columns');
    } finally {
      setColsSaving(false);
    }
  };

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
      loadProducts(q, page, filters, sort.sortKey && SERVER_SORT_KEYS.has(sort.sortKey) ? { sortKey: sort.sortKey, sortDir: sort.sortDir } : null);
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
      loadProducts(q, page, filters, sort.sortKey && SERVER_SORT_KEYS.has(sort.sortKey) ? { sortKey: sort.sortKey, sortDir: sort.sortDir } : null);
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setBulkSaving(false); }
  };

  const handleBulkActive = async (active) => {
    setBulkSaving(true);
    try {
      await bulkToggleActive([...selectedIds], active);
      toast.success(`${selectedIds.size} product(s) set to ${active ? 'active' : 'inactive'}`);
      clearSelection(); setBulkAction(null);
      loadProducts(q, page, filters, sort.sortKey && SERVER_SORT_KEYS.has(sort.sortKey) ? { sortKey: sort.sortKey, sortDir: sort.sortDir } : null);
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setBulkSaving(false); }
  };

  // handleDeleteAll removed — feature moved to admin-app's Organizations page
  // for superadmin-only execution. See admin-app's deleteAllOrgProducts API
  // helper, which calls /api/catalog/products/delete-all with X-Tenant-Id set
  // to the target org.

  const handleBulkPrice = async () => {
    const price = parseFloat(bulkPrice);
    if (isNaN(price)) { toast.error('Enter a valid price'); return; }
    setBulkSaving(true);
    try {
      await bulkUpdateCatalogProducts([...selectedIds].map(id => ({ id, defaultRetailPrice: price })));
      toast.success(`${selectedIds.size} product(s) price updated to $${price.toFixed(2)}`);
      clearSelection(); setBulkAction(null); setBulkPrice('');
      loadProducts(q, page, filters, sort.sortKey && SERVER_SORT_KEYS.has(sort.sortKey) ? { sortKey: sort.sortKey, sortDir: sort.sortDir } : null);
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

  const loadProducts = useCallback(async (search, pg, filt, sortParams) => {
    setLoading(true);
    try {
      const params = { page:pg, limit:50, ...filt };
      // When an active store is set, ask the backend for that store's QOH.
      if (activeStoreId) params.storeId = activeStoreId;
      // Session 39 Round 4 — server-side sort across the full catalog
      if (sortParams?.sortKey) {
        params.sortBy  = sortParams.sortKey;
        params.sortDir = sortParams.sortDir || 'asc';
      }
      const res = search?.trim()
        ? await searchCatalogProducts(search, params)
        : await getCatalogProducts(params);

      // Backend shape: { success, data: [...products], pagination: { page, limit, total, pages } }
      // OR fallback: { products: [...], total, page, pages }
      // OR raw array
      const list = Array.isArray(res)          ? res
                 : Array.isArray(res?.data)    ? res.data
                 : res?.products               ? res.products
                 : [];
      const p = res?.pagination || {
        page:  res?.page  ?? pg,
        pages: res?.pages ?? 1,
        total: res?.total ?? list.length,
      };

      setProducts(list);
      setPagination({
        page:  p.page  ?? pg,
        pages: p.pages ?? Math.ceil((p.total || list.length) / (p.limit || 50)) ?? 1,
        total: p.total ?? list.length,
      });
    } catch (e) {
      console.error('[ProductCatalog] load failed:', e);
      toast.error('Failed to load products');
    }
    finally { setLoading(false); }
  }, [activeStoreId]);

  useEffect(() => { loadSupport(); }, []);

  // Session 39 Round 3 — sort + advanced-filter pipeline
  // Session 39 Round 4 — sort is now server-side for columns the backend
  // supports (name, pack, cost, retail, department, vendor, createdAt,
  // updatedAt). Margin and onHand fall back to client-side-over-current-page
  // because they're computed/nested fields Prisma can't easily orderBy.
  // NOTE: declared here (before the debounced reload effect) because that
  // effect depends on sort.sortKey/sortDir. Moving this below would cause
  // a TDZ ReferenceError: Cannot access 'sort' before initialization.
  const filteredProducts = applyAdvancedFilters(products, advFilters, PRODUCT_FILTER_CONFIG);
  const sort = useTableSort(filteredProducts, {
    accessors: {
      name:               (p) => p.name,
      retail:             (p) => Number(p.defaultRetailPrice || 0),
      cost:               (p) => Number(p.defaultCostPrice || 0),
      margin:             (p) => calcMargin(p.defaultCostPrice, p.defaultRetailPrice) ?? -1,
      department:         (p) => departments.find(d => d.id === p.departmentId)?.name || '',
      onHand:             (p) => Number(p.quantityOnHand ?? -1),
      vendor:             (p) => p.vendorName || '',
      pack:               (p) => Number(p.casePacks || 0),
    },
    // When the active sort key is server-backed, skip client-side sorting so
    // the hook doesn't reorder a page the backend already sorted globally.
    // For margin/onHand, client-side sort still runs over the current page.
    serverSide: sortKey => SERVER_SORT_KEYS.has(sortKey),
  });

  useEffect(() => {
    clearTimeout(debounceRef.current);
    // Session 39 Round 4 — include sort state so column-click re-fetches
    // a newly-sorted page across the full catalog. Skip when sort key is
    // not in SERVER_SORT_KEYS (keeps client-side sort purely local for those).
    const serverSortKey = sort.sortKey && SERVER_SORT_KEYS.has(sort.sortKey) ? sort.sortKey : null;
    const sortParams = serverSortKey ? { sortKey: serverSortKey, sortDir: sort.sortDir } : null;
    debounceRef.current = setTimeout(() => loadProducts(q, page, filters, sortParams), 350);
    return () => clearTimeout(debounceRef.current);
  }, [q, page, filters, activeStoreId, sort.sortKey, sort.sortDir]);

  const handleDelete = async (product) => {
    if (!await confirm({
      title: 'Delete product?',
      message: `Delete "${product.name}"?`,
      confirmLabel: 'Delete',
      danger: true,
    })) return;
    try {
      await deleteCatalogProduct(product.id);
      setProducts(ps => ps.filter(p => p.id !== product.id));
      toast.success('Product deleted');
    } catch (e) { toast.error(e.response?.data?.error || 'Delete failed'); }
  };

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await exportProductsCsv(
        activeStoreId ? { storeId: activeStoreId } : {}
      );
      const blob = res.data;
      const rowCount = parseInt(res.headers?.['x-row-count'] || '0', 10);
      const disposition = res.headers?.['content-disposition'] || '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] || `products-${new Date().toISOString().slice(0,10)}.csv`;
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: filename });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${rowCount || 'all'} products`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Export failed');
    } finally {
      setExporting(false);
    }
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
            <button onClick={() => { loadProducts(q, page, filters, sort.sortKey && SERVER_SORT_KEYS.has(sort.sortKey) ? { sortKey: sort.sortKey, sortDir: sort.sortDir } : null); loadSupport(); }} className="pc-refresh-btn">
              <RefreshCw size={14} />
            </button>
            <button
              onClick={() => setShowColsModal(true)}
              className="pc-refresh-btn"
              title="Customize columns for this store"
            >
              <Settings size={14} />
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="pc-refresh-btn"
              title={activeStoreId ? 'Export all products to CSV (active store)' : 'Export all products to CSV'}
            >
              {exporting ? <Loader size={14} className="pc-spin" /> : <Download size={14} />}
            </button>
            {/* "Delete All" relocated to superadmin / admin-app
                (Organizations → Wipe Catalog) so the destructive action can't
                be executed from inside a tenant's own portal. */}
            {canCreate && (
              <button onClick={() => navigate('/portal/catalog/new')} className="pc-add-btn" data-tour="products-new-btn">
                <Plus size={14} /> Add Product
              </button>
            )}
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
            <button
              type="button"
              className="pc-scan-btn"
              onClick={() => setShowScanner(true)}
              title="Scan barcode with camera"
            >
              <Camera size={14} /> Scan
            </button>
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

        {/* Session 39 Round 3 — advanced filter drawer (client-side on current page) */}
        <AdvancedFilter
          fields={PRODUCT_FILTER_FIELDS(departments)}
          filters={advFilters}
          onChange={setAdvFilters}
        />
        {advFilters.length > 0 && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: -8, marginBottom: 12 }}>
            Advanced filters narrow the {products.length} rows currently shown. Switch pages to search a different slice.
          </div>
        )}

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
                  <SortableHeader label="Product"    sortKey="name"       sort={sort} />
                  {visibleCols.includes('pack')       && <SortableHeader label="Pack"       sortKey="pack"       sort={sort} />}
                  {visibleCols.includes('cost')       && <SortableHeader label="Cost"       sortKey="cost"       sort={sort} />}
                  {visibleCols.includes('retail')     && <SortableHeader label="Retail"     sortKey="retail"     sort={sort} />}
                  {visibleCols.includes('margin')     && <SortableHeader label="Margin"     sortKey="margin"     sort={sort} />}
                  {visibleCols.includes('department') && <SortableHeader label="Department" sortKey="department" sort={sort} />}
                  {visibleCols.includes('onHand')     && <SortableHeader label="On Hand"    sortKey="onHand"     sort={sort} />}
                  {visibleCols.includes('vendor')     && <SortableHeader label="Vendor"     sortKey="vendor"     sort={sort} />}
                  <SortableHeader label="Flags" sortable={false} />
                  <SortableHeader label="Actions" sortable={false} align="right" />
                </tr>
              </thead>
              <tbody>
                {sort.sorted.map(p => {
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

                      {visibleCols.includes('pack') && (
                        <td className="pc-td-nowrap"
                          onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                          <span className={`pc-pack-text ${(p.pack||0)>1 ? 'pc-pack-active' : 'pc-pack-muted'}`}>
                            {packSummary(p)}
                          </span>
                        </td>
                      )}

                      {visibleCols.includes('cost') && (
                        <td className="pc-td-mono"
                          onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                          {fmt$(p.defaultCostPrice)}
                        </td>
                      )}

                      {visibleCols.includes('retail') && (
                        <td className="pc-td-bold"
                          onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                          {fmt$(p.defaultRetailPrice)}
                        </td>
                      )}

                      {visibleCols.includes('margin') && (
                        <td className="pc-td-nowrap"
                          onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                          <MarginBadge cost={p.defaultCostPrice} retail={p.defaultRetailPrice} />
                        </td>
                      )}

                      {visibleCols.includes('department') && (
                        <td onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                          {dept ? (
                            <span className="pc-dept-badge" style={{ background:(dept.color||'var(--accent-primary)')+'20', color:dept.color||'var(--accent-primary)' }}>
                              {dept.name}
                            </span>
                          ) : <span className="pc-pack-muted">N/A</span>}
                        </td>
                      )}

                      {visibleCols.includes('onHand') && (
                        <td className="pc-td-nowrap"
                          onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                          <OnHandCell qty={p.quantityOnHand} hasStore={!!activeStoreId} />
                        </td>
                      )}

                      {visibleCols.includes('vendor') && (
                        <td onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}>
                          {p.vendor ? (
                            <span className="pc-pack-text">{p.vendor.name}</span>
                          ) : <span className="pc-pack-muted">N/A</span>}
                        </td>
                      )}

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
                          {canEdit && (
                            <button title="Edit"
                              onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}
                              className="pc-action-btn">
                              <Edit2 size={13} />
                            </button>
                          )}
                          {canDelete && (
                            <button title="Delete"
                              onClick={() => handleDelete(p)}
                              className="pc-action-btn delete">
                              <Trash2 size={13} />
                            </button>
                          )}
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
        {pagination.total > 0 && (
          <div className="pc-pagination">
            <button disabled={page<=1} onClick={() => setPage(1)} className="pc-pagination-btn" title="First page">
              ⇤
            </button>
            <button disabled={page<=1} onClick={() => setPage(p=>p-1)} className="pc-pagination-btn">
              <ChevronLeft size={14} />
            </button>
            <span className="pc-pagination-text">
              Page <input
                type="number"
                min="1"
                max={pagination.pages}
                value={page}
                onChange={(e) => {
                  const n = parseInt(e.target.value);
                  if (!isNaN(n) && n >= 1 && n <= pagination.pages) setPage(n);
                }}
                style={{
                  width: 55, textAlign: 'center',
                  padding: '2px 4px', margin: '0 4px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                }}
              /> of {pagination.pages}
              <span style={{ color: 'var(--text-muted)', marginLeft: 12 }}>
                · {pagination.total.toLocaleString()} products
              </span>
            </span>
            <button disabled={page>=pagination.pages} onClick={() => setPage(p=>p+1)} className="pc-pagination-btn">
              <ChevronRight size={14} />
            </button>
            <button disabled={page>=pagination.pages} onClick={() => setPage(pagination.pages)} className="pc-pagination-btn" title="Last page">
              ⇥
            </button>
          </div>
        )}

      {/* Delete-All modal removed — moved to admin-app for superadmin-only execution. */}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Column Config Modal ── */}
      {showColsModal && (
        <ColumnsModal
          allCols={CATALOG_COLUMNS}
          selected={visibleCols}
          onClose={() => setShowColsModal(false)}
          onSave={saveColumns}
          saving={colsSaving}
          hasStore={!!activeStoreId}
        />
      )}

      {/* ── Barcode Scanner Modal — tablets / phones without handheld scanner ── */}
      <BarcodeScannerModal
        open={showScanner}
        onClose={() => setShowScanner(false)}
        onDetected={(code) => { setQ(code); setPage(1); }}
        title="Scan product barcode"
      />
    </div>
  );
}

function ColumnsModal({ allCols, selected, onClose, onSave, saving, hasStore }) {
  const [draft, setDraft] = useState(selected);
  const toggle = (key) => setDraft(d => d.includes(key) ? d.filter(k => k !== key) : [...d, key]);
  return (
    <div className="pc-cols-backdrop" onClick={onClose}>
      <div className="pc-cols-modal" onClick={e => e.stopPropagation()}>
        <div className="pc-cols-head">
          <div>
            <h3 className="pc-cols-title">Customize Columns</h3>
            <p className="pc-cols-sub">Choose which columns appear in the product list. Saved per store.</p>
          </div>
          <button onClick={onClose} className="pc-cols-close" title="Close"><X size={16} /></button>
        </div>
        {!hasStore && (
          <div className="pc-cols-warn">
            Select an active store from the store switcher to save preferences.
          </div>
        )}
        <div className="pc-cols-list">
          <div className="pc-cols-item pc-cols-item--locked">
            <span><CheckSquare size={16} style={{ color: '#94a3b8' }} /></span>
            <span>Product, Flags, Actions <span className="pc-cols-lock">(always shown)</span></span>
          </div>
          {allCols.map(c => {
            const on = draft.includes(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggle(c.key)}
                className={`pc-cols-item ${on ? 'pc-cols-item--on' : ''}`}
              >
                <span>{on ? <CheckSquare size={16} /> : <Square size={16} />}</span>
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
        <div className="pc-cols-foot">
          <button onClick={() => setDraft(DEFAULT_VISIBLE_COLS)} className="pc-cols-reset">Reset to default</button>
          <button onClick={onClose} className="pc-cols-cancel">Cancel</button>
          <button onClick={() => onSave(draft)} className="pc-cols-save" disabled={saving || !hasStore}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
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
  if (m === null) return <span className="pc-pack-muted">N/A</span>;
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

const OnHandCell = ({ qty, hasStore }) => {
  if (!hasStore) {
    return <span className="pc-pack-muted" title="Select a store to see stock">N/A</span>;
  }
  if (qty == null) {
    return <span className="pc-pack-muted" title="Not yet stocked at this store">N/A</span>;
  }
  const n = Number(qty);
  let color = '#10b981'; // green
  if (n <= 0)      color = '#ef4444'; // red
  else if (n <= 5) color = '#f59e0b'; // amber
  return (
    <span className="pc-onhand-badge" style={{ background: color + '18', color, fontWeight: 700 }}>
      {n}
    </span>
  );
};
