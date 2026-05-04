/**
 * GroupForm — create/edit modal for a ProductGroup.
 *
 * S69 (C13): pricing inputs migrated to <MoneyInput> for scroll-proof,
 * arrow-key-proof, scientific-notation-proof entry. Replaces the previous
 * raw <input type="number" step="0.01"> which let mouse-wheel events
 * silently change values on a focused input.
 */

import React, { useState } from 'react';
import { Users as UsersIcon, X, Save } from 'lucide-react';
import { toast } from 'react-toastify';
import { MoneyInput } from '../../components/NumericInputs.jsx';

const TAX_CLASSES = [
  { value: '',            label: '— No override —' },
  { value: 'grocery',     label: 'Grocery' },
  { value: 'alcohol',     label: 'Alcohol' },
  { value: 'tobacco',     label: 'Tobacco' },
  { value: 'hot_food',    label: 'Hot Food' },
  { value: 'standard',    label: 'Standard' },
  { value: 'non_taxable', label: 'Non-Taxable' },
];

const EMPTY_FORM = {
  name: '', description: '', color: '',
  departmentId: '', vendorId: '',
  taxClass: '', ageRequired: '',
  ebtEligible: null, discountEligible: null, taxable: null,
  size: '', sizeUnit: 'oz', pack: '', casePacks: '',
  defaultCostPrice: '', defaultRetailPrice: '', defaultCasePrice: '',
  salePrice: '', saleStart: '', saleEnd: '',
  autoSync: true, allowMixMatch: true, active: true,
};

export default function GroupForm({ group, departments, vendors, onSave, onClose, saving }) {
  const [form, setForm] = useState(() => {
    if (!group) return { ...EMPTY_FORM };
    return {
      name:               group.name || '',
      description:        group.description || '',
      color:              group.color || '',
      departmentId:       group.departmentId != null ? String(group.departmentId) : '',
      vendorId:           group.vendorId != null ? String(group.vendorId) : '',
      taxClass:           group.taxClass || '',
      ageRequired:        group.ageRequired != null ? String(group.ageRequired) : '',
      ebtEligible:        group.ebtEligible,
      discountEligible:   group.discountEligible,
      taxable:            group.taxable,
      size:               group.size || '',
      sizeUnit:           group.sizeUnit || 'oz',
      pack:               group.pack != null ? String(group.pack) : '',
      casePacks:          group.casePacks != null ? String(group.casePacks) : '',
      defaultCostPrice:   group.defaultCostPrice != null ? String(group.defaultCostPrice) : '',
      defaultRetailPrice: group.defaultRetailPrice != null ? String(group.defaultRetailPrice) : '',
      defaultCasePrice:   group.defaultCasePrice != null ? String(group.defaultCasePrice) : '',
      salePrice:          group.salePrice != null ? String(group.salePrice) : '',
      saleStart:          group.saleStart ? group.saleStart.slice(0, 10) : '',
      saleEnd:            group.saleEnd ? group.saleEnd.slice(0, 10) : '',
      autoSync:           group.autoSync ?? true,
      allowMixMatch:      group.allowMixMatch ?? true,
      active:             group.active ?? true,
    };
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      color: form.color || null,
      departmentId: form.departmentId || null,
      vendorId: form.vendorId || null,
      taxClass: form.taxClass || null,
      ageRequired: form.ageRequired || null,
      ebtEligible: form.ebtEligible,
      discountEligible: form.discountEligible,
      taxable: form.taxable,
      size: form.size || null,
      sizeUnit: form.sizeUnit || null,
      pack: form.pack || null,
      casePacks: form.casePacks || null,
      defaultCostPrice: form.defaultCostPrice || null,
      defaultRetailPrice: form.defaultRetailPrice || null,
      defaultCasePrice: form.defaultCasePrice || null,
      salePrice: form.salePrice || null,
      saleStart: form.saleStart || null,
      saleEnd: form.saleEnd || null,
      autoSync: form.autoSync,
      allowMixMatch: form.allowMixMatch,
      active: form.active,
    };
    onSave(payload);
  };

  return (
    <div className="pg-modal-overlay" onClick={onClose}>
      <div className="pg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pg-modal-header">
          <div className="pg-modal-title">
            <UsersIcon size={18} />
            {group ? `Edit Group — ${group.name}` : 'New Product Group'}
          </div>
          <button onClick={onClose} className="pg-close-btn">
            <X size={18} />
          </button>
        </div>

        <div className="pg-modal-body">
          {/* Basic */}
          <div className="pg-section-label">Basic</div>
          <div className="pg-grid-2">
            <div>
              <label className="pg-label">Name *</label>
              <input className="pg-input" value={form.name} onChange={e => set('name', e.target.value)}
                placeholder="e.g. 750ml Red Wine, 12oz Can Beer" autoFocus />
            </div>
            <div>
              <label className="pg-label">Color (UI chip)</label>
              <input className="pg-input" type="color" value={form.color || '#3b82f6'}
                onChange={e => set('color', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="pg-label">Description</label>
            <input className="pg-input" value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="Optional notes about this group" />
          </div>

          {/* Classification */}
          <div className="pg-section-label">Classification (applied to members)</div>
          <div className="pg-grid-2">
            <div>
              <label className="pg-label">Department</label>
              <select className="pg-input" value={form.departmentId} onChange={e => set('departmentId', e.target.value)}>
                <option value="">— No override —</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="pg-label">Default Vendor</label>
              <select className="pg-input" value={form.vendorId} onChange={e => set('vendorId', e.target.value)}>
                <option value="">— No override —</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          </div>

          <div className="pg-grid-2">
            <div>
              <label className="pg-label">Tax Class</label>
              <select className="pg-input" value={form.taxClass} onChange={e => set('taxClass', e.target.value)}>
                {TAX_CLASSES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="pg-label">Age Required</label>
              <select className="pg-input" value={form.ageRequired} onChange={e => set('ageRequired', e.target.value)}>
                <option value="">— No override —</option>
                <option value="18">18+</option>
                <option value="21">21+</option>
              </select>
            </div>
          </div>

          <div className="pg-toggles-row">
            <label className="pg-toggle">
              <input type="checkbox"
                checked={form.ebtEligible === true}
                ref={el => { if (el) el.indeterminate = form.ebtEligible == null; }}
                onChange={e => set('ebtEligible', e.target.checked)}
              />
              EBT Eligible
            </label>
            <label className="pg-toggle">
              <input type="checkbox"
                checked={form.taxable === true}
                ref={el => { if (el) el.indeterminate = form.taxable == null; }}
                onChange={e => set('taxable', e.target.checked)}
              />
              Taxable
            </label>
            <label className="pg-toggle">
              <input type="checkbox"
                checked={form.discountEligible === true}
                ref={el => { if (el) el.indeterminate = form.discountEligible == null; }}
                onChange={e => set('discountEligible', e.target.checked)}
              />
              Discount Eligible
            </label>
          </div>

          {/* Size */}
          <div className="pg-section-label">Size & Pack</div>
          <div className="pg-grid-3">
            <div>
              <label className="pg-label">Size</label>
              <input className="pg-input" value={form.size} onChange={e => set('size', e.target.value)}
                placeholder="e.g. 12, 750" />
            </div>
            <div>
              <label className="pg-label">Unit</label>
              <select className="pg-input" value={form.sizeUnit} onChange={e => set('sizeUnit', e.target.value)}>
                {['oz', 'fl oz', 'ml', 'L', 'gal', 'lb', 'g', 'kg', 'ct', 'each', 'pk'].map(u =>
                  <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="pg-label">Pack</label>
              <input className="pg-input" type="number" value={form.pack} onChange={e => set('pack', e.target.value)}
                placeholder="1" />
            </div>
          </div>

          {/* Pricing */}
          <div className="pg-section-label">Default Pricing (applied to members)</div>
          <div className="pg-grid-3">
            <div>
              <label className="pg-label">Retail Price</label>
              <MoneyInput className="pg-input"
                value={form.defaultRetailPrice}
                onChange={(v) => set('defaultRetailPrice', v)} />
            </div>
            <div>
              <label className="pg-label">Cost Price</label>
              <MoneyInput className="pg-input"
                value={form.defaultCostPrice}
                onChange={(v) => set('defaultCostPrice', v)} />
            </div>
            <div>
              <label className="pg-label">Case Cost</label>
              <MoneyInput className="pg-input"
                value={form.defaultCasePrice}
                onChange={(v) => set('defaultCasePrice', v)} />
            </div>
          </div>

          {/* Sale */}
          <div className="pg-section-label">Sale Price (optional)</div>
          <div className="pg-grid-3">
            <div>
              <label className="pg-label">Sale Price</label>
              <MoneyInput className="pg-input"
                value={form.salePrice}
                onChange={(v) => set('salePrice', v)} />
            </div>
            <div>
              <label className="pg-label">Start</label>
              <input className="pg-input" type="date" value={form.saleStart} min="1900-01-01" max="2100-12-31"
                onChange={e => set('saleStart', e.target.value)} />
            </div>
            <div>
              <label className="pg-label">End</label>
              <input className="pg-input" type="date" value={form.saleEnd} min="1900-01-01" max="2100-12-31"
                onChange={e => set('saleEnd', e.target.value)} />
            </div>
          </div>

          {/* Promotion eligibility — S69 (C11b) */}
          <div className="pg-section-label">Promotion Eligibility</div>
          <label className="pg-toggle pg-mm-toggle">
            <input type="checkbox" checked={form.allowMixMatch}
              onChange={e => set('allowMixMatch', e.target.checked)} />
            <span>
              <strong>Allow mix-and-match deals</strong> for this group
              <div className="pg-mm-hint">
                When OFF, mix_match promotions cannot target this group
                (flat sale, BOGO, and volume promos are still allowed).
              </div>
            </span>
          </label>

          {/* Settings */}
          <div className="pg-toggles-row" style={{ marginTop: '0.75rem' }}>
            <label className="pg-toggle">
              <input type="checkbox" checked={form.autoSync}
                onChange={e => set('autoSync', e.target.checked)} />
              <strong>Auto-sync to members</strong> (changes cascade automatically)
            </label>
            <label className="pg-toggle">
              <input type="checkbox" checked={form.active}
                onChange={e => set('active', e.target.checked)} />
              Active
            </label>
          </div>
        </div>

        <div className="pg-modal-footer">
          <button onClick={onClose} className="pg-btn pg-btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.name.trim()} className="pg-btn pg-btn-primary">
            <Save size={13} /> {saving ? 'Saving…' : group ? 'Save Changes' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  );
}
