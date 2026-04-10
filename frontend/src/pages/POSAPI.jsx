/**
 * POSAPI — POS System Overview
 * The app now uses its own built-in Storv POS — no external POS sync needed.
 */
import React from 'react';
import { Monitor, CheckCircle, ArrowRight, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function POSAPI() {
  const navigate = useNavigate();

  return (
    <div className="portal-page">
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: '2rem' }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'var(--brand-12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Zap size={22} color="var(--green, var(--accent-primary))" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>POS System</h1>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Built-in Storv POS — no external integrations required
            </p>
          </div>
        </div>

        {/* Status card */}
        <div style={{
          padding: '1.5rem',
          background: 'var(--brand-05)',
          border: '1px solid var(--brand-20)',
          borderRadius: 14,
          marginBottom: '1.5rem',
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <CheckCircle size={28} color="var(--green, var(--accent-primary))" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--green, var(--accent-primary))' }}>
              Storv POS is Active
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 2 }}>
              Your cashier stations connect directly to this portal — real-time sync, no third-party dependencies.
            </div>
          </div>
        </div>

        {/* Feature list */}
        <div style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          overflow: 'hidden',
          marginBottom: '1.5rem',
        }}>
          {[
            { title: 'Station Management', desc: 'Configure and monitor all cashier stations', path: '/portal/pos-config', icon: Monitor },
            { title: 'Transaction History', desc: 'View all past transactions, refunds, and voids', path: '/portal/pos-reports', icon: CheckCircle },
            { title: 'Employee Reports', desc: 'Clock hours, sales totals, and session breakdowns', path: '/portal/pos-reports?tab=employee', icon: CheckCircle },
            { title: 'POS Settings', desc: 'Layout, shortcuts, tax rules, and hardware config', path: '/portal/pos-config', icon: CheckCircle },
          ].map((item, i, arr) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                width: '100%', padding: '1rem 1.25rem',
                background: 'none', border: 'none',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                display: 'flex', alignItems: 'center', gap: 14,
                cursor: 'pointer', textAlign: 'left',
                transition: 'background .12s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.03)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                background: 'var(--bg-input)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <item.icon size={16} color="var(--text-secondary)" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{item.title}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{item.desc}</div>
              </div>
              <ArrowRight size={16} color="var(--text-muted)" />
            </button>
          ))}
        </div>

        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          Storv POS — built in, always connected, no API keys needed.
        </div>
      </div>
    </div>
  );
}
