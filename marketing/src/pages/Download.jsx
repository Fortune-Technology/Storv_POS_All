/**
 * Download — public landing page for the StoreVeu Cashier App installer.
 *
 * Installer is bundled directly into the marketing site's public/downloads
 * folder (copied from cashier-app/dist-electron after each build). Vite
 * serves it at /downloads/StoreVeu-POS-Setup.exe — no GitHub Releases API
 * fetch, no version detection, just a static file.
 *
 * To update: rebuild the cashier-app installer, then copy
 *   cashier-app/dist-electron/StoreVeu POS Setup X.Y.Z.exe
 *   → marketing/public/downloads/StoreVeu-POS-Setup.exe
 */
import React, { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import {
  Download as DownloadIcon, Monitor, Apple, HardDrive, Wifi,
  Shield, Zap, CheckCircle2, ArrowRight,
} from 'lucide-react';
import MarketingNavbar from '../components/marketing/MarketingNavbar';
import MarketingFooter from '../components/marketing/MarketingFooter';
import MarketingSection from '../components/marketing/MarketingSection';
import MarketingButton from '../components/marketing/MarketingButton';
import SEO from '../components/SEO';
import './Download.css';

// ── FadeIn helper (matches About/Features pattern) ──────────────────────
const FadeIn = ({ children, className, delay = 0 }) => {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 28 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {children}
    </motion.div>
  );
};

// Hardcoded local installer path — file lives at marketing/public/downloads/
// and is served by Vite at /downloads/StoreVeu-POS-Setup.exe.
const DOWNLOAD_URL_WIN = '/downloads/StoreVeu-POS-Setup.exe';
const DOWNLOAD_URL_MAC = '';

const REQUIREMENTS = [
  { icon: HardDrive, title: 'Windows 10 or newer (64-bit)', sub: '4 GB RAM minimum, 500 MB disk space' },
  { icon: Wifi, title: 'Internet for initial setup', sub: 'Runs offline after first sync — transactions queue and upload automatically' },
  { icon: Monitor, title: 'Touchscreen or mouse + keyboard', sub: 'Designed for 1366×768 POS terminals up to 4K desktops' },
];

const FEATURES = [
  'Offline-first — no checkout blocked when the internet drops',
  'USB + network receipt printers, cash drawers, and barcode scanners',
  'Lottery, fuel, EBT/SNAP, age verification built in',
  'Customer display screen support (secondary monitor)',
  'Free updates — auto-updates through the installer',
];

const Download = () => {
  return (
    <div className="download-page">
      <SEO
        title="Download Cashier App"
        description="Download the StoreVeu Cashier App — offline-first POS terminal for Windows. Free with every plan."
        url="https://storeveu.com/download"
      />
      <MarketingNavbar />

      {/* ═══ HERO ═══ */}
      <section className="dl-hero">
        <div className="dl-hero-bg" />
        <div className="mkt-container">
          <FadeIn className="dl-hero-content">
            <span className="dl-badge">Cashier App · Windows</span>
            <h1>
              Ring up sales anywhere {' '}
              <span className="text-gradient">online or off.</span>
            </h1>
            <p>
              The StoreVeu Cashier App turns any Windows PC into a full-featured POS terminal.
              Offline-first, hardware-ready, and free with every StoreVeu plan.
            </p>
            <div className="dl-hero-actions">
              <MarketingButton href={DOWNLOAD_URL_WIN} size="lg" icon={DownloadIcon}>
                Download for Windows
              </MarketingButton>
              {DOWNLOAD_URL_MAC ? (
                <MarketingButton href={DOWNLOAD_URL_MAC} variant="secondary" size="lg" icon={Apple}>
                  Download for Mac
                </MarketingButton>
              ) : (
                <span className="dl-mac-hint">
                  <Apple size={14} /> Mac build coming soon
                </span>
              )}
            </div>
            <p className="dl-hero-trust">
              Free to install. Sign in with your StoreVeu account —{' '}
              <a href="/contact">book a demo</a> if you don't have one.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ═══ SYSTEM REQUIREMENTS ═══ */}
      <MarketingSection bgVariant="white">
        <FadeIn className="dl-section-head">
          <h2>
            System <span className="text-gradient">Requirements</span>
          </h2>
          <p>Runs on the POS hardware you already have.</p>
        </FadeIn>
        <div className="dl-req-grid">
          {REQUIREMENTS.map((r, i) => (
            <FadeIn key={i} className="dl-req-card" delay={i * 0.06}>
              <div className="dl-req-icon"><r.icon size={22} /></div>
              <h3>{r.title}</h3>
              <p>{r.sub}</p>
            </FadeIn>
          ))}
        </div>
      </MarketingSection>

      {/* ═══ WHAT'S INCLUDED ═══ */}
      <MarketingSection>
        <FadeIn className="dl-section-head">
          <h2>
            What's <span className="text-gradient">in the app</span>
          </h2>
          <p>Full POS functionality — no browser required once installed.</p>
        </FadeIn>
        <FadeIn className="dl-feature-list-wrap" delay={0.08}>
          <ul className="dl-feature-list">
            {FEATURES.map((f, i) => (
              <li key={i}><CheckCircle2 size={18} /> {f}</li>
            ))}
          </ul>
        </FadeIn>
        <div className="dl-feature-cards">
          <FadeIn className="dl-feature-card" delay={0.1}>
            <Zap size={22} /> <strong>Fast checkout</strong>
            <p>IndexedDB-cached catalog means scans resolve in &lt; 50 ms even offline.</p>
          </FadeIn>
          <FadeIn className="dl-feature-card" delay={0.15}>
            <Shield size={22} /> <strong>Compliance built-in</strong>
            <p>Age verification, EBT/SNAP rules, bottle deposits, and lottery flows handled automatically.</p>
          </FadeIn>
        </div>
      </MarketingSection>

      {/* ═══ FINAL CTA ═══ */}
      <MarketingSection className="dl-final">
        <FadeIn className="dl-final-inner">
          <h2>
            Ready to <span className="text-gradient">install?</span>
          </h2>
          <p>Grab the installer, sign in, and you're ringing up sales in under 5 minutes.</p>
          <div className="dl-hero-actions dl-hero-actions--center">
            <MarketingButton href={DOWNLOAD_URL_WIN} size="lg" icon={DownloadIcon}>
              Download for Windows
            </MarketingButton>
            <MarketingButton href="/contact" variant="secondary" size="lg" icon={ArrowRight}>
              Talk to Sales
            </MarketingButton>
          </div>
        </FadeIn>
      </MarketingSection>

      <MarketingFooter />
    </div>
  );
};

export default Download;
