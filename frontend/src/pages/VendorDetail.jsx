/**
 * VendorDetail — Full vendor profile with tabbed sections:
 *   Overview · Products · Payouts · Stats
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';

import {
  getCatalogVendor,
  updateCatalogVendor,
  getVendorProducts,
  getVendorPayouts,
  getVendorStats,
  getVendorInvoiceSummary,
  getVendorPayments, createVendorPaymentEntry, updateVendorPaymentEntry,
  getVendorCredits,  createVendorCreditEntry,  updateVendorCreditEntry, deleteVendorCreditEntry,
} from '../services/api';
import './VendorDetail.css';
import {
  Truck, ArrowLeft, Edit2, Check, X, Phone, Mail, Globe,
  Package, DollarSign, TrendingDown, BarChart2, Building2,
  MapPin, Hash, Clock, FileText, Tag, ChevronRight,
  ShoppingBag, CreditCard, AlertCircle,
  Gift, Plus, Trash2,
} from 'lucide-react';

import { fmt$ as fmt, fmtDate, fmtDateTime } from '../utils/formatters';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.sku || p.upc || 'N/A'}</div>
            <div style={{ fontSize: '0.75rem' }}>
              {p.department ? (
                <span style={{ padding: '2px 7px', borderRadius: 4, background: (p.department.color || '#475569') + '22', color: p.department.color || '#475569', fontSize: '0.7rem', fontWeight: 700 }}>
                  {p.department.name}
                </span>
              ) : <span style={{ color: 'var(--text-muted)' }}>N/A</span>}
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>{p.defaultRetailPrice != null ? fmt(p.defaultRetailPrice) : 'N/A'}</div>
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
                ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>N/A</span>}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                {p.shift ? `#${p.shift.id.slice(0, 8)}` : 'N/A'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.note || 'N/A'}
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
  const [invSummary, setInvSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      getVendorStats(vendorId),
      getVendorInvoiceSummary({ vendorId }),
    ]).then(([statsRes, invRes]) => {
      if (statsRes.status === 'fulfilled') setStats(statsRes.value?.data || null);
      else toast.error('Failed to load stats');
      if (invRes.status === 'fulfilled') setInvSummary(invRes.value || null);
    }).finally(() => setLoading(false));
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

      {/* Invoice-based vendor cost (purchases vs credits) */}
      {invSummary && (invSummary.purchases?.count > 0 || invSummary.credits?.count > 0) && (
        <div style={{ ...cardStyle, padding: '1.25rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
              Invoice-Based Vendor Cost
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {invSummary.from} → {invSummary.to}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <StatCard
              label={`Purchase Invoices (${invSummary.purchases.count})`}
              value={fmt(invSummary.purchases.total)}
              color="#059669"
              bg="rgba(5, 150, 105, 0.08)"
              icon={Package}
            />
            <StatCard
              label={`Credit Memos (${invSummary.credits.count})`}
              value={`−${fmt(invSummary.credits.total)}`}
              color="#dc2626"
              bg="rgba(220, 38, 38, 0.08)"
              icon={DollarSign}
            />
            <StatCard
              label="Net Cost (P&L)"
              value={fmt(invSummary.netCost)}
              color="var(--accent-primary)"
              bg="var(--brand-08)"
              icon={BarChart2}
            />
          </div>
          {invSummary.recentCredits?.length > 0 && (
            <div style={{ marginTop: '1.25rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                Recent Credits
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {invSummary.recentCredits.map((cr) => (
                  <div key={cr.id} style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: '0.78rem', padding: '4px 8px',
                    background: 'rgba(220, 38, 38, 0.04)', borderRadius: 4,
                  }}>
                    <span>
                      {cr.invoiceNumber ? `#${cr.invoiceNumber}` : cr.id.slice(0, 8)}
                      {cr.invoiceDate && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                        {new Date(cr.invoiceDate).toLocaleDateString()}
                      </span>}
                      {cr.linkedInvoiceId && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                        → {cr.linkedInvoiceId}
                      </span>}
                    </span>
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>−{fmt(cr.totalInvoiceAmount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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

// ─── Payouts & Credits Tab ─────────────────────────────────────────────────
// Combined view: back-office VendorPayment entries (cash going OUT to the
// vendor), back-office VendorCredit entries (free cases / mix-match / damaged
// allowances — value coming IN without charge), and POS-shift CashPayout
// entries (reference only — those originate at the register).
//
// Add buttons live in the two back-office sections. Shift payouts are
// read-only here (cashier creates them during a shift).

function PayoutsCreditsTab({ vendorId, vendorName }) {
  const confirm = useConfirm();
  const vendor = { id: vendorId, name: vendorName };
  const [payments, setPayments] = useState([]);
  const [paymentsSummary, setPaymentsSummary] = useState({ total: 0, count: 0 });
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [editingPayment, setEditingPayment] = useState(null);

  const [credits, setCredits] = useState([]);
  const [creditsSummary, setCreditsSummary] = useState({ total: 0, monthTotal: 0, count: 0, totalCases: 0 });
  const [showCreditForm, setShowCreditForm] = useState(false);
  const [editingCredit, setEditingCredit] = useState(null);

  const [shiftPayouts, setShiftPayouts] = useState([]);
  const [shiftSummary, setShiftSummary] = useState({ totalPaid: 0, count: 0 });

  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [payRes, credRes, shiftRes] = await Promise.allSettled([
        getVendorPayments({ vendorId, limit: 200 }),
        getVendorCredits({ vendorId, limit: 200 }),
        getVendorPayouts(vendorId, { limit: 100 }),
      ]);
      if (payRes.status === 'fulfilled') {
        setPayments(payRes.value?.payments || []);
        setPaymentsSummary(payRes.value?.summary || { total: 0, count: 0 });
      }
      if (credRes.status === 'fulfilled') {
        setCredits(credRes.value?.credits || []);
        setCreditsSummary(credRes.value?.summary || { total: 0, monthTotal: 0, count: 0, totalCases: 0 });
      }
      if (shiftRes.status === 'fulfilled') {
        setShiftPayouts(shiftRes.value?.data || []);
        setShiftSummary({
          totalPaid: parseFloat(shiftRes.value?.totalPaid || 0),
          count:     shiftRes.value?.payoutCount || 0,
        });
      }
    } catch {
      toast.error('Failed to load payments & credits');
    } finally {
      setLoading(false);
    }
  }, [vendorId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: '2rem' }}>
        <StatCard label="Back-Office Payments" value={fmt(paymentsSummary.total)}    color="#a855f7" bg="rgba(168,85,247,.08)" icon={DollarSign} />
        <StatCard label="Credits (All Time)"   value={fmt(creditsSummary.total)}     color="#10b981" bg="rgba(16,185,129,.08)" icon={Gift} />
        <StatCard label="Credits This Month"   value={fmt(creditsSummary.monthTotal)} color="#3b82f6" bg="rgba(59,130,246,.08)" icon={Gift} />
        <StatCard label="Free Cases Received"  value={creditsSummary.totalCases || 0} color="#f59e0b" bg="rgba(245,158,11,.08)" icon={Package} />
      </div>

      <PCSectionHeader
        title="Back-Office Payments"
        subtitle="Cash going OUT to this vendor — invoices, reimbursements, etc."
        count={paymentsSummary.count}
        onAdd={() => { setEditingPayment(null); setShowPaymentForm(true); }}
        addLabel="Add Payment"
        accent="#a855f7"
      />
      {payments.length === 0 ? (
        <PCEmptyRow icon={DollarSign} text="No back-office payments recorded for this vendor" />
      ) : (
        <div style={{ ...cardStyle, marginBottom: '2rem' }}>
          <PCRowHeader columns={['DATE', 'AMOUNT', 'TYPE', 'TENDER', 'NOTES', '']} widths="1fr 110px 110px 100px 1fr 80px" />
          {payments.map(p => (
            <div key={p.id} style={pcRowStyle('1fr 110px 110px 100px 1fr 80px')}>
              <div style={{ fontSize: '0.8rem' }}>{fmtDate(p.paymentDate)}</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#a855f7' }}>{fmt(p.amount)}</div>
              <PCTypeBadge type={p.paymentType} />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.tenderMethod || 'cash'}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.notes || '—'}</div>
              <button
                onClick={() => { setEditingPayment(p); setShowPaymentForm(true); }}
                style={pcIconBtnStyle}
                title="Edit payment"
              ><Edit2 size={13} /></button>
            </div>
          ))}
        </div>
      )}

      <PCSectionHeader
        title="Back-Office Credits"
        subtitle="Free cases, mix-and-match bonuses, damaged allowances — value coming IN without charge."
        count={creditsSummary.count}
        onAdd={() => { setEditingCredit(null); setShowCreditForm(true); }}
        addLabel="Add Credit"
        accent="#10b981"
      />
      {credits.length === 0 ? (
        <PCEmptyRow icon={Gift} text="No credits recorded for this vendor" />
      ) : (
        <div style={{ ...cardStyle, marginBottom: '2rem' }}>
          <PCRowHeader columns={['DATE', 'AMOUNT', 'TYPE', 'CASES', 'REASON', '']} widths="1fr 110px 130px 70px 1fr 110px" />
          {credits.map(c => (
            <div key={c.id} style={pcRowStyle('1fr 110px 130px 70px 1fr 110px')}>
              <div style={{ fontSize: '0.8rem' }}>{fmtDate(c.creditDate)}</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#10b981' }}>{fmt(c.amount)}</div>
              <PCCreditTypeBadge type={c.creditType} />
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>{c.casesReceived ?? '—'}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.reason || c.productRef || '—'}
              </div>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <button onClick={() => { setEditingCredit(c); setShowCreditForm(true); }} style={pcIconBtnStyle} title="Edit credit"><Edit2 size={13} /></button>
                <button onClick={async () => {
                  if (!await confirm({
                    title: 'Delete credit?',
                    message: `Delete credit of ${fmt(c.amount)} from ${fmtDate(c.creditDate)}?`,
                    confirmLabel: 'Delete',
                    danger: true,
                  })) return;
                  try { await deleteVendorCreditEntry(c.id); toast.success('Credit removed'); load(); }
                  catch (err) { toast.error(err?.response?.data?.error || 'Delete failed'); }
                }} style={{ ...pcIconBtnStyle, color: '#ef4444' }} title="Delete credit"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <PCSectionHeader
        title="POS-Shift Payouts"
        subtitle="Cash-drawer payouts logged by cashiers during shifts. Read-only here — these originate at the register."
        count={shiftSummary.count}
        muted
      />
      {shiftPayouts.length === 0 ? (
        <PCEmptyRow icon={CreditCard} text="No POS-shift payouts recorded for this vendor" />
      ) : (
        <div style={cardStyle}>
          <PCRowHeader columns={['DATE & TIME', 'AMOUNT', 'TYPE', 'SHIFT', 'NOTE']} widths="1fr 110px 110px 100px 1fr" />
          {shiftPayouts.map(p => (
            <div key={p.id} style={pcRowStyle('1fr 110px 110px 100px 1fr')}>
              <div style={{ fontSize: '0.8rem' }}>{fmtDateTime(p.createdAt)}</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#a855f7' }}>{fmt(p.amount)}</div>
              <PCTypeBadge type={p.payoutType} />
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.shift ? `#${p.shift.id.slice(0,8)}` : '—'}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.note || '—'}</div>
            </div>
          ))}
        </div>
      )}

      {showPaymentForm && (
        <VendorPaymentForm
          initial={editingPayment}
          vendor={vendor}
          onClose={() => { setShowPaymentForm(false); setEditingPayment(null); }}
          onSaved={() => { setShowPaymentForm(false); setEditingPayment(null); load(); }}
        />
      )}
      {showCreditForm && (
        <VendorCreditForm
          initial={editingCredit}
          vendor={vendor}
          onClose={() => { setShowCreditForm(false); setEditingCredit(null); }}
          onSaved={() => { setShowCreditForm(false); setEditingCredit(null); load(); }}
        />
      )}
    </div>
  );
}

function PCSectionHeader({ title, subtitle, count, onAdd, addLabel, accent, muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '0.75rem', marginTop: '0.5rem' }}>
      <div>
        <div style={{ fontSize: '1rem', fontWeight: 800, color: muted ? 'var(--text-muted)' : 'var(--text-primary)' }}>
          {title} {count != null && <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginLeft: 6 }}>({count})</span>}
        </div>
        {subtitle && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      {onAdd && (
        <button
          onClick={onAdd}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '0.45rem 0.9rem', borderRadius: 8,
            background: accent || 'var(--accent-primary)', color: '#fff',
            border: 'none', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
          }}
        >
          <Plus size={14} /> {addLabel || 'Add'}
        </button>
      )}
    </div>
  );
}

function PCRowHeader({ columns, widths }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: widths, gap: '0 8px',
      padding: '0.5rem 1rem', borderBottom: '1px solid var(--border-color, #1f2937)',
      fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)',
      letterSpacing: '0.07em', background: 'var(--bg-tertiary, #0f172a)',
    }}>
      {columns.map((c, i) => <span key={i}>{c}</span>)}
    </div>
  );
}

const pcRowStyle = (widths) => ({
  display: 'grid', gridTemplateColumns: widths, gap: '0 8px',
  padding: '0.6rem 1rem', alignItems: 'center',
  borderBottom: '1px solid var(--border-color, #1f2937)',
});

const pcIconBtnStyle = {
  width: 28, height: 28, borderRadius: 6,
  background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
  color: 'var(--text-muted)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

function PCEmptyRow({ icon: Icon, text }) {
  return (
    <div style={{ padding: '2.5rem', textAlign: 'center', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 12, marginBottom: '2rem' }}>
      <Icon size={32} color="var(--text-muted)" style={{ opacity: 0.3, marginBottom: 10 }} />
      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 500 }}>{text}</div>
    </div>
  );
}

function PCTypeBadge({ type }) {
  if (!type) return <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>;
  const isMerch = type === 'merchandise';
  return (
    <span style={{
      fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: 4,
      background: isMerch ? 'rgba(16,185,129,.12)' : 'rgba(59,130,246,.12)',
      color: isMerch ? '#10b981' : '#3b82f6',
    }}>{isMerch ? 'Merchandise' : 'Expense'}</span>
  );
}

const PC_CREDIT_LABELS = {
  free_case:      { label: 'Free Case',      color: '#10b981', bg: 'rgba(16,185,129,.12)' },
  mix_match:      { label: 'Mix & Match',    color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
  damaged_return: { label: 'Damaged Return', color: '#ef4444', bg: 'rgba(239,68,68,.12)'  },
  adjustment:     { label: 'Adjustment',     color: '#3b82f6', bg: 'rgba(59,130,246,.12)' },
  other:          { label: 'Other',          color: '#6b7280', bg: 'rgba(107,114,128,.12)'},
};

function PCCreditTypeBadge({ type }) {
  const cfg = PC_CREDIT_LABELS[type] || PC_CREDIT_LABELS.other;
  return (
    <span style={{
      fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: 4,
      background: cfg.bg, color: cfg.color,
    }}>{cfg.label}</span>
  );
}

// ─── VendorPaymentForm modal ───────────────────────────────────────────────

function VendorPaymentForm({ initial, vendor, onClose, onSaved }) {
  const [amount,       setAmount]       = useState(initial?.amount != null ? String(initial.amount) : '');
  const [paymentType,  setPaymentType]  = useState(initial?.paymentType || 'expense');
  const [tenderMethod, setTenderMethod] = useState(initial?.tenderMethod || 'cash');
  const [notes,        setNotes]        = useState(initial?.notes || '');
  const [paymentDate,  setPaymentDate]  = useState(
    initial?.paymentDate ? new Date(initial.paymentDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) { toast.error('Enter a valid amount'); return; }
    setSaving(true);
    try {
      const payload = {
        vendorId:     vendor.id,
        vendorName:   vendor.name,
        amount:       parseFloat(amount),
        paymentType,
        tenderMethod,
        notes:        notes.trim() || null,
        paymentDate:  paymentDate || undefined,
      };
      if (initial) await updateVendorPaymentEntry(initial.id, payload);
      else         await createVendorPaymentEntry(payload);
      toast.success(initial ? 'Payment updated' : 'Payment added');
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={pcModalBackdropStyle} onClick={onClose}>
      <div style={pcModalCardStyle} onClick={e => e.stopPropagation()}>
        <div style={pcModalHeaderStyle}>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{initial ? 'Edit Payment' : 'Add Payment'}</div>
          <button onClick={onClose} style={pcIconBtnStyle}><X size={14} /></button>
        </div>
        <form onSubmit={handleSave} style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Amount ($)</label>
            <input style={inputStyle} type="number" step="0.01" min="0" value={amount}
              onChange={e => setAmount(e.target.value)} autoFocus required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Payment Type</label>
              <select style={inputStyle} value={paymentType} onChange={e => setPaymentType(e.target.value)}>
                <option value="expense">Expense</option>
                <option value="merchandise">Merchandise</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Tender Method</label>
              <select style={inputStyle} value={tenderMethod} onChange={e => setTenderMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="credit_card">Credit Card</option>
                <option value="interac">Interac e-Transfer</option>
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Payment Date</label>
            <input style={inputStyle} type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
              value={notes} onChange={e => setNotes(e.target.value)} placeholder="Invoice #, reason, etc." />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={onClose} style={pcSecondaryBtnStyle}>Cancel</button>
            <button type="submit" disabled={saving} style={pcPrimaryBtnStyle('#a855f7')}>
              {saving ? 'Saving…' : (initial ? 'Save Changes' : 'Add Payment')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── VendorCreditForm modal ────────────────────────────────────────────────

function VendorCreditForm({ initial, vendor, onClose, onSaved }) {
  const [amount,         setAmount]         = useState(initial?.amount != null ? String(initial.amount) : '');
  const [creditType,     setCreditType]     = useState(initial?.creditType || 'free_case');
  const [casesReceived,  setCasesReceived]  = useState(initial?.casesReceived != null ? String(initial.casesReceived) : '');
  const [productRef,     setProductRef]     = useState(initial?.productRef || '');
  const [reason,         setReason]         = useState(initial?.reason || '');
  const [notes,          setNotes]          = useState(initial?.notes || '');
  const [creditDate,     setCreditDate]     = useState(
    initial?.creditDate ? new Date(initial.creditDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) { toast.error('Enter a valid credit amount (retail/wholesale value of the free goods)'); return; }
    setSaving(true);
    try {
      const payload = {
        vendorId:      vendor.id,
        vendorName:    vendor.name,
        amount:        parseFloat(amount),
        creditType,
        casesReceived: casesReceived !== '' ? parseInt(casesReceived) : null,
        productRef:    productRef.trim() || null,
        reason:        reason.trim() || null,
        notes:         notes.trim() || null,
        creditDate:    creditDate || undefined,
      };
      if (initial) await updateVendorCreditEntry(initial.id, payload);
      else         await createVendorCreditEntry(payload);
      toast.success(initial ? 'Credit updated' : 'Credit added');
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={pcModalBackdropStyle} onClick={onClose}>
      <div style={pcModalCardStyle} onClick={e => e.stopPropagation()}>
        <div style={pcModalHeaderStyle}>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{initial ? 'Edit Credit' : 'Add Credit'}</div>
          <button onClick={onClose} style={pcIconBtnStyle}><X size={14} /></button>
        </div>
        <form onSubmit={handleSave} style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Credit Value ($)</label>
              <input style={inputStyle} type="number" step="0.01" min="0" value={amount}
                onChange={e => setAmount(e.target.value)} autoFocus required
                placeholder="Retail/wholesale value" />
            </div>
            <div>
              <label style={labelStyle}>Credit Type</label>
              <select style={inputStyle} value={creditType} onChange={e => setCreditType(e.target.value)}>
                <option value="free_case">Free Case</option>
                <option value="mix_match">Mix & Match</option>
                <option value="damaged_return">Damaged Return</option>
                <option value="adjustment">Adjustment</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Cases Received (optional)</label>
              <input style={inputStyle} type="number" step="1" min="0" value={casesReceived}
                onChange={e => setCasesReceived(e.target.value)} placeholder="e.g. 1" />
            </div>
            <div>
              <label style={labelStyle}>Credit Date</label>
              <input style={inputStyle} type="date" value={creditDate}
                onChange={e => setCreditDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Product Reference (optional)</label>
            <input style={inputStyle} value={productRef} onChange={e => setProductRef(e.target.value)}
              placeholder="e.g. Coke 12oz or UPC 0001234567890" />
          </div>
          <div>
            <label style={labelStyle}>Reason</label>
            <input style={inputStyle} value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. Buy 6 get 1 free promo" />
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
              value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional context" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={onClose} style={pcSecondaryBtnStyle}>Cancel</button>
            <button type="submit" disabled={saving} style={pcPrimaryBtnStyle('#10b981')}>
              {saving ? 'Saving…' : (initial ? 'Save Changes' : 'Add Credit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const pcModalBackdropStyle = {
  position: 'fixed', inset: 0, zIndex: 200,
  background: 'var(--modal-overlay, rgba(0,0,0,.55))',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '1.5rem',
};
const pcModalCardStyle = {
  background: 'var(--bg-secondary, #111827)',
  border: '1px solid var(--border-color, #1f2937)',
  borderRadius: 14, maxWidth: 520, width: '100%',
  boxShadow: 'var(--modal-shadow, 0 24px 64px rgba(0,0,0,.4))',
  maxHeight: '90vh', overflowY: 'auto',
};
const pcModalHeaderStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '0.9rem 1.25rem', borderBottom: '1px solid var(--border-color, #1f2937)',
};
const pcSecondaryBtnStyle = {
  padding: '0.55rem 1rem', borderRadius: 8,
  background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
  color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem',
};
const pcPrimaryBtnStyle = (accent) => ({
  padding: '0.55rem 1.15rem', borderRadius: 8,
  background: accent, border: 'none', color: '#fff',
  cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem',
});

// ─── Main Page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',  label: 'Overview',           icon: Building2  },
  { id: 'products',  label: 'Products',           icon: Package    },
  { id: 'payouts',   label: 'Payouts & Credits',  icon: CreditCard },
  { id: 'stats',     label: 'Stats',              icon: BarChart2  },
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
      <div className="p-page">

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
            <div className="p-header">
              <div className="p-header-left">
                <div className="p-header-icon">
                  <Truck size={22} />
                </div>
                <div>
                  <h1 className="p-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {vendor.name}
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
                  </h1>
                  <p className="p-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    {vendor.contactName && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Building2 size={11} /> {vendor.contactName}</span>}
                    {vendor.email       && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={11} /> {vendor.email}</span>}
                    {vendor.phone       && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={11} /> {vendor.phone}</span>}
                    {vendor.terms       && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FileText size={11} /> {vendor.terms}</span>}
                  </p>
                </div>
              </div>
              <div className="p-header-actions"></div>
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
            {tab === 'payouts'  && <PayoutsCreditsTab vendorId={vendor.id} vendorName={vendor.name} />}
            {tab === 'stats'    && <StatsTab    vendorId={vendor.id} />}
          </>
        )}
      </div>
  );
}
