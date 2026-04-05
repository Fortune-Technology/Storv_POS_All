/**
 * StationSetupScreen
 * One-time setup run by a manager on first boot of this register.
 * Steps: 1) Manager email/password login → 2) Pick store → 3) Name this register
 * Result is saved to useStationStore (persists forever in localStorage).
 */

import React, { useState } from 'react';
import { Monitor, ChevronRight, Check, Loader } from 'lucide-react';
import StoreveuLogo from '../components/StoreveuLogo.jsx';
import { useStationStore } from '../stores/useStationStore.js';
import { loginWithPassword, registerStation } from '../api/pos.js';
import api from '../api/client.js';

const field = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,.06)',
  border: '1px solid rgba(255,255,255,.12)',
  borderRadius: 10, color: '#f1f5f9',
  padding: '0.85rem 1rem', fontSize: '1rem',
  outline: 'none',
};

const btn = (active) => ({
  width: '100%', padding: '0.9rem',
  background: active ? '#3d56b5' : 'rgba(255,255,255,.06)',
  color: active ? '#0f1117' : '#475569',
  border: 'none', borderRadius: 10,
  fontWeight: 800, fontSize: '1rem',
  cursor: active ? 'pointer' : 'not-allowed',
  transition: 'background .15s',
});

export default function StationSetupScreen() {
  const setStation = useStationStore(s => s.setStation);

  const [step,          setStep]          = useState(1);
  const [email,         setEmail]         = useState('');
  const [password,      setPassword]      = useState('');
  const [managerToken,  setManagerToken]  = useState('');
  const [stores,        setStores]        = useState([]);
  const [storeId,       setStoreId]       = useState('');
  const [stationName,   setStationName]   = useState('Register 1');
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');

  /* ── Step 1: manager login ── */
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const data  = await loginWithPassword(email, password);
      const user  = data.user || data;
      const role  = user.role;
      if (!['manager', 'owner', 'admin', 'superadmin'].includes(role)) {
        throw new Error('A manager or owner account is required to set up a register.');
      }
      const token = user.token;
      setManagerToken(token);

      // Fetch stores with the manager's token
      const res    = await api.get('/stores', { headers: { Authorization: `Bearer ${token}` } });
      const list   = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
      setStores(list);

      if (list.length === 1) {
        setStoreId(list[0].id || list[0]._id);
        setStep(3);
      } else {
        setStep(2);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 3: register station ── */
  const handleRegister = async (e) => {
    e.preventDefault();
    if (!stationName.trim()) { setError('Please name this register.'); return; }
    setLoading(true); setError('');
    try {
      const result = await registerStation(
        { storeId, name: stationName.trim() },
        managerToken,
      );
      setStation(result); // persists to localStorage, triggers App re-render
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to register station. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const wrap = {
    minHeight: '100vh', background: '#0f1117',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '2rem',
  };
  const card = {
    width: '100%', maxWidth: 460,
    background: '#161922', border: '1px solid rgba(255,255,255,.08)',
    borderRadius: 20, padding: '2.5rem',
  };

  return (
    <div style={wrap}>
      <div style={card}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '2rem' }}>
          <StoreveuLogo iconOnly={true} height={44} darkMode={true} />
          <div>
            <div style={{ color: '#7b95e0', fontWeight: 900, fontSize: '1.1rem' }}>Storeveu POS</div>
            <div style={{ color: '#64748b', fontSize: '0.78rem' }}>Register Setup</div>
          </div>
          {/* Step indicator */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {[1,2,3].map(n => (
              <div key={n} style={{
                width: 8, height: 8, borderRadius: '50%',
                background: step >= n ? '#3d56b5' : 'rgba(255,255,255,.12)',
                transition: 'background .2s',
              }} />
            ))}
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            background: 'rgba(224,63,63,.1)', border: '1px solid rgba(224,63,63,.3)',
            borderRadius: 10, padding: '0.75rem 1rem',
            color: '#f87171', fontSize: '0.85rem', marginBottom: '1.25rem',
          }}>
            {error}
          </div>
        )}

        {/* ── Step 1: Manager login ── */}
        {step === 1 && (
          <form onSubmit={handleLogin}>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              Sign in with a <strong style={{ color: '#f1f5f9' }}>manager or owner</strong> account
              to register this terminal. You only need to do this once.
            </p>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, marginBottom: 6 }}>
                EMAIL
              </label>
              <input
                type="email" required autoFocus
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="manager@store.com"
                style={field}
              />
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, marginBottom: 6 }}>
                PASSWORD
              </label>
              <input
                type="password" required
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={field}
              />
            </div>
            <button type="submit" disabled={loading} style={btn(!loading && email && password)}>
              {loading ? <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <>Continue <ChevronRight size={16} /></>}
            </button>
          </form>
        )}

        {/* ── Step 2: Store picker ── */}
        {step === 2 && (
          <div>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              Which store is this register in?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1.5rem' }}>
              {stores.map(s => {
                const id = s.id || s._id;
                const active = storeId === id;
                return (
                  <button key={id} onClick={() => setStoreId(id)} style={{
                    padding: '1rem', borderRadius: 10, textAlign: 'left',
                    background: active ? 'rgba(122,193,67,.12)' : 'rgba(255,255,255,.04)',
                    border: `2px solid ${active ? '#3d56b5' : 'rgba(255,255,255,.1)'}`,
                    color: active ? '#3d56b5' : '#f1f5f9',
                    cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    transition: 'border-color .15s',
                  }}>
                    {s.name}
                    {active && <Check size={16} />}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => { setError(''); setStep(3); }}
              disabled={!storeId}
              style={btn(!!storeId)}
            >
              Continue <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* ── Step 3: Name the register ── */}
        {step === 3 && (
          <form onSubmit={handleRegister}>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              Give this register a name so cashiers know which till they're on.
            </p>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, marginBottom: 6 }}>
                REGISTER NAME
              </label>
              <input
                type="text" required autoFocus maxLength={30}
                value={stationName}
                onChange={e => setStationName(e.target.value)}
                placeholder="Register 1"
                style={field}
              />
              <p style={{ color: '#475569', fontSize: '0.72rem', marginTop: 6 }}>
                e.g. "Register 1", "Express Lane", "Self-Checkout"
              </p>
            </div>
            <button type="submit" disabled={loading || !stationName.trim()} style={btn(!loading && !!stationName.trim())}>
              {loading
                ? <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} />
                : 'Set Up Register'}
            </button>
          </form>
        )}

      </div>
    </div>
  );
}
