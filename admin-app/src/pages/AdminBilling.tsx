/**
 * AdminBilling.tsx
 * Superadmin billing console — 4 tabs:
 *   Plans        — subscription plan + add-on CRUD
 *   Subscriptions — per-org subscription overview & overrides
 *   Invoices     — billing history, retry, write-off
 *   Equipment    — hardware products & order fulfillment
 */

import { useState, useEffect, useCallback, FormEvent, ReactNode } from 'react';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import {
  Plus, Edit3, Trash2, RefreshCw, Loader, Save, X,
  ChevronLeft, ChevronRight, Package, FileText,
  CreditCard, Building2, Ban, Eye,
} from 'lucide-react';
import { toast } from 'react-toastify';

import {
  getAdminOrganizations,
  adminListPlans, adminCreatePlan, adminUpdatePlan, adminDeletePlan,
  adminCreateAddon, adminUpdateAddon,
  adminListSubscriptions, adminUpsertSubscription,
  adminListInvoices, adminWriteOffInvoice, adminRetryInvoice,
  adminListEquipmentOrders, adminUpdateEquipmentOrder,
  adminListEquipmentProducts, adminCreateEquipmentProduct, adminUpdateEquipmentProduct,
  adminDeleteEquipmentProduct, adminUploadEquipmentImage,
  // S78 — sidebar-module assignment for plans
  adminListPlatformModules, adminListSubPlans, adminGetSubPlan, adminUpdateSubPlan, adminCreateSubPlan,
  type PlatformModuleRecord,
} from '../services/api';
import type {
  BillingPlan as Plan,
  BillingAddon as Addon,
  Subscription,
  BillingInvoice as Invoice,
  EquipmentProduct as Product,
  EquipmentOrder,
  EquipmentOrderItem as OrderItem,
  SubscriptionStatus as SubStatus,
} from '@storeveu/types';
import '../styles/admin.css';
import './AdminBilling.css';

// ── Shared helpers ────────────────────────────────────────────────────────────

const fmtDate = (d?: string | Date | null): string => d ? new Date(d).toLocaleDateString() : '—';
const fmtMoney = (n: number | string | null | undefined): string => n != null ? `$${Number(n).toFixed(2)}` : '—';

interface BadgeColor { bg: string; border: string; text: string }

const BADGE_COLORS: Record<string, BadgeColor> = {
  trial:       { bg: 'rgba(59,130,246,.13)',  border: 'rgba(59,130,246,.3)',  text: '#3b82f6' },
  active:      { bg: 'rgba(34,197,94,.13)',   border: 'rgba(34,197,94,.3)',   text: '#22c55e' },
  past_due:    { bg: 'rgba(249,115,22,.13)',  border: 'rgba(249,115,22,.3)',  text: '#f97316' },
  suspended:   { bg: 'rgba(239,68,68,.13)',   border: 'rgba(239,68,68,.3)',   text: '#ef4444' },
  cancelled:   { bg: 'rgba(148,163,184,.13)', border: 'rgba(148,163,184,.3)', text: '#94a3b8' },
  paid:        { bg: 'rgba(34,197,94,.13)',   border: 'rgba(34,197,94,.3)',   text: '#22c55e' },
  failed:      { bg: 'rgba(239,68,68,.13)',   border: 'rgba(239,68,68,.3)',   text: '#ef4444' },
  pending:     { bg: 'rgba(148,163,184,.13)', border: 'rgba(148,163,184,.3)', text: '#94a3b8' },
  written_off: { bg: 'rgba(148,163,184,.1)',  border: 'rgba(148,163,184,.2)', text: '#94a3b8' },
  processing:  { bg: 'rgba(59,130,246,.13)',  border: 'rgba(59,130,246,.3)',  text: '#3b82f6' },
  shipped:     { bg: 'rgba(168,85,247,.13)',  border: 'rgba(168,85,247,.3)',  text: '#a855f7' },
  delivered:   { bg: 'rgba(34,197,94,.13)',   border: 'rgba(34,197,94,.3)',   text: '#22c55e' },
};

interface BadgeProps { val?: string | null }

function Badge({ val }: BadgeProps) {
  const c = (val && BADGE_COLORS[val]) || BADGE_COLORS.pending;
  return (
    <span className="ab-badge" style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
      <span className="ab-badge-dot" style={{ background: c.text }} />
      {val?.replace('_',' ')}
    </span>
  );
}

interface ToggleProps { checked: boolean; onChange: (v: boolean) => void }

function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <div onClick={() => onChange(!checked)} className={`ab-toggle ${checked ? 'ab-toggle--on' : 'ab-toggle--off'}`}>
      <div className={`ab-toggle-knob ${checked ? 'ab-toggle-knob--on' : 'ab-toggle-knob--off'}`} />
    </div>
  );
}

// ── PLANS TAB ─────────────────────────────────────────────────────────────────

// PlanForm is the local form-state shape — the shared Plan type has
// description? optional but the form always maintains a string (may be "").
interface PlanForm {
  name: string;
  slug: string;
  description: string;
  // S78 — marketing/display fields (also live in /admin/plans S78 page; surfaced here too).
  tagline: string;
  annualPrice: number | string;   // pre-discounted yearly amount; '' = blank
  isCustomPriced: boolean;
  highlighted: boolean;
  isDefault: boolean;
  maxUsers: number | string;       // '' = unlimited
  currency: string;
  // ── Pricing ──
  basePrice: number | string;
  pricePerStore: number | string;
  pricePerRegister: number | string;
  // ── Quotas ──
  includedStores: number;
  includedRegisters: number;
  trialDays: number;
  // ── Display ──
  isPublic: boolean;
  isActive: boolean;
  includedAddons: string[];
  sortOrder: number;
  // ── S78 sidebar-module entitlement (kept as Set for fast toggling) ──
  moduleIds: Set<string>;
}

interface AddonForm {
  key: string;
  name: string;
  description: string;
  monthlyPrice: number | string;
  sortOrder: number;
}

const EMPTY_PLAN: PlanForm = {
  name:'', slug:'', description:'',
  tagline:'', annualPrice:'', isCustomPriced:false, highlighted:false, isDefault:false,
  maxUsers:'', currency:'USD',
  basePrice:'', pricePerStore:0, pricePerRegister:0,
  includedStores:1, includedRegisters:1, trialDays:14,
  isPublic:true, isActive:true, includedAddons:[], sortOrder:0,
  moduleIds: new Set<string>(),
};

const toSlug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function PlansTab() {
  const confirm = useConfirm();
  const [plans,    setPlans]    = useState<Plan[]>([]);
  const [addons,   setAddons]   = useState<Addon[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [editPlan, setEditPlan] = useState<Plan | 'new' | null>(null);
  const [form,     setForm]     = useState<PlanForm>({ ...EMPTY_PLAN, moduleIds: new Set<string>() });
  const [saving,   setSaving]   = useState(false);
  const [showAddonForm, setShowAddonForm] = useState(false);
  const [addonForm, setAddonForm] = useState<AddonForm>({ key:'', name:'', description:'', monthlyPrice:'', sortOrder:0 });
  const [editAddonId, setEditAddonId] = useState<string | number | null>(null);

  // S78 — sidebar modules (catalog + per-plan assignment)
  const [allModules, setAllModules] = useState<PlatformModuleRecord[]>([]);
  const [moduleGroups, setModuleGroups] = useState<Record<string, PlatformModuleRecord[]>>({});
  const [moduleCounts, setModuleCounts] = useState<Record<string, number>>({});
  const [loadingPlanModules, setLoadingPlanModules] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminListPlans();
      setPlans(r?.plans || []);
      setAddons(r?.addons || []);
    } catch { toast.error('Failed to load plans'); }
    finally { setLoading(false); }
    // S78 — load module catalog + per-plan module counts (best-effort, non-fatal)
    try {
      const m = await adminListPlatformModules();
      setAllModules(m.modules || []);
      setModuleGroups(m.grouped || {});
      // Fetch per-plan module count from the S78 list endpoint (cheap — `_count.modules`).
      const subList = await adminListSubPlans();
      const counts: Record<string, number> = {};
      for (const p of subList.plans) {
        counts[p.id] = p._count?.modules ?? p.modules?.length ?? 0;
      }
      setModuleCounts(counts);
    } catch (err) {
      console.warn('[AdminBilling] Failed to load module catalog', err);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = async (plan: Plan | 'new') => {
    setEditPlan(plan);
    if (plan === 'new') {
      setForm({ ...EMPTY_PLAN, moduleIds: new Set<string>() });
      return;
    }
    // The legacy /admin/billing/plans response only carries the BillingPlan
    // shape — S78 fields (tagline / annualPrice / isCustomPriced / etc.) live
    // on the same SubscriptionPlan row but aren't typed there. Use a permissive
    // cast so we can read them when present without breaking older data.
    const ext = plan as unknown as Record<string, unknown>;
    setForm({
      name: plan.name, slug: plan.slug||'', description: plan.description||'',
      tagline:        typeof ext.tagline === 'string' ? ext.tagline : '',
      annualPrice:    ext.annualPrice == null ? '' : String(ext.annualPrice),
      isCustomPriced: !!ext.isCustomPriced,
      highlighted:    !!ext.highlighted,
      isDefault:      !!ext.isDefault,
      maxUsers:       ext.maxUsers == null ? '' : String(ext.maxUsers),
      currency:       typeof ext.currency === 'string' ? ext.currency : 'USD',
      basePrice: plan.basePrice,
      pricePerStore: plan.pricePerStore||0, pricePerRegister: plan.pricePerRegister||0,
      includedStores: plan.includedStores||1, includedRegisters: plan.includedRegisters||1,
      trialDays: plan.trialDays, isPublic: plan.isPublic, isActive: plan.isActive, sortOrder: plan.sortOrder,
      includedAddons: Array.isArray(plan.includedAddons) ? plan.includedAddons : [],
      moduleIds: new Set<string>(),
    });
    // Lazy-load currently-assigned modules for this plan from S78 endpoint.
    setLoadingPlanModules(true);
    try {
      const r = await adminGetSubPlan(plan.id as string);
      const ids = (r.plan.modules || []).map(pm => pm.moduleId);
      setForm(f => ({ ...f, moduleIds: new Set(ids) }));
    } catch (err) {
      console.warn('[AdminBilling] Failed to load plan modules', err);
    } finally {
      setLoadingPlanModules(false);
    }
  };

  const toggleModule = (id: string) => setForm(f => {
    const next = new Set(f.moduleIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { ...f, moduleIds: next };
  });
  const selectAllInCategory = (cat: string) => setForm(f => {
    const next = new Set(f.moduleIds);
    for (const m of moduleGroups[cat] || []) next.add(m.id);
    return { ...f, moduleIds: next };
  });
  const clearAllInCategory = (cat: string) => setForm(f => {
    const next = new Set(f.moduleIds);
    for (const m of moduleGroups[cat] || []) {
      if (m.isCore) continue; // never remove core
      next.delete(m.id);
    }
    return { ...f, moduleIds: next };
  });

  const handleSavePlan = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Build the payload. The legacy billing API only writes the columns it
      // knows about (now safely whitelisted server-side). We drop:
      // - `moduleIds`     — S78 module entitlement, persisted via PATCH /admin/plans/:id below
      // - `includedAddons` — UI-only display state; addons are managed via the separate
      //                     /admin/billing/addons endpoints + the PlanAddon join table.
      const { moduleIds: _omitModuleIds, includedAddons: _omitAddons, ...billingFields } = form;
      const payload = {
        ...billingFields,
        basePrice:        Number(form.basePrice),
        pricePerStore:    Number(form.pricePerStore)    || 0,
        pricePerRegister: Number(form.pricePerRegister) || 0,
        includedStores:   Number(form.includedStores)   || 1,
        includedRegisters:Number(form.includedRegisters)|| 1,
        sortOrder:        Number(form.sortOrder)         || 0,
        // S78 marketing/display fields
        tagline:          form.tagline || null,
        annualPrice:      form.annualPrice === '' ? null : Number(form.annualPrice),
        isCustomPriced:   !!form.isCustomPriced,
        highlighted:      !!form.highlighted,
        isDefault:        !!form.isDefault,
        maxUsers:         form.maxUsers === '' ? null : Number(form.maxUsers),
        currency:         form.currency || 'USD',
      };
      const moduleIdArray = Array.from(form.moduleIds);
      if (editPlan === 'new') {
        // For new plans, use the S78 create endpoint so we can pass
        // moduleIds in a single round-trip. The shape lines up because
        // the underlying SubscriptionPlan model is shared.
        await adminCreateSubPlan({
          slug: payload.slug,
          name: payload.name,
          description: payload.description || null,
          tagline: payload.tagline,
          basePrice: payload.basePrice,
          annualPrice: payload.annualPrice,
          isCustomPriced: payload.isCustomPriced,
          currency: payload.currency,
          pricePerStore: payload.pricePerStore,
          pricePerRegister: payload.pricePerRegister,
          includedStores: payload.includedStores,
          includedRegisters: payload.includedRegisters,
          maxUsers: payload.maxUsers,
          trialDays: payload.trialDays,
          isPublic: payload.isPublic,
          isActive: payload.isActive,
          highlighted: payload.highlighted,
          isDefault: payload.isDefault,
          sortOrder: payload.sortOrder,
          moduleIds: moduleIdArray,
        });
        toast.success('Plan created');
      } else if (editPlan) {
        // Editing — write billing-specific fields via the legacy PUT, then
        // fan out the module assignment via S78 PATCH. Both target the
        // same SubscriptionPlan row, so they compose cleanly.
        await adminUpdatePlan(editPlan.id, payload);
        try {
          await adminUpdateSubPlan(editPlan.id as string, { moduleIds: moduleIdArray });
        } catch (err: any) {
          // Surface the module-save error but don't lose the billing-side
          // success — the user can retry just the modules.
          console.warn('[AdminBilling] Module assignment save failed', err);
          toast.warning('Plan saved, but module assignment failed. Try again.');
          throw err;
        }
        toast.success('Plan updated');
      }
      setEditPlan(null);
      load();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const handleDeletePlan = async (plan: Plan) => {
    if (!await confirm({
      title: 'Delete plan?',
      message: `Delete plan "${plan.name}"?`,
      confirmLabel: 'Delete',
      danger: true,
    })) return;
    try {
      await adminDeletePlan(plan.id);
      toast.success('Plan deleted');
      load();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Delete failed'); }
  };

  const toggleAddon = (key: string) => {
    setForm(f => ({
      ...f,
      includedAddons: f.includedAddons.includes(key)
        ? f.includedAddons.filter(k => k !== key)
        : [...f.includedAddons, key],
    }));
  };

  const handleSaveAddon = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (editAddonId) {
        await adminUpdateAddon(editAddonId, { ...addonForm, monthlyPrice: Number(addonForm.monthlyPrice) });
        toast.success('Add-on updated');
      } else {
        await adminCreateAddon({ ...addonForm, monthlyPrice: Number(addonForm.monthlyPrice) });
        toast.success('Add-on created');
      }
      setShowAddonForm(false);
      setEditAddonId(null);
      setAddonForm({ key:'', name:'', description:'', monthlyPrice:'', sortOrder:0 });
      load();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Save failed'); }
  };

  const startEditAddon = (addon: Addon) => {
    setEditAddonId(addon.id);
    setAddonForm({ key: addon.key, name: addon.name, description: addon.description||'',
      monthlyPrice: addon.monthlyPrice, sortOrder: addon.sortOrder });
    setShowAddonForm(true);
  };

  if (loading) return <div className="ab-loading"><Loader size={16} className="spin" /> Loading...</div>;

  return (
    <div className={`ab-plans-grid ${editPlan ? 'ab-plans-grid--with-panel' : ''}`}>
      {/* Plans list */}
      <div>
        <div className="ab-section-header">
          <h3 className="ab-section-title">Subscription Plans</h3>
          <button className="admin-btn admin-btn-primary" onClick={() => startEdit('new')}><Plus size={13} /> New Plan</button>
        </div>
        <div className="ab-plan-list">
          {plans.map(plan => (
            <div key={plan.id} className="ab-plan-card">
              <div className="ab-plan-card-top">
                <div>
                  <div className="ab-plan-name-row">
                    <span className="ab-plan-name">{plan.name}</span>
                    {!plan.isActive && <Badge val="cancelled" />}
                    {!plan.isPublic && <span className="ab-private-badge">Private</span>}
                  </div>
                  <div className="ab-plan-desc">{plan.description}</div>
                  <div className="ab-plan-meta">
                    <span className="ab-plan-price">{fmtMoney(plan.basePrice)}<span className="ab-plan-price-unit">/mo</span></span>
                    <span>Up to {plan.includedStores} store{plan.includedStores !== 1 ? 's' : ''}</span>
                    <span>{plan.includedRegisters} register{plan.includedRegisters !== 1 ? 's' : ''}</span>
                    <span>{plan.trialDays}d trial</span>
                  </div>
                  {Array.isArray(plan.includedAddons) && plan.includedAddons.length > 0 && (
                    <div className="ab-addon-tags">
                      {plan.includedAddons.map((k: string) => (
                        <span key={k} className="ab-addon-tag">{k}</span>
                      ))}
                    </div>
                  )}
                  {/* S78 — module assignment count chip */}
                  {moduleCounts[plan.id as string] !== undefined && (
                    <div className="ab-modules-chip-row">
                      <span className="ab-modules-chip">
                        {moduleCounts[plan.id as string]} sidebar module{moduleCounts[plan.id as string] === 1 ? '' : 's'}
                      </span>
                    </div>
                  )}
                </div>
                <div className="ab-plan-actions">
                  <div className="admin-row-actions">
                    <button onClick={() => startEdit(plan)} className="admin-btn-icon" title="Edit"><Edit3 size={14} /></button>
                    <button onClick={() => handleDeletePlan(plan)} className="admin-btn-icon danger" title="Delete"><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {plans.length === 0 && <div className="ab-empty">No plans yet — create your first plan</div>}
        </div>

        {/* Add-ons section */}
        <div className="ab-addon-section">
          <div className="ab-addon-section-header">
            <h3 className="ab-section-title">Add-ons</h3>
            <button className="admin-btn admin-btn-secondary" onClick={() => { setShowAddonForm(s=>!s); setEditAddonId(null); setAddonForm({ key:'', name:'', description:'', monthlyPrice:'', sortOrder:0 }); }}><Plus size={13} /> Add Add-on</button>
          </div>
          {showAddonForm && (
            <form onSubmit={handleSaveAddon} className="ab-addon-form">
              <div className="ab-addon-form-grid">
                <div><label className="ab-label">Key (unique)</label><input className="ab-input" value={addonForm.key} onChange={e=>setAddonForm(f=>({...f,key:e.target.value}))} placeholder="ecomm" required disabled={!!editAddonId} /></div>
                <div><label className="ab-label">Name</label><input className="ab-input" value={addonForm.name} onChange={e=>setAddonForm(f=>({...f,name:e.target.value}))} placeholder="Website & eCommerce" required /></div>
                <div><label className="ab-label">Monthly Price ($)</label><input className="ab-input" type="number" step="0.01" value={addonForm.monthlyPrice} onChange={e=>setAddonForm(f=>({...f,monthlyPrice:e.target.value}))} placeholder="29.00" required /></div>
                <div><label className="ab-label">Description</label><input className="ab-input" value={addonForm.description} onChange={e=>setAddonForm(f=>({...f,description:e.target.value}))} /></div>
              </div>
              <div className="ab-form-actions">
                <button type="submit" className="admin-btn admin-btn-primary"><Save size={13} /> Save Add-on</button>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setShowAddonForm(false)}>Cancel</button>
              </div>
            </form>
          )}
          <div className="admin-table-wrapper ab-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Key</th><th>Name</th><th>Price/mo</th><th>Active</th><th>Actions</th></tr></thead>
              <tbody>
                {addons.map(a => (
                  <tr key={a.id}>
                    <td><code className="ab-code">{a.key}</code></td>
                    <td className="ab-cell-bold">{a.name}</td>
                    <td className="ab-cell-money">{fmtMoney(a.monthlyPrice)}</td>
                    <td><Badge val={a.isActive ? 'active' : 'cancelled'} /></td>
                    <td>
                      <div className="admin-row-actions">
                        <button onClick={() => startEditAddon(a)} className="admin-btn-icon" title="Edit"><Edit3 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {addons.length === 0 && <tr><td colSpan={5} className="ab-empty">No add-ons yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit plan panel */}
      {editPlan && (
        <div className="ab-side-panel">
          <div className="ab-panel-header">
            <h3 className="ab-panel-title">{editPlan === 'new' ? 'New Plan' : 'Edit Plan'}</h3>
            <button onClick={() => setEditPlan(null)} className="ab-panel-close"><X size={16} /></button>
          </div>
          <form onSubmit={handleSavePlan}>
            <div className="ab-form-col">
              <div>
                <label className="ab-label">Plan Name *</label>
                <input className="ab-input" value={form.name} onChange={e=>setForm(f=>({...f, name:e.target.value, slug: editPlan==='new' ? toSlug(e.target.value) : f.slug }))} required />
              </div>
              <div>
                <label className="ab-label">Slug * <span className="ab-label-hint">(URL-safe, unique)</span></label>
                <input className="ab-input" value={form.slug} onChange={e=>setForm(f=>({...f,slug:toSlug(e.target.value)}))} placeholder="starter" required />
              </div>
              <div><label className="ab-label">Description</label><input className="ab-input" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} /></div>
              <div>
                <label className="ab-label">Tagline <span className="ab-label-hint">(short marketing line on pricing page)</span></label>
                <input className="ab-input" value={form.tagline} onChange={e=>setForm(f=>({...f,tagline:e.target.value}))} placeholder="Perfect for single-location retailers." />
              </div>

              <div className="ab-toggle-row">
                <span className="ab-toggle-label">Custom-priced <span className="ab-label-hint">(show "Contact for pricing")</span></span>
                <Toggle checked={form.isCustomPriced} onChange={v=>setForm(f=>({...f,isCustomPriced:v}))} />
              </div>

              {!form.isCustomPriced && (
                <>
                  <div className="ab-form-row-2">
                    <div>
                      <label className="ab-label">Monthly Price ($) *</label>
                      <input className="ab-input" type="number" step="0.01" min="0" value={form.basePrice} onChange={e=>setForm(f=>({...f,basePrice:e.target.value}))} required />
                    </div>
                    <div>
                      <label className="ab-label">Annual Price ($/mo) <span className="ab-label-hint">(blank = no discount)</span></label>
                      <input className="ab-input" type="number" step="0.01" min="0" value={form.annualPrice} onChange={e=>setForm(f=>({...f,annualPrice:e.target.value}))} placeholder="e.g. 39 (shown as $39/mo billed annually)" />
                    </div>
                  </div>
                  <div className="ab-form-row-2">
                    <div><label className="ab-label">Price / Extra Store ($)</label><input className="ab-input" type="number" step="0.01" min="0" value={form.pricePerStore} onChange={e=>setForm(f=>({...f,pricePerStore:e.target.value}))} /></div>
                    <div><label className="ab-label">Price / Extra Register ($)</label><input className="ab-input" type="number" step="0.01" min="0" value={form.pricePerRegister} onChange={e=>setForm(f=>({...f,pricePerRegister:e.target.value}))} /></div>
                  </div>
                </>
              )}

              <div className="ab-form-row-2">
                <div><label className="ab-label">Included Stores</label><input className="ab-input" type="number" min="1" value={form.includedStores} onChange={e=>setForm(f=>({...f,includedStores:Number(e.target.value)}))} /></div>
                <div><label className="ab-label">Included Registers</label><input className="ab-input" type="number" min="1" value={form.includedRegisters} onChange={e=>setForm(f=>({...f,includedRegisters:Number(e.target.value)}))} /></div>
              </div>
              <div className="ab-form-row-2">
                <div>
                  <label className="ab-label">Max Users <span className="ab-label-hint">(blank = unlimited)</span></label>
                  <input className="ab-input" type="number" min="1" value={form.maxUsers} onChange={e=>setForm(f=>({...f,maxUsers:e.target.value}))} placeholder="Unlimited" />
                </div>
                <div><label className="ab-label">Trial Days</label><input className="ab-input" type="number" min="0" value={form.trialDays} onChange={e=>setForm(f=>({...f,trialDays:Number(e.target.value)}))} /></div>
              </div>
              <div className="ab-toggle-row">
                <span className="ab-toggle-label">Public (show on pricing page)</span>
                <Toggle checked={form.isPublic} onChange={v=>setForm(f=>({...f,isPublic:v}))} />
              </div>
              <div className="ab-toggle-row">
                <span className="ab-toggle-label">Active</span>
                <Toggle checked={form.isActive} onChange={v=>setForm(f=>({...f,isActive:v}))} />
              </div>
              <div className="ab-toggle-row">
                <span className="ab-toggle-label">Highlighted (Most Popular badge)</span>
                <Toggle checked={form.highlighted} onChange={v=>setForm(f=>({...f,highlighted:v}))} />
              </div>
              <div className="ab-toggle-row">
                <span className="ab-toggle-label">Default plan for new orgs</span>
                <Toggle checked={form.isDefault} onChange={v=>setForm(f=>({...f,isDefault:v}))} />
              </div>
              {addons.length > 0 && (
                <div>
                  <label className="ab-label">Included Add-ons</label>
                  <div className="ab-addon-check">
                    {addons.map(a => (
                      <label key={a.key} className="ab-addon-check-label">
                        <input type="checkbox" checked={form.includedAddons.includes(a.key)} onChange={() => toggleAddon(a.key)} />
                        {a.name} <span className="ab-addon-check-price">({fmtMoney(a.monthlyPrice)}/mo)</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* ── S78 — Sidebar Modules ───────────────────────────────── */}
              <div className="ab-modules-section">
                <div className="ab-modules-head">
                  <label className="ab-label" style={{ margin: 0 }}>
                    Sidebar Modules
                    <span className="ab-label-hint" style={{ marginLeft: 6 }}>
                      ({form.moduleIds.size}/{allModules.filter(m => m.active).length} selected)
                    </span>
                  </label>
                  {loadingPlanModules && <span className="ab-modules-loading"><Loader size={11} className="spin" /> loading…</span>}
                </div>
                <p className="ab-modules-hint">
                  Pick which sidebar menu items this plan unlocks for org users.
                  <strong> Core modules</strong> (Account / Support / Billing / Live Dashboard / Chat) are always granted.
                </p>
                {allModules.length === 0 ? (
                  <div className="ab-modules-empty">
                    No modules registered. Run <code>npx tsx prisma/seedPlanModules.ts</code> to seed defaults.
                  </div>
                ) : (
                  <div className="ab-modules-wrap">
                    {Object.entries(moduleGroups)
                      .sort(([, a], [, b]) => (a[0]?.sortOrder ?? 0) - (b[0]?.sortOrder ?? 0))
                      .map(([cat, items]) => (
                        <div key={cat} className="ab-module-group">
                          <div className="ab-module-group-head">
                            <strong>{cat}</strong>
                            <div className="ab-module-group-actions">
                              <button type="button" className="ab-module-mini-btn" onClick={() => selectAllInCategory(cat)}>All</button>
                              <button type="button" className="ab-module-mini-btn" onClick={() => clearAllInCategory(cat)}>None</button>
                            </div>
                          </div>
                          <div className="ab-module-list">
                            {items.map(m => {
                              const checked = form.moduleIds.has(m.id) || m.isCore;
                              return (
                                <label
                                  key={m.id}
                                  className={`ab-module-row ${checked ? 'is-checked' : ''} ${m.isCore ? 'is-core' : ''}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={m.isCore}
                                    onChange={() => toggleModule(m.id)}
                                  />
                                  <div className="ab-module-row-body">
                                    <div className="ab-module-row-name">
                                      {m.name}
                                      {m.isCore && <span className="ab-module-pill ab-module-pill--core">CORE</span>}
                                      {!m.active && <span className="ab-module-pill ab-module-pill--inactive">INACTIVE</span>}
                                    </div>
                                    {m.description && <div className="ab-module-row-desc">{m.description}</div>}
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
            <button type="submit" className="admin-btn admin-btn-primary ab-btn-full" disabled={saving}>
              {saving ? <><Loader size={13} className="spin" /> Saving...</> : <><Save size={13} /> Save Plan</>}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// ── SUBSCRIPTIONS TAB ─────────────────────────────────────────────────────────

interface ManageForm {
  planId: string | number;
  overrideMaxStores: number | string;
  overrideMaxRegisters: number | string;
  extraAddons: string[];
  discountType: string;
  discountValue: number | string;
  discountNote: string;
  discountExpiry: string;
  status: SubStatus;
  trialEndsAt: string;
}

function SubscriptionsTab() {
  const [subs,     setSubs]     = useState<Subscription[]>([]);
  const [total,    setTotal]    = useState(0);
  const [_orgs,    setOrgs]     = useState<unknown[]>([]);
  const [plans,    setPlans]    = useState<Plan[]>([]);
  const [addons,   setAddons]   = useState<Addon[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [statusF,  setStatusF]  = useState<SubStatus | ''>('');
  const [page,     setPage]     = useState(1);
  const [managing, setManaging] = useState<Subscription | null>(null);
  const [mForm,    setMForm]    = useState<ManageForm>({
    planId: '', overrideMaxStores: '', overrideMaxRegisters: '', extraAddons: [],
    discountType: '', discountValue: '', discountNote: '', discountExpiry: '',
    status: 'trial', trialEndsAt: '',
  });
  const [saving,   setSaving]   = useState(false);
  const limit = 50;
  void _orgs;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [subsR, plansR, orgsR] = await Promise.all([
        adminListSubscriptions({ status: statusF || undefined, page, limit }),
        adminListPlans(),
        getAdminOrganizations({ limit: 500 }),
      ]);
      setSubs(subsR.data || []);
      setTotal(subsR.meta?.total || 0);
      // adminListPlans returns { plans, addons } at the top level (not nested under .data).
      setPlans(plansR.plans || []);
      setAddons(plansR.addons || []);
      setOrgs(orgsR.data || []);
    } catch { toast.error('Failed to load subscriptions'); }
    finally { setLoading(false); }
  }, [statusF, page]);

  useEffect(() => { load(); }, [load]);

  const STATUS_COUNTS = (['trial','active','past_due','suspended','cancelled'] as SubStatus[]).reduce((acc, s) => {
    acc[s] = subs.filter(x => x.status === s).length;
    return acc;
  }, {} as Record<SubStatus, number>);

  const openManage = (sub: Subscription) => {
    setManaging(sub);
    setMForm({
      planId: sub.planId,
      overrideMaxStores: sub.overrideMaxStores ?? '',
      overrideMaxRegisters: sub.overrideMaxRegisters ?? '',
      extraAddons: Array.isArray(sub.extraAddons) ? sub.extraAddons : [],
      discountType: sub.discountType || '',
      discountValue: sub.discountValue ?? '',
      discountNote: sub.discountNote || '',
      discountExpiry: sub.discountExpiry ? sub.discountExpiry.slice(0,10) : '',
      status: sub.status,
      trialEndsAt: sub.trialEndsAt ? sub.trialEndsAt.slice(0,10) : '',
    });
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!managing) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...mForm };
      if (!payload.overrideMaxStores) payload.overrideMaxStores = null;
      if (!payload.overrideMaxRegisters) payload.overrideMaxRegisters = null;
      if (!payload.discountType) { payload.discountType = null; payload.discountValue = null; }
      if (!payload.discountExpiry) payload.discountExpiry = null;
      if (!payload.trialEndsAt) payload.trialEndsAt = null;
      await adminUpsertSubscription(managing.orgId, payload);
      toast.success('Subscription updated');
      setManaging(null);
      load();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const toggleExtra = (key: string) => setMForm(f => ({
    ...f,
    extraAddons: f.extraAddons.includes(key) ? f.extraAddons.filter(k=>k!==key) : [...f.extraAddons, key],
  }));

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      {/* Stat row */}
      <div className="ab-stat-row">
        {([['Total', total, '#3b82f6'], ['Active', STATUS_COUNTS.active, '#22c55e'], ['Trial', STATUS_COUNTS.trial, '#3b82f6'],
          ['Past Due', STATUS_COUNTS.past_due, '#f97316'], ['Suspended', STATUS_COUNTS.suspended, '#ef4444']] as [string, number, string][]).map(([l,v,c]) => (
          <div key={l} className="ab-stat-card">
            <div className="ab-stat-label">{l}</div>
            <div className="ab-stat-value" style={{ color: c }}>{v ?? 0}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="ab-filter-row">
        <select className="admin-select ab-select-inline" value={statusF} onChange={e=>{setStatusF(e.target.value as SubStatus | '');setPage(1);}}>
          <option value="">All Statuses</option>
          {(['trial','active','past_due','suspended','cancelled'] as SubStatus[]).map(s=><option key={s} value={s}>{s.replace('_',' ')}</option>)}
        </select>
        <button className="admin-btn admin-btn-secondary" onClick={load}><RefreshCw size={13} /></button>
      </div>

      <div className={`ab-subs-grid ${managing ? 'ab-subs-grid--with-panel' : ''}`}>
        <div>
          <div className="admin-table-wrapper ab-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Organization</th><th>Plan</th><th>Status</th><th>Next Billing</th><th>Payment Method</th><th>Actions</th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="ab-empty"><Loader size={16} className="spin" /> Loading...</td></tr>
                ) : subs.length === 0 ? (
                  <tr><td colSpan={6} className="ab-empty">No subscriptions found</td></tr>
                ) : subs.map(s => (
                  <tr key={s.id}>
                    <td className="ab-cell-bold">{s.org?.name || String(s.orgId).slice(0,8)}</td>
                    <td className="ab-cell-sm">{s.plan?.name || '—'}</td>
                    <td><Badge val={s.status} /></td>
                    <td className="ab-cell-xs ab-cell-muted">{fmtDate(s.nextBillingDate)}</td>
                    <td className="ab-cell-payment">
                      {s.paymentMethodType ? (
                        <span>{s.paymentMethodType === 'ach' ? '🏦' : '💳'} ···· {s.paymentLast4 || '—'}</span>
                      ) : <span className="ab-cell-muted">None</span>}
                    </td>
                    <td>
                      <div className="admin-row-actions">
                        <button onClick={() => openManage(s)} className="admin-btn-icon" title="Manage"><Edit3 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="admin-pagination">
              <button className="admin-btn admin-btn-secondary" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}><ChevronLeft size={13} /> Prev</button>
              <span className="ab-page-info">Page {page} of {totalPages}</span>
              <button className="admin-btn admin-btn-secondary" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}>Next <ChevronRight size={13} /></button>
            </div>
          )}
        </div>

        {/* Manage panel */}
        {managing && (
          <div className="ab-side-panel ab-side-panel--scroll">
            <div className="ab-panel-header">
              <h3 className="ab-panel-title">Manage — {managing.org?.name}</h3>
              <button onClick={() => setManaging(null)} className="ab-panel-close"><X size={16} /></button>
            </div>
            <form onSubmit={handleSave}>
              <div className="ab-form-col">
                <div>
                  <label className="ab-label">Plan</label>
                  <select className="admin-select ab-select-inline" value={mForm.planId} onChange={e=>setMForm(f=>({...f,planId:e.target.value}))}>
                    {plans.map(p=><option key={p.id} value={p.id}>{p.name} — {fmtMoney(p.basePrice)}/mo</option>)}
                  </select>
                </div>
                <div className="ab-form-row-2">
                  <div><label className="ab-label">Override Max Stores</label><input className="ab-input" type="number" min="1" value={mForm.overrideMaxStores} onChange={e=>setMForm(f=>({...f,overrideMaxStores:e.target.value}))} placeholder="(use plan default)" /></div>
                  <div><label className="ab-label">Override Max Registers</label><input className="ab-input" type="number" min="1" value={mForm.overrideMaxRegisters} onChange={e=>setMForm(f=>({...f,overrideMaxRegisters:e.target.value}))} placeholder="(use plan default)" /></div>
                </div>
                {addons.length > 0 && (
                  <div>
                    <label className="ab-label">Extra Add-ons (beyond plan)</label>
                    {addons.map(a=>(
                      <label key={a.key} className="ab-manage-label">
                        <input type="checkbox" checked={mForm.extraAddons.includes(a.key)} onChange={()=>toggleExtra(a.key)} />
                        {a.name} <span className="ab-manage-extra-price">+{fmtMoney(a.monthlyPrice)}/mo</span>
                      </label>
                    ))}
                  </div>
                )}
                <div>
                  <label className="ab-label">Discount Type</label>
                  <select className="admin-select ab-select-inline" value={mForm.discountType} onChange={e=>setMForm(f=>({...f,discountType:e.target.value}))}>
                    <option value="">None</option>
                    <option value="percent">Percentage (%)</option>
                    <option value="fixed">Fixed Amount ($)</option>
                  </select>
                </div>
                {mForm.discountType && <>
                  <div className="ab-form-row-2">
                    <div><label className="ab-label">{mForm.discountType==='percent'?'Discount %':'Discount $'}</label><input className="ab-input" type="number" step="0.01" min="0" value={mForm.discountValue} onChange={e=>setMForm(f=>({...f,discountValue:e.target.value}))} /></div>
                    <div><label className="ab-label">Expires On</label><input className="ab-input" type="date" value={mForm.discountExpiry} onChange={e=>setMForm(f=>({...f,discountExpiry:e.target.value}))} /></div>
                  </div>
                  <div><label className="ab-label">Discount Note</label><input className="ab-input" value={mForm.discountNote} onChange={e=>setMForm(f=>({...f,discountNote:e.target.value}))} placeholder="e.g. First 3 months promo" /></div>
                </>}
                <div>
                  <label className="ab-label">Status</label>
                  <select className="admin-select ab-select-inline" value={mForm.status} onChange={e=>setMForm(f=>({...f,status:e.target.value as SubStatus}))}>
                    {(['trial','active','past_due','suspended','cancelled'] as SubStatus[]).map(s=><option key={s} value={s}>{s.replace('_',' ')}</option>)}
                  </select>
                </div>
                {mForm.status === 'trial' && (
                  <div><label className="ab-label">Trial Ends At</label><input className="ab-input" type="date" value={mForm.trialEndsAt} onChange={e=>setMForm(f=>({...f,trialEndsAt:e.target.value}))} /></div>
                )}
              </div>
              <button type="submit" className="admin-btn admin-btn-primary ab-btn-full" disabled={saving}>
                {saving ? <><Loader size={13} className="spin" /> Saving...</> : <><Save size={13} /> Save Changes</>}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

// ── INVOICES TAB ──────────────────────────────────────────────────────────────

interface InvoiceOrg { id: string | number; name: string }

interface InvoiceFilters {
  orgId: string;
  status: string;
  dateFrom: string;
  dateTo: string;
}

function InvoicesTab() {
  const confirm = useConfirm();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total,    setTotal]    = useState(0);
  const [orgs,     setOrgs]     = useState<InvoiceOrg[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [filters,  setFilters]  = useState<InvoiceFilters>({ orgId:'', status:'', dateFrom:'', dateTo:'' });
  const [page,     setPage]     = useState(1);
  const limit = 50;

  useEffect(() => { getAdminOrganizations({ limit:500 }).then((r: { data?: InvoiceOrg[] })=>setOrgs(r.data||[])).catch(()=>{}); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit };
      if (filters.orgId)    params.orgId  = filters.orgId;
      if (filters.status)   params.status = filters.status;
      const r = await adminListInvoices(params);
      setInvoices(r.data || []);
      setTotal(r.meta?.total || 0);
    } catch { toast.error('Failed to load invoices'); }
    finally { setLoading(false); }
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  const handleWriteOff = async (id: string | number) => {
    if (!await confirm({
      title: 'Write off invoice?',
      message: 'Write off this invoice?',
      confirmLabel: 'Write Off',
      danger: true,
    })) return;
    try { await adminWriteOffInvoice(id); toast.success('Invoice written off'); load(); }
    catch { toast.error('Failed'); }
  };

  const handleRetry = async (id: string | number) => {
    try { await adminRetryInvoice(id); toast.success('Retry triggered'); load(); }
    catch { toast.error('Failed'); }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="ab-inv-filter-row">
        <select className="admin-select ab-select-inline" value={filters.orgId} onChange={e=>{setFilters(f=>({...f,orgId:e.target.value}));setPage(1);}}>
          <option value="">All Organizations</option>
          {orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select className="admin-select ab-select-inline" value={filters.status} onChange={e=>{setFilters(f=>({...f,status:e.target.value}));setPage(1);}}>
          <option value="">All Statuses</option>
          {['pending','paid','failed','written_off'].map(s=><option key={s} value={s}>{s.replace('_',' ')}</option>)}
        </select>
        <button className="admin-btn admin-btn-secondary" onClick={load}><RefreshCw size={13} /></button>
        <span className="ab-inv-count">{total.toLocaleString()} invoices</span>
      </div>
      <div className="admin-table-wrapper ab-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Invoice #</th><th>Organization</th><th>Period</th><th>Base</th><th>Discount</th><th>Total</th><th>Status</th><th>Attempts</th><th>Actions</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="ab-empty"><Loader size={16} className="spin" /> Loading...</td></tr>
            ) : invoices.length === 0 ? (
              <tr><td colSpan={9} className="ab-empty">No invoices found</td></tr>
            ) : invoices.map(inv => (
              <tr key={inv.id}>
                <td className="ab-inv-number">{inv.invoiceNumber}</td>
                <td className="ab-inv-org">{inv.subscription?.org?.name || String(inv.orgId).slice(0,8)}</td>
                <td className="ab-inv-period">{fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}</td>
                <td className="ab-inv-base">{fmtMoney(inv.baseAmount)}</td>
                <td className="ab-inv-disc">{Number(inv.discountAmount)>0?`-${fmtMoney(inv.discountAmount)}`:'—'}</td>
                <td className="ab-inv-total">{fmtMoney(inv.totalAmount)}</td>
                <td><Badge val={inv.status} /></td>
                <td className="ab-inv-attempt">{inv.attemptCount}</td>
                <td>
                  <div className="ab-inv-actions">
                    {inv.status === 'failed' && <>
                      <button onClick={()=>handleRetry(inv.id)} className="admin-btn-icon" title="Retry charge"><RefreshCw size={14} /></button>
                      <button onClick={()=>handleWriteOff(inv.id)} className="admin-btn-icon danger" title="Write off"><Ban size={14} /></button>
                    </>}
                    {inv.status === 'paid' && <span className="ab-inv-paid">✓ Paid {fmtDate(inv.paidAt)}</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="admin-pagination">
          <button className="admin-btn admin-btn-secondary" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}><ChevronLeft size={13} /> Prev</button>
          <span className="ab-page-info">Page {page} of {totalPages}</span>
          <button className="admin-btn admin-btn-secondary" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}>Next <ChevronRight size={13} /></button>
        </div>
      )}
    </div>
  );
}

// ── EQUIPMENT TAB ─────────────────────────────────────────────────────────────

const CARRIERS = ['UPS','FedEx','USPS','DHL','Other'];
const ORDER_STATUSES = ['pending','processing','shipped','delivered','cancelled'];
const CATEGORIES = ['terminal','printer','scanner','bundle','accessory'];

interface OrderForm {
  status: string;
  trackingNumber: string;
  trackingCarrier: string;
  notes: string;
}

interface ProductForm {
  name: string;
  slug: string;
  description: string;
  price: number | string;
  category: string;
  stockQty: number;
  trackStock: boolean;
  isActive: boolean;
  sortOrder: number;
  specs: string;
  images: string;
}

// Resolve relative /uploads/... paths against the API host so the
// admin-app (port 5175) can render images served by the backend (port 5000).
// VITE_API_URL is normally `http://localhost:5000/api` or `/api`; strip the
// trailing `/api` so the static path lines up with the express.static mount.
function resolveImageUrl(p: string | null | undefined): string {
  if (!p) return '';
  if (/^https?:\/\//i.test(p) || p.startsWith('data:')) return p;
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) || '/api';
  const host = apiBase.replace(/\/api\/?$/, '');
  return `${host}${p.startsWith('/') ? '' : '/'}${p}`;
}

function EquipmentTab() {
  const [orders,       setOrders]       = useState<EquipmentOrder[]>([]);
  const [ordersTotal,  setOrdersTotal]  = useState(0);
  const [products,     setProducts]     = useState<Product[]>([]);
  const [orderStatus,  setOrderStatus]  = useState('');
  const [ordersPage,   setOrdersPage]   = useState(1);
  const [loadingOrders,setLoadingOrders]= useState(true);
  const [editOrder,    setEditOrder]    = useState<EquipmentOrder | null>(null);
  const [orderForm,    setOrderForm]    = useState<OrderForm>({ status:'', trackingNumber:'', trackingCarrier:'', notes:'' });
  const [savingOrder,  setSavingOrder]  = useState(false);
  const [showProducts, setShowProducts] = useState(true);
  const [showProdForm, setShowProdForm] = useState(false);
  const [editProduct,  setEditProduct]  = useState<Product | null>(null);
  const [viewProduct,  setViewProduct]  = useState<Product | null>(null);
  const [prodForm,     setProdForm]     = useState<ProductForm>({ name:'', slug:'', description:'', price:'', category:'terminal', stockQty:0, trackStock:true, isActive:true, sortOrder:0, specs:'', images:'' });
  const [savingProd,   setSavingProd]   = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const confirm = useConfirm();
  const limit = 25;

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const params: Record<string, unknown> = { page: ordersPage, limit };
      if (orderStatus) params.status = orderStatus;
      const r = await adminListEquipmentOrders(params);
      setOrders(r.data || []);
      setOrdersTotal(r.meta?.total || 0);
    } catch { toast.error('Failed to load orders'); }
    finally { setLoadingOrders(false); }
  }, [ordersPage, orderStatus]);

  const loadProducts = useCallback(async () => {
    try {
      // Backend handler returns the array directly (`res.json(products)`),
      // not `{ data: [...] }`. Accept both shapes defensively.
      const r = await adminListEquipmentProducts();
      const list = Array.isArray(r) ? r : (Array.isArray((r as any)?.data) ? (r as any).data : []);
      setProducts(list);
    } catch { toast.error('Failed to load products'); }
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => { if (showProducts) loadProducts(); }, [showProducts, loadProducts]);

  const openEditOrder = (order: EquipmentOrder) => {
    setEditOrder(order);
    setOrderForm({ status: order.status, trackingNumber: order.trackingNumber||'', trackingCarrier: order.trackingCarrier||'', notes: order.notes||'' });
  };

  const handleSaveOrder = async (e: FormEvent) => {
    e.preventDefault();
    if (!editOrder) return;
    setSavingOrder(true);
    try {
      await adminUpdateEquipmentOrder(editOrder.id, orderForm);
      toast.success('Order updated');
      setEditOrder(null);
      loadOrders();
    } catch { toast.error('Save failed'); }
    finally { setSavingOrder(false); }
  };

  const startEditProduct = (prod: Product) => {
    setEditProduct(prod);
    setProdForm({
      name: prod.name, slug: prod.slug, description: prod.description||'',
      price: prod.price,
      category: prod.category||'terminal',
      stockQty: prod.stockQty ?? prod.stock ?? 0,
      trackStock: prod.trackStock,
      isActive: prod.isActive, sortOrder: prod.sortOrder,
      specs: prod.specs ? JSON.stringify(prod.specs, null, 2) : '',
      images: Array.isArray(prod.images) ? prod.images.join('\n') : '',
    });
    setShowProdForm(true);
  };

  const handleSaveProduct = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProd(true);
    try {
      let specs: unknown = undefined;
      try {
        if (prodForm.specs && prodForm.specs.trim()) specs = JSON.parse(prodForm.specs);
      } catch {
        toast.error('Specs must be valid JSON (or leave blank).');
        setSavingProd(false);
        return;
      }
      const images = prodForm.images ? prodForm.images.split('\n').map(s=>s.trim()).filter(Boolean) : [];
      const payload: Record<string, unknown> = {
        name:        prodForm.name,
        slug:        prodForm.slug,
        description: prodForm.description,
        price:       Number(prodForm.price),
        category:    prodForm.category,
        stockQty:    Number(prodForm.stockQty),
        trackStock:  prodForm.trackStock,
        isActive:    prodForm.isActive,
        sortOrder:   Number(prodForm.sortOrder),
        images,
      };
      // Only set specs when present — backend's sanitizer omits when undefined.
      if (specs !== undefined) payload.specs = specs;
      if (editProduct) {
        await adminUpdateEquipmentProduct(editProduct.id, payload);
        toast.success('Product updated');
      } else {
        await adminCreateEquipmentProduct(payload);
        toast.success('Product created');
      }
      setShowProdForm(false);
      setEditProduct(null);
      loadProducts();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Save failed'); }
    finally { setSavingProd(false); }
  };

  const autoSlug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  const totalPages = Math.ceil(ordersTotal / limit);

  // Image upload — pushes file to /uploads/devices and appends URL to form state
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImg(true);
    try {
      const r = await adminUploadEquipmentImage(file);
      setProdForm(f => ({
        ...f,
        images: f.images ? `${f.images}\n${r.url}` : r.url,
      }));
      toast.success('Image uploaded');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Upload failed');
    } finally {
      setUploadingImg(false);
      e.target.value = ''; // allow re-uploading the same file
    }
  };

  const removeImage = (idx: number) => {
    setProdForm(f => {
      const list = (f.images || '').split('\n').map(s => s.trim()).filter(Boolean);
      list.splice(idx, 1);
      return { ...f, images: list.join('\n') };
    });
  };

  const handleDeleteProduct = async (prod: Product) => {
    const ok = await confirm({
      title: 'Delete product?',
      message: `Permanently remove "${prod.name}"? If it has order history it will be soft-deleted (hidden) instead.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await adminDeleteEquipmentProduct(prod.id);
      toast.success(r.softDeleted ? 'Product hidden (had order history)' : 'Product deleted');
      loadProducts();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Delete failed');
    }
  };

  return (
    <div>
      {/* Orders Section */}
      <div className="ab-equip-section">
        <div className="ab-equip-header">
          <h3 className="ab-section-title">Equipment Orders</h3>
          <div className="ab-equip-header-actions">
            <select className="admin-select ab-select-inline" value={orderStatus} onChange={e=>{setOrderStatus(e.target.value);setOrdersPage(1);}}>
              <option value="">All Statuses</option>
              {ORDER_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <button className="admin-btn admin-btn-secondary" onClick={loadOrders}><RefreshCw size={13} /></button>
          </div>
        </div>

        <div className={`ab-equip-grid ${editOrder ? 'ab-equip-grid--with-panel' : ''}`}>
          <div>
            <div className="admin-table-wrapper ab-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Order #</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Tracking</th><th>Actions</th></tr></thead>
                <tbody>
                  {loadingOrders ? (
                    <tr><td colSpan={8} className="ab-empty"><Loader size={15} className="spin" /> Loading...</td></tr>
                  ) : orders.length === 0 ? (
                    <tr><td colSpan={8} className="ab-empty">No orders found</td></tr>
                  ) : orders.map(o => (
                    <tr key={o.id}>
                      <td className="ab-order-num">{o.orderNumber}</td>
                      <td><div className="ab-order-name">{o.name}</div><div className="ab-order-email">{o.email}</div></td>
                      <td className="ab-order-items">{o.items?.map(i=>`${i.product?.name||'?'} ×${i.qty}`).join(', ')}</td>
                      <td className="ab-order-total">{fmtMoney(o.total)}</td>
                      <td><Badge val={o.paymentStatus} /></td>
                      <td><Badge val={o.status} /></td>
                      <td className="ab-order-tracking">{o.trackingNumber ? <><span className="ab-order-tracking-carrier">{o.trackingCarrier}</span> {o.trackingNumber}</> : '—'}</td>
                      <td>
                        <div className="admin-row-actions">
                          <button onClick={()=>openEditOrder(o)} className="admin-btn-icon" title="Update order"><Edit3 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="admin-pagination">
                <button className="admin-btn admin-btn-secondary" onClick={()=>setOrdersPage(p=>Math.max(1,p-1))} disabled={ordersPage===1}><ChevronLeft size={13} /> Prev</button>
                <span className="ab-page-info">Page {ordersPage} of {totalPages}</span>
                <button className="admin-btn admin-btn-secondary" onClick={()=>setOrdersPage(p=>Math.min(totalPages,p+1))} disabled={ordersPage===totalPages}>Next <ChevronRight size={13} /></button>
              </div>
            )}
          </div>

          {editOrder && (
            <div className="ab-side-panel">
              <div className="ab-panel-header">
                <h4 className="ab-panel-title">Update Order {editOrder.orderNumber}</h4>
                <button onClick={()=>setEditOrder(null)} className="ab-panel-close"><X size={16} /></button>
              </div>
              <form onSubmit={handleSaveOrder}>
                <div className="ab-order-form-col">
                  <div>
                    <label className="ab-label">Status</label>
                    <select className="admin-select ab-select-inline" value={orderForm.status} onChange={e=>setOrderForm(f=>({...f,status:e.target.value}))}>
                      {ORDER_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="ab-label">Tracking Carrier</label>
                    <select className="admin-select ab-select-inline" value={orderForm.trackingCarrier} onChange={e=>setOrderForm(f=>({...f,trackingCarrier:e.target.value}))}>
                      <option value="">Select carrier</option>
                      {CARRIERS.map(c=><option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div><label className="ab-label">Tracking Number</label><input className="ab-input" value={orderForm.trackingNumber} onChange={e=>setOrderForm(f=>({...f,trackingNumber:e.target.value}))} placeholder="1Z999AA10123456784" /></div>
                  <div><label className="ab-label">Notes</label><textarea className="ab-textarea" value={orderForm.notes} onChange={e=>setOrderForm(f=>({...f,notes:e.target.value}))} /></div>
                </div>
                <button type="submit" className="admin-btn admin-btn-primary ab-btn-full" disabled={savingOrder}>
                  {savingOrder ? <><Loader size={13} className="spin" /> Saving...</> : <><Save size={13} /> Save</>}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Products Section */}
      <div>
        <div className="ab-product-divider">
          <h3 className="ab-product-toggle" onClick={()=>setShowProducts(s=>!s)}>
            Product Catalog <span className="ab-product-toggle-hint">({showProducts?'click to hide':'click to expand'})</span>
          </h3>
          {showProducts && <button className="admin-btn admin-btn-primary" onClick={()=>{setEditProduct(null);setProdForm({name:'',slug:'',description:'',price:'',category:'terminal',stockQty:0,trackStock:true,isActive:true,sortOrder:0,specs:'',images:''});setShowProdForm(s=>!s)}}><Plus size={13} /> Add Product</button>}
        </div>

        {showProducts && <>
          {showProdForm && (
            <form onSubmit={handleSaveProduct} className="ab-product-form">
              <div className="ab-product-form-grid">
                <div><label className="ab-label">Name *</label><input className="ab-input" value={prodForm.name} onChange={e=>{setProdForm(f=>({...f,name:e.target.value,slug:editProduct?f.slug:autoSlug(e.target.value)}))}} required /></div>
                <div><label className="ab-label">Slug *</label><input className="ab-input" value={prodForm.slug} onChange={e=>setProdForm(f=>({...f,slug:e.target.value}))} required /></div>
                <div><label className="ab-label">Price ($) *</label><input className="ab-input" type="number" step="0.01" value={prodForm.price} onChange={e=>setProdForm(f=>({...f,price:e.target.value}))} required /></div>
                <div>
                  <label className="ab-label">Category</label>
                  <select className="admin-select ab-select-inline" value={prodForm.category} onChange={e=>setProdForm(f=>({...f,category:e.target.value}))}>
                    {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div><label className="ab-label">Stock Qty</label><input className="ab-input" type="number" min="0" value={prodForm.stockQty} onChange={e=>setProdForm(f=>({...f,stockQty:Number(e.target.value)}))} /></div>
                <div><label className="ab-label">Sort Order</label><input className="ab-input" type="number" min="0" value={prodForm.sortOrder} onChange={e=>setProdForm(f=>({...f,sortOrder:Number(e.target.value)}))} /></div>
              </div>
              <div className="ab-product-desc-row"><label className="ab-label">Description</label><textarea className="ab-textarea" value={prodForm.description} onChange={e=>setProdForm(f=>({...f,description:e.target.value}))} /></div>
              <div className="ab-product-form-grid">
                <div>
                  <label className="ab-label">Images</label>
                  <div className="ab-image-uploader">
                    <label className="admin-btn admin-btn-secondary ab-image-upload-btn">
                      {uploadingImg ? <><Loader size={13} className="spin" /> Uploading...</> : <><Plus size={13} /> Upload image</>}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                        style={{ display: 'none' }}
                        disabled={uploadingImg}
                        onChange={handleImageUpload}
                      />
                    </label>
                    <span className="ab-image-hint">PNG / JPG / WebP, up to 10 MB. Saved to <code>/uploads/devices/</code>.</span>
                  </div>
                  <div className="ab-image-grid">
                    {(prodForm.images || '').split('\n').map(s => s.trim()).filter(Boolean).map((url, idx) => (
                      <div key={idx} className="ab-image-thumb">
                        <img src={resolveImageUrl(url)} alt="" onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3'; }} />
                        <button type="button" className="ab-image-thumb-remove" onClick={() => removeImage(idx)} title="Remove">
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                    {!(prodForm.images || '').trim() && (
                      <div className="ab-image-empty">No images yet</div>
                    )}
                  </div>
                  <details className="ab-image-advanced">
                    <summary>Advanced: edit image URLs as text</summary>
                    <textarea className="ab-textarea" rows={3} value={prodForm.images} onChange={e=>setProdForm(f=>({...f,images:e.target.value}))} placeholder="One URL per line — e.g. /uploads/devices/POS%20Terminal.png" />
                  </details>
                </div>
                <div><label className="ab-label">Specs (JSON object)</label><textarea className="ab-textarea ab-textarea--mono" value={prodForm.specs} onChange={e=>setProdForm(f=>({...f,specs:e.target.value}))} placeholder='{"RAM":"4GB","Screen":"15.6 inch"}' /></div>
              </div>
              <div className="ab-product-check-row">
                <label className="ab-product-check-label">
                  <input type="checkbox" checked={prodForm.isActive} onChange={e=>setProdForm(f=>({...f,isActive:e.target.checked}))} /> Active
                </label>
                <label className="ab-product-check-label">
                  <input type="checkbox" checked={prodForm.trackStock} onChange={e=>setProdForm(f=>({...f,trackStock:e.target.checked}))} /> Track Stock
                </label>
              </div>
              <div className="ab-form-actions">
                <button type="submit" className="admin-btn admin-btn-primary" disabled={savingProd}>{savingProd?<><Loader size={13} className="spin"/>Saving...</>:<><Save size={13}/>{editProduct?'Update':'Add'} Product</>}</button>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={()=>{setShowProdForm(false);setEditProduct(null);}}>Cancel</button>
              </div>
            </form>
          )}
          <div className="admin-table-wrapper ab-table-wrap">
            <table className="admin-table">
              <thead><tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Active</th><th>Actions</th></tr></thead>
              <tbody>
                {products.map(p=>{
                  const img = Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : '';
                  return (
                    <tr key={p.id}>
                      <td className="ab-product-thumb-cell">
                        {img
                          ? <img className="ab-product-thumb" src={resolveImageUrl(img)} alt="" onError={e=>{(e.target as HTMLImageElement).style.opacity='0.3';}} />
                          : <div className="ab-product-thumb ab-product-thumb--empty" />}
                      </td>
                      <td className="ab-product-name">{p.name}</td>
                      <td className="ab-product-cat">{p.category||'—'}</td>
                      <td className="ab-product-price">{fmtMoney(p.price)}</td>
                      <td className={(p.stockQty ?? p.stock ?? 0) < 5 ? 'ab-product-stock--low' : 'ab-product-stock--ok'}>{p.stockQty ?? p.stock ?? 0}</td>
                      <td><Badge val={p.isActive?'active':'cancelled'}/></td>
                      <td>
                        <div className="admin-row-actions">
                          <button onClick={()=>setViewProduct(p)} className="admin-btn-icon" title="View details"><Eye size={14} /></button>
                          <button onClick={()=>startEditProduct(p)} className="admin-btn-icon" title="Edit"><Edit3 size={14} /></button>
                          <button onClick={()=>handleDeleteProduct(p)} className="admin-btn-icon danger" title="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {products.length===0&&<tr><td colSpan={7} className="ab-empty">No products yet — run <code>npx tsx prisma/seedEquipment.ts</code> from the backend folder to seed the default catalog.</td></tr>}
              </tbody>
            </table>
          </div>
        </>}

        {/* Product Detail (read-only view) */}
        {viewProduct && (
          <div className="ab-pdetail-backdrop" onClick={()=>setViewProduct(null)}>
            <div className="ab-pdetail-card" onClick={e=>e.stopPropagation()}>
              <div className="ab-pdetail-head">
                <h3 className="ab-pdetail-title">{viewProduct.name}</h3>
                <button onClick={()=>setViewProduct(null)} className="admin-btn-icon" title="Close"><X size={16} /></button>
              </div>

              <div className="ab-pdetail-body">
                {/* Image strip */}
                <div className="ab-pdetail-images">
                  {Array.isArray(viewProduct.images) && viewProduct.images.length > 0
                    ? viewProduct.images.map((url, i) => (
                        <div key={i} className="ab-pdetail-img">
                          <img src={resolveImageUrl(url)} alt={viewProduct.name} onError={e=>{(e.target as HTMLImageElement).style.opacity='0.3';}} />
                        </div>
                      ))
                    : <div className="ab-pdetail-noimg">No images</div>}
                </div>

                {/* Field grid */}
                <div className="ab-pdetail-grid">
                  <div className="ab-pdetail-row"><span className="ab-pdetail-k">Slug</span><span className="ab-pdetail-v ab-pdetail-mono">{viewProduct.slug}</span></div>
                  <div className="ab-pdetail-row"><span className="ab-pdetail-k">Category</span><span className="ab-pdetail-v">{viewProduct.category || '—'}</span></div>
                  <div className="ab-pdetail-row"><span className="ab-pdetail-k">Price</span><span className="ab-pdetail-v"><strong>{fmtMoney(viewProduct.price)}</strong></span></div>
                  <div className="ab-pdetail-row"><span className="ab-pdetail-k">Stock Qty</span><span className="ab-pdetail-v">{viewProduct.stockQty ?? viewProduct.stock ?? 0}</span></div>
                  <div className="ab-pdetail-row"><span className="ab-pdetail-k">Track Stock</span><span className="ab-pdetail-v">{viewProduct.trackStock ? 'Yes' : 'No'}</span></div>
                  <div className="ab-pdetail-row"><span className="ab-pdetail-k">Sort Order</span><span className="ab-pdetail-v">{viewProduct.sortOrder}</span></div>
                  <div className="ab-pdetail-row"><span className="ab-pdetail-k">Status</span><span className="ab-pdetail-v"><Badge val={viewProduct.isActive ? 'active' : 'cancelled'} /></span></div>
                  <div className="ab-pdetail-row"><span className="ab-pdetail-k">ID</span><span className="ab-pdetail-v ab-pdetail-mono">{String(viewProduct.id)}</span></div>
                </div>

                {viewProduct.description && (
                  <div className="ab-pdetail-section">
                    <div className="ab-pdetail-section-title">Description</div>
                    <p className="ab-pdetail-desc">{viewProduct.description}</p>
                  </div>
                )}

                {viewProduct.specs && typeof viewProduct.specs === 'object' && Object.keys(viewProduct.specs as Record<string, unknown>).length > 0 && (
                  <div className="ab-pdetail-section">
                    <div className="ab-pdetail-section-title">Specifications</div>
                    <div className="ab-pdetail-specs">
                      {Object.entries(viewProduct.specs as Record<string, unknown>).map(([k, v]) => (
                        <div key={k} className="ab-pdetail-spec">
                          <span className="ab-pdetail-spec-k">{k}</span>
                          <span className="ab-pdetail-spec-v">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="ab-pdetail-foot">
                <button onClick={()=>setViewProduct(null)} className="admin-btn admin-btn-secondary">Close</button>
                <button onClick={()=>{ const p = viewProduct; setViewProduct(null); startEditProduct(p); }} className="admin-btn admin-btn-primary">
                  <Edit3 size={13} /> Edit
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

type TopTab = 'plans' | 'subscriptions' | 'invoices' | 'equipment';

interface TabDef { id: TopTab; label: string; icon: ReactNode }

const TABS: TabDef[] = [
  { id:'plans',         label:'Plans & Add-ons', icon:<CreditCard size={14}/> },
  { id:'subscriptions', label:'Subscriptions',   icon:<Building2  size={14}/> },
  { id:'invoices',      label:'Invoices',         icon:<FileText   size={14}/> },
  { id:'equipment',     label:'Equipment',        icon:<Package    size={14}/> },
];

export default function AdminBilling() {
  const [tab, setTab] = useState<TopTab>('plans');

  return (
    <>
        <div className="admin-header">
          <div className="admin-header-left">
            <div className="admin-header-icon"><CreditCard size={22} /></div>
            <div>
              <h1>Billing Management</h1>
              <p>Subscription plans, org billing, invoices, and equipment orders</p>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="ab-tab-bar">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`ab-tab ${tab===t.id ? 'ab-tab--active' : ''}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {tab === 'plans'         && <PlansTab />}
        {tab === 'subscriptions' && <SubscriptionsTab />}
        {tab === 'invoices'      && <InvoicesTab />}
        {tab === 'equipment'     && <EquipmentTab />}
    </>
  );
}
