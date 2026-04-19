/**
 * MyProfile — self-service profile page.
 *
 * Available to every authenticated user, regardless of `users.view`. Staff
 * managing inventory, cashiers, anyone can update their own name/phone
 * and rotate their password without admin intervention. Email and role
 * changes are NOT exposed here — those require admin action.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'react-toastify';
import {
  User, Mail, Phone, Shield, Building2, Save, Eye, EyeOff,
  Loader, Lock, Check, AlertCircle,
} from 'lucide-react';
import {
  getMyProfile, updateMyProfile, changeMyPassword,
} from '../services/api';
import './MyProfile.css';

const ROLE_LABEL = {
  superadmin: 'Super Admin',
  admin:      'Admin',
  owner:      'Owner',
  manager:    'Manager',
  cashier:    'Cashier',
  staff:      'Staff',
};

export default function MyProfile() {
  const [profile,   setProfile]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  // Profile form state
  const [nameInput,  setNameInput]  = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form state
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
      const data = await getMyProfile();
      setProfile(data);
      setNameInput(data.name || '');
      setPhoneInput(data.phone || '');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load profile');
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

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!dirty) return;
    setSavingProfile(true);
    try {
      await updateMyProfile({
        name:  nameInput.trim(),
        phone: phoneInput.trim() || null,
      });
      toast.success('Profile updated');
      // Refresh sidebar — user card reads from localStorage
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      u.name = nameInput.trim();
      localStorage.setItem('user', JSON.stringify(u));
      loadProfile();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  // Simple password strength check — mirrors backend validator.
  const pwRules = useMemo(() => {
    const v = newPw;
    return [
      { ok: v.length >= 8,                          label: 'At least 8 characters' },
      { ok: /[a-z]/.test(v),                        label: 'One lowercase letter' },
      { ok: /[A-Z]/.test(v),                        label: 'One uppercase letter' },
      { ok: /\d/.test(v),                           label: 'One digit' },
      { ok: /[^A-Za-z0-9]/.test(v),                 label: 'One special character' },
    ];
  }, [newPw]);

  const pwAllOk    = pwRules.every(r => r.ok);
  const pwMatches  = newPw && newPw === confirmPw;
  const canChangePw = currentPw && pwAllOk && pwMatches && !savingPw;

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!canChangePw) return;
    setSavingPw(true);
    try {
      await changeMyPassword(currentPw, newPw);
      toast.success('Password updated');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update password');
    } finally {
      setSavingPw(false);
    }
  };

  if (loading) {
    return <div className="mp-loading"><Loader size={18} className="mp-spin" /> Loading profile…</div>;
  }
  if (error) {
    return (
      <div className="mp-error">
        <AlertCircle size={18} />
        <div><strong>Couldn't load profile.</strong> {error}</div>
        <button className="mp-btn-secondary" onClick={loadProfile}>Retry</button>
      </div>
    );
  }

  return (
    <div className="mp-wrap">
      {/* Identity card */}
      <div className="mp-identity">
        <div className="mp-avatar-lg">{initials}</div>
        <div className="mp-identity-meta">
          <div className="mp-identity-name">{profile.name}</div>
          <div className="mp-identity-email"><Mail size={13} /> {profile.email}</div>
          <div className="mp-identity-chips">
            <span className="mp-chip"><Shield size={11} /> {ROLE_LABEL[profile.role] || profile.role}</span>
            {profile.orgs?.length > 0 && (
              <span className="mp-chip"><Building2 size={11} /> {profile.orgs[0].orgName}{profile.orgs.length > 1 ? ` +${profile.orgs.length - 1} more` : ''}</span>
            )}
          </div>
        </div>
      </div>

      {/* Profile form */}
      <form className="mp-card" onSubmit={handleSaveProfile}>
        <div className="mp-card-head">
          <div className="mp-card-title"><User size={15} /> Profile details</div>
          <div className="mp-card-sub">Your name and phone number. Visible to your organisation.</div>
        </div>

        <div className="mp-field">
          <label className="mp-label">Full name</label>
          <input
            type="text"
            className="mp-input"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            maxLength={100}
            required
          />
        </div>

        <div className="mp-field">
          <label className="mp-label">Phone number</label>
          <input
            type="tel"
            className="mp-input"
            value={phoneInput}
            onChange={e => setPhoneInput(e.target.value)}
            placeholder="+1 555 123 4567"
            maxLength={20}
          />
        </div>

        <div className="mp-field mp-field--readonly">
          <label className="mp-label">Email address</label>
          <div className="mp-readonly-value">{profile.email}</div>
          <div className="mp-readonly-hint">Email changes require an admin. Contact your organisation admin if your email has changed.</div>
        </div>

        <div className="mp-field mp-field--readonly">
          <label className="mp-label">Role</label>
          <div className="mp-readonly-value">{ROLE_LABEL[profile.role] || profile.role}</div>
          <div className="mp-readonly-hint">Role and permissions are managed by admins.</div>
        </div>

        <div className="mp-form-actions">
          <button type="submit" className="mp-btn-primary" disabled={!dirty || savingProfile}>
            {savingProfile
              ? <><Loader size={13} className="mp-spin" /> Saving…</>
              : <><Save size={13} /> Save profile</>}
          </button>
          {dirty && !savingProfile && <span className="mp-dirty-note">You have unsaved changes</span>}
        </div>
      </form>

      {/* Password form */}
      <form className="mp-card" onSubmit={handleChangePassword}>
        <div className="mp-card-head">
          <div className="mp-card-title"><Lock size={15} /> Change password</div>
          <div className="mp-card-sub">You must enter your current password to set a new one.</div>
        </div>

        <div className="mp-field">
          <label className="mp-label">Current password</label>
          <div className="mp-pw-row">
            <input
              type={showCurrent ? 'text' : 'password'}
              className="mp-input"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button type="button" className="mp-pw-eye" onClick={() => setShowCurrent(s => !s)}>
              {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <div className="mp-field">
          <label className="mp-label">New password</label>
          <div className="mp-pw-row">
            <input
              type={showNew ? 'text' : 'password'}
              className="mp-input"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              autoComplete="new-password"
            />
            <button type="button" className="mp-pw-eye" onClick={() => setShowNew(s => !s)}>
              {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {newPw && (
            <ul className="mp-pw-rules">
              {pwRules.map(r => (
                <li key={r.label} className={r.ok ? 'mp-pw-rule--ok' : 'mp-pw-rule--pending'}>
                  {r.ok ? <Check size={11} /> : <span className="mp-pw-dot">·</span>} {r.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mp-field">
          <label className="mp-label">Confirm new password</label>
          <input
            type={showNew ? 'text' : 'password'}
            className="mp-input"
            value={confirmPw}
            onChange={e => setConfirmPw(e.target.value)}
            autoComplete="new-password"
          />
          {confirmPw && newPw !== confirmPw && (
            <div className="mp-pw-mismatch"><AlertCircle size={11} /> Passwords don't match</div>
          )}
        </div>

        <div className="mp-form-actions">
          <button type="submit" className="mp-btn-primary" disabled={!canChangePw}>
            {savingPw
              ? <><Loader size={13} className="mp-spin" /> Updating…</>
              : <><Lock size={13} /> Update password</>}
          </button>
        </div>
      </form>
    </div>
  );
}
