// ─────────────────────────────────────────────────
// AdminPlans — S78
//
// List + edit subscription plans. Each plan controls which sidebar modules
// the org's users can access. Admin can also reach the Module catalog
// from here (top-right "Manage Modules" button).
// ─────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import {
  CreditCard, Plus, RefreshCw, Loader, Edit3, Trash2, Check, X, Star,
  Building2, Cpu, AlertCircle,
} from 'lucide-react';
import {
  adminListSubPlans, adminCreateSubPlan, adminUpdateSubPlan, adminDeleteSubPlan,
  adminListPlatformModules,
  type SubscriptionPlanRecord, type PlatformModuleRecord,
} from '../services/api';
import { useConfirm } from '../hooks/useConfirmDialog';
import './AdminPlans.css';

interface PlanFormState {
  id?: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  basePrice: string;
  annualPrice: string;
  isCustomPriced: boolean;
  includedStores: string;
  includedRegisters: string;
  maxUsers: string;
  trialDays: string;
  highlighted: boolean;
  isDefault: boolean;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: string;
  moduleIds: Set<string>;
}

const empty = (): PlanFormState => ({
  slug: '',
  name: '',
  tagline: '',
  description: '',
  basePrice: '0',
  annualPrice: '',
  isCustomPriced: false,
  includedStores: '1',
  includedRegisters: '1',
  maxUsers: '',
  trialDays: '14',
  highlighted: false,
  isDefault: false,
  isActive: true,
  isPublic: true,
  sortOrder: '0',
  moduleIds: new Set(),
});

function fromRecord(p: SubscriptionPlanRecord): PlanFormState {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    tagline: p.tagline || '',
    description: p.description || '',
    basePrice: String(p.basePrice ?? 0),
    annualPrice: p.annualPrice == null ? '' : String(p.annualPrice),
    isCustomPriced: !!p.isCustomPriced,
    includedStores: String(p.includedStores ?? 1),
    includedRegisters: String(p.includedRegisters ?? 1),
    maxUsers: p.maxUsers == null ? '' : String(p.maxUsers),
    trialDays: String(p.trialDays ?? 14),
    highlighted: !!p.highlighted,
    isDefault: !!p.isDefault,
    isActive: !!p.isActive,
    isPublic: !!p.isPublic,
    sortOrder: String(p.sortOrder ?? 0),
    moduleIds: new Set((p.modules || []).map(pm => pm.moduleId)),
  };
}

export default function AdminPlans() {
  const [plans, setPlans] = useState<SubscriptionPlanRecord[]>([]);
  const [moduleGroups, setModuleGroups] = useState<Record<string, PlatformModuleRecord[]>>({});
  const [allModules, setAllModules] = useState<PlatformModuleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState<PlanFormState>(empty());
  const confirm = useConfirm();

  const load = async () => {
    setLoading(true);
    try {
      const [p, m] = await Promise.all([adminListSubPlans(), adminListPlatformModules()]);
      setPlans(p.plans);
      setAllModules(m.modules);
      setModuleGroups(m.grouped);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load plans.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditor(empty()); setEditorOpen(true); };
  const openEdit = (p: SubscriptionPlanRecord) => { setEditor(fromRecord(p)); setEditorOpen(true); };

  const setF = (k: keyof PlanFormState, v: any) => setEditor(prev => ({ ...prev, [k]: v }));
  const toggleModule = (id: string) => setEditor(prev => {
    const next = new Set(prev.moduleIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { ...prev, moduleIds: next };
  });
  const selectAllInCategory = (cat: string) => setEditor(prev => {
    const next = new Set(prev.moduleIds);
    for (const m of moduleGroups[cat] || []) next.add(m.id);
    return { ...prev, moduleIds: next };
  });
  const clearAllInCategory = (cat: string) => setEditor(prev => {
    const next = new Set(prev.moduleIds);
    for (const m of moduleGroups[cat] || []) {
      // Never remove core modules — they're always granted regardless.
      if (m.isCore) continue;
      next.delete(m.id);
    }
    return { ...prev, moduleIds: next };
  });

  const handleSave = async () => {
    if (!editor.slug.trim() || !editor.name.trim()) {
      toast.error('Slug and Name are required.');
      return;
    }
    setSavingId(editor.id || 'new');
    const payload = {
      slug: editor.slug.trim(),
      name: editor.name.trim(),
      tagline: editor.tagline.trim() || null,
      description: editor.description.trim() || null,
      basePrice: Number(editor.basePrice) || 0,
      annualPrice: editor.annualPrice === '' ? null : Number(editor.annualPrice),
      isCustomPriced: editor.isCustomPriced,
      includedStores: Math.max(1, parseInt(editor.includedStores, 10) || 1),
      includedRegisters: Math.max(1, parseInt(editor.includedRegisters, 10) || 1),
      maxUsers: editor.maxUsers === '' ? null : Math.max(1, parseInt(editor.maxUsers, 10) || 1),
      trialDays: Math.max(0, parseInt(editor.trialDays, 10) || 0),
      highlighted: editor.highlighted,
      isDefault: editor.isDefault,
      isActive: editor.isActive,
      isPublic: editor.isPublic,
      sortOrder: parseInt(editor.sortOrder, 10) || 0,
      moduleIds: Array.from(editor.moduleIds),
    };
    try {
      if (editor.id) await adminUpdateSubPlan(editor.id, payload);
      else           await adminCreateSubPlan(payload);
      toast.success(`Plan ${editor.id ? 'updated' : 'created'}.`);
      setEditorOpen(false);
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Save failed.');
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (p: SubscriptionPlanRecord) => {
    const subCount = p._count?.subscriptions || 0;
    if (subCount > 0) {
      toast.error(`Cannot delete: ${subCount} org(s) currently subscribed. Move them first.`);
      return;
    }
    const ok = await confirm({
      title: `Deactivate "${p.name}"?`,
      message: 'The plan will be soft-deleted (active=false). It can be restored from the database if needed.',
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!ok) return;
    try {
      await adminDeleteSubPlan(p.id);
      toast.success('Plan deactivated.');
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Delete failed.');
    }
  };

  // Order categories by module sortOrder so the UI matches sidebar grouping.
  const orderedCategories = useMemo(() => {
    return Object.entries(moduleGroups)
      .sort(([, a], [, b]) => (a[0]?.sortOrder ?? 0) - (b[0]?.sortOrder ?? 0))
      .map(([cat]) => cat);
  }, [moduleGroups]);

  return (
    <div className="ap-page">
      <header className="ap-page-header">
        <div className="ap-page-icon"><CreditCard size={20} /></div>
        <div>
          <h1>Subscription Plans</h1>
          <p>Manage plans + the modules each plan unlocks for org sidebar + route access.</p>
        </div>
        <div className="ap-page-actions">
          <button className="ap-btn" onClick={load} disabled={loading} title="Refresh">
            <RefreshCw size={14} className={loading ? 'ap-spin' : ''} /> Refresh
          </button>
          <button className="ap-btn ap-btn-primary" onClick={openNew}>
            <Plus size={14} /> New Plan
          </button>
        </div>
      </header>

      {loading ? (
        <div className="ap-empty"><Loader size={20} className="ap-spin" /></div>
      ) : plans.length === 0 ? (
        <div className="ap-empty">
          <p>No plans yet. Run <code>npx tsx prisma/seedPlanModules.ts</code> to create the defaults.</p>
        </div>
      ) : (
        <div className="ap-grid">
          {plans.map(p => {
            const subs = p._count?.subscriptions || 0;
            const moduleCount = p.modules?.length ?? p._count?.modules ?? 0;
            const totalModules = allModules.filter(m => m.active).length;
            return (
              <div key={p.id} className={`ap-card ${p.highlighted ? 'is-highlighted' : ''} ${!p.isActive ? 'is-inactive' : ''}`}>
                <div className="ap-card-head">
                  <div>
                    <h3>{p.name}{p.isDefault && <span className="ap-pill"><Star size={10} /> Default</span>}{p.highlighted && <span className="ap-pill ap-pill--accent">Most Popular</span>}</h3>
                    <p className="ap-card-tagline">{p.tagline || p.description || '—'}</p>
                  </div>
                  <div className="ap-card-actions">
                    <button className="ap-icon-btn" onClick={() => openEdit(p)} title="Edit"><Edit3 size={13} /></button>
                    <button className="ap-icon-btn ap-icon-btn--danger" onClick={() => handleDelete(p)} title="Deactivate"><Trash2 size={13} /></button>
                  </div>
                </div>
                <div className="ap-card-pricing">
                  {p.isCustomPriced ? (
                    <div><span className="ap-price-big">Custom</span></div>
                  ) : (
                    <>
                      <div><span className="ap-price-big">${Number(p.basePrice).toFixed(0)}</span><span className="ap-price-sub">/month</span></div>
                      {p.annualPrice && <div className="ap-price-annual">${Number(p.annualPrice).toFixed(0)}/year billed annually</div>}
                    </>
                  )}
                </div>
                <div className="ap-card-stats">
                  <div><Building2 size={11} /> {p.includedStores === 9999 ? 'Unlimited' : p.includedStores} stores</div>
                  <div><Cpu size={11} /> {p.includedRegisters === 9999 ? 'Unlimited' : p.includedRegisters} registers</div>
                  <div><Cpu size={11} /> {p.maxUsers == null ? 'Unlimited' : `${p.maxUsers} users`}</div>
                </div>
                <div className="ap-card-modules">
                  <strong>{moduleCount}</strong> of {totalModules} modules enabled
                </div>
                {subs > 0 && <div className="ap-card-subs">{subs} active subscription(s)</div>}
              </div>
            );
          })}
        </div>
      )}

      {editorOpen && (
        <div className="ap-modal-backdrop" onClick={() => setEditorOpen(false)}>
          <div className="ap-modal" onClick={e => e.stopPropagation()}>
            <header className="ap-modal-head">
              <h3>{editor.id ? 'Edit Plan' : 'New Plan'}</h3>
              <button className="ap-icon-btn" onClick={() => setEditorOpen(false)}><X size={16} /></button>
            </header>
            <div className="ap-modal-body">
              <section className="ap-section">
                <h4>Identity</h4>
                <div className="ap-form-grid">
                  <Field label="Slug" required help="URL-safe ID — e.g. 'starter'. Cannot include spaces.">
                    <input className="ap-input" value={editor.slug} onChange={e => setF('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} disabled={!!editor.id} />
                  </Field>
                  <Field label="Name" required>
                    <input className="ap-input" value={editor.name} onChange={e => setF('name', e.target.value)} placeholder="Starter" />
                  </Field>
                  <Field label="Tagline" wide>
                    <input className="ap-input" value={editor.tagline} onChange={e => setF('tagline', e.target.value)} placeholder="One-line marketing pitch" />
                  </Field>
                  <Field label="Description" wide>
                    <textarea className="ap-input ap-textarea" rows={2} value={editor.description} onChange={e => setF('description', e.target.value)} />
                  </Field>
                </div>
              </section>

              <section className="ap-section">
                <h4>Pricing</h4>
                <div className="ap-form-grid">
                  <Field label="Custom-priced" help="Show 'Contact us for pricing' instead of $/month.">
                    <Toggle checked={editor.isCustomPriced} onChange={v => setF('isCustomPriced', v)} />
                  </Field>
                  {!editor.isCustomPriced && (
                    <>
                      <Field label="Base Price ($/mo)">
                        <input className="ap-input" type="number" step={0.01} value={editor.basePrice} onChange={e => setF('basePrice', e.target.value)} />
                      </Field>
                      <Field label="Annual Price ($)">
                        <input className="ap-input" type="number" step={0.01} value={editor.annualPrice} onChange={e => setF('annualPrice', e.target.value)} placeholder="Pre-discount yearly" />
                      </Field>
                    </>
                  )}
                </div>
              </section>

              <section className="ap-section">
                <h4>Limits</h4>
                <div className="ap-form-grid">
                  <Field label="Stores">
                    <input className="ap-input" type="number" min={1} value={editor.includedStores} onChange={e => setF('includedStores', e.target.value)} />
                  </Field>
                  <Field label="Registers/store">
                    <input className="ap-input" type="number" min={1} value={editor.includedRegisters} onChange={e => setF('includedRegisters', e.target.value)} />
                  </Field>
                  <Field label="Max Users (blank = unlimited)">
                    <input className="ap-input" type="number" min={1} value={editor.maxUsers} onChange={e => setF('maxUsers', e.target.value)} />
                  </Field>
                </div>
              </section>

              <section className="ap-section">
                <h4>Display</h4>
                <div className="ap-form-grid">
                  <Field label="Active"><Toggle checked={editor.isActive} onChange={v => setF('isActive', v)} /></Field>
                  <Field label="Public on pricing page"><Toggle checked={editor.isPublic} onChange={v => setF('isPublic', v)} /></Field>
                  <Field label="Highlighted (Most Popular)"><Toggle checked={editor.highlighted} onChange={v => setF('highlighted', v)} /></Field>
                  <Field label="Default for new orgs"><Toggle checked={editor.isDefault} onChange={v => setF('isDefault', v)} /></Field>
                  <Field label="Sort Order"><input className="ap-input" type="number" value={editor.sortOrder} onChange={e => setF('sortOrder', e.target.value)} /></Field>
                  <Field label="Trial Days"><input className="ap-input" type="number" min={0} value={editor.trialDays} onChange={e => setF('trialDays', e.target.value)} /></Field>
                </div>
              </section>

              <section className="ap-section">
                <h4>Modules ({editor.moduleIds.size} selected)</h4>
                <p className="ap-hint">Pick which sidebar modules this plan unlocks. <strong>Core modules</strong> are always granted regardless of selection.</p>
                <div className="ap-modules-wrap">
                  {orderedCategories.map(cat => {
                    const items = moduleGroups[cat] || [];
                    const categorySelected = items.every(m => editor.moduleIds.has(m.id));
                    return (
                      <div key={cat} className="ap-module-group">
                        <div className="ap-module-group-head">
                          <strong>{cat}</strong>
                          <div className="ap-module-group-actions">
                            <button className="ap-mini-btn" onClick={() => selectAllInCategory(cat)}>All</button>
                            <button className="ap-mini-btn" onClick={() => clearAllInCategory(cat)}>None</button>
                          </div>
                        </div>
                        <div className="ap-module-list">
                          {items.map(m => (
                            <label key={m.id} className={`ap-module-row ${editor.moduleIds.has(m.id) ? 'is-checked' : ''} ${m.isCore ? 'is-core' : ''}`}>
                              <input
                                type="checkbox"
                                checked={editor.moduleIds.has(m.id) || m.isCore}
                                disabled={m.isCore}
                                onChange={() => toggleModule(m.id)}
                              />
                              <div>
                                <div className="ap-module-name">
                                  {m.name}
                                  {m.isCore && <span className="ap-pill ap-pill--core">CORE</span>}
                                  {!m.active && <span className="ap-pill ap-pill--inactive">INACTIVE</span>}
                                </div>
                                {m.description && <div className="ap-module-desc">{m.description}</div>}
                                {m.routePaths.length > 0 && (
                                  <div className="ap-module-paths">{m.routePaths.join(', ')}</div>
                                )}
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
            <footer className="ap-modal-foot">
              <button className="ap-btn" onClick={() => setEditorOpen(false)}>Cancel</button>
              <button className="ap-btn ap-btn-primary" onClick={handleSave} disabled={savingId === (editor.id || 'new')}>
                {savingId === (editor.id || 'new') ? <Loader size={14} className="ap-spin" /> : <><Check size={14} /> {editor.id ? 'Save Changes' : 'Create Plan'}</>}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, required, help, wide, children }: { label: string; required?: boolean; help?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`ap-field ${wide ? 'is-wide' : ''}`}>
      <label>{label}{required && <span className="ap-req">*</span>}</label>
      {children}
      {help && <span className="ap-help">{help}</span>}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`ap-toggle ${checked ? 'is-on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="ap-toggle-track"><span className="ap-toggle-knob" /></span>
    </label>
  );
}
