/**
 * Vendors — Manage supplier/vendor catalog.
 * Features: search, CRUD via right-panel form, active toggle, inline status toggle.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';

import {
  getCatalogVendors,
  createCatalogVendor,
  updateCatalogVendor,
  deleteCatalogVendor,
} from '../services/api';
import {
  Plus, Edit2, X, Check, Search, Truck, Phone,
  Mail, Globe, ExternalLink, ToggleLeft, ToggleRight,
  Building2, ChevronRight, Package, Copy,
} from 'lucide-react';
import './Vendors.css';

// ─── ID Chip (click to copy) ──────────────────────────────────────────────────
function IdChip({ id }) {
  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(String(id)).then(() => {
      // brief visual feedback via title attr — toast already imported
    });
    import('react-toastify').then(({ toast }) => toast.success(`Vendor ID ${id} copied`, { autoClose: 1500 }));
  };
  return (
    <div onClick={copy} title="Click to copy Vendor ID" className="ven-id-chip">
      #{id} <Copy size={9} />
    </div>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, size = 'md' }) {
  const w = size === 'sm' ? 28 : 34;
  const h = size === 'sm' ? 16 : 18;
  const r = size === 'sm' ? 8 : 9;
  const tw = size === 'sm' ? 12 : 14;
  const on = size === 'sm' ? 13 : 15;
  return (
    <div
      onClick={e => { e.stopPropagation(); onChange(!checked); }}
      style={{
        width: w, height: h, borderRadius: r, flexShrink: 0,
        background: checked ? 'var(--green, var(--accent-primary))' : 'var(--bg-tertiary, #2a2a3a)',
        position: 'relative', cursor: 'pointer',
        border: `1px solid ${checked ? 'var(--green, var(--accent-primary))' : 'var(--border-color, #3a3a4a)'}`,
        transition: 'background .2s',
      }}
    >
      <div style={{
        position: 'absolute', top: 1,
        left: checked ? on : 1,
        width: tw, height: tw, borderRadius: '50%',
        background: '#fff', transition: 'left .15s',
        boxShadow: '0 1px 3px rgba(0,0,0,.3)',
      }} />
    </div>
  );
}

// ─── Empty form ───────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: '', code: '', contactName: '', email: '', phone: '',
  website: '', terms: '', accountNo: '',
  street: '', city: '', state: '', zip: '',
  aliases: '',
  active: true,
};

// ─── Vendor Form Panel ────────────────────────────────────────────────────────

function VendorForm({ vendor, onSave, onClose, saving }) {
  const [form, setForm] = useState(() => {
    if (!vendor) return { ...EMPTY_FORM };
    const addr = vendor.address || {};
    return {
      name:        vendor.name || '',
      code:        vendor.code || '',
      contactName: vendor.contactName || '',
      email:       vendor.email || '',
      phone:       vendor.phone || '',
      website:     vendor.website || '',
      terms:       vendor.terms || '',
      accountNo:   vendor.accountNo || '',
      street:      addr.street || '',
      city:        addr.city || '',
      state:       addr.state || '',
      zip:         addr.zip || '',
      aliases:     Array.isArray(vendor.aliases) ? vendor.aliases.join(', ') : '',
      active:      vendor.active ?? true,
    };
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const inputStyle = {
    width: '100%', padding: '0.55rem 0.75rem', borderRadius: 8,
    border: '1px solid var(--border-color, #2a2a3a)',
    background: 'var(--bg-tertiary, #1a1a2e)',
    color: 'var(--text-primary, #e2e8f0)',
    fontSize: '0.875rem', boxSizing: 'border-box', outline: 'none',
  };
  const labelStyle = {
    fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)',
    letterSpacing: '0.05em', marginBottom: 5, display: 'block',
  };
  const sectionLabel = {
    fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-muted, #6b7280)',
    letterSpacing: '0.08em', textTransform: 'uppercase',
    marginBottom: '0.75rem', marginTop: '0.25rem',
    paddingBottom: '0.4rem', borderBottom: '1px solid var(--border-color, #2a2a3a)',
  };

  const handleSave = () => {
    const payload = {
      name:        form.name.trim(),
      code:        form.code.trim().toUpperCase() || null,
      contactName: form.contactName.trim() || null,
      email:       form.email.trim() || null,
      phone:       form.phone.trim() || null,
      website:     form.website.trim() || null,
      terms:       form.terms.trim() || null,
      accountNo:   form.accountNo.trim() || null,
      address: (form.street || form.city || form.state || form.zip) ? {
        street: form.street.trim() || null,
        city:   form.city.trim() || null,
        state:  form.state.trim() || null,
        zip:    form.zip.trim() || null,
      } : null,
      aliases: form.aliases.trim()
        ? form.aliases.split(',').map(a => a.trim()).filter(Boolean)
        : [],
      active: form.active,
    };
    onSave(payload);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)' }} />
      <div style={{
        position: 'relative', zIndex: 1,
        width: 480, height: '100vh', overflowY: 'auto',
        background: 'var(--bg-secondary, #111827)',
        borderLeft: '1px solid var(--border-color, #2a2a3a)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0,0,0,.4)',
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color, #2a2a3a)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, position: 'sticky', top: 0, zIndex: 2,
          background: 'var(--bg-secondary, #111827)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--brand-10)', border: '1px solid var(--brand-20)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Truck size={16} color="var(--accent-primary)" />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary, #e2e8f0)' }}>
                {vendor ? 'Edit Vendor' : 'New Vendor'}
              </div>
              {vendor && (
                <div
                  onClick={() => { navigator.clipboard.writeText(String(vendor.id)); import('react-toastify').then(({ toast }) => toast.success(`Vendor ID ${vendor.id} copied`, { autoClose: 1500 })); }}
                  title="Click to copy Vendor ID"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontFamily: 'monospace', fontWeight: 700, color: '#3d56b5', background: 'rgba(61,86,181,0.1)', border: '1px solid rgba(61,86,181,0.22)', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', userSelect: 'none' }}
                >
                  ID #{vendor.id} <Copy size={9} />
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted, #6b7280)', padding: 4, display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Basic Info */}
          <div style={sectionLabel}>Basic Info</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
            <div>
              <label style={labelStyle}>VENDOR NAME *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Sysco, Coca-Cola" style={inputStyle} />
            </div>
            <div style={{ width: 100 }}>
              <label style={labelStyle}>CODE</label>
              <input value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="SYSCO" maxLength={12}
                style={{ ...inputStyle, fontFamily: 'monospace', letterSpacing: '0.05em' }} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>ACCOUNT NUMBER</label>
            <input value={form.accountNo} onChange={e => set('accountNo', e.target.value)} placeholder="e.g. 001234-5" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>PAYMENT TERMS</label>
            <input value={form.terms} onChange={e => set('terms', e.target.value)} placeholder="e.g. Net 30, COD, 2/10 Net 30" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>ALIASES / ALTERNATE NAMES <span style={{ fontWeight: 400 }}>(comma separated)</span></label>
            <input value={form.aliases} onChange={e => set('aliases', e.target.value)} placeholder="e.g. Sysco Foods, Sysco Corp" style={inputStyle} />
          </div>

          {/* Contact */}
          <div style={{ ...sectionLabel, marginTop: '0.5rem' }}>Contact Info</div>

          <div>
            <label style={labelStyle}>CONTACT NAME</label>
            <input value={form.contactName} onChange={e => set('contactName', e.target.value)} placeholder="e.g. John Smith" style={inputStyle} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>EMAIL</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="orders@vendor.com" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>PHONE</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+1 (800) 555-0100" style={inputStyle} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>WEBSITE</label>
            <input value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://vendor.com" style={inputStyle} />
          </div>

          {/* Address */}
          <div style={{ ...sectionLabel, marginTop: '0.5rem' }}>Address</div>

          <div>
            <label style={labelStyle}>STREET</label>
            <input value={form.street} onChange={e => set('street', e.target.value)} placeholder="123 Warehouse Blvd" style={inputStyle} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>CITY</label>
              <input value={form.city} onChange={e => set('city', e.target.value)} placeholder="Chicago" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>STATE</label>
              <input value={form.state} onChange={e => set('state', e.target.value.toUpperCase())} placeholder="IL" maxLength={2} style={{ ...inputStyle, fontFamily: 'monospace' }} />
            </div>
            <div>
              <label style={labelStyle}>ZIP</label>
              <input value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="60601" style={inputStyle} />
            </div>
          </div>

          {/* Status */}
          <div style={{ ...sectionLabel, marginTop: '0.5rem' }}>Status</div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '0.55rem 0.75rem', borderRadius: 8,
            border: '1px solid var(--border-color, #2a2a3a)',
            background: 'var(--bg-tertiary, #1a1a2e)', cursor: 'pointer',
          }} onClick={() => set('active', !form.active)}>
            <Toggle checked={form.active} onChange={v => set('active', v)} />
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: form.active ? 'var(--green, var(--accent-primary))' : 'var(--text-muted, #6b7280)' }}>
              {form.active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color, #2a2a3a)',
          display: 'flex', gap: 8, flexShrink: 0, position: 'sticky', bottom: 0,
          background: 'var(--bg-secondary, #111827)',
        }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '0.75rem', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
            border: '1px solid var(--border-color, #2a2a3a)', background: 'var(--bg-tertiary, #1a1a2e)', color: 'var(--text-secondary, #9ca3af)',
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.name.trim()} style={{
            flex: 2, padding: '0.75rem', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '0.875rem',
            background: saving || !form.name.trim() ? 'var(--bg-tertiary, #2a2a3a)' : 'var(--green, var(--accent-primary))',
            color: saving || !form.name.trim() ? 'var(--text-muted, #6b7280)' : '#0f1117',
            cursor: saving || !form.name.trim() ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Check size={15} />
            {saving ? 'Saving…' : vendor ? 'Save Changes' : 'Create Vendor'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Vendor Row ────────────────────────────────────────────────────────────────

function VendorRow({ vendor, onEdit, onToggleActive, onViewDetail }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '64px 2fr 1fr 1fr 1fr 60px 80px 100px',
      gap: '0 8px',
      padding: '0.75rem 1rem',
      alignItems: 'center',
      borderBottom: '1px solid var(--border-color, #1f2937)',
      opacity: vendor.active ? 1 : 0.55,
      transition: 'opacity .15s, background .1s',
    }}>
      {/* ID chip */}
      <div><IdChip id={vendor.id} /></div>

      {/* Name + code + contact */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary, #e2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {vendor.name}
          </span>
          {vendor.code && (
            <span style={{ fontSize: '0.62rem', fontWeight: 800, fontFamily: 'monospace', padding: '1px 5px', borderRadius: 3, background: 'rgba(255,255,255,.06)', color: 'var(--text-muted, #6b7280)', letterSpacing: '0.05em', flexShrink: 0 }}>
              {vendor.code}
            </span>
          )}
        </div>
        {vendor.contactName && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #6b7280)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Building2 size={10} />
            {vendor.contactName}
          </div>
        )}
      </div>

      {/* Email */}
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #9ca3af)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
        {vendor.email ? <><Mail size={10} /> {vendor.email}</> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
      </div>

      {/* Phone */}
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #9ca3af)', display: 'flex', alignItems: 'center', gap: 5 }}>
        {vendor.phone ? <><Phone size={10} /> {vendor.phone}</> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
      </div>

      {/* Terms */}
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {vendor.terms || '—'}
      </div>

      {/* Active toggle */}
      <div>
        <Toggle checked={vendor.active} onChange={v => onToggleActive(vendor, v)} size="sm" />
      </div>

      {/* Status */}
      <div>
        <span style={{
          fontSize: '0.68rem', fontWeight: 700, padding: '3px 8px', borderRadius: 4,
          background: vendor.active ? 'var(--brand-12)' : 'rgba(100,116,139,.1)',
          color: vendor.active ? 'var(--accent-primary)' : '#64748b',
        }}>
          {vendor.active ? 'Active' : 'Inactive'}
        </span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <button onClick={() => onEdit(vendor)} title="Edit" style={{
          padding: 6, borderRadius: 6, border: 'none', background: 'rgba(255,255,255,.04)',
          cursor: 'pointer', color: 'var(--text-muted, #6b7280)', display: 'flex', alignItems: 'center',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand-12)'; e.currentTarget.style.color = 'var(--accent-primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.04)'; e.currentTarget.style.color = 'var(--text-muted, #6b7280)'; }}
        >
          <Edit2 size={13} />
        </button>
        <button onClick={() => onViewDetail(vendor.id)} title="View detail" style={{
          padding: 6, borderRadius: 6, border: 'none', background: 'rgba(255,255,255,.04)',
          cursor: 'pointer', color: 'var(--text-muted, #6b7280)', display: 'flex', alignItems: 'center',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,.12)'; e.currentTarget.style.color = '#3b82f6'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.04)'; e.currentTarget.style.color = 'var(--text-muted, #6b7280)'; }}
        >
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function Vendors() {
  const navigate = useNavigate();
  const [vendors,      setVendors]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [panelVendor,  setPanelVendor]  = useState(undefined); // undefined=hidden, null=new, obj=edit
  const [saving,       setSaving]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getCatalogVendors({ includeInactive: showInactive ? 'true' : 'false' });
      const list = res?.data || res || [];
      setVendors(Array.isArray(list) ? list : []);
    } catch {
      toast.error('Failed to load vendors');
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => { load(); }, [load]);

  const filtered = search.trim()
    ? vendors.filter(v => {
        const q = search.toLowerCase();
        return v.name?.toLowerCase().includes(q)
          || v.code?.toLowerCase().includes(q)
          || v.email?.toLowerCase().includes(q)
          || v.contactName?.toLowerCase().includes(q)
          || (v.aliases || []).some(a => a.toLowerCase().includes(q));
      })
    : vendors;

  const handleSave = async (payload) => {
    if (!payload.name) return;
    setSaving(true);
    try {
      if (panelVendor?.id) {
        await updateCatalogVendor(panelVendor.id, payload);
        toast.success(`"${payload.name}" updated`);
      } else {
        await createCatalogVendor(payload);
        toast.success(`"${payload.name}" created`);
      }
      setPanelVendor(undefined);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save vendor');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (vendor, val) => {
    setVendors(vs => vs.map(v => v.id === vendor.id ? { ...v, active: val } : v));
    try {
      await updateCatalogVendor(vendor.id, { active: val });
      toast.success(`"${vendor.name}" ${val ? 'activated' : 'deactivated'}`);
    } catch {
      setVendors(vs => vs.map(v => v.id === vendor.id ? { ...v, active: !val } : v));
      toast.error('Failed to update');
    }
  };

  const cardStyle = {
    background: 'var(--bg-secondary, #111827)',
    border: '1px solid var(--border-color, #1f2937)',
    borderRadius: 12, overflow: 'hidden',
  };

  return (
      <div className="p-page ven-content">

        {/* Header */}
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <Truck size={22} />
            </div>
            <div>
              <h1 className="p-title">Vendors</h1>
              <p className="p-subtitle">Manage suppliers · track payouts, products & invoices</p>
            </div>
          </div>
          <div className="p-header-actions">
            <button onClick={() => setShowInactive(v => !v)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '0.5rem 0.875rem', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${showInactive ? 'var(--brand-30)' : 'var(--border-color, #2a2a3a)'}`,
              background: showInactive ? 'var(--brand-08)' : 'var(--bg-tertiary, #1a1a2e)',
              color: showInactive ? 'var(--accent-primary)' : 'var(--text-muted, #6b7280)', fontSize: '0.8rem', fontWeight: 600,
            }}>
              {showInactive ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
              {showInactive ? 'Showing All' : 'Show Inactive'}
            </button>
            <button onClick={() => setPanelVendor(null)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '0.55rem 1.1rem', borderRadius: 8, border: 'none',
              background: 'var(--accent-primary)', color: '#0f1117', fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer',
            }}>
              <Plus size={15} /> New Vendor
            </button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: '1.5rem' }}>
          {[
            { label: 'Total',    value: vendors.length,                        color: 'var(--accent-primary)', bg: 'var(--brand-08)' },
            { label: 'Active',   value: vendors.filter(v => v.active).length,  color: '#10b981', bg: 'rgba(16,185,129,.08)' },
            { label: 'Inactive', value: vendors.filter(v => !v.active).length, color: '#64748b', bg: 'rgba(100,116,139,.08)' },
            { label: 'w/ Email', value: vendors.filter(v => v.email).length,   color: '#3b82f6', bg: 'rgba(59,130,246,.08)' },
          ].map(s => (
            <div key={s.label} style={{ padding: '0.875rem 1rem', borderRadius: 10, background: s.bg, border: `1px solid ${s.bg.replace('.08)', '.2)')}` }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)', marginTop: 3, letterSpacing: '0.04em' }}>{s.label.toUpperCase()}</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: '1.25rem', maxWidth: 400 }}>
          <Search size={15} color="var(--text-muted, #6b7280)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendors…" style={{
            width: '100%', paddingLeft: '2.25rem', paddingRight: '0.75rem', height: 38, borderRadius: 8, boxSizing: 'border-box',
            border: '1px solid var(--border-color, #2a2a3a)', background: 'var(--bg-tertiary, #1a1a2e)',
            color: 'var(--text-primary, #e2e8f0)', fontSize: '0.875rem', outline: 'none',
          }} />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted, #6b7280)', padding: 2 }}>
              <X size={13} />
            </button>
          )}
        </div>

        {/* Table */}
        <div style={cardStyle}>
          {/* Header row */}
          <div style={{
            display: 'grid', gridTemplateColumns: '64px 2fr 1fr 1fr 1fr 60px 80px 100px',
            gap: '0 8px', padding: '0.5rem 1rem',
            borderBottom: '1px solid var(--border-color, #1f2937)',
            fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)',
            letterSpacing: '0.07em', background: 'var(--bg-tertiary, #0f172a)',
          }}>
            <span style={{ color: '#3d56b5' }}>ID</span>
            <span>VENDOR</span>
            <span>EMAIL</span>
            <span>PHONE</span>
            <span>TERMS</span>
            <span>ACTIVE</span>
            <span>STATUS</span>
            <span />
          </div>

          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted, #6b7280)' }}>Loading vendors…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <Truck size={36} color="var(--text-muted, #6b7280)" style={{ opacity: 0.3, marginBottom: 10 }} />
              <div style={{ color: 'var(--text-muted, #6b7280)', fontWeight: 600 }}>
                {search ? 'No vendors match your search.' : 'No vendors yet — add your first supplier!'}
              </div>
            </div>
          ) : (
            filtered.map(vendor => (
              <VendorRow
                key={vendor.id}
                vendor={vendor}
                onEdit={setPanelVendor}
                onToggleActive={toggleActive}
                onViewDetail={id => navigate(`/portal/vendors/${id}`)}
              />
            ))
          )}
        </div>

      {/* Form panel */}
      {panelVendor !== undefined && (
        <VendorForm vendor={panelVendor} onSave={handleSave} onClose={() => setPanelVendor(undefined)} saving={saving} />
      )}
    </div>
  );
}
