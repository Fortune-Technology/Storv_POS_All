import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, UserPlus, LogIn, AlertTriangle, CheckCircle2, ShieldAlert, Eye, EyeOff } from 'lucide-react';
import { toast } from 'react-toastify';
import { getInvitationByToken, acceptInvitation } from '../services/api';
import './AcceptInvitation.css';

/**
 * Public invitation landing page. Opened from the email/SMS link on any
 * device. Three outcomes are possible:
 *
 *   1. Invitation invalid/expired/revoked → friendly error screen
 *   2. Email already registered → "sign in to accept" (or one-click if the
 *      user is already signed in as the invited email)
 *   3. New user → inline signup form (name + password) → auto-login
 */
export default function AcceptInvitation() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [loading,    setLoading]    = useState(true);
  const [invitation, setInvitation] = useState(null);
  const [error,      setError]      = useState(null);

  // Signup form state (new user path)
  const [name,        setName]        = useState('');
  const [password,    setPassword]    = useState('');
  const [confirm,     setConfirm]     = useState('');
  const [showPw,      setShowPw]      = useState(false);
  const [submitting,  setSubmitting]  = useState(false);

  // Load the invitation by token.
  useEffect(() => {
    if (!token) {
      setError('Missing invitation token.');
      setLoading(false);
      return;
    }
    getInvitationByToken(token)
      .then(setInvitation)
      .catch(err => setError(err?.response?.data?.error || 'Invitation not found.'))
      .finally(() => setLoading(false));
  }, [token]);

  // Detect whether the currently logged-in browser session matches this
  // invitation's email. If so, we can do a one-click accept.
  const currentUser = (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  })();
  const isLoggedInAsInvitee = !!currentUser?.token
    && currentUser.email?.toLowerCase() === invitation?.email?.toLowerCase();

  async function handleAccept(body = {}) {
    setSubmitting(true);
    try {
      const result = await acceptInvitation(token, body);

      // Replace the browser session with the freshly-minted JWT. Whether
      // this is a new account or an existing login coming from a different
      // session, the user is now "signed in as the invitee" post-accept.
      const user = {
        ...result.user,
        token:    result.token,
        orgId:    result.orgId,
        tenantId: result.orgId,
      };
      localStorage.setItem('user', JSON.stringify(user));

      // Set the newly-granted org as the active one. If an explicit store was
      // part of the invitation, prefer it; otherwise the StoreContext will
      // pick the first accessible store after the app boots.
      if (result.storeIds && result.storeIds.length > 0) {
        localStorage.setItem('activeStoreId', result.storeIds[0]);
      }

      toast.success(
        result.transferOwnership
          ? `Ownership transferred. Welcome as the new owner of ${invitation.orgName}.`
          : `Welcome to ${invitation.orgName}!`
      );
      navigate('/portal/realtime', { replace: true });
    } catch (err) {
      const data = err?.response?.data;
      toast.error(data?.error || 'Could not accept invitation.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleSignupSubmit(e) {
    e.preventDefault();
    if (!name.trim() || name.trim().length < 2) return toast.error('Please enter your full name.');
    if (password.length < 8) return toast.error('Password must be at least 8 characters.');
    if (password !== confirm) return toast.error('Passwords do not match.');
    handleAccept({ name: name.trim(), password });
  }

  // ── Render states ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AcceptLayout>
        <div className="ai-state">Loading invitation…</div>
      </AcceptLayout>
    );
  }

  if (error) {
    return (
      <AcceptLayout>
        <div className="ai-state ai-state--error">
          <AlertTriangle size={36} />
          <h2>Invitation unavailable</h2>
          <p>{error}</p>
          <p className="ai-muted">Contact the person who sent you this invitation for a new link.</p>
          <Link to="/login" className="ai-btn ai-btn--ghost">Go to sign-in</Link>
        </div>
      </AcceptLayout>
    );
  }

  const isTransfer = invitation.transferOwnership;

  return (
    <AcceptLayout>
      <div className="ai-card">
        <div className={`ai-hero ${isTransfer ? 'ai-hero--transfer' : ''}`}>
          {isTransfer ? <ShieldAlert size={28} /> : <Mail size={28} />}
          <h1>
            {isTransfer ? 'Ownership Transfer' : "You're invited"}
          </h1>
          <p>
            {invitation.inviterName
              ? <><strong>{invitation.inviterName}</strong> </>
              : <>Someone </>}
            has invited you to
            {isTransfer
              ? <> take over <strong>{invitation.orgName}</strong>.</>
              : <> join <strong>{invitation.orgName}</strong> as <strong>{invitation.role}</strong>.</>}
          </p>
          {isTransfer && (
            <div className="ai-transfer-warning">
              <strong>Heads up:</strong> accepting this transfer makes you the new owner. The current owner will lose access to this organisation. Only proceed if you've agreed to take over this business account.
            </div>
          )}
        </div>

        <div className="ai-body">
          <div className="ai-invitee">
            <Mail size={14} /> <span>{invitation.email}</span>
          </div>

          {isLoggedInAsInvitee ? (
            // ── Branch 1: already signed in as the invitee ──────────────────
            <div className="ai-branch">
              <p className="ai-lead">
                <CheckCircle2 size={16} /> You're signed in as <strong>{currentUser.email}</strong>.
              </p>
              <button
                type="button"
                className="ai-btn ai-btn--primary"
                onClick={() => handleAccept()}
                disabled={submitting}
              >
                {submitting
                  ? 'Accepting…'
                  : (isTransfer ? 'Accept Transfer' : 'Accept Invitation')}
              </button>
            </div>
          ) : invitation.existingAccount ? (
            // ── Branch 2: email already has an account, not logged in ───────
            <div className="ai-branch">
              <p className="ai-lead">
                <LogIn size={16} /> This email already has a Storeveu account. Sign in to accept.
              </p>
              <Link
                to={`/login?returnTo=${encodeURIComponent(`/invite/${token}`)}`}
                className="ai-btn ai-btn--primary"
              >
                Sign in to accept
              </Link>
              <p className="ai-muted">After signing in you'll be returned here to confirm.</p>
            </div>
          ) : (
            // ── Branch 3: brand new user — inline signup ────────────────────
            <form onSubmit={handleSignupSubmit} className="ai-form">
              <p className="ai-lead">
                <UserPlus size={16} /> Create your account to continue.
              </p>

              <div className="ai-field">
                <label>Full name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Jamie Chen"
                  autoFocus
                  required
                />
              </div>

              <div className="ai-field">
                <label>Create a password</label>
                <div className="ai-pw-wrap">
                  <Lock size={14} className="ai-pw-icon" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Create a password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                  <button type="button" className="ai-pw-eye" onClick={() => setShowPw(v => !v)}>
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <PasswordRules value={password} />
              </div>

              <div className="ai-field">
                <label>Confirm password</label>
                <div className="ai-pw-wrap">
                  <Lock size={14} className="ai-pw-icon" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Re-enter password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </div>
                {confirm.length > 0 && confirm !== password && (
                  <p className="ai-pw-hint ai-pw-hint--err">Passwords don't match yet</p>
                )}
              </div>

              <button type="submit" className="ai-btn ai-btn--primary" disabled={submitting}>
                {submitting ? 'Creating account…' : 'Create account & accept'}
              </button>

              <p className="ai-muted">
                By creating an account you agree to Storeveu's terms. We'll sign you in automatically once the account is created.
              </p>
            </form>
          )}
        </div>

        <div className="ai-footer">
          <span>Invitation expires {formatDate(invitation.expiresAt)}</span>
        </div>
      </div>
    </AcceptLayout>
  );
}

function AcceptLayout({ children }) {
  return (
    <div className="ai-root">
      <div className="ai-backdrop" />
      <div className="ai-shell">
        {children}
      </div>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Inline password-rule indicator. Collapses to a single muted hint line
// until the user starts typing, then lights up each rule as it's satisfied.
// Matches the backend policy in `backend/src/utils/validators.js`.
function PasswordRules({ value }) {
  const rules = [
    { label: '8+ characters', pass: value.length >= 8 },
    { label: 'uppercase',     pass: /[A-Z]/.test(value) },
    { label: 'lowercase',     pass: /[a-z]/.test(value) },
    { label: 'digit',         pass: /\d/.test(value) },
    { label: 'symbol',        pass: /[^A-Za-z0-9]/.test(value) },
  ];
  if (!value) {
    return <p className="ai-pw-hint">8+ chars with upper, lower, number, and symbol</p>;
  }
  return (
    <ul className="ai-pw-rules">
      {rules.map(r => (
        <li key={r.label} className={r.pass ? 'ai-pw-rule--ok' : 'ai-pw-rule--pending'}>
          <span className="ai-pw-rule-dot">{r.pass ? '✓' : '·'}</span> {r.label}
        </li>
      ))}
    </ul>
  );
}
