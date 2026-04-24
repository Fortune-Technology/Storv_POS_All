/**
 * AdminBilling.tsx
 * Superadmin billing console — 4 tabs:
 *   Plans        — subscription plan + add-on CRUD
 *   Subscriptions — per-org subscription overview & overrides
 *   Invoices     — billing history, retry, write-off
 *   Equipment    — hardware products & order fulfillment
 */

import { useState, useEffect, useCallback, FormEvent, ReactNode } from 'react';
import {
  Plus, Edit3, Trash2, RefreshCw, Loader, Save, X,
  ChevronLeft, ChevronRight, Package, FileText,
  CreditCard, Building2,
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
} from '../services/types';
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
  basePrice: number | string;
  pricePerStore: number | string;
  pricePerRegister: number | string;
  includedStores: number;
  includedRegisters: number;
  trialDays: number;
  isPublic: boolean;
  isActive: boolean;
  includedAddons: string[];
  sortOrder: number;
}

interface AddonForm {
  key: string;
  name: string;
  description: string;
  monthlyPrice: number | string;
  sortOrder: number;
}

const EMPTY_PLAN: PlanForm = { name:'', slug:'', description:'', basePrice:'', pricePerStore:0, pricePerRegister:0,
  includedStores:1, includedRegisters:1, trialDays:14, isPublic:true, isActive:true, includedAddons:[], sortOrder:0 };

const toSlug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function PlansTab() {
  const [plans,    setPlans]    = useState<Plan[]>([]);
  const [addons,   setAddons]   = useState<Addon[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [editPlan, setEditPlan] = useState<Plan | 'new' | null>(null);
  const [form,     setForm]     = useState<PlanForm>(EMPTY_PLAN);
  const [saving,   setSaving]   = useState(false);
  const [showAddonForm, setShowAddonForm] = useState(false);
  const [addonForm, setAddonForm] = useState<AddonForm>({ key:'', name:'', description:'', monthlyPrice:'', sortOrder:0 });
  const [editAddonId, setEditAddonId] = useState<string | number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminListPlans();
      setPlans(r?.plans || []);
      setAddons(r?.addons || []);
    } catch { toast.error('Failed to load plans'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (plan: Plan | 'new') => {
    setEditPlan(plan);
    setForm(plan === 'new' ? EMPTY_PLAN : {
      name: plan.name, slug: plan.slug||'', description: plan.description||'', basePrice: plan.basePrice,
      pricePerStore: plan.pricePerStore||0, pricePerRegister: plan.pricePerRegister||0,
      includedStores: plan.includedStores||1, includedRegisters: plan.includedRegisters||1,
      trialDays: plan.trialDays, isPublic: plan.isPublic, isActive: plan.isActive, sortOrder: plan.sortOrder,
      includedAddons: Array.isArray(plan.includedAddons) ? plan.includedAddons : [],
    });
  };

  const handleSavePlan = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        basePrice:        Number(form.basePrice),
        pricePerStore:    Number(form.pricePerStore)    || 0,
        pricePerRegister: Number(form.pricePerRegister) || 0,
        includedStores:   Number(form.includedStores)   || 1,
        includedRegisters:Number(form.includedRegisters)|| 1,
        sortOrder:        Number(form.sortOrder)         || 0,
      };
      if (editPlan === 'new') {
        await adminCreatePlan(payload);
        toast.success('Plan created');
      } else if (editPlan) {
        await adminUpdatePlan(editPlan.id, payload);
        toast.success('Plan updated');
      }
      setEditPlan(null);
      load();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const handleDeletePlan = async (plan: Plan) => {
    if (!window.confirm(`Delete plan "${plan.name}"?`)) return;
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
                </div>
                <div className="ab-plan-actions">
                  <button onClick={() => startEdit(plan)} className="ab-btn-edit"><Edit3 size={12} /> Edit</button>
                  <button onClick={() => handleDeletePlan(plan)} className="ab-btn-delete"><Trash2 size={12} /></button>
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
                    <td><button onClick={() => startEditAddon(a)} className="ab-btn-edit"><Edit3 size={11} /> Edit</button></td>
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
              <div><label className="ab-label">Base Monthly Price ($) *</label><input className="ab-input" type="number" step="0.01" min="0" value={form.basePrice} onChange={e=>setForm(f=>({...f,basePrice:e.target.value}))} required /></div>
              <div className="ab-form-row-2">
                <div><label className="ab-label">Price / Extra Store ($)</label><input className="ab-input" type="number" step="0.01" min="0" value={form.pricePerStore} onChange={e=>setForm(f=>({...f,pricePerStore:e.target.value}))} /></div>
                <div><label className="ab-label">Price / Extra Register ($)</label><input className="ab-input" type="number" step="0.01" min="0" value={form.pricePerRegister} onChange={e=>setForm(f=>({...f,pricePerRegister:e.target.value}))} /></div>
              </div>
              <div className="ab-form-row-2">
                <div><label className="ab-label">Included Stores</label><input className="ab-input" type="number" min="1" value={form.includedStores} onChange={e=>setForm(f=>({...f,includedStores:Number(e.target.value)}))} /></div>
                <div><label className="ab-label">Included Registers</label><input className="ab-input" type="number" min="1" value={form.includedRegisters} onChange={e=>setForm(f=>({...f,includedRegisters:Number(e.target.value)}))} /></div>
              </div>
              <div><label className="ab-label">Trial Days</label><input className="ab-input" type="number" min="0" value={form.trialDays} onChange={e=>setForm(f=>({...f,trialDays:Number(e.target.value)}))} /></div>
              <div className="ab-toggle-row">
                <span className="ab-toggle-label">Public (show on pricing page)</span>
                <Toggle checked={form.isPublic} onChange={v=>setForm(f=>({...f,isPublic:v}))} />
              </div>
              <div className="ab-toggle-row">
                <span className="ab-toggle-label">Active</span>
                <Toggle checked={form.isActive} onChange={v=>setForm(f=>({...f,isActive:v}))} />
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
                      <button onClick={() => openManage(s)} className="ab-btn-edit"><Edit3 size={11} /> Manage</button>
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
    if (!window.confirm('Write off this invoice?')) return;
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
                      <button onClick={()=>handleRetry(inv.id)} className="ab-btn-retry"><RefreshCw size={10} /> Retry</button>
                      <button onClick={()=>handleWriteOff(inv.id)} className="ab-btn-writeoff">Write Off</button>
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
  comparePrice: number | string;
  category: string;
  stock: number;
  trackStock: boolean;
  isActive: boolean;
  sortOrder: number;
  specs: string;
  images: string;
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
  const [showProducts, setShowProducts] = useState(false);
  const [showProdForm, setShowProdForm] = useState(false);
  const [editProduct,  setEditProduct]  = useState<Product | null>(null);
  const [prodForm,     setProdForm]     = useState<ProductForm>({ name:'', slug:'', description:'', price:'', comparePrice:'', category:'terminal', stock:0, trackStock:true, isActive:true, sortOrder:0, specs:'', images:'' });
  const [savingProd,   setSavingProd]   = useState(false);
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
      const r = await adminListEquipmentProducts();
      setProducts(r.data || []);
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
      price: prod.price, comparePrice: (prod.comparePrice ?? '') as number | string,
      category: prod.category||'terminal', stock: prod.stock, trackStock: prod.trackStock,
      isActive: prod.isActive, sortOrder: prod.sortOrder,
      specs: prod.specs ? JSON.stringify(prod.specs) : '',
      images: Array.isArray(prod.images) ? prod.images.join('\n') : '',
    });
    setShowProdForm(true);
  };

  const handleSaveProduct = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProd(true);
    try {
      let specs: unknown = null;
      try { specs = prodForm.specs ? JSON.parse(prodForm.specs) : null; } catch { specs = null; }
      const images = prodForm.images ? prodForm.images.split('\n').map(s=>s.trim()).filter(Boolean) : [];
      const payload = { ...prodForm, price: Number(prodForm.price), comparePrice: prodForm.comparePrice ? Number(prodForm.comparePrice) : null, specs, images };
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
                      <td><button onClick={()=>openEditOrder(o)} className="ab-btn-edit"><Edit3 size={11} /> Update</button></td>
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
          {showProducts && <button className="admin-btn admin-btn-primary" onClick={()=>{setEditProduct(null);setProdForm({name:'',slug:'',description:'',price:'',comparePrice:'',category:'terminal',stock:0,trackStock:true,isActive:true,sortOrder:0,specs:'',images:''});setShowProdForm(s=>!s)}}><Plus size={13} /> Add Product</button>}
        </div>

        {showProducts && <>
          {showProdForm && (
            <form onSubmit={handleSaveProduct} className="ab-product-form">
              <div className="ab-product-form-grid">
                <div><label className="ab-label">Name *</label><input className="ab-input" value={prodForm.name} onChange={e=>{setProdForm(f=>({...f,name:e.target.value,slug:editProduct?f.slug:autoSlug(e.target.value)}))}} required /></div>
                <div><label className="ab-label">Slug *</label><input className="ab-input" value={prodForm.slug} onChange={e=>setProdForm(f=>({...f,slug:e.target.value}))} required /></div>
                <div><label className="ab-label">Price ($) *</label><input className="ab-input" type="number" step="0.01" value={prodForm.price} onChange={e=>setProdForm(f=>({...f,price:e.target.value}))} required /></div>
                <div><label className="ab-label">Compare Price ($)</label><input className="ab-input" type="number" step="0.01" value={prodForm.comparePrice} onChange={e=>setProdForm(f=>({...f,comparePrice:e.target.value}))} /></div>
                <div>
                  <label className="ab-label">Category</label>
                  <select className="admin-select ab-select-inline" value={prodForm.category} onChange={e=>setProdForm(f=>({...f,category:e.target.value}))}>
                    {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div><label className="ab-label">Stock</label><input className="ab-input" type="number" min="0" value={prodForm.stock} onChange={e=>setProdForm(f=>({...f,stock:Number(e.target.value)}))} /></div>
              </div>
              <div className="ab-product-desc-row"><label className="ab-label">Description</label><textarea className="ab-textarea" value={prodForm.description} onChange={e=>setProdForm(f=>({...f,description:e.target.value}))} /></div>
              <div className="ab-product-form-grid">
                <div><label className="ab-label">Image URLs (one per line)</label><textarea className="ab-textarea" value={prodForm.images} onChange={e=>setProdForm(f=>({...f,images:e.target.value}))} /></div>
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
              <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Active</th><th>Actions</th></tr></thead>
              <tbody>
                {products.map(p=>(
                  <tr key={p.id}>
                    <td className="ab-product-name">{p.name}</td>
                    <td className="ab-product-cat">{p.category||'—'}</td>
                    <td className="ab-product-price">{fmtMoney(p.price)}{p.comparePrice&&<span className="ab-product-compare">{fmtMoney(p.comparePrice)}</span>}</td>
                    <td className={p.stock<5 ? 'ab-product-stock--low' : 'ab-product-stock--ok'}>{p.stock}</td>
                    <td><Badge val={p.isActive?'active':'cancelled'}/></td>
                    <td><button onClick={()=>startEditProduct(p)} className="ab-btn-edit"><Edit3 size={11}/> Edit</button></td>
                  </tr>
                ))}
                {products.length===0&&<tr><td colSpan={6} className="ab-empty">No products yet</td></tr>}
              </tbody>
            </table>
          </div>
        </>}
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
