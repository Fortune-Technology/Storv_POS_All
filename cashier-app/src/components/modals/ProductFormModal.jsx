/**
 * ProductFormModal — 1:1 visual copy of portal ProductForm, adapted to run
 * as a modal inside the cashier-app. Session 39 Round 3 — user asked for
 * full back-office parity with the same fields and layout.
 *
 * Key deltas from the portal source:
 *   - useParams/useNavigate/Link removed — cashier-app has no portal router
 *   - productId / onClose come in as props
 *   - navigate('/portal/...') calls fall through to onClose()
 *   - useSetupStatus + NoStoreBanner stubbed (no setup wizard here)
 *   - API imports re-routed to cashier-app/src/api/pos.js
 *   - Outer wrapper is a modal backdrop (below, in the main component)
 *
 * Everything else is verbatim so visual layout matches back-office exactly.
 * When the portal ProductForm changes, copy the diff across.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

import PriceInput from '../PriceInput';
import { useConfirm } from '../../hooks/useConfirmDialog.jsx';
import {
  getCatalogProduct, createCatalogProduct, updateCatalogProduct,
  getCatalogDepartments, createCatalogDepartment, updateCatalogDepartment, deleteCatalogDepartment,
  getDepartmentAttributes,
  getCatalogVendors, createCatalogVendor, updateCatalogVendor, deleteCatalogVendor,
  upsertStoreInventory, getStoreInventory,
  getCatalogPromotions, createCatalogPromotion, updateCatalogPromotion, deleteCatalogPromotion,
  getProductUpcs, addProductUpc, deleteProductUpc,
  getProductPackSizes, bulkReplaceProductPackSizes,
  getPOSConfig, getProduct52WeekStats,
  duplicateCatalogProduct, listProductGroups,
  getCatalogTaxRules, uploadProductImage,
} from '../../api/pos.js';
import './ProductFormModal.css';

// Cashier-app stubs for portal-only dependencies. `useSetupStatus` normally
// returns every store the tenant owns; in the cashier-app we only know our
// own station's storeId, so we return a single-element stores array so the
// post-create StoreProduct upsert loop still initialises this store's
// inventory row for the new product.
const useSetupStatus = () => {
  const storeId = typeof window !== 'undefined' ? localStorage.getItem('activeStoreId') : null;
  return {
    ready: true, loading: false, productCount: 0, stage: 10,
    stores: storeId ? [{ id: storeId }] : [],
  };
};
const NoStoreBanner  = () => null;
// <Link> becomes a no-op span (navigation is handled by onClose instead).
const Link = ({ to, onClick, children, ...rest }) => (
  <span {...rest} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default', ...(rest.style || {}) }}>{children}</span>
);
import { toast } from 'react-toastify';
import {
  ChevronLeft, Save, Package, Building2, Truck, X, Plus,
  Trash2, Settings, DollarSign, Info, Check, Tag, Percent,
  Gift, ShoppingBag, Zap, Calendar, Edit2, AlertCircle, Barcode, Layers,
  Copy, Users as UsersIcon, Upload, Image, Link2, Star,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TAX_CLASSES = [
  { value: 'grocery',     label: 'Grocery',      note: '0% ME' },
  { value: 'alcohol',     label: 'Alcohol',      note: '5.5% ME' },
  { value: 'tobacco',     label: 'Tobacco',      note: '5.5% ME' },
  { value: 'hot_food',    label: 'Hot Food',     note: '8% ME' },
  { value: 'standard',    label: 'Standard',     note: '5.5% ME' },
  { value: 'non_taxable', label: 'Non-Taxable',  note: '0%' },
];

const PACK_PRESETS = [
  { id: 'single',     label: 'Single item',    desc: '1 unit',         sellUnit: 'each', casePacks: 1,  sellUnitSize: 1  },
  { id: 'cs12',       label: 'Case of 12',     desc: '12 singles',     sellUnit: 'each', casePacks: 12, sellUnitSize: 1  },
  { id: 'cs15',       label: 'Case of 15',     desc: '15 singles',     sellUnit: 'each', casePacks: 15, sellUnitSize: 1  },
  { id: 'cs24',       label: 'Case of 24',     desc: '24 singles',     sellUnit: 'each', casePacks: 24, sellUnitSize: 1  },
  { id: '6x4pk',      label: '6 × 4pk',        desc: '24 units total', sellUnit: 'pack', casePacks: 6,  sellUnitSize: 4  },
  { id: '4x6pk',      label: '4 × 6pk',        desc: '24 units total', sellUnit: 'pack', casePacks: 4,  sellUnitSize: 6  },
  { id: '2x12pk',     label: '2 × 12pk',       desc: '24 units total', sellUnit: 'pack', casePacks: 2,  sellUnitSize: 12 },
  { id: '18pk_whole', label: '18pk (whole)',    desc: 'Sell as 18pk',   sellUnit: 'case', casePacks: 1,  sellUnitSize: 18 },
  { id: '24pk_whole', label: '24pk (whole)',    desc: 'Sell as 24pk',   sellUnit: 'case', casePacks: 1,  sellUnitSize: 24 },
];

const SELL_UNIT_TYPES = [
  { value: 'each', label: 'Single / Each', desc: 'Sell one can, bottle, or item at a time' },
  { value: 'pack', label: 'Multi-pack',    desc: 'Sell a bundle (6pk, 12pk…) as one unit' },
  { value: 'case', label: 'Whole Case',    desc: 'Sell the entire case as one transaction' },
];

const DEAL_TYPES = [
  { value: 'percent_off', label: '% Off',      color: '#10b981', icon: Percent,     desc: 'Percent discount off retail' },
  { value: 'amount_off',  label: '$ Off',       color: '#3b82f6', icon: Tag,         desc: 'Fixed dollar amount off price' },
  { value: 'fixed_price', label: 'Sale Price',  color: '#f59e0b', icon: DollarSign,  desc: 'Set a specific sale price' },
  { value: 'multi_buy',   label: 'Multi-Buy',   color: '#8b5cf6', icon: ShoppingBag, desc: 'e.g. 2 for $3.00, 3 for $5' },
  { value: 'bogo',        label: 'BOGO',        color: '#ec4899', icon: Gift,        desc: 'Buy one, get one free/discounted' },
];

const DEAL_BLANK = {
  name: '', type: 'percent_off', value: '', minQty: 1, getQty: 1,
  startDate: '', endDate: '', active: true,
};

const MARGIN_PRESETS = [20, 25, 30, 33, 40];
const CONTAINER_TYPES = ['can', 'bottle', 'glass bottle', 'plastic bottle', 'jug', 'carton', 'pouch'];
const SIZE_UNITS = ['oz', 'ml', 'L', 'lb', 'kg', 'g', 'each', 'ct', 'fl oz', 'gal'];

const DEPT_COLORS = [
  '#f59e0b','#8b5cf6','#6366f1','#06b6d4','#64748b',
  '#10b981','#3b82f6','#f97316','#ec4899','#84cc16',
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmt$ = (v, decimals = 2) =>
  v == null || v === '' ? '' : '$' + Number(v).toFixed(decimals);

const calcMargin = (cost, retail) => {
  const c = parseFloat(cost), r = parseFloat(retail);
  if (!c || !r || r <= 0 || c <= 0) return null;
  return ((r - c) / r) * 100;
};

const marginColor = (m) =>
  m === null ? '#94a3b8' : m >= 30 ? '#10b981' : m >= 20 ? '#f59e0b' : '#ef4444';

// 2-14 numeric digits. Short codes like `299` are valid identifiers stores
// type on the keypad for non-scan items. Cashier scan path treats short
// codes as exact-match only (see utils/upc.js).
const isValidUPC = (v) => !v || /^\d{2,14}$/.test(v.replace(/\s/g, ''));

// ─────────────────────────────────────────────────────────────────────────────
// Inline Dept Manager
// ─────────────────────────────────────────────────────────────────────────────

function DeptManager({ departments, onClose, onRefresh }) {
  const confirm = useConfirm();
  const [list, setList] = useState(departments);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const startEdit = (d) => {
    setEditing(d.id || 'new');
    setForm({ name: d.name ?? '', code: d.code ?? '', taxClass: d.taxClass ?? 'grocery',
      ageRequired: d.ageRequired ?? '', ebtEligible: d.ebtEligible ?? false,
      bottleDeposit: d.bottleDeposit ?? false, color: d.color ?? 'var(--accent-primary)',
      sortOrder: d.sortOrder ?? 0, active: d.active ?? true });
  };

  const save = async () => {
    if (!form.name) { toast.error('Name required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, ageRequired: form.ageRequired ? parseInt(form.ageRequired) : null };
      const res = editing === 'new'
        ? await createCatalogDepartment(payload)
        : await updateCatalogDepartment(editing, payload);
      if (editing === 'new') setList(l => [...l, res]);
      else setList(l => l.map(d => d.id === editing ? res : d));
      toast.success(editing === 'new' ? 'Department added' : 'Updated');
      setEditing(null);
      onRefresh();
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!await confirm({
      title: 'Delete department?',
      message: 'This cannot be undone. Products tied to this department keep their existing assignment.',
      confirmLabel: 'Delete',
      danger: true,
    })) return;
    try {
      await deleteCatalogDepartment(id);
      setList(l => l.filter(d => d.id !== id));
      onRefresh();
    } catch (e) { toast.error(e.response?.data?.error || 'Delete failed'); }
  };

  return (
    <div className="pf-mm-root">
      <div className="pf-mm-overlay" onClick={onClose} />
      <div className="pf-mm-card">
        <div className="pf-mm-header">
          <div className="pf-mm-title-row">
            <Building2 size={15} color="var(--accent-primary)" />
            <span className="pf-mm-title">Manage Departments</span>
          </div>
          <button onClick={onClose} className="pf-mm-close"><X size={16} /></button>
        </div>
        <div className="pf-mm-body">
          <div className="pf-mm-list">
            <button onClick={() => startEdit({ name:'', active:true })} className="pf-mm-add-btn">
              <Plus size={12} /> Add Department
            </button>
            {list.map(d => (
              <div key={d.id} onClick={() => startEdit(d)}
                className={`pf-mm-list-item${editing === d.id ? ' pf-mm-list-item--active' : ''}`}>
                <div className="pf-mm-list-dot" style={{ background: d.color || 'var(--accent-primary)' }} />
                <span className="pf-mm-list-label">{d.name}</span>
                <button onClick={e => { e.stopPropagation(); del(d.id); }} className="pf-mm-list-del">
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
          <div className="pf-mm-edit">
            {editing ? (
              <>
                <div className="pf-mm-grid">
                  <div className="pf-mm-field--full">
                    <label className="pf-label">Name *</label>
                    <input className="form-input pf-mm-input" value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="pf-mm-field">
                    <label className="pf-label">Code</label>
                    <input className="form-input pf-mm-input" value={form.code}
                      onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} maxLength={8} />
                  </div>
                  <div className="pf-mm-field">
                    <label className="pf-label">Category (age policy)</label>
                    <select className="form-input pf-mm-input" value={form.taxClass}
                      onChange={e => setForm(f => ({ ...f, taxClass: e.target.value }))}>
                      {TAX_CLASSES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="pf-mm-field">
                    <label className="pf-label">Age Required</label>
                    <select className="form-input pf-mm-input" value={form.ageRequired}
                      onChange={e => setForm(f => ({ ...f, ageRequired: e.target.value }))}>
                      <option value="">None</option><option value="18">18+</option><option value="21">21+</option>
                    </select>
                  </div>
                </div>
                <div className="pf-mm-section">
                  <label className="pf-label">Color</label>
                  <div className="pf-mm-color-row">
                    {DEPT_COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                        className={`pf-mm-color-swatch${form.color === c ? ' pf-mm-color-swatch--active' : ''}`}
                        style={{ background: c, color: c }} />
                    ))}
                  </div>
                </div>
                <div className="pf-mm-flags">
                  {[['EBT', 'ebtEligible'], ['Bottle Deposit', 'bottleDeposit'], ['Active', 'active']].map(([label, key]) => (
                    <div key={key} className="pf-mm-flag">
                      <div className="pf-label">{label}</div>
                      <Tog value={!!form[key]} onChange={v => setForm(f => ({ ...f, [key]: v }))} />
                    </div>
                  ))}
                </div>
                <div className="pf-mm-actions">
                  <button onClick={save} disabled={saving} className="pf-btn-primary pf-btn-sm">
                    {saving ? 'Saving…' : editing === 'new' ? 'Add' : 'Save'}
                  </button>
                  <button onClick={() => setEditing(null)} className="pf-btn-secondary pf-btn-sm">Cancel</button>
                </div>
              </>
            ) : (
              <p className="pf-mm-empty">Select a department to edit</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline Vendor Manager
// ─────────────────────────────────────────────────────────────────────────────

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email?.trim());
const validatePhone = (phone) => !phone || /^\+?[\d\s\-\(\)]{7,15}$/.test(phone?.replace(/\s/g, ''));

function VendorManager({ vendors, onClose, onRefresh }) {
  const confirm = useConfirm();
  const [list, setList] = useState(vendors);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [vendorErrors, setVendorErrors] = useState({});

  const startEdit = (v) => {
    setEditing(v.id || 'new');
    setVendorErrors({});
    setForm({ name:v.name??'', code:v.code??'', contactName:v.contactName??'',
      email:v.email??'', phone:v.phone??'', terms:v.terms??'', accountNo:v.accountNo??'', active:v.active??true });
  };

  const save = async () => {
    if (!form.name) { toast.error('Vendor name required'); return; }
    const newErrors = {};
    if (form.email && !validateEmail(form.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    if (form.phone && !validatePhone(form.phone)) {
      newErrors.phone = 'Please enter a valid phone number (e.g. +1 555 000 0000)';
    }
    if (Object.keys(newErrors).length > 0) {
      setVendorErrors(newErrors);
      return;
    }
    setVendorErrors({});
    setSaving(true);
    try {
      const res = editing === 'new'
        ? await createCatalogVendor(form)
        : await updateCatalogVendor(editing, form);
      if (editing === 'new') setList(l => [...l, res]);
      else setList(l => l.map(v => v.id===editing ? res : v));
      toast.success(editing==='new'?'Vendor added':'Updated');
      setEditing(null); onRefresh();
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!await confirm({
      title: 'Delete vendor?',
      message: 'This cannot be undone. Products tied to this vendor keep their existing assignment.',
      confirmLabel: 'Delete',
      danger: true,
    })) return;
    try {
      await deleteCatalogVendor(id);
      setList(l => l.filter(v => v.id!==id));
      onRefresh();
    } catch (e) { toast.error(e.response?.data?.error||'Delete failed'); }
  };

  return (
    <div className="pf-mm-root">
      <div className="pf-mm-overlay" onClick={onClose} />
      <div className="pf-mm-card pf-mm-card--narrow">
        <div className="pf-mm-header">
          <div className="pf-mm-title-row">
            <Truck size={15} color="var(--accent-primary)" />
            <span className="pf-mm-title">Manage Vendors</span>
          </div>
          <button onClick={onClose} className="pf-mm-close"><X size={16} /></button>
        </div>
        <div className="pf-mm-body">
          <div className="pf-mm-list pf-mm-list--narrow">
            <button onClick={() => startEdit({ name:'', active:true })} className="pf-mm-add-btn">
              <Plus size={12} /> Add Vendor
            </button>
            {list.map(v => (
              <div key={v.id} onClick={() => startEdit(v)}
                className={`pf-mm-list-item${editing === v.id ? ' pf-mm-list-item--active' : ''}`}>
                <Truck size={11} color="var(--text-muted)" />
                <span className="pf-mm-list-label">{v.name}</span>
                <button onClick={e => { e.stopPropagation(); del(v.id); }} className="pf-mm-list-del">
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
          <div className="pf-mm-edit">
            {editing ? (
              <>
                <div className="pf-mm-grid">
                  {[['Vendor Name *', 'name', true], ['Short Code', 'code', false], ['Contact', 'contactName', false]].map(([label, key, full]) => (
                    <div key={key} className={full ? 'pf-mm-field--full' : 'pf-mm-field'}>
                      <label className="pf-label">{label}</label>
                      <input className="form-input pf-mm-input" value={form[key] ?? ''}
                        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
                    </div>
                  ))}
                  <div className="pf-mm-field">
                    <label className="pf-label">Email</label>
                    <input className={`form-input pf-mm-input${vendorErrors.email ? ' pf-mm-input--error' : ''}`}
                      value={form.email ?? ''}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      onBlur={() => {
                        if (form.email && !validateEmail(form.email)) {
                          setVendorErrors(prev => ({ ...prev, email: 'Please enter a valid email address' }));
                        } else {
                          setVendorErrors(prev => ({ ...prev, email: '' }));
                        }
                      }} />
                    {vendorErrors.email && <p className="pf-mm-field-error">{vendorErrors.email}</p>}
                  </div>
                  <div className="pf-mm-field">
                    <label className="pf-label">Phone</label>
                    <input className={`form-input pf-mm-input${vendorErrors.phone ? ' pf-mm-input--error' : ''}`}
                      value={form.phone ?? ''}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      onBlur={() => {
                        if (form.phone && !validatePhone(form.phone)) {
                          setVendorErrors(prev => ({ ...prev, phone: 'Please enter a valid phone number (e.g. +1 555 000 0000)' }));
                        } else {
                          setVendorErrors(prev => ({ ...prev, phone: '' }));
                        }
                      }} />
                    {vendorErrors.phone && <p className="pf-mm-field-error">{vendorErrors.phone}</p>}
                  </div>
                  {[['Terms', 'terms'], ['Account #', 'accountNo']].map(([label, key]) => (
                    <div key={key} className="pf-mm-field">
                      <label className="pf-label">{label}</label>
                      <input className="form-input pf-mm-input" value={form[key] ?? ''}
                        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
                    </div>
                  ))}
                </div>
                <div className="pf-mm-section">
                  <div className="pf-label">Active</div>
                  <Tog value={form.active} onChange={v => setForm(f => ({ ...f, active: v }))} />
                </div>
                <div className="pf-mm-actions">
                  <button onClick={save} disabled={saving} className="pf-btn-primary pf-btn-sm">
                    {saving ? 'Saving…' : editing === 'new' ? 'Add' : 'Save'}
                  </button>
                  <button onClick={() => setEditing(null)} className="pf-btn-secondary pf-btn-sm">Cancel</button>
                </div>
              </>
            ) : (
              <p className="pf-mm-empty">Select a vendor</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Toggle
// ─────────────────────────────────────────────────────────────────────────────

function Tog({ value, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={`pf-tog${value ? ' pf-tog--on' : ''}`}>
      <div className="pf-tog-track">
        <div className="pf-tog-thumb" />
      </div>
      <span className="pf-tog-label">{value ? 'Yes' : 'No'}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CanIcon — SVG aluminium can (used inside PackVisual)
// ─────────────────────────────────────────────────────────────────────────────

function CanIcon({ w = 22, h = 34, color = '#3d56b5', color2 = '#253785', visible = true, delay = 0 }) {
  return (
    <svg
      width={w} height={h} viewBox="0 0 22 34"
      style={{
        display: 'block', flexShrink: 0,
        transform: visible ? 'scale(1) translateY(0)' : 'scale(0.15) translateY(10px)',
        opacity: visible ? 1 : 0,
        transition: `transform 0.3s cubic-bezier(0.34,1.56,0.64,1) ${delay}s, opacity 0.2s ease ${delay}s`,
      }}
    >
      {/* Top lid */}
      <ellipse cx="11" cy="4.5" rx="7.8" ry="2.2" fill={color2} />
      {/* Body */}
      <rect x="3.2" y="4.5" width="15.6" height="22" rx="1.5" fill={color} />
      {/* Highlight sheen */}
      <rect x="5.5" y="7" width="3.5" height="16" rx="1.5" fill="rgba(255,255,255,0.18)" />
      {/* Bottom cap */}
      <ellipse cx="11" cy="26.5" rx="7.8" ry="2.2" fill={color2} />
      {/* Tab ring */}
      <ellipse cx="11" cy="4.5" rx="3.2" ry="1.1" fill="rgba(255,255,255,0.25)" />
      {/* Pull tab */}
      <path d="M9.2 3 Q11 1.2 12.8 3" stroke="rgba(255,255,255,0.65)" strokeWidth="1.1" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// ─── grid-columns count for a given unit count ────────────────────────────────
function getPackCols(n) {
  if (n <= 1)  return 1;
  if (n <= 2)  return 2;
  if (n <= 4)  return 2;   // 4  → 2×2
  if (n <= 6)  return 3;   // 6  → 2×3
  if (n <= 8)  return 4;   // 8  → 2×4
  if (n <= 9)  return 3;   // 9  → 3×3
  if (n <= 12) return 4;   // 12 → 3×4
  if (n <= 15) return 5;   // 15 → 3×5
  if (n <= 18) return 6;   // 18 → 3×6
  if (n <= 20) return 5;   // 20 → 4×5
  return 6;                // 24 → 4×6
}

// ─────────────────────────────────────────────────────────────────────────────
// PackVisual — animated visualization of what the customer buys
// ─────────────────────────────────────────────────────────────────────────────

function PackVisual({ sellUnit, sellUnitSize, casePacks, depositPerUnit }) {
  const [visible,  setVisible]  = useState(false);
  const [animKey,  setAnimKey]  = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    setVisible(false);
    setAnimKey(k => k + 1);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(true), 40);
    return () => clearTimeout(timerRef.current);
  }, [sellUnit, sellUnitSize, casePacks]);

  if (sellUnit === 'each') return null;

  const count  = Math.min(sellUnitSize, 24);
  const cols   = getPackCols(count);

  // Can sizing: larger for small packs, smaller for big ones
  const canW   = count <= 6 ? 28 : count <= 12 ? 22 : 17;
  const canH   = count <= 6 ? 42 : count <= 12 ? 34 : 26;
  const gap    = count <= 6 ? 6  : count <= 12 ? 5  : 4;

  const canColor  = sellUnit === 'case' ? '#3b82f6' : '#3d56b5';
  const canColor2 = sellUnit === 'case' ? '#1d4ed8' : '#253785';

  const totalUnits = count * casePacks;
  const depPerPack = depositPerUnit != null ? depositPerUnit * count     : null;
  const depPerCase = depositPerUnit != null ? depositPerUnit * totalUnits : null;
  const fmt$       = v => v == null ? '' : '$' + Number(v).toFixed(2);
  const packLabel  = sellUnit === 'case' ? `${count}-unit case` : `${count}-pack`;

  // Mini pack thumbnail cols (max 3 cols for readability)
  const miniCols  = Math.min(getPackCols(Math.min(count, 6)), 3);
  const miniCount = Math.min(count, 6);

  return (
    <div style={{
      borderRadius: 10, padding: '1rem 1rem 0.875rem', marginTop: '1rem',
      background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
    }}>
      {/* ── Header ── */}
      <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.875rem',
        display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: '0.9rem' }}>🥫</span>
        {sellUnit === 'case'
          ? `Case visual — ${count} units sold as one`
          : `Pack visual — ${count} cans / bottles per pack`}
      </div>

      {/* ── Can grid ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${canW}px)`,
        gap,
        justifyContent: 'center',
      }}>
        {Array.from({ length: count }, (_, i) => (
          <CanIcon
            key={`${animKey}-${i}`}
            w={canW} h={canH}
            color={canColor} color2={canColor2}
            visible={visible}
            delay={i * 0.03}
          />
        ))}
      </div>

      {/* ── Case layout (pack mode with multiple packs) ── */}
      {sellUnit === 'pack' && casePacks > 1 && (
        <div style={{ marginTop: '0.875rem' }}>
          <div style={{
            fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 6, textAlign: 'center',
          }}>
            Vendor case = {casePacks} × {count}-pack = {totalUnits} units
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
            {Array.from({ length: Math.min(casePacks, 12) }, (_, i) => {
              const isFirst = i === 0;
              return (
                <div key={i} style={{
                  border: `1px solid ${isFirst ? canColor + '80' : 'var(--border-color)'}`,
                  borderRadius: 5, padding: '4px 5px',
                  background: isFirst ? canColor + '12' : 'var(--bg-secondary)',
                  transform: visible ? 'scale(1)' : 'scale(0)',
                  transition: `transform 0.2s ease ${count * 0.03 + i * 0.04}s`,
                }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${miniCols}, 6px)`,
                    gap: 2,
                  }}>
                    {Array.from({ length: miniCount }, (_, j) => (
                      <div key={j} style={{
                        width: 6, height: 9, borderRadius: 1,
                        background: isFirst ? canColor : '#94a3b880',
                      }} />
                    ))}
                  </div>
                  {isFirst && (
                    <div style={{ fontSize: '0.5rem', textAlign: 'center', marginTop: 2,
                      color: canColor, fontWeight: 800, letterSpacing: '0.04em' }}>
                      YOU SELL
                    </div>
                  )}
                </div>
              );
            })}
            {casePacks > 12 && (
              <div style={{ display: 'flex', alignItems: 'center',
                fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                +{casePacks - 12} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Summary line ── */}
      <div style={{ marginTop: '0.75rem', textAlign: 'center', fontSize: '0.73rem', fontWeight: 700, color: canColor }}>
        {sellUnit === 'pack'
          ? `${count}-pack · ${casePacks} pack${casePacks !== 1 ? 's' : ''} per case = ${totalUnits} units total`
          : `${count}-unit case sold as one item`}
      </div>

      {/* ── Deposit breakdown ── */}
      {depositPerUnit != null && (
        <div style={{
          marginTop: '0.75rem',
          display: 'flex', gap: '0.875rem', justifyContent: 'center', flexWrap: 'wrap',
          padding: '0.5rem 0.875rem',
          background: '#06b6d40d', borderRadius: 7, border: '1px solid #06b6d428',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: '0.8rem' }}>💧</span>
            <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#06b6d4',
              textTransform: 'uppercase', letterSpacing: '0.06em' }}>Deposit</span>
          </div>
          {[
            ['Per unit',              fmt$(depositPerUnit)],
            [`Per ${packLabel}`,      fmt$(depPerPack)],
            [`Per case (${totalUnits})`, fmt$(depPerCase)],
          ].map(([label, val]) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.57rem', color: '#06b6d4', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)' }}>{val}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared micro-styles — moved to ProductForm.css (pf-label, pf-card, etc.)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Main ProductForm page
// ─────────────────────────────────────────────────────────────────────────────


/**
 * ProductFormModal — props (Session 39 Round 3):
 *   productId  — optional; when supplied, loads the product for edit
 *   onClose    — called when user cancels / saves / duplicates
 *   onSaved    — optional callback with the saved product (for parent refresh)
 */
export default function ProductFormModal({ productId, scannedUpc, onClose, onSaved }) {
  const confirm = useConfirm();
  const id = productId;
  // Router hooks replaced with a navigate() stub that resolves to onClose()
  // for every /portal/catalog* destination (which = "leave the form").
  const navigate = (path) => {
    // When duplicateProduct returns a new id, the portal does
    //   navigate('/portal/catalog/edit/NEW_ID'); keep ourselves open on the
    //   new id instead of closing.
    if (typeof path === 'string') {
      const m = path.match(/^\/portal\/catalog\/edit\/(.+)$/);
      if (m) {
        // Defer onClose with the new id — parent can re-open
        onSaved?.({ id: m[1] });
      }
    }
    onClose?.();
  };
  const isEdit    = Boolean(id);
  const setup     = useSetupStatus();

  // Store feature flags (loaded from POS config)
  const [groceryEnabled, setGroceryEnabled] = useState(false);
  const [ecomEnabled,    setEcomEnabled]    = useState(false);

  // Load store config to check feature toggles
  useEffect(() => {
    const storeId = localStorage.getItem('activeStoreId');
    if (!storeId) return;
    getPOSConfig(storeId).then(cfg => {
      setGroceryEnabled(cfg?.groceryEnabled ?? false);
      setEcomEnabled(cfg?.ecomEnabled ?? false);
    }).catch(() => {});
  }, []);

  const [saving,      setSaving]      = useState(false);
  const [loading,     setLoading]     = useState(isEdit);
  const [departments, setDepartments] = useState([]);
  const [vendors,     setVendors]     = useState([]);
  const [groups,      setGroups]      = useState([]);
  // Store-specific tax rules — populated from the merchant's TaxRule table.
  // Falls back to the hardcoded TAX_CLASSES enum if no rules exist yet.
  const [taxRules,    setTaxRules]    = useState([]);
  const [showDeptMgr, setShowDeptMgr] = useState(false);
  const [showVendMgr, setShowVendMgr] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  // ── Pack Configuration ───────────────────────────────────────────────────────
  const [packEnabled, setPackEnabled] = useState(false);
  const [packRows,    setPackRows]    = useState([
    { id: 'new-0', label: 'Single', unitPack: '1', packsPerCase: '', packPrice: '', isDefault: true },
  ]);

  // ── Bottle Deposit ───────────────────────────────────────────────────────────
  const [caseDeposit,    setCaseDeposit]    = useState('');
  const depositEnabled = parseFloat(caseDeposit) > 0;

  // ── Vendor / Order fields ────────────────────────────────────────────────────
  const [reorderQty,  setReorderQty]  = useState('');
  const [defaultUnitPack,    setDefaultUnitPack]    = useState('1');
  const [defaultPacksPerCase,setDefaultPacksPerCase] = useState('');

  // ── Per-store Qty on Hand ────────────────────────────────────────────────────
  const [storeQty,    setStoreQty]    = useState({}); // { [storeId]: string }
  const [stats52w,    setStats52w]    = useState(null); // { weeklyHigh, weeklyLow, suggestedQoH, ... }

  // ── Product UPCs ─────────────────────────────────────────────────────────────
  const [upcs,        setUpcs]        = useState([]);
  const [newUpc,      setNewUpc]      = useState('');
  const [newUpcLabel, setNewUpcLabel] = useState('');
  const [upcSaving,   setUpcSaving]   = useState(false);

  // ── Deals ─────────────────────────────────────────────────────────────────────
  const [deals,       setDeals]       = useState([]);
  const [dealForm,    setDealForm]    = useState(null);
  const [editDealIdx, setEditDealIdx] = useState(null);

  // ── Session 4 — Department-scoped attribute definitions ──────────────────────
  // `deptAttrs` is the schema (label/type/options) for the current dept.
  // `form.attributes` is the key-value bucket storing both typed + freeform.
  const [deptAttrs, setDeptAttrs] = useState([]);
  const [newAttrKey, setNewAttrKey] = useState('');
  const [newAttrVal, setNewAttrVal] = useState('');

  // ── Core form ────────────────────────────────────────────────────────────────
  const blank = {
    name: '', brand: '', upc: '', description: '',
    productGroupId: '', imageUrl: '',
    departmentId: '', vendorId: '', itemCode: '',
    // Session 40 Phase 1 — strict-FK tax linkage. `taxRuleId` is authoritative
    // when set; `taxClass` stays as legacy fallback for backward compat.
    taxRuleId: '',
    taxClass: 'grocery', taxable: true,
    defaultCasePrice: '', defaultCostPrice: '', defaultRetailPrice: '',
    ebtEligible: false, ageRequired: '', discountEligible: true,
    byWeight: false, byUnit: true, active: true,
    size: '', sizeUnit: 'oz',
    // Grocery / Scale (plu gated on store.pos.groceryEnabled)
    plu: '',
    wicEligible: false, tareWeight: '', scaleByCount: false,
    scalePluType: '', ingredients: '', nutritionFacts: '',
    certCode: '', labelFormatId: '',
    // Deposits
    depositPerUnit: '', caseDeposit: '',
    // E-commerce extended (ecomSummary field removed — merged into ecomDescription)
    ecomExternalId: '', ecomPackWeight: '',
    ecomPrice: '', ecomSalePrice: '', ecomOnSale: false,
    ecomDescription: '',
    // Shipping package (imperial: lbs + inches). Ship weight replaces the old
    // "physical weight" field (same column, clearer label).
    weight: '',
    shipLengthIn: '', shipWidthIn: '', shipHeightIn: '',
    // Inventory
    reorderPoint: '', reorderQty: '',
    trackInventory: true,
    // Invoice cost-sync lock — mirrors portal ProductForm. When true, invoice
    // imports leave defaultCasePrice untouched (manual cost wins).
    lockManualCaseCost: false,
    // Session 4 — department-scoped + freeform attributes bucket
    attributes: {},
  };

  // Session 39 — if opened with a scannedUpc (cashier-app scan-not-found),
  // pre-fill the UPC so the cashier doesn't have to re-type it.
  const initialForm = scannedUpc ? { ...blank, upc: scannedUpc } : blank;
  const [form, setForm] = useState(initialForm);
  // Dirty-state tracking: flip on first user edit, clear on save/load.
  const [dirty, setDirty] = useState(false);
  const setF = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setDirty(true);
  };

  // Warn user before leaving with unsaved changes (browser close, refresh, tab close).
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = ''; // Required for Chrome to show the prompt
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ── Load support data ────────────────────────────────────────────────────────
  const loadSupport = useCallback(async () => {
    try {
      const [d, v, g, tr] = await Promise.all([
        getCatalogDepartments(),
        getCatalogVendors(),
        listProductGroups({ active: 'true' }).catch(() => ({ data: [] })),
        getCatalogTaxRules().catch(() => ({ data: [] })),
      ]);
      const taxList = Array.isArray(tr) ? tr : (tr?.data ?? tr?.taxRules ?? []);
      setTaxRules(taxList);
      setDepartments((d?.data || d) ?? []);
      setVendors((v?.data || v) ?? []);
      setGroups((g?.data || g) ?? []);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadSupport(); }, []);

  // ── Load existing product ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const [res, promoRes, upcRes, sizeRes] = await Promise.all([
          getCatalogProduct(id),
          getCatalogPromotions({ masterProductId: id }).catch(() => null),
          getProductUpcs(id).catch(() => ({ data: [] })),
          getProductPackSizes(id).catch(() => ({ data: [] })),
        ]);
        const p = res?.data || res;
        setForm({
          name:               p.name              ?? '',
          brand:              p.brand             ?? '',
          upc:                p.upc               ?? '',
          description:        p.description       ?? '',
          productGroupId:     p.productGroupId != null ? String(p.productGroupId) : '',
          imageUrl:           p.imageUrl           ?? '',
          departmentId:       p.departmentId      ?? '',
          vendorId:           p.vendorId          ?? '',
          itemCode:           p.itemCode          ?? '',
          // Strict-FK tax linkage — load both so stale-rule warnings work
          taxRuleId:          p.taxRuleId != null ? String(p.taxRuleId) : '',
          taxClass:           p.taxClass          ?? 'grocery',
          taxable:            p.taxable           ?? true,
          defaultCasePrice:   p.defaultCasePrice  != null ? Number(p.defaultCasePrice).toFixed(2)   : '',
          defaultCostPrice:   p.defaultCostPrice  != null ? Number(p.defaultCostPrice).toFixed(2)   : '',
          defaultRetailPrice: p.defaultRetailPrice!= null ? Number(p.defaultRetailPrice).toFixed(2) : '',
          ebtEligible:        p.ebtEligible       ?? false,
          ageRequired:        p.ageRequired       ?? '',
          discountEligible:   p.discountEligible  ?? true,
          byWeight:           p.byWeight          ?? false,
          byUnit:             p.byUnit            ?? true,
          active:             p.active            ?? true,
          size:               p.size              ?? '',
          sizeUnit:           p.sizeUnit          ?? 'oz',
          // Grocery / Scale (plu gated on store.pos.groceryEnabled)
          plu:                p.plu                ?? '',
          wicEligible:        p.wicEligible       ?? false,
          tareWeight:         p.tareWeight != null ? String(p.tareWeight) : '',
          scaleByCount:       p.scaleByCount      ?? false,
          scalePluType:       p.scalePluType       ?? '',
          ingredients:        p.ingredients        ?? '',
          nutritionFacts:     p.nutritionFacts     ?? '',
          certCode:           p.certCode           ?? '',
          labelFormatId:      p.labelFormatId      ?? '',
          // Deposits
          depositPerUnit:     p.depositPerUnit != null ? String(p.depositPerUnit) : '',
          caseDeposit:        p.caseDeposit != null ? String(p.caseDeposit) : '',
          // E-commerce extended
          ecomExternalId:     p.ecomExternalId     ?? '',
          ecomPackWeight:     p.ecomPackWeight != null ? String(p.ecomPackWeight) : '',
          ecomPrice:          p.ecomPrice != null ? String(p.ecomPrice) : '',
          ecomSalePrice:      p.ecomSalePrice != null ? String(p.ecomSalePrice) : '',
          ecomOnSale:         p.ecomOnSale         ?? false,
          ecomDescription:    p.ecomDescription    ?? '',
          // Shipping package (imperial: lbs + inches) — Session 40 Item 32
          weight:             p.weight != null ? String(p.weight) : '',
          shipLengthIn:       p.shipLengthIn != null ? String(p.shipLengthIn) : '',
          shipWidthIn:        p.shipWidthIn  != null ? String(p.shipWidthIn)  : '',
          shipHeightIn:       p.shipHeightIn != null ? String(p.shipHeightIn) : '',
          // Inventory
          reorderPoint:       p.reorderPoint != null ? String(p.reorderPoint) : '',
          reorderQty:         p.reorderQty != null ? String(p.reorderQty) : '',
          trackInventory:     p.trackInventory ?? true,
          lockManualCaseCost: p.lockManualCaseCost ?? false,
          // Session 4 attributes bucket (keeps all typed + unknown values)
          attributes:         (p.attributes && typeof p.attributes === 'object') ? p.attributes : {},
        });

        if (p.caseDeposit) {
          setCaseDeposit(Number(p.caseDeposit).toFixed(2));
        }

        if (p.reorderQty != null) setReorderQty(String(p.reorderQty));

        setUpcs(upcRes?.data ?? []);

        const sizes = sizeRes?.data ?? [];
        if (sizes.length > 0) {
          setPackEnabled(true);
          setPackRows(sizes.map(s => ({
            id:          s.id,
            label:       s.label ?? '',
            unitPack:    String(s.unitCount ?? 1),
            packsPerCase: s.packsPerCase ? String(s.packsPerCase) : '',
            packPrice:   s.retailPrice != null ? Number(s.retailPrice).toFixed(2) : '',
            isDefault:   s.isDefault ?? false,
          })));
        }

        // Populate base pricing unit/pack. Preference order:
        //   1. MasterProduct.unitPack / packInCase (the v2 simplified fields,
        //      used by bulk import and the API cost update pipeline)
        //   2. The default ProductPackSize entry (legacy, only present if
        //      the user created pack rows manually)
        // This ensures imported products show their pack config correctly.
        // eslint-disable-next-line no-console
        console.log('[ProductForm] loaded pack fields → unitPack:', p.unitPack, '| packInCase:', p.packInCase, '| defaultCasePrice:', p.defaultCasePrice);
        if (p.unitPack != null) {
          setDefaultUnitPack(String(p.unitPack));
        }
        if (p.packInCase != null) {
          setDefaultPacksPerCase(String(p.packInCase));
        }
        const defaultSize = sizes.find(s => s.isDefault) || sizes[0];
        if (defaultSize) {
          if (p.unitPack == null && defaultSize.unitCount) {
            setDefaultUnitPack(String(defaultSize.unitCount));
          }
          if (p.packInCase == null && defaultSize.packsPerCase) {
            setDefaultPacksPerCase(String(defaultSize.packsPerCase));
          }
        }

        const promoData = promoRes?.data || [];
        if (Array.isArray(promoData) && promoData.length) {
          setDeals(promoData.map(pr => ({
            id:        pr.id,
            name:      pr.name || '',
            type:      pr.rebateType || 'percent_off',
            value:     pr.rebateAmount != null ? String(pr.rebateAmount) : '',
            minQty:    pr.minQtyPerMonth || 1,
            getQty:    1,
            startDate: pr.startDate ? pr.startDate.slice(0, 10) : '',
            endDate:   pr.endDate   ? pr.endDate.slice(0, 10)   : '',
            active:    pr.active ?? true,
          })));
        }
        // Loaded cleanly from server — reset dirty flag so the unsaved-changes
        // guard doesn't fire on the initial render pass.
        setDirty(false);
      } catch { toast.error('Failed to load product'); }
      finally  { setLoading(false); }
    })();
  }, [id]);

  // ── Load 52-week stats when we have a UPC ────────────────────────────────────
  useEffect(() => {
    if (!isEdit) return;
    const upc = form.upc;
    if (!upc) return;
    setStats52w(null);
    getProduct52WeekStats({ upc })
      .then(data => setStats52w(data))
      .catch(() => setStats52w(null));
  }, [isEdit, form.upc]);

  // ── Load duplicate template (when creating a new product from a copy) ───────
  useEffect(() => {
    if (isEdit) return;
    const raw = sessionStorage.getItem('pf_duplicate_template');
    if (!raw) return;
    try {
      const t = JSON.parse(raw);
      sessionStorage.removeItem('pf_duplicate_template');
      setForm(f => ({
        ...f,
        name:               t.name || '',
        brand:              t.brand || '',
        upc:                '',  // always empty for duplicates
        description:        t.description || '',
        productGroupId:     t.productGroupId != null ? String(t.productGroupId) : '',
        departmentId:       t.departmentId != null ? String(t.departmentId) : '',
        vendorId:           t.vendorId != null ? String(t.vendorId) : '',
        itemCode:           t.itemCode || '',
        taxClass:           t.taxClass || f.taxClass,
        taxable:            t.taxable ?? true,
        defaultCasePrice:   t.defaultCasePrice != null ? String(t.defaultCasePrice) : '',
        defaultCostPrice:   t.defaultCostPrice != null ? String(t.defaultCostPrice) : '',
        defaultRetailPrice: t.defaultRetailPrice != null ? String(t.defaultRetailPrice) : '',
        ebtEligible:        t.ebtEligible ?? false,
        ageRequired:        t.ageRequired != null ? String(t.ageRequired) : '',
        discountEligible:   t.discountEligible ?? true,
        byWeight:           t.byWeight ?? false,
        byUnit:             t.byUnit ?? true,
        size:               t.size || '',
        sizeUnit:           t.sizeUnit || f.sizeUnit,
        active:             t.active ?? true,
      }));
      if (t.caseDeposit != null) setCaseDeposit(String(t.caseDeposit));
      toast.info('Pre-filled from duplicated product — enter a new UPC');
    } catch {}
  }, [isEdit]);

  // ── Load per-store Qty on Hand ───────────────────────────────────────────────
  // Use storeCount + loading as stable deps to avoid array reference churn
  useEffect(() => {
    if (!isEdit || !id || setup.loading || !setup.stores?.length) return;
    const stores = setup.stores;
    (async () => {
      const qtyMap = {};
      await Promise.all(
        stores.map(async store => {
          try {
            const invRes = await getStoreInventory({ masterProductId: id, storeId: store.id });
            const items = invRes?.data ?? [];
            const inv = Array.isArray(items) ? items[0] : items;
            if (inv?.quantityOnHand != null) {
              qtyMap[store.id] = String(Number(inv.quantityOnHand));
            }
          } catch {}
        })
      );
      // eslint-disable-next-line no-console
      console.log('[ProductForm] loaded storeQty:', JSON.stringify(qtyMap), '| stores checked:', stores.length);
      setStoreQty(qtyMap);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, id, setup.loading, setup.storeCount]);

  // ── Session 4: load dept-scoped attribute definitions when dept changes ──────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!form.departmentId) { setDeptAttrs([]); return; }
      try {
        const res = await getDepartmentAttributes({ departmentId: form.departmentId });
        if (!cancelled) setDeptAttrs(res?.data ?? []);
      } catch {
        if (!cancelled) setDeptAttrs([]);
      }
    })();
    return () => { cancelled = true; };
  }, [form.departmentId]);

  // ── Derived pricing ──────────────────────────────────────────────────────────
  const caseCostVal  = parseFloat(form.defaultCasePrice)   || null;
  const retailVal    = parseFloat(form.defaultRetailPrice) || null;

  // Unit cost: always derived from Case Cost ÷ Packs or Case Size ÷ Unit-Pack
  const ppcVal       = parseFloat(defaultPacksPerCase) || null;
  const upVal        = parseFloat(defaultUnitPack)     || 1;
  const unitCostVal  = caseCostVal && ppcVal ? caseCostVal / ppcVal / upVal : null;

  const margin       = calcMargin(unitCostVal, retailVal);
  const mColor       = marginColor(margin);
  const upcWarning   = form.upc && !isValidUPC(form.upc) ? 'UPC must be 2–14 numeric digits' : null;
  const priceWarning = unitCostVal && retailVal && retailVal < unitCostVal ? 'Retail price is below cost' : null;

  // ── Dept auto-fill ───────────────────────────────────────────────────────────
  const handleDeptChange = (deptId) => {
    setF('departmentId', deptId);
    const dept = departments.find(d => d.id === parseInt(deptId));
    if (dept) {
      if (dept.taxClass)    setF('taxClass',    dept.taxClass);
      if (dept.ebtEligible) setF('ebtEligible', true);
      if (dept.ageRequired) setF('ageRequired', String(dept.ageRequired));
    }
  };

  // ── Product Group auto-fill ──────────────────────────────────────────────────
  // Selecting a group cascades template fields to the form. User can still override.
  const handleGroupChange = (groupId) => {
    setF('productGroupId', groupId);
    if (!groupId) return;
    const group = groups.find(g => String(g.id) === String(groupId));
    if (!group) return;

    // Cascade all non-null template fields
    setForm(f => ({
      ...f,
      departmentId:       group.departmentId != null ? String(group.departmentId) : f.departmentId,
      vendorId:           group.vendorId != null ? String(group.vendorId) : f.vendorId,
      taxClass:           group.taxClass ?? f.taxClass,
      ageRequired:        group.ageRequired != null ? String(group.ageRequired) : f.ageRequired,
      ebtEligible:        group.ebtEligible ?? f.ebtEligible,
      discountEligible:   group.discountEligible ?? f.discountEligible,
      taxable:            group.taxable ?? f.taxable,
      size:               group.size ?? f.size,
      sizeUnit:           group.sizeUnit ?? f.sizeUnit,
      defaultCostPrice:   group.defaultCostPrice != null ? String(group.defaultCostPrice) : f.defaultCostPrice,
      defaultRetailPrice: group.defaultRetailPrice != null ? String(group.defaultRetailPrice) : f.defaultRetailPrice,
      defaultCasePrice:   group.defaultCasePrice != null ? String(group.defaultCasePrice) : f.defaultCasePrice,
    }));
    toast.info(`Applied template from "${group.name}"`);
  };

  // ── Duplicate product ────────────────────────────────────────────────────────
  const handleDuplicate = async () => {
    if (!isEdit || !id) return;
    setDuplicating(true);
    try {
      const res = await duplicateCatalogProduct(id);
      const template = res?.data || res;
      // Store the template in sessionStorage so the new form can pick it up
      sessionStorage.setItem('pf_duplicate_template', JSON.stringify(template));
      toast.success('Ready to create duplicate — UPC is empty');
      navigate('/portal/catalog/new');
    } catch (e) {
      toast.error('Duplicate failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setDuplicating(false);
    }
  };

  // ── Pack row handlers ────────────────────────────────────────────────────────
  const addPackRow = () => {
    const newId = 'new-' + Date.now();
    setPackRows(rows => [...rows, { id: newId, label: '', unitPack: '1', packsPerCase: '', packPrice: '', isDefault: false }]);
  };

  const updatePackRow = (idx, field, value) => {
    setPackRows(rows => rows.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const removePackRow = (idx) => {
    setPackRows(rows => {
      const next = rows.filter((_, i) => i !== idx);
      if (next.length > 0 && !next.some(r => r.isDefault)) next[0] = { ...next[0], isDefault: true };
      return next;
    });
  };

  const setPackDefault = (idx) => {
    setPackRows(rows => rows.map((r, i) => ({ ...r, isDefault: i === idx })));
  };

  // ── Deal handlers ────────────────────────────────────────────────────────────
  const openDealForm = (idx) => {
    if (idx === null) { setDealForm({ ...DEAL_BLANK }); setEditDealIdx(null); }
    else { setDealForm({ ...deals[idx] }); setEditDealIdx(idx); }
  };

  const saveDealLocal = () => {
    if (!dealForm.value && dealForm.type !== 'bogo') { toast.error('Enter a deal value'); return; }
    if (editDealIdx !== null) setDeals(ds => ds.map((d, i) => i === editDealIdx ? { ...dealForm } : d));
    else setDeals(ds => [...ds, { ...dealForm }]);
    setDealForm(null); setEditDealIdx(null);
  };

  const removeDeal = (idx) => setDeals(ds => ds.filter((_, i) => i !== idx));

  // ── UPC handlers ─────────────────────────────────────────────────────────────
  const handleAddUpc = async () => {
    if (!newUpc.trim()) return;
    if (!isEdit) { toast.error('Save the product first before adding extra UPCs'); return; }
    setUpcSaving(true);
    try {
      const res = await addProductUpc(id, { upc: newUpc.trim(), label: newUpcLabel.trim() || null, isDefault: upcs.length === 0 });
      setUpcs(u => [...u, res.data]);
      setNewUpc(''); setNewUpcLabel('');
      toast.success('UPC added');
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to add UPC'); }
    finally { setUpcSaving(false); }
  };

  const handleDeleteUpc = async (upcId) => {
    try {
      await deleteProductUpc(id, upcId);
      setUpcs(u => u.filter(x => x.id !== upcId));
    } catch { toast.error('Failed to remove UPC'); }
  };

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim())  { toast.error('Product name is required'); return; }
    if (!form.departmentId) { toast.error('Department is required');   return; }
    if (upcWarning)         { toast.error(upcWarning);                 return; }

    // Pack-size validation: when pack pricing is enabled, every row must
    // have a positive unit count and a non-zero price. Silently coercing to
    // 1 (as the old code did) produced phantom pack sizes on save.
    if (packEnabled && packRows.length > 0) {
      for (let i = 0; i < packRows.length; i++) {
        const r = packRows[i];
        const units = parseInt(r.unitPack, 10);
        const price = parseFloat(r.packPrice);
        if (!Number.isFinite(units) || units < 1) {
          toast.error(`Pack size #${i + 1}: "Unit-Pack" must be at least 1`);
          return;
        }
        if (!Number.isFinite(price) || price <= 0) {
          toast.error(`Pack size #${i + 1}: price must be greater than $0.00`);
          return;
        }
      }
      // Exactly one default row, if any row is marked default.
      const defaults = packRows.filter(r => r.isDefault).length;
      if (defaults > 1) { toast.error('Only one pack size can be marked as default'); return; }
    }

    let derivedRetailPrice = form.defaultRetailPrice || null;
    if (packEnabled && packRows.length > 0) {
      const defaultRow = packRows.find(r => r.isDefault) || packRows[0];
      if (defaultRow?.packPrice) derivedRetailPrice = defaultRow.packPrice;
    }

    setSaving(true);
    try {
      const payload = {
        name:               form.name,
        brand:              form.brand            || null,
        upc:                form.upc              || null,
        description:        form.description      || null,
        imageUrl:           form.imageUrl         || null,
        productGroupId:     form.productGroupId   ? parseInt(form.productGroupId) : null,
        departmentId:       form.departmentId     ? parseInt(form.departmentId) : null,
        vendorId:           form.vendorId         ? parseInt(form.vendorId)     : null,
        itemCode:           form.itemCode         || null,
        // Session 56b — `taxRuleId` is the per-product tax-matching FK.
        // `taxClass` is no longer a tax matcher; it persists only as an
        // age-policy hint (tobacco/alcohol detection at checkout).
        taxRuleId:          form.taxRuleId ? parseInt(form.taxRuleId) : null,
        taxClass:           form.taxClass,
        taxable:            form.taxable,
        defaultCasePrice:   form.defaultCasePrice || null,
        defaultCostPrice:   unitCostVal != null ? unitCostVal : (form.defaultCostPrice || null),
        defaultRetailPrice: derivedRetailPrice    || null,
        // Persist the simplified pack config (v2) so imports + the form stay in sync
        unitPack:           defaultUnitPack       ? parseInt(defaultUnitPack) : null,
        packInCase:         defaultPacksPerCase   ? parseInt(defaultPacksPerCase) : null,
        // Mirror of the portal ProductForm fix — derive per-unit deposit
        // from the case total at save time so the cashier catalog snapshot
        // (which reads `depositPerUnit`) correctly shows a bottle deposit
        // line on the cart. Without this, products created from the cashier
        // with only a case deposit entered would show $0 deposit at POS.
        depositPerUnit:     (() => {
          const explicit = parseFloat(form.depositPerUnit);
          if (explicit > 0) return explicit;
          const cd  = parseFloat(caseDeposit);
          const up  = parseFloat(defaultUnitPack) || 1;
          const ppc = parseFloat(defaultPacksPerCase);
          if (cd > 0 && up > 0 && ppc > 0) {
            return Math.round((cd / (up * ppc)) * 10000) / 10000;
          }
          return null;
        })(),
        caseDeposit:        caseDeposit ? parseFloat(caseDeposit) : null,
        reorderQty:         reorderQty ? parseInt(reorderQty) : null,
        ebtEligible:        form.ebtEligible,
        ageRequired:        form.ageRequired      ? parseInt(form.ageRequired) : null,
        discountEligible:   form.discountEligible,
        byWeight:           form.byWeight,
        byUnit:             form.byUnit,
        size:               form.size             || null,
        sizeUnit:           form.sizeUnit         || null,
        // Grocery: PLU only sent when grocery is enabled on the active store.
        plu:                groceryEnabled ? (form.plu || null) : null,
        // Inventory tracking toggle (deduct on sale; off for service / manual items)
        trackInventory:     form.trackInventory,
        lockManualCaseCost: !!form.lockManualCaseCost,
        // E-Commerce extended — Session 40 Item 55/56 merge (ecomSummary removed)
        ecomPrice:          form.ecomPrice         || null,
        ecomSalePrice:      form.ecomSalePrice     || null,
        ecomOnSale:         !!form.ecomOnSale,
        ecomExternalId:     form.ecomExternalId    || null,
        ecomPackWeight:     form.ecomPackWeight    || null,
        ecomDescription:    form.ecomDescription   || null,
        hideFromEcom:       !!form.hideFromEcom,
        // Shipping package (imperial: lbs + inches) — Session 40 Item 32
        weight:             form.weight            || null,
        shipLengthIn:       form.shipLengthIn      || null,
        shipWidthIn:        form.shipWidthIn       || null,
        shipHeightIn:       form.shipHeightIn      || null,
        attributes:         form.attributes       || {},
        active:             form.active,
      };

      let productId;
      if (isEdit) {
        await updateCatalogProduct(id, payload);
        productId = parseInt(id);
        toast.success('Product updated');
      } else {
        const result = await createCatalogProduct(payload);
        productId = result?.data?.id ?? result?.id;
        if (productId && setup.stores?.length > 0) {
          await Promise.all(
            setup.stores.map(store =>
              upsertStoreInventory({ masterProductId: productId, storeId: store.id }).catch(() => {})
            )
          );
          const storeWord = setup.stores.length === 1 ? 'your store' : `all ${setup.stores.length} stores`;
          toast.success(`Product added and available at ${storeWord}`);
        } else {
          toast.success('Product added to catalog');
        }
      }

      if (productId) {
        const sizes = packEnabled
          ? packRows.map((r, i) => ({
              label:       r.label || `Pack ${i + 1}`,
              unitCount:   parseInt(r.unitPack) || 1,
              packsPerCase: r.packsPerCase ? parseInt(r.packsPerCase) : null,
              retailPrice:  parseFloat(r.packPrice) || 0,
              isDefault:   r.isDefault,
              sortOrder:   i,
            }))
          : [];
        await bulkReplaceProductPackSizes(productId, sizes).catch(() => {});
      }

      // Save per-store Qty on Hand
      const storeQtyEntries = Object.entries(storeQty).filter(([, q]) => q !== '' && !isNaN(parseFloat(q)));
      if (productId && storeQtyEntries.length > 0) {
        await Promise.all(
          storeQtyEntries.map(([storeId, qty]) =>
            upsertStoreInventory({
              masterProductId: productId,
              storeId,
              quantityOnHand: parseFloat(qty),
            }).catch(() => {})
          )
        );
      }

      if (productId && deals.length > 0) {
        const newDeals = deals.filter(d => !d.id);
        await Promise.all(newDeals.map(d =>
          createCatalogPromotion({
            name:            d.name || `${DEAL_TYPES.find(t => t.value === d.type)?.label} deal`,
            masterProductId: productId,
            rebateType:      d.type,
            rebateAmount:    parseFloat(d.value) || 0,
            minQtyPerMonth:  d.minQty || null,
            startDate:       d.startDate || null,
            endDate:         d.endDate   || null,
            active:          d.active,
          }).catch(() => {})
        ));
      }

      setDirty(false); // clear unsaved-changes flag BEFORE close
      // Session 39 — give the parent the saved product so it can (e.g.)
      // add it straight to the cart after save from a scan-not-found flow.
      if (!isEdit && productId && onSaved) {
        try {
          const created = await getCatalogProduct(productId);
          onSaved(created?.data || created);
        } catch { onSaved({ id: productId, ...payload }); }
      } else if (onSaved) {
        onSaved({ id: productId, ...payload });
      }
      onClose?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  // Guarded cancel — ask before discarding unsaved edits.
  const handleCancel = async () => {
    if (dirty) {
      const ok = await confirm({
        title: 'Discard unsaved changes?',
        message: 'Your edits will be lost.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        danger: true,
      });
      if (!ok) return;
    }
    onClose?.();
  };

  // ── Loading state ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-page pf-main">
        <div className="pf-loading">Loading…</div>
      </div>
    );
  }

  const selDept = departments.find(d => d.id === parseInt(form.departmentId));

  return (
    // Session 39 — modal shell wrapping the verbatim ProductForm body.
    <div className="pfm-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleCancel(); }}>
      <div className="pfm-modal" onClick={(e) => e.stopPropagation()}>
      <div className="p-page pf-main">
        <form onSubmit={handleSave} className="pf-form">

          {/* ── Top Bar ── */}
          <div className="pf-topbar-inner">
            <button type="button" onClick={handleCancel} className="pf-topbar-back">
              <ChevronLeft size={16} /> Catalog
            </button>
            <h1 className="pf-topbar-title">
              {isEdit ? `Edit Product — ${form.name || '…'}` : 'Add New Product'}
            </h1>
            <div className="pf-topbar-actions">
              {isEdit && (
                <button type="button" onClick={handleDuplicate} disabled={duplicating || saving} className="pf-btn-secondary" title="Create a copy of this product">
                  <Copy size={14} /> {duplicating ? 'Loading…' : 'Duplicate'}
                </button>
              )}
              <button type="button" onClick={handleCancel} className="pf-btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="pf-btn-primary">
                <Save size={14} /> {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Product'}
              </button>
            </div>
          </div>

          {/* ── No-store banner ── */}
          {(!setup.loading && !setup.hasStores) && (
            <div className="pf-banner-wrap">
              <NoStoreBanner onGoToStores={() => navigate('/portal/stores')} />
            </div>
          )}

          {/* ── Body ── */}
          <div className="pf-body">

            {/* ══ LEFT COLUMN ══════════════════════════════════════════════════ */}
            <div>

              {/* ── 0. Product Image ── */}
              <div className="pf-card pf-image-card">
                <div className="pf-section-title"><Image size={14} /> Product Image</div>
                <div className="pf-image-body">
                  <div className="pf-image-preview">
                    {form.imageUrl ? (
                      <img src={form.imageUrl} alt="Product" className="pf-image-thumb"
                        onError={e => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div className="pf-image-empty">
                        <Image size={32} />
                        <span>No image</span>
                      </div>
                    )}
                  </div>
                  <div className="pf-image-controls">
                    <div className="pf-image-url-row">
                      <Link2 size={14} />
                      <input className="form-input pf-full" value={form.imageUrl}
                        onChange={e => setF('imageUrl', e.target.value)}
                        placeholder="https://example.com/product.jpg" />
                    </div>
                    {isEdit && (
                      <label className="pf-image-upload-btn">
                        <Upload size={14} /> Upload Image
                        <input type="file" accept="image/*" hidden
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 5 * 1024 * 1024) { toast.error('Max 5MB'); return; }
                            try {
                              const res = await uploadProductImage(id, file);
                              setF('imageUrl', res.imageUrl);
                              toast.success('Image uploaded');
                            } catch (err) {
                              toast.error(err.response?.data?.error || 'Upload failed');
                            }
                          }} />
                      </label>
                    )}
                    {form.imageUrl && (
                      <button type="button" className="pf-image-remove" onClick={() => setF('imageUrl', '')}>
                        <Trash2 size={13} /> Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── 1. Product Info (2-col: UPC+Name | Department+Tax) ── */}
              <div className="pf-card">
                <div className="pf-section-title">Product Info</div>
                <div className="pf-product-info-grid">

                  {/* Left: Name + size/brand (UPC moved to unified Barcodes card below) */}
                  <div>
                    <div>
                      <label className="pf-label">Product Name *</label>
                      <input className="form-input pf-full pf-input-bold"
                        value={form.name} onChange={e => setF('name', e.target.value)}
                        placeholder="e.g. Bud Light 12oz Can" required />
                      {form.name.trim().length > 0 && form.name.trim().length < 3 && (
                        <div className="pf-warn">
                          <AlertCircle size={10} /> Name should be at least 3 characters
                        </div>
                      )}
                    </div>
                    {/* Size + Unit + Brand — compact row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                      <div>
                        <label className="pf-label">Size</label>
                        <input className="form-input pf-full" value={form.size}
                          onChange={e => setF('size', e.target.value)} placeholder="12" />
                      </div>
                      <div>
                        <label className="pf-label">Unit</label>
                        <select className="form-input pf-full" value={form.sizeUnit}
                          onChange={e => setF('sizeUnit', e.target.value)}>
                          {['oz','fl oz','ml','L','gal','lb','g','kg','ct','each','pk'].map(u =>
                            <option key={u} value={u}>{u}</option>
                          )}
                        </select>
                      </div>
                      <div>
                        <label className="pf-label">Brand</label>
                        <input className="form-input pf-full" value={form.brand}
                          onChange={e => setF('brand', e.target.value)} placeholder="Brand name" />
                      </div>
                    </div>
                  </div>

                  {/* Right: Group + Department + Tax Class */}
                  <div>
                    {/* Product Group picker — applies template */}
                    <div className="pf-row">
                      <div className="pf-label-row">
                        <label className="pf-label">
                          <UsersIcon size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                          Product Group
                        </label>
                        <button type="button" onClick={() => navigate('/portal/product-groups')} className="pf-manage-link">
                          <Settings size={10} /> Manage
                        </button>
                      </div>
                      <select className="form-input pf-full"
                        value={form.productGroupId} onChange={e => handleGroupChange(e.target.value)}>
                        <option value="">— No group —</option>
                        {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                      {form.productGroupId && (
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 3 }}>
                          Template applied. Changing group fields cascades to all members.
                        </div>
                      )}
                    </div>

                    <div className="pf-row">
                      <div className="pf-label-row">
                        <label className="pf-label">Department *</label>
                        <button type="button" onClick={() => setShowDeptMgr(true)} className="pf-manage-link">
                          <Settings size={10} /> Manage
                        </button>
                      </div>
                      <select className="form-input pf-full"
                        value={form.departmentId} onChange={e => handleDeptChange(e.target.value)}>
                        <option value="">— No department —</option>
                        {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>

                    {/* Session 56b — Tax Rule dropdown. Values are rule.id
                        (stable across renames / rate changes). The default
                        option means "no per-product override" — at checkout
                        the cart resolves via the product's department-linked
                        rule. */}
                    <div>
                      <label className="pf-label">
                        Tax Rule
                        <Link to="/portal/tax-rules" className="pf-manage-link" style={{ marginLeft: 8 }}>
                          <Settings size={10} /> Manage
                        </Link>
                      </label>
                      <select className="form-input pf-full"
                        value={form.taxRuleId ? String(form.taxRuleId) : ''}
                        onChange={e => setF('taxRuleId', e.target.value || '')}>
                        <option value="">— Use department default —</option>
                        {taxRules.length > 0 && taxRules
                          .filter(r => r.active !== false)
                          .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                          .map(r => {
                            const pct = r.rate != null ? `${(Number(r.rate) * 100).toFixed(2).replace(/\.?0+$/, '')}%` : '';
                            return (
                              <option key={r.id} value={String(r.id)}>
                                {r.name}{pct && ` — ${pct}`}
                              </option>
                            );
                          })}
                      </select>
                      {/* Stale-FK warning */}
                      {form.taxRuleId && !taxRules.some(r => String(r.id) === String(form.taxRuleId) && r.active !== false) && (
                        <div className="pf-warn" style={{ marginTop: 4 }}>
                          <AlertCircle size={10} /> This product references a tax rule that is inactive or no longer exists.
                          Pick an active rule above, or{' '}
                          <Link to="/portal/tax-rules" style={{ color: 'var(--brand-primary)' }}>re-activate it</Link>.
                        </div>
                      )}
                      {taxRules.length === 0 && (
                        <div className="pf-hint" style={{ marginTop: 4 }}>
                          <Info size={10} /> No tax rules configured —{' '}
                          <Link to="/portal/tax-rules" style={{ color: 'var(--brand-primary)' }}>set them up</Link>
                          {' '}to use strict-FK tax linking.
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </div>

              {/* ── Barcodes (primary + alternates merged into one list) ── */}
              <div className="pf-card">
                <div className="pf-upc-header">
                  <div className="pf-section-title" style={{ marginBottom: 0 }}>
                    Barcodes
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    First row is the primary. Add alternates if the product scans with multiple UPCs.
                  </span>
                </div>

                <div className="pf-upc-list" style={{ marginTop: '0.5rem' }}>
                  {/* Primary row — bound to form.upc */}
                  <div className="pf-upc-row pf-upc-row-primary">
                    <Star size={13} color="#f59e0b" fill="#f59e0b" />
                    <input
                      className={`form-input pf-input-mono${upcWarning ? ' pf-input-error' : ''}`}
                      value={form.upc}
                      onChange={e => setF('upc', e.target.value.replace(/\D/g, ''))}
                      placeholder="Primary barcode — 012345678901"
                      maxLength={14}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    {form.upc && isValidUPC(form.upc) && (
                      <span className="pf-upc-digits">
                        <Check size={9} /> {form.upc.length} digits
                      </span>
                    )}
                    <span className="pf-upc-default-badge">Primary</span>
                  </div>
                  {upcWarning && (
                    <div className="pf-warn" style={{ marginLeft: 22 }}>
                      <AlertCircle size={10} /> {upcWarning}
                    </div>
                  )}

                  {/* Alternate rows (non-default ProductUpc entries) */}
                  {upcs.filter(u => !u.isDefault).map(u => (
                    <div key={u.id} className="pf-upc-row">
                      <Barcode size={13} color="var(--text-muted)" />
                      <span className="pf-upc-code">{u.upc}</span>
                      {u.label && <span className="pf-upc-label-text">{u.label}</span>}
                      <button type="button" className="pf-upc-delete-btn"
                        onClick={() => handleDeleteUpc(u.id)} title="Remove barcode">
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add alternate (requires saved product) */}
                {isEdit ? (
                  <div className="pf-upc-add-row">
                    <input className="form-input" placeholder="Alternate barcode (digits)"
                      value={newUpc} onChange={e => setNewUpc(e.target.value.replace(/\D/g, ''))}
                      maxLength={14} style={{ fontFamily: 'monospace' }} />
                    <input className="form-input" placeholder="Label (optional)"
                      value={newUpcLabel} onChange={e => setNewUpcLabel(e.target.value)}
                      style={{ flex: 0.7 }} />
                    <button type="button" className="pf-btn-primary pf-btn-sm"
                      onClick={handleAddUpc} disabled={!newUpc || upcSaving}>
                      <Plus size={13} /> Add
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    Save the product first to add alternate barcodes.
                  </div>
                )}
              </div>

              {/* ── Session 4: Product Details — dept-scoped attributes + freeform bucket ── */}
              {(deptAttrs.length > 0 || Object.keys(form.attributes || {}).length > 0) && (
                <div className="pf-card">
                  <div className="pf-upc-header">
                    <div className="pf-section-title" style={{ marginBottom: 0 }}>Product Details</div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {deptAttrs.length > 0
                        ? 'Fields configured for this department. Leave any blank.'
                        : 'No department fields yet — add custom details below.'}
                    </span>
                  </div>

                  {/* Dept-scoped typed fields */}
                  {deptAttrs.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
                      {deptAttrs.map(attr => {
                        const val = form.attributes?.[attr.key] ?? '';
                        const setVal = (v) => setF('attributes', { ...(form.attributes || {}), [attr.key]: v });
                        const labelWithUnit = attr.unit ? `${attr.label} (${attr.unit})` : attr.label;
                        if (attr.dataType === 'dropdown') {
                          return (
                            <div key={attr.id}>
                              <label className="pf-label">{labelWithUnit}{attr.required && ' *'}</label>
                              <select className="form-input pf-full" value={val} onChange={e => setVal(e.target.value)}>
                                <option value="">— Select —</option>
                                {(attr.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                              </select>
                            </div>
                          );
                        }
                        if (attr.dataType === 'boolean') {
                          return (
                            <div key={attr.id} className="pf-sb-toggle-row" style={{ margin: 0 }}>
                              <span className="pf-toggle-label">{labelWithUnit}{attr.required && ' *'}</span>
                              <Tog value={val === true || val === 'true'} onChange={v => setVal(v)} />
                            </div>
                          );
                        }
                        const inputType = attr.dataType === 'date' ? 'date'
                          : (attr.dataType === 'integer' || attr.dataType === 'decimal') ? 'number' : 'text';
                        const step = attr.dataType === 'decimal' ? 'any' : attr.dataType === 'integer' ? '1' : undefined;
                        return (
                          <div key={attr.id}>
                            <label className="pf-label">{labelWithUnit}{attr.required && ' *'}</label>
                            <input
                              className="form-input pf-full"
                              type={inputType}
                              step={step}
                              value={val}
                              placeholder={attr.placeholder || ''}
                              onChange={e => setVal(e.target.value)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Freeform "Other Details" bucket — shows keys NOT in deptAttrs */}
                  {(() => {
                    const knownKeys = new Set(deptAttrs.map(a => a.key));
                    const extraKeys = Object.keys(form.attributes || {}).filter(k => !knownKeys.has(k));
                    if (extraKeys.length === 0) return null;
                    return (
                      <div style={{ marginTop: '1rem' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                          OTHER DETAILS
                        </div>
                        <div className="pf-upc-list">
                          {extraKeys.map(k => (
                            <div key={k} className="pf-upc-row">
                              <span style={{ fontFamily:'monospace', fontSize:'0.78rem', minWidth:110, color:'var(--text-muted)' }}>{k}</span>
                              <input
                                className="form-input"
                                style={{ flex: 1, minWidth: 0 }}
                                value={form.attributes?.[k] ?? ''}
                                onChange={e => setF('attributes', { ...(form.attributes || {}), [k]: e.target.value })}
                              />
                              <button type="button" className="pf-upc-delete-btn" title="Remove"
                                onClick={() => {
                                  const next = { ...(form.attributes || {}) };
                                  delete next[k];
                                  setF('attributes', next);
                                }}>
                                <X size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Add-freeform-attribute row */}
                  <div className="pf-upc-add-row" style={{ marginTop: '0.75rem' }}>
                    <input className="form-input" placeholder="Detail name (e.g. barrel_number)"
                      value={newAttrKey} onChange={e => setNewAttrKey(e.target.value)}
                      style={{ fontFamily: 'monospace' }} />
                    <input className="form-input" placeholder="Value"
                      value={newAttrVal} onChange={e => setNewAttrVal(e.target.value)}
                      style={{ flex: 0.7 }} />
                    <button type="button" className="pf-btn-primary pf-btn-sm"
                      disabled={!newAttrKey.trim() || !newAttrVal.trim()}
                      onClick={() => {
                        const k = newAttrKey.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
                        if (!k) return;
                        setF('attributes', { ...(form.attributes || {}), [k]: newAttrVal.trim() });
                        setNewAttrKey('');
                        setNewAttrVal('');
                      }}>
                      <Plus size={13} /> Add
                    </button>
                  </div>
                </div>
              )}

              {/* ── 2. Pricing ── */}
              <div className="pf-card">
                <div className="pf-section-title">Pricing</div>

                {/* Single row: Retail | Case Cost | Unit-Pack | Packs or Case Size | Unit Cost | Margin */}
                <div className="pf-pricing-row">

                  {/* Retail Price */}
                  <div>
                    <label className="pf-label">Retail Price</label>
                    <div className="pf-dollar-wrap">
                      <span className="pf-dollar-sign">$</span>
                      <PriceInput className={`form-input pf-dollar-input pf-retail-input${priceWarning ? ' pf-input-error' : ''}`}
                        value={form.defaultRetailPrice} placeholder="0.00"
                        onChange={(v) => setF('defaultRetailPrice', v)}
                        onBlur={e => e.target.value && setF('defaultRetailPrice', parseFloat(e.target.value).toFixed(2))} />
                    </div>
                  </div>

                  {/* Case Cost — synced with Vendor sidebar */}
                  <div>
                    <label className="pf-label pf-label-sm">Case Cost</label>
                    <div className="pf-dollar-wrap">
                      <span className="pf-dollar-sign">$</span>
                      <PriceInput className="form-input pf-dollar-input pf-compact-input"
                        value={form.defaultCasePrice} placeholder="0.00"
                        onChange={(v) => setF('defaultCasePrice', v)}
                        onBlur={e => e.target.value && setF('defaultCasePrice', parseFloat(e.target.value).toFixed(2))} />
                    </div>
                  </div>

                  {/* Unit-Pack */}
                  <div>
                    <label className="pf-label pf-label-sm">Unit-Pack</label>
                    <input className="form-input pf-compact-input pf-center-input"
                      type="number" min="1" step="1"
                      value={defaultUnitPack} placeholder="1"
                      onChange={e => setDefaultUnitPack(e.target.value || '1')} />
                  </div>

                  {/* Packs or Case Size */}
                  <div>
                    <label className="pf-label pf-label-sm">Packs or Case Size</label>
                    <input className="form-input pf-compact-input pf-center-input"
                      type="number" min="1" step="1"
                      value={defaultPacksPerCase} placeholder="—"
                      onChange={e => setDefaultPacksPerCase(e.target.value)} />
                  </div>

                  {/* Unit Cost — read-only, auto-calculated */}
                  <div>
                    <label className="pf-label pf-label-sm">Unit Cost</label>
                    <div className={`pf-unit-cost-display${unitCostVal ? '' : ' pf-unit-cost-empty'}`}>
                      {unitCostVal ? fmt$(unitCostVal) : '—'}
                    </div>
                  </div>

                  {/* Margin — inline at end */}
                  <div className="pf-margin-inline-col">
                    {margin !== null ? (
                      <span className="pf-margin-inline-pill" style={{ background: mColor+'20', color: mColor }}>
                        {fmtPct(margin)}
                      </span>
                    ) : (
                      <span className="pf-margin-inline-empty">—</span>
                    )}
                    {depositEnabled && caseDeposit && ppcVal && (
                      <span className="pf-deposit-inline">
                        <span className="pf-deposit-inline-label">dep/pk</span>
                        {fmt$(parseFloat(caseDeposit) / ppcVal)}
                      </span>
                    )}
                  </div>

                </div>

                {/* Warnings */}
                {priceWarning && (
                  <div className="pf-warn pf-mb-2">
                    <AlertCircle size={10} /> {priceWarning}
                  </div>
                )}
                {!ppcVal && caseCostVal && (
                  <div className="pf-hint pf-mb-2">
                    <Info size={10} /> Enter Packs or Case Size to auto-calculate unit cost
                  </div>
                )}

                {/* Quick-set margin */}
                <div>
                  <label className="pf-label">Quick-set margin</label>
                  <div className="pf-quick-margins">
                    {MARGIN_PRESETS.map(m => (
                      <button key={m} type="button"
                        onClick={() => {
                          const cost = unitCostVal;
                          if (!cost) { toast.error('Enter cost price first'); return; }
                          setF('defaultRetailPrice', (cost / (1 - m / 100)).toFixed(2));
                        }}
                        className="pf-margin-preset-btn"
                        style={{
                          border: Math.abs((margin||0)-m) < 0.5 ? 'none' : '1px solid var(--border-color)',
                          background: Math.abs((margin||0)-m) < 0.5 ? mColor : 'var(--bg-tertiary)',
                          color: Math.abs((margin||0)-m) < 0.5 ? '#fff' : 'var(--text-secondary)'
                        }}>
                        {m}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── 3. Pack Configuration ── */}
              <div className="pf-card">
                <div className="pf-pack-toggle-header" style={{ marginBottom: packEnabled ? '1rem' : 0 }}>
                  <div className="pf-section-title">Pack Configuration</div>
                  <Tog value={packEnabled} onChange={v => setPackEnabled(v)} />
                </div>

                {!packEnabled && (
                  <div className="pf-muted-hint">
                    Enable to sell this product in multiple sizes (Single, 6‑Pack, 12‑Pack…).
                    Cashier sees a picker modal when multiple sizes are configured.
                  </div>
                )}

                {packEnabled && (
                  <>
                    {/* Table header */}
                    <div className={`pf-pack-table-header${depositEnabled ? ' with-deposit' : ''}`}>
                      <span>Label</span>
                      <span>Retail Price</span>
                      <span>Unit-Pack</span>
                      <span>Packs or Case Size</span>
                      <span>Unit Cost</span>
                      <span>Margin</span>
                      {depositEnabled && <span>Deposit/Pack</span>}
                      <span></span>
                    </div>

                    {/* Pack rows */}
                    {packRows.map((row, idx) => {
                      const ppc       = parseInt(row.packsPerCase)  || null;
                      const up        = parseFloat(row.unitPack)    || 1;
                      const pp        = parseFloat(row.packPrice)   || null;
                      const unitCost  = caseCostVal && ppc ? caseCostVal / ppc / up : null;
                      const rowMargin = pp && unitCost ? ((pp - unitCost) / pp) * 100 : null;
                      const rowDeposit = depositEnabled && caseDeposit && ppc
                        ? parseFloat(caseDeposit) / ppc : null;
                      return (
                        <div key={row.id} className={`pf-pack-row${depositEnabled ? ' with-deposit' : ''}`}>
                          <input className="form-input pf-pack-input"
                            placeholder='e.g. "Single"'
                            value={row.label}
                            onChange={e => updatePackRow(idx, 'label', e.target.value)} />
                          <div className="pf-dollar-wrap">
                            <span className="pf-dollar-sign">$</span>
                            <PriceInput className="form-input pf-pack-input pf-dollar-input"
                              placeholder="0.00"
                              value={row.packPrice}
                              onChange={(v) => updatePackRow(idx, 'packPrice', v)} />
                          </div>
                          <input className="form-input pf-pack-input" type="number" min="1"
                            placeholder="1"
                            value={row.unitPack}
                            onChange={e => updatePackRow(idx, 'unitPack', e.target.value)} />
                          <input className="form-input pf-pack-input" type="number" min="1"
                            placeholder="—"
                            value={row.packsPerCase}
                            onChange={e => updatePackRow(idx, 'packsPerCase', e.target.value)} />
                          <div className="pf-cost-cell">
                            {unitCost != null ? fmt$(unitCost) : '—'}
                          </div>
                          <div className="pf-margin-badge" style={{ color: marginColor(rowMargin) }}>
                            {rowMargin != null ? fmtPct(rowMargin) : '—'}
                          </div>
                          {depositEnabled && (
                            <div className="pf-pack-deposit-cell">
                              {rowDeposit != null ? `$${rowDeposit.toFixed(3)}` : '—'}
                            </div>
                          )}
                          <button type="button" className="pf-pack-delete-btn"
                            onClick={() => removePackRow(idx)}
                            disabled={packRows.length === 1}
                            title="Remove row">
                            <X size={13} />
                          </button>
                        </div>
                      );
                    })}

                    <button type="button" className="pf-pack-add-btn" onClick={addPackRow}>
                      <Plus size={13} /> Add Pack Size
                    </button>

                    {packRows.length > 0 && (
                      <p className="pf-hint">
                        <Info size={11} /> {packRows.length} size{packRows.length > 1 ? 's' : ''} configured — cashier sees a picker modal on scan
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* ── 4. Store Deals & Offers ── */}
              <div className="pf-card">
                <div className="pf-deals-header">
                  <div className="pf-section-title">Store Deals &amp; Offers</div>
                  <button type="button" onClick={() => { setDealForm({ ...DEAL_BLANK }); setEditDealIdx(null); }}
                    className="pf-btn-secondary pf-btn-sm">
                    <Plus size={11} /> Add Deal
                  </button>
                </div>

                {deals.length === 0 && !dealForm ? (
                  <div className="pf-deal-empty">
                    <Zap size={18} style={{ opacity:0.35, marginBottom:6, display:'block', margin:'0 auto 8px' }} />
                    No deals configured. Add a BOGO, % off, multi-buy, or sale price offer.
                  </div>
                ) : (
                  <div className="pf-deal-list" style={{ marginBottom: dealForm ? '0.875rem' : 0 }}>
                    {deals.map((deal, idx) => {
                      const dt = DEAL_TYPES.find(t => t.value === deal.type) || DEAL_TYPES[0];
                      const Icon = dt.icon;
                      return (
                        <div key={idx} className="pf-deal-row">
                          <div className="pf-deal-icon-wrap" style={{ background: dt.color+'18', border:`1px solid ${dt.color}33` }}>
                            <Icon size={13} color={dt.color} />
                          </div>
                          <div className="pf-deal-info">
                            <div className="pf-deal-badges">
                              <span className="pf-deal-type-badge" style={{ background: dt.color+'22', color: dt.color }}>{dt.label}</span>
                              {deal.name && <span className="pf-deal-name">{deal.name}</span>}
                            </div>
                            <div className="pf-deal-sub">
                              {deal.type === 'percent_off' && `${deal.value}% off`}
                              {deal.type === 'amount_off'  && `$${deal.value} off`}
                              {deal.type === 'fixed_price' && `Sale: $${deal.value}`}
                              {deal.type === 'multi_buy'   && `${deal.minQty} for $${deal.value}`}
                              {deal.type === 'bogo'        && `Buy ${deal.minQty} get ${deal.getQty} free`}
                              {deal.startDate && ` · from ${deal.startDate}`}
                              {deal.endDate   && ` to ${deal.endDate}`}
                            </div>
                          </div>
                          <div className="pf-deal-actions">
                            <span className="pf-deal-status" style={{
                              background: deal.active ? 'rgba(16,185,129,.1)' : 'rgba(100,116,139,.1)',
                              color: deal.active ? '#10b981' : '#64748b' }}>
                              {deal.active ? 'Active' : 'Off'}
                            </span>
                            <button type="button" onClick={() => openDealForm(idx)} className="pf-deal-icon-btn">
                              <Edit2 size={12} />
                            </button>
                            <button type="button" onClick={() => removeDeal(idx)} className="pf-deal-icon-btn delete">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {dealForm !== null && (
                  <div className="pf-deal-form">
                    <div className="pf-deal-form-title">
                      {editDealIdx !== null ? 'EDIT DEAL' : 'NEW DEAL'}
                    </div>
                    <div style={{ marginBottom:'0.75rem' }}>
                      <label className="pf-label">Deal Type</label>
                      <div className="pf-deal-type-row">
                        {DEAL_TYPES.map(dt => {
                          const Icon = dt.icon;
                          const active = dealForm.type === dt.value;
                          return (
                            <button key={dt.value} type="button"
                              onClick={() => setDealForm(f => ({ ...f, type: dt.value }))}
                              title={dt.desc}
                              className={`pf-deal-type-btn ${active ? 'active' : ''}`}
                              style={{ background: active ? dt.color : undefined }}>
                              <Icon size={11} /> {dt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="pf-deal-form-grid">
                      <div style={{ gridColumn:'span 2' }}>
                        <label className="pf-label">Deal Label (shelf tag)</label>
                        <input className="form-input" style={{ width:'100%' }}
                          value={dealForm.name}
                          onChange={e => setDealForm(f => ({ ...f, name: e.target.value }))}
                          placeholder={
                            dealForm.type === 'percent_off' ? 'e.g. 10% Off!' :
                            dealForm.type === 'multi_buy'   ? 'e.g. 2 for $5.00' :
                            dealForm.type === 'bogo'        ? 'e.g. Buy 1 Get 1 Free' :
                            'e.g. Weekend Special'
                          } />
                      </div>
                      {dealForm.type !== 'bogo' && (
                        <div>
                          <label className="pf-label">
                            {dealForm.type === 'percent_off' ? 'Discount %' :
                             dealForm.type === 'amount_off'  ? 'Discount $' :
                             dealForm.type === 'multi_buy'   ? `Price for ${dealForm.minQty || 'N'} units` :
                             'Sale Price $'}
                          </label>
                          <div className={dealForm.type !== 'percent_off' ? 'pf-dollar-wrap' : undefined} style={{ position: dealForm.type === 'percent_off' ? 'relative' : undefined }}>
                            {dealForm.type !== 'percent_off' && <span className="pf-dollar-sign">$</span>}
                            <PriceInput className={`form-input${dealForm.type !== 'percent_off' ? ' pf-dollar-input' : ''}`}
                              style={{ width:'100%' }}
                              maxValue={dealForm.type === 'percent_off' ? 100 : undefined}
                              value={dealForm.value}
                              onChange={(v) => setDealForm(f => ({ ...f, value: v }))}
                              placeholder="0.00" />
                            {dealForm.type === 'percent_off' && (
                              <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
                                color:'var(--text-muted)', fontSize:'0.85rem', pointerEvents:'none' }}>%</span>
                            )}
                          </div>
                        </div>
                      )}
                      <div>
                        <label className="pf-label">
                          {dealForm.type === 'multi_buy' ? 'Buy qty (e.g. 2)' :
                           dealForm.type === 'bogo'      ? 'Buy qty' : 'Min qty'}
                        </label>
                        <input className="form-input" style={{ width:'100%' }}
                          type="number" min="1"
                          value={dealForm.minQty}
                          onChange={e => setDealForm(f => ({ ...f, minQty: parseInt(e.target.value)||1 }))} />
                      </div>
                      {dealForm.type === 'bogo' && (
                        <div>
                          <label className="pf-label">Get qty (free)</label>
                          <input className="form-input" style={{ width:'100%' }}
                            type="number" min="1"
                            value={dealForm.getQty}
                            onChange={e => setDealForm(f => ({ ...f, getQty: parseInt(e.target.value)||1 }))} />
                        </div>
                      )}
                      <div>
                        <label className="pf-label">Start Date</label>
                        <input className="form-input" style={{ width:'100%' }} type="date"
                          value={dealForm.startDate}
                          onChange={e => setDealForm(f => ({ ...f, startDate: e.target.value }))} />
                      </div>
                      <div>
                        <label className="pf-label">End Date</label>
                        <input className="form-input" style={{ width:'100%' }} type="date"
                          value={dealForm.endDate}
                          onChange={e => setDealForm(f => ({ ...f, endDate: e.target.value }))} />
                      </div>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:'0.875rem' }}>
                      <Tog value={dealForm.active} onChange={v => setDealForm(f => ({ ...f, active: v }))} />
                      <span style={{ fontSize:'0.8rem', color:'var(--text-secondary)' }}>Deal is active</span>
                    </div>
                    <div className="pf-deal-form-btns">
                      <button type="button" onClick={saveDealLocal} className="pf-btn-primary pf-btn-sm">
                        <Check size={13} /> {editDealIdx !== null ? 'Update Deal' : 'Add Deal'}
                      </button>
                      <button type="button" onClick={() => { setDealForm(null); setEditDealIdx(null); }}
                        className="pf-btn-secondary pf-btn-sm">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Section 6: Grocery & Scale (only if store has scale enabled) ── */}
              {groceryEnabled && <div className="pf-card" style={{ marginBottom:'1rem' }}>
                <div className="pf-section-title" style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span>Grocery &amp; Scale</span>
                  <span style={{ fontSize:'0.6rem', color:'var(--text-muted)', fontWeight:400, textTransform:'none' }}>
                    Scale products configuration
                  </span>
                </div>

                {/* PLU row — 4-5 digit produce / scale lookup number.
                    Save payload clears it when groceryEnabled is false. */}
                <div style={{ marginBottom:'0.75rem' }}>
                  <label className="pf-label">PLU <span style={{ fontSize:'0.6rem', color:'var(--text-muted)', fontWeight:400, marginLeft:6 }}>produce / scale lookup</span></label>
                  <input
                    className="form-input pf-full"
                    value={form.plu}
                    onChange={e => setF('plu', e.target.value.replace(/\D/g, '').slice(0, 5))}
                    placeholder="e.g. 4011 (bananas), 94011 (organic bananas)"
                    maxLength={5}
                    inputMode="numeric"
                    style={{ fontFamily:'ui-monospace, SFMono-Regular, monospace', letterSpacing:'0.04em' }}
                  />
                </div>

                <div className="pf-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                  <div>
                    <label className="pf-label">Tare Weight (lbs)</label>
                    <input className="form-input pf-full" value={form.tareWeight} onChange={e => setF('tareWeight', e.target.value)} placeholder="0.00" />
                  </div>
                  <div>
                    <label className="pf-label">Scale PLU Type</label>
                    <input className="form-input pf-full" value={form.scalePluType} onChange={e => setF('scalePluType', e.target.value)} />
                  </div>
                  <div>
                    <label className="pf-label">Certification</label>
                    <input className="form-input pf-full" value={form.certCode} onChange={e => setF('certCode', e.target.value)} placeholder="organic, kosher, etc." />
                  </div>
                  <div>
                    <label className="pf-label">Label Format</label>
                    <input className="form-input pf-full" value={form.labelFormatId} onChange={e => setF('labelFormatId', e.target.value)} />
                  </div>
                </div>
                <div style={{ marginTop:'0.75rem' }}>
                  <label className="pf-label">Ingredients</label>
                  <textarea className="form-input pf-full" rows={2} value={form.ingredients} onChange={e => setF('ingredients', e.target.value)} style={{ width:'100%', resize:'vertical' }} />
                </div>
                <div style={{ marginTop:'0.5rem' }}>
                  <label className="pf-label">Nutrition Facts</label>
                  <textarea className="form-input pf-full" rows={2} value={form.nutritionFacts} onChange={e => setF('nutritionFacts', e.target.value)} style={{ width:'100%', resize:'vertical' }} />
                </div>
                <div style={{ display:'flex', gap:'1rem', marginTop:'0.5rem' }}>
                  <div className="pf-sb-toggle-row" style={{ flex:1, margin:0 }}>
                    <span className="pf-toggle-label">Scale by Count</span>
                    <Tog value={!!form.scaleByCount} onChange={v => setF('scaleByCount', v)} />
                  </div>
                </div>
              </div>}

              {/* ── Section 7: E-Commerce (only if ecom module enabled) ── */}
              {ecomEnabled && <div className="pf-card" style={{ marginBottom:'1rem' }}>
                <div className="pf-section-title">E-Commerce</div>
                <div className="pf-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                  <div>
                    <label className="pf-label">E-Commerce Price</label>
                    <PriceInput className="form-input pf-full" value={form.ecomPrice} onChange={(v) => setF('ecomPrice', v)} placeholder="0.00" />
                  </div>
                  <div>
                    <label className="pf-label">Sale Price</label>
                    <PriceInput className="form-input pf-full" value={form.ecomSalePrice} onChange={(v) => setF('ecomSalePrice', v)} placeholder="0.00" />
                  </div>
                  <div>
                    <label className="pf-label">External ID</label>
                    <input className="form-input pf-full" value={form.ecomExternalId} onChange={e => setF('ecomExternalId', e.target.value)} />
                  </div>
                  <div>
                    <label className="pf-label">Pack Weight</label>
                    <input className="form-input pf-full" type="number" step="0.01" value={form.ecomPackWeight} onChange={e => setF('ecomPackWeight', e.target.value)} placeholder="0.00" />
                  </div>
                </div>
                {/* One description field — formerly two (Summary + Description).
                    Merged per April audit: storefront derives the card summary
                    from the first ~160 chars of this text. */}
                <div style={{ marginTop:'0.75rem' }}>
                  <label className="pf-label">Description (SEO)</label>
                  <textarea className="form-input pf-full" rows={4} value={form.ecomDescription} onChange={e => setF('ecomDescription', e.target.value)} style={{ width:'100%', resize:'vertical' }} placeholder="Long product description shown on the storefront product page. First ~160 chars are used on listing/grid cards." />
                </div>

                {/* Shipping package — ship weight + 3 dimensions (imperial).
                    Used by carrier rate quotes + shipping label generation. */}
                <div style={{ marginTop:'0.75rem' }}>
                  <div className="pf-section-title" style={{ fontSize:'0.78rem', marginBottom:'0.5rem' }}>Shipping Package</div>
                  <div className="pf-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:'0.5rem' }}>
                    <div>
                      <label className="pf-label">Ship Weight (lbs)</label>
                      <input className="form-input pf-full" type="number" step="0.01" min="0" value={form.weight} onChange={e => setF('weight', e.target.value)} placeholder="0.00" />
                    </div>
                    <div>
                      <label className="pf-label">Length (in)</label>
                      <input className="form-input pf-full" type="number" step="0.01" min="0" value={form.shipLengthIn} onChange={e => setF('shipLengthIn', e.target.value)} placeholder="0.00" />
                    </div>
                    <div>
                      <label className="pf-label">Width (in)</label>
                      <input className="form-input pf-full" type="number" step="0.01" min="0" value={form.shipWidthIn} onChange={e => setF('shipWidthIn', e.target.value)} placeholder="0.00" />
                    </div>
                    <div>
                      <label className="pf-label">Height (in)</label>
                      <input className="form-input pf-full" type="number" step="0.01" min="0" value={form.shipHeightIn} onChange={e => setF('shipHeightIn', e.target.value)} placeholder="0.00" />
                    </div>
                  </div>
                </div>

                <div style={{ display:'flex', gap:'1rem', marginTop:'0.75rem' }}>
                  <div className="pf-sb-toggle-row" style={{ flex:1, margin:0 }}>
                    <span className="pf-toggle-label">On Sale</span>
                    <Tog value={!!form.ecomOnSale} onChange={v => setF('ecomOnSale', v)} />
                  </div>
                  <div className="pf-sb-toggle-row" style={{ flex:1, margin:0 }}>
                    <span className="pf-toggle-label">Hide from storefront</span>
                    <Tog value={!!form.hideFromEcom} onChange={v => setF('hideFromEcom', v)} />
                  </div>
                </div>
              </div>}

            </div>{/* end left column */}

            {/* ══ RIGHT SIDEBAR ═══════════════════════════════════════════════ */}
            <div className="pf-right-col" style={{ position:'sticky', top:16 }}>

              {/* ── Qty on Hand (active store) ── */}
              {(() => {
                const activeStoreId = localStorage.getItem('activeStoreId');
                const activeStore = setup.stores?.find(s =>
                  String(s.id) === String(activeStoreId)
                ) || setup.stores?.[0];
                if (!activeStore) return null;
                return (
                  <div className="pf-card">
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.625rem' }}>
                      <div className="pf-section-title">Qty on Hand</div>
                      <span className="pf-store-badge">
                        {activeStore.name}
                      </span>
                    </div>
                    <div className="pf-qty-row">
                      <input className="form-input pf-qty-input"
                        type="number" step="1" placeholder="0"
                        value={storeQty[activeStore.id] ?? ''}
                        onChange={e => setStoreQty(q => ({ ...q, [activeStore.id]: e.target.value }))} />
                      <span className="pf-qty-unit">units</span>
                    </div>
                    {isEdit && (
                      <div style={{ display: 'flex', gap: 6, marginTop: '0.4rem' }}>
                        {[
                          { label: '-1', val: -1, color: '#ef4444' },
                          { label: '-5', val: -5, color: '#ef4444' },
                          { label: '+1', val: 1, color: '#22c55e' },
                          { label: '+5', val: 5, color: '#22c55e' },
                        ].map(btn => (
                          <button key={btn.label} type="button" onClick={() => {
                            const cur = parseInt(storeQty[activeStore.id] || '0');
                            setStoreQty(q => ({ ...q, [activeStore.id]: String(cur + btn.val) }));
                          }} style={{
                            padding: '2px 8px', borderRadius: 4, border: `1px solid ${btn.color}30`,
                            background: `${btn.color}10`, color: btn.color, fontSize: '0.68rem',
                            fontWeight: 700, cursor: 'pointer',
                          }}>{btn.label}</button>
                        ))}
                      </div>
                    )}
                    <p style={{ fontSize:'0.68rem', color:'var(--text-muted)', margin:'0.4rem 0 0', lineHeight:1.4 }}>
                      Updates on save. Switch store to edit other locations.
                    </p>

                    {/* Session 40 Item 28 — Track inventory toggle.
                        When off, sales don't deduct stock. Turn off for
                        service items, manual entries, and non-inventory SKUs. */}
                    <div className="pf-sb-toggle-row" style={{ marginTop:'0.5rem' }}>
                      <span className="pf-toggle-label" title="When on, each sale deducts 1 from on-hand stock. Turn off for service items, manual entries, or non-inventory SKUs.">Track Inventory</span>
                      <Tog value={!!form.trackInventory} onChange={v => setF('trackInventory', v)} />
                    </div>

                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem', marginTop:'0.5rem' }}>
                      <div>
                        <label className="pf-label" style={{ fontSize:'0.65rem' }}>Reorder Point</label>
                        <input className="form-input pf-full" type="number" min="0" value={form.reorderPoint} onChange={e => setF('reorderPoint', e.target.value)} placeholder="0" disabled={!form.trackInventory} />
                      </div>
                      <div>
                        <label className="pf-label" style={{ fontSize:'0.65rem' }}>Reorder Qty</label>
                        <input className="form-input pf-full" type="number" min="0" value={form.reorderQty} onChange={e => setF('reorderQty', e.target.value)} placeholder="0" disabled={!form.trackInventory} />
                      </div>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.4rem', marginTop:'0.5rem' }}>
                      <div style={{ background:'var(--bg-tertiary)', padding:'0.35rem 0.5rem', borderRadius:6, textAlign:'center' }}
                        title={stats52w?.weeksWithSales ? `${stats52w.weeksWithSales} weeks with sales out of 52` : ''}>
                        <div style={{ fontSize:'0.55rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase' }}>52w High</div>
                        <div style={{ fontSize:'0.85rem', fontWeight:700, color:'var(--success)' }}>
                          {stats52w?.weeklyHigh != null ? stats52w.weeklyHigh : '\u2014'}
                        </div>
                        <div style={{ fontSize:'0.5rem', color:'var(--text-muted)' }}>units/wk</div>
                      </div>
                      <div style={{ background:'var(--bg-tertiary)', padding:'0.35rem 0.5rem', borderRadius:6, textAlign:'center' }}
                        title={stats52w?.totalUnits ? `${stats52w.totalUnits} total units sold in 52 weeks` : ''}>
                        <div style={{ fontSize:'0.55rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase' }}>52w Low</div>
                        <div style={{ fontSize:'0.85rem', fontWeight:700, color:'var(--error)' }}>
                          {stats52w?.weeklyLow != null ? stats52w.weeklyLow : '\u2014'}
                        </div>
                        <div style={{ fontSize:'0.5rem', color:'var(--text-muted)' }}>units/wk</div>
                      </div>
                      <div style={{ background:'var(--bg-tertiary)', padding:'0.35rem 0.5rem', borderRadius:6, textAlign:'center' }}
                        title={stats52w?.avgWeekly != null ? `Avg ${stats52w.avgWeekly} units/wk × 2 weeks cover` : ''}>
                        <div style={{ fontSize:'0.55rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase' }}>Suggested</div>
                        <div style={{ fontSize:'0.85rem', fontWeight:700, color:'var(--accent-primary)' }}>
                          {stats52w?.suggestedQoH != null ? stats52w.suggestedQoH : '\u2014'}
                        </div>
                        <div style={{ fontSize:'0.5rem', color:'var(--text-muted)' }}>qty on hand</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Vendor / Supplier ── */}
              <div className="pf-card">
                <div className="pf-sidebar-header-row">
                  <div className="pf-section-title">Vendor Details</div>
                  <button type="button" onClick={() => setShowVendMgr(true)} className="pf-manage-link">
                    <Settings size={10} /> Manage
                  </button>
                </div>

                <div style={{ marginBottom:'0.75rem' }}>
                  <label className="pf-label">Vendor / Supplier</label>
                  <select className="form-input" style={{ width:'100%' }}
                    value={form.vendorId} onChange={e => setF('vendorId', e.target.value)}>
                    <option value="">— No vendor —</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>

                <div style={{ marginBottom:'0.75rem' }}>
                  <label className="pf-label">Vendor Code / Item #</label>
                  <input className="form-input" style={{ width:'100%', fontFamily:'monospace' }}
                    value={form.itemCode} onChange={e => setF('itemCode', e.target.value)}
                    placeholder="e.g. BL-12OZ-24" />
                </div>

                <div style={{ marginBottom:'0.75rem' }}>
                  <label className="pf-label" style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                    <span>Case Cost (invoice)</span>
                    {form.lockManualCaseCost && (
                      <span title="Manual cost lock is on — invoice imports won't overwrite"
                        style={{ color:'#f59e0b', fontSize:'0.7rem' }}>🔒 locked</span>
                    )}
                  </label>
                  <div className="pf-dollar-wrap">
                    <span className="pf-dollar-sign">$</span>
                    <PriceInput className="form-input pf-dollar-input" style={{ width:'100%' }}
                      value={form.defaultCasePrice} placeholder="0.00"
                      onChange={(v) => setF('defaultCasePrice', v)}
                      onBlur={e => e.target.value && setF('defaultCasePrice', parseFloat(e.target.value).toFixed(2))} />
                  </div>

                  {/* Invoice cost-sync lock — mirrors portal ProductForm */}
                  <label style={{
                    display:'flex', alignItems:'flex-start', gap:'0.5rem',
                    marginTop:'0.4rem', cursor:'pointer', fontSize:'0.72rem',
                    color:'var(--text-muted)',
                  }}>
                    <input type="checkbox"
                      checked={!!form.lockManualCaseCost}
                      onChange={e => setF('lockManualCaseCost', e.target.checked)}
                      style={{ marginTop:'0.1rem', cursor:'pointer' }} />
                    <span>
                      Lock case cost — invoice imports won&apos;t overwrite this value.
                      <br />
                      <span style={{ fontSize:'0.66rem', opacity: 0.8 }}>
                        Turn on when case cost reflects a free-case credit or
                        rebate not visible on the vendor&apos;s invoice.
                      </span>
                    </span>
                  </label>
                </div>

                <button type="button" onClick={() => setShowVendMgr(true)}
                  className="pf-btn-secondary" style={{ width:'100%', justifyContent:'center', fontSize:'0.78rem' }}>
                  <Plus size={12} /> Add Vendor
                </button>
              </div>

              {/* Bottle Deposit */}
              <div className="pf-card">
                <div className="pf-section-title" style={{ marginBottom:'0.875rem' }}>Bottle Deposit</div>

                <div style={{ marginBottom:'0.75rem' }}>
                  <label className="pf-label">Case Deposit Total</label>
                  <div className="pf-dollar-wrap">
                    <span className="pf-dollar-sign">$</span>
                    <PriceInput className="form-input pf-dollar-input" style={{ width:'100%' }}
                      value={caseDeposit}
                      onChange={(v) => setCaseDeposit(v)}
                      onBlur={e => e.target.value && setCaseDeposit(parseFloat(e.target.value).toFixed(2))}
                      placeholder="e.g. 1.20" />
                  </div>
                </div>

                {packEnabled && packRows.length > 0 && parseFloat(caseDeposit) > 0 && (
                  <div style={{ padding:'0.6rem 0.75rem', background:'#06b6d408', borderRadius:7,
                    border:'1px solid #06b6d425', marginBottom:'0.5rem' }}>
                    <div style={{ fontSize:'0.65rem', fontWeight:700, color:'#06b6d4',
                      textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'0.4rem' }}>
                      Per-Pack Deposit
                    </div>
                    {packRows.map((row, idx) => {
                      const ppc = parseInt(row.packsPerCase) || null;
                      const dep = ppc ? (parseFloat(caseDeposit) / ppc).toFixed(2) : null;
                      return (
                        <div key={idx} style={{ display:'flex', justifyContent:'space-between',
                          fontSize:'0.78rem', color:'var(--text-secondary)', marginBottom:2 }}>
                          <span>{row.label || `Pack ${idx + 1}`}</span>
                          <span style={{ fontWeight:600 }}>
                            {dep != null ? `$${dep}` : '— set Packs or Case Size'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <p style={{ fontSize:'0.7rem', color:'var(--text-muted)', margin:0, lineHeight:1.4 }}>
                  Deposit per pack = Case deposit ÷ Packs per case
                </p>
              </div>

              {/* Compliance */}
              <div className="pf-card">
                <div className="pf-section-title">Compliance</div>
                <div style={{ marginBottom:'0.875rem' }}>
                  <label className="pf-label">Age Verification</label>
                  <div className="pf-age-btns">
                    {[['None',''],['18+','18'],['21+','21']].map(([label,val]) => (
                      <button key={val} type="button" onClick={() => setF('ageRequired', val)}
                        className={`pf-age-btn ${String(form.ageRequired)===val ? 'active' : 'inactive'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {[
                  ['EBT / SNAP Eligible', 'ebtEligible'],
                  ['WIC Eligible',         'wicEligible'],
                  ['Discount Eligible',    'discountEligible'],
                  ['Sold by Weight',       'byWeight'],
                ].map(([label, key]) => (
                  <div key={key} className="pf-sb-toggle-row">
                    <span className="pf-toggle-label">{label}</span>
                    <Tog value={!!form[key]} onChange={v => setF(key, v)} />
                  </div>
                ))}
              </div>




              {/* Status */}
              <div className="pf-card">
                <div className="pf-section-title">Status</div>
                <div className="pf-sb-toggle-row" style={{ marginBottom:0 }}>
                  <span className="pf-status-text" style={{ color: form.active ? '#10b981' : 'var(--text-muted)' }}>
                    {form.active ? 'Active — visible in catalog' : 'Inactive — hidden from POS'}
                  </span>
                  <Tog value={form.active} onChange={v => setF('active', v)} />
                </div>
              </div>

              {/* Store Availability */}
              <div className="pf-card">
                <div className="pf-section-title">Store Availability</div>
                {setup.loading ? (
                  <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>Checking stores…</div>
                ) : setup.storeCount === 0 ? (
                  <div style={{ fontSize:'0.78rem', color:'var(--text-secondary)', lineHeight:1.5 }}>
                    <span style={{ display:'block', fontWeight:600, color:'#f59e0b', marginBottom:4 }}>No stores yet</span>
                    Product saved in catalog. Once you add a store it will be available there automatically.
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize:'0.78rem', color:'var(--text-secondary)', marginBottom:8, lineHeight:1.5 }}>
                      {isEdit
                        ? `Available at ${setup.storeCount} store${setup.storeCount > 1 ? 's' : ''}.`
                        : `Will be available at ${setup.storeCount === 1 ? 'your store' : `all ${setup.storeCount} stores`} automatically when saved.`}
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                      {setup.stores.map(store => (
                        <div key={store.id || store._id} className="pf-store-chip">
                          <Check size={11} color="#10b981" />
                          <span className="pf-store-chip-name">{store.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Active deals summary */}
              {deals.filter(d => d.active).length > 0 && (
                <div className="pf-card pf-active-deals-card">
                  <div className="pf-section-title">Active Deals</div>
                  {deals.filter(d => d.active).map((deal, idx) => {
                    const dt = DEAL_TYPES.find(t => t.value === deal.type) || DEAL_TYPES[0];
                    return (
                      <div key={idx} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                        <Zap size={11} color={dt.color} />
                        <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>
                          {deal.name || dt.label}
                          {deal.type === 'percent_off' && ` — ${deal.value}% off`}
                          {deal.type === 'amount_off'  && ` — $${deal.value} off`}
                          {deal.type === 'fixed_price' && ` — $${deal.value}`}
                          {deal.type === 'multi_buy'   && ` — ${deal.minQty} for $${deal.value}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Save */}
              <button type="submit" disabled={saving} className="pf-btn-primary" style={{ width:'100%', justifyContent:'center' }}>
                <Save size={14} /> {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Product'}
              </button>

            </div>{/* end right sidebar */}

          </div>{/* end body grid */}
        </form>

        {showDeptMgr && (
          <DeptManager departments={departments} onClose={() => setShowDeptMgr(false)} onRefresh={loadSupport} />
        )}
        {showVendMgr && (
          <VendorManager vendors={vendors} onClose={() => setShowVendMgr(false)} onRefresh={loadSupport} />
        )}
      </div>
      </div>{/* end .pfm-modal */}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Micro helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmtPct = (v) => v == null ? '—' : Number(v).toFixed(1) + '%';

