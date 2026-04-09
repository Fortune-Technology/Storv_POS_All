/**
 * Customers.jsx — Back-office customer management
 *
 * Features:
 *   • Paginated list with search (name / phone / email / card)
 *   • Add customer modal (full form)
 *   • Edit customer modal (same form, pre-filled)
 *   • Soft-delete with confirmation
 *   • View customer profile with points history
 *
 * CSS: ./Customers.css  (cust- prefix)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from '../components/Sidebar';
import './Customers.css';
import {
  Search, User, Phone, Mail, Award, CreditCard, DollarSign,
  RefreshCw, ChevronLeft, ChevronRight, X, Plus, Edit2, Trash2,
  AlertCircle, Check, AlertTriangle,
  UserCheck,
} from 'lucide-react';
import { toast } from 'react-toastify';
import {
  getCustomers, getCustomerById,
  createCustomer, updateCustomer, deleteCustomer,
} from '../services/api';

/* ── Formatters ───────────────────────────────────────────────────────────── */
const fmt   = (v) => v != null ? `$${parseFloat(v).toFixed(2)}` : '—';
const fmtPc = (v) => v != null ? `${parseFloat(v * 100).toFixed(1)}%` : '—';
const fmtDt = (v) => { try { return v ? new Date(v).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '—'; } catch { return '—'; } };
const fmtTs = (v) => { try { return v ? new Date(v).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'; } catch { return '—'; } };

const displayName = (c) => {
  if (c.name) return c.name;
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
};
const initial = (c) => displayName(c).charAt(0).toUpperCase() || '?';

/* ── Empty form state ─────────────────────────────────────────────────────── */
const EMPTY_FORM = {
  firstName: '', lastName: '', email: '', phone: '',
  cardNo: '', loyaltyPoints: '', discount: '', balance: '',
  balanceLimit: '', instoreChargeEnabled: false,
  birthDate: '', expirationDate: '',
};

/* ── CustomerForm modal (create + edit) ───────────────────────────────────── */
function CustomerForm({ initial: init, onSave, onClose, saving }) {
  const [form, setForm] = useState(() => init ? {
    firstName:            init.firstName        ?? '',
    lastName:             init.lastName         ?? '',
    email:                init.email            ?? '',
    phone:                init.phone            ?? '',
    cardNo:               init.cardNo           ?? '',
    loyaltyPoints:        String(init.loyaltyPoints ?? 0),
    discount:             init.discount != null ? String(parseFloat(init.discount) * 100) : '',
    balance:              init.balance  != null ? String(parseFloat(init.balance))  : '',
    balanceLimit:         init.balanceLimit != null ? String(parseFloat(init.balanceLimit)) : '',
    instoreChargeEnabled: init.instoreChargeEnabled ?? false,
    birthDate:            init.birthDate ? init.birthDate.slice(0, 10) : '',
    expirationDate:       init.expirationDate ? init.expirationDate.slice(0, 10) : '',
  } : { ...EMPTY_FORM });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.firstName.trim() && !form.lastName.trim() && !form.phone.trim()) {
      toast.error('Please enter at least a name or phone number');
      return;
    }
    const payload = {
      firstName:            form.firstName.trim() || undefined,
      lastName:             form.lastName.trim()  || undefined,
      email:                form.email.trim()     || undefined,
      phone:                form.phone.trim()     || undefined,
      cardNo:               form.cardNo.trim()    || undefined,
      loyaltyPoints:        form.loyaltyPoints !== '' ? parseInt(form.loyaltyPoints) : 0,
      // discount stored as decimal (e.g. 0.05 = 5%)
      discount:             form.discount !== '' ? parseFloat(form.discount) / 100 : null,
      balance:              form.balance     !== '' ? parseFloat(form.balance)     : null,
      balanceLimit:         form.balanceLimit !== '' ? parseFloat(form.balanceLimit) : null,
      instoreChargeEnabled: form.instoreChargeEnabled,
      birthDate:            form.birthDate       || undefined,
      expirationDate:       form.expirationDate  || undefined,
    };
    onSave(payload);
  };

  return (
    <div className="cust-overlay" onClick={onClose}>
      <div className="cust-modal" onClick={e => e.stopPropagation()}>
        <div className="cust-modal-header">
          <h2 className="cust-modal-title">{init ? 'Edit Customer' : 'Add Customer'}</h2>
          <button className="cust-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="cust-form">
          {/* Name row */}
          <div className="cust-form-row">
            <label className="cust-label">First Name
              <input className="cust-input" value={form.firstName} onChange={e => set('firstName', e.target.value)} placeholder="John" />
            </label>
            <label className="cust-label">Last Name
              <input className="cust-input" value={form.lastName} onChange={e => set('lastName', e.target.value)} placeholder="Smith" />
            </label>
          </div>

          {/* Contact row */}
          <div className="cust-form-row">
            <label className="cust-label">Phone
              <input className="cust-input" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="555-000-1234" type="tel" />
            </label>
            <label className="cust-label">Email
              <input className="cust-input" value={form.email} onChange={e => set('email', e.target.value)} placeholder="john@example.com" type="email" />
            </label>
          </div>

          {/* Card + points */}
          <div className="cust-form-row">
            <label className="cust-label">Card Number
              <input className="cust-input" value={form.cardNo} onChange={e => set('cardNo', e.target.value)} placeholder="Loyalty card #" />
            </label>
            <label className="cust-label">Loyalty Points
              <input className="cust-input" value={form.loyaltyPoints} onChange={e => set('loyaltyPoints', e.target.value)} type="number" min="0" step="1" placeholder="0" />
            </label>
          </div>

          {/* Financial row */}
          <div className="cust-form-row">
            <label className="cust-label">Discount (%)
              <input className="cust-input" value={form.discount} onChange={e => set('discount', e.target.value)} type="number" min="0" max="100" step="0.1" placeholder="e.g. 5" />
            </label>
            <label className="cust-label">Balance ($)
              <input className="cust-input" value={form.balance} onChange={e => set('balance', e.target.value)} type="number" step="0.01" placeholder="0.00" />
            </label>
            <label className="cust-label">Balance Limit ($)
              <input className="cust-input" value={form.balanceLimit} onChange={e => set('balanceLimit', e.target.value)} type="number" step="0.01" placeholder="0.00" />
            </label>
          </div>

          {/* Dates */}
          <div className="cust-form-row">
            <label className="cust-label">Birth Date
              <input className="cust-input" value={form.birthDate} onChange={e => set('birthDate', e.target.value)} type="date" />
            </label>
            <label className="cust-label">Expiration Date
              <input className="cust-input" value={form.expirationDate} onChange={e => set('expirationDate', e.target.value)} type="date" />
            </label>
          </div>

          {/* In-store charge toggle */}
          <div className="cust-form-toggle-row">
            <span className="cust-label-text">In-Store Charge Account</span>
            <button
              type="button"
              className={`cust-toggle ${form.instoreChargeEnabled ? 'on' : ''}`}
              onClick={() => set('instoreChargeEnabled', !form.instoreChargeEnabled)}
            >
              <span className="cust-toggle-knob" />
            </button>
            <span className="cust-toggle-label">{form.instoreChargeEnabled ? 'Enabled' : 'Disabled'}</span>
          </div>

          <div className="cust-modal-footer">
            <button type="button" className="cust-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="cust-btn cust-btn-primary" disabled={saving}>
              {saving ? <RefreshCw size={14} className="cust-spin" /> : <Check size={14} />}
              {saving ? 'Saving…' : init ? 'Save Changes' : 'Add Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Profile modal (view-only) ────────────────────────────────────────────── */
function CustomerProfile({ customer, onClose, onEdit }) {
  return (
    <div className="cust-overlay" onClick={onClose}>
      <div className="cust-modal cust-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="cust-modal-header">
          <div className="cust-profile-hero-name">
            <div className="cust-avatar cust-avatar-lg">{initial(customer)}</div>
            <div>
              <h2 className="cust-modal-title">{displayName(customer)}</h2>
              <div className="cust-profile-tags">
                {customer.instoreChargeEnabled && <span className="cust-tag cust-tag-green">Charge Account</span>}
                {customer.posCustomerId        && <span className="cust-tag cust-tag-blue">POS Linked</span>}
                {customer.cardNo               && <span className="cust-tag cust-tag-amber">Card Holder</span>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="cust-btn cust-btn-sm" onClick={() => onEdit(customer)}>
              <Edit2 size={13} /> Edit
            </button>
            <button className="cust-icon-btn" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="cust-kpi-row">
          <div className="cust-kpi-card">
            <Award size={18} style={{ color: '#f59e0b' }} />
            <div>
              <div className="cust-kpi-label">Loyalty Points</div>
              <div className="cust-kpi-value" style={{ color: '#f59e0b' }}>{(customer.loyaltyPoints || 0).toLocaleString()}</div>
            </div>
          </div>
          <div className="cust-kpi-card">
            <DollarSign size={18} style={{ color: '#10b981' }} />
            <div>
              <div className="cust-kpi-label">Discount</div>
              <div className="cust-kpi-value" style={{ color: '#10b981' }}>{fmtPc(customer.discount)}</div>
            </div>
          </div>
          <div className="cust-kpi-card">
            <CreditCard size={18} style={{ color: '#3b82f6' }} />
            <div>
              <div className="cust-kpi-label">Balance</div>
              <div className="cust-kpi-value" style={{ color: '#3b82f6' }}>{fmt(customer.balance)}</div>
            </div>
          </div>
          <div className="cust-kpi-card">
            <CreditCard size={18} style={{ color: '#8b5cf6' }} />
            <div>
              <div className="cust-kpi-label">Balance Limit</div>
              <div className="cust-kpi-value" style={{ color: '#8b5cf6' }}>{fmt(customer.balanceLimit)}</div>
            </div>
          </div>
        </div>

        {/* Two-col detail */}
        <div className="cust-profile-grid">
          {/* Contact */}
          <div>
            <div className="cust-section-title"><User size={14} /> Contact & Personal</div>
            <div className="cust-detail-list">
              <div className="cust-detail-row"><span>Phone</span><span>{customer.phone || '—'}</span></div>
              <div className="cust-detail-row"><span>Email</span><span>{customer.email || '—'}</span></div>
              <div className="cust-detail-row"><span>Card #</span><span className="cust-mono">{customer.cardNo || '—'}</span></div>
              <div className="cust-detail-row"><span>Birth Date</span><span>{fmtDt(customer.birthDate)}</span></div>
              <div className="cust-detail-row"><span>Expiry</span><span>{fmtDt(customer.expirationDate)}</span></div>
            </div>
          </div>
          {/* Account */}
          <div>
            <div className="cust-section-title"><UserCheck size={14} /> Account Details</div>
            <div className="cust-detail-list">
              <div className="cust-detail-row"><span>In-Store Charge</span>
                <span style={{ color: customer.instoreChargeEnabled ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                  {customer.instoreChargeEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="cust-detail-row"><span>POS Customer ID</span><span className="cust-muted">{customer.posCustomerId || '—'}</span></div>
              <div className="cust-detail-row"><span>Status</span>
                <span style={{ color: customer.deleted ? '#ef4444' : '#10b981', fontWeight: 700 }}>
                  {customer.deleted ? 'Deleted' : 'Active'}
                </span>
              </div>
              <div className="cust-detail-row"><span>Created</span><span>{fmtTs(customer.createdAt)}</span></div>
              <div className="cust-detail-row"><span>Last Updated</span><span>{fmtTs(customer.updatedAt)}</span></div>
            </div>
          </div>
        </div>

        {/* Points history */}
        {Array.isArray(customer.pointsHistory) && customer.pointsHistory.length > 0 && (
          <div style={{ marginTop: '1.25rem' }}>
            <div className="cust-section-title"><Award size={14} /> Points History</div>
            <div className="cust-points-list">
              {customer.pointsHistory.map((h, i) => (
                <div key={i} className="cust-points-row">
                  <div>
                    <div className="cust-points-reason">{h.reason || 'Transaction'}</div>
                    <div className="cust-muted" style={{ fontSize: '0.7rem' }}>{fmtTs(h.date)}</div>
                  </div>
                  <span className={`cust-points-badge ${(h.amount || h.points) > 0 ? 'pos' : 'neg'}`}>
                    {(h.amount || h.points) > 0 ? '+' : ''}{h.amount ?? h.points} pts
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Delete confirmation ──────────────────────────────────────────────────── */
function DeleteConfirm({ customer, onConfirm, onClose, saving }) {
  return (
    <div className="cust-overlay" onClick={onClose}>
      <div className="cust-modal cust-modal-sm" onClick={e => e.stopPropagation()}>
        <div className="cust-modal-header">
          <h2 className="cust-modal-title">Delete Customer</h2>
          <button className="cust-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: '1.25rem 1.5rem' }}>
          <div className="cust-delete-warn">
            <AlertTriangle size={20} style={{ color: '#f59e0b', flexShrink: 0 }} />
            <p>Are you sure you want to delete <strong>{displayName(customer)}</strong>? This action can be undone by contacting support.</p>
          </div>
          <div className="cust-modal-footer" style={{ marginTop: '1.25rem' }}>
            <button className="cust-btn" onClick={onClose}>Cancel</button>
            <button className="cust-btn cust-btn-danger" onClick={onConfirm} disabled={saving}>
              {saving ? <RefreshCw size={14} className="cust-spin" /> : <Trash2 size={14} />}
              {saving ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function Customers() {
  const [customers,   setCustomers]   = useState([]);
  const [total,       setTotal]       = useState(0);
  const [totalPages,  setTotalPages]  = useState(1);
  const [page,        setPage]        = useState(1);
  const [search,      setSearch]      = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);

  // Modals
  const [formMode,    setFormMode]    = useState(null); // null | 'create' | 'edit'
  const [editTarget,  setEditTarget]  = useState(null);
  const [viewTarget,  setViewTarget]  = useState(null);
  const [deleteTarget,setDeleteTarget]= useState(null);
  const [saving,      setSaving]      = useState(false);

  const LIMIT = 20;
  const searchRef = useRef(null);

  /* ── Load ────────────────────────────────────────────────────────────────── */
  const load = useCallback(async (pg = page, q = search) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCustomers({ q, page: pg, limit: LIMIT });
      setCustomers(res.customers || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { load(page, search); }, [page]); // eslint-disable-line

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(1, search); }, 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line

  /* ── CRUD handlers ───────────────────────────────────────────────────────── */
  const handleCreate = async (data) => {
    setSaving(true);
    try {
      await createCustomer(data);
      toast.success('Customer added');
      setFormMode(null);
      load(1, search);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to create customer');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (data) => {
    setSaving(true);
    try {
      const updated = await updateCustomer(editTarget.id, data);
      toast.success('Customer updated');
      setFormMode(null);
      setEditTarget(null);
      // Refresh view modal if open
      if (viewTarget?.id === editTarget.id) setViewTarget(updated);
      load(page, search);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update customer');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await deleteCustomer(deleteTarget.id);
      toast.success('Customer deleted');
      setDeleteTarget(null);
      if (viewTarget?.id === deleteTarget.id) setViewTarget(null);
      load(page, search);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to delete customer');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (c) => {
    setEditTarget(c);
    setFormMode('edit');
    setViewTarget(null);
  };

  /* ── Render ──────────────────────────────────────────────────────────────── */
  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content cust-page">

        {/* Header */}
        <div className="cust-header">
          <div>
            <h1 className="cust-title">Customers</h1>
            <p className="cust-subtitle">{total.toLocaleString()} customers</p>
          </div>
          <div className="cust-header-actions">
            <button className="cust-btn" onClick={() => load(page, search)} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'cust-spin' : ''} />
              Refresh
            </button>
            <button className="cust-btn cust-btn-primary" onClick={() => setFormMode('create')}>
              <Plus size={14} /> Add Customer
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="cust-search-bar">
          <Search size={14} className="cust-search-icon" />
          <input
            ref={searchRef}
            className="cust-search-input"
            placeholder="Search by name, phone, email or card number…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="cust-search-clear" onClick={() => setSearch('')}>
              <X size={13} />
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="cust-error">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* Table */}
        <div className="cust-table-card">
          <div className="cust-table-header">
            <span>Customer</span>
            <span>Contact</span>
            <span>Loyalty</span>
            <span>Discount</span>
            <span>Balance</span>
            <span>Card #</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
          </div>

          {loading && customers.length === 0 ? (
            <div className="cust-empty">
              <RefreshCw size={26} className="cust-spin" style={{ opacity: 0.3 }} />
              <span>Loading…</span>
            </div>
          ) : customers.length === 0 ? (
            <div className="cust-empty">
              <User size={32} style={{ opacity: 0.2 }} />
              <span>{search ? 'No customers match your search.' : 'No customers yet. Click "Add Customer" to get started.'}</span>
            </div>
          ) : (
            customers.map(c => (
              <div key={c.id} className="cust-table-row">
                {/* Name */}
                <div className="cust-name-cell">
                  <div className="cust-avatar">{initial(c)}</div>
                  <div>
                    <div className="cust-name">{displayName(c)}</div>
                    <div className="cust-id-muted">#{c.id.slice(-8)}</div>
                  </div>
                </div>
                {/* Contact */}
                <div className="cust-contact-cell">
                  {c.phone && <div className="cust-contact-line"><Phone size={11} /> {c.phone}</div>}
                  {c.email && <div className="cust-contact-line"><Mail size={11} /> {c.email}</div>}
                  {!c.phone && !c.email && <span className="cust-muted">—</span>}
                </div>
                {/* Loyalty */}
                <div className="cust-pts">
                  <Award size={13} style={{ color: '#f59e0b' }} />
                  {(c.loyaltyPoints || 0).toLocaleString()} pts
                </div>
                {/* Discount */}
                <div className="cust-discount">
                  {c.discount != null ? <span className="cust-badge-green">{fmtPc(c.discount)}</span> : <span className="cust-muted">—</span>}
                </div>
                {/* Balance */}
                <div className="cust-balance">
                  {c.balance != null ? (
                    <span style={{ color: parseFloat(c.balance) >= 0 ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                      {fmt(c.balance)}
                    </span>
                  ) : <span className="cust-muted">—</span>}
                </div>
                {/* Card */}
                <div className="cust-card">
                  {c.cardNo ? <span className="cust-mono">{c.cardNo}</span> : <span className="cust-muted">—</span>}
                </div>
                {/* Actions */}
                <div className="cust-actions">
                  <button className="cust-btn cust-btn-sm" onClick={() => setViewTarget(c)}>View</button>
                  <button className="cust-btn cust-btn-sm" onClick={() => openEdit(c)} title="Edit">
                    <Edit2 size={13} />
                  </button>
                  <button className="cust-btn cust-btn-sm cust-btn-danger-ghost" onClick={() => setDeleteTarget(c)} title="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="cust-pagination">
              <button className="cust-btn cust-btn-sm cust-btn-icon" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft size={14} />
              </button>
              <span className="cust-page-info">
                Page {page} of {totalPages} · {total.toLocaleString()} customers
              </span>
              <button className="cust-btn cust-btn-sm cust-btn-icon" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

      </main>

      {/* Modals */}
      {formMode === 'create' && (
        <CustomerForm
          initial={null}
          onSave={handleCreate}
          onClose={() => setFormMode(null)}
          saving={saving}
        />
      )}
      {formMode === 'edit' && editTarget && (
        <CustomerForm
          initial={editTarget}
          onSave={handleUpdate}
          onClose={() => { setFormMode(null); setEditTarget(null); }}
          saving={saving}
        />
      )}
      {viewTarget && formMode !== 'edit' && (
        <CustomerProfile
          customer={viewTarget}
          onClose={() => setViewTarget(null)}
          onEdit={openEdit}
        />
      )}
      {deleteTarget && (
        <DeleteConfirm
          customer={deleteTarget}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
          saving={saving}
        />
      )}
    </div>
  );
}
