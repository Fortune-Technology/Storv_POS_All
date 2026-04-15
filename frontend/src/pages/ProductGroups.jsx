/**
 * ProductGroups — manage template groups for shared classification and pricing.
 *
 * A group holds template fields (dept, tax, age, EBT, deposit, pricing). When
 * autoSync is on, editing the group cascades the changes to all member products.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users as UsersIcon, Plus, Edit2, Trash2, Save, X, RefreshCw,
  Package, Loader, Check, AlertCircle, DollarSign,
} from 'lucide-react';
import { toast } from 'react-toastify';
import {
  listProductGroups, createProductGroup, updateProductGroup, deleteProductGroup,
  applyGroupTemplate, getCatalogDepartments, getCatalogVendors,
} from '../services/api';
import '../styles/portal.css';
import './ProductGroups.css';

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
  autoSync: true, active: true,
};

function GroupForm({ group, departments, vendors, onSave, onClose, saving }) {
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
              <input className="pg-input" type="number" step="0.01" value={form.defaultRetailPrice}
                onChange={e => set('defaultRetailPrice', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="pg-label">Cost Price</label>
              <input className="pg-input" type="number" step="0.01" value={form.defaultCostPrice}
                onChange={e => set('defaultCostPrice', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="pg-label">Case Cost</label>
              <input className="pg-input" type="number" step="0.01" value={form.defaultCasePrice}
                onChange={e => set('defaultCasePrice', e.target.value)} placeholder="0.00" />
            </div>
          </div>

          {/* Sale */}
          <div className="pg-section-label">Sale Price (optional)</div>
          <div className="pg-grid-3">
            <div>
              <label className="pg-label">Sale Price</label>
              <input className="pg-input" type="number" step="0.01" value={form.salePrice}
                onChange={e => set('salePrice', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="pg-label">Start</label>
              <input className="pg-input" type="date" value={form.saleStart}
                onChange={e => set('saleStart', e.target.value)} />
            </div>
            <div>
              <label className="pg-label">End</label>
              <input className="pg-input" type="date" value={form.saleEnd}
                onChange={e => set('saleEnd', e.target.value)} />
            </div>
          </div>

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

export default function ProductGroups() {
  const navigate = useNavigate();
  const [groups,      setGroups]      = useState([]);
  const [departments, setDepartments] = useState([]);
  const [vendors,     setVendors]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [showForm,    setShowForm]    = useState(false);
  const [editing,     setEditing]     = useState(null);
  const [applying,    setApplying]    = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, d, v] = await Promise.all([
        listProductGroups(),
        getCatalogDepartments(),
        getCatalogVendors(),
      ]);
      setGroups(g?.data || g || []);
      setDepartments(d?.data || d || []);
      setVendors(v?.data || v || []);
    } catch {
      toast.error('Failed to load groups');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = () => { setEditing(null); setShowForm(true); };
  const handleEdit = (g) => { setEditing(g); setShowForm(true); };

  const handleSave = async (payload) => {
    setSaving(true);
    try {
      if (editing) {
        const res = await updateProductGroup(editing.id, payload);
        if (res.cascaded > 0) {
          toast.success(`Group saved — cascaded to ${res.cascaded} product(s)`);
        } else {
          toast.success('Group saved');
        }
      } else {
        await createProductGroup(payload);
        toast.success('Group created');
      }
      setShowForm(false);
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (g) => {
    if (!window.confirm(`Delete group "${g.name}"? Member products will be unlinked but NOT deleted.`)) return;
    try {
      await deleteProductGroup(g.id);
      toast.success('Group deleted');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Delete failed');
    }
  };

  const handleApply = async (g) => {
    if (!window.confirm(`Apply template from "${g.name}" to all ${g._count?.products || 0} member products? This will overwrite their current classification and pricing fields.`)) return;
    setApplying(g.id);
    try {
      const res = await applyGroupTemplate(g.id);
      toast.success(`Applied to ${res.updated} product(s)`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Apply failed');
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><UsersIcon size={22} /></div>
          <div>
            <h1 className="p-title">Product Groups</h1>
            <p className="p-subtitle">Template groups with shared classification and pricing</p>
          </div>
        </div>
        <div className="p-header-actions">
          <button onClick={load} className="pc-refresh-btn" disabled={loading}>
            <RefreshCw size={14} />
          </button>
          <button onClick={handleCreate} className="pc-add-btn">
            <Plus size={14} /> New Group
          </button>
        </div>
      </div>

      {loading && (
        <div className="pg-loading"><Loader size={18} className="p-spin" /> Loading groups…</div>
      )}

      {!loading && groups.length === 0 && (
        <div className="pg-empty">
          <UsersIcon size={40} className="pg-empty-icon" />
          <div className="pg-empty-title">No product groups yet</div>
          <div className="pg-empty-desc">
            Create a group to share classification and pricing across multiple products.
            Great for "750ml Red Wine" or "12oz Can Beer" style groupings.
          </div>
          <button onClick={handleCreate} className="pc-empty-add-btn">
            <Plus size={14} /> Create First Group
          </button>
        </div>
      )}

      {!loading && groups.length > 0 && (
        <div className="pg-table-wrap">
          <table className="pg-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Department</th>
                <th>Tax / Age</th>
                <th>Price</th>
                <th>Sale</th>
                <th>Members</th>
                <th>Sync</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.id}>
                  <td>
                    <div className="pg-name-row">
                      {g.color && <span className="pg-color-chip" style={{ background: g.color }} />}
                      <strong>{g.name}</strong>
                    </div>
                    {g.description && <div className="pg-desc">{g.description}</div>}
                  </td>
                  <td>{g.department?.name || '—'}</td>
                  <td>
                    {g.taxClass ? <span className="pg-badge">{g.taxClass}</span> : '—'}
                    {g.ageRequired && <span className="pg-badge pg-badge-warn">{g.ageRequired}+</span>}
                  </td>
                  <td className="pg-td-mono">
                    {g.defaultRetailPrice != null ? `$${Number(g.defaultRetailPrice).toFixed(2)}` : '—'}
                  </td>
                  <td className="pg-td-mono">
                    {g.salePrice != null ? (
                      <span className="pg-sale"><DollarSign size={10} />{Number(g.salePrice).toFixed(2)}</span>
                    ) : '—'}
                  </td>
                  <td>
                    <span className="pg-member-count">{g._count?.products || 0}</span>
                  </td>
                  <td>
                    {g.autoSync ? (
                      <span className="pg-sync-on"><Check size={11} /> Auto</span>
                    ) : (
                      <span className="pg-sync-off">Manual</span>
                    )}
                  </td>
                  <td>
                    <div className="pg-actions">
                      {!g.autoSync && (
                        <button onClick={() => handleApply(g)} disabled={applying === g.id}
                          className="pg-btn-icon" title="Apply template to all members">
                          {applying === g.id ? <Loader size={13} className="p-spin" /> : <RefreshCw size={13} />}
                        </button>
                      )}
                      <button onClick={() => handleEdit(g)} className="pg-btn-icon" title="Edit">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => handleDelete(g)} className="pg-btn-icon pg-btn-icon-danger" title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <GroupForm
          group={editing}
          departments={departments}
          vendors={vendors}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditing(null); }}
          saving={saving}
        />
      )}
    </div>
  );
}
