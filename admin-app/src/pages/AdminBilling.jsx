/**
 * AdminBilling.jsx
 * Superadmin billing console — 4 tabs:
 *   Plans        — subscription plan + add-on CRUD
 *   Subscriptions — per-org subscription overview & overrides
 *   Invoices     — billing history, retry, write-off
 *   Equipment    — hardware products & order fulfillment
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Edit3, Trash2, RefreshCw, Loader, Save, X,
  ChevronLeft, ChevronRight, Search, Package, FileText,
  CreditCard, Building2, CheckCircle, AlertCircle, Clock,
  Truck, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { toast } from 'react-toastify';
import AdminSidebar from '../components/AdminSidebar';
import {
  getAdminOrganizations,
  adminListPlans, adminCreatePlan, adminUpdatePlan, adminDeletePlan,
  adminCreateAddon, adminUpdateAddon,
  adminListSubscriptions, adminUpsertSubscription,
  adminListInvoices, adminWriteOffInvoice, adminRetryInvoice,
  adminListEquipmentOrders, adminUpdateEquipmentOrder,
  adminListEquipmentProducts, adminCreateEquipmentProduct, adminUpdateEquipmentProduct,
} from '../services/api';
import '../styles/admin.css';

// ── Shared helpers ────────────────────────────────────────────────────────────

const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';
const fmtMoney = (n) => n != null ? `$${Number(n).toFixed(2)}` : '—';

const BADGE_COLORS = {
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

function Badge({ val }) {
  const c = BADGE_COLORS[val] || BADGE_COLORS.pending;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 10px', borderRadius:20,
      background: c.bg, border:`1px solid ${c.border}`, color: c.text,
      fontSize:'0.7rem', fontWeight:700, textTransform:'uppercase', whiteSpace:'nowrap' }}>
      <span style={{ width:5, height:5, borderRadius:'50%', background:c.text, flexShrink:0 }} />
      {val?.replace('_',' ')}
    </span>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <div onClick={() => onChange(!checked)} style={{
      width:36, height:20, borderRadius:10, cursor:'pointer', flexShrink:0,
      background: checked ? '#3b82f6' : 'var(--border-color)', position:'relative', transition:'background .2s',
    }}>
      <div style={{ position:'absolute', top:2, left: checked?16:2, width:16, height:16,
        borderRadius:'50%', background:'#fff', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.2)' }} />
    </div>
  );
}

const inputStyle = { width:'100%', padding:'7px 10px', border:'1px solid var(--border-color)', borderRadius:7,
  background:'var(--bg-card)', color:'var(--text-primary)', fontSize:'0.85rem', outline:'none', boxSizing:'border-box' };
const labelStyle = { display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text-muted)',
  textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 };

// ── PLANS TAB ─────────────────────────────────────────────────────────────────

const EMPTY_PLAN = { name:'', slug:'', description:'', basePrice:'', pricePerStore:0, pricePerRegister:0,
  includedStores:1, includedRegisters:1, trialDays:14, isPublic:true, isActive:true, includedAddons:[], sortOrder:0 };

const toSlug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function PlansTab() {
  const [plans,    setPlans]    = useState([]);
  const [addons,   setAddons]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [editPlan, setEditPlan] = useState(null);   // null | 'new' | plan object
  const [form,     setForm]     = useState(EMPTY_PLAN);
  const [saving,   setSaving]   = useState(false);
  const [showAddonForm, setShowAddonForm] = useState(false);
  const [addonForm, setAddonForm] = useState({ key:'', name:'', description:'', monthlyPrice:'', sortOrder:0 });
  const [editAddonId, setEditAddonId] = useState(null);

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

  const startEdit = (plan) => {
    setEditPlan(plan);
    setForm(plan === 'new' ? EMPTY_PLAN : {
      name: plan.name, slug: plan.slug||'', description: plan.description||'', basePrice: plan.basePrice,
      pricePerStore: plan.pricePerStore||0, pricePerRegister: plan.pricePerRegister||0,
      includedStores: plan.includedStores||1, includedRegisters: plan.includedRegisters||1,
      trialDays: plan.trialDays, isPublic: plan.isPublic, isActive: plan.isActive, sortOrder: plan.sortOrder,
      includedAddons: Array.isArray(plan.includedAddons) ? plan.includedAddons : [],
    });
  };

  const handleSavePlan = async (e) => {
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
      } else {
        await adminUpdatePlan(editPlan.id, payload);
        toast.success('Plan updated');
      }
      setEditPlan(null);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const handleDeletePlan = async (plan) => {
    if (!window.confirm(`Delete plan "${plan.name}"?`)) return;
    try {
      await adminDeletePlan(plan.id);
      toast.success('Plan deleted');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Delete failed'); }
  };

  const toggleAddon = (key) => {
    setForm(f => ({
      ...f,
      includedAddons: f.includedAddons.includes(key)
        ? f.includedAddons.filter(k => k !== key)
        : [...f.includedAddons, key],
    }));
  };

  const handleSaveAddon = async (e) => {
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
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
  };

  const startEditAddon = (addon) => {
    setEditAddonId(addon.id);
    setAddonForm({ key: addon.key, name: addon.name, description: addon.description||'',
      monthlyPrice: addon.monthlyPrice, sortOrder: addon.sortOrder });
    setShowAddonForm(true);
  };

  if (loading) return <div style={{ padding:'2rem', color:'var(--text-muted)', display:'flex', alignItems:'center', gap:8 }}><Loader size={16} className="spin" /> Loading...</div>;

  return (
    <div style={{ display:'grid', gridTemplateColumns: editPlan ? '1fr 380px' : '1fr', gap:20 }}>
      {/* Plans list */}
      <div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h3 style={{ margin:0, fontSize:'0.95rem', fontWeight:700, color:'var(--text-primary)' }}>Subscription Plans</h3>
          <button className="admin-btn admin-btn-primary" onClick={() => startEdit('new')}><Plus size={13} /> New Plan</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {plans.map(plan => (
            <div key={plan.id} style={{ background:'var(--bg-card)', border:'1px solid var(--border-color)', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontWeight:700, fontSize:'0.95rem', color:'var(--text-primary)' }}>{plan.name}</span>
                    {!plan.isActive && <Badge val="cancelled" />}
                    {!plan.isPublic && <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', background:'var(--border-color)', padding:'1px 7px', borderRadius:10 }}>Private</span>}
                  </div>
                  <div style={{ fontSize:'0.82rem', color:'var(--text-muted)', marginTop:3 }}>{plan.description}</div>
                  <div style={{ display:'flex', gap:16, marginTop:8, fontSize:'0.82rem', color:'var(--text-secondary)' }}>
                    <span style={{ fontWeight:700, color:'var(--text-primary)', fontSize:'1.1rem' }}>{fmtMoney(plan.basePrice)}<span style={{ fontSize:'0.75rem', fontWeight:400, color:'var(--text-muted)' }}>/mo</span></span>
                    <span>Up to {plan.includedStores} store{plan.includedStores !== 1 ? 's' : ''}</span>
                    <span>{plan.includedRegisters} register{plan.includedRegisters !== 1 ? 's' : ''}</span>
                    <span>{plan.trialDays}d trial</span>
                  </div>
                  {Array.isArray(plan.includedAddons) && plan.includedAddons.length > 0 && (
                    <div style={{ marginTop:6, display:'flex', flexWrap:'wrap', gap:4 }}>
                      {plan.includedAddons.map(k => (
                        <span key={k} style={{ fontSize:'0.7rem', padding:'2px 8px', borderRadius:10, background:'rgba(59,130,246,.1)', border:'1px solid rgba(59,130,246,.2)', color:'#3b82f6' }}>{k}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                  <button onClick={() => startEdit(plan)} style={{ display:'flex', alignItems:'center', gap:4, padding:'5px 10px', borderRadius:6, fontSize:'0.77rem', fontWeight:600, background:'var(--bg-card)', border:'1px solid var(--border-color)', color:'var(--text-secondary)', cursor:'pointer' }}><Edit3 size={12} /> Edit</button>
                  <button onClick={() => handleDeletePlan(plan)} style={{ display:'flex', alignItems:'center', gap:4, padding:'5px 10px', borderRadius:6, fontSize:'0.77rem', fontWeight:600, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)', color:'#ef4444', cursor:'pointer' }}><Trash2 size={12} /></button>
                </div>
              </div>
            </div>
          ))}
          {plans.length === 0 && <div style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)' }}>No plans yet — create your first plan</div>}
        </div>

        {/* Add-ons section */}
        <div style={{ marginTop:28 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <h3 style={{ margin:0, fontSize:'0.95rem', fontWeight:700, color:'var(--text-primary)' }}>Add-ons</h3>
            <button className="admin-btn admin-btn-secondary" onClick={() => { setShowAddonForm(s=>!s); setEditAddonId(null); setAddonForm({ key:'', name:'', description:'', monthlyPrice:'', sortOrder:0 }); }}><Plus size={13} /> Add Add-on</button>
          </div>
          {showAddonForm && (
            <form onSubmit={handleSaveAddon} style={{ background:'var(--bg-card)', border:'1px solid rgba(59,130,246,.25)', borderRadius:10, padding:'1rem', marginBottom:12 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
                <div><label style={labelStyle}>Key (unique)</label><input style={inputStyle} value={addonForm.key} onChange={e=>setAddonForm(f=>({...f,key:e.target.value}))} placeholder="ecomm" required disabled={!!editAddonId} /></div>
                <div><label style={labelStyle}>Name</label><input style={inputStyle} value={addonForm.name} onChange={e=>setAddonForm(f=>({...f,name:e.target.value}))} placeholder="Website & eCommerce" required /></div>
                <div><label style={labelStyle}>Monthly Price ($)</label><input style={inputStyle} type="number" step="0.01" value={addonForm.monthlyPrice} onChange={e=>setAddonForm(f=>({...f,monthlyPrice:e.target.value}))} placeholder="29.00" required /></div>
                <div><label style={labelStyle}>Description</label><input style={inputStyle} value={addonForm.description} onChange={e=>setAddonForm(f=>({...f,description:e.target.value}))} /></div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button type="submit" className="admin-btn admin-btn-primary"><Save size={13} /> Save Add-on</button>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setShowAddonForm(false)}>Cancel</button>
              </div>
            </form>
          )}
          <div className="admin-table-wrapper" style={{ overflowX:'auto' }}>
            <table className="admin-table">
              <thead><tr><th>Key</th><th>Name</th><th>Price/mo</th><th>Active</th><th>Actions</th></tr></thead>
              <tbody>
                {addons.map(a => (
                  <tr key={a.id}>
                    <td><code style={{ fontSize:'0.77rem', background:'var(--border-color)', padding:'2px 6px', borderRadius:4 }}>{a.key}</code></td>
                    <td style={{ fontWeight:600 }}>{a.name}</td>
                    <td style={{ fontWeight:700 }}>{fmtMoney(a.monthlyPrice)}</td>
                    <td><Badge val={a.isActive ? 'active' : 'cancelled'} /></td>
                    <td><button onClick={() => startEditAddon(a)} style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:6, fontSize:'0.77rem', background:'var(--bg-card)', border:'1px solid var(--border-color)', color:'var(--text-secondary)', cursor:'pointer' }}><Edit3 size={11} /> Edit</button></td>
                  </tr>
                ))}
                {addons.length === 0 && <tr><td colSpan={5} style={{ textAlign:'center', color:'var(--text-muted)', padding:'1.5rem' }}>No add-ons yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit plan panel */}
      {editPlan && (
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border-color)', borderRadius:12, padding:'1.25rem', position:'sticky', top:0, alignSelf:'start' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <h3 style={{ margin:0, fontSize:'0.9rem', fontWeight:700 }}>{editPlan === 'new' ? 'New Plan' : 'Edit Plan'}</h3>
            <button onClick={() => setEditPlan(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}><X size={16} /></button>
          </div>
          <form onSubmit={handleSavePlan}>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div>
                <label style={labelStyle}>Plan Name *</label>
                <input style={inputStyle} value={form.name} onChange={e=>setForm(f=>({...f, name:e.target.value, slug: editPlan==='new' ? toSlug(e.target.value) : f.slug }))} required />
              </div>
              <div>
                <label style={labelStyle}>Slug * <span style={{ fontWeight:400, color:'var(--text-muted)', textTransform:'none', letterSpacing:0 }}>(URL-safe, unique)</span></label>
                <input style={inputStyle} value={form.slug} onChange={e=>setForm(f=>({...f,slug:toSlug(e.target.value)}))} placeholder="starter" required />
              </div>
              <div><label style={labelStyle}>Description</label><input style={inputStyle} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} /></div>
              <div><label style={labelStyle}>Base Monthly Price ($) *</label><input style={inputStyle} type="number" step="0.01" min="0" value={form.basePrice} onChange={e=>setForm(f=>({...f,basePrice:e.target.value}))} required /></div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div><label style={labelStyle}>Price / Extra Store ($)</label><input style={inputStyle} type="number" step="0.01" min="0" value={form.pricePerStore} onChange={e=>setForm(f=>({...f,pricePerStore:e.target.value}))} /></div>
                <div><label style={labelStyle}>Price / Extra Register ($)</label><input style={inputStyle} type="number" step="0.01" min="0" value={form.pricePerRegister} onChange={e=>setForm(f=>({...f,pricePerRegister:e.target.value}))} /></div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div><label style={labelStyle}>Included Stores</label><input style={inputStyle} type="number" min="1" value={form.includedStores} onChange={e=>setForm(f=>({...f,includedStores:Number(e.target.value)}))} /></div>
                <div><label style={labelStyle}>Included Registers</label><input style={inputStyle} type="number" min="1" value={form.includedRegisters} onChange={e=>setForm(f=>({...f,includedRegisters:Number(e.target.value)}))} /></div>
              </div>
              <div><label style={labelStyle}>Trial Days</label><input style={inputStyle} type="number" min="0" value={form.trialDays} onChange={e=>setForm(f=>({...f,trialDays:Number(e.target.value)}))} /></div>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:'0.85rem', color:'var(--text-primary)' }}>Public (show on pricing page)</span>
                <Toggle checked={form.isPublic} onChange={v=>setForm(f=>({...f,isPublic:v}))} />
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:'0.85rem', color:'var(--text-primary)' }}>Active</span>
                <Toggle checked={form.isActive} onChange={v=>setForm(f=>({...f,isActive:v}))} />
              </div>
              {addons.length > 0 && (
                <div>
                  <label style={labelStyle}>Included Add-ons</label>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {addons.map(a => (
                      <label key={a.key} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:'0.85rem' }}>
                        <input type="checkbox" checked={form.includedAddons.includes(a.key)} onChange={() => toggleAddon(a.key)} style={{ accentColor:'#3b82f6' }} />
                        {a.name} <span style={{ color:'var(--text-muted)', fontSize:'0.78rem' }}>({fmtMoney(a.monthlyPrice)}/mo)</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button type="submit" className="admin-btn admin-btn-primary" style={{ marginTop:16, width:'100%' }} disabled={saving}>
              {saving ? <><Loader size={13} className="spin" /> Saving...</> : <><Save size={13} /> Save Plan</>}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// ── SUBSCRIPTIONS TAB ─────────────────────────────────────────────────────────

function SubscriptionsTab() {
  const [subs,     setSubs]     = useState([]);
  const [total,    setTotal]    = useState(0);
  const [orgs,     setOrgs]     = useState([]);
  const [plans,    setPlans]    = useState([]);
  const [addons,   setAddons]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [statusF,  setStatusF]  = useState('');
  const [page,     setPage]     = useState(1);
  const [managing, setManaging] = useState(null); // org subscription being edited
  const [mForm,    setMForm]    = useState({});
  const [saving,   setSaving]   = useState(false);
  const limit = 50;

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
      setPlans(plansR.data?.plans || []);
      setAddons(plansR.data?.addons || []);
      setOrgs(orgsR.data || []);
    } catch { toast.error('Failed to load subscriptions'); }
    finally { setLoading(false); }
  }, [statusF, page]);

  useEffect(() => { load(); }, [load]);

  const STATUS_COUNTS = ['trial','active','past_due','suspended','cancelled'].reduce((acc, s) => {
    acc[s] = subs.filter(x => x.status === s).length;
    return acc;
  }, {});

  const openManage = (sub) => {
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

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...mForm };
      if (!payload.overrideMaxStores) payload.overrideMaxStores = null;
      if (!payload.overrideMaxRegisters) payload.overrideMaxRegisters = null;
      if (!payload.discountType) { payload.discountType = null; payload.discountValue = null; }
      if (!payload.discountExpiry) payload.discountExpiry = null;
      if (!payload.trialEndsAt) payload.trialEndsAt = null;
      await adminUpsertSubscription(managing.orgId, payload);
      toast.success('Subscription updated');
      setManaging(null);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const toggleExtra = (key) => setMForm(f => ({
    ...f,
    extraAddons: f.extraAddons.includes(key) ? f.extraAddons.filter(k=>k!==key) : [...f.extraAddons, key],
  }));

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      {/* Stat row */}
      <div style={{ display:'flex', gap:10, marginBottom:18, flexWrap:'wrap' }}>
        {[['Total', total, '#3b82f6'], ['Active', STATUS_COUNTS.active, '#22c55e'], ['Trial', STATUS_COUNTS.trial, '#3b82f6'],
          ['Past Due', STATUS_COUNTS.past_due, '#f97316'], ['Suspended', STATUS_COUNTS.suspended, '#ef4444']].map(([l,v,c]) => (
          <div key={l} style={{ background:'var(--bg-card)', border:'1px solid var(--border-color)', borderRadius:10, padding:'10px 18px', minWidth:90 }}>
            <div style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{l}</div>
            <div style={{ fontSize:'1.4rem', fontWeight:800, color:c, lineHeight:1.2 }}>{v ?? 0}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:10, marginBottom:14, alignItems:'center' }}>
        <select className="admin-select" style={{ width:'auto', marginBottom:0 }} value={statusF} onChange={e=>{setStatusF(e.target.value);setPage(1);}}>
          <option value="">All Statuses</option>
          {['trial','active','past_due','suspended','cancelled'].map(s=><option key={s} value={s}>{s.replace('_',' ')}</option>)}
        </select>
        <button className="admin-btn admin-btn-secondary" onClick={load}><RefreshCw size={13} /></button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns: managing ? '1fr 380px' : '1fr', gap:20 }}>
        <div>
          <div className="admin-table-wrapper" style={{ overflowX:'auto' }}>
            <table className="admin-table">
              <thead><tr><th>Organization</th><th>Plan</th><th>Status</th><th>Next Billing</th><th>Payment Method</th><th>Actions</th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)' }}><Loader size={16} className="spin" style={{ marginRight:8 }} />Loading...</td></tr>
                ) : subs.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)' }}>No subscriptions found</td></tr>
                ) : subs.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontWeight:600 }}>{s.org?.name || s.orgId.slice(0,8)}</td>
                    <td style={{ fontSize:'0.82rem' }}>{s.plan?.name || '—'}</td>
                    <td><Badge val={s.status} /></td>
                    <td style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>{fmtDate(s.nextBillingDate)}</td>
                    <td style={{ fontSize:'0.78rem' }}>
                      {s.paymentMethodType ? (
                        <span>{s.paymentMethodType === 'ach' ? '🏦' : '💳'} ···· {s.paymentLast4 || '—'}</span>
                      ) : <span style={{ color:'var(--text-muted)' }}>None</span>}
                    </td>
                    <td>
                      <button onClick={() => openManage(s)} style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:6, fontSize:'0.77rem', fontWeight:600, background:'var(--bg-card)', border:'1px solid var(--border-color)', color:'var(--text-secondary)', cursor:'pointer' }}><Edit3 size={11} /> Manage</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="admin-pagination">
              <button className="admin-btn admin-btn-secondary" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}><ChevronLeft size={13} /> Prev</button>
              <span style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>Page {page} of {totalPages}</span>
              <button className="admin-btn admin-btn-secondary" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}>Next <ChevronRight size={13} /></button>
            </div>
          )}
        </div>

        {/* Manage panel */}
        {managing && (
          <div style={{ background:'var(--bg-card)', border:'1px solid var(--border-color)', borderRadius:12, padding:'1.25rem', position:'sticky', top:0, alignSelf:'start', maxHeight:'90vh', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <h3 style={{ margin:0, fontSize:'0.9rem', fontWeight:700 }}>Manage — {managing.org?.name}</h3>
              <button onClick={() => setManaging(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}><X size={16} /></button>
            </div>
            <form onSubmit={handleSave}>
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <div>
                  <label style={labelStyle}>Plan</label>
                  <select className="admin-select" style={{ marginBottom:0 }} value={mForm.planId} onChange={e=>setMForm(f=>({...f,planId:e.target.value}))}>
                    {plans.map(p=><option key={p.id} value={p.id}>{p.name} — {fmtMoney(p.basePrice)}/mo</option>)}
                  </select>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <div><label style={labelStyle}>Override Max Stores</label><input style={inputStyle} type="number" min="1" value={mForm.overrideMaxStores} onChange={e=>setMForm(f=>({...f,overrideMaxStores:e.target.value}))} placeholder="(use plan default)" /></div>
                  <div><label style={labelStyle}>Override Max Registers</label><input style={inputStyle} type="number" min="1" value={mForm.overrideMaxRegisters} onChange={e=>setMForm(f=>({...f,overrideMaxRegisters:e.target.value}))} placeholder="(use plan default)" /></div>
                </div>
                {addons.length > 0 && (
                  <div>
                    <label style={labelStyle}>Extra Add-ons (beyond plan)</label>
                    {addons.map(a=>(
                      <label key={a.key} style={{ display:'flex', alignItems:'center', gap:7, cursor:'pointer', fontSize:'0.82rem', marginBottom:4 }}>
                        <input type="checkbox" checked={mForm.extraAddons.includes(a.key)} onChange={()=>toggleExtra(a.key)} style={{ accentColor:'#3b82f6' }} />
                        {a.name} <span style={{ color:'var(--text-muted)', fontSize:'0.75rem' }}>+{fmtMoney(a.monthlyPrice)}/mo</span>
                      </label>
                    ))}
                  </div>
                )}
                <div>
                  <label style={labelStyle}>Discount Type</label>
                  <select className="admin-select" style={{ marginBottom:0 }} value={mForm.discountType} onChange={e=>setMForm(f=>({...f,discountType:e.target.value}))}>
                    <option value="">None</option>
                    <option value="percent">Percentage (%)</option>
                    <option value="fixed">Fixed Amount ($)</option>
                  </select>
                </div>
                {mForm.discountType && <>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    <div><label style={labelStyle}>{mForm.discountType==='percent'?'Discount %':'Discount $'}</label><input style={inputStyle} type="number" step="0.01" min="0" value={mForm.discountValue} onChange={e=>setMForm(f=>({...f,discountValue:e.target.value}))} /></div>
                    <div><label style={labelStyle}>Expires On</label><input style={inputStyle} type="date" value={mForm.discountExpiry} onChange={e=>setMForm(f=>({...f,discountExpiry:e.target.value}))} /></div>
                  </div>
                  <div><label style={labelStyle}>Discount Note</label><input style={inputStyle} value={mForm.discountNote} onChange={e=>setMForm(f=>({...f,discountNote:e.target.value}))} placeholder="e.g. First 3 months promo" /></div>
                </>}
                <div>
                  <label style={labelStyle}>Status</label>
                  <select className="admin-select" style={{ marginBottom:0 }} value={mForm.status} onChange={e=>setMForm(f=>({...f,status:e.target.value}))}>
                    {['trial','active','past_due','suspended','cancelled'].map(s=><option key={s} value={s}>{s.replace('_',' ')}</option>)}
                  </select>
                </div>
                {mForm.status === 'trial' && (
                  <div><label style={labelStyle}>Trial Ends At</label><input style={inputStyle} type="date" value={mForm.trialEndsAt} onChange={e=>setMForm(f=>({...f,trialEndsAt:e.target.value}))} /></div>
                )}
              </div>
              <button type="submit" className="admin-btn admin-btn-primary" style={{ marginTop:16, width:'100%' }} disabled={saving}>
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

function InvoicesTab() {
  const [invoices, setInvoices] = useState([]);
  const [total,    setTotal]    = useState(0);
  const [orgs,     setOrgs]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [filters,  setFilters]  = useState({ orgId:'', status:'', dateFrom:'', dateTo:'' });
  const [page,     setPage]     = useState(1);
  const limit = 50;

  useEffect(() => { getAdminOrganizations({ limit:500 }).then(r=>setOrgs(r.data||[])).catch(()=>{}); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (filters.orgId)    params.orgId  = filters.orgId;
      if (filters.status)   params.status = filters.status;
      const r = await adminListInvoices(params);
      setInvoices(r.data || []);
      setTotal(r.meta?.total || 0);
    } catch { toast.error('Failed to load invoices'); }
    finally { setLoading(false); }
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  const handleWriteOff = async (id) => {
    if (!window.confirm('Write off this invoice?')) return;
    try { await adminWriteOffInvoice(id); toast.success('Invoice written off'); load(); }
    catch { toast.error('Failed'); }
  };

  const handleRetry = async (id) => {
    try { await adminRetryInvoice(id); toast.success('Retry triggered'); load(); }
    catch { toast.error('Failed'); }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        <select className="admin-select" style={{ width:'auto', marginBottom:0 }} value={filters.orgId} onChange={e=>{setFilters(f=>({...f,orgId:e.target.value}));setPage(1);}}>
          <option value="">All Organizations</option>
          {orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select className="admin-select" style={{ width:'auto', marginBottom:0 }} value={filters.status} onChange={e=>{setFilters(f=>({...f,status:e.target.value}));setPage(1);}}>
          <option value="">All Statuses</option>
          {['pending','paid','failed','written_off'].map(s=><option key={s} value={s}>{s.replace('_',' ')}</option>)}
        </select>
        <button className="admin-btn admin-btn-secondary" onClick={load}><RefreshCw size={13} /></button>
        <span style={{ fontSize:'0.8rem', color:'var(--text-muted)', marginLeft:'auto' }}>{total.toLocaleString()} invoices</span>
      </div>
      <div className="admin-table-wrapper" style={{ overflowX:'auto' }}>
        <table className="admin-table">
          <thead><tr><th>Invoice #</th><th>Organization</th><th>Period</th><th>Base</th><th>Discount</th><th>Total</th><th>Status</th><th>Attempts</th><th>Actions</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)' }}><Loader size={16} className="spin" style={{ marginRight:8 }} />Loading...</td></tr>
            ) : invoices.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)' }}>No invoices found</td></tr>
            ) : invoices.map(inv => (
              <tr key={inv.id}>
                <td style={{ fontFamily:'monospace', fontSize:'0.78rem' }}>{inv.invoiceNumber}</td>
                <td style={{ fontSize:'0.82rem', fontWeight:600 }}>{inv.subscription?.org?.name || inv.orgId.slice(0,8)}</td>
                <td style={{ fontSize:'0.75rem', color:'var(--text-muted)', whiteSpace:'nowrap' }}>{fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}</td>
                <td style={{ fontWeight:600 }}>{fmtMoney(inv.baseAmount)}</td>
                <td style={{ color:'#22c55e' }}>{Number(inv.discountAmount)>0?`-${fmtMoney(inv.discountAmount)}`:'—'}</td>
                <td style={{ fontWeight:800 }}>{fmtMoney(inv.totalAmount)}</td>
                <td><Badge val={inv.status} /></td>
                <td style={{ textAlign:'center', fontSize:'0.82rem' }}>{inv.attemptCount}</td>
                <td>
                  <div style={{ display:'flex', gap:5 }}>
                    {inv.status === 'failed' && <>
                      <button onClick={()=>handleRetry(inv.id)} style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'3px 8px', borderRadius:5, fontSize:'0.72rem', fontWeight:700, background:'rgba(59,130,246,.1)', border:'1px solid rgba(59,130,246,.25)', color:'#3b82f6', cursor:'pointer' }}><RefreshCw size={10} /> Retry</button>
                      <button onClick={()=>handleWriteOff(inv.id)} style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'3px 8px', borderRadius:5, fontSize:'0.72rem', fontWeight:700, background:'rgba(148,163,184,.1)', border:'1px solid rgba(148,163,184,.2)', color:'var(--text-muted)', cursor:'pointer' }}>Write Off</button>
                    </>}
                    {inv.status === 'paid' && <span style={{ color:'#22c55e', fontSize:'0.75rem' }}>✓ Paid {fmtDate(inv.paidAt)}</span>}
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
          <span style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>Page {page} of {totalPages}</span>
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

function EquipmentTab() {
  const [orders,       setOrders]       = useState([]);
  const [ordersTotal,  setOrdersTotal]  = useState(0);
  const [products,     setProducts]     = useState([]);
  const [orderStatus,  setOrderStatus]  = useState('');
  const [ordersPage,   setOrdersPage]   = useState(1);
  const [loadingOrders,setLoadingOrders]= useState(true);
  const [editOrder,    setEditOrder]    = useState(null);
  const [orderForm,    setOrderForm]    = useState({ status:'', trackingNumber:'', trackingCarrier:'', notes:'' });
  const [savingOrder,  setSavingOrder]  = useState(false);
  const [showProducts, setShowProducts] = useState(false);
  const [showProdForm, setShowProdForm] = useState(false);
  const [editProduct,  setEditProduct]  = useState(null);
  const [prodForm,     setProdForm]     = useState({ name:'', slug:'', description:'', price:'', comparePrice:'', category:'terminal', stock:0, trackStock:true, isActive:true, sortOrder:0, specs:'', images:'' });
  const [savingProd,   setSavingProd]   = useState(false);
  const limit = 25;

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const params = { page: ordersPage, limit };
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

  const openEditOrder = (order) => {
    setEditOrder(order);
    setOrderForm({ status: order.status, trackingNumber: order.trackingNumber||'', trackingCarrier: order.trackingCarrier||'', notes: order.notes||'' });
  };

  const handleSaveOrder = async (e) => {
    e.preventDefault();
    setSavingOrder(true);
    try {
      await adminUpdateEquipmentOrder(editOrder.id, orderForm);
      toast.success('Order updated');
      setEditOrder(null);
      loadOrders();
    } catch { toast.error('Save failed'); }
    finally { setSavingOrder(false); }
  };

  const startEditProduct = (prod) => {
    setEditProduct(prod);
    setProdForm({
      name: prod.name, slug: prod.slug, description: prod.description||'',
      price: prod.price, comparePrice: prod.comparePrice||'',
      category: prod.category||'terminal', stock: prod.stock, trackStock: prod.trackStock,
      isActive: prod.isActive, sortOrder: prod.sortOrder,
      specs: prod.specs ? JSON.stringify(prod.specs) : '',
      images: Array.isArray(prod.images) ? prod.images.join('\n') : '',
    });
    setShowProdForm(true);
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    setSavingProd(true);
    try {
      let specs = null;
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
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSavingProd(false); }
  };

  const autoSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  const totalPages = Math.ceil(ordersTotal / limit);

  return (
    <div>
      {/* Orders Section */}
      <div style={{ marginBottom:28 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <h3 style={{ margin:0, fontSize:'0.95rem', fontWeight:700 }}>Equipment Orders</h3>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <select className="admin-select" style={{ width:'auto', marginBottom:0 }} value={orderStatus} onChange={e=>{setOrderStatus(e.target.value);setOrdersPage(1);}}>
              <option value="">All Statuses</option>
              {ORDER_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <button className="admin-btn admin-btn-secondary" onClick={loadOrders}><RefreshCw size={13} /></button>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns: editOrder ? '1fr 340px' : '1fr', gap:20 }}>
          <div>
            <div className="admin-table-wrapper" style={{ overflowX:'auto' }}>
              <table className="admin-table">
                <thead><tr><th>Order #</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Tracking</th><th>Actions</th></tr></thead>
                <tbody>
                  {loadingOrders ? (
                    <tr><td colSpan={8} style={{ textAlign:'center', padding:'1.5rem', color:'var(--text-muted)' }}><Loader size={15} className="spin" style={{ marginRight:8 }} />Loading...</td></tr>
                  ) : orders.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign:'center', padding:'1.5rem', color:'var(--text-muted)' }}>No orders found</td></tr>
                  ) : orders.map(o => (
                    <tr key={o.id}>
                      <td style={{ fontFamily:'monospace', fontSize:'0.78rem' }}>{o.orderNumber}</td>
                      <td><div style={{ fontWeight:600, fontSize:'0.82rem' }}>{o.name}</div><div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>{o.email}</div></td>
                      <td style={{ fontSize:'0.82rem' }}>{o.items?.map(i=>`${i.product?.name||'?'} ×${i.qty}`).join(', ')}</td>
                      <td style={{ fontWeight:700 }}>{fmtMoney(o.total)}</td>
                      <td><Badge val={o.paymentStatus} /></td>
                      <td><Badge val={o.status} /></td>
                      <td style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>{o.trackingNumber ? <><span style={{ fontWeight:600 }}>{o.trackingCarrier}</span> {o.trackingNumber}</> : '—'}</td>
                      <td><button onClick={()=>openEditOrder(o)} style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:6, fontSize:'0.77rem', fontWeight:600, background:'var(--bg-card)', border:'1px solid var(--border-color)', color:'var(--text-secondary)', cursor:'pointer' }}><Edit3 size={11} /> Update</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="admin-pagination">
                <button className="admin-btn admin-btn-secondary" onClick={()=>setOrdersPage(p=>Math.max(1,p-1))} disabled={ordersPage===1}><ChevronLeft size={13} /> Prev</button>
                <span style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>Page {ordersPage} of {totalPages}</span>
                <button className="admin-btn admin-btn-secondary" onClick={()=>setOrdersPage(p=>Math.min(totalPages,p+1))} disabled={ordersPage===totalPages}>Next <ChevronRight size={13} /></button>
              </div>
            )}
          </div>

          {editOrder && (
            <div style={{ background:'var(--bg-card)', border:'1px solid var(--border-color)', borderRadius:12, padding:'1.25rem', alignSelf:'start', position:'sticky', top:0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                <h4 style={{ margin:0, fontSize:'0.88rem', fontWeight:700 }}>Update Order {editOrder.orderNumber}</h4>
                <button onClick={()=>setEditOrder(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}><X size={16} /></button>
              </div>
              <form onSubmit={handleSaveOrder}>
                <div style={{ display:'flex', flexDirection:'column', gap:11 }}>
                  <div>
                    <label style={labelStyle}>Status</label>
                    <select className="admin-select" style={{ marginBottom:0 }} value={orderForm.status} onChange={e=>setOrderForm(f=>({...f,status:e.target.value}))}>
                      {ORDER_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Tracking Carrier</label>
                    <select className="admin-select" style={{ marginBottom:0 }} value={orderForm.trackingCarrier} onChange={e=>setOrderForm(f=>({...f,trackingCarrier:e.target.value}))}>
                      <option value="">Select carrier</option>
                      {CARRIERS.map(c=><option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div><label style={labelStyle}>Tracking Number</label><input style={inputStyle} value={orderForm.trackingNumber} onChange={e=>setOrderForm(f=>({...f,trackingNumber:e.target.value}))} placeholder="1Z999AA10123456784" /></div>
                  <div><label style={labelStyle}>Notes</label><textarea style={{ ...inputStyle, resize:'vertical', minHeight:60 }} value={orderForm.notes} onChange={e=>setOrderForm(f=>({...f,notes:e.target.value}))} /></div>
                </div>
                <button type="submit" className="admin-btn admin-btn-primary" style={{ marginTop:14, width:'100%' }} disabled={savingOrder}>
                  {savingOrder ? <><Loader size={13} className="spin" /> Saving...</> : <><Save size={13} /> Save</>}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Products Section */}
      <div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, paddingTop:16, borderTop:'1px solid var(--border-color)' }}>
          <h3 style={{ margin:0, fontSize:'0.95rem', fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:8 }} onClick={()=>setShowProducts(s=>!s)}>
            Product Catalog <span style={{ fontSize:'0.75rem', color:'var(--text-muted)', fontWeight:400 }}>({showProducts?'click to hide':'click to expand'})</span>
          </h3>
          {showProducts && <button className="admin-btn admin-btn-primary" onClick={()=>{setEditProduct(null);setProdForm({name:'',slug:'',description:'',price:'',comparePrice:'',category:'terminal',stock:0,trackStock:true,isActive:true,sortOrder:0,specs:'',images:''});setShowProdForm(s=>!s)}}><Plus size={13} /> Add Product</button>}
        </div>

        {showProducts && <>
          {showProdForm && (
            <form onSubmit={handleSaveProduct} style={{ background:'var(--bg-card)', border:'1px solid rgba(59,130,246,.25)', borderRadius:10, padding:'1rem', marginBottom:14 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
                <div><label style={labelStyle}>Name *</label><input style={inputStyle} value={prodForm.name} onChange={e=>{setProdForm(f=>({...f,name:e.target.value,slug:editProduct?f.slug:autoSlug(e.target.value)}))}} required /></div>
                <div><label style={labelStyle}>Slug *</label><input style={inputStyle} value={prodForm.slug} onChange={e=>setProdForm(f=>({...f,slug:e.target.value}))} required /></div>
                <div><label style={labelStyle}>Price ($) *</label><input style={inputStyle} type="number" step="0.01" value={prodForm.price} onChange={e=>setProdForm(f=>({...f,price:e.target.value}))} required /></div>
                <div><label style={labelStyle}>Compare Price ($)</label><input style={inputStyle} type="number" step="0.01" value={prodForm.comparePrice} onChange={e=>setProdForm(f=>({...f,comparePrice:e.target.value}))} /></div>
                <div>
                  <label style={labelStyle}>Category</label>
                  <select className="admin-select" style={{ marginBottom:0 }} value={prodForm.category} onChange={e=>setProdForm(f=>({...f,category:e.target.value}))}>
                    {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div><label style={labelStyle}>Stock</label><input style={inputStyle} type="number" min="0" value={prodForm.stock} onChange={e=>setProdForm(f=>({...f,stock:Number(e.target.value)}))} /></div>
              </div>
              <div style={{ marginBottom:10 }}><label style={labelStyle}>Description</label><textarea style={{ ...inputStyle, resize:'vertical', minHeight:60 }} value={prodForm.description} onChange={e=>setProdForm(f=>({...f,description:e.target.value}))} /></div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
                <div><label style={labelStyle}>Image URLs (one per line)</label><textarea style={{ ...inputStyle, resize:'vertical', minHeight:60 }} value={prodForm.images} onChange={e=>setProdForm(f=>({...f,images:e.target.value}))} /></div>
                <div><label style={labelStyle}>Specs (JSON object)</label><textarea style={{ ...inputStyle, resize:'vertical', minHeight:60, fontFamily:'monospace', fontSize:'0.78rem' }} value={prodForm.specs} onChange={e=>setProdForm(f=>({...f,specs:e.target.value}))} placeholder='{"RAM":"4GB","Screen":"15.6 inch"}' /></div>
              </div>
              <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:10 }}>
                <label style={{ display:'flex', alignItems:'center', gap:7, cursor:'pointer', fontSize:'0.85rem' }}>
                  <input type="checkbox" checked={prodForm.isActive} onChange={e=>setProdForm(f=>({...f,isActive:e.target.checked}))} style={{ accentColor:'#3b82f6' }} /> Active
                </label>
                <label style={{ display:'flex', alignItems:'center', gap:7, cursor:'pointer', fontSize:'0.85rem' }}>
                  <input type="checkbox" checked={prodForm.trackStock} onChange={e=>setProdForm(f=>({...f,trackStock:e.target.checked}))} style={{ accentColor:'#3b82f6' }} /> Track Stock
                </label>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button type="submit" className="admin-btn admin-btn-primary" disabled={savingProd}>{savingProd?<><Loader size={13} className="spin"/>Saving...</>:<><Save size={13}/>{editProduct?'Update':'Add'} Product</>}</button>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={()=>{setShowProdForm(false);setEditProduct(null);}}>Cancel</button>
              </div>
            </form>
          )}
          <div className="admin-table-wrapper" style={{ overflowX:'auto' }}>
            <table className="admin-table">
              <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Active</th><th>Actions</th></tr></thead>
              <tbody>
                {products.map(p=>(
                  <tr key={p.id}>
                    <td style={{ fontWeight:600 }}>{p.name}</td>
                    <td style={{ fontSize:'0.78rem', textTransform:'capitalize' }}>{p.category||'—'}</td>
                    <td style={{ fontWeight:700 }}>{fmtMoney(p.price)}{p.comparePrice&&<span style={{ marginLeft:6, fontSize:'0.75rem', color:'var(--text-muted)', textDecoration:'line-through' }}>{fmtMoney(p.comparePrice)}</span>}</td>
                    <td style={{ fontSize:'0.82rem', color: p.stock<5?'#f97316':'var(--text-secondary)', fontWeight: p.stock<5?700:400 }}>{p.stock}</td>
                    <td><Badge val={p.isActive?'active':'cancelled'}/></td>
                    <td><button onClick={()=>startEditProduct(p)} style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:6, fontSize:'0.77rem', fontWeight:600, background:'var(--bg-card)', border:'1px solid var(--border-color)', color:'var(--text-secondary)', cursor:'pointer' }}><Edit3 size={11}/> Edit</button></td>
                  </tr>
                ))}
                {products.length===0&&<tr><td colSpan={6} style={{ textAlign:'center', padding:'1.5rem', color:'var(--text-muted)' }}>No products yet</td></tr>}
              </tbody>
            </table>
          </div>
        </>}
      </div>
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

const TABS = [
  { id:'plans',         label:'Plans & Add-ons', icon:<CreditCard size={14}/> },
  { id:'subscriptions', label:'Subscriptions',   icon:<Building2  size={14}/> },
  { id:'invoices',      label:'Invoices',         icon:<FileText   size={14}/> },
  { id:'equipment',     label:'Equipment',        icon:<Package    size={14}/> },
];

export default function AdminBilling() {
  const [tab, setTab] = useState('plans');

  return (
    <div className="layout-container">
      <AdminSidebar />
      <main className="main-content admin-page">
        <div className="admin-header">
          <div className="admin-header-left">
            <h1>Billing Management</h1>
            <p>Subscription plans, org billing, invoices, and equipment orders</p>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display:'flex', gap:4, marginBottom:24, borderBottom:'1px solid var(--border-color)', paddingBottom:0 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display:'flex', alignItems:'center', gap:7,
              padding:'8px 18px', border:'none', background:'none', cursor:'pointer',
              fontSize:'0.85rem', fontWeight: tab===t.id ? 700 : 500,
              color: tab===t.id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: tab===t.id ? '2px solid #3b82f6' : '2px solid transparent',
              marginBottom:'-1px', transition:'color .15s',
            }}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {tab === 'plans'         && <PlansTab />}
        {tab === 'subscriptions' && <SubscriptionsTab />}
        {tab === 'invoices'      && <InvoicesTab />}
        {tab === 'equipment'     && <EquipmentTab />}
      </main>
    </div>
  );
}
