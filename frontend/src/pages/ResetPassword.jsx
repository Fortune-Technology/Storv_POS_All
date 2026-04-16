import React, { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Lock, ArrowLeft, CheckCircle, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { resetPassword } from '../services/api';
import { toast } from 'react-toastify';
import StoreveuLogo from '../components/StoreveuLogo';
import './ForgotPassword.css';
import './ResetPassword.css';

// Mirror backend policy — keep in sync with backend/src/utils/validators.js
const PASSWORD_RE =
  /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-={}[\]:;"'<>,.?/\\|`~]).{8,128}$/;

const checkStrength = (pw) => {
  if (!pw) return { score: 0, label: '' };
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (/[A-Z]/.test(pw)) score += 1;
  if (/[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[!@#$%^&*()_+\-={}[\]:;"'<>,.?/\\|`~]/.test(pw)) score += 1;
  const labels = ['', 'Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score, label: labels[score] || '' };
};

const ResetPassword = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const strength = checkStrength(password);

  const validate = () => {
    if (!token) return 'Missing or invalid reset link. Please request a new one.';
    if (!PASSWORD_RE.test(password)) {
      return 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.';
    }
    if (password !== confirm) return 'Passwords do not match.';
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError('');
    setLoading(true);
    try {
      await resetPassword({ token, password });
      setDone(true);
      toast.success('Password reset successful!');
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      const msg = err?.response?.data?.error || 'Failed to reset password. The link may be expired.';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="fp-page">
        <div className="glass-card animate-fade-in fp-card fp-card--success">
          <div className="fp-success-icon">
            <CheckCircle size={40} />
          </div>
          <h1 className="fp-success-title">Password reset!</h1>
          <p className="fp-success-msg">
            Your password has been updated. Redirecting you to sign in…
          </p>
          <Link to="/login" className="btn btn-secondary fp-back-btn">
            <ArrowLeft size={18} className="fp-back-icon" /> Go to Log In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fp-page">
      <div className="glass-card animate-fade-in fp-card">
        <div className="fp-header">
          <div className="fp-logo-row">
            <StoreveuLogo height={44} darkMode={true} showTagline={true} />
          </div>
          <h1 className="fp-form-title">Set New Password</h1>
          <p className="fp-form-subtitle">Choose a strong password for your account</p>
        </div>

        {!token && (
          <div className="rp-error-banner">
            This reset link is missing a token. Please request a new password reset email.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">New Password</label>
            <div className="fp-input-wrap">
              <span className="fp-input-icon"><Lock size={18} /></span>
              <input
                type={show ? 'text' : 'password'}
                className="form-input fp-input-icon-pad rp-input"
                placeholder="Enter new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                className="rp-eye"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {password && (
              <div className="rp-strength">
                <div className={`rp-strength-bar rp-strength-bar--${strength.score}`} />
                <span className="rp-strength-label">{strength.label}</span>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <div className="fp-input-wrap">
              <span className="fp-input-icon"><ShieldCheck size={18} /></span>
              <input
                type={show ? 'text' : 'password'}
                className="form-input fp-input-icon-pad"
                placeholder="Re-enter new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          <ul className="rp-rules">
            <li className={password.length >= 8 ? 'rp-ok' : ''}>At least 8 characters</li>
            <li className={/[A-Z]/.test(password) ? 'rp-ok' : ''}>One uppercase letter</li>
            <li className={/[a-z]/.test(password) ? 'rp-ok' : ''}>One lowercase letter</li>
            <li className={/\d/.test(password) ? 'rp-ok' : ''}>One number</li>
            <li className={/[!@#$%^&*()_+\-={}[\]:;"'<>,.?/\\|`~]/.test(password) ? 'rp-ok' : ''}>
              One special character
            </li>
          </ul>

          {error && <p className="fp-field-error rp-field-error-block">{error}</p>}

          <button type="submit" className="btn btn-primary fp-submit" disabled={loading || !token}>
            {loading ? 'Resetting…' : 'Reset Password'}
          </button>
        </form>

        <div className="fp-footer">
          <Link to="/login" className="fp-back-link">
            <ArrowLeft size={16} className="fp-back-link-icon" /> Back to Log In
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
