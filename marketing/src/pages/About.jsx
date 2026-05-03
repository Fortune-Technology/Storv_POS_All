import React, { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import MarketingNavbar from '../components/marketing/MarketingNavbar';
import MarketingFooter from '../components/marketing/MarketingFooter';
import MarketingSection from '../components/marketing/MarketingSection';
import MarketingButton from '../components/marketing/MarketingButton';
import ssLiveDashboard from '../assets/Store_Dashboard/LiveDashboard.png';
import {
  Lightbulb, DollarSign, Brain, ShieldCheck, Layers, WifiOff, TrendingUp, ArrowRight,
} from 'lucide-react';
import SEO from '../components/SEO';
import './About.css';

const FadeIn = ({ children, className, delay = 0 }) => {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div ref={ref} className={className} initial={{ opacity: 0, y: 28 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5, delay, ease: [0.25, 0.1, 0.25, 1] }}>
      {children}
    </motion.div>
  );
};

const milestones = [
  { year: '2021', title: 'The Breaking Point', desc: 'After years running independent stores, our founders hit a wall: outdated POS software, paper invoices, and zero real-time visibility.' },
  { year: '2022', title: 'Building the Fix', desc: 'We started building Storeveu in the back office of a real store. First feature: AI invoice scanning.' },
  { year: '2023', title: 'The POS That Gets It', desc: 'Launched our offline-first cashier app with lottery, EBT/SNAP compliance, and direct hardware integration.' },
  { year: '2024', title: 'The Complete Platform', desc: 'Expanded into a full retail OS: portal, AI predictions, vendor auto-ordering, and PAX terminal integration.' },
  { year: '2025', title: 'E-Commerce & Beyond', desc: 'Launched online storefronts, multi-store support, and the 14-factor auto-ordering engine.' },
];

const values = [
  { icon: Lightbulb, title: 'Simplicity', desc: 'One platform replaces five disconnected tools. POS, back-office, analytics, and e-commerce — one login.' },
  { icon: DollarSign, title: 'Affordability', desc: 'Starting at $49/month vs $300+ for legacy systems. No hidden fees, no percentage skimmed.' },
  { icon: Brain, title: 'Intelligence', desc: 'AI invoice OCR, Holt-Winters forecasting, weather correlation, and 14-factor auto-ordering.' },
  { icon: ShieldCheck, title: 'Reliability', desc: 'Offline-first architecture means your POS never goes down. Syncs when connectivity returns.' },
];

const differentiators = [
  { icon: Layers, title: 'Four Apps, One Platform', desc: 'Cashier App, Management Portal, Admin Panel, and Online Storefront — integrated and synced in real time.' },
  { icon: WifiOff, title: 'Offline-First Architecture', desc: 'Your internet goes down during Saturday rush? Storeveu keeps running. No outage, no lost sales.' },
  { icon: TrendingUp, title: 'AI That Actually Helps', desc: 'Invoice OCR, Holt-Winters forecasting with weather data, and a 14-factor auto-ordering engine.' },
];

const team = [
  { name: 'A.P.', role: 'Founder & CEO', initials: 'AP', color: 'var(--accent-primary)' },
  { name: 'M.J.', role: 'Chief Architect', initials: 'MJ', color: '#3b82f6' },
  { name: 'S.R.', role: 'Head of Growth', initials: 'SR', color: '#ef4444' },
  { name: 'K.L.', role: 'Product Design', initials: 'KL', color: '#f59e0b' },
];

const About = () => (
  <div className="about-page">
    <SEO
      title="About Us"
      description="Built by store owners who were tired of overpaying for bad software. Storeveu replaces 5+ disconnected tools with one affordable platform."
      url="https://storeveu.com/about"
      jsonLd={{ '@context': 'https://schema.org', '@type': 'Organization', name: 'Storeveu', url: 'https://storeveu.com', foundingDate: '2022' }}
    />
    <MarketingNavbar />

    {/* ═══ HERO ═══ */}
    <section className="ab-hero">
      <div className="ab-hero-bg" />
      <div className="mkt-container">
        <FadeIn className="ab-hero-content">
          <h1>Built by Store Owners.{' '}<span className="ab-gradient">For Store Owners.</span></h1>
          <p>We spent years running independent retail stores and paying for software that didn't work. So we built the platform we wished existed.</p>
          <div className="ab-hero-stats">
            <div className="ab-stat"><span className="ab-stat-num">4</span><span className="ab-stat-label">Integrated Apps</span></div>
            <div className="ab-stat-divider" />
            <div className="ab-stat"><span className="ab-stat-num">99.9%</span><span className="ab-stat-label">Uptime</span></div>
            <div className="ab-stat-divider" />
            <div className="ab-stat"><span className="ab-stat-num">$49</span><span className="ab-stat-label">Starting / mo</span></div>
          </div>
        </FadeIn>
      </div>
    </section>

    {/* ═══ STORY ═══ */}
    <MarketingSection bgVariant="white">
      <FadeIn className="ab-story">
        <div className="ab-story-text">
          <h2>We Sat on Your Side of the Counter</h2>
          <p>
            Our founders spent years running convenience, grocery, and liquor stores. They knew every corner of the business — and the frustration of paying $300+/month for POS software that barely worked.
          </p>
          <p>
            Nothing was purpose-built for the independent store owner who is also the buyer, the manager, the cashier, and the bookkeeper. So we built it ourselves, in the back office of a real store.
          </p>
          <p>
            Today Storeveu is a complete retail operating system: four integrated applications covering POS, back-office, admin, and e-commerce. Offline-first so your register never stops. AI-powered so you spend less time on paperwork.
          </p>
        </div>
        <div className="ab-story-visual">
          <div className="ab-story-browser">
            <div className="ab-browser-bar">
              <span className="ab-dot ab-dot-r" /><span className="ab-dot ab-dot-y" /><span className="ab-dot ab-dot-g" />
            </div>
            <img src={ssLiveDashboard} alt="Storeveu Dashboard" loading="lazy" />
          </div>
        </div>
      </FadeIn>
    </MarketingSection>

    {/* ═══ VALUES ═══ */}
    <MarketingSection title="Our Core Values" bgVariant="light">
      <div className="ab-values">
        {values.map((v, i) => {
          const Icon = v.icon;
          return (
            <FadeIn key={i} className="ab-value-card" delay={i * 0.06}>
              <div className="ab-value-icon"><Icon size={24} /></div>
              <h3>{v.title}</h3>
              <p>{v.desc}</p>
            </FadeIn>
          );
        })}
      </div>
    </MarketingSection>

    {/* ═══ DIFFERENTIATORS ═══ */}
    <MarketingSection title="Why We're Different" bgVariant="white">
      <div className="ab-diffs">
        {differentiators.map((d, i) => {
          const Icon = d.icon;
          return (
            <FadeIn key={i} className="ab-diff" delay={i * 0.08}>
              <div className="ab-diff-icon"><Icon size={22} /></div>
              <div>
                <h3>{d.title}</h3>
                <p>{d.desc}</p>
              </div>
            </FadeIn>
          );
        })}
      </div>
    </MarketingSection>

    {/* ═══ TIMELINE ═══ */}
    <MarketingSection title="Our Journey" bgVariant="light">
      <div className="ab-timeline">
        {milestones.map((m, i) => (
          <FadeIn key={i} className="ab-tl-item" delay={i * 0.06}>
            <div className="ab-tl-line">
              <div className="ab-tl-dot" />
              {i < milestones.length - 1 && <div className="ab-tl-connector" />}
            </div>
            <div className="ab-tl-content">
              <span className="ab-tl-year">{m.year}</span>
              <h3>{m.title}</h3>
              <p>{m.desc}</p>
            </div>
          </FadeIn>
        ))}
      </div>
    </MarketingSection>

    {/* ═══ TEAM ═══ */}
    <MarketingSection title="The People Behind the Platform" bgVariant="white" id="careers">
      <div className="ab-team">
        {team.map((t, i) => (
          <FadeIn key={i} className="ab-team-card" delay={i * 0.06}>
            <div className="ab-team-avatar" style={{ '--ab-avatar-color': t.color }}>{t.initials}</div>
            <h3>{t.name}</h3>
            <p>{t.role}</p>
          </FadeIn>
        ))}
      </div>
      <div className="ab-team-footer">
        <p>We're always looking for people who've worked retail and want to fix it.</p>
        <MarketingButton variant="ghost" href="/careers" icon={ArrowRight}>View Careers</MarketingButton>
      </div>
    </MarketingSection>

    <MarketingFooter />
  </div>
);

export default About;
