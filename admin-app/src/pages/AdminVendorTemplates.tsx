/**
 * AdminVendorTemplates — Session 5 admin UI
 *
 * Superadmin-only page to manage VendorImportTemplate catalog. Templates are
 * global (platform-level), not tenant-scoped. Retailers pick from this list
 * when uploading vendor files at /portal/bulk-import.
 */

import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, X, Save, FileText, Check } from 'lucide-react';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import {
  getVendorTemplates,
  getVendorTemplate,
  createVendorTemplate,
  updateVendorTemplate,
  deleteVendorTemplate,
  getVendorTemplateTransforms,
} from '../services/api';
import './AdminVendorTemplates.css';

const TARGETS = ['products', 'promotions', 'deposits', 'invoice_costs'] as const;

type Target = typeof TARGETS[number];

// Canonical fields per target — shown as suggestions in the targetField input
const CANONICAL_FIELDS: Record<Target, string[]> = {
  products: [
    'upc', 'additionalUpcs', 'linkedUpc', 'sku', 'itemCode', 'plu',
    'name', 'brand', 'size', 'sizeUnit', 'description', 'imageUrl',
    'departmentId', 'vendorId', 'productGroupId', 'taxClass',
    'unitPack', 'packInCase', 'packOptions',
    'defaultCostPrice', 'defaultRetailPrice', 'defaultCasePrice',
    'depositPerUnit', 'caseDeposit',
    'ebtEligible', 'ageRequired', 'taxable', 'discountEligible', 'wicEligible',
    'quantityOnHand', 'reorderPoint', 'reorderQty', 'trackInventory',
    'specialPrice', 'specialCost', 'saleMultiple', 'regMultiple', 'startDate', 'endDate',
    'tprRetail', 'tprCost', 'tprMultiple', 'tprStartDate', 'tprEndDate',
    'futureRetail', 'futureCost', 'futureActiveDate', 'futureMultiple',
    'priceMethod', 'hideFromEcom', 'ecomDescription', 'ecomPrice', 'ecomSalePrice', 'ecomExternalId', 'ecomPackWeight',
    'attributes', 'active',
  ],
  promotions: [
    'name', 'promo_type', 'discount_type', 'discount_value',
    'min_qty', 'buy_qty', 'get_qty',
    'product_upcs', 'department_ids',
    'badge_label', 'badge_color',
    'startDate', 'endDate', 'active',
    'originalPrice',
  ],
  deposits: [
    'name', 'depositAmount', 'minVolumeOz', 'maxVolumeOz', 'containerTypes', 'state', 'active',
  ],
  invoice_costs: ['upc', 'cost', 'casePrice', 'caseQty', 'receivedQty', 'vendorId'],
};

interface Mapping {
  vendorColumn: string;
  targetField?: string | null;
  transform?: string | null;
  // Wire-side is `unknown` (a parsed JSON object); form-side is a string (stringified).
  // The editor coerces from one to the other inline — see `JSON.stringify` in TemplateEditor.
  transformArgs?: unknown;
  constantValue?: string | null;
  skip?: boolean;
  sortOrder: number;
}

interface Template {
  id?: string | number;
  name?: string;
  slug?: string;
  description?: string;
  // Backend `target` is an open string but the UI narrows to `Target` via the
  // dropdown; callers can safely cast when editing.
  target?: string;
  vendorHint?: string;
  active?: boolean;
  mappings?: Mapping[];
  _count?: { mappings?: number };
  isNew?: boolean;
}

interface Transform {
  name: string;
}

export default function AdminVendorTemplates() {
  const [templates, setTemplates]     = useState<Template[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [editing, setEditing]         = useState<Template | null>(null);
  const [transforms, setTransforms]   = useState<Transform[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, xRes] = await Promise.all([
        getVendorTemplates(),
        getVendorTemplateTransforms(),
      ]);
      setTemplates(tRes?.data || []);
      setTransforms(xRes?.data || []);
    } catch {
      toast.error('Failed to load templates');
      setTemplates([]); setTransforms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = async (tmpl: Template) => {
    if (tmpl.id === undefined) return;
    try {
      const full = await getVendorTemplate(tmpl.id);
      setEditing(full.data);
    } catch {
      toast.error('Failed to load template');
    }
  };

  const openNew = () => {
    setEditing({
      isNew: true,
      name: '', slug: '', description: '',
      target: 'products', vendorHint: '', active: true,
      mappings: [
        { vendorColumn: '', targetField: '', transform: '', transformArgs: '', constantValue: '', skip: false, sortOrder: 0 },
      ],
    });
  };

  const handleDelete = async (tmpl: Template) => {
    if (tmpl.id === undefined) return;
    if (!window.confirm(`Delete "${tmpl.name}"? This cannot be undone.`)) return;
    try {
      await deleteVendorTemplate(tmpl.id);
      toast.success(`Template "${tmpl.name}" deleted`);
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Delete failed');
    }
  };

  const filtered = templates.filter(t => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      t.name?.toLowerCase().includes(q) ||
      t.slug?.toLowerCase().includes(q) ||
      t.vendorHint?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="admin-page">
      <ToastContainer position="top-right" autoClose={3000} />

      <div className="admin-header">
        <div className="admin-header-left">
          <div className="admin-header-icon">
            <FileText size={20} />
          </div>
          <div>
            <h1 className="admin-title">Vendor Import Templates</h1>
            <p className="admin-subtitle">Curated mapping profiles retailers pick at upload time.</p>
          </div>
        </div>
        <div className="avt-header-actions">
          <input
            type="text"
            className="avt-search"
            placeholder="Search name, slug, vendor…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="avt-create-btn" onClick={openNew}>
            <Plus size={14} /> New Template
          </button>
        </div>
      </div>

      <div className="admin-card">
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            {search ? 'No templates match your search.' : 'No templates yet. Click "New Template" or run the seed.'}
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Target</th>
                  <th>Mappings</th>
                  <th>Vendor Hint</th>
                  <th>Active</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{t.name}</div>
                      <div className="avt-slug">{t.slug}</div>
                      {t.description && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{t.description}</div>}
                    </td>
                    <td><span className={`avt-target-pill avt-target-${t.target}`}>{t.target}</span></td>
                    <td>{t._count?.mappings ?? '—'}</td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t.vendorHint || '—'}</td>
                    <td>{t.active ? <Check size={16} color="#10b981" /> : <X size={16} color="#94a3b8" />}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="admin-btn-icon" onClick={() => openEdit(t)} title="Edit">
                        <Edit2 size={14} />
                      </button>
                      <button className="admin-btn-icon" onClick={() => handleDelete(t)} title="Delete" style={{ color: '#ef4444' }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <TemplateEditor
          template={editing}
          transforms={transforms}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

// ─── Template editor modal ──────────────────────────────────────────────────

interface TemplateEditorProps {
  template: Template;
  transforms: Transform[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

interface EditorForm {
  name: string;
  slug: string;
  description: string;
  target: Target;
  vendorHint: string;
  active: boolean;
  mappings: Mapping[];
}

function TemplateEditor({ template, transforms, onClose, onSaved }: TemplateEditorProps) {
  const [form, setForm] = useState<EditorForm>(() => ({
    name:        template.name || '',
    slug:        template.slug || '',
    description: template.description || '',
    target:      (template.target || 'products') as Target,
    vendorHint:  template.vendorHint || '',
    active:      template.active !== false,
    mappings:    (template.mappings || []).map((m, i) => ({
      ...m,
      transformArgs: m.transformArgs ? (typeof m.transformArgs === 'string' ? m.transformArgs : JSON.stringify(m.transformArgs)) : '',
      sortOrder: m.sortOrder ?? i,
    })),
  }));
  const [saving, setSaving] = useState(false);
  const isNew = !!template.isNew;

  const set = <K extends keyof EditorForm>(k: K, v: EditorForm[K]) => setForm(f => ({ ...f, [k]: v }));
  const setMap = (idx: number, k: keyof Mapping, v: unknown) =>
    setForm(f => ({ ...f, mappings: f.mappings.map((m, i) => i === idx ? { ...m, [k]: v } as Mapping : m) }));
  const addMap = () => setForm(f => ({
    ...f,
    mappings: [...f.mappings, { vendorColumn: '', targetField: '', transform: '', transformArgs: '', constantValue: '', skip: false, sortOrder: f.mappings.length }],
  }));
  const delMap = (idx: number) => setForm(f => ({ ...f, mappings: f.mappings.filter((_, i) => i !== idx) }));

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!form.target)      { toast.error('Target is required'); return; }

    // Parse transformArgs JSON strings before sending
    let preparedMappings;
    try {
      preparedMappings = form.mappings.map(m => {
        let parsedArgs: unknown = null;
        if (m.transformArgs && String(m.transformArgs).trim()) {
          try { parsedArgs = JSON.parse(String(m.transformArgs)); }
          catch { throw new Error(`Invalid JSON in transform args for column "${m.vendorColumn}"`); }
        }
        return {
          vendorColumn:  m.vendorColumn,
          targetField:   m.targetField || null,
          transform:     m.transform || null,
          transformArgs: parsedArgs,
          constantValue: m.constantValue || null,
          skip:          !!m.skip,
          sortOrder:     m.sortOrder,
        };
      });
    } catch (e: any) {
      toast.error(e?.message || 'Invalid transform args');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name,
        slug: form.slug || undefined,
        description: form.description || null,
        target: form.target,
        vendorHint: form.vendorHint || null,
        active: form.active,
        mappings: preparedMappings,
      };
      if (isNew) {
        await createVendorTemplate(payload);
        toast.success('Template created');
      } else if (template.id !== undefined) {
        await updateVendorTemplate(template.id, payload);
        toast.success('Template saved');
      }
      await onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const fieldSuggestions = CANONICAL_FIELDS[form.target] || [];

  return (
    <div className="avt-modal-overlay" onClick={onClose}>
      <div className="avt-modal" onClick={e => e.stopPropagation()}>
        <div className="avt-modal-header">
          <div>
            <div className="avt-modal-title">{isNew ? 'New Vendor Template' : `Edit: ${template.name}`}</div>
            <div className="avt-modal-subtitle">{form.mappings.length} column mapping{form.mappings.length === 1 ? '' : 's'}</div>
          </div>
          <button className="avt-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="avt-modal-body">
          <div className="avt-form-row">
            <div>
              <label className="avt-label">Name *</label>
              <input className="avt-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. AGNE — Wholesale" />
            </div>
            <div>
              <label className="avt-label">Slug (auto if blank)</label>
              <input className="avt-input" value={form.slug} onChange={e => set('slug', e.target.value)} placeholder="e.g. agne" />
            </div>
          </div>

          <div className="avt-form-row-3">
            <div>
              <label className="avt-label">Description</label>
              <input className="avt-input" value={form.description} onChange={e => set('description', e.target.value)} placeholder="One-line hint for retailers" />
            </div>
            <div>
              <label className="avt-label">Target *</label>
              <select className="avt-select" value={form.target} onChange={e => set('target', e.target.value as Target)}>
                {TARGETS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="avt-label">Active</label>
              <select className="avt-select" value={form.active ? 'yes' : 'no'} onChange={e => set('active', e.target.value === 'yes')}>
                <option value="yes">Active</option>
                <option value="no">Inactive</option>
              </select>
            </div>
          </div>

          <div>
            <label className="avt-label">Vendor Hint (optional, comma-separated)</label>
            <input className="avt-input" value={form.vendorHint} onChange={e => set('vendorHint', e.target.value)} placeholder="e.g. AGNE, Associated Grocers, WHS11209" />
          </div>

          <div className="avt-mappings-header">
            <div className="avt-mappings-title">Column Mappings</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              <code>Skip</code> ignores a column · empty <code>Target Field</code> drops it
            </div>
          </div>
          <div className="avt-mappings-help">
            Transform runs on the raw vendor value. <code>transform_args</code> is JSON, e.g. <code>{'{"prefix":"_"}'}</code> for strip_prefix or <code>{'{"by":"pack"}'}</code> for multiply_by_col.
          </div>

          <div className="avt-mappings-table">
            <div className="avt-mappings-head">
              <div>Vendor Column</div>
              <div>Target Field</div>
              <div>Transform</div>
              <div>Transform Args (JSON)</div>
              <div>Constant</div>
              <div>Skip</div>
              <div></div>
            </div>
            {form.mappings.map((m, idx) => (
              <div key={idx} className={`avt-mapping-row ${m.skip ? 'avt-mapping-row--skip' : ''}`}>
                <input
                  value={m.vendorColumn}
                  onChange={e => setMap(idx, 'vendorColumn', e.target.value)}
                  placeholder="e.g. REG_RETAIL"
                />
                <input
                  value={m.targetField || ''}
                  onChange={e => setMap(idx, 'targetField', e.target.value)}
                  placeholder="e.g. defaultRetailPrice"
                  list={`avt-fields-${idx}`}
                  disabled={m.skip}
                />
                <datalist id={`avt-fields-${idx}`}>
                  {fieldSuggestions.map(f => <option key={f} value={f} />)}
                </datalist>
                <select
                  value={m.transform || ''}
                  onChange={e => setMap(idx, 'transform', e.target.value)}
                  disabled={m.skip}
                >
                  <option value="">(none)</option>
                  {transforms.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
                <input
                  value={typeof m.transformArgs === 'string' ? m.transformArgs : (m.transformArgs ? JSON.stringify(m.transformArgs) : '')}
                  onChange={e => setMap(idx, 'transformArgs', e.target.value)}
                  placeholder='e.g. {"prefix":"_"}'
                  disabled={m.skip || !m.transform}
                />
                <input
                  value={m.constantValue || ''}
                  onChange={e => setMap(idx, 'constantValue', e.target.value)}
                  placeholder="literal value"
                  disabled={m.skip}
                />
                <input
                  type="checkbox"
                  className="avt-skip-chk"
                  checked={!!m.skip}
                  onChange={e => setMap(idx, 'skip', e.target.checked)}
                />
                <button className="avt-del-btn" onClick={() => delMap(idx)} title="Remove mapping"><Trash2 size={12} /></button>
              </div>
            ))}
          </div>

          <button className="avt-add-mapping" onClick={addMap}>
            <Plus size={14} /> Add Mapping Row
          </button>
        </div>

        <div className="avt-modal-footer">
          <button className="avt-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="avt-btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {saving ? 'Saving…' : (isNew ? 'Create Template' : 'Save Changes')}
          </button>
        </div>
      </div>
    </div>
  );
}
