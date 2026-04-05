/**
 * ProductForm — Full-page add / edit form for a master product.
 *
 * Section order:
 *   1. Product Info     — name, brand, UPC, size, description
 *   2. Pricing          — case cost → unit cost → retail, margin
 *   3. Pack Config      — sell-unit type, pack sizes, animated visual
 *   4. Store Deals      — BOGO / % off / $ off / multi-buy / sale price
 *   5. Container/Deposit
 *
 * Right sidebar: Classification, Compliance, Status, Store Availability
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { useSetupStatus } from '../hooks/useSetupStatus';
import { NoStoreBanner } from '../components/SetupGuide';
import {
  getCatalogProduct, createCatalogProduct, updateCatalogProduct,
  getCatalogDepartments, createCatalogDepartment, updateCatalogDepartment, deleteCatalogDepartment,
  getCatalogVendors, createCatalogVendor, updateCatalogVendor, deleteCatalogVendor,
  getCatalogDepositRules,
  upsertStoreInventory,
  getCatalogPromotions, createCatalogPromotion, updateCatalogPromotion, deleteCatalogPromotion,
} from '../services/api';
import { toast } from 'react-toastify';
import {
  ChevronLeft, Save, Package, Building2, Truck, X, Plus,
  Trash2, Settings, DollarSign, Info, Check, Tag, Percent,
  Gift, ShoppingBag, Zap, Calendar, Edit2, AlertCircle,
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

const isValidUPC = (v) => !v || /^\d{7,14}$/.test(v.replace(/\s/g, ''));

// ─────────────────────────────────────────────────────────────────────────────
// Inline Dept Manager
// ─────────────────────────────────────────────────────────────────────────────

function DeptManager({ departments, onClose, onRefresh }) {
  const [list, setList] = useState(departments);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const startEdit = (d) => {
    setEditing(d.id || 'new');
    setForm({ name: d.name ?? '', code: d.code ?? '', taxClass: d.taxClass ?? 'grocery',
      ageRequired: d.ageRequired ?? '', ebtEligible: d.ebtEligible ?? false,
      bottleDeposit: d.bottleDeposit ?? false, color: d.color ?? '#6366f1',
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
    if (!window.confirm('Delete department?')) return;
    try {
      await deleteCatalogDepartment(id);
      setList(l => l.filter(d => d.id !== id));
      onRefresh();
    } catch (e) { toast.error(e.response?.data?.error || 'Delete failed'); }
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1200, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.55)' }} onClick={onClose} />
      <div style={{ position:'relative', width:'100%', maxWidth:660, maxHeight:'80vh', background:'var(--bg-secondary)',
        borderRadius:12, display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 24px 64px rgba(0,0,0,.4)' }}>
        <div style={{ padding:'1rem 1.5rem', borderBottom:'1px solid var(--border-color)',
          display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <Building2 size={15} color="var(--accent-primary)" />
            <span style={{ fontWeight:700, fontSize:'0.9rem' }}>Manage Departments</span>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)' }}><X size={16} /></button>
        </div>
        <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
          <div style={{ width:240, borderRight:'1px solid var(--border-color)', overflowY:'auto', padding:'0.75rem' }}>
            <button onClick={() => startEdit({ name:'', active:true })}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:6, padding:'0.45rem 0.75rem',
                borderRadius:6, border:'1px dashed var(--border-color)', background:'none',
                color:'var(--accent-primary)', cursor:'pointer', fontSize:'0.78rem', fontWeight:600, marginBottom:6 }}>
              <Plus size={12} /> Add Department
            </button>
            {list.map(d => (
              <div key={d.id} onClick={() => startEdit(d)}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'0.4rem 0.7rem',
                  borderRadius:6, cursor:'pointer', background: editing===d.id ? 'var(--bg-tertiary)':'transparent', marginBottom:1 }}>
                <div style={{ width:9, height:9, borderRadius:'50%', background:d.color||'#6366f1', flexShrink:0 }} />
                <span style={{ flex:1, fontSize:'0.8rem', fontWeight:500 }}>{d.name}</span>
                <button onClick={e=>{e.stopPropagation();del(d.id);}}
                  style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', opacity:0, transition:'opacity .1s' }}
                  onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=0}>
                  <Trash2 size={11} /></button>
              </div>
            ))}
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'1.25rem' }}>
            {editing ? (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.7rem' }}>
                  <div style={{ gridColumn:'span 2' }}>
                    <label style={lbl}>Name *</label>
                    <input className="form-input" style={{ width:'100%' }} value={form.name}
                      onChange={e=>setForm(f=>({...f,name:e.target.value}))} />
                  </div>
                  <div>
                    <label style={lbl}>Code</label>
                    <input className="form-input" style={{ width:'100%' }} value={form.code}
                      onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))} maxLength={8} />
                  </div>
                  <div>
                    <label style={lbl}>Tax Class</label>
                    <select className="form-input" style={{ width:'100%' }} value={form.taxClass}
                      onChange={e=>setForm(f=>({...f,taxClass:e.target.value}))}>
                      {TAX_CLASSES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Age Required</label>
                    <select className="form-input" style={{ width:'100%' }} value={form.ageRequired}
                      onChange={e=>setForm(f=>({...f,ageRequired:e.target.value}))}>
                      <option value="">None</option><option value="18">18+</option><option value="21">21+</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginTop:'0.75rem' }}>
                  <label style={lbl}>Color</label>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                    {DEPT_COLORS.map(c => (
                      <button key={c} type="button" onClick={()=>setForm(f=>({...f,color:c}))}
                        style={{ width:22, height:22, borderRadius:5, background:c, border: form.color===c?'2px solid white':'2px solid transparent',
                          outline:form.color===c?`2px solid ${c}`:'none', cursor:'pointer' }} />
                    ))}
                  </div>
                </div>
                <div style={{ display:'flex', gap:'1.25rem', marginTop:'0.875rem' }}>
                  {[['EBT','ebtEligible'],['Bottle Deposit','bottleDeposit'],['Active','active']].map(([label,key])=>(
                    <div key={key}>
                      <div style={lbl}>{label}</div>
                      <Tog value={!!form[key]} onChange={v=>setForm(f=>({...f,[key]:v}))} />
                    </div>
                  ))}
                </div>
                <div style={{ display:'flex', gap:8, marginTop:'1rem' }}>
                  <button onClick={save} disabled={saving}
                    style={{ ...btnPrimary, padding:'0.45rem 1rem' }}>
                    {saving ? 'Saving…' : editing==='new' ? 'Add' : 'Save'}
                  </button>
                  <button onClick={()=>setEditing(null)} style={{ ...btnSecondary, padding:'0.45rem 0.875rem' }}>Cancel</button>
                </div>
              </>
            ) : (
              <p style={{ color:'var(--text-muted)', fontSize:'0.82rem', marginTop:'2rem', textAlign:'center' }}>
                Select a department to edit
              </p>
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

function VendorManager({ vendors, onClose, onRefresh }) {
  const [list, setList] = useState(vendors);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const startEdit = (v) => {
    setEditing(v.id || 'new');
    setForm({ name:v.name??'', code:v.code??'', contactName:v.contactName??'',
      email:v.email??'', phone:v.phone??'', terms:v.terms??'', accountNo:v.accountNo??'', active:v.active??true });
  };

  const save = async () => {
    if (!form.name) { toast.error('Vendor name required'); return; }
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
    if (!window.confirm('Delete vendor?')) return;
    try {
      await deleteCatalogVendor(id);
      setList(l => l.filter(v => v.id!==id));
      onRefresh();
    } catch (e) { toast.error(e.response?.data?.error||'Delete failed'); }
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1200, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.55)' }} onClick={onClose} />
      <div style={{ position:'relative', width:'100%', maxWidth:640, maxHeight:'80vh', background:'var(--bg-secondary)',
        borderRadius:12, display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 24px 64px rgba(0,0,0,.4)' }}>
        <div style={{ padding:'1rem 1.5rem', borderBottom:'1px solid var(--border-color)',
          display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <Truck size={15} color="var(--accent-primary)" />
            <span style={{ fontWeight:700, fontSize:'0.9rem' }}>Manage Vendors</span>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)' }}><X size={16} /></button>
        </div>
        <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
          <div style={{ width:200, borderRight:'1px solid var(--border-color)', overflowY:'auto', padding:'0.75rem' }}>
            <button onClick={() => startEdit({ name:'', active:true })}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:6, padding:'0.45rem 0.75rem',
                borderRadius:6, border:'1px dashed var(--border-color)', background:'none',
                color:'var(--accent-primary)', cursor:'pointer', fontSize:'0.78rem', fontWeight:600, marginBottom:6 }}>
              <Plus size={12} /> Add Vendor
            </button>
            {list.map(v => (
              <div key={v.id} onClick={() => startEdit(v)}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'0.4rem 0.7rem',
                  borderRadius:6, cursor:'pointer', background: editing===v.id?'var(--bg-tertiary)':'transparent', marginBottom:1 }}>
                <Truck size={11} color="var(--text-muted)" />
                <span style={{ flex:1, fontSize:'0.78rem', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v.name}</span>
                <button onClick={e=>{e.stopPropagation();del(v.id);}}
                  style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', opacity:0 }}
                  onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=0}>
                  <Trash2 size={11} /></button>
              </div>
            ))}
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'1.25rem' }}>
            {editing ? (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.7rem' }}>
                  {[['Vendor Name *','name','span 2'],['Short Code','code',''],['Contact','contactName',''],
                    ['Email','email',''],['Phone','phone',''],['Terms','terms','Net 30'],['Account #','accountNo','']].map(([label,key,col])=>(
                    <div key={key} style={{ gridColumn: col||'span 1' }}>
                      <label style={lbl}>{label}</label>
                      <input className="form-input" style={{ width:'100%' }} value={form[key]??''}
                        onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} />
                    </div>
                  ))}
                </div>
                <div style={{ marginTop:'0.875rem' }}>
                  <div style={lbl}>Active</div><Tog value={form.active} onChange={v=>setForm(f=>({...f,active:v}))} />
                </div>
                <div style={{ display:'flex', gap:8, marginTop:'1rem' }}>
                  <button onClick={save} disabled={saving} style={{ ...btnPrimary, padding:'0.45rem 1rem' }}>
                    {saving?'Saving…':editing==='new'?'Add':'Save'}
                  </button>
                  <button onClick={()=>setEditing(null)} style={{ ...btnSecondary, padding:'0.45rem 0.875rem' }}>Cancel</button>
                </div>
              </>
            ) : (
              <p style={{ color:'var(--text-muted)', fontSize:'0.82rem', marginTop:'2rem', textAlign:'center' }}>Select a vendor</p>
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
      style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', padding:0,
        color: value ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
      <div style={{ width:34, height:19, borderRadius:10, position:'relative',
        background: value ? 'var(--accent-primary)' : 'var(--border-color)', transition:'background .15s', flexShrink:0 }}>
        <div style={{ position:'absolute', top:2, left:value?16:2, width:15, height:15, borderRadius:'50%',
          background:'#fff', transition:'left .15s', boxShadow:'0 1px 3px rgba(0,0,0,.2)' }} />
      </div>
      <span style={{ fontSize:'0.8rem', fontWeight:500 }}>{value ? 'Yes' : 'No'}</span>
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
// Shared micro-styles
// ─────────────────────────────────────────────────────────────────────────────

const lbl = {
  display:'block', fontSize:'0.72rem', fontWeight:600,
  color:'var(--text-secondary)', marginBottom:'0.3rem',
};

const card = {
  background:'var(--bg-secondary)', border:'1px solid var(--border-color)',
  borderRadius:10, padding:'1.25rem', marginBottom:'1rem',
};

const btnPrimary = {
  display:'flex', alignItems:'center', gap:6, padding:'0.55rem 1.5rem',
  borderRadius:6, border:'none', cursor:'pointer', fontWeight:600, fontSize:'0.85rem',
  background:'var(--accent-primary)', color:'#fff',
};

const btnSecondary = {
  display:'flex', alignItems:'center', gap:6, padding:'0.55rem 1rem',
  borderRadius:6, border:'1px solid var(--border-color)', cursor:'pointer',
  fontWeight:600, fontSize:'0.85rem', background:'none', color:'var(--text-secondary)',
};

const sectionTitle = {
  fontSize:'0.65rem', fontWeight:700, textTransform:'uppercase',
  letterSpacing:'0.1em', color:'var(--text-muted)', marginBottom:'0.875rem',
};

// ─────────────────────────────────────────────────────────────────────────────
// Main ProductForm page
// ─────────────────────────────────────────────────────────────────────────────

export default function ProductForm() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const isEdit   = Boolean(id);
  const setup    = useSetupStatus();

  const [saving,         setSaving]         = useState(false);
  const [loading,        setLoading]        = useState(isEdit);
  const [departments,    setDepartments]    = useState([]);
  const [vendors,        setVendors]        = useState([]);
  const [depositRules,   setDepositRules]   = useState([]);
  const [selectedStores, setSelectedStores] = useState(null);
  const [showDeptMgr,    setShowDeptMgr]    = useState(false);
  const [showVendMgr,    setShowVendMgr]    = useState(false);

  // ── Deposit toggle ─────────────────────────────────────────────────────────
  const [depositToggle, setDepositToggle] = useState(false);

  // ── Deals state ────────────────────────────────────────────────────────────
  const [deals,       setDeals]       = useState([]);   // existing/new deals
  const [dealForm,    setDealForm]    = useState(null); // null=hidden, obj=editing
  const [editDealIdx, setEditDealIdx] = useState(null); // index in deals[] being edited

  const blank = {
    name:'', brand:'', upc:'', description:'',
    departmentId:'', vendorId:'',
    taxClass:'grocery', taxable:true,
    sellUnit:'each', casePacks:1, sellUnitSize:1,
    defaultCasePrice:'', defaultCostPrice:'', defaultRetailPrice:'',
    containerType:'', containerVolumeOz:'', depositRuleId:'',
    ebtEligible:false, ageRequired:'', discountEligible:true, byWeight:false, byUnit:true,
    active:true,
    size:'', sizeUnit:'oz',
  };

  const [form, setForm] = useState(blank);
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // ── Load support data ──────────────────────────────────────────────────────
  const loadSupport = useCallback(async () => {
    try {
      const [d, v, dep] = await Promise.all([
        getCatalogDepartments(), getCatalogVendors(), getCatalogDepositRules(),
      ]);
      setDepartments((d?.data || d) ?? []);
      setVendors((v?.data || v) ?? []);
      setDepositRules((dep?.data || dep) ?? []);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadSupport(); }, []);

  // ── Load existing product ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const [res, promoRes] = await Promise.all([
          getCatalogProduct(id),
          getCatalogPromotions({ masterProductId: id }).catch(() => null),
        ]);
        const p = res?.data || res;
        const cp  = p.casePacks    ?? p.innerPack    ?? 1;
        const sus = p.sellUnitSize ?? p.unitsPerPack ?? 1;
        const su  = p.sellUnit || (sus > 1 ? 'pack' : 'each');
        setForm({
          name:               p.name              ?? '',
          brand:              p.brand             ?? '',
          upc:                p.upc               ?? '',
          description:        p.description       ?? '',
          departmentId:       p.departmentId      ?? '',
          vendorId:           p.vendorId          ?? '',
          taxClass:           p.taxClass          ?? 'grocery',
          taxable:            p.taxable           ?? true,
          sellUnit:           su,
          casePacks:          cp,
          sellUnitSize:       sus,
          defaultCasePrice:   p.defaultCasePrice  != null ? Number(p.defaultCasePrice).toFixed(2)  : '',
          defaultCostPrice:   p.defaultCostPrice  != null ? Number(p.defaultCostPrice).toFixed(2)  : '',
          defaultRetailPrice: p.defaultRetailPrice!= null ? Number(p.defaultRetailPrice).toFixed(2): '',
          containerType:      p.containerType     ?? '',
          containerVolumeOz:  p.containerVolumeOz ?? '',
          depositRuleId:      p.depositRuleId     ?? '',
          ebtEligible:        p.ebtEligible       ?? false,
          ageRequired:        p.ageRequired       ?? '',
          discountEligible:   p.discountEligible  ?? true,
          byWeight:           p.byWeight          ?? false,
          byUnit:             p.byUnit            ?? true,
          active:             p.active            ?? true,
          size:               p.size              ?? '',
          sizeUnit:           p.sizeUnit          ?? 'oz',
        });
        // Auto-enable deposit toggle if product already has deposit data
        if (p.containerVolumeOz || p.containerType || p.depositRuleId) {
          setDepositToggle(true);
        }

        // Load existing promotions for this product
        const promoData = promoRes?.data || [];
        if (Array.isArray(promoData) && promoData.length) {
          setDeals(promoData.map(pr => ({
            id:        pr.id,
            name:      pr.name || '',
            type:      pr.rebateType || 'percent_off',
            value:     pr.rebateAmount != null ? String(pr.rebateAmount) : '',
            minQty:    pr.minQtyPerMonth || 1,
            getQty:    1,
            startDate: pr.startDate ? pr.startDate.slice(0,10) : '',
            endDate:   pr.endDate   ? pr.endDate.slice(0,10)   : '',
            active:    pr.active ?? true,
          })));
        }
      } catch { toast.error('Failed to load product'); }
      finally { setLoading(false); }
    })();
  }, [id]);

  // ── Derived pack values ────────────────────────────────────────────────────
  const casePacks    = parseInt(form.casePacks)    || 1;
  const sellUnitSize = parseInt(form.sellUnitSize) || 1;
  const totalUnitsPerCase = casePacks * sellUnitSize;
  const sellUnitsPerCase  = casePacks;

  const sellUnitLabel =
    form.sellUnit === 'case' ? `${sellUnitSize}-pk case` :
    form.sellUnit === 'pack' ? `${sellUnitSize}-pk` :
    'each';

  // ── Pricing derived values ─────────────────────────────────────────────────
  const caseCost    = parseFloat(form.defaultCasePrice)  || null;
  const unitCost    = parseFloat(form.defaultCostPrice)  || null;
  const retailPrice = parseFloat(form.defaultRetailPrice)|| null;

  const handleCaseCostChange = (val) => {
    setF('defaultCasePrice', val);
    const cc = parseFloat(val);
    if (cc > 0 && sellUnitsPerCase > 0) {
      setF('defaultCostPrice', (cc / sellUnitsPerCase).toFixed(2));
    }
  };

  const applyMargin = (pct) => {
    const cost = unitCost;
    if (!cost) { toast.error('Enter cost price first'); return; }
    setF('defaultRetailPrice', (cost / (1 - pct / 100)).toFixed(2));
  };

  const margin = calcMargin(unitCost, retailPrice);
  const mColor = marginColor(margin);

  // ── Deposit auto-match ─────────────────────────────────────────────────────
  const volOz = parseFloat(form.containerVolumeOz) || null;
  const matchedDepositRule = volOz
    ? depositRules.find(r =>
        (!r.minVolumeOz || volOz >= r.minVolumeOz) &&
        (!r.maxVolumeOz || volOz <  r.maxVolumeOz)
      )
    : form.depositRuleId
      ? depositRules.find(r => r.id === parseInt(form.depositRuleId))
      : null;

  const depositPerUnit     = matchedDepositRule ? parseFloat(matchedDepositRule.depositAmount) : null;
  const depositPerSellUnit = depositPerUnit != null ? depositPerUnit * sellUnitSize  : null;
  const depositPerCase     = depositPerUnit != null ? depositPerUnit * totalUnitsPerCase : null;

  // ── Dept auto-fill ─────────────────────────────────────────────────────────
  const handleDeptChange = (deptId) => {
    setF('departmentId', deptId);
    const dept = departments.find(d => d.id === parseInt(deptId));
    if (dept) {
      if (dept.taxClass)   setF('taxClass',   dept.taxClass);
      if (dept.ebtEligible)setF('ebtEligible',true);
      if (dept.ageRequired)setF('ageRequired', String(dept.ageRequired));
    }
  };

  // ── Deal handlers ──────────────────────────────────────────────────────────
  const openDealForm = (idx) => {
    if (idx === null) {
      setDealForm({ ...DEAL_BLANK });
      setEditDealIdx(null);
    } else {
      setDealForm({ ...deals[idx] });
      setEditDealIdx(idx);
    }
  };

  const saveDealLocal = () => {
    if (!dealForm.value && dealForm.type !== 'bogo') {
      toast.error('Enter a deal value'); return;
    }
    if (editDealIdx !== null) {
      setDeals(ds => ds.map((d, i) => i === editDealIdx ? { ...dealForm } : d));
    } else {
      setDeals(ds => [...ds, { ...dealForm }]);
    }
    setDealForm(null);
    setEditDealIdx(null);
  };

  const removeDeal = (idx) => {
    setDeals(ds => ds.filter((_, i) => i !== idx));
  };

  // ── Validation ────────────────────────────────────────────────────────────
  const upcWarning = form.upc && !isValidUPC(form.upc)
    ? 'UPC should be 7–14 digits' : null;
  const priceWarning = unitCost && retailPrice && retailPrice < unitCost
    ? 'Retail price is below cost — negative margin' : null;

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Product name is required'); return; }
    if (upcWarning)         { toast.error(upcWarning); return; }
    setSaving(true);
    try {
      const payload = {
        name:               form.name,
        brand:              form.brand              || null,
        upc:                form.upc               || null,
        description:        form.description       || null,
        departmentId:       form.departmentId      ? parseInt(form.departmentId) : null,
        vendorId:           form.vendorId          ? parseInt(form.vendorId)     : null,
        taxClass:           form.taxClass,
        taxable:            form.taxable,
        sellUnit:           form.sellUnit,
        casePacks:          casePacks,
        sellUnitSize:       sellUnitSize,
        pack:               totalUnitsPerCase,
        innerPack:          casePacks,
        unitsPerPack:       sellUnitSize,
        defaultCasePrice:   form.defaultCasePrice  || null,
        defaultCostPrice:   form.defaultCostPrice  || null,
        defaultRetailPrice: form.defaultRetailPrice|| null,
        containerType:      form.containerType     || null,
        containerVolumeOz:  form.containerVolumeOz ? parseFloat(form.containerVolumeOz) : null,
        depositRuleId:      matchedDepositRule?.id  ?? (form.depositRuleId ? parseInt(form.depositRuleId) : null),
        ebtEligible:        form.ebtEligible,
        ageRequired:        form.ageRequired       ? parseInt(form.ageRequired) : null,
        discountEligible:   form.discountEligible,
        byWeight:           form.byWeight,
        byUnit:             form.byUnit,
        size:               form.size              || null,
        sizeUnit:           form.sizeUnit          || null,
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

      // Save deals (non-fatal)
      if (productId && deals.length > 0) {
        const newDeals = deals.filter(d => !d.id);
        await Promise.all(newDeals.map(d =>
          createCatalogPromotion({
            name:           d.name || `${DEAL_TYPES.find(t=>t.value===d.type)?.label} deal`,
            masterProductId: productId,
            rebateType:     d.type,
            rebateAmount:   parseFloat(d.value) || 0,
            minQtyPerMonth: d.minQty || null,
            startDate:      d.startDate || null,
            endDate:        d.endDate   || null,
            active:         d.active,
          }).catch(() => {})
        ));
      }

      navigate('/portal/catalog');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="layout-container">
        <Sidebar />
        <main className="main-content" style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span style={{ color:'var(--text-muted)' }}>Loading…</span>
        </main>
      </div>
    );
  }

  const selDept = departments.find(d => d.id === parseInt(form.departmentId));
  const needsDeposit = depositToggle || selDept?.bottleDeposit || form.containerVolumeOz || form.containerType;

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content" style={{ padding:0, display:'flex', flexDirection:'column', minHeight:'100vh' }}>
        <form onSubmit={handleSave} style={{ flex:1, display:'flex', flexDirection:'column' }}>

          {/* ── Top Bar ── */}
          <div style={{ padding:'0.875rem 1.75rem', borderBottom:'1px solid var(--border-color)',
            display:'flex', alignItems:'center', justifyContent:'space-between',
            background:'var(--bg-secondary)', flexShrink:0, position:'sticky', top:0, zIndex:10 }}>
            <button type="button" onClick={() => navigate('/portal/catalog')}
              style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none',
                cursor:'pointer', color:'var(--text-muted)', fontSize:'0.85rem', fontWeight:500 }}>
              <ChevronLeft size={16} /> Catalog
            </button>
            <h1 style={{ margin:0, fontSize:'1rem', fontWeight:700 }}>
              {isEdit ? 'Edit Product' : 'Add New Product'}
            </h1>
            <div style={{ display:'flex', gap:8 }}>
              <button type="button" onClick={() => navigate('/portal/catalog')} style={btnSecondary}>
                Cancel
              </button>
              <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity:saving?0.7:1 }}>
                <Save size={14} /> {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Product'}
              </button>
            </div>
          </div>

          {/* ── No-store banner ── */}
          {(!setup.loading && !setup.hasStores) && (
            <div style={{ padding:'0.75rem 1.75rem 0' }}>
              <NoStoreBanner onGoToStores={() => navigate('/portal/stores')} />
            </div>
          )}

          {/* ── Body ── */}
          <div style={{ flex:1, overflowY:'auto', padding:'1.5rem 1.75rem 2rem', display:'grid',
            gridTemplateColumns:'1fr 310px', gap:'1.25rem', alignItems:'start' }}>

            {/* ══ LEFT COLUMN ══════════════════════════════════════════════════ */}
            <div>

              {/* ── 1. Product Info ── */}
              <div style={card}>
                <div style={sectionTitle}>Product Info</div>

                {/* Row 1: Name (full width) */}
                <div style={{ marginBottom:'0.75rem' }}>
                  <label style={lbl}>Product Name *</label>
                  <input className="form-input" style={{ width:'100%', fontSize:'0.95rem', fontWeight:600 }}
                    value={form.name} onChange={e => setF('name', e.target.value)}
                    placeholder="e.g. Bud Light 12oz Can" required />
                  {form.name.trim().length > 0 && form.name.trim().length < 3 && (
                    <div style={{ fontSize:'0.7rem', color:'#ef4444', marginTop:3, display:'flex', alignItems:'center', gap:4 }}>
                      <AlertCircle size={10} /> Name should be at least 3 characters
                    </div>
                  )}
                </div>

                {/* Row 2: Brand + UPC */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginBottom:'0.75rem' }}>
                  <div>
                    <label style={lbl}>Brand</label>
                    <input className="form-input" style={{ width:'100%' }}
                      value={form.brand} onChange={e => setF('brand', e.target.value)}
                      placeholder="e.g. Anheuser-Busch" />
                  </div>
                  <div>
                    <label style={lbl}>UPC / Barcode</label>
                    <input className="form-input"
                      style={{ width:'100%', fontFamily:'monospace', borderColor: upcWarning ? '#ef4444' : undefined }}
                      value={form.upc} onChange={e => setF('upc', e.target.value.replace(/\D/g, ''))}
                      placeholder="012345678901" maxLength={14} />
                    {upcWarning && (
                      <div style={{ fontSize:'0.7rem', color:'#ef4444', marginTop:3, display:'flex', alignItems:'center', gap:4 }}>
                        <AlertCircle size={10} /> {upcWarning}
                      </div>
                    )}
                    {form.upc && isValidUPC(form.upc) && (
                      <div style={{ fontSize:'0.7rem', color:'#10b981', marginTop:3, display:'flex', alignItems:'center', gap:4 }}>
                        <Check size={10} /> {form.upc.length} digits
                      </div>
                    )}
                  </div>
                </div>

                {/* Row 3: Size + Description */}
                <div style={{ display:'grid', gridTemplateColumns:'180px 1fr', gap:'0.75rem' }}>
                  <div>
                    <label style={lbl}>Size</label>
                    <div style={{ display:'flex', gap:5 }}>
                      <input className="form-input" style={{ flex:1, minWidth:0 }}
                        type="number" min="0" step="0.01"
                        value={form.size} onChange={e => setF('size', e.target.value)} placeholder="12" />
                      <select className="form-input" style={{ width:68 }}
                        value={form.sizeUnit} onChange={e => setF('sizeUnit', e.target.value)}>
                        {SIZE_UNITS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label style={lbl}>Description</label>
                    <textarea className="form-input" style={{ width:'100%', minHeight:40, resize:'vertical', lineHeight:1.4 }}
                      value={form.description} onChange={e => setF('description', e.target.value)}
                      placeholder="Short description for shelf tags / eComm" />
                  </div>
                </div>
              </div>

              {/* ── 2. Pricing ── */}
              <div style={card}>
                <div style={sectionTitle}>Pricing</div>

                {/* Case cost → unit cost calculator */}
                <div style={{ background:'var(--bg-tertiary)', borderRadius:8, padding:'1rem', marginBottom:'1rem',
                  border:'1px solid var(--border-color)' }}>
                  <div style={{ fontSize:'0.68rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.06em', marginBottom:'0.75rem' }}>
                    CASE COST CALCULATOR
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 24px 1fr 24px 1fr', alignItems:'center', gap:'0.5rem' }}>
                    <div>
                      <label style={lbl}>Case Cost (invoice)</label>
                      <div style={{ position:'relative' }}>
                        <span style={dollarSign}>$</span>
                        <input className="form-input" style={{ width:'100%', paddingLeft:22 }}
                          type="number" step="0.01" min="0"
                          value={form.defaultCasePrice}
                          placeholder="0.00"
                          onChange={e => handleCaseCostChange(e.target.value)}
                          onBlur={e => e.target.value && setF('defaultCasePrice', parseFloat(e.target.value).toFixed(2))} />
                      </div>
                    </div>
                    <div style={{ textAlign:'center', color:'var(--text-muted)', fontSize:'1rem', paddingTop:18 }}>÷</div>
                    <div>
                      <label style={lbl}>{sellUnitsPerCase} {sellUnitLabel}{sellUnitsPerCase>1?'s':''} / case</label>
                      <input className="form-input" style={{ width:'100%', background:'var(--bg-secondary)',
                        textAlign:'center', fontWeight:700, color:'var(--accent-primary)' }}
                        value={sellUnitsPerCase} readOnly />
                    </div>
                    <div style={{ textAlign:'center', color:'var(--text-muted)', fontSize:'1rem', paddingTop:18 }}>=</div>
                    <div>
                      <label style={lbl}>Cost per {sellUnitLabel}</label>
                      <div style={{ position:'relative' }}>
                        <span style={dollarSign}>$</span>
                        <input className="form-input" style={{ width:'100%', paddingLeft:22 }}
                          type="number" step="0.01" min="0"
                          value={form.defaultCostPrice}
                          placeholder="0.00"
                          onChange={e => setF('defaultCostPrice', e.target.value)}
                          onBlur={e => e.target.value && setF('defaultCostPrice', parseFloat(e.target.value).toFixed(2))} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Retail + margin */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.875rem', marginBottom:'0.875rem' }}>
                  <div>
                    <label style={lbl}>Retail Price (per {sellUnitLabel})</label>
                    <div style={{ position:'relative' }}>
                      <span style={dollarSign}>$</span>
                      <input className="form-input"
                        style={{ width:'100%', paddingLeft:22, fontSize:'1.05rem', fontWeight:700,
                          borderColor: priceWarning ? '#ef4444' : undefined }}
                        type="number" step="0.01" min="0"
                        value={form.defaultRetailPrice}
                        placeholder="0.00"
                        onChange={e => setF('defaultRetailPrice', e.target.value)}
                        onBlur={e => e.target.value && setF('defaultRetailPrice', parseFloat(e.target.value).toFixed(2))} />
                    </div>
                    {priceWarning && (
                      <div style={{ fontSize:'0.7rem', color:'#ef4444', marginTop:3, display:'flex', alignItems:'center', gap:4 }}>
                        <AlertCircle size={10} /> {priceWarning}
                      </div>
                    )}
                  </div>
                  <div>
                    <label style={lbl}>Quick-set margin</label>
                    <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                      {MARGIN_PRESETS.map(m => (
                        <button key={m} type="button" onClick={() => applyMargin(m)}
                          style={{ padding:'0.3rem 0.6rem', borderRadius:5, fontSize:'0.78rem', fontWeight:600, cursor:'pointer',
                            border: Math.abs((margin||0)-m) < 0.5 ? 'none' : '1px solid var(--border-color)',
                            background: Math.abs((margin||0)-m) < 0.5 ? mColor : 'var(--bg-tertiary)',
                            color: Math.abs((margin||0)-m) < 0.5 ? '#fff' : 'var(--text-secondary)' }}>
                          {m}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Margin summary bar */}
                {unitCost && retailPrice ? (
                  <div style={{ display:'flex', gap:'1.5rem', padding:'0.75rem 1rem',
                    background:'var(--bg-tertiary)', borderRadius:8, flexWrap:'wrap', alignItems:'center' }}>
                    {[
                      ['Cost / unit',   fmt$(unitCost)],
                      ['Retail / unit', fmt$(retailPrice)],
                      ['Margin',        margin != null ? fmtPct(margin) : '—'],
                      ['Markup',        unitCost && retailPrice ? fmtPct((retailPrice-unitCost)/unitCost*100) : '—'],
                      ...(caseCost ? [['Case cost', fmt$(caseCost)]] : []),
                      ...(caseCost ? [['Case retail', fmt$(retailPrice * sellUnitsPerCase)]] : []),
                    ].map(([label, val]) => (
                      <div key={label} style={{ textAlign:'center' }}>
                        <div style={{ fontSize:'0.62rem', color:'var(--text-muted)', fontWeight:600, textTransform:'uppercase' }}>{label}</div>
                        <div style={{ fontSize:'0.95rem', fontWeight:700,
                          color: label==='Margin' ? mColor : 'var(--text-primary)' }}>{val}</div>
                      </div>
                    ))}
                    {margin !== null && (
                      <div style={{ marginLeft:'auto', display:'flex', alignItems:'center' }}>
                        <span style={{ fontSize:'1.1rem', fontWeight:800, padding:'4px 12px', borderRadius:6,
                          background: mColor+'20', color: mColor }}>
                          {fmtPct(margin)} margin
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ padding:'0.75rem 1rem', background:'var(--bg-tertiary)', borderRadius:8,
                    color:'var(--text-muted)', fontSize:'0.8rem', display:'flex', alignItems:'center', gap:6 }}>
                    <Info size={14} /> Enter case cost and retail price to see margin analysis
                  </div>
                )}
              </div>

              {/* ── 3. Pack Configuration ── */}
              <div style={card}>
                <div style={sectionTitle}>Pack Configuration</div>

                {/* Sell Unit Type */}
                <div style={{ marginBottom:'1rem' }}>
                  <label style={lbl}>What do you sell at the register?</label>
                  <div style={{ display:'flex', gap:8 }}>
                    {SELL_UNIT_TYPES.map(t => (
                      <button key={t.value} type="button" onClick={() => {
                          setF('sellUnit', t.value);
                          if (t.value === 'case') setF('casePacks', 1);
                          if (t.value === 'each') setF('sellUnitSize', 1);
                        }}
                        style={{ flex:1, padding:'0.65rem', borderRadius:8, cursor:'pointer', textAlign:'left',
                          border: form.sellUnit===t.value ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)',
                          background: form.sellUnit===t.value ? 'var(--accent-primary)0d' : 'var(--bg-tertiary)' }}>
                        <div style={{ fontSize:'0.82rem', fontWeight:700,
                          color: form.sellUnit===t.value ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                          {t.label}
                        </div>
                        <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:2 }}>{t.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Pack size (pack/case only) */}
                {(form.sellUnit === 'pack' || form.sellUnit === 'case') && (
                  <div style={{ marginBottom:'1rem' }}>
                    <label style={lbl}>
                      {form.sellUnit === 'pack' ? 'Units per pack (cans/bottles per pack sold)' : 'Units in the case you sell'}
                    </label>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                      {[4,6,8,12,18,24].map(n => (
                        <button key={n} type="button" onClick={() => setF('sellUnitSize', n)}
                          style={{ padding:'0.3rem 0.75rem', borderRadius:6, fontSize:'0.82rem', fontWeight:600, cursor:'pointer',
                            border: sellUnitSize===n ? 'none' : '1px solid var(--border-color)',
                            background: sellUnitSize===n ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                            color: sellUnitSize===n ? '#fff' : 'var(--text-secondary)' }}>
                          {n}
                        </button>
                      ))}
                      <input className="form-input" type="number" min="1"
                        style={{ width:75 }} placeholder="Custom"
                        value={![4,6,8,12,18,24].includes(sellUnitSize) ? sellUnitSize : ''}
                        onChange={e => setF('sellUnitSize', parseInt(e.target.value)||1)} />
                    </div>
                  </div>
                )}

                {/* Qty per case */}
                {form.sellUnit !== 'case' && (
                  <div style={{ marginBottom:'1rem' }}>
                    <label style={lbl}>
                      How many {sellUnitLabel}s come in a vendor case?
                    </label>
                    <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                      {[2,4,6,12,15,24].map(n => (
                        <button key={n} type="button" onClick={() => setF('casePacks', n)}
                          style={{ padding:'0.3rem 0.75rem', borderRadius:6, fontSize:'0.82rem', fontWeight:600, cursor:'pointer',
                            border: casePacks===n ? 'none' : '1px solid var(--border-color)',
                            background: casePacks===n ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                            color: casePacks===n ? '#fff' : 'var(--text-secondary)' }}>
                          {n}
                        </button>
                      ))}
                      <input className="form-input" type="number" min="1"
                        style={{ width:75 }} placeholder="Custom"
                        value={![2,4,6,12,15,24].includes(casePacks) ? casePacks : ''}
                        onChange={e => setF('casePacks', parseInt(e.target.value)||1)} />
                    </div>
                  </div>
                )}

                {/* Quick presets */}
                <div style={{ marginBottom:'1rem' }}>
                  <label style={lbl}>Quick presets</label>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    {PACK_PRESETS.map(p => {
                      const isActive = form.sellUnit===p.sellUnit && casePacks===p.casePacks && sellUnitSize===p.sellUnitSize;
                      return (
                        <button key={p.id} type="button"
                          onClick={() => {
                            setF('sellUnit', p.sellUnit);
                            setF('casePacks', p.casePacks);
                            setF('sellUnitSize', p.sellUnitSize);
                          }}
                          title={p.desc}
                          style={{ padding:'0.3rem 0.7rem', borderRadius:6, fontSize:'0.75rem', fontWeight:600, cursor:'pointer',
                            border: isActive ? 'none' : '1px solid var(--border-color)',
                            background: isActive ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                            color: isActive ? '#fff' : 'var(--text-secondary)' }}>
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Case summary pill */}
                <div style={{ display:'flex', alignItems:'center', gap:10, padding:'0.65rem 0.875rem',
                  background:'var(--accent-primary)0d', borderRadius:8, border:'1px solid var(--accent-primary)30' }}>
                  <Package size={15} color="var(--accent-primary)" />
                  <div>
                    <span style={{ fontSize:'0.85rem', fontWeight:700, color:'var(--accent-primary)' }}>
                      {form.sellUnit === 'each'
                        ? `${casePacks} individual units per case`
                        : form.sellUnit === 'pack'
                        ? `${casePacks} × ${sellUnitSize}-pack per case = ${totalUnitsPerCase} units total`
                        : `${sellUnitSize}-unit case sold as one item`}
                    </span>
                    <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:1 }}>
                      You sell <strong>{sellUnitLabel}</strong> at the register
                      {' · '}Case contains {totalUnitsPerCase} unit{totalUnitsPerCase>1?'s':''}
                    </div>
                  </div>
                </div>

                {/* Animated Pack Visualization */}
                <PackVisual
                  sellUnit={form.sellUnit}
                  sellUnitSize={sellUnitSize}
                  casePacks={casePacks}
                  depositPerUnit={depositPerUnit}
                />
              </div>

              {/* ── 4. Store Deals & Offers ── */}
              <div style={card}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.875rem' }}>
                  <div style={sectionTitle}>Store Deals &amp; Offers</div>
                  <button type="button" onClick={() => { setDealForm({ ...DEAL_BLANK }); setEditDealIdx(null); }}
                    style={{ ...btnSecondary, padding:'0.3rem 0.7rem', fontSize:'0.75rem', gap:4 }}>
                    <Plus size={11} /> Add Deal
                  </button>
                </div>

                {deals.length === 0 && !dealForm ? (
                  <div style={{ padding:'1.25rem', textAlign:'center', border:'1px dashed var(--border-color)',
                    borderRadius:8, color:'var(--text-muted)', fontSize:'0.8rem', lineHeight:1.6 }}>
                    <Zap size={18} style={{ opacity:0.35, marginBottom:6, display:'block', margin:'0 auto 8px' }} />
                    No deals configured. Add a BOGO, % off, multi-buy, or sale price offer.
                  </div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom: dealForm ? '0.875rem' : 0 }}>
                    {deals.map((deal, idx) => {
                      const dt = DEAL_TYPES.find(t => t.value === deal.type) || DEAL_TYPES[0];
                      const Icon = dt.icon;
                      return (
                        <div key={idx} style={{
                          display:'flex', alignItems:'center', gap:10, padding:'0.625rem 0.875rem',
                          borderRadius:8, background:'var(--bg-tertiary)', border:'1px solid var(--border-color)',
                        }}>
                          <div style={{ width:30, height:30, borderRadius:7, flexShrink:0,
                            background: dt.color+'18', border:`1px solid ${dt.color}33`,
                            display:'flex', alignItems:'center', justifyContent:'center' }}>
                            <Icon size={13} color={dt.color} />
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <span style={{ fontSize:'0.72rem', fontWeight:800, padding:'1px 6px', borderRadius:3,
                                background: dt.color+'22', color: dt.color }}>
                                {dt.label}
                              </span>
                              {deal.name && <span style={{ fontSize:'0.8rem', fontWeight:600, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{deal.name}</span>}
                            </div>
                            <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:2 }}>
                              {deal.type === 'percent_off'  && `${deal.value}% off`}
                              {deal.type === 'amount_off'   && `$${deal.value} off`}
                              {deal.type === 'fixed_price'  && `Sale: $${deal.value}`}
                              {deal.type === 'multi_buy'    && `${deal.minQty} for $${deal.value}`}
                              {deal.type === 'bogo'         && `Buy ${deal.minQty} get ${deal.getQty} free`}
                              {deal.startDate && ` · from ${deal.startDate}`}
                              {deal.endDate   && ` to ${deal.endDate}`}
                            </div>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                            <span style={{ fontSize:'0.65rem', fontWeight:700, padding:'2px 6px', borderRadius:3,
                              background: deal.active ? 'rgba(16,185,129,.1)' : 'rgba(100,116,139,.1)',
                              color: deal.active ? '#10b981' : '#64748b' }}>
                              {deal.active ? 'Active' : 'Off'}
                            </span>
                            <button type="button" onClick={() => openDealForm(idx)}
                              style={{ padding:5, borderRadius:5, border:'none', background:'rgba(255,255,255,.04)',
                                cursor:'pointer', color:'var(--text-muted)', display:'flex' }}
                              onMouseEnter={e=>{e.currentTarget.style.background='rgba(122,193,67,.12)';e.currentTarget.style.color='#7ac143';}}
                              onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,.04)';e.currentTarget.style.color='var(--text-muted)';}}>
                              <Edit2 size={12} />
                            </button>
                            <button type="button" onClick={() => removeDeal(idx)}
                              style={{ padding:5, borderRadius:5, border:'none', background:'rgba(255,255,255,.04)',
                                cursor:'pointer', color:'var(--text-muted)', display:'flex' }}
                              onMouseEnter={e=>{e.currentTarget.style.background='rgba(224,63,63,.12)';e.currentTarget.style.color='#ef4444';}}
                              onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,.04)';e.currentTarget.style.color='var(--text-muted)';}}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Inline deal form */}
                {dealForm !== null && (
                  <div style={{ padding:'1rem', borderRadius:8, background:'var(--bg-tertiary)', border:'1px solid var(--border-color)', marginTop: deals.length ? 0 : 0 }}>
                    <div style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.06em', marginBottom:'0.75rem' }}>
                      {editDealIdx !== null ? 'EDIT DEAL' : 'NEW DEAL'}
                    </div>

                    {/* Deal type selector */}
                    <div style={{ marginBottom:'0.75rem' }}>
                      <label style={lbl}>Deal Type</label>
                      <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                        {DEAL_TYPES.map(dt => {
                          const Icon = dt.icon;
                          const active = dealForm.type === dt.value;
                          return (
                            <button key={dt.value} type="button"
                              onClick={() => setDealForm(f => ({ ...f, type: dt.value }))}
                              title={dt.desc}
                              style={{ display:'flex', alignItems:'center', gap:5, padding:'0.3rem 0.65rem',
                                borderRadius:6, fontSize:'0.75rem', fontWeight:700, cursor:'pointer',
                                border: active ? 'none' : '1px solid var(--border-color)',
                                background: active ? dt.color : 'var(--bg-secondary)',
                                color: active ? '#fff' : 'var(--text-secondary)',
                                transition:'all .12s',
                              }}>
                              <Icon size={11} /> {dt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.7rem', marginBottom:'0.75rem' }}>
                      {/* Deal name */}
                      <div style={{ gridColumn:'span 2' }}>
                        <label style={lbl}>Deal Label (shelf tag)</label>
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

                      {/* Value */}
                      {dealForm.type !== 'bogo' && (
                        <div>
                          <label style={lbl}>
                            {dealForm.type === 'percent_off' ? 'Discount %' :
                             dealForm.type === 'amount_off'  ? 'Discount $' :
                             dealForm.type === 'multi_buy'   ? `Price for ${dealForm.minQty || 'N'} units` :
                             'Sale Price $'}
                          </label>
                          <div style={{ position:'relative' }}>
                            {dealForm.type !== 'percent_off' && <span style={dollarSign}>$</span>}
                            <input className="form-input"
                              style={{ width:'100%', paddingLeft: dealForm.type !== 'percent_off' ? 22 : undefined }}
                              type="number" step="0.01" min="0"
                              value={dealForm.value}
                              onChange={e => setDealForm(f => ({ ...f, value: e.target.value }))}
                              placeholder="0.00" />
                            {dealForm.type === 'percent_off' && (
                              <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
                                color:'var(--text-muted)', fontSize:'0.85rem', pointerEvents:'none' }}>%</span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Min qty / buy qty */}
                      <div>
                        <label style={lbl}>
                          {dealForm.type === 'multi_buy' ? 'Buy qty (e.g. 2)' :
                           dealForm.type === 'bogo'      ? 'Buy qty' : 'Min qty'}
                        </label>
                        <input className="form-input" style={{ width:'100%' }}
                          type="number" min="1"
                          value={dealForm.minQty}
                          onChange={e => setDealForm(f => ({ ...f, minQty: parseInt(e.target.value)||1 }))} />
                      </div>

                      {/* Get qty (BOGO) */}
                      {dealForm.type === 'bogo' && (
                        <div>
                          <label style={lbl}>Get qty (free)</label>
                          <input className="form-input" style={{ width:'100%' }}
                            type="number" min="1"
                            value={dealForm.getQty}
                            onChange={e => setDealForm(f => ({ ...f, getQty: parseInt(e.target.value)||1 }))} />
                        </div>
                      )}

                      {/* Dates */}
                      <div>
                        <label style={lbl}>Start Date</label>
                        <input className="form-input" style={{ width:'100%' }}
                          type="date"
                          value={dealForm.startDate}
                          onChange={e => setDealForm(f => ({ ...f, startDate: e.target.value }))} />
                      </div>
                      <div>
                        <label style={lbl}>End Date</label>
                        <input className="form-input" style={{ width:'100%' }}
                          type="date"
                          value={dealForm.endDate}
                          onChange={e => setDealForm(f => ({ ...f, endDate: e.target.value }))} />
                      </div>
                    </div>

                    {/* Active */}
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:'0.875rem' }}>
                      <Tog value={dealForm.active} onChange={v => setDealForm(f => ({ ...f, active: v }))} />
                      <span style={{ fontSize:'0.8rem', color:'var(--text-secondary)' }}>Deal is active</span>
                    </div>

                    <div style={{ display:'flex', gap:8 }}>
                      <button type="button" onClick={saveDealLocal} style={{ ...btnPrimary, padding:'0.45rem 1rem' }}>
                        <Check size={13} /> {editDealIdx !== null ? 'Update Deal' : 'Add Deal'}
                      </button>
                      <button type="button" onClick={() => { setDealForm(null); setEditDealIdx(null); }}
                        style={{ ...btnSecondary, padding:'0.45rem 0.875rem' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── 5. Container & Bottle Deposit ── */}
              <div style={card}>
                {/* Section header with ON/OFF toggle */}
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: needsDeposit ? '0.875rem' : 0 }}>
                  <div style={sectionTitle}>Container &amp; Bottle Deposit</div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !depositToggle;
                      setDepositToggle(next);
                      // Clear deposit fields when toggling off (unless dept forces it)
                      if (!next && !selDept?.bottleDeposit) {
                        setF('containerType', '');
                        setF('containerVolumeOz', '');
                        setF('depositRuleId', '');
                      }
                    }}
                    style={{
                      display:'flex', alignItems:'center', gap:6,
                      padding:'0.3rem 0.875rem', borderRadius:20, border:'none',
                      cursor:'pointer', fontSize:'0.75rem', fontWeight:700,
                      background: needsDeposit ? '#06b6d415' : 'var(--bg-tertiary)',
                      color: needsDeposit ? '#06b6d4' : 'var(--text-muted)',
                      transition:'all 0.15s',
                    }}
                  >
                    <span style={{ fontSize:'0.85rem' }}>{needsDeposit ? '💧' : '○'}</span>
                    {needsDeposit ? 'Deposit ON' : 'No deposit'}
                  </button>
                </div>

                {needsDeposit ? (
                  <>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.875rem', marginBottom:'0.875rem' }}>
                      <div>
                        <label style={lbl}>Container Type</label>
                        <select className="form-input" style={{ width:'100%' }}
                          value={form.containerType}
                          onChange={e => setF('containerType', e.target.value)}>
                          <option value="">— Select —</option>
                          {CONTAINER_TYPES.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={lbl}>Container Size (oz)</label>
                        <div style={{ display:'flex', gap:5 }}>
                          {[12, 16, 22, 24, 32, 40].map(n => (
                            <button key={n} type="button"
                              onClick={() => setF('containerVolumeOz', String(n))}
                              style={{ flex:1, padding:'0.35rem 0', borderRadius:5, fontSize:'0.75rem', fontWeight:700, cursor:'pointer',
                                border: parseFloat(form.containerVolumeOz)===n?'none':'1px solid var(--border-color)',
                                background: parseFloat(form.containerVolumeOz)===n?'var(--accent-primary)':'var(--bg-tertiary)',
                                color: parseFloat(form.containerVolumeOz)===n?'#fff':'var(--text-secondary)' }}>
                              {n}
                            </button>
                          ))}
                        </div>
                        <input className="form-input" style={{ width:'100%', marginTop:5 }}
                          type="number" step="0.5" min="0"
                          value={form.containerVolumeOz} placeholder="Custom oz"
                          onChange={e => setF('containerVolumeOz', e.target.value)} />
                      </div>
                      <div>
                        <label style={lbl}>Deposit Rule</label>
                        <select className="form-input" style={{ width:'100%' }}
                          value={form.depositRuleId}
                          onChange={e => setF('depositRuleId', e.target.value)}>
                          <option value="">Auto-match by volume</option>
                          {depositRules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      </div>
                    </div>
                    {depositPerUnit != null ? (
                      <div style={{ display:'flex', gap:'1rem', padding:'0.75rem 1rem',
                        background:'#06b6d415', borderRadius:8, border:'1px solid #06b6d430', flexWrap:'wrap' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <Check size={14} color="#06b6d4" />
                          <span style={{ fontSize:'0.78rem', fontWeight:600, color:'#06b6d4' }}>
                            {matchedDepositRule.name}
                          </span>
                        </div>
                        {[
                          [`Per unit`,            fmt$(depositPerUnit)],
                          [`Per ${sellUnitLabel}`, fmt$(depositPerSellUnit)],
                          [`Per case (${totalUnitsPerCase} units)`, fmt$(depositPerCase)],
                        ].map(([label, val]) => (
                          <div key={label} style={{ textAlign:'center' }}>
                            <div style={{ fontSize:'0.62rem', color:'#06b6d4', fontWeight:600, textTransform:'uppercase' }}>{label}</div>
                            <div style={{ fontSize:'0.9rem', fontWeight:700, color:'var(--text-primary)' }}>{val}</div>
                          </div>
                        ))}
                      </div>
                    ) : volOz ? (
                      <div style={{ padding:'0.6rem 0.875rem', background:'var(--bg-tertiary)', borderRadius:6,
                        color:'var(--text-muted)', fontSize:'0.78rem' }}>
                        No deposit rule matched for {volOz}oz — check deposit rules or select manually.
                      </div>
                    ) : (
                      <div style={{ padding:'0.6rem 0.875rem', background:'var(--bg-tertiary)', borderRadius:6,
                        color:'var(--text-muted)', fontSize:'0.78rem' }}>
                        Select container type and enter size (oz) to auto-match a deposit rule.
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', lineHeight:1.5 }}>
                    Toggle <strong>Deposit ON</strong> if this product requires a bottle deposit (CRV, Maine 5¢, etc.).
                    The deposit amount will appear in the pack visual above and be applied at checkout.
                  </div>
                )}
              </div>

            </div>{/* end left column */}

            {/* ══ RIGHT SIDEBAR ═══════════════════════════════════════════════ */}
            <div style={{ position:'sticky', top:72, display:'flex', flexDirection:'column', gap:0 }}>

              {/* Classification */}
              <div style={card}>
                <div style={sectionTitle}>Classification</div>
                <div style={{ marginBottom:'0.875rem' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.3rem' }}>
                    <label style={{ ...lbl, marginBottom:0 }}>Department</label>
                    <button type="button" onClick={() => setShowDeptMgr(true)}
                      style={{ fontSize:'0.68rem', color:'var(--accent-primary)', background:'none', border:'none',
                        cursor:'pointer', display:'flex', alignItems:'center', gap:3 }}>
                      <Settings size={10} /> Manage
                    </button>
                  </div>
                  <select className="form-input" style={{ width:'100%' }}
                    value={form.departmentId}
                    onChange={e => handleDeptChange(e.target.value)}>
                    <option value="">— No department —</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  {selDept && (
                    <div style={{ marginTop:5, display:'inline-flex', alignItems:'center', gap:5,
                      padding:'2px 8px', borderRadius:4,
                      background:(selDept.color||'#6366f1')+'20', color:selDept.color||'#6366f1' }}>
                      <div style={{ width:7, height:7, borderRadius:'50%', background:selDept.color||'#6366f1' }} />
                      <span style={{ fontSize:'0.72rem', fontWeight:600 }}>{selDept.name}</span>
                    </div>
                  )}
                </div>

                <div style={{ marginBottom:'0.875rem' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.3rem' }}>
                    <label style={{ ...lbl, marginBottom:0 }}>Vendor / Supplier</label>
                    <button type="button" onClick={() => setShowVendMgr(true)}
                      style={{ fontSize:'0.68rem', color:'var(--accent-primary)', background:'none', border:'none',
                        cursor:'pointer', display:'flex', alignItems:'center', gap:3 }}>
                      <Settings size={10} /> Manage
                    </button>
                  </div>
                  <select className="form-input" style={{ width:'100%' }}
                    value={form.vendorId}
                    onChange={e => setF('vendorId', e.target.value)}>
                    <option value="">— No vendor —</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>

                <div>
                  <label style={lbl}>Tax Class</label>
                  <select className="form-input" style={{ width:'100%' }}
                    value={form.taxClass}
                    onChange={e => setF('taxClass', e.target.value)}>
                    {TAX_CLASSES.map(t => (
                      <option key={t.value} value={t.value}>{t.label} — {t.note}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Compliance */}
              <div style={card}>
                <div style={sectionTitle}>Compliance</div>

                <div style={{ marginBottom:'0.875rem' }}>
                  <label style={lbl}>Age Verification</label>
                  <div style={{ display:'flex', gap:6 }}>
                    {[['None',''],['18+','18'],['21+','21']].map(([label,val])=>(
                      <button key={val} type="button" onClick={() => setF('ageRequired', val)}
                        style={{ flex:1, padding:'0.35rem', borderRadius:5, fontSize:'0.8rem', fontWeight:700, cursor:'pointer',
                          border: String(form.ageRequired)===val?'none':'1px solid var(--border-color)',
                          background: String(form.ageRequired)===val?'var(--accent-primary)':'var(--bg-tertiary)',
                          color: String(form.ageRequired)===val?'#fff':'var(--text-secondary)' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {[
                  ['EBT / SNAP Eligible', 'ebtEligible'],
                  ['Discount Eligible',    'discountEligible'],
                  ['Sold by Weight',       'byWeight'],
                ].map(([label, key]) => (
                  <div key={key} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                    marginBottom:'0.65rem' }}>
                    <span style={{ fontSize:'0.8rem', color:'var(--text-secondary)', fontWeight:500 }}>{label}</span>
                    <Tog value={!!form[key]} onChange={v => setF(key, v)} />
                  </div>
                ))}
              </div>

              {/* Status */}
              <div style={card}>
                <div style={sectionTitle}>Status</div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:'0.85rem', fontWeight:600,
                    color: form.active ? '#10b981' : 'var(--text-muted)' }}>
                    {form.active ? 'Active — visible in catalog' : 'Inactive — hidden from POS'}
                  </span>
                  <Tog value={form.active} onChange={v => setF('active', v)} />
                </div>
              </div>

              {/* Store Availability */}
              <div style={card}>
                <div style={sectionTitle}>Store Availability</div>
                {setup.loading ? (
                  <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>Checking stores…</div>
                ) : setup.storeCount === 0 ? (
                  <div style={{ fontSize:'0.78rem', color:'var(--text-secondary)', lineHeight:1.5 }}>
                    <span style={{ display:'block', fontWeight:600, color:'#f59e0b', marginBottom:4 }}>No stores yet</span>
                    Product saved in catalog. Once you add a store, it will be available there automatically.
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
                        <div key={store.id || store._id}
                          style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 8px',
                            borderRadius:5, background:'#10b98115', border:'1px solid #10b98130' }}>
                          <Check size={11} color="#10b981" />
                          <span style={{ fontSize:'0.75rem', fontWeight:500, color:'var(--text-primary)' }}>
                            {store.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Active deals summary */}
              {deals.filter(d => d.active).length > 0 && (
                <div style={{ ...card, background:'rgba(16,185,129,.04)', borderColor:'rgba(16,185,129,.2)' }}>
                  <div style={sectionTitle}>Active Deals</div>
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
              <button type="submit" disabled={saving}
                style={{ ...btnPrimary, width:'100%', justifyContent:'center', opacity:saving?0.7:1 }}>
                <Save size={14} /> {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Product'}
              </button>
            </div>

          </div>{/* end body grid */}
        </form>
      </main>

      {showDeptMgr && (
        <DeptManager departments={departments} onClose={() => setShowDeptMgr(false)}
          onRefresh={loadSupport} />
      )}
      {showVendMgr && (
        <VendorManager vendors={vendors} onClose={() => setShowVendMgr(false)}
          onRefresh={loadSupport} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Micro helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmtPct = (v) => v == null ? '—' : Number(v).toFixed(1) + '%';

const dollarSign = {
  position:'absolute', left:8, top:'50%', transform:'translateY(-50%)',
  color:'var(--text-muted)', fontSize:'0.9rem', pointerEvents:'none',
};
