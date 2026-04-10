/**
 * AdminPaymentSettings.jsx
 *
 * Superadmin payment management console — 4 tabs:
 *   Merchants   — CardPointe credentials per org
 *   Terminals   — Cross-org terminal health + CRUD
 *   Settings    — Per-store payment settings
 *   History     — Cross-org payment transaction history
 *
 * All API calls go through the admin-app's api.js service which attaches
 * the superadmin Bearer token automatically.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, Monitor, Settings2, History, RefreshCw, Loader,
  Wifi, WifiOff, Plus, Trash2, Edit3, Save, X, Eye, EyeOff,
  Search, ChevronLeft, ChevronRight, CheckCircle, XCircle,
} from 'lucide-react';
import { toast } from 'react-toastify';
import AdminSidebar from '../components/AdminSidebar';
import {
  getAdminOrganizations,
  getAdminStores,
  getAdminPaymentMerchant,
  saveAdminPaymentMerchant,
  getAdminPaymentTerminals,
  pingAdminTerminal,
  createAdminTerminal,
  updateAdminTerminal,
  deleteAdminTerminal,
  getAdminPaymentSettings,
  saveAdminPaymentSettings,
  getAdminPaymentHistory,
} from '../services/api';
import '../styles/admin.css';

// ── Shared helpers ─────────────────────────────────────────────────────────

const STATUS_COLORS = {
  active:   { bg: 'rgba(34,197,94,.15)',  border: 'rgba(34,197,94,.4)',  text: '#22c55e' },
  inactive: { bg: 'rgba(239,68,68,.13)',  border: 'rgba(239,68,68,.35)', text: '#ef4444' },
  unknown:  { bg: 'rgba(148,163,184,.13)',border: 'rgba(148,163,184,.3)',text: '#94a3b8' },
};

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.unknown;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'2px 10px', borderRadius:20, background:c.bg, border:`1px solid ${c.border}`, color:c.text, fontSize:'0.72rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.04em' }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:c.text, flexShrink:0 }} />
      {status}
    </span>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString() + ' ' + new Date(d).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}

function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}>
      <div
        onClick={() => onChange(!checked)}
        style={{ width:40, height:22, borderRadius:11, background: checked ? '#3b82f6' : 'var(--bg-card)', border:'1px solid var(--border-color)', position:'relative', cursor:'pointer', transition:'background .2s', flexShrink:0 }}
      >
        <div style={{ position:'absolute', top:2, left: checked ? 18 : 2, width:16, height:16, borderRadius:'50%', background:'#fff', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.3)' }} />
      </div>
      {label && <span style={{ fontSize:'0.85rem', color:'var(--text-primary)' }}>{label}</span>}
    </label>
  );
}

// ── MERCHANTS TAB ──────────────────────────────────────────────────────────

function MerchantsTab() {
  const [orgs,       setOrgs]       = useState([]);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [merchant,   setMerchant]   = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [showPw,     setShowPw]     = useState(false);
  const [form, setForm] = useState({ merchId:'', apiUser:'', apiPassword:'', site:'fts', isLive:false, baseUrl:'' });

  useEffect(() => {
    getAdminOrganizations({ limit: 500 }).then(r => setOrgs(r.data || [])).catch(() => toast.error('Failed to load organizations'));
  }, []);

  const loadMerchant = useCallback(async (orgId) => {
    if (!orgId) return;
    setLoading(true);
    try {
      const r = await getAdminPaymentMerchant(orgId);
      if (r.data) {
        setMerchant(r.data);
        setForm({ merchId: r.data.merchId, apiUser: r.data.apiUser, apiPassword: '', site: r.data.site || 'fts', isLive: r.data.isLive || false, baseUrl: r.data.baseUrl || '' });
      } else {
        setMerchant(null);
        setForm({ merchId:'', apiUser:'', apiPassword:'', site:'fts', isLive:false, baseUrl:'' });
      }
    } catch { toast.error('Failed to load merchant config'); }
    finally { setLoading(false); }
  }, []);

  const handleOrgChange = (orgId) => { setSelectedOrg(orgId); loadMerchant(orgId); };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!selectedOrg) return;
    if (!form.apiPassword && !merchant) { toast.error('API Password is required for new configs'); return; }
    setSaving(true);
    try {
      await saveAdminPaymentMerchant({ orgId: selectedOrg, ...form, apiPassword: form.apiPassword || '(unchanged)' });
      toast.success('Merchant credentials saved');
      loadMerchant(selectedOrg);
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <label style={{ display:'block', fontSize:'0.72rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Select Organization</label>
        <select className="admin-select" value={selectedOrg} onChange={e => handleOrgChange(e.target.value)} style={{ maxWidth:380 }}>
          <option value="">— Choose an organization —</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      {loading && <div style={{ color:'var(--text-muted)', fontSize:'0.9rem' }}><Loader size={16} className="spin" style={{ marginRight:8 }} />Loading...</div>}

      {selectedOrg && !loading && (
        <form onSubmit={handleSave} style={{ maxWidth:500 }}>
          <div style={{ background:'var(--bg-card)', border:'1px solid var(--border-color)', borderRadius:12, padding:'1.5rem', marginBottom:16 }}>
            <h3 style={{ margin:'0 0 1rem', fontSize:'0.9rem', fontWeight:700, color:'var(--text-primary)' }}>
              CardPointe Merchant Credentials
              {merchant && <span style={{ marginLeft:10, fontSize:'0.72rem', color:'#22c55e', fontWeight:600 }}>✓ Configured</span>}
            </h3>

            <div style={{ display:'grid', gap:14 }}>
              <div>
                <label style={{ display:'block', fontSize:'0.72rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:5 }}>Merchant ID *</label>
                <input className="admin-input" value={form.merchId} onChange={e => setForm(f => ({...f, merchId:e.target.value}))} placeholder="123456789" required />
              </div>
              <div>
                <label style={{ display:'block', fontSize:'0.72rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:5 }}>API User *</label>
                <input className="admin-input" value={form.apiUser} onChange={e => setForm(f => ({...f, apiUser:e.target.value}))} placeholder="apiuser" required />
              </div>
              <div>
                <label style={{ display:'block', fontSize:'0.72rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:5 }}>API Password {merchant ? '(leave blank to keep existing)' : '*'}</label>
                <div style={{ position:'relative' }}>
                  <input className="admin-input" type={showPw ? 'text' : 'password'} value={form.apiPassword} onChange={e => setForm(f => ({...f, apiPassword:e.target.value}))} placeholder={merchant ? '(unchanged)' : 'API password'} style={{ paddingRight:40 }} />
                  <button type="button" onClick={() => setShowPw(p => !p)} style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', alignItems:'center' }}>
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={{ display:'block', fontSize:'0.72rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:5 }}>Site Subdomain</label>
                  <input className="admin-input" value={form.site} onChange={e => setForm(f => ({...f, site:e.target.value}))} placeholder="fts" />
                </div>
                <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', paddingTop:18 }}>
                  <Toggle checked={form.isLive} onChange={v => setForm(f => ({...f, isLive:v}))} label={form.isLive ? '🟢 Live' : '🟡 UAT'} />
                </div>
              </div>
            </div>
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderRadius:8, background:'rgba(239,68,68,.07)', border:'1px solid rgba(239,68,68,.2)', marginBottom:16, fontSize:'0.8rem', color:'#ef4444' }}>
            🔐 Credentials are AES-256-GCM encrypted at rest. API password is never displayed in plaintext.
          </div>

          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
            {saving ? <><Loader size={14} className="spin" /> Saving...</> : <><Save size={14} /> Save Credentials</>}
          </button>
        </form>
      )}
    </div>
  );
}

// ── TERMINALS TAB ──────────────────────────────────────────────────────────

function TerminalsTab() {
  const [orgs,       setOrgs]       = useState([]);
  const [stores,     setStores]     = useState([]);
  const [terminals,  setTerminals]  = useState([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [pingingId,  setPingingId]  = useState(null);
  const [search,     setSearch]     = useState('');
  const [statusFilter, setStatus]   = useState('');
  const [page,       setPage]       = useState(1);
  const [showAdd,    setShowAdd]    = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [addForm,    setAddForm]    = useState({ orgId:'', storeId:'', hsn:'', name:'', model:'', ipAddress:'', port:6443, stationId:'' });
  const [addSaving,  setAddSaving]  = useState(false);
  const limit = 25;

  useEffect(() => {
    getAdminOrganizations({ limit:500 }).then(r => setOrgs(r.data || [])).catch(() => {});
    getAdminStores({ limit:500 }).then(r => setStores(r.data || [])).catch(() => {});
  }, []);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (statusFilter) params.status = statusFilter;
      const res = await getAdminPaymentTerminals(params);
      const all = res.data || [];
      const filtered = search ? all.filter(t => (t.name||'').toLowerCase().includes(search.toLowerCase()) || (t.hsn||'').toLowerCase().includes(search.toLowerCase()) || (t.orgName||'').toLowerCase().includes(search.toLowerCase())) : all;
      setTerminals(filtered);
      setTotal(search ? filtered.length : (res.total || 0));
    } catch { toast.error('Failed to load terminals'); }
    finally { setLoading(false); }
  }, [page, statusFilter, search]);

  useEffect(() => { fetch(); }, [fetch]);

  const handlePing = async (terminal) => {
    setPingingId(terminal.id);
    try {
      const result = await pingAdminTerminal(terminal.id);
      setTerminals(prev => prev.map(t => t.id === terminal.id ? { ...t, status: result.connected ? 'active' : 'inactive', lastPingMs: result.latencyMs ?? null, lastSeenAt: result.connected ? new Date().toISOString() : t.lastSeenAt } : t));
      result.connected ? toast.success(`${terminal.name || terminal.hsn} — ${result.latencyMs}ms`) : toast.warn(`${terminal.name || terminal.hsn} — unreachable`);
    } catch { toast.error('Ping failed'); }
    finally { setPingingId(null); }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setAddSaving(true);
    try {
      await createAdminTerminal({ ...addForm, port: Number(addForm.port) || 6443, stationId: addForm.stationId || null });
      toast.success('Terminal added');
      setShowAdd(false);
      setAddForm({ orgId:'', storeId:'', hsn:'', name:'', model:'', ipAddress:'', port:6443, stationId:'' });
      fetch();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to add terminal'); }
    finally { setAddSaving(false); }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete terminal "${name || id}"?`)) return;
    try {
      await deleteAdminTerminal(id);
      toast.success('Terminal deleted');
      fetch();
    } catch { toast.error('Delete failed'); }
  };

  const active   = terminals.filter(t => t.status === 'active').length;
  const inactive = terminals.filter(t => t.status === 'inactive').length;
  const unknown  = terminals.filter(t => t.status === 'unknown').length;
  const orgStores = stores.filter(s => s.orgId === addForm.orgId);

  return (
    <div>
      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
        {[{ label:'Total', value:terminals.length, color:'var(--text-primary)', bg:'var(--bg-card)' }, { label:'Active', value:active, color:'#22c55e', bg:'rgba(34,197,94,.07)' }, { label:'Inactive', value:inactive, color:'#ef4444', bg:'rgba(239,68,68,.07)' }, { label:'Unknown', value:unknown, color:'#94a3b8', bg:'rgba(148,163,184,.07)' }].map(c => (
          <div key={c.label} style={{ background:c.bg, border:'1px solid var(--border-color)', borderRadius:10, padding:'12px 16px' }}>
            <div style={{ fontSize:'0.7rem', fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>{c.label}</div>
            <div style={{ fontSize:'1.5rem', fontWeight:800, color:c.color, lineHeight:1 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Filters + Add */}
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        <div className="admin-search-wrapper" style={{ flex:1, minWidth:200 }}>
          <Search size={14} className="admin-search-icon" />
          <input className="admin-search" placeholder="Search by name, HSN, or org..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <select className="admin-select" value={statusFilter} onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="unknown">Unknown</option>
        </select>
        <button className="admin-btn admin-btn-secondary" onClick={fetch} disabled={loading}><RefreshCw size={14} /></button>
        <button className="admin-btn admin-btn-primary" onClick={() => setShowAdd(s => !s)}><Plus size={14} /> Add Terminal</button>
      </div>

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} style={{ background:'var(--bg-card)', border:'1px solid rgba(59,130,246,.3)', borderRadius:12, padding:'1.25rem', marginBottom:16 }}>
          <h4 style={{ margin:'0 0 12px', fontSize:'0.85rem', fontWeight:700, color:'var(--text-primary)' }}>Add New Terminal</h4>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:10 }}>
            <div>
              <label style={{ display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text-muted)', marginBottom:4 }}>Organization *</label>
              <select className="admin-select" value={addForm.orgId} onChange={e => setAddForm(f => ({...f, orgId:e.target.value, storeId:''}))} required>
                <option value="">Select org</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text-muted)', marginBottom:4 }}>Store *</label>
              <select className="admin-select" value={addForm.storeId} onChange={e => setAddForm(f => ({...f, storeId:e.target.value}))} required>
                <option value="">Select store</option>
                {orgStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text-muted)', marginBottom:4 }}>HSN *</label>
              <input className="admin-input" value={addForm.hsn} onChange={e => setAddForm(f => ({...f, hsn:e.target.value}))} placeholder="Hardware serial #" required />
            </div>
            <div>
              <label style={{ display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text-muted)', marginBottom:4 }}>Name</label>
              <input className="admin-input" value={addForm.name} onChange={e => setAddForm(f => ({...f, name:e.target.value}))} placeholder="Register 1 Terminal" />
            </div>
            <div>
              <label style={{ display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text-muted)', marginBottom:4 }}>Model</label>
              <input className="admin-input" value={addForm.model} onChange={e => setAddForm(f => ({...f, model:e.target.value}))} placeholder="A920" />
            </div>
          </div>
          <div style={{ display:'flex', gap:10, marginTop:12 }}>
            <button type="submit" className="admin-btn admin-btn-primary" disabled={addSaving}>{addSaving ? <><Loader size={13} className="spin" /> Saving...</> : 'Add Terminal'}</button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead><tr><th>Org</th><th>Terminal</th><th>HSN</th><th>Model</th><th>Status</th><th>Last Seen</th><th>Ping</th><th>Actions</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)' }}><Loader size={18} className="spin" style={{ marginRight:8 }} />Loading...</td></tr>
            ) : terminals.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)' }}>No terminals found</td></tr>
            ) : terminals.map(t => (
              <tr key={t.id}>
                <td><div style={{ fontWeight:600, fontSize:'0.82rem' }}>{t.orgName || t.orgId.slice(0,8)}</div><div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>{t.merchant?.isLive ? '🟢 Live' : '🟡 UAT'}</div></td>
                <td style={{ fontWeight:600 }}>{t.name || '—'}</td>
                <td><code style={{ fontSize:'0.77rem', background:'var(--bg-card)', padding:'2px 6px', borderRadius:4 }}>{t.hsn}</code></td>
                <td style={{ color:'var(--text-muted)', fontSize:'0.82rem' }}>{t.model || '—'}</td>
                <td><StatusBadge status={t.status} /></td>
                <td style={{ fontSize:'0.77rem', color:'var(--text-muted)' }}>{fmtDate(t.lastSeenAt)}</td>
                <td>{t.lastPingMs != null ? <span style={{ fontSize:'0.78rem', fontWeight:700, color:t.lastPingMs < 300 ? '#22c55e' : t.lastPingMs < 800 ? '#f59e0b' : '#ef4444' }}>{t.lastPingMs}ms</span> : <span style={{ color:'var(--text-muted)', fontSize:'0.78rem' }}>—</span>}</td>
                <td>
                  <div style={{ display:'flex', gap:6 }}>
                    <button onClick={() => handlePing(t)} disabled={pingingId === t.id} style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:6, fontSize:'0.77rem', fontWeight:600, background:'var(--bg-card)', border:'1px solid var(--border-color)', color:'var(--text-secondary)', cursor: pingingId===t.id ? 'not-allowed':'pointer', opacity:pingingId===t.id?0.6:1 }}>
                      {pingingId===t.id ? <Loader size={11} className="spin" /> : (t.status==='active' ? <Wifi size={11} /> : <WifiOff size={11} />)} Ping
                    </button>
                    <button onClick={() => handleDelete(t.id, t.name)} style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:6, fontSize:'0.77rem', fontWeight:600, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)', color:'#ef4444', cursor:'pointer' }}>
                      <Trash2 size={11} /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Math.ceil(total/limit) > 1 && (
        <div className="admin-pagination">
          <button className="admin-btn admin-btn-secondary" onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}><ChevronLeft size={14} /> Prev</button>
          <span style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>Page {page} of {Math.ceil(total/limit)}</span>
          <button className="admin-btn admin-btn-secondary" onClick={() => setPage(p => Math.min(Math.ceil(total/limit),p+1))} disabled={page===Math.ceil(total/limit)}>Next <ChevronRight size={14} /></button>
        </div>
      )}
    </div>
  );
}

// ── STORE SETTINGS TAB ─────────────────────────────────────────────────────

function StoreSettingsTab() {
  const [stores,    setStores]    = useState([]);
  const [storeId,   setStoreId]   = useState('');
  const [settings,  setSettings]  = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [form, setForm] = useState({ signatureThreshold:25, tipEnabled:false, surchargeEnabled:false, surchargePercent:'', acceptCreditCards:true, acceptDebitCards:true, acceptAmex:true, acceptContactless:true });

  useEffect(() => {
    getAdminStores({ limit:500 }).then(r => setStores(r.data || [])).catch(() => toast.error('Failed to load stores'));
  }, []);

  const loadSettings = useCallback(async (sid) => {
    if (!sid) return;
    setLoading(true);
    try {
      const r = await getAdminPaymentSettings(sid);
      if (r.data) {
        const d = r.data;
        setSettings(d);
        setForm({ signatureThreshold: Number(d.signatureThreshold) || 25, tipEnabled: d.tipEnabled || false, surchargeEnabled: d.surchargeEnabled || false, surchargePercent: d.surchargePercent ? String(Number(d.surchargePercent)*100) : '', acceptCreditCards: d.acceptCreditCards ?? true, acceptDebitCards: d.acceptDebitCards ?? true, acceptAmex: d.acceptAmex ?? true, acceptContactless: d.acceptContactless ?? true });
      }
    } catch { toast.error('Failed to load settings'); }
    finally { setLoading(false); }
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!storeId) return;
    setSaving(true);
    try {
      await saveAdminPaymentSettings(storeId, { ...form, surchargePercent: form.surchargePercent ? Number(form.surchargePercent)/100 : null });
      toast.success('Payment settings saved');
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <label style={{ display:'block', fontSize:'0.72rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Select Store</label>
        <select className="admin-select" value={storeId} onChange={e => { setStoreId(e.target.value); loadSettings(e.target.value); }} style={{ maxWidth:380 }}>
          <option value="">— Choose a store —</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {loading && <div style={{ color:'var(--text-muted)' }}><Loader size={16} className="spin" style={{ marginRight:8 }} />Loading...</div>}

      {storeId && !loading && (
        <form onSubmit={handleSave} style={{ maxWidth:520 }}>
          <div style={{ background:'var(--bg-card)', border:'1px solid var(--border-color)', borderRadius:12, padding:'1.5rem', display:'flex', flexDirection:'column', gap:20 }}>
            <div>
              <label style={{ display:'block', fontSize:'0.72rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Signature Threshold ($)</label>
              <input className="admin-input" type="number" step="0.01" min="0" value={form.signatureThreshold} onChange={e => setForm(f => ({...f, signatureThreshold:e.target.value}))} style={{ maxWidth:160 }} />
              <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', marginTop:4 }}>Require signature for transactions above this amount</div>
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Accepted Card Types</div>
              {[['acceptCreditCards','Credit Cards'],['acceptDebitCards','Debit Cards'],['acceptAmex','American Express'],['acceptContactless','Contactless / Tap']].map(([key, label]) => (
                <Toggle key={key} checked={form[key]} onChange={v => setForm(f => ({...f, [key]:v}))} label={label} />
              ))}
            </div>

            <div>
              <Toggle checked={form.tipEnabled} onChange={v => setForm(f => ({...f, tipEnabled:v}))} label="Enable tip prompts at checkout" />
            </div>

            <div>
              <Toggle checked={form.surchargeEnabled} onChange={v => setForm(f => ({...f, surchargeEnabled:v}))} label="Enable card surcharge" />
              {form.surchargeEnabled && (
                <div style={{ marginTop:10 }}>
                  <label style={{ display:'block', fontSize:'0.72rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Surcharge %</label>
                  <input className="admin-input" type="number" step="0.01" min="0" max="10" value={form.surchargePercent} onChange={e => setForm(f => ({...f, surchargePercent:e.target.value}))} placeholder="e.g. 3.0" style={{ maxWidth:120 }} />
                </div>
              )}
            </div>
          </div>

          <button type="submit" className="admin-btn admin-btn-primary" style={{ marginTop:16 }} disabled={saving}>
            {saving ? <><Loader size={14} className="spin" /> Saving...</> : <><Save size={14} /> Save Settings</>}
          </button>
        </form>
      )}
    </div>
  );
}

// ── HISTORY TAB ────────────────────────────────────────────────────────────

function HistoryTab() {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [page,    setPage]    = useState(1);
  const [filters, setFilters] = useState({ type:'', status:'', dateFrom:'', dateTo:'' });
  const limit = 50;

  const TYPE_BADGES  = { sale:'#3b82f6', void:'#f59e0b', refund:'#a855f7' };
  const STATUS_BADGES = { approved:'#22c55e', declined:'#ef4444', voided:'#f59e0b', refunded:'#a855f7', pending:'#94a3b8', error:'#ef4444' };

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getAdminPaymentHistory({ page, limit, ...Object.fromEntries(Object.entries(filters).filter(([,v])=>v)) });
      setRows(r.data || []);
      setTotal(r.meta?.total || 0);
    } catch { toast.error('Failed to load history'); }
    finally { setLoading(false); }
  }, [page, filters]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const badge = (val, colorMap) => {
    const color = colorMap[val] || '#94a3b8';
    return <span style={{ padding:'2px 8px', borderRadius:10, background:`${color}22`, border:`1px solid ${color}44`, color, fontSize:'0.72rem', fontWeight:700, textTransform:'uppercase' }}>{val}</span>;
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        <select className="admin-select" value={filters.type} onChange={e => { setFilters(f => ({...f, type:e.target.value})); setPage(1); }}>
          <option value="">All Types</option><option value="sale">Sale</option><option value="void">Void</option><option value="refund">Refund</option>
        </select>
        <select className="admin-select" value={filters.status} onChange={e => { setFilters(f => ({...f, status:e.target.value})); setPage(1); }}>
          <option value="">All Statuses</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="voided">Voided</option><option value="refunded">Refunded</option>
        </select>
        <input type="date" className="admin-input" value={filters.dateFrom} onChange={e => { setFilters(f => ({...f, dateFrom:e.target.value})); setPage(1); }} style={{ width:'auto' }} />
        <input type="date" className="admin-input" value={filters.dateTo} onChange={e => { setFilters(f => ({...f, dateTo:e.target.value})); setPage(1); }} style={{ width:'auto' }} />
        <button className="admin-btn admin-btn-secondary" onClick={fetchHistory}><RefreshCw size={14} /></button>
        <span style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>{total.toLocaleString()} records</span>
      </div>

      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead><tr><th>Date</th><th>Org</th><th>Type</th><th>Card</th><th>Amount</th><th>Auth Code</th><th>Retref</th><th>Status</th><th>Mode</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)' }}><Loader size={18} className="spin" style={{ marginRight:8 }} />Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)' }}>No transactions found</td></tr>
            ) : rows.map(r => (
              <tr key={r.id}>
                <td style={{ fontSize:'0.78rem', whiteSpace:'nowrap' }}>{fmtDate(r.createdAt)}</td>
                <td style={{ fontSize:'0.78rem' }}>{r.orgName || r.orgId?.slice(0,8)}</td>
                <td>{badge(r.type, TYPE_BADGES)}</td>
                <td style={{ fontSize:'0.82rem', fontFamily:'monospace' }}>{r.acctType ? `${r.acctType} ···· ${r.lastFour}` : '—'}</td>
                <td style={{ fontWeight:700, color: r.type==='refund'?'#ef4444':'var(--text-primary)' }}>{r.type==='refund'?'-':''}{r.amount ? `$${Number(r.amount).toFixed(2)}` : '—'}</td>
                <td style={{ fontSize:'0.78rem', fontFamily:'monospace' }}>{r.authCode || '—'}</td>
                <td style={{ fontSize:'0.72rem', fontFamily:'monospace', color:'var(--text-muted)' }}>{r.retref || '—'}</td>
                <td>{badge(r.status, STATUS_BADGES)}</td>
                <td style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>{r.entryMode || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="admin-pagination">
          <button className="admin-btn admin-btn-secondary" onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}><ChevronLeft size={14} /> Prev</button>
          <span style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>Page {page} of {totalPages}</span>
          <button className="admin-btn admin-btn-secondary" onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages}>Next <ChevronRight size={14} /></button>
        </div>
      )}
    </div>
  );
}

// ── MAIN PAGE ──────────────────────────────────────────────────────────────

const TABS = [
  { id:'merchants',  label:'Merchants',     icon:<Building2 size={14}/> },
  { id:'terminals',  label:'Terminals',     icon:<Monitor size={14}/>   },
  { id:'settings',   label:'Store Settings',icon:<Settings2 size={14}/> },
  { id:'history',    label:'History',       icon:<History size={14}/>   },
];

export default function AdminPaymentSettings() {
  const [tab, setTab] = useState('merchants');

  return (
    <div className="layout-container">
      <AdminSidebar />
      <main className="main-content admin-page">
        <div className="admin-header">
          <div className="admin-header-left">
            <h1>Payment Management</h1>
            <p>Merchant credentials, terminals, store settings and transaction history</p>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display:'flex', gap:4, marginBottom:24, borderBottom:'1px solid var(--border-color)', paddingBottom:0 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display:'flex', alignItems:'center', gap:7,
                padding:'8px 18px', border:'none', background:'none', cursor:'pointer',
                fontSize:'0.85rem', fontWeight: tab===t.id ? 700 : 500,
                color: tab===t.id ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: tab===t.id ? '2px solid #3b82f6' : '2px solid transparent',
                marginBottom:'-1px', transition:'color .15s',
              }}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {tab === 'merchants'  && <MerchantsTab />}
        {tab === 'terminals'  && <TerminalsTab />}
        {tab === 'settings'   && <StoreSettingsTab />}
        {tab === 'history'    && <HistoryTab />}
      </main>
    </div>
  );

}
