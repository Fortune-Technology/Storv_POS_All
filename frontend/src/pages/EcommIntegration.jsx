/**
 * EcommIntegration — Coming Soon page for eCommerce / Delivery platform integrations.
 * Displays platform cards for Grubhub, Instacart, DoorDash, Uber Eats, and more.
 */

import React from 'react';
import Sidebar from '../components/Sidebar';
import { Clock, Zap, Bell } from 'lucide-react';

// ── Platform data ─────────────────────────────────────────────────────────────
const PLATFORMS = [
  {
    name: 'DoorDash',
    color: '#FF3008',
    bg: 'rgba(255,48,8,0.08)',
    border: 'rgba(255,48,8,0.2)',
    desc: 'Menu sync, real-time order routing, and live inventory updates.',
    logo: (
      <svg viewBox="0 0 120 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 110, height: 36 }}>
        <circle cx="20" cy="20" r="16" fill="#FF3008" />
        <path d="M13 20.5C13 17.5 15.5 15 18.5 15H25C28 15 30 17 30 20S28 25 25 25H18.5C15.5 25 13 22.5 13 20.5Z" fill="white" />
        <circle cx="20" cy="20" r="3" fill="#FF3008" />
        <text x="42" y="26" fontFamily="Arial" fontWeight="800" fontSize="16" fill="#FF3008">DoorDash</text>
      </svg>
    ),
  },
  {
    name: 'Uber Eats',
    color: '#06C167',
    bg: 'rgba(6,193,103,0.08)',
    border: 'rgba(6,193,103,0.2)',
    desc: 'Two-way menu management and automated order acceptance.',
    logo: (
      <svg viewBox="0 0 130 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 120, height: 36 }}>
        <rect width="36" height="36" rx="8" fill="#000" y="2" />
        <text x="9" y="26" fontFamily="Arial" fontWeight="900" fontSize="19" fill="#06C167">U</text>
        <text x="44" y="26" fontFamily="Arial" fontWeight="800" fontSize="15" fill="#06C167">Uber Eats</text>
      </svg>
    ),
  },
  {
    name: 'Instacart',
    color: '#43B02A',
    bg: 'rgba(67,176,42,0.08)',
    border: 'rgba(67,176,42,0.2)',
    desc: 'Grocery delivery with live stock levels and price sync.',
    logo: (
      <svg viewBox="0 0 130 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 120, height: 36 }}>
        <circle cx="18" cy="20" r="14" fill="#43B02A" />
        <path d="M18 12C18 12 13 16 13 20C13 23.3 15.2 26 18 26C20.8 26 23 23.3 23 20C23 16 18 12 18 12Z" fill="white" />
        <circle cx="18" cy="20" r="3.5" fill="#43B02A" />
        <circle cx="23" cy="14" r="2" fill="white" />
        <text x="38" y="26" fontFamily="Arial" fontWeight="800" fontSize="15" fill="#43B02A">Instacart</text>
      </svg>
    ),
  },
  {
    name: 'Grubhub',
    color: '#F63440',
    bg: 'rgba(246,52,64,0.08)',
    border: 'rgba(246,52,64,0.2)',
    desc: 'Full menu publishing, order intake, and delivery tracking.',
    logo: (
      <svg viewBox="0 0 120 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 110, height: 36 }}>
        <rect width="36" height="36" rx="10" fill="#F63440" y="2" />
        <text x="7" y="28" fontFamily="Arial" fontWeight="900" fontSize="20" fill="white">G</text>
        <text x="44" y="26" fontFamily="Arial" fontWeight="800" fontSize="15" fill="#F63440">Grubhub</text>
      </svg>
    ),
  },
  {
    name: 'Gopuff',
    color: '#5B2D8E',
    bg: 'rgba(91,45,142,0.08)',
    border: 'rgba(91,45,142,0.2)',
    desc: 'Instant delivery with automated inventory management.',
    logo: (
      <svg viewBox="0 0 110 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 100, height: 36 }}>
        <rect width="36" height="36" rx="10" fill="#5B2D8E" y="2" />
        <text x="7" y="28" fontFamily="Arial" fontWeight="900" fontSize="20" fill="white">g</text>
        <text x="44" y="26" fontFamily="Arial" fontWeight="800" fontSize="15" fill="#5B2D8E">Gopuff</text>
      </svg>
    ),
  },
  {
    name: 'Amazon Fresh',
    color: '#FF9900',
    bg: 'rgba(255,153,0,0.08)',
    border: 'rgba(255,153,0,0.2)',
    desc: 'Sync your catalog with Amazon Fresh for same-day delivery.',
    logo: (
      <svg viewBox="0 0 145 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 135, height: 36 }}>
        <rect width="36" height="36" rx="8" fill="#232F3E" y="2" />
        <text x="6" y="27" fontFamily="Arial" fontWeight="900" fontSize="18" fill="#FF9900">a</text>
        <path d="M9 30 Q18 34 27 30" stroke="#FF9900" strokeWidth="2" fill="none" strokeLinecap="round" />
        <text x="44" y="26" fontFamily="Arial" fontWeight="800" fontSize="14" fill="#232F3E">Amazon Fresh</text>
      </svg>
    ),
  },
];

// ── Feature bullets ───────────────────────────────────────────────────────────
const FEATURES = [
  { icon: '🔄', label: 'Real-time menu & price sync across all platforms' },
  { icon: '📦', label: 'Automatic stock-out detection & item pausing' },
  { icon: '🧾', label: 'Unified order dashboard — all platforms in one view' },
  { icon: '📊', label: 'Cross-platform sales analytics & commission reports' },
  { icon: '🚀', label: 'One-click onboarding per platform — no manual setup' },
  { icon: '🔒', label: 'Secure OAuth token management per integration' },
];

// ── Page ─────────────────────────────────────────────────────────────────────
export default function EcommIntegration() {
  return (
    <div className="layout-container">
      <Sidebar />

      <div className="main-content" style={{ overflow: 'auto', background: 'var(--bg-primary, #0f1117)' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '2.5rem 2rem 4rem' }}>

          {/* ── Header ── */}
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'rgba(122,193,67,0.10)', border: '1px solid rgba(122,193,67,0.3)',
              borderRadius: 99, padding: '5px 14px', marginBottom: 20,
            }}>
              <Clock size={12} color="#7ac143" />
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#7ac143', letterSpacing: '0.06em' }}>
                COMING SOON
              </span>
            </div>

            <h1 style={{
              margin: '0 0 12px',
              fontSize: 'clamp(1.8rem, 4vw, 2.6rem)',
              fontWeight: 900,
              color: 'var(--text-primary, #f1f5f9)',
              lineHeight: 1.15,
            }}>
              eCommerce &amp; Delivery<br />
              <span style={{ color: '#7ac143' }}>Platform Integrations</span>
            </h1>

            <p style={{
              margin: '0 auto',
              maxWidth: 540,
              fontSize: '1rem',
              color: 'var(--text-muted, #94a3b8)',
              lineHeight: 1.6,
            }}>
              Connect your store to the biggest delivery platforms. Sync menus, manage orders,
              and track performance — all from one place.
            </p>
          </div>

          {/* ── Platform cards ── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))',
            gap: 16,
            marginBottom: '3rem',
          }}>
            {PLATFORMS.map(p => (
              <div
                key={p.name}
                style={{
                  background: '#ffffff',
                  border: `1.5px solid ${p.border}`,
                  borderRadius: 16,
                  padding: '1.4rem 1.25rem 1.2rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'transform .15s, box-shadow .15s',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 10px 32px ${p.border}`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)'; }}
              >
                {/* Glow blob */}
                <div style={{
                  position: 'absolute', top: -24, right: -24,
                  width: 90, height: 90, borderRadius: '50%',
                  background: p.color, opacity: 0.10, filter: 'blur(22px)',
                  pointerEvents: 'none',
                }} />

                {/* Logo */}
                <div style={{
                  height: 44, display: 'flex', alignItems: 'center',
                  background: p.bg, borderRadius: 10, padding: '0 12px',
                }}>
                  {p.logo}
                </div>

                {/* Description */}
                <p style={{
                  margin: 0, fontSize: '0.8rem',
                  color: '#64748b', lineHeight: 1.5,
                }}>
                  {p.desc}
                </p>

                {/* Coming soon badge */}
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
                  background: p.bg, border: `1px solid ${p.border}`,
                  borderRadius: 6, padding: '3px 10px',
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, color: p.color, letterSpacing: '0.04em' }}>
                    Coming Soon
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* ── What's included ── */}
          <div style={{
            background: '#ffffff',
            border: '1.5px solid rgba(122,193,67,0.25)',
            borderRadius: 16,
            padding: '1.75rem 2rem',
            marginBottom: '2rem',
            boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
              <Zap size={14} color="#7ac143" />
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#7ac143', letterSpacing: '0.06em' }}>
                WHAT'S INCLUDED
              </span>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '0.75rem 2rem',
            }}>
              {FEATURES.map(f => (
                <div key={f.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: '1rem', flexShrink: 0, lineHeight: 1.4 }}>{f.icon}</span>
                  <span style={{ fontSize: '0.82rem', color: '#475569', lineHeight: 1.45 }}>
                    {f.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Notify CTA ── */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(122,193,67,0.08) 0%, rgba(16,185,129,0.05) 100%)',
            border: '1px solid rgba(122,193,67,0.2)',
            borderRadius: 16,
            padding: '1.75rem 2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
            flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: 'rgba(122,193,67,0.15)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Bell size={20} color="#7ac143" />
              </div>
              <div>
                <div style={{ fontWeight: 800, color: 'var(--text-primary, #f1f5f9)', fontSize: '0.95rem', marginBottom: 3 }}>
                  Be the first to know
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #94a3b8)' }}>
                  We'll notify you as soon as integrations are live for your store.
                </div>
              </div>
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '9px 20px', borderRadius: 10, cursor: 'default',
              background: 'rgba(122,193,67,0.15)', border: '1px solid rgba(122,193,67,0.3)',
              color: '#7ac143', fontWeight: 700, fontSize: '0.82rem', flexShrink: 0,
            }}>
              <Clock size={13} />
              In Development
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
