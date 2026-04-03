import React, { useState } from 'react';
import { LogIn, Eye, EyeOff, Store, AlertCircle } from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore.js';
import { useNavigate } from 'react-router-dom';

export default function LoginScreen() {
  const { login, loading, error } = useAuthStore();
  const navigate = useNavigate();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [netError, setNetError] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setNetError(false);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      if (!err.message || err.message.includes('Network') || err.message.includes('connect')) {
        setNetError(true);
      }
    }
  };

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-base)',
      padding: '1rem',
    }}>
      {/* App identifier — top corner so cashier knows which app this is */}
      <div style={{
        position: 'fixed', top: 16, right: 16,
        fontSize: '0.68rem', color: 'var(--text-muted)',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        POS · localhost:5174
      </div>

      <div style={{
        width: '100%', maxWidth: 400,
        background: 'var(--bg-panel)',
        borderRadius: 'var(--r-xl)',
        border: '1px solid var(--border-light)',
        padding: '2.5rem',
        boxShadow: '0 24px 60px rgba(0,0,0,.5)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'var(--green-dim)', border: '2px solid var(--green-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1rem',
          }}>
            <Store size={28} color="var(--green)" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Future Foods
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 4, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Point of Sale
          </div>
        </div>

        {/* Backend offline warning */}
        {netError && (
          <div style={{
            marginBottom: '1.25rem', padding: '0.75rem 1rem', borderRadius: 8,
            background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.3)',
            display: 'flex', gap: 8, alignItems: 'flex-start',
          }}>
            <AlertCircle size={15} color="var(--amber)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: '0.78rem', color: 'var(--amber)', lineHeight: 1.5 }}>
              <strong>Cannot reach server.</strong> Make sure the backend is running:<br />
              <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem' }}>
                cd backend &amp;&amp; npm run dev
              </code>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Email
            </label>
            <input
              type="email" required autoFocus
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="cashier@store.com"
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'} required
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{ width: '100%', paddingRight: '3rem' }}
              />
              <button type="button" onClick={() => setShowPw(v => !v)} style={{
                position: 'absolute', right: '0.875rem', top: '50%',
                transform: 'translateY(-50%)',
                background: 'none', color: 'var(--text-muted)', padding: 4,
              }}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Auth error */}
          {error && !netError && (
            <div style={{
              marginBottom: '1rem', padding: '0.7rem 1rem', borderRadius: 8,
              background: 'var(--red-dim)', color: 'var(--red)',
              fontSize: '0.82rem', fontWeight: 600,
              display: 'flex', gap: 8, alignItems: 'center',
            }}>
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            width: '100%', padding: '1rem',
            background: 'var(--green)', color: '#fff',
            borderRadius: 10, fontWeight: 800, fontSize: '0.95rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: loading ? 0.7 : 1,
          }}>
            <LogIn size={16} />
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          Use the same credentials as the portal
        </p>
      </div>
    </div>
  );
}
