/**
 * AddProductModal — Quick product creation at the POS register.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  X, Package, DollarSign, Tag, ChevronRight,
  ChevronLeft, Save, AlertCircle, Check, Printer,
} from 'lucide-react';
import { createProduct, getDepartmentsForPOS } from '../../api/pos.js';
import { upsertProducts } from '../../db/dexie.js';
import { normalizeUPC } from '../../utils/upc.js';
import { useStationStore } from '../../stores/useStationStore.js';
import './AddProductModal.css';

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
  name: '', upc: '', brand: '', size: '', sizeUnit: 'oz', description: '',
  defaultRetailPrice: '', defaultCostPrice: '', taxClass: 'grocery',
  taxable: true, ebtEligible: false, ageRequired: '', departmentId: '', active: true,
};

function Tog({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`apm-toggle${value ? ' apm-toggle--on' : ' apm-toggle--off'}`}
    >
      <span className={`apm-toggle-knob${value ? ' apm-toggle-knob--on' : ' apm-toggle-knob--off'}`} />
    </button>
  );
}

export default function AddProductModal({ scannedUpc, onCreated, onClose, hasLabelPrinter, onPrintLabel }) {
  const orgId  = useStationStore(s => s.station?.orgId);
  const storeId = useStationStore(s => s.station?.storeId);

  const [section,     setSection]     = useState('info');
  const [form,        setForm]        = useState({ ...BLANK, upc: normalizeUPC(scannedUpc) || scannedUpc || '' });
  const [departments, setDepartments] = useState([]);
  const [errors,      setErrors]      = useState({});
  const [saving,      setSaving]      = useState(false);
  const [savedMsg,    setSavedMsg]    = useState('');
  const [autoPrint,   setAutoPrint]   = useState(() => {
    try {
      const hw = JSON.parse(localStorage.getItem('storv_hardware_config') || '{}');
      return !!hw?.labelPrinter?.autoPrintOnNew;
    } catch { return false; }
  });

  const set = useCallback((k, v) => setForm(f => ({ ...f, [k]: v })), []);

  useEffect(() => { getDepartmentsForPOS().then(setDepartments).catch(() => {}); }, []);

  const margin = (() => {
    const c = parseFloat(form.defaultCostPrice);
    const r = parseFloat(form.defaultRetailPrice);
    if (!c || !r || r <= 0) return null;
    return (((r - c) / r) * 100).toFixed(1);
  })();

  const marginColor = margin === null ? 'var(--text-muted)'
    : Number(margin) >= 30 ? 'var(--green)'
    : Number(margin) >= 20 ? '#f59e0b' : 'var(--red)';

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Product name is required';
    if (!form.defaultRetailPrice || isNaN(parseFloat(form.defaultRetailPrice)))
      e.defaultRetailPrice = 'Retail price is required';
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length) {
      setErrors(e);
      if (e.name) setSection('info');
      else if (e.defaultRetailPrice) setSection('pricing');
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const payload = {
        name: form.name.trim(), upc: form.upc || null, brand: form.brand || null,
        size: form.size || null, sizeUnit: form.size ? form.sizeUnit : null,
        description: form.description || null,
        defaultRetailPrice: parseFloat(form.defaultRetailPrice),
        defaultCostPrice: form.defaultCostPrice ? parseFloat(form.defaultCostPrice) : null,
        taxClass: form.taxClass, taxable: form.taxable, ebtEligible: form.ebtEligible,
        ageRequired: form.ageRequired ? parseInt(form.ageRequired) : null,
        departmentId: form.departmentId || null, active: form.active,
      };
      const created = await createProduct(payload);
      await upsertProducts([{
        ...created, id: created.id, upc: normalizeUPC(created.upc) || created.upc,
        retailPrice: parseFloat(form.defaultRetailPrice),
        storeId: storeId || null, orgId: created.orgId || orgId,
        updatedAt: created.updatedAt || new Date().toISOString(),
      }]);
      setSavedMsg(`"${created.name}" added to catalog`);

      // Auto-print label if enabled
      if (autoPrint && onPrintLabel) {
        try {
          await onPrintLabel({
            name: created.name,
            upc: created.upc,
            defaultRetailPrice: parseFloat(form.defaultRetailPrice),
            size: form.size,
            sizeUnit: form.sizeUnit,
          });
        } catch (err) {
          console.warn('[AddProduct] Label print failed:', err.message);
        }
      }

      setTimeout(() => { onCreated({ ...created, retailPrice: parseFloat(form.defaultRetailPrice) }); }, 800);
    } catch (err) {
      setErrors({ submit: err.response?.data?.error || 'Failed to save product' });
      setSaving(false);
    }
  };

  const currentIdx = SECTIONS.findIndex(s => s.id === section);

  return (
    <div className="apm-backdrop">
      <div className="apm-modal">

        {/* Header */}
        <div className="apm-header">
          <div>
            <div className="apm-header-sup">Add New Product</div>
            <div className="apm-header-title">
              {form.name || <span className="apm-header-title-placeholder">Untitled product</span>}
            </div>
          </div>
          <button className="apm-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        {/* Section Tabs */}
        <div className="apm-tabs">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = section === s.id;
            const hasErr = (s.id === 'info' && errors.name) || (s.id === 'pricing' && errors.defaultRetailPrice);
            return (
              <button key={s.id} className={`apm-tab${active ? ' apm-tab--active' : ''}`} onClick={() => setSection(s.id)}>
                <Icon size={13} />
                {s.label}
                {hasErr && <span className="apm-tab-error-dot" />}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="apm-body">

          {section === 'info' && (
            <div className="apm-section">
              <div>
                <label className="apm-label">Product Name<span className="apm-label-required">*</span></label>
                <input className={`apm-input${errors.name ? ' apm-input--error' : ''}`} value={form.name}
                  onChange={e => { set('name', e.target.value); setErrors(v => ({ ...v, name: '' })); }}
                  placeholder="e.g. Coca-Cola 12 oz Can" autoFocus />
                {errors.name && <div className="apm-field-error">{errors.name}</div>}
              </div>
              <div>
                <label className="apm-label">UPC / Barcode</label>
                <input className="apm-input apm-input--mono" value={form.upc} onChange={e => set('upc', e.target.value)} placeholder="e.g. 0080686006374" />
                {form.upc && <div className="apm-field-hint">Scanned: {scannedUpc} - normalized to EAN-13</div>}
              </div>
              <div>
                <label className="apm-label">Brand</label>
                <input className="apm-input" value={form.brand} onChange={e => set('brand', e.target.value)} placeholder="e.g. Coca-Cola" />
              </div>
              <div className="apm-grid-row">
                <div>
                  <label className="apm-label">Size</label>
                  <input className="apm-input" value={form.size} onChange={e => set('size', e.target.value)} placeholder="e.g. 12" type="number" min="0" />
                </div>
                <div>
                  <label className="apm-label">Unit</label>
                  <select className="apm-input" value={form.sizeUnit} onChange={e => set('sizeUnit', e.target.value)}>
                    {SIZE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="apm-label">Description</label>
                <textarea className="apm-textarea" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional product description" />
              </div>
            </div>
          )}

          {section === 'pricing' && (
            <div className="apm-section">
              <div>
                <label className="apm-label">Retail Price<span className="apm-label-required">*</span></label>
                <div className="apm-price-wrap">
                  <span className="apm-price-symbol">$</span>
                  <input className={`apm-input apm-input--price${errors.defaultRetailPrice ? ' apm-input--error' : ''}`}
                    type="number" min="0" step="0.01" value={form.defaultRetailPrice}
                    onChange={e => { set('defaultRetailPrice', e.target.value); setErrors(v => ({ ...v, defaultRetailPrice: '' })); }}
                    placeholder="0.00" />
                </div>
                {errors.defaultRetailPrice && <div className="apm-field-error">{errors.defaultRetailPrice}</div>}
              </div>
              <div>
                <label className="apm-label">Cost Price <span className="apm-label-note">(optional)</span></label>
                <div className="apm-price-wrap">
                  <span className="apm-price-symbol">$</span>
                  <input className="apm-input apm-input--price" type="number" min="0" step="0.01" value={form.defaultCostPrice}
                    onChange={e => set('defaultCostPrice', e.target.value)} placeholder="0.00" />
                </div>
              </div>
              {margin !== null && (
                <div className="apm-margin-bar">
                  <span className="apm-margin-label">Gross Margin</span>
                  <span className="apm-margin-value" style={{ color: marginColor }}>{margin}%</span>
                </div>
              )}
              <div>
                <label className="apm-label">Tax Class</label>
                <select className="apm-input" value={form.taxClass} onChange={e => set('taxClass', e.target.value)}>
                  {TAX_CLASSES.map(t => <option key={t.value} value={t.value}>{t.label} — {t.note}</option>)}
                </select>
              </div>
              <div className="apm-toggle-row">
                <div>
                  <div className="apm-toggle-label">Taxable</div>
                  <div className="apm-toggle-desc">Apply tax class rate at checkout</div>
                </div>
                <Tog value={form.taxable} onChange={v => set('taxable', v)} />
              </div>
            </div>
          )}

          {section === 'class' && (
            <div className="apm-section">
              <div>
                <label className="apm-label">Department</label>
                <select className="apm-input" value={form.departmentId} onChange={e => set('departmentId', e.target.value)}>
                  <option value="">— None —</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="apm-label">Age Restriction</label>
                <select className="apm-input" value={form.ageRequired} onChange={e => set('ageRequired', e.target.value)}>
                  <option value="">None</option>
                  <option value="18">18+</option>
                  <option value="21">21+</option>
                </select>
              </div>
              <div className="apm-toggle-row">
                <div>
                  <div className="apm-toggle-label">EBT Eligible</div>
                  <div className="apm-toggle-desc">Accept SNAP / EBT for this item</div>
                </div>
                <Tog value={form.ebtEligible} onChange={v => set('ebtEligible', v)} />
              </div>
              <div className="apm-toggle-row">
                <div>
                  <div className="apm-toggle-label">Active</div>
                  <div className="apm-toggle-desc">Product available for sale</div>
                </div>
                <Tog value={form.active} onChange={v => set('active', v)} />
              </div>
            </div>
          )}

          {errors.submit && (
            <div className="apm-submit-error">
              <AlertCircle size={14} /> {errors.submit}
            </div>
          )}

          {savedMsg && (
            <div className="apm-success-msg">
              <Check size={14} /> {savedMsg} — adding to cart...
            </div>
          )}

          {/* Auto-print label toggle */}
          {hasLabelPrinter && onPrintLabel && (
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', marginTop: 12,
              background: 'rgba(59,130,246,0.08)',
              border: '1px solid rgba(59,130,246,0.2)',
              borderRadius: 6, cursor: 'pointer',
              fontSize: '0.85rem',
            }}>
              <input type="checkbox" checked={autoPrint}
                onChange={e => setAutoPrint(e.target.checked)} />
              <Printer size={14} />
              Auto-print shelf label when saved
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="apm-footer">
          <button
            className={`apm-btn-nav${currentIdx === 0 ? ' apm-btn-nav--disabled' : ''}`}
            onClick={() => setSection(SECTIONS[Math.max(0, currentIdx - 1)].id)}
            disabled={currentIdx === 0}
          >
            <ChevronLeft size={14} /> Back
          </button>
          <div className="apm-footer-right">
            {currentIdx < SECTIONS.length - 1 && (
              <button className="apm-btn-next" onClick={() => setSection(SECTIONS[currentIdx + 1].id)}>
                Next <ChevronRight size={14} />
              </button>
            )}
            <button
              className={`apm-btn-save${saving || savedMsg ? ' apm-btn-save--disabled' : ' apm-btn-save--active'}`}
              onClick={handleSave}
              disabled={saving || !!savedMsg}
            >
              <Save size={14} />
              {saving ? 'Saving...' : savedMsg ? 'Saved!' : 'Save & Add to Cart'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
