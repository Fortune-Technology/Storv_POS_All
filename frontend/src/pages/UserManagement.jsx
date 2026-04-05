import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import './analytics.css';
import {
  Users, UserPlus, X, Loader, AlertCircle,
  RefreshCw, Shield, ChevronDown, Trash2, Copy, Eye, EyeOff, Store,
} from 'lucide-react';
import { getTenantUsers, inviteUser, updateUserRole, removeUser, getStores, setCashierPin, removeCashierPin } from '../services/api';
import { toast } from 'react-toastify';

/* ── Role config (viewer removed) ───────────────────────────────────────── */
const ROLES = [
  { value: 'admin',   label: 'Admin',   color: '#f97316', bg: 'rgba(249,115,22,0.12)',  multiStore: true  },
  { value: 'manager', label: 'Manager', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  multiStore: true  },
  { value: 'cashier', label: 'Cashier', color: 'var(--accent-primary)', bg: 'var(--brand-12)',  multiStore: false },
];

const FIXED_ROLES = ['owner', 'superadmin'];

function roleBadge(role) {
  const r = ROLES.find((x) => x.value === role);
  if (!r) return (
    <span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{role}</span>
  );
  return (
    <span style={{ padding: '0.2rem 0.65rem', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: 700, background: r.bg, color: r.color }}>
      {r.label}
    </span>
  );
}

function Initials({ name }) {
  const parts = (name || '?').split(' ');
  const letters = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  return (
    <div style={{
      width: 36, height: 36, borderRadius: '50%',
      background: 'var(--brand-20)', color: 'var(--accent-primary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: '0.8rem', flexShrink: 0,
      textTransform: 'uppercase',
    }}>
      {letters || '?'}
    </div>
  );
}

/* ── Store assignment input ──────────────────────────────────────────────── */
/**
 * For cashiers → single <select> (exactly 1 store required)
 * For managers/admins → multi-checkbox list (1 or more, or 0 = all stores)
 */
function StoreAssignment({ role, storeIds, setStoreIds, stores }) {
  const isMulti = ROLES.find(r => r.value === role)?.multiStore ?? false;

  if (!isMulti) {
    // Cashier: single store required
    return (
      <div className="form-group" style={{ margin: 0 }}>
        <label className="form-label">
          <Store size={12} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />
          Store <span style={{ color: 'var(--error)' }}>*</span>
        </label>
        <select
          className="form-input"
          required
          value={storeIds[0] || ''}
          onChange={e => setStoreIds(e.target.value ? [e.target.value] : [])}
          style={{ cursor: 'pointer' }}
        >
          <option value="">Select a store…</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
          Cashiers can only be assigned to one store
        </span>
      </div>
    );
  }

  // Manager / Admin: multi-select checkboxes
  const toggle = (id) => {
    setStoreIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="form-group" style={{ margin: 0 }}>
      <label className="form-label">
        <Store size={12} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />
        Store access
      </label>
      <div style={{
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        maxHeight: 150,
        overflowY: 'auto',
      }}>
        {stores.length === 0 ? (
          <div style={{ padding: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>No stores yet</div>
        ) : (
          stores.map((s, i) => {
            const checked = storeIds.includes(s.id);
            return (
              <label key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                padding: '0.55rem 0.75rem', cursor: 'pointer',
                borderBottom: i < stores.length - 1 ? '1px solid var(--border-color)' : 'none',
                background: checked ? 'var(--brand-05)' : 'transparent',
                transition: 'background 0.12s',
              }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(s.id)}
                  style={{ accentColor: 'var(--accent-primary)', width: 14, height: 14, cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontSize: '0.825rem', fontWeight: checked ? 600 : 400, color: 'var(--text-primary)' }}>{s.name}</div>
                  {s.address && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{s.address}</div>}
                </div>
              </label>
            );
          })
        )}
      </div>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
        {storeIds.length === 0 ? 'No stores selected — user has access to all stores' : `${storeIds.length} store${storeIds.length !== 1 ? 's' : ''} selected`}
      </span>
    </div>
  );
}

/* ── Invite Modal ────────────────────────────────────────────────────────── */
function InviteModal({ stores, onClose, onInvited }) {
  const [form,    setForm]    = useState({ name: '', email: '', phone: '', role: 'cashier' });
  const [storeIds, setStoreIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(null);
  const [showPw,  setShowPw]  = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Reset store selection when role changes
  const handleRoleChange = (role) => {
    set('role', role);
    setStoreIds([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.role === 'cashier' && storeIds.length !== 1) {
      toast.error('Cashiers must be assigned to exactly one store.');
      return;
    }
    setLoading(true);
    try {
      const result = await inviteUser({
        name:    form.name.trim(),
        email:   form.email.trim(),
        phone:   form.phone.trim() || undefined,
        role:    form.role,
        storeIds,
      });
      setCreated(result);
      onInvited(result.user);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not invite user.');
    } finally {
      setLoading(false);
    }
  };

  const copyPw = () => {
    navigator.clipboard?.writeText(created.tempPassword);
    toast.success('Temporary password copied!');
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
        padding: '2rem', width: '100%', maxWidth: '460px',
        boxShadow: 'var(--shadow-lg)', animation: 'fadeIn 0.2s ease',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
            <UserPlus size={18} style={{ marginRight: '0.5rem', verticalAlign: 'middle', color: 'var(--accent-primary)' }} />
            Invite user
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        {!created ? (
          <form onSubmit={handleSubmit} style={{ overflowY: 'auto', flex: 1 }}>
            {[
              { key: 'name',  label: 'Full name',  type: 'text',  placeholder: 'Jane Smith',       required: true  },
              { key: 'email', label: 'Email',       type: 'email', placeholder: 'jane@company.com', required: true  },
              { key: 'phone', label: 'Phone',       type: 'tel',   placeholder: '+1 555 000 0000',  required: false },
            ].map(({ key, label, type, placeholder, required }) => (
              <div className="form-group" key={key} style={{ marginBottom: '0.875rem' }}>
                <label className="form-label">{label}{required && <span style={{ color: 'var(--error)' }}> *</span>}</label>
                <input type={type} className="form-input" placeholder={placeholder} required={required}
                  value={form[key]} onChange={(e) => set(key, e.target.value)} />
              </div>
            ))}

            {/* Role */}
            <div className="form-group" style={{ marginBottom: '0.875rem' }}>
              <label className="form-label">Role</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {ROLES.map(r => (
                  <button
                    key={r.value} type="button"
                    onClick={() => handleRoleChange(r.value)}
                    style={{
                      flex: 1, padding: '0.6rem 0.5rem',
                      border: `1.5px solid ${form.role === r.value ? r.color : 'var(--border-color)'}`,
                      borderRadius: 'var(--radius-md)',
                      background: form.role === r.value ? `${r.bg}` : 'var(--bg-tertiary)',
                      color: form.role === r.value ? r.color : 'var(--text-muted)',
                      fontWeight: form.role === r.value ? 700 : 500,
                      fontSize: '0.8rem', cursor: 'pointer', transition: 'all 0.15s',
                    }}>
                    {r.label}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: '0.35rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {form.role === 'cashier'  && 'Single store · limited POS access'}
                {form.role === 'manager'  && 'Multiple stores · can manage products & staff'}
                {form.role === 'admin'    && 'Multiple stores · full org access except billing'}
              </div>
            </div>

            {/* Store assignment */}
            <div style={{ marginBottom: '1.25rem' }}>
              <StoreAssignment
                role={form.role}
                storeIds={storeIds}
                setStoreIds={setStoreIds}
                stores={stores}
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.875rem' }} disabled={loading}>
              {loading ? <Loader size={16} className="animate-spin" /> : 'Send invite'}
            </button>
          </form>
        ) : (
          /* Success — show temp password */
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--brand-12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
              <UserPlus size={24} color="var(--accent-primary)" />
            </div>
            <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              {created.user.name} added!
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              Share these credentials securely. The user should change their password on first login.
            </p>

            <div style={{ background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '1.25rem', textAlign: 'left' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Email</div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>{created.user.email}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Temporary password</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <code style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.95rem', color: 'var(--text-primary)', letterSpacing: '0.05em' }}>
                  {showPw ? created.tempPassword : '••••••••'}
                </code>
                <button onClick={() => setShowPw(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button onClick={copyPw} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-primary)', padding: '0.25rem' }}>
                  <Copy size={16} />
                </button>
              </div>
            </div>

            <button className="btn btn-primary" style={{ width: '100%' }} onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function UserManagement() {
  const [users,      setUsers]      = useState([]);
  const [stores,     setStores]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [pinModal,   setPinModal]   = useState(null); // null | { userId, userName }
  const [pinValue,   setPinValue]   = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError,   setPinError]   = useState('');

  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, s] = await Promise.all([getTenantUsers(), getStores()]);
      setUsers(u);
      setStores(s);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRoleChange = async (userId, role) => {
    setUpdatingId(userId);
    try {
      const updated = await updateUserRole(userId, { role });
      setUsers(prev => prev.map(u => u._id === userId ? { ...u, role: updated.role, storeIds: updated.storeIds } : u));
      toast.success('Role updated.');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not update role.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRemove = async (userId, name) => {
    if (!window.confirm(`Remove ${name} from the organisation?`)) return;
    setRemovingId(userId);
    try {
      await removeUser(userId);
      setUsers(prev => prev.filter(u => u._id !== userId));
      toast.success(`${name} removed.`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not remove user.');
    } finally {
      setRemovingId(null);
    }
  };

  const handleSetPin = async () => {
    if (!/^\d{4,6}$/.test(pinValue)) {
      setPinError('PIN must be 4–6 digits (numbers only)');
      return;
    }
    setPinLoading(true);
    setPinError('');
    try {
      await setCashierPin(pinModal.userId, pinValue);
      toast.success(`PIN set for ${pinModal.userName}`);
      setPinModal(null);
      setPinValue('');
    } catch (err) {
      setPinError(err.response?.data?.error || 'Failed to set PIN');
    } finally {
      setPinLoading(false);
    }
  };

  const handleRemovePin = async (userId, userName) => {
    try {
      await removeCashierPin(userId);
      toast.success(`PIN removed for ${userName}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to remove PIN');
    }
  };

  // Render comma-separated store names for a user
  const storeNames = (user) => {
    const ids = user.storeIds || [];
    if (ids.length === 0) {
      const isMulti = ROLES.find(r => r.value === user.role)?.multiStore ?? false;
      return isMulti
        ? <span style={{ color: 'var(--accent-primary)', fontSize: '0.75rem', fontWeight: 600 }}>All stores</span>
        : <span style={{ color: 'var(--text-muted)' }}>—</span>;
    }
    return ids.map((s, i) => {
      const store = stores.find(st => st.id === (s.id || s));
      return (
        <span key={i} style={{ display: 'inline-block', background: 'var(--brand-10)', color: 'var(--accent-primary)', fontSize: '0.7rem', fontWeight: 600, padding: '0.1rem 0.45rem', borderRadius: '9999px', margin: '0.1rem 0.15rem' }}>
          {store?.name || '?'}
        </span>
      );
    });
  };

  return (
    <div className="layout-container">
      <Sidebar />
      <main className="main-content animate-fade-in">

        {/* Header */}
        <div className="analytics-header">
          <div>
            <h1 className="analytics-title" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Users size={26} style={{ color: 'var(--accent-primary)' }} />
              Users
            </h1>
            <p className="analytics-subtitle">Manage team members and their store access</p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="filter-btn" onClick={load} disabled={loading}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              Refresh
            </button>
            <button className="btn btn-primary" onClick={() => setShowInvite(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1rem' }}>
              <UserPlus size={15} />Invite user
            </button>
          </div>
        </div>

        {error && (
          <div className="analytics-error" style={{ marginBottom: '1.5rem' }}>
            <AlertCircle size={16} /><span>{error}</span>
          </div>
        )}

        {/* Stats row */}
        <div className="analytics-stats-row" style={{ marginBottom: '1.75rem' }}>
          {[
            { label: 'Total users', value: users.length,                                              color: 'var(--accent-primary)', bg: 'var(--brand-12)' },
            { label: 'Admins',      value: users.filter(u => ['admin','owner'].includes(u.role)).length, color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
            { label: 'Managers',    value: users.filter(u => u.role === 'manager').length,            color: '#3b82f6', bg: 'rgba(59,130,246,0.12)'  },
            { label: 'Cashiers',    value: users.filter(u => u.role === 'cashier').length,            color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)'  },
          ].map(k => (
            <div key={k.label} className="analytics-stat-card">
              <div className="analytics-stat-icon" style={{ background: k.bg, color: k.color }}>
                <Shield size={20} />
              </div>
              <div>
                <span className="analytics-stat-label">{k.label}</span>
                <span className="analytics-stat-value" style={{ color: k.color }}>{k.value}</span>
              </div>
            </div>
          ))}
        </div>

        {/* User table */}
        <div className="analytics-chart-card">
          <div className="analytics-chart-title" style={{ marginBottom: '1.25rem' }}>
            <Users size={16} style={{ color: 'var(--accent-primary)' }} />
            Team members
            <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              {users.length} member{users.length !== 1 ? 's' : ''}
            </span>
          </div>

          {loading && !users.length ? (
            <div className="analytics-loading"><div className="analytics-loading-spinner" /><span>Loading…</span></div>
          ) : users.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              <Users size={36} style={{ opacity: 0.2, marginBottom: '0.75rem' }} />
              <p>No team members yet. Invite your first user!</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    {['User', 'Role', 'Store access', 'Joined', 'Actions'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const isSelf   = u.id === currentUser.id;
                    const isFixed  = FIXED_ROLES.includes(u.role);
                    const updating = updatingId === u.id;
                    const removing = removingId === u.id;

                    return (
                      <tr key={u.id}
                        style={{ borderBottom: '1px solid var(--border-color)', transition: 'background 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}>

                        {/* User */}
                        <td style={{ padding: '0.875rem 0.75rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <Initials name={u.name} />
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                                {u.name}{isSelf && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>(you)</span>}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{u.email}</div>
                            </div>
                          </div>
                        </td>

                        {/* Role */}
                        <td style={{ padding: '0.875rem 0.75rem' }}>
                          {isFixed || isSelf ? roleBadge(u.role) : (
                            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                              <select
                                value={u.role}
                                onChange={e => handleRoleChange(u.id, e.target.value)}
                                disabled={updating}
                                style={{
                                  appearance: 'none', border: 'none', background: 'transparent',
                                  cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700,
                                  color: ROLES.find(r => r.value === u.role)?.color || 'var(--text-muted)',
                                  paddingRight: '1.1rem',
                                }}
                              >
                                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                              </select>
                              {updating
                                ? <Loader size={12} className="animate-spin" />
                                : <ChevronDown size={12} style={{ color: 'var(--text-muted)', position: 'absolute', right: 0, pointerEvents: 'none' }} />}
                            </div>
                          )}
                        </td>

                        {/* Store access */}
                        <td style={{ padding: '0.875rem 0.75rem', fontSize: '0.8rem', maxWidth: 200 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.15rem' }}>
                            {storeNames(u)}
                          </div>
                        </td>

                        {/* Joined */}
                        <td style={{ padding: '0.875rem 0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                        </td>

                        {/* Actions */}
                        <td style={{ padding: '0.875rem 0.75rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            {['cashier', 'staff', 'manager'].includes(u.role) && (
                              <button
                                onClick={() => { setPinModal({ userId: u.id, userName: u.name }); setPinValue(''); setPinError(''); }}
                                title="Set POS PIN"
                                style={{
                                  background: 'var(--brand-10)', border: '1px solid var(--brand-30)',
                                  color: 'var(--accent-primary)', cursor: 'pointer',
                                  padding: '0.2rem 0.55rem', borderRadius: '6px',
                                  fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em',
                                  transition: 'background 0.15s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--brand-20)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'var(--brand-10)'}
                              >
                                PIN
                              </button>
                            )}
                            {!isFixed && !isSelf && (
                              <button
                                onClick={() => handleRemove(u.id, u.name)}
                                disabled={removing}
                                title="Remove from organisation"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem', borderRadius: '6px', transition: 'color 0.15s' }}
                                onMouseEnter={e => e.currentTarget.style.color = 'var(--error)'}
                                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                              >
                                {removing ? <Loader size={15} className="animate-spin" /> : <Trash2 size={15} />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {showInvite && (
        <InviteModal
          stores={stores}
          onClose={() => setShowInvite(false)}
          onInvited={user => setUsers(prev => [...prev, user])}
        />
      )}

      {/* PIN Modal */}
      {pinModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '1rem',
        }}>
          <div style={{
            background: '#161922', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 380,
          }}>
            <h3 style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '1.1rem', margin: '0 0 4px' }}>
              Set POS PIN
            </h3>
            <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0 0 1.5rem' }}>
              {pinModal.userName} will use this PIN to sign in at the register.
            </p>

            {pinError && (
              <div style={{
                background: 'rgba(224,63,63,.1)', border: '1px solid rgba(224,63,63,.3)',
                borderRadius: 8, padding: '0.6rem 0.875rem',
                color: '#f87171', fontSize: '0.82rem', marginBottom: '1rem',
              }}>
                {pinError}
              </div>
            )}

            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
              PIN (4–6 digits)
            </label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4,6}"
              maxLength={6}
              autoFocus
              value={pinValue}
              onChange={e => { setPinValue(e.target.value.replace(/\D/g, '')); setPinError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleSetPin()}
              placeholder="e.g. 1357"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#252836', color: '#f1f5f9',
                border: '1px solid rgba(255,255,255,.12)', borderRadius: 10,
                padding: '0.8rem 1rem', fontSize: '1.25rem', letterSpacing: '0.3em',
                outline: 'none', marginBottom: '1.25rem',
              }}
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleSetPin}
                disabled={pinLoading || pinValue.length < 4}
                style={{
                  flex: 1, padding: '0.8rem',
                  background: pinValue.length >= 4 ? 'var(--accent-primary)' : '#1e2130',
                  color: pinValue.length >= 4 ? '#0f1117' : '#475569',
                  border: 'none', borderRadius: 10, fontWeight: 800,
                  fontSize: '0.9rem', cursor: pinValue.length >= 4 ? 'pointer' : 'not-allowed',
                }}
              >
                {pinLoading ? 'Saving…' : 'Save PIN'}
              </button>
              <button
                onClick={() => { setPinModal(null); setPinValue(''); setPinError(''); }}
                style={{
                  padding: '0.8rem 1.25rem',
                  background: 'rgba(255,255,255,.05)', color: '#94a3b8',
                  border: '1px solid rgba(255,255,255,.1)', borderRadius: 10,
                  fontSize: '0.9rem', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>

            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,.06)' }}>
              <button
                onClick={() => { handleRemovePin(pinModal.userId, pinModal.userName); setPinModal(null); }}
                style={{
                  background: 'none', border: 'none', color: '#64748b',
                  fontSize: '0.78rem', cursor: 'pointer', textDecoration: 'underline',
                }}
              >
                Remove existing PIN
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
