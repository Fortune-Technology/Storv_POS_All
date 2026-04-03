/**
 * ProductForm — Full-page add / edit form for a master product.
 *
 * Three-tier pack model:
 *   sellUnit    — what rings up at register: "each" | "pack" | "case"
 *   casePacks   — how many sell units come in a vendor case (e.g. 4 for "4 of 6pk")
 *   sellUnitSize— individual units inside one sell unit (1 for single, 6 for 6pk, 18 for whole 18pk)
 *
 * Deposit shown at three levels: per unit / per sell unit / per full case.
 * All prices: 2-decimal, $ prefix.
 * PLU and Internal SKU hidden by default (store-settings opt-in).
 */

import React, { useState, useEffect, useCallback } from 'react';
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
} from '../services/api';
import { toast } from 'react-toastify';
import {
  ChevronLeft, Save, Package, Building2, Truck, X, Plus,
  Trash2, Settings, DollarSign, Info, Check,
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

// sellUnit presets — every row matches the user's exact scenarios
const PACK_PRESETS = [
  { id: 'single',     label: 'Single item',    desc: '1 unit',         sellUnit: 'each', casePacks: 1,  sellUnitSize: 1  },
  { id: 'cs12',       label: 'Case of 12',     desc: '12 singles',     sellUnit: 'each', casePacks: 12, sellUnitSize: 1  },
  { id: 'cs15',       label: 'Case of 15',     desc: '15 singles',     sellUnit: 'each', casePacks: 15, sellUnitSize: 1  },
  { id: 'cs24',       label: 'Case of 24',     desc: '24 singles',     sellUnit: 'each', casePacks: 24, sellUnitSize: 1  },
  { id: '6x4pk',      label: '6 × 4pk',        desc: '24 units total', sellUnit: 'pack', casePacks: 6,  sellUnitSize: 4  },
  { id: '4x6pk',      label: '4 × 6pk',        desc: '24 units total', sellUnit: 'pack', casePacks: 4,  sellUnitSize: 6  },
  { id: '2x12pk',     label: '2 × 12pk',       desc: '24 units total', sellUnit: 'pack', casePacks: 2,  sellUnitSize: 12 },
  { id: '18pk_whole', label: '18pk (whole)',   desc: 'Sell as 18pk',   sellUnit: 'case', casePacks: 1,  sellUnitSize: 18 },
  { id: '24pk_whole', label: '24pk (whole)',   desc: 'Sell as 24pk',   sellUnit: 'case', casePacks: 1,  sellUnitSize: 24 },
];

const SELL_UNIT_TYPES = [
  { value: 'each', label: 'Single / Each', desc: 'Sell one can, bottle, or item at a time' },
  { value: 'pack', label: 'Multi-pack',    desc: 'Sell a bundle (6pk, 12pk, etc.) as one unit' },
  { value: 'case', label: 'Whole Case',    desc: 'Sell the entire case as one transaction' },
];

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
          {/* List */}
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
          {/* Edit form */}
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
  // null = "all stores" (default), or Set of storeIds
  const [selectedStores, setSelectedStores] = useState(null);
  const [showDeptMgr, setShowDeptMgr] = useState(false);
  const [showVendMgr, setShowVendMgr] = useState(false);

  const blank = {
    name:'', brand:'', upc:'', description:'',
    departmentId:'', vendorId:'',
    taxClass:'grocery', taxable:true,
    // Pack
    sellUnit:'each',    // 'each' | 'pack' | 'case'
    casePacks:1,        // sell units per case from vendor
    sellUnitSize:1,     // units per sell unit
    // Pricing (2 decimal)
    defaultCasePrice:'', defaultCostPrice:'', defaultRetailPrice:'',
    // Container / deposit
    containerType:'', containerVolumeOz:'', depositRuleId:'',
    // Compliance
    ebtEligible:false, ageRequired:'', discountEligible:true, byWeight:false, byUnit:true,
    // Status
    active:true,
    // Size
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

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const res = await getCatalogProduct(id);
        const p = res?.data || res;
        // Map stored fields → form state
        // Support both old (innerPack/unitsPerPack) and new (casePacks/sellUnitSize) fields
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
      } catch { toast.error('Failed to load product'); }
      finally { setLoading(false); }
    })();
  }, [id]);

  // ── Derived pack values ────────────────────────────────────────────────────
  const casePacks    = parseInt(form.casePacks)    || 1;
  const sellUnitSize = parseInt(form.sellUnitSize) || 1;
  const totalUnitsPerCase = casePacks * sellUnitSize;
  const sellUnitsPerCase  = casePacks; // how many sell units come from 1 case

  // Label for what the customer buys
  const sellUnitLabel =
    form.sellUnit === 'case' ? `${sellUnitSize}-pk case` :
    form.sellUnit === 'pack' ? `${sellUnitSize}-pk` :
    'each';

  // ── Pricing derived values ─────────────────────────────────────────────────
  const caseCost   = parseFloat(form.defaultCasePrice)  || null;
  const unitCost   = parseFloat(form.defaultCostPrice)  || null;
  const retailPrice= parseFloat(form.defaultRetailPrice)|| null;

  // When case cost changes → auto-fill unit cost
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

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Product name is required'); return; }
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
        // Pack — store all three
        sellUnit:           form.sellUnit,
        casePacks:          casePacks,
        sellUnitSize:       sellUnitSize,
        pack:               totalUnitsPerCase,          // total units per case
        innerPack:          casePacks,                  // legacy alias
        unitsPerPack:       sellUnitSize,               // legacy alias
        // Pricing
        defaultCasePrice:   form.defaultCasePrice  || null,
        defaultCostPrice:   form.defaultCostPrice  || null,
        defaultRetailPrice: form.defaultRetailPrice|| null,
        // Container
        containerType:      form.containerType     || null,
        containerVolumeOz:  form.containerVolumeOz ? parseFloat(form.containerVolumeOz) : null,
        depositRuleId:      matchedDepositRule?.id  ?? (form.depositRuleId ? parseInt(form.depositRuleId) : null),
        // Compliance
        ebtEligible:        form.ebtEligible,
        ageRequired:        form.ageRequired       ? parseInt(form.ageRequired) : null,
        discountEligible:   form.discountEligible,
        byWeight:           form.byWeight,
        byUnit:             form.byUnit,
        // Misc
        size:               form.size              || null,
        sizeUnit:           form.sizeUnit          || null,
        active:             form.active,
      };

      if (isEdit) {
        await updateCatalogProduct(id, payload);
        toast.success('Product updated');
        navigate('/portal/catalog');
      } else {
        const result = await createCatalogProduct(payload);
        const newProductId = result?.data?.id ?? result?.id;

        // Auto-add to every store — no manual "activation" needed
        if (newProductId && setup.stores?.length > 0) {
          await Promise.all(
            setup.stores.map(store =>
              upsertStoreInventory({
                masterProductId: newProductId,
                storeId: store.id || store._id,
              }).catch(() => {}) // non-fatal; store-product can be set up later
            )
          );
          const storeWord = setup.stores.length === 1 ? 'your store' : `all ${setup.stores.length} stores`;
          toast.success(`Product added and available at ${storeWord}`);
        } else {
          toast.success('Product added to catalog');
        }
        navigate('/portal/catalog');
      }
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
  const needsDeposit = selDept?.bottleDeposit || form.containerVolumeOz || form.containerType;

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
          <div style={{ flex:1, overflowY:'auto', padding:'1.5rem 1.75rem', display:'grid',
            gridTemplateColumns:'1fr 320px', gap:'1.25rem', alignItems:'start' }}>

            {/* ══ LEFT COLUMN ══════════════════════════════════════════════════ */}
            <div>

              {/* ── 1. Product Info ── */}
              <div style={card}>
                <div style={sectionTitle}>Product Info</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.875rem' }}>
                  <div style={{ gridColumn:'span 2' }}>
                    <label style={lbl}>Product Name *</label>
                    <input className="form-input" style={{ width:'100%', fontSize:'0.95rem' }}
                      value={form.name} onChange={e => setF('name', e.target.value)}
                      placeholder="e.g. Bud Light 12oz Can" required />
                  </div>
                  <div>
                    <label style={lbl}>Brand</label>
                    <input className="form-input" style={{ width:'100%' }}
                      value={form.brand} onChange={e => setF('brand', e.target.value)}
                      placeholder="Anheuser-Busch" />
                  </div>
                  <div>
                    <label style={lbl}>UPC / Barcode</label>
                    <input className="form-input" style={{ width:'100%', fontFamily:'monospace' }}
                      value={form.upc} onChange={e => setF('upc', e.target.value)}
                      placeholder="012345678901" />
                  </div>
                  <div>
                    <label style={lbl}>Size</label>
                    <div style={{ display:'flex', gap:6 }}>
                      <input className="form-input" style={{ flex:1 }}
                        value={form.size} onChange={e => setF('size', e.target.value)} placeholder="12" />
                      <select className="form-input" style={{ width:75 }}
                        value={form.sizeUnit} onChange={e => setF('sizeUnit', e.target.value)}>
                        {SIZE_UNITS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ gridColumn:'span 2' }}>
                    <label style={lbl}>Description</label>
                    <textarea className="form-input" style={{ width:'100%', minHeight:56, resize:'vertical' }}
                      value={form.description} onChange={e => setF('description', e.target.value)}
                      placeholder="Short description for shelf tags / eComm" />
                  </div>
                </div>
              </div>

              {/* ── 2. Pack Configuration ── */}
              <div style={card}>
                <div style={sectionTitle}>Pack Configuration</div>

                {/* Sell Unit Type */}
                <div style={{ marginBottom:'1.1rem' }}>
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

                {/* Pack size (only for pack/case) */}
                {(form.sellUnit === 'pack' || form.sellUnit === 'case') && (
                  <div style={{ marginBottom:'1rem' }}>
                    <label style={lbl}>
                      {form.sellUnit === 'pack' ? 'Units per pack (how many cans/bottles in each pack you sell)' : 'Units in the case you sell'}
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
                      How many {sellUnitLabel}s come in a case from your vendor?
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
                      {' · '}Case contains {totalUnitsPerCase} individual unit{totalUnitsPerCase>1?'s':''}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── 3. Pricing ── */}
              <div style={card}>
                <div style={sectionTitle}>Pricing</div>

                {/* Case cost → unit cost */}
                <div style={{ background:'var(--bg-tertiary)', borderRadius:8, padding:'1rem', marginBottom:'1rem',
                  border:'1px solid var(--border-color)' }}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 28px 1fr 28px 1fr', alignItems:'center', gap:'0.5rem' }}>
                    <div>
                      <label style={lbl}>Case Cost (from invoice)</label>
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
                    <div style={{ textAlign:'center', color:'var(--text-muted)', fontSize:'1.1rem', marginTop:20 }}>÷</div>
                    <div>
                      <label style={lbl}>{sellUnitsPerCase} {sellUnitLabel}{sellUnitsPerCase>1?'s':''} per case</label>
                      <input className="form-input" style={{ width:'100%', background:'var(--bg-secondary)',
                        textAlign:'center', fontWeight:700, color:'var(--accent-primary)' }}
                        value={sellUnitsPerCase} readOnly />
                    </div>
                    <div style={{ textAlign:'center', color:'var(--text-muted)', fontSize:'1.1rem', marginTop:20 }}>=</div>
                    <div>
                      <label style={lbl}>Your cost per {sellUnitLabel}</label>
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
                      <input className="form-input" style={{ width:'100%', paddingLeft:22, fontSize:'1.05rem', fontWeight:700 }}
                        type="number" step="0.01" min="0"
                        value={form.defaultRetailPrice}
                        placeholder="0.00"
                        onChange={e => setF('defaultRetailPrice', e.target.value)}
                        onBlur={e => e.target.value && setF('defaultRetailPrice', parseFloat(e.target.value).toFixed(2))} />
                    </div>
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
                    background:'var(--bg-tertiary)', borderRadius:8, flexWrap:'wrap' }}>
                    {[
                      ['Cost / unit',   fmt$(unitCost)],
                      ['Retail / unit', fmt$(retailPrice)],
                      ['Margin',        margin != null ? fmtPct(margin) : '—'],
                      ['Markup',        unitCost && retailPrice
                        ? fmtPct((retailPrice-unitCost)/unitCost*100) : '—'],
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

              {/* ── 4. Container & Deposit ── */}
              {needsDeposit && (
                <div style={card}>
                  <div style={sectionTitle}>Container & Bottle Deposit</div>
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

                  {/* Deposit breakdown */}
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
                        [`Per unit`,           fmt$(depositPerUnit)],
                        [`Per ${sellUnitLabel}`,fmt$(depositPerSellUnit)],
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
                      No deposit rule matched for {volOz}oz — check your deposit rules or select manually.
                    </div>
                  ) : null}
                </div>
              )}

              {/* Show container section if not showing already */}
              {!needsDeposit && (
                <div style={card}>
                  <div style={sectionTitle}>Container & Bottle Deposit</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.875rem' }}>
                    <div>
                      <label style={lbl}>Container Type</label>
                      <select className="form-input" style={{ width:'100%' }}
                        value={form.containerType}
                        onChange={e => setF('containerType', e.target.value)}>
                        <option value="">None / N/A</option>
                        {CONTAINER_TYPES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lbl}>Volume (oz) — for deposit</label>
                      <input className="form-input" style={{ width:'100%' }}
                        type="number" step="0.5" min="0"
                        value={form.containerVolumeOz} placeholder="e.g. 12"
                        onChange={e => setF('containerVolumeOz', e.target.value)} />
                    </div>
                    <div style={{ display:'flex', alignItems:'flex-end', paddingBottom:2 }}>
                      <span style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>
                        Enter volume to auto-calculate bottle deposit (Maine CRV)
                      </span>
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* ══ RIGHT SIDEBAR ═══════════════════════════════════════════════ */}
            <div style={{ position:'sticky', top: 72 }}>

              {/* Department */}
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
                    This product will be saved in your catalog. Once you add a store, it will automatically become available there.
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

              {/* Save (duplicate in sidebar for long pages) */}
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
