/**
 * EcommIntegration — Coming Soon page for eCommerce / Delivery platform integrations.
 * Displays platform cards for Grubhub, Instacart, DoorDash, Uber Eats, and more.
 */

import React from 'react';
import { Clock, Zap, Bell } from 'lucide-react';
import './EcommIntegration.css';

// ── Platform data ─────────────────────────────────────────────────────────────
const PLATFORMS = [
  {
    name: 'DoorDash',
    color: '#FF3008',
    bg: 'rgba(255,48,8,0.08)',
    border: 'rgba(255,48,8,0.2)',
    desc: 'Menu sync, real-time order routing, and live inventory updates.',
    logo: (
      <svg viewBox="0 0 120 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="ei-svg-logo">
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
      <svg viewBox="0 0 130 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="ei-svg-logo ei-svg-logo--wide">
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
      <svg viewBox="0 0 130 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="ei-svg-logo ei-svg-logo--wide">
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
      <svg viewBox="0 0 120 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="ei-svg-logo">
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
      <svg viewBox="0 0 110 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="ei-svg-logo ei-svg-logo--narrow">
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
      <svg viewBox="0 0 145 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="ei-svg-logo ei-svg-logo--xwide">
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
      <div className="p-page ei-main">
        <div className="ei-container">

          {/* ── Header ── */}
          <div className="ei-header">
            <div className="ei-badge">
              <Clock size={12} color="var(--accent-primary)" />
              <span className="ei-badge-text">COMING SOON</span>
            </div>

            <h1 className="ei-title">
              eCommerce &amp; Delivery<br />
              <span className="ei-title-accent">Platform Integrations</span>
            </h1>

            <p className="ei-desc">
              Connect your store to the biggest delivery platforms. Sync menus, manage orders,
              and track performance — all from one place.
            </p>
          </div>

          {/* ── Platform cards ── */}
          <div className="ei-cards-grid">
            {PLATFORMS.map(p => (
              <div
                key={p.name}
                className="ei-platform-card"
                style={{ borderColor: p.border }}
              >
                {/* Glow blob */}
                <div className="ei-glow" style={{ background: p.color }} />

                {/* Logo */}
                <div className="ei-logo-wrap" style={{ background: p.bg }}>
                  {p.logo}
                </div>

                {/* Description */}
                <p className="ei-platform-desc">{p.desc}</p>

                {/* Coming soon badge */}
                <div className="ei-soon-badge" style={{ background: p.bg, borderColor: p.border }}>
                  <div className="ei-soon-dot" style={{ background: p.color }} />
                  <span className="ei-soon-text" style={{ color: p.color }}>Coming Soon</span>
                </div>
              </div>
            ))}
          </div>

          {/* ── What's included ── */}
          <div className="ei-features-card">
            <div className="ei-features-header">
              <Zap size={14} color="var(--accent-primary)" />
              <span className="ei-features-label">WHAT'S INCLUDED</span>
            </div>
            <div className="ei-features-grid">
              {FEATURES.map(f => (
                <div key={f.label} className="ei-feature-item">
                  <span className="ei-feature-icon">{f.icon}</span>
                  <span className="ei-feature-text">{f.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Notify CTA ── */}
          <div className="ei-notify">
            <div className="ei-notify-left">
              <div className="ei-notify-icon">
                <Bell size={20} color="var(--accent-primary)" />
              </div>
              <div>
                <div className="ei-notify-title">Be the first to know</div>
                <div className="ei-notify-subtitle">
                  We'll notify you as soon as integrations are live for your store.
                </div>
              </div>
            </div>
            <div className="ei-notify-badge">
              <Clock size={13} />
              In Development
            </div>
          </div>

        </div>
      </div>
  );
}
