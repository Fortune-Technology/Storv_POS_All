import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, LogIn, ChevronRight, Loader, Eye, EyeOff } from 'lucide-react';
import { login } from '../services/api';
import { toast } from 'react-toastify';
import StoreveuLogo from '../components/StoreveuLogo';
import './Login.css';

const Login = () => {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  // Surface any auth diagnostic that was stashed by a 401 redirect upstream
  // (e.g. EcomSetup hitting ecom-backend with a JWT the server can't verify).
  // Read once on mount and clear so a fresh login attempt doesn't keep
  // showing a stale message.
  const [authDiag, setAuthDiag] = useState(() => {
    try {
      const raw = sessionStorage.getItem('storv:auth-diag');
      if (!raw) return null;
      sessionStorage.removeItem('storv:auth-diag');
      return JSON.parse(raw);
    } catch { return null; }
  });
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await login(formData);
      // Wipe any leftover InactivityLock state from a previous session in this
      // browser. Otherwise the new login could land into an immediate lock
      // demanding the previous user's password.
      localStorage.removeItem('storv:il:locked');
      localStorage.removeItem('storv:il:lastActive');
      localStorage.removeItem('storv:il:lockedFor');
      localStorage.setItem('user', JSON.stringify(data));
      // Notify StoreProvider (and anything else listening) so it reloads stores
      // immediately — otherwise the sidebar's active-store card stays empty
      // until the user hard-refreshes.
      window.dispatchEvent(new Event('storv:auth-change'));
      toast.success('Welcome back!');
      navigate('/portal/realtime');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lg-page">
      <div className="glass-card animate-fade-in lg-card">
        <div className="lg-header">
          <Link to="/" className="lg-back-home">
            ← Back to Home
          </Link>
          <div className="lg-logo-row">
            <StoreveuLogo height={44} darkMode={true} showTagline={true} />
          </div>
          <h1 className="lg-title">
            Portal Login
          </h1>
          <p className="lg-subtitle">Enter your credentials to access the portal</p>
        </div>

        {authDiag && (
          <div style={{
            margin: '0 0 1rem',
            padding: '0.75rem 1rem',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: 8,
            color: '#fca5a5',
            fontSize: '0.82rem',
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            wordBreak: 'break-word',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4, fontFamily: 'inherit' }}>
              Auth diagnostic ({authDiag.source})
            </div>
            <div>{authDiag.method} {authDiag.path} → {authDiag.status}</div>
            <div>response: {authDiag.body || '(empty)'}</div>
            <div style={{ marginTop: 6, opacity: 0.75, fontSize: '0.75rem' }}>
              {authDiag.when}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div className="lg-input-wrap">
              <span className="lg-input-icon"><Mail size={18} /></span>
              <input
                type="email"
                className="form-input lg-input-icon-pad"
                placeholder="name@company.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label lg-label-between">
              Password
              <Link to="/forgot-password" className="lg-forgot-link">Forgot password?</Link>
            </label>
            <div className="lg-input-wrap">
              <span className="lg-input-icon"><Lock size={18} /></span>
              <input
                type={showPw ? 'text' : 'password'}
                className="form-input lg-input-icon-pad"
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
              />
              <button type="button" className="lg-eye-btn" onClick={() => setShowPw(!showPw)} tabIndex={-1}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary lg-submit" disabled={loading}>
            {loading ? <Loader className="animate-spin" /> : <>Log In <ChevronRight size={18} className="lg-submit-icon" /></>}
          </button>
        </form>

        <div className="lg-footer">
          Don't have an account? <Link to="/signup" className="lg-signup-link">Create account</Link>
        </div>
      </div>
    </div>
  );
};

export default Login;
