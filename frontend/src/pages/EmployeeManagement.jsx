import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import '../styles/portal.css';
import './EmployeeManagement.css';
import {
  Users, UserPlus, X, Loader, AlertCircle, Search,
  RefreshCw, Shield, Edit2, Trash2, Eye, EyeOff, Key,
  Store, ToggleLeft, ToggleRight, ChevronDown, Clock,
} from 'lucide-react';
import {
  getTenantUsers, inviteUser, updateUserRole, removeUser,
  getStores, setCashierPin, removeCashierPin,
} from '../services/api';
import { toast } from 'react-toastify';
import EmployeeReports from './EmployeeReports';
import ShiftManagement from './ShiftManagement';
import SortableHeader from '../components/SortableHeader';
import { useTableSort } from '../hooks/useTableSort';

/* ── Validation helpers ─────────────────────────────────────────────── */
const validateEmail    = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validatePhone    = (phone) => !phone || /^\+?[\d\s\-\(\)]{7,15}$/.test(phone.replace(/\s/g, ''));
const validatePassword = (pw)    => pw.length >= 8 && /\d/.test(pw);
const validatePin      = (pin)   => !pin || /^\d{4,6}$/.test(pin);

/* ── Role config ────────────────────────────────────────────────────── */
const ROLES = [
  { value: 'owner',   label: 'Owner',   badgeClass: 'em-role-owner',   multiStore: true  },
  { value: 'admin',   label: 'Admin',   badgeClass: 'em-role-admin',   multiStore: true  },
  { value: 'manager', label: 'Manager', badgeClass: 'em-role-manager', multiStore: true  },
  { value: 'cashier', label: 'Cashier', badgeClass: 'em-role-cashier', multiStore: false },
  { value: 'staff',   label: 'Store',   badgeClass: 'em-role-store',   multiStore: false },
];

const EDITABLE_ROLES = ['admin', 'manager', 'cashier', 'staff'];
const FIXED_ROLES = ['owner', 'superadmin'];

function roleBadge(role) {
  const r = ROLES.find((x) => x.value === role);
  if (!r) return <span className="p-badge p-badge-gray">{role}</span>;
  return <span className={`p-badge ${r.badgeClass}`}>{r.label}</span>;
}

/* ── Initials avatar ────────────────────────────────────────────────── */
function Initials({ name }) {
  const parts = (name || '?').split(' ');
  const letters = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  return <div className="em-avatar">{letters || '?'}</div>;
}

/* ── Status indicator ───────────────────────────────────────────────── */
function StatusBadge({ status }) {
  const s = (status || 'active').toLowerCase();
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <span className="em-status">
      <span className={`em-status-dot em-status-dot--${s}`} />
      <span className={`em-status-text--${s}`}>{label}</span>
    </span>
  );
}

/* ── Store multi-select ─────────────────────────────────────────────── */
function StoreMultiSelect({ role, storeIds, setStoreIds, stores }) {
  const isMulti = ROLES.find(r => r.value === role)?.multiStore ?? false;

  if (!isMulti) {
    return (
      <div className="p-field">
        <label className="p-field-label">
          <Store size={12} /> Store <span style={{ color: 'var(--error)' }}>*</span>
        </label>
        <select
          className="p-select"
          required
          value={storeIds[0] || ''}
          onChange={e => setStoreIds(e.target.value ? [e.target.value] : [])}
        >
          <option value="">Select a store...</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          This role can only be assigned to one store
        </span>
      </div>
    );
  }

  const toggle = (id) => {
    setStoreIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="p-field">
      <label className="p-field-label">
        <Store size={12} /> Store access
      </label>
      <div className="em-store-checklist">
        {stores.length === 0 ? (
          <div style={{ padding: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>No stores yet</div>
        ) : (
          stores.map(s => {
            const checked = storeIds.includes(s.id);
            return (
              <label
                key={s.id}
                className={`em-store-check-item ${checked ? 'em-store-check-item--checked' : ''}`}
              >
                <input
                  type="checkbox"
                  className="em-store-checkbox"
                  checked={checked}
                  onChange={() => toggle(s.id)}
                />
                <div>
                  <div className={`em-store-check-name ${checked ? 'em-store-check-name--checked' : ''}`}>
                    {s.name}
                  </div>
                  {s.address && <div className="em-store-check-addr">{s.address}</div>}
                </div>
              </label>
            );
          })
        )}
      </div>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        {storeIds.length === 0
          ? 'No stores selected -- user has access to all stores'
          : `${storeIds.length} store${storeIds.length !== 1 ? 's' : ''} selected`}
      </span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Add / Edit Employee Modal
══════════════════════════════════════════════════════════════════════ */
function EmployeeModal({ stores, employee, onClose, onSaved }) {
  const isEdit = !!employee;

  const [form, setForm] = useState({
    firstName: employee ? (employee.name || '').split(' ')[0] : '',
    lastName:  employee ? (employee.name || '').split(' ').slice(1).join(' ') : '',
    email:     employee?.email || '',
    phone:     employee?.phone || '',
    role:      employee?.role || 'cashier',
  });
  const [storeIds, setStoreIds] = useState(employee?.storeIds || []);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pin, setPin]           = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [showPin, setShowPin]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [errors, setErrors]     = useState({});

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: undefined }));
  };

  const validate = () => {
    const errs = {};
    if (!form.firstName.trim()) errs.firstName = 'First name is required.';
    if (!form.lastName.trim())  errs.lastName  = 'Last name is required.';
    if (!form.email.trim())     errs.email     = 'Email is required.';
    else if (!validateEmail(form.email)) errs.email = 'Enter a valid email address.';
    if (form.phone && !validatePhone(form.phone)) errs.phone = 'Enter a valid phone number.';
    if (!isEdit) {
      if (!password) errs.password = 'Password is required.';
      else if (!validatePassword(password)) errs.password = 'Min 8 chars + 1 number.';
      if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match.';
    }
    if (pin && !validatePin(pin)) errs.pin = 'PIN must be 4-6 digits.';
    const pinRequired = ['cashier', 'manager', 'staff'].includes(form.role);
    if (!isEdit && pinRequired && !pin) errs.pin = 'PIN is required for this role.';
    if (form.role === 'cashier' && storeIds.length !== 1) errs.storeIds = 'Cashiers must be assigned to exactly one store.';
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setLoading(true);
    try {
      if (isEdit) {
        await updateUserRole(employee._id || employee.id, {
          role: form.role,
          storeIds,
        });
        toast.success('Employee updated.');
      } else {
        await inviteUser({
          firstName: form.firstName.trim(),
          lastName:  form.lastName.trim(),
          email:     form.email.trim(),
          phone:     form.phone.trim() || undefined,
          role:      form.role,
          storeIds,
          password,
          pin:       pin || undefined,
        });
        toast.success('Employee created.');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || `Could not ${isEdit ? 'update' : 'create'} employee.`);
    } finally {
      setLoading(false);
    }
  };

  const fieldError = (key) => errors[key]
    ? <span style={{ fontSize: '0.72rem', color: 'var(--error)' }}>{errors[key]}</span>
    : null;

  return (
    <div className="p-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="p-modal p-modal-lg">
        {/* Header */}
        <div className="p-modal-header">
          <h3 className="p-modal-title">
            <UserPlus size={18} />
            {isEdit ? 'Edit Employee' : 'Add Employee'}
          </h3>
          <button className="p-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Name row */}
          <div className="em-form-row">
            <div className="p-field">
              <label className="p-field-label">First name <span style={{ color: 'var(--error)' }}>*</span></label>
              <input
                type="text" className="p-input" placeholder="Jane"
                value={form.firstName}
                onChange={e => set('firstName', e.target.value)}
                disabled={isEdit}
              />
              {fieldError('firstName')}
            </div>
            <div className="p-field">
              <label className="p-field-label">Last name <span style={{ color: 'var(--error)' }}>*</span></label>
              <input
                type="text" className="p-input" placeholder="Smith"
                value={form.lastName}
                onChange={e => set('lastName', e.target.value)}
                disabled={isEdit}
              />
              {fieldError('lastName')}
            </div>
          </div>

          {/* Email */}
          <div className="p-field">
            <label className="p-field-label">Email <span style={{ color: 'var(--error)' }}>*</span></label>
            <input
              type="email" className="p-input" placeholder="jane@company.com"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              disabled={isEdit}
            />
            {fieldError('email')}
          </div>

          {/* Phone */}
          <div className="p-field">
            <label className="p-field-label">Phone <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <input
              type="tel" className="p-input" placeholder="+1 555 000 0000"
              value={form.phone}
              onChange={e => set('phone', e.target.value)}
              disabled={isEdit}
            />
            {fieldError('phone')}
          </div>

          {/* Role picker */}
          <div className="p-field">
            <label className="p-field-label">Role</label>
            <div className="em-role-picker">
              {ROLES.filter(r => EDITABLE_ROLES.includes(r.value)).map(r => (
                <button
                  key={r.value}
                  type="button"
                  className={`em-role-option ${form.role === r.value ? `em-role-option--active ${r.badgeClass}` : ''}`}
                  onClick={() => { set('role', r.value); setStoreIds([]); }}
                  style={form.role === r.value ? { fontWeight: 700 } : undefined}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              {form.role === 'cashier'  && 'Single store - limited POS access'}
              {form.role === 'manager'  && 'Multiple stores - can manage products & staff'}
              {form.role === 'admin'    && 'Multiple stores - full org access except billing'}
              {form.role === 'staff'    && 'Single store - view-only access'}
            </span>
          </div>

          {/* Store assignment */}
          <StoreMultiSelect
            role={form.role}
            storeIds={storeIds}
            setStoreIds={(val) => { setStoreIds(val); setErrors(e => ({ ...e, storeIds: undefined })); }}
            stores={stores}
          />
          {fieldError('storeIds')}

          {/* Password (new employee only) */}
          {!isEdit && (
            <>
              <div className="p-field">
                <label className="p-field-label">Password <span style={{ color: 'var(--error)' }}>*</span></label>
                <div className="em-pw-wrap">
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="p-input"
                    placeholder="Min. 8 characters + 1 number"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setErrors(er => ({ ...er, password: undefined })); }}
                  />
                  <button type="button" className="em-pw-toggle" onClick={() => setShowPw(v => !v)}>
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {fieldError('password')}
              </div>
              <div className="p-field">
                <label className="p-field-label">Confirm password <span style={{ color: 'var(--error)' }}>*</span></label>
                <div className="em-pw-wrap">
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="p-input"
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={e => { setConfirmPassword(e.target.value); setErrors(er => ({ ...er, confirmPassword: undefined })); }}
                  />
                </div>
                {fieldError('confirmPassword')}
              </div>
            </>
          )}

          {/* PIN */}
          {!isEdit && (
            <div className="em-pin-section">
              <div className="em-pin-title">
                <Key size={13} />
                POS PIN (4-6 digits)
                {['cashier', 'manager', 'staff'].includes(form.role)
                  ? <span style={{ color: 'var(--error)' }}> *</span>
                  : <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}> (optional)</span>
                }
              </div>
              <div className="em-pw-wrap">
                <input
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  pattern="[0-9]{4,6}"
                  maxLength={6}
                  className="p-input"
                  placeholder="e.g. 1357"
                  value={pin}
                  onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setErrors(er => ({ ...er, pin: undefined })); }}
                  style={{ letterSpacing: pin ? '0.25em' : undefined }}
                />
                <button type="button" className="em-pw-toggle" onClick={() => setShowPin(v => !v)}>
                  {showPin ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {fieldError('pin')}
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.3rem' }}>
                Used to sign in to the register and clock in/out
              </span>
            </div>
          )}

          {/* Submit */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1.25rem' }}>
            <button type="button" className="p-btn p-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="p-btn p-btn-primary" disabled={loading}>
              {loading ? <Loader size={15} className="animate-spin" /> : (isEdit ? 'Save Changes' : 'Create Employee')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PIN Modal — Set / Reset PIN for existing employee
══════════════════════════════════════════════════════════════════════ */
function PinModal({ userId, userName, onClose, onDone }) {
  const [pin, setPin]         = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleSet = async () => {
    if (!/^\d{4,6}$/.test(pin)) { setError('PIN must be 4-6 digits.'); return; }
    setLoading(true);
    setError('');
    try {
      await setCashierPin(userId, pin);
      toast.success(`PIN set for ${userName}`);
      onDone();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to set PIN');
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    setLoading(true);
    setError('');
    try {
      await removeCashierPin(userId);
      toast.success(`PIN removed for ${userName}`);
      onDone();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove PIN');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="p-modal">
        <div className="p-modal-header">
          <h3 className="p-modal-title"><Key size={18} /> PIN for {userName}</h3>
          <button className="p-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="em-pin-section">
          <div className="em-pin-title"><Key size={13} /> Set new PIN (4-6 digits)</div>
          <div className="em-pw-wrap">
            <input
              type={showPin ? 'text' : 'password'}
              inputMode="numeric"
              maxLength={6}
              className="p-input"
              placeholder="e.g. 1357"
              value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }}
              style={{ letterSpacing: pin ? '0.25em' : undefined }}
            />
            <button type="button" className="em-pw-toggle" onClick={() => setShowPin(v => !v)}>
              {showPin ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {error && <span style={{ fontSize: '0.72rem', color: 'var(--error)', display: 'block', marginTop: '0.3rem' }}>{error}</span>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', marginTop: '1rem' }}>
          <button
            type="button"
            className="p-btn p-btn-danger p-btn-sm"
            onClick={handleRemove}
            disabled={loading}
          >
            Remove PIN
          </button>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button type="button" className="p-btn p-btn-secondary" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="p-btn p-btn-primary"
              onClick={handleSet}
              disabled={loading || !pin}
            >
              {loading ? <Loader size={15} className="animate-spin" /> : 'Set PIN'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Main: EmployeeManagement
══════════════════════════════════════════════════════════════════════ */
function TeamTab() {
  const confirm = useConfirm();
  const embedded = true; // always embedded inside the tab wrapper
  const [users, setUsers]           = useState([]);
  const [stores, setStores]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [search, setSearch]         = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showModal, setShowModal]   = useState(false);
  const [editUser, setEditUser]     = useState(null);
  const [pinModal, setPinModal]     = useState(null);
  const [removingId, setRemovingId] = useState(null);

  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

  /* ── Load data ── */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, s] = await Promise.all([getTenantUsers(), getStores()]);
      setUsers(u);
      setStores(s);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load employees.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Handlers ── */
  const handleRemove = async (userId, name) => {
    if (!await confirm({
      title: 'Remove employee?',
      message: `Remove ${name} from the organisation? This cannot be undone.`,
      confirmLabel: 'Remove',
      danger: true,
    })) return;
    setRemovingId(userId);
    try {
      await removeUser(userId);
      setUsers(prev => prev.filter(u => (u._id || u.id) !== userId));
      toast.success(`${name} removed.`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not remove employee.');
    } finally {
      setRemovingId(null);
    }
  };

  const handleToggleStatus = async (user) => {
    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    try {
      await updateUserRole(user._id || user.id, { status: newStatus });
      setUsers(prev => prev.map(u => (u._id || u.id) === (user._id || user.id) ? { ...u, status: newStatus } : u));
      toast.success(`${user.name} ${newStatus === 'active' ? 'activated' : 'deactivated'}.`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not update status.');
    }
  };

  /* ── Filtering ── */
  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || (u.name || '').toLowerCase().includes(q)
      || (u.email || '').toLowerCase().includes(q)
      || (u.phone || '').toLowerCase().includes(q);
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    const matchStatus = statusFilter === 'all' || u.status === statusFilter;
    return matchSearch && matchRole && matchStatus;
  });

  /* Session 39 Round 3 — column sort */
  const userSort = useTableSort(filtered, {
    accessors: {
      name:       (u) => u.name || '',
      role:       (u) => u.role || '',
      status:     (u) => u.status || '',
      stores:     (u) => (u.storeIds || []).length,
      phone:      (u) => u.phone || '',
      lastActive: (u) => u.lastActiveAt ? new Date(u.lastActiveAt) : null,
      pin:        (u) => u.posPin ? 1 : 0,
    },
  });

  /* ── Stats ── */
  const totalEmployees = users.length;
  const activeCount    = users.filter(u => u.status === 'active').length;
  const roleBreakdown  = {};
  users.forEach(u => { roleBreakdown[u.role] = (roleBreakdown[u.role] || 0) + 1; });

  /* ── Store name helper ── */
  const storeNameFor = (id) => {
    const s = stores.find(st => st.id === (id?.id || id));
    return s ? s.name : '';
  };

  /* ── Time ago helper ── */
  const timeAgo = (dateStr) => {
    if (!dateStr) return '--';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  /* ── Render ── */
  const content = (
    <>
      {/* Header */}
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><Users size={22} /></div>
          <div>
            <h1 className="p-title">Employees</h1>
            <p className="p-subtitle">Manage team members, roles, and store access</p>
          </div>
        </div>
        <div className="p-header-actions">
          <button className="p-btn p-btn-secondary p-btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button className="p-btn p-btn-primary" onClick={() => { setEditUser(null); setShowModal(true); }}>
            <UserPlus size={15} /> Add Employee
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="em-stats">
        <div className="em-stat-card">
          <div className="em-stat-label">Total</div>
          <div className="em-stat-value">{totalEmployees}</div>
        </div>
        <div className="em-stat-card">
          <div className="em-stat-label">Active</div>
          <div className="em-stat-value">{activeCount}</div>
        </div>
        <div className="em-stat-card">
          <div className="em-stat-label">Managers</div>
          <div className="em-stat-value">{roleBreakdown.manager || 0}</div>
        </div>
        <div className="em-stat-card">
          <div className="em-stat-label">Cashiers</div>
          <div className="em-stat-value">{roleBreakdown.cashier || 0}</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="em-toolbar">
        <div className="em-search">
          <Search size={15} className="em-search-icon" />
          <input
            type="text"
            className="p-input"
            placeholder="Search by name, email, or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="p-select em-filter-select"
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
        >
          <option value="all">All Roles</option>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select
          className="p-select em-filter-select"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Inactive</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="p-card" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--error)', marginBottom: '1rem' }}>
          <AlertCircle size={16} /> {error}
          <button className="p-btn p-btn-secondary p-btn-sm" onClick={load} style={{ marginLeft: 'auto' }}>Retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && !error && (
        <div className="p-empty">
          <Loader size={28} className="animate-spin" />
          <p>Loading employees...</p>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && filtered.length === 0 && (
        <div className="p-empty">
          <Users size={36} />
          <p>{search || roleFilter !== 'all' || statusFilter !== 'all'
            ? 'No employees match your filters.'
            : 'No employees yet. Click "Add Employee" to get started.'}</p>
        </div>
      )}

      {/* Table */}
      {!loading && !error && filtered.length > 0 && (
        <div className="p-card" style={{ padding: 0 }}>
          <div className="p-table-wrap">
            <table className="p-table">
              <thead>
                <tr>
                  <SortableHeader label="Employee"    sortKey="name"       sort={userSort} />
                  <SortableHeader label="Role"        sortKey="role"       sort={userSort} />
                  <SortableHeader label="Status"      sortKey="status"     sort={userSort} />
                  <SortableHeader label="Stores"      sortKey="stores"     sort={userSort} />
                  <SortableHeader label="Phone"       sortKey="phone"      sort={userSort} />
                  <SortableHeader label="Last Active" sortKey="lastActive" sort={userSort} />
                  <SortableHeader label="PIN"         sortKey="pin"        sort={userSort} />
                  <SortableHeader label="Actions" sortable={false} align="right" />
                </tr>
              </thead>
              <tbody>
                {userSort.sorted.map(user => {
                  const uid = user._id || user.id;
                  const isFixed = FIXED_ROLES.includes(user.role);
                  const isSelf = uid === currentUser.id || uid === currentUser._id;
                  const userStoreIds = user.storeIds || [];
                  const isMulti = ROLES.find(r => r.value === user.role)?.multiStore ?? false;

                  return (
                    <tr key={uid}>
                      {/* Name + email */}
                      <td>
                        <div className="em-name-cell">
                          <Initials name={user.name} />
                          <div>
                            <div className="em-name-text">{user.name || 'Unnamed'}</div>
                            <div className="em-email-text">{user.email}</div>
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td>{roleBadge(user.role)}</td>

                      {/* Status */}
                      <td><StatusBadge status={user.status} /></td>

                      {/* Stores */}
                      <td>
                        <div className="em-store-pills">
                          {userStoreIds.length === 0 ? (
                            isMulti
                              ? <span className="em-store-pill em-store-pill--all">All stores</span>
                              : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>--</span>
                          ) : (
                            userStoreIds.slice(0, 3).map((s, i) => (
                              <span key={i} className="em-store-pill">{storeNameFor(s)}</span>
                            ))
                          )}
                          {userStoreIds.length > 3 && (
                            <span className="em-store-pill">+{userStoreIds.length - 3}</span>
                          )}
                        </div>
                      </td>

                      {/* Phone */}
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        {user.phone || '--'}
                      </td>

                      {/* Last Active */}
                      <td>
                        <span className="em-last-active">{timeAgo(user.updatedAt || user.lastActive)}</span>
                      </td>

                      {/* PIN */}
                      <td>
                        {user.hasPin ? (
                          <span className="em-pin-badge"><Key size={11} /> Set</span>
                        ) : (
                          <span className="em-pin-none">No PIN</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td>
                        <div className="em-actions" style={{ justifyContent: 'flex-end' }}>
                          {/* Edit */}
                          {!isFixed && !isSelf && (
                            <button
                              className="em-action-btn"
                              title="Edit employee"
                              onClick={() => { setEditUser(user); setShowModal(true); }}
                            >
                              <Edit2 size={14} />
                            </button>
                          )}

                          {/* PIN */}
                          {!isFixed && (
                            <button
                              className="em-action-btn"
                              title="Manage PIN"
                              onClick={() => setPinModal({ userId: uid, userName: user.name })}
                            >
                              <Key size={14} />
                            </button>
                          )}

                          {/* Toggle active */}
                          {!isFixed && !isSelf && (
                            <button
                              className="em-action-btn"
                              title={user.status === 'active' ? 'Deactivate' : 'Activate'}
                              onClick={() => handleToggleStatus(user)}
                            >
                              {user.status === 'active'
                                ? <ToggleRight size={16} style={{ color: 'var(--success)' }} />
                                : <ToggleLeft size={16} />}
                            </button>
                          )}

                          {/* Remove */}
                          {!isFixed && !isSelf && (
                            <button
                              className="em-action-btn em-action-btn--danger"
                              title="Remove employee"
                              onClick={() => handleRemove(uid, user.name)}
                              disabled={removingId === uid}
                            >
                              {removingId === uid
                                ? <Loader size={14} className="animate-spin" />
                                : <Trash2 size={14} />}
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
        </div>
      )}

      {/* Modals */}
      {showModal && (
        <EmployeeModal
          stores={stores}
          employee={editUser}
          onClose={() => { setShowModal(false); setEditUser(null); }}
          onSaved={load}
        />
      )}

      {pinModal && (
        <PinModal
          userId={pinModal.userId}
          userName={pinModal.userName}
          onClose={() => setPinModal(null)}
          onDone={load}
        />
      )}
    </>
  );

  return content;
}

/* ══════════════════════════════════════════════════════════════════════
   Main Export — Tabbed Wrapper: Team | Timesheets
══════════════════════════════════════════════════════════════════════ */

const TABS = [
  { key: 'team',       label: 'Team',        icon: <Users size={14} /> },
  { key: 'timesheets', label: 'Timesheets',  icon: <Clock size={14} /> },
  { key: 'shifts',     label: 'Shifts',      icon: <Clock size={14} /> },
];

export default function EmployeeManagement() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') || 'team');

  return (
    <div className="p-page">
      <div className="p-header">
        <div className="p-header-left">
          <div className="p-header-icon"><Users size={22} /></div>
          <div>
            <h1 className="p-title">Employees</h1>
            <p className="p-subtitle">Manage your team, roles, PINs, and timesheets</p>
          </div>
        </div>
      </div>

      <div className="p-tabs">
        {TABS.map(t => (
          <button key={t.key} className={`p-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'team'       && <TeamTab />}
      {tab === 'timesheets' && <EmployeeReports embedded />}
      {tab === 'shifts'     && <ShiftManagement embedded />}
    </div>
  );
}
