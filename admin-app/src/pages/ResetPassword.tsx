import { useState, FormEvent } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Lock, ArrowLeft, CheckCircle, Eye, EyeOff, ShieldCheck, Loader } from 'lucide-react';
import { toast } from 'react-toastify';
import { resetPassword } from '../services/api';
import StoreveuLogo from '../components/StoreveuLogo';
import './ForgotPassword.css';
import './ResetPassword.css';

// Mirror backend policy — keep in sync with backend/src/utils/validators.ts
const PASSWORD_RE =
  /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-={}[\]:;"'<>,.?/\\|`~]).{8,128}$/;

const checkStrength = (pw: string) => {
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

  const validate = (): string => {
    if (!token) return 'Missing or invalid reset link. Please request a new one.';
    if (!PASSWORD_RE.test(password)) {
      return 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.';
    }
    if (password !== confirm) return 'Passwords do not match.';
    return '';
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = validate();
    if (v) { setError(v); return; }
    setError('');
    setLoading(true);
    try {
      await resetPassword({ token, password });
      setDone(true);
      toast.success('Password reset successful!');
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      const msg = axiosErr.response?.data?.error || 'Failed to reset password. The link may be expired.';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="al-page">
        <div className="al-card afp-card-success">
          <div className="afp-success-icon"><CheckCircle size={42} /></div>
          <h1 className="afp-success-title">Password reset!</h1>
          <p className="afp-success-msg">Your password has been updated. Redirecting you to sign in…</p>
          <Link to="/login" className="al-btn afp-back-btn">
            <ArrowLeft size={16} /> Go to Log In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="al-page">
      <div className="al-card">
        <div className="al-header">
          <div className="al-logo"><StoreveuLogo height={44} darkMode={true} showTagline={true} /></div>
          <h1 className="al-title">Set New Password</h1>
          <p className="al-subtitle">Choose a strong password for your admin account</p>
        </div>

        {!token && (
          <div className="arp-error-banner">
            This reset link is missing a token. Please request a new password reset email.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="al-field">
            <label className="al-label">New Password</label>
            <div className="al-input-wrap">
              <span className="al-input-icon"><Lock size={18} /></span>
              <input
                type={show ? 'text' : 'password'}
                className="al-input arp-input"
                placeholder="Enter new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <button type="button" className="al-pw-eye" onClick={() => setShow((v) => !v)}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {password && (
              <div className="arp-strength">
                <div className={`arp-strength-bar arp-strength-bar--${strength.score}`} />
                <span className="arp-strength-label">{strength.label}</span>
              </div>
            )}
          </div>

          <div className="al-field">
            <label className="al-label">Confirm Password</label>
            <div className="al-input-wrap">
              <span className="al-input-icon"><ShieldCheck size={18} /></span>
              <input
                type={show ? 'text' : 'password'}
                className="al-input"
                placeholder="Re-enter new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          <ul className="arp-rules">
            <li className={password.length >= 8 ? 'arp-ok' : ''}>At least 8 characters</li>
            <li className={/[A-Z]/.test(password) ? 'arp-ok' : ''}>One uppercase letter</li>
            <li className={/[a-z]/.test(password) ? 'arp-ok' : ''}>One lowercase letter</li>
            <li className={/\d/.test(password) ? 'arp-ok' : ''}>One number</li>
            <li className={/[!@#$%^&*()_+\-={}[\]:;"'<>,.?/\\|`~]/.test(password) ? 'arp-ok' : ''}>One special character</li>
          </ul>

          {error && <p className="arp-error-block">{error}</p>}

          <button type="submit" className="al-btn" disabled={loading || !token}>
            {loading
              ? <><Loader size={16} className="al-spin" /> Resetting…</>
              : <>Reset Password</>
            }
          </button>
        </form>

        <div className="afp-footer">
          <Link to="/login" className="afp-back-link">
            <ArrowLeft size={14} /> Back to Log In
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
