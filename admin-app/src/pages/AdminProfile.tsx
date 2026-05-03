/**
 * AdminProfile — superadmin self-service profile.
 *
 * Available to any authenticated user (no permission gate). Two cards:
 * 1) Profile details (name + phone editable, email + role read-only)
 * 2) Change password (current + new + confirm with strength rules)
 *
 * Mirrors the portal's MyProfile page but uses the admin-app theme.
 */
import { useState, useEffect, useMemo, FormEvent } from 'react';
import { toast } from 'react-toastify';
import {
  User, Mail, Phone, Shield, Save, Eye, EyeOff,
  Loader, Lock, Check, AlertCircle,
} from 'lucide-react';
import { getMyProfile, updateMyProfile, changeMyPassword } from '../services/api';
import './AdminProfile.css';

interface ProfileShape {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  orgs?: Array<{ orgId: string; orgName: string }>;
}

const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Super Admin',
  admin:      'Admin',
  owner:      'Owner',
  manager:    'Manager',
  cashier:    'Cashier',
  staff:      'Staff',
};

const AdminProfile = () => {
  const [profile, setProfile]   = useState<ProfileShape | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState<string | null>(null);

  // Profile form
  const [nameInput,  setNameInput]  = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form
  const [currentPw,    setCurrentPw]    = useState('');
  const [newPw,        setNewPw]        = useState('');
  const [confirmPw,    setConfirmPw]    = useState('');
  const [showCurrent,  setShowCurrent]  = useState(false);
  const [showNew,      setShowNew]      = useState(false);
  const [savingPw,     setSavingPw]     = useState(false);

  const loadProfile = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = (await getMyProfile()) as unknown as ProfileShape;
      setProfile(data);
      setNameInput(data.name || '');
      setPhoneInput(data.phone || '');
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e.response?.data?.error || e.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProfile(); }, []);

  const dirty = profile && (
    (nameInput.trim() !== (profile.name || '')) ||
    ((phoneInput || '').trim() !== (profile.phone || ''))
  );

  const initials = useMemo(() => {
    const src = profile?.name || profile?.email || '?';
    return src.split(/[\s@]/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
  }, [profile]);

  const handleSaveProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!dirty) return;
    setSavingProfile(true);
    try {
      await updateMyProfile({
        name:  nameInput.trim(),
        phone: phoneInput.trim() || null,
      });
      toast.success('Profile updated');
      // Sync the cached admin_user record so the sidebar/header reflects new name
      try {
        const u = JSON.parse(localStorage.getItem('admin_user') || '{}');
        u.name = nameInput.trim();
        localStorage.setItem('admin_user', JSON.stringify(u));
      } catch { /* ignore */ }
      loadProfile();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  // Mirror backend validatePassword rules
  const pwRules = useMemo(() => [
    { ok: newPw.length >= 8,                          label: 'At least 8 characters' },
    { ok: /[a-z]/.test(newPw),                        label: 'One lowercase letter' },
    { ok: /[A-Z]/.test(newPw),                        label: 'One uppercase letter' },
    { ok: /\d/.test(newPw),                           label: 'One digit' },
    { ok: /[^A-Za-z0-9]/.test(newPw),                 label: 'One special character' },
  ], [newPw]);

  const pwAllOk    = pwRules.every(r => r.ok);
  const pwMatches  = !!newPw && newPw === confirmPw;
  const canChangePw = !!currentPw && pwAllOk && pwMatches && !savingPw;

  const handleChangePassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canChangePw) return;
    setSavingPw(true);
    try {
      await changeMyPassword(currentPw, newPw);
      toast.success('Password updated');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to update password');
    } finally {
      setSavingPw(false);
    }
  };

  if (loading) {
    return <div className="amp-loading"><Loader size={18} className="al-spin" /> Loading profile…</div>;
  }
  if (error || !profile) {
    return (
      <div className="amp-error">
        <AlertCircle size={18} />
        <div><strong>Couldn't load profile.</strong> {error}</div>
        <button className="amp-btn-secondary" onClick={loadProfile}>Retry</button>
      </div>
    );
  }

  return (
    <div className="amp-wrap">
      {/* Identity */}
      <div className="amp-identity">
        <div className="amp-avatar-lg">{initials}</div>
        <div className="amp-identity-meta">
          <div className="amp-identity-name">{profile.name}</div>
          <div className="amp-identity-email"><Mail size={13} /> {profile.email}</div>
          <div className="amp-identity-chips">
            <span className="amp-chip"><Shield size={11} /> {ROLE_LABEL[profile.role] || profile.role}</span>
          </div>
        </div>
      </div>

      {/* Profile form */}
      <form className="amp-card" onSubmit={handleSaveProfile}>
        <div className="amp-card-head">
          <div className="amp-card-title"><User size={15} /> Profile details</div>
          <div className="amp-card-sub">Your name and phone number.</div>
        </div>

        <div className="amp-field">
          <label className="amp-label">Full name</label>
          <input
            type="text"
            className="amp-input"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            maxLength={100}
            required
          />
        </div>

        <div className="amp-field">
          <label className="amp-label">Phone number</label>
          <div className="amp-pw-row">
            <span className="amp-input-icon"><Phone size={15} /></span>
            <input
              type="tel"
              className="amp-input amp-input-icon-pad"
              value={phoneInput}
              onChange={e => setPhoneInput(e.target.value)}
              placeholder="+1 555 123 4567"
              maxLength={20}
            />
          </div>
        </div>

        <div className="amp-field amp-field-readonly">
          <label className="amp-label">Email address</label>
          <div className="amp-readonly">{profile.email}</div>
          <div className="amp-readonly-hint">Email changes require a separate admin process.</div>
        </div>

        <div className="amp-field amp-field-readonly">
          <label className="amp-label">Role</label>
          <div className="amp-readonly">{ROLE_LABEL[profile.role] || profile.role}</div>
        </div>

        <div className="amp-actions">
          <button type="submit" className="amp-btn-primary" disabled={!dirty || savingProfile}>
            {savingProfile
              ? <><Loader size={13} className="al-spin" /> Saving…</>
              : <><Save size={13} /> Save profile</>}
          </button>
          {dirty && !savingProfile && <span className="amp-dirty-note">Unsaved changes</span>}
        </div>
      </form>

      {/* Password form */}
      <form className="amp-card" onSubmit={handleChangePassword}>
        <div className="amp-card-head">
          <div className="amp-card-title"><Lock size={15} /> Change password</div>
          <div className="amp-card-sub">You must enter your current password to set a new one.</div>
        </div>

        <div className="amp-field">
          <label className="amp-label">Current password</label>
          <div className="amp-pw-row">
            <input
              type={showCurrent ? 'text' : 'password'}
              className="amp-input"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button type="button" className="amp-pw-eye" onClick={() => setShowCurrent(s => !s)}>
              {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <div className="amp-field">
          <label className="amp-label">New password</label>
          <div className="amp-pw-row">
            <input
              type={showNew ? 'text' : 'password'}
              className="amp-input"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              autoComplete="new-password"
            />
            <button type="button" className="amp-pw-eye" onClick={() => setShowNew(s => !s)}>
              {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {newPw && (
            <ul className="amp-pw-rules">
              {pwRules.map(r => (
                <li key={r.label} className={r.ok ? 'amp-pw-rule-ok' : 'amp-pw-rule-pending'}>
                  {r.ok ? <Check size={11} /> : <span className="amp-pw-dot">·</span>} {r.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="amp-field">
          <label className="amp-label">Confirm new password</label>
          <input
            type={showNew ? 'text' : 'password'}
            className="amp-input"
            value={confirmPw}
            onChange={e => setConfirmPw(e.target.value)}
            autoComplete="new-password"
          />
          {confirmPw && newPw !== confirmPw && (
            <div className="amp-pw-mismatch"><AlertCircle size={11} /> Passwords don't match</div>
          )}
        </div>

        <div className="amp-actions">
          <button type="submit" className="amp-btn-primary" disabled={!canChangePw}>
            {savingPw
              ? <><Loader size={13} className="al-spin" /> Updating…</>
              : <><Lock size={13} /> Update password</>}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AdminProfile;
