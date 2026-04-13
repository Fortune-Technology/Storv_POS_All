import React, { useState, useEffect, useCallback } from 'react';
import './analytics.css';
import './UserManagement.css';
import {
  Users, UserPlus, X, Loader, AlertCircle,
  RefreshCw, Shield, ChevronDown, Trash2, Eye, EyeOff, Store, ArrowLeft,
} from 'lucide-react';
import { getTenantUsers, inviteUser, updateUserRole, removeUser, getStores, setCashierPin, removeCashierPin } from '../services/api';
import { toast } from 'react-toastify';

/* ── Validation helpers ──────────────────────────────────────────────────── */
const validateEmail    = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validatePhone    = (phone) => !phone || /^\+?[\d\s\-\(\)]{7,15}$/.test(phone.replace(/\s/g, ''));
const validatePassword = (pw)    => pw.length >= 8 && /\d/.test(pw);
const validatePin      = (pin)   => !pin || /^\d{4,6}$/.test(pin);

/* ── Role config ─────────────────────────────────────────────────────────── */
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
function StoreAssignment({ role, storeIds, setStoreIds, stores }) {
  const isMulti = ROLES.find(r => r.value === role)?.multiStore ?? false;

  if (!isMulti) {
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

/* ── Invite Modal (2-step) ───────────────────────────────────────────────── */
function InviteModal({ stores, onClose, onInvited }) {
  const [step,            setStep]            = useState(1);
  const [form,            setForm]            = useState({ firstName: '', lastName: '', email: '', phone: '', role: 'cashier' });
  const [storeIds,        setStoreIds]        = useState([]);
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pin,             setPin]             = useState('');
  const [showPw,          setShowPw]          = useState(false);
  const [showConfirmPw,   setShowConfirmPw]   = useState(false);
  const [showPin,         setShowPin]         = useState(false);
  const [loading,         setLoading]         = useState(false);
  const [created,         setCreated]         = useState(null);
  const [errors,          setErrors]          = useState({});

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: undefined }));
  };

  const handleRoleChange = (role) => {
    set('role', role);
    setStoreIds([]);
  };

  /* ── Step 1 validation ── */
  const validateStep1 = () => {
    const errs = {};
    if (!form.firstName.trim())          errs.firstName = 'First name is required.';
    if (!form.lastName.trim())           errs.lastName  = 'Last name is required.';
    if (!form.email.trim())              errs.email     = 'Email is required.';
    else if (!validateEmail(form.email)) errs.email     = 'Enter a valid email address.';
    if (form.phone && !validatePhone(form.phone)) errs.phone = 'Enter a valid phone number (7–15 digits).';
    if (form.role === 'cashier' && storeIds.length !== 1) errs.storeIds = 'Cashiers must be assigned to exactly one store.';
    return errs;
  };

  const handleNext = () => {
    const errs = validateStep1();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setStep(2);
  };

  /* ── Step 2 validation ── */
  const validateStep2 = () => {
    const errs = {};
    if (!password)                       errs.password        = 'Password is required.';
    else if (!validatePassword(password)) errs.password       = 'Password must be at least 8 characters and include a number.';
    if (!confirmPassword)                 errs.confirmPassword = 'Please confirm the password.';
    else if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match.';
    const pinRequired = ['cashier', 'manager', 'staff'].includes(form.role);
    if (pinRequired && !pin)              errs.pin = 'PIN is required for this role.';
    else if (pin && !validatePin(pin))    errs.pin = 'PIN must be 4–6 digits.';
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validateStep2();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const result = await inviteUser({
        firstName: form.firstName.trim(),
        lastName:  form.lastName.trim(),
        email:     form.email.trim(),
        phone:     form.phone.trim() || undefined,
        role:      form.role,
        storeIds,
        password,
        pin:       pin || undefined,
      });
      setCreated(result);
      onInvited(result.user);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not create user.');
    } finally {
      setLoading(false);
    }
  };

  const fieldError = (key) => errors[key] ? (
    <span style={{ fontSize: '0.72rem', color: 'var(--error)', marginTop: '0.2rem', display: 'block' }}>
      {errors[key]}
    </span>
  ) : null;

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
        padding: '2rem', width: '100%', maxWidth: '480px',
        boxShadow: 'var(--shadow-lg)', animation: 'fadeIn 0.2s ease',
        maxHeight: '92vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {step === 2 && !created && (
              <button
                onClick={() => { setStep(1); setErrors({}); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem', display: 'flex', alignItems: 'center' }}
                title="Back to step 1"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
              <UserPlus size={18} style={{ marginRight: '0.5rem', verticalAlign: 'middle', color: 'var(--accent-primary)' }} />
              {created ? 'User created' : step === 1 ? 'Invite user — Basic info' : 'Invite user — Password & PIN'}
            </h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        {/* Step indicator */}
        {!created && (
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.5rem' }}>
            {[1, 2].map(s => (
              <div key={s} style={{
                flex: 1, height: 3, borderRadius: 99,
                background: s <= step ? 'var(--accent-primary)' : 'var(--border-color)',
                transition: 'background 0.25s',
              }} />
            ))}
          </div>
        )}

        {/* ── Success card ── */}
        {created ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(122,193,67,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
              <UserPlus size={24} color="var(--accent-primary)" />
            </div>
            <p style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              {created.user.name || `${form.firstName} ${form.lastName}`} added!
            </p>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.75rem' }}>
              The user can now sign in with their email and password.
            </p>
            <div style={{ background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', padding: '0.875rem 1rem', marginBottom: '1.25rem', textAlign: 'left' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Email</div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{created.user.email}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.6rem', marginBottom: '0.2rem' }}>Role</div>
              <div>{roleBadge(created.user.role)}</div>
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={onClose}>Done</button>
          </div>

        /* ── Step 1: Basic info ── */
        ) : step === 1 ? (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {/* First + Last name row */}
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label">First name <span style={{ color: 'var(--error)' }}>*</span></label>
                <input
                  type="text" className="form-input" placeholder="Jane"
                  value={form.firstName}
                  onChange={e => set('firstName', e.target.value)}
                  style={{ borderColor: errors.firstName ? 'var(--error)' : undefined }}
                />
                {fieldError('firstName')}
              </div>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label">Last name <span style={{ color: 'var(--error)' }}>*</span></label>
                <input
                  type="text" className="form-input" placeholder="Smith"
                  value={form.lastName}
                  onChange={e => set('lastName', e.target.value)}
                  style={{ borderColor: errors.lastName ? 'var(--error)' : undefined }}
                />
                {fieldError('lastName')}
              </div>
            </div>

            {/* Email */}
            <div className="form-group" style={{ marginBottom: '0.875rem' }}>
              <label className="form-label">Email <span style={{ color: 'var(--error)' }}>*</span></label>
              <input
                type="email" className="form-input" placeholder="jane@company.com"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                style={{ borderColor: errors.email ? 'var(--error)' : undefined }}
              />
              {fieldError('email')}
            </div>

            {/* Phone */}
            <div className="form-group" style={{ marginBottom: '0.875rem' }}>
              <label className="form-label">Phone <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
              <input
                type="tel" className="form-input" placeholder="+1 555 000 0000"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                style={{ borderColor: errors.phone ? 'var(--error)' : undefined }}
              />
              {fieldError('phone')}
            </div>

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
                      background: form.role === r.value ? r.bg : 'var(--bg-tertiary)',
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
                setStoreIds={(val) => { setStoreIds(val); setErrors(e => ({ ...e, storeIds: undefined })); }}
                stores={stores}
              />
              {fieldError('storeIds')}
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
              onClick={handleNext}
            >
              Next: Set Password &amp; PIN →
            </button>
          </div>

        /* ── Step 2: Password & PIN ── */
        ) : (
          <form onSubmit={handleSubmit} style={{ overflowY: 'auto', flex: 1 }}>
            {/* Password */}
            <div className="form-group" style={{ marginBottom: '0.875rem' }}>
              <label className="form-label">Password <span style={{ color: 'var(--error)' }}>*</span></label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  className="form-input"
                  placeholder="Min. 8 characters + 1 number"
                  value={password}
                  autoFocus
                  onChange={e => { setPassword(e.target.value); setErrors(er => ({ ...er, password: undefined })); }}
                  style={{ paddingRight: '2.5rem', borderColor: errors.password ? 'var(--error)' : undefined }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem', display: 'flex' }}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {fieldError('password')}
            </div>

            {/* Confirm Password */}
            <div className="form-group" style={{ marginBottom: '0.875rem' }}>
              <label className="form-label">Confirm password <span style={{ color: 'var(--error)' }}>*</span></label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showConfirmPw ? 'text' : 'password'}
                  className="form-input"
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={e => { setConfirmPassword(e.target.value); setErrors(er => ({ ...er, confirmPassword: undefined })); }}
                  style={{ paddingRight: '2.5rem', borderColor: errors.confirmPassword ? 'var(--error)' : undefined }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPw(v => !v)}
                  style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem', display: 'flex' }}
                >
                  {showConfirmPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {fieldError('confirmPassword')}
            </div>

            {/* PIN */}
            <div className="form-group" style={{ marginBottom: '1.25rem' }}>
              <label className="form-label">
                Register &amp; Clock-in PIN (4–6 digits)
                {['cashier', 'manager', 'staff'].includes(form.role)
                  ? <span style={{ color: 'var(--error)' }}> *</span>
                  : <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}> (optional for admin)</span>
                }
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  pattern="[0-9]{4,6}"
                  maxLength={6}
                  className="form-input"
                  placeholder="e.g. 1357"
                  value={pin}
                  onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setErrors(er => ({ ...er, pin: undefined })); }}
                  style={{ paddingRight: '2.5rem', letterSpacing: pin ? '0.25em' : undefined, borderColor: errors.pin ? 'var(--error)' : undefined }}
                />
                <button
                  type="button"
                  onClick={() => setShowPin(v => !v)}
                  style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem', display: 'flex' }}
                >
                  {showPin ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {fieldError('pin')}
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.3rem', display: 'block' }}>
                Used both to sign in to the register and to clock in/out
              </span>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.875rem' }}
              disabled={loading}
            >
              {loading ? <Loader size={16} className="animate-spin" /> : 'Create User'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function UserManagement({ embedded }) {
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
  const [showPinPw,  setShowPinPw]  = useState(false);

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

  // Backwards-compatible display name
  const displayName = (u) => u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || '?';

  const content = (
    <>

        {/* Header */}
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon">
              <Users size={22} />
            </div>
            <div>
              <h1 className="p-title">Users</h1>
              <p className="p-subtitle">Manage team members and their store access</p>
            </div>
          </div>
          <div className="p-header-actions">
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
                    const uName    = displayName(u);

                    return (
                      <tr key={u.id}
                        style={{ borderBottom: '1px solid var(--border-color)', transition: 'background 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}>

                        {/* User */}
                        <td style={{ padding: '0.875rem 0.75rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <Initials name={uName} />
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                                {uName}{isSelf && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>(you)</span>}
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
                                onClick={() => { setPinModal({ userId: u.id, userName: uName }); setPinValue(''); setPinError(''); }}
                                title="Set PIN"
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
                                Set PIN
                              </button>
                            )}
                            {!isFixed && !isSelf && (
                              <button
                                onClick={() => handleRemove(u.id, uName)}
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

      {showInvite && (
        <InviteModal
          stores={stores}
          onClose={() => setShowInvite(false)}
          onInvited={user => setUsers(prev => [...prev, user])}
        />
      )}

      {/* PIN Modal — Change PIN for existing user */}
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
              Set PIN
            </h3>
            <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0 0 1.5rem' }}>
              {pinModal.userName} will use this PIN to sign in at the register and to clock in/out.
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
            <div style={{ position: 'relative', marginBottom: '1.25rem' }}>
              <input
                type={showPinPw ? 'text' : 'password'}
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
                  padding: '0.8rem 2.5rem 0.8rem 1rem', fontSize: '1.25rem', letterSpacing: '0.3em',
                  outline: 'none',
                }}
              />
              <button type="button" onClick={() => setShowPinPw(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex', padding: 4 }}>
                {showPinPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

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
    </>
  );

  if (embedded) return <div className="p-tab-content">{content}</div>;

  return content;
}
