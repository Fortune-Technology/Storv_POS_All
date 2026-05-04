/**
 * Download — public landing page for the StoreVeu Cashier App installer.
 *
 * Installer URL source (in priority order):
 *   1. VITE_CASHIER_DOWNLOAD_URL env var (production override)
 *   2. VITE_CASHIER_DOWNLOAD_URL_MAC  (when we publish Mac builds)
 *   3. Default placeholder — swap once the installer is hosted
 *
 * Matches the canonical marketing-page layout pattern used by Features /
 * About / Contact: MarketingNavbar → hero (.dl-hero with .dl-hero-bg radial
 * gradient + centred .dl-hero-content inside .mkt-container) → MarketingSection
 * blocks with .text-gradient highlights → MarketingFooter.
 */
import React, { useEffect, useRef, useState } from 'react';
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

// ── Installer hosting ──────────────────────────────────────────────────
// Build output comes from cashier-app/package.json (electron-builder with
// default naming). `productName: "StoreVeu POS"` + version `X.Y.Z` + NSIS
// target → filename "StoreVeu POS Setup X.Y.Z.exe" (GitHub URL-encodes
// spaces as dots → "StoreVeu.POS.Setup.X.Y.Z.exe").
//
// The release is published via GitHub Actions to the `latest-desktop` tag.
// Rather than baking a version at marketing-build time (which would drift
// every time the cashier app rebuilds without us redeploying marketing), we
// query the GitHub Releases API on page load and pull the newest .exe asset
// from the `latest-desktop` release. Always current, no env coupling.
//
// Optional env overrides — only used if set:
//   VITE_CASHIER_DOWNLOAD_URL        → full Windows installer URL (skips fetch)
//   VITE_CASHIER_DOWNLOAD_URL_MAC    → full Mac .dmg URL
//   VITE_CASHIER_GH_REPO             → owner/repo for the API (default below)
const ENV_DOWNLOAD_URL_WIN = import.meta.env.VITE_CASHIER_DOWNLOAD_URL || '';
const ENV_DOWNLOAD_URL_MAC = import.meta.env.VITE_CASHIER_DOWNLOAD_URL_MAC || '';
const GH_REPO = import.meta.env.VITE_CASHIER_GH_REPO || 'Fortune-Technology/Storv_POS_All';
const RELEASE_TAG = 'latest-desktop';

// Fallback: stable alias the workflow's publish-installer job copies to the
// dashboard's downloads dir on every successful build (workflow line ~538).
// Used while the API fetch is in flight, or if rate-limited / offline.
// Override per environment via VITE_CASHIER_FALLBACK_URL.
const FALLBACK_URL_WIN = import.meta.env.VITE_CASHIER_FALLBACK_URL
  || 'https://test.dashboard.storeveu.com/downloads/StoreVeu-POS-Setup.exe';

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

// Fetch latest release once on mount. Rate-limit-aware: the unauthenticated
// GitHub API allows ~60 req/hr per IP — plenty for a marketing landing page.
// On failure (offline, rate-limited, missing release) we silently fall back
// to the stable dashboard alias and a generic version string.
function useLatestInstaller() {
  const [info, setInfo] = useState({
    url: ENV_DOWNLOAD_URL_WIN || FALLBACK_URL_WIN,
    version: 'latest',
    loading: !ENV_DOWNLOAD_URL_WIN,
  });

  useEffect(() => {
    if (ENV_DOWNLOAD_URL_WIN) return;       // explicit override — skip fetch
    let cancelled = false;
    fetch(`https://api.github.com/repos/${GH_REPO}/releases/tags/${RELEASE_TAG}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled || !data) return;
        const exe = (data.assets || []).find(
          a => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.exe')
        );
        // Strip the leading `v` if the tag is something like `v1.0.209`.
        // The `latest-desktop` tag itself isn't a version, so prefer the
        // version embedded in the asset filename ("StoreVeu.POS.Setup.X.Y.Z.exe").
        let version = 'latest';
        if (exe?.name) {
          const m = exe.name.match(/(\d+\.\d+\.\d+)/);
          if (m) version = m[1];
        }
        setInfo({
          url: exe?.browser_download_url || FALLBACK_URL_WIN,
          version,
          loading: false,
        });
      })
      .catch(() => {
        // Silent — fallback URL is already in state.
        if (!cancelled) setInfo(s => ({ ...s, loading: false }));
      });
    return () => { cancelled = true; };
  }, []);

  return info;
}

const Download = () => {
  const { url: DOWNLOAD_URL_WIN, version: DOWNLOAD_VERSION } = useLatestInstaller();
  const DOWNLOAD_URL_MAC = ENV_DOWNLOAD_URL_MAC;
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
          <span className="dl-badge">Cashier App · v{DOWNLOAD_VERSION}</span>
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
