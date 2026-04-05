/**
 * VendorDetail — Full vendor profile with tabbed sections:
 *   Overview · Products · Payouts · Stats
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import Sidebar from '../components/Sidebar';
import {
  getCatalogVendor,
  updateCatalogVendor,
  getVendorProducts,
  getVendorPayouts,
  getVendorStats,
} from '../services/api';
import {
  Truck, ArrowLeft, Edit2, Check, X, Phone, Mail, Globe,
  Package, DollarSign, TrendingDown, BarChart2, Building2,
  MapPin, Hash, Clock, FileText, Tag, ChevronRight,
  ShoppingBag, CreditCard, AlertCircle,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

// ─── Shared styles ─────────────────────────────────────────────────────────────

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
const cardStyle = {
  background: 'var(--bg-secondary, #111827)',
  border: '1px solid var(--border-color, #1f2937)',
  borderRadius: 12, overflow: 'hidden',
};

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }) {
  return (
    <div
      onClick={e => { e.stopPropagation(); onChange(!checked); }}
      style={{
        width: 34, height: 18, borderRadius: 9, flexShrink: 0,
        background: checked ? 'var(--green, var(--accent-primary))' : 'var(--bg-tertiary, #2a2a3a)',
        position: 'relative', cursor: 'pointer',
        border: `1px solid ${checked ? 'var(--green, var(--accent-primary))' : 'var(--border-color, #3a3a4a)'}`,
        transition: 'background .2s',
      }}
    >
      <div style={{
        position: 'absolute', top: 1, left: checked ? 15 : 1,
        width: 14, height: 14, borderRadius: '50%',
        background: '#fff', transition: 'left .15s',
        boxShadow: '0 1px 3px rgba(0,0,0,.3)',
      }} />
    </div>
  );
}

// ─── Info Row ─────────────────────────────────────────────────────────────────

function InfoRow({ icon: Icon, label, value, mono }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '0.6rem 0', borderBottom: '1px solid var(--border-color, #1f2937)' }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--brand-08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={14} color="var(--accent-primary)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-primary, #e2e8f0)', fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-word' }}>{value}</div>
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, bg, icon: Icon }) {
  return (
    <div style={{ padding: '1rem', borderRadius: 10, background: bg, border: `1px solid ${bg.replace('.08)', '.25)')}`, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: bg.replace('.08)', '.15)'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={18} color={color} />
      </div>
      <div>
        <div style={{ fontSize: '1.4rem', fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)', marginTop: 2, letterSpacing: '0.04em' }}>{label.toUpperCase()}</div>
      </div>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ vendor, onVendorUpdate }) {
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [form,    setForm]    = useState(null);

  const openEdit = () => {
    const addr = vendor.address || {};
    setForm({
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
    });
    setEditing(true);
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
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
      await updateCatalogVendor(vendor.id, payload);
      toast.success('Vendor updated');
      setEditing(false);
      onVendorUpdate({ ...vendor, ...payload });
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const addr = vendor.address || {};
  const addressStr = [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(', ');

  if (editing && form) {
    return (
      <div style={{ maxWidth: 640 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary, #e2e8f0)' }}>Edit Vendor</div>
          <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {/* Name + Code */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginBottom: '1rem' }}>
          <div>
            <label style={labelStyle}>VENDOR NAME *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} style={inputStyle} />
          </div>
          <div style={{ width: 110 }}>
            <label style={labelStyle}>CODE</label>
            <input value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} maxLength={12} style={{ ...inputStyle, fontFamily: 'monospace' }} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: '1rem' }}>
          <div>
            <label style={labelStyle}>ACCOUNT NUMBER</label>
            <input value={form.accountNo} onChange={e => set('accountNo', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>PAYMENT TERMS</label>
            <input value={form.terms} onChange={e => set('terms', e.target.value)} placeholder="Net 30, COD…" style={inputStyle} />
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>ALIASES (comma separated)</label>
          <input value={form.aliases} onChange={e => set('aliases', e.target.value)} style={inputStyle} />
        </div>

        <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border-color, #2a2a3a)' }}>
          CONTACT
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>CONTACT NAME</label>
          <input value={form.contactName} onChange={e => set('contactName', e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: '1rem' }}>
          <div>
            <label style={labelStyle}>EMAIL</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>PHONE</label>
            <input value={form.phone} onChange={e => set('phone', e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>WEBSITE</label>
          <input value={form.website} onChange={e => set('website', e.target.value)} style={inputStyle} />
        </div>

        <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border-color, #2a2a3a)' }}>
          ADDRESS
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>STREET</label>
          <input value={form.street} onChange={e => set('street', e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: '1.5rem' }}>
          <div>
            <label style={labelStyle}>CITY</label>
            <input value={form.city} onChange={e => set('city', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>STATE</label>
            <input value={form.state} onChange={e => set('state', e.target.value.toUpperCase())} maxLength={2} style={{ ...inputStyle, fontFamily: 'monospace' }} />
          </div>
          <div>
            <label style={labelStyle}>ZIP</label>
            <input value={form.zip} onChange={e => set('zip', e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setEditing(false)} style={{
            flex: 1, padding: '0.75rem', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
            border: '1px solid var(--border-color, #2a2a3a)', background: 'var(--bg-tertiary, #1a1a2e)', color: 'var(--text-secondary, #9ca3af)',
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.name.trim()} style={{
            flex: 2, padding: '0.75rem', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '0.875rem',
            background: saving || !form.name.trim() ? 'var(--bg-tertiary, #2a2a3a)' : 'var(--green, var(--accent-primary))',
            color: saving || !form.name.trim() ? 'var(--text-muted)' : '#0f1117',
            cursor: saving || !form.name.trim() ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Check size={15} /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
      {/* Left: Core info */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-muted, #6b7280)', letterSpacing: '0.05em' }}>VENDOR DETAILS</div>
          <button onClick={openEdit} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '0.4rem 0.75rem', borderRadius: 7,
            border: '1px solid var(--border-color, #2a2a3a)', background: 'var(--bg-tertiary, #1a1a2e)',
            color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
          }}>
            <Edit2 size={12} /> Edit
          </button>
        </div>

        <InfoRow icon={Hash}       label="Account Number"  value={vendor.accountNo} mono />
        <InfoRow icon={FileText}   label="Payment Terms"   value={vendor.terms} />
        <InfoRow icon={Tag}        label="Code"            value={vendor.code} mono />
        <InfoRow icon={Building2}  label="Contact"         value={vendor.contactName} />
        <InfoRow icon={Mail}       label="Email"           value={vendor.email} />
        <InfoRow icon={Phone}      label="Phone"           value={vendor.phone} />
        <InfoRow icon={Globe}      label="Website"         value={vendor.website} />
        <InfoRow icon={MapPin}     label="Address"         value={addressStr} />

        {Array.isArray(vendor.aliases) && vendor.aliases.length > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 6 }}>ALIASES</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {vendor.aliases.map((a, i) => (
                <span key={i} style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, background: 'var(--brand-08)', color: 'var(--accent-primary)', border: '1px solid var(--brand-20)' }}>
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: Status + meta */}
      <div>
        <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-muted, #6b7280)', letterSpacing: '0.05em', marginBottom: '1rem' }}>STATUS</div>
        <div style={{ padding: '1rem', borderRadius: 10, background: vendor.active ? 'var(--brand-05)' : 'rgba(100,116,139,.06)', border: `1px solid ${vendor.active ? 'var(--brand-20)' : 'rgba(100,116,139,.2)'}`, marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: vendor.active ? 'var(--accent-primary)' : '#64748b', boxShadow: vendor.active ? '0 0 8px var(--brand-40)' : 'none' }} />
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: vendor.active ? 'var(--accent-primary)' : '#64748b' }}>
              {vendor.active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
            {vendor.active ? 'This vendor is active and available for payouts.' : 'This vendor is inactive and hidden from payout flows.'}
          </div>
        </div>

        <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-muted, #6b7280)', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>RECORD INFO</div>
        <InfoRow icon={Hash}   label="Vendor ID"    value={`#${vendor.id}`} mono />
        <InfoRow icon={Clock}  label="Created"      value={fmtDate(vendor.createdAt)} />
        <InfoRow icon={Clock}  label="Last Updated" value={fmtDate(vendor.updatedAt)} />
      </div>
    </div>
  );
}

// ─── Products Tab ─────────────────────────────────────────────────────────────

function ProductsTab({ vendorId }) {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [total,    setTotal]    = useState(0);

  useEffect(() => {
    setLoading(true);
    getVendorProducts(vendorId, { limit: 100 })
      .then(r => { setProducts(r?.data || []); setTotal(r?.total || 0); })
      .catch(() => toast.error('Failed to load products'))
      .finally(() => setLoading(false));
  }, [vendorId]);

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading products…</div>;

  if (products.length === 0) return (
    <div style={{ padding: '3rem', textAlign: 'center' }}>
      <Package size={36} color="var(--text-muted, #6b7280)" style={{ opacity: 0.3, marginBottom: 12 }} />
      <div style={{ color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>No products linked to this vendor</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', opacity: 0.7 }}>Assign this vendor to products in the Product Catalog.</div>
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        {total} product{total !== 1 ? 's' : ''} linked to this vendor
      </div>
      <div style={cardStyle}>
        <div style={{
          display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 80px 80px',
          gap: '0 8px', padding: '0.5rem 1rem',
          borderBottom: '1px solid var(--border-color, #1f2937)',
          fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)',
          letterSpacing: '0.07em', background: 'var(--bg-tertiary, #0f172a)',
        }}>
          <span>PRODUCT</span>
          <span>SKU / BARCODE</span>
          <span>DEPARTMENT</span>
          <span>PRICE</span>
          <span>STATUS</span>
        </div>
        {products.map(p => (
          <div key={p.id} style={{
            display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 80px 80px',
            gap: '0 8px', padding: '0.7rem 1rem',
            alignItems: 'center',
            borderBottom: '1px solid var(--border-color, #1f2937)',
            opacity: p.active ? 1 : 0.5,
            cursor: 'pointer',
          }}
            onClick={() => navigate(`/portal/catalog/edit/${p.id}`)}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.02)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.sku || p.upc || '—'}</div>
            <div style={{ fontSize: '0.75rem' }}>
              {p.department ? (
                <span style={{ padding: '2px 7px', borderRadius: 4, background: (p.department.color || '#475569') + '22', color: p.department.color || '#475569', fontSize: '0.7rem', fontWeight: 700 }}>
                  {p.department.name}
                </span>
              ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>{p.defaultRetailPrice != null ? fmt(p.defaultRetailPrice) : '—'}</div>
            <div>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: p.active ? 'var(--brand-12)' : 'rgba(100,116,139,.1)', color: p.active ? 'var(--accent-primary)' : '#64748b' }}>
                {p.active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Payouts Tab ──────────────────────────────────────────────────────────────

function PayoutsTab({ vendorId }) {
  const [payouts,     setPayouts]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [total,       setTotal]       = useState(0);
  const [totalPaid,   setTotalPaid]   = useState(0);
  const [payoutCount, setPayoutCount] = useState(0);

  useEffect(() => {
    setLoading(true);
    getVendorPayouts(vendorId, { limit: 100 })
      .then(r => {
        setPayouts(r?.data || []);
        setTotal(r?.total || 0);
        setTotalPaid(parseFloat(r?.totalPaid || 0));
        setPayoutCount(r?.payoutCount || 0);
      })
      .catch(() => toast.error('Failed to load payouts'))
      .finally(() => setLoading(false));
  }, [vendorId]);

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading payouts…</div>;

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: '1.5rem' }}>
        <StatCard label="Total Paid Out" value={fmt(totalPaid)}   color="#a855f7" bg="rgba(168,85,247,.08)" icon={DollarSign} />
        <StatCard label="Payout Count"   value={payoutCount}       color="#3b82f6" bg="rgba(59,130,246,.08)" icon={CreditCard} />
      </div>

      {payouts.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center' }}>
          <CreditCard size={36} color="var(--text-muted)" style={{ opacity: 0.3, marginBottom: 12 }} />
          <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>No payouts recorded for this vendor</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', opacity: 0.7, marginTop: 4 }}>Payouts are logged from the POS cash drawer during shifts.</div>
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 120px 100px 100px 1fr',
            gap: '0 8px', padding: '0.5rem 1rem',
            borderBottom: '1px solid var(--border-color, #1f2937)',
            fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)',
            letterSpacing: '0.07em', background: 'var(--bg-tertiary, #0f172a)',
          }}>
            <span>DATE & TIME</span>
            <span>AMOUNT</span>
            <span>TYPE</span>
            <span>SHIFT</span>
            <span>NOTE</span>
          </div>
          {payouts.map(p => (
            <div key={p.id} style={{
              display: 'grid', gridTemplateColumns: '1fr 120px 100px 100px 1fr',
              gap: '0 8px', padding: '0.7rem 1rem', alignItems: 'center',
              borderBottom: '1px solid var(--border-color, #1f2937)',
            }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>{fmtDateTime(p.createdAt)}</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#a855f7' }}>{fmt(p.amount)}</div>
              <div>
                {p.payoutType ? (
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                    background: p.payoutType === 'merchandise' ? 'rgba(16,185,129,.12)' : 'rgba(59,130,246,.12)',
                    color: p.payoutType === 'merchandise' ? '#10b981' : '#3b82f6',
                  }}>
                    {p.payoutType === 'merchandise' ? 'Merchandise' : 'Expense'}
                  </span>
                ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                {p.shift ? `#${p.shift.id.slice(0, 8)}` : '—'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.note || '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Stats Tab ────────────────────────────────────────────────────────────────

function StatsTab({ vendorId }) {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getVendorStats(vendorId)
      .then(r => setStats(r?.data || null))
      .catch(() => toast.error('Failed to load stats'))
      .finally(() => setLoading(false));
  }, [vendorId]);

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading stats…</div>;
  if (!stats)  return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>No stats available.</div>;

  const monthEntries = Object.entries(stats.monthlySpend || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const maxSpend = Math.max(...monthEntries.map(e => e[1]), 1);

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: '2rem' }}>
        <StatCard label="Linked Products" value={stats.productCount}      color="var(--accent-primary)" bg="var(--brand-08)" icon={Package}     />
        <StatCard label="Total Paid Out"  value={fmt(stats.totalPaid)}    color="#a855f7" bg="rgba(168,85,247,.08)" icon={DollarSign}   />
        <StatCard label="Payout Events"   value={stats.payoutCount}       color="#3b82f6" bg="rgba(59,130,246,.08)" icon={CreditCard}   />
      </div>

      {/* Monthly spend bar chart */}
      {monthEntries.length > 0 ? (
        <div style={{ ...cardStyle, padding: '1.25rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '1.25rem' }}>Monthly Payouts</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
            {monthEntries.map(([month, amount]) => {
              const pct = amount / maxSpend;
              const label = month.slice(5); // MM
              const months = ['', 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
              return (
                <div key={month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: '0.65rem', color: '#a855f7', fontWeight: 700 }}>{fmt(amount)}</div>
                  <div style={{ width: '100%', height: Math.max(pct * 80, 4), borderRadius: '4px 4px 0 0', background: 'rgba(168,85,247,.6)', transition: 'height .3s' }} />
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>{months[parseInt(label)] || label}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ ...cardStyle, padding: '2rem', textAlign: 'center' }}>
          <BarChart2 size={32} color="var(--text-muted)" style={{ opacity: 0.3, marginBottom: 10 }} />
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No payout history yet — data will appear after cash payouts are recorded.</div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',  label: 'Overview',  icon: Building2  },
  { id: 'products',  label: 'Products',  icon: Package    },
  { id: 'payouts',   label: 'Payouts',   icon: CreditCard },
  { id: 'stats',     label: 'Stats',     icon: BarChart2  },
];

export default function VendorDetail() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const [vendor,  setVendor]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState('overview');

  useEffect(() => {
    setLoading(true);
    getCatalogVendor(id)
      .then(r => setVendor(r?.data || null))
      .catch((err) => { toast.error(err?.response?.data?.error || 'Failed to load vendor'); navigate('/portal/vendors'); })
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="layout-container">
      <Sidebar />
      <div className="main-content" style={{ padding: '2rem', overflowY: 'auto' }}>

        {/* Back button */}
        <button onClick={() => navigate('/portal/vendors')} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted, #6b7280)', fontSize: '0.8rem', fontWeight: 600,
          marginBottom: '1.25rem', padding: '0.25rem 0',
        }}>
          <ArrowLeft size={14} /> Back to Vendors
        </button>

        {loading ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading vendor…</div>
        ) : !vendor ? (
          <div style={{ padding: '4rem', textAlign: 'center' }}>
            <AlertCircle size={32} color="var(--text-muted)" style={{ marginBottom: 10 }} />
            <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Vendor not found</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: '1.75rem', flexWrap: 'wrap' }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--brand-12)', border: '1px solid var(--brand-20)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Truck size={24} color="var(--accent-primary)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 900, color: 'var(--text-primary, #e2e8f0)' }}>{vendor.name}</h1>
                  {vendor.code && (
                    <span style={{ fontSize: '0.72rem', fontWeight: 800, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,.06)', color: 'var(--text-muted)', letterSpacing: '0.05em', border: '1px solid var(--border-color, #2a2a3a)' }}>
                      {vendor.code}
                    </span>
                  )}
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                    background: vendor.active ? 'var(--brand-12)' : 'rgba(100,116,139,.1)',
                    color: vendor.active ? 'var(--accent-primary)' : '#64748b',
                  }}>
                    {vendor.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 5, flexWrap: 'wrap' }}>
                  {vendor.contactName && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}><Building2 size={11} /> {vendor.contactName}</span>}
                  {vendor.email       && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={11} /> {vendor.email}</span>}
                  {vendor.phone       && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={11} /> {vendor.phone}</span>}
                  {vendor.terms       && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}><FileText size={11} /> {vendor.terms}</span>}
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-color, #1f2937)', marginBottom: '1.5rem' }}>
              {TABS.map(t => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button key={t.id} onClick={() => setTab(t.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '0.625rem 1rem', background: 'none', border: 'none',
                    borderBottom: `2px solid ${active ? 'var(--accent-primary)' : 'transparent'}`,
                    marginBottom: -1, cursor: 'pointer',
                    color: active ? 'var(--accent-primary)' : 'var(--text-muted, #6b7280)',
                    fontWeight: active ? 700 : 500, fontSize: '0.875rem',
                    transition: 'color .15s',
                  }}>
                    <Icon size={14} />
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Tab Content */}
            {tab === 'overview' && <OverviewTab vendor={vendor} onVendorUpdate={setVendor} />}
            {tab === 'products' && <ProductsTab vendorId={vendor.id} />}
            {tab === 'payouts'  && <PayoutsTab  vendorId={vendor.id} />}
            {tab === 'stats'    && <StatsTab    vendorId={vendor.id} />}
          </>
        )}
      </div>
    </div>
  );
}
