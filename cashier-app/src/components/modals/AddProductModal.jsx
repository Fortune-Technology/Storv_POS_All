/**
 * AddProductModal — Quick product creation at the POS register.
 *
 * Triggered when a scanned UPC is not found and a manager is authenticated.
 * Mirrors the back-office ProductForm field layout (same sections, same fields)
 * so managers don't need to learn two UIs. Adapted to a modal for POS use.
 *
 * Sections (matching back-office ProductForm order):
 *   1. Product Info  — name, UPC (pre-filled), brand, size, description
 *   2. Pricing       — retail price, cost price, tax class
 *   3. Classification — department, EBT, age required, taxable, active
 *
 * On success:
 *   - Product is saved to the catalog via API
 *   - Cached to IndexedDB for offline future scans
 *   - onCreated(product) is called so POSScreen can add it to the cart
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  X, Package, DollarSign, Tag, ChevronRight,
  ChevronLeft, Save, AlertCircle, Check,
} from 'lucide-react';
import { createProduct, getDepartmentsForPOS } from '../../api/pos.js';
import { upsertProducts } from '../../db/dexie.js';
import { normalizeUPC } from '../../utils/upc.js';
import { useStationStore } from '../../stores/useStationStore.js';

// ── Constants (mirroring back-office ProductForm) ─────────────────────────
const TAX_CLASSES = [
  { value: 'grocery',     label: 'Grocery',     note: '0%'   },
  { value: 'alcohol',     label: 'Alcohol',     note: '5.5%' },
  { value: 'tobacco',     label: 'Tobacco',     note: '5.5%' },
  { value: 'hot_food',    label: 'Hot Food',    note: '8%'   },
  { value: 'standard',    label: 'Standard',    note: '5.5%' },
  { value: 'non_taxable', label: 'Non-Taxable', note: '0%'   },
];

const SIZE_UNITS = ['oz', 'ml', 'L', 'lb', 'kg', 'g', 'each', 'ct', 'fl oz', 'gal'];

const SECTIONS = [
  { id: 'info',    label: 'Product Info',    icon: Package    },
  { id: 'pricing', label: 'Pricing',         icon: DollarSign },
  { id: 'class',   label: 'Classification',  icon: Tag        },
];

const BLANK = {
  name:             '',
  upc:              '',
  brand:            '',
  size:             '',
  sizeUnit:         'oz',
  description:      '',
  defaultRetailPrice: '',
  defaultCostPrice:   '',
  taxClass:         'grocery',
  taxable:          true,
  ebtEligible:      false,
  ageRequired:      '',
  departmentId:     '',
  active:           true,
};

// ── Tiny toggle (matches back-office Tog style) ──────────────────────────
function Tog({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        width: 42, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
        background: value ? 'var(--green)' : 'var(--bg-input)',
        position: 'relative', transition: 'background .2s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: value ? 21 : 3,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'left .2s', boxShadow: '0 1px 4px rgba(0,0,0,.3)',
      }} />
    </button>
  );
}

// ── Label ────────────────────────────────────────────────────────────────
function FL({ children, required }) {
  return (
    <label style={{
      display: 'block', fontSize: '0.72rem', fontWeight: 700,
      color: 'var(--text-muted)', letterSpacing: '0.04em',
      textTransform: 'uppercase', marginBottom: 5,
    }}>
      {children}{required && <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>}
    </label>
  );
}

// ── Input ────────────────────────────────────────────────────────────────
const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--bg-input)', border: '1px solid var(--border-light)',
  borderRadius: 8, color: 'var(--text-primary)',
  fontSize: '0.88rem', padding: '0.55rem 0.75rem',
  outline: 'none', fontFamily: 'inherit',
};

// ── Main Component ────────────────────────────────────────────────────────
export default function AddProductModal({ scannedUpc, onCreated, onClose }) {
  const orgId  = useStationStore(s => s.station?.orgId);
  const storeId = useStationStore(s => s.station?.storeId);

  const [section,     setSection]     = useState('info');
  const [form,        setForm]        = useState({ ...BLANK, upc: normalizeUPC(scannedUpc) || scannedUpc || '' });
  const [departments, setDepartments] = useState([]);
  const [errors,      setErrors]      = useState({});
  const [saving,      setSaving]      = useState(false);
  const [savedMsg,    setSavedMsg]    = useState('');

  const set = useCallback((k, v) => setForm(f => ({ ...f, [k]: v })), []);

  // Load departments
  useEffect(() => {
    getDepartmentsForPOS().then(setDepartments).catch(() => {});
  }, []);

  // Margin preview
  const margin = (() => {
    const c = parseFloat(form.defaultCostPrice);
    const r = parseFloat(form.defaultRetailPrice);
    if (!c || !r || r <= 0) return null;
    return (((r - c) / r) * 100).toFixed(1);
  })();

  const marginColor = margin === null ? 'var(--text-muted)'
    : Number(margin) >= 30 ? 'var(--green)'
    : Number(margin) >= 20 ? '#f59e0b' : 'var(--red)';

  // Validate
  const validate = () => {
    const e = {};
    if (!form.name.trim())          e.name  = 'Product name is required';
    if (!form.defaultRetailPrice || isNaN(parseFloat(form.defaultRetailPrice)))
                                    e.defaultRetailPrice = 'Retail price is required';
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length) {
      setErrors(e);
      // Jump to the section that has errors
      if (e.name) setSection('info');
      else if (e.defaultRetailPrice) setSection('pricing');
      return;
    }

    setSaving(true);
    setErrors({});
    try {
      const payload = {
        name:               form.name.trim(),
        upc:                form.upc || null,
        brand:              form.brand || null,
        size:               form.size || null,
        sizeUnit:           form.size ? form.sizeUnit : null,
        description:        form.description || null,
        defaultRetailPrice: parseFloat(form.defaultRetailPrice),
        defaultCostPrice:   form.defaultCostPrice ? parseFloat(form.defaultCostPrice) : null,
        taxClass:           form.taxClass,
        taxable:            form.taxable,
        ebtEligible:        form.ebtEligible,
        ageRequired:        form.ageRequired ? parseInt(form.ageRequired) : null,
        departmentId:       form.departmentId || null,
        active:             form.active,
      };

      const created = await createProduct(payload);

      // Cache to IndexedDB so this terminal can scan it offline immediately
      await upsertProducts([{
        ...created,
        id:          created.id,
        upc:         normalizeUPC(created.upc) || created.upc,
        retailPrice: parseFloat(form.defaultRetailPrice),
        storeId:     storeId || null,
        orgId:       created.orgId || orgId,
        updatedAt:   created.updatedAt || new Date().toISOString(),
      }]);

      setSavedMsg(`"${created.name}" added to catalog`);
      setTimeout(() => {
        onCreated({
          ...created,
          retailPrice: parseFloat(form.defaultRetailPrice),
        });
      }, 800);
    } catch (err) {
      setErrors({ submit: err.response?.data?.error || 'Failed to save product' });
      setSaving(false);
    }
  };

  const currentIdx = SECTIONS.findIndex(s => s.id === section);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(0,0,0,.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }}>
      <div style={{
        background: 'var(--bg-panel)', borderRadius: 16,
        border: '1px solid var(--border-light)',
        width: '100%', maxWidth: 560,
        maxHeight: '92vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 32px 80px rgba(0,0,0,.6)',
        overflow: 'hidden',
      }}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div style={{
          padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Add New Product
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
              {form.name || <span style={{ color: 'var(--text-muted)' }}>Untitled product</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        {/* ── Section Tabs (matches back-office ProductForm section order) ── */}
        <div style={{
          display: 'flex', borderBottom: '1px solid var(--border-light)',
          flexShrink: 0,
        }}>
          {SECTIONS.map((s) => {
            const Icon    = s.icon;
            const active  = section === s.id;
            const hasErr  = (s.id === 'info' && errors.name) ||
                            (s.id === 'pricing' && errors.defaultRetailPrice);
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                style={{
                  flex: 1, padding: '0.65rem 0.5rem',
                  background: active ? 'var(--bg-card)' : 'transparent',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--green)' : '2px solid transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  cursor: 'pointer', fontWeight: active ? 700 : 500,
                  fontSize: '0.78rem', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: 5, transition: 'all .15s',
                }}
              >
                <Icon size={13} />
                {s.label}
                {hasErr && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--red)', flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>

          {/* ─── SECTION 1: Product Info (mirrors back-office Section 1) ─ */}
          {section === 'info' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

              {/* Name */}
              <div>
                <FL required>Product Name</FL>
                <input
                  style={{ ...inputStyle, borderColor: errors.name ? 'var(--red)' : 'var(--border-light)' }}
                  value={form.name}
                  onChange={e => { set('name', e.target.value); setErrors(v => ({ ...v, name: '' })); }}
                  placeholder="e.g. Coca-Cola 12 oz Can"
                  autoFocus
                />
                {errors.name && <div style={{ color: 'var(--red)', fontSize: '0.75rem', marginTop: 4 }}>{errors.name}</div>}
              </div>

              {/* UPC — pre-filled from scan */}
              <div>
                <FL>UPC / Barcode</FL>
                <input
                  style={{ ...inputStyle, fontFamily: 'monospace' }}
                  value={form.upc}
                  onChange={e => set('upc', e.target.value)}
                  placeholder="e.g. 0080686006374"
                />
                {form.upc && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 3 }}>
                    Scanned: {scannedUpc} → normalized to EAN-13
                  </div>
                )}
              </div>

              {/* Brand */}
              <div>
                <FL>Brand</FL>
                <input
                  style={inputStyle}
                  value={form.brand}
                  onChange={e => set('brand', e.target.value)}
                  placeholder="e.g. Coca-Cola"
                />
              </div>

              {/* Size + Unit (matches back-office row) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '0.75rem' }}>
                <div>
                  <FL>Size</FL>
                  <input
                    style={inputStyle}
                    value={form.size}
                    onChange={e => set('size', e.target.value)}
                    placeholder="e.g. 12"
                    type="number"
                    min="0"
                  />
                </div>
                <div>
                  <FL>Unit</FL>
                  <select
                    style={inputStyle}
                    value={form.sizeUnit}
                    onChange={e => set('sizeUnit', e.target.value)}
                  >
                    {SIZE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              {/* Description */}
              <div>
                <FL>Description</FL>
                <textarea
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }}
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  placeholder="Optional product description"
                />
              </div>
            </div>
          )}

          {/* ─── SECTION 2: Pricing (mirrors back-office Section 2) ────── */}
          {section === 'pricing' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

              {/* Retail Price */}
              <div>
                <FL required>Retail Price</FL>
                <div style={{ position: 'relative' }}>
                  <span style={{
                    position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                    color: 'var(--text-muted)', fontSize: '0.9rem', pointerEvents: 'none',
                  }}>$</span>
                  <input
                    style={{
                      ...inputStyle, paddingLeft: '1.75rem',
                      borderColor: errors.defaultRetailPrice ? 'var(--red)' : 'var(--border-light)',
                    }}
                    type="number" min="0" step="0.01"
                    value={form.defaultRetailPrice}
                    onChange={e => { set('defaultRetailPrice', e.target.value); setErrors(v => ({ ...v, defaultRetailPrice: '' })); }}
                    placeholder="0.00"
                  />
                </div>
                {errors.defaultRetailPrice && <div style={{ color: 'var(--red)', fontSize: '0.75rem', marginTop: 4 }}>{errors.defaultRetailPrice}</div>}
              </div>

              {/* Cost Price */}
              <div>
                <FL>Cost Price <span style={{ fontWeight: 400, textTransform: 'none', fontSize: '0.7rem' }}>(optional)</span></FL>
                <div style={{ position: 'relative' }}>
                  <span style={{
                    position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                    color: 'var(--text-muted)', fontSize: '0.9rem', pointerEvents: 'none',
                  }}>$</span>
                  <input
                    style={{ ...inputStyle, paddingLeft: '1.75rem' }}
                    type="number" min="0" step="0.01"
                    value={form.defaultCostPrice}
                    onChange={e => set('defaultCostPrice', e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Margin preview (matches back-office margin indicator) */}
              {margin !== null && (
                <div style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border-light)',
                  borderRadius: 8, padding: '0.65rem 1rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Gross Margin</span>
                  <span style={{ fontSize: '1rem', fontWeight: 800, color: marginColor }}>
                    {margin}%
                  </span>
                </div>
              )}

              {/* Tax Class */}
              <div>
                <FL>Tax Class</FL>
                <select
                  style={inputStyle}
                  value={form.taxClass}
                  onChange={e => set('taxClass', e.target.value)}
                >
                  {TAX_CLASSES.map(t => (
                    <option key={t.value} value={t.value}>{t.label} — {t.note}</option>
                  ))}
                </select>
              </div>

              {/* Taxable toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Taxable</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Apply tax class rate at checkout</div>
                </div>
                <Tog value={form.taxable} onChange={v => set('taxable', v)} />
              </div>
            </div>
          )}

          {/* ─── SECTION 3: Classification (mirrors back-office right sidebar) */}
          {section === 'class' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

              {/* Department */}
              <div>
                <FL>Department</FL>
                <select
                  style={inputStyle}
                  value={form.departmentId}
                  onChange={e => set('departmentId', e.target.value)}
                >
                  <option value="">— None —</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* Age Required */}
              <div>
                <FL>Age Restriction</FL>
                <select
                  style={inputStyle}
                  value={form.ageRequired}
                  onChange={e => set('ageRequired', e.target.value)}
                >
                  <option value="">None</option>
                  <option value="18">18+</option>
                  <option value="21">21+</option>
                </select>
              </div>

              {/* EBT Eligible */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>EBT Eligible</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Accept SNAP / EBT for this item</div>
                </div>
                <Tog value={form.ebtEligible} onChange={v => set('ebtEligible', v)} />
              </div>

              {/* Active */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Active</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Product available for sale</div>
                </div>
                <Tog value={form.active} onChange={v => set('active', v)} />
              </div>
            </div>
          )}

          {/* ── Submit error ─────────────────────────────────────────── */}
          {errors.submit && (
            <div style={{
              marginTop: '1rem', padding: '0.65rem 0.9rem',
              background: 'rgba(224,63,63,.1)', border: '1px solid rgba(224,63,63,.25)',
              borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8,
              color: 'var(--red)', fontSize: '0.82rem', fontWeight: 600,
            }}>
              <AlertCircle size={14} /> {errors.submit}
            </div>
          )}

          {/* ── Success message ──────────────────────────────────────── */}
          {savedMsg && (
            <div style={{
              marginTop: '1rem', padding: '0.65rem 0.9rem',
              background: 'rgba(122,193,67,.12)', border: '1px solid rgba(122,193,67,.25)',
              borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8,
              color: 'var(--green)', fontSize: '0.82rem', fontWeight: 600,
            }}>
              <Check size={14} /> {savedMsg} — adding to cart…
            </div>
          )}
        </div>

        {/* ── Footer: section nav + save ─────────────────────────────── */}
        <div style={{
          padding: '0.875rem 1.25rem',
          borderTop: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, gap: '0.75rem',
        }}>
          {/* Prev section */}
          <button
            onClick={() => setSection(SECTIONS[Math.max(0, currentIdx - 1)].id)}
            disabled={currentIdx === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'none', border: '1px solid var(--border-light)',
              borderRadius: 8, padding: '0.5rem 0.875rem',
              color: currentIdx === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
              cursor: currentIdx === 0 ? 'not-allowed' : 'pointer',
              fontSize: '0.82rem', fontWeight: 600,
            }}
          >
            <ChevronLeft size={14} /> Back
          </button>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {/* Next section (if not last) */}
            {currentIdx < SECTIONS.length - 1 && (
              <button
                onClick={() => setSection(SECTIONS[currentIdx + 1].id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'var(--bg-card)', border: '1px solid var(--border-light)',
                  borderRadius: 8, padding: '0.5rem 0.875rem',
                  color: 'var(--text-primary)', cursor: 'pointer',
                  fontSize: '0.82rem', fontWeight: 600,
                }}
              >
                Next <ChevronRight size={14} />
              </button>
            )}

            {/* Save — always visible */}
            <button
              onClick={handleSave}
              disabled={saving || !!savedMsg}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: saving || savedMsg ? 'var(--bg-input)' : 'var(--green)',
                border: 'none', borderRadius: 8, padding: '0.5rem 1.25rem',
                color: saving || savedMsg ? 'var(--text-muted)' : '#0f1117',
                cursor: saving || savedMsg ? 'not-allowed' : 'pointer',
                fontSize: '0.88rem', fontWeight: 800,
              }}
            >
              <Save size={14} />
              {saving ? 'Saving…' : savedMsg ? 'Saved!' : 'Save & Add to Cart'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
