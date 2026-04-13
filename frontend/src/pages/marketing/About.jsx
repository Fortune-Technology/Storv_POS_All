import React from 'react';
import MarketingNavbar from '../../components/marketing/MarketingNavbar';
import MarketingFooter from '../../components/marketing/MarketingFooter';
import MarketingSection from '../../components/marketing/MarketingSection';
import MarketingButton from '../../components/marketing/MarketingButton';
import {
  Heart,
  Target,
  Users,
  Award,
  Rocket,
  Lightbulb,
  ShieldCheck,
  Zap,
  Star,
  Compass,
  Store,
  DollarSign,
  Handshake,
  Cpu,
  WifiOff,
  BarChart3,
  Brain,
  Layers,
  TrendingUp
} from 'lucide-react';
import SEO from '../../components/SEO';
import './About.css';

const About = () => {
  const milestones = [
    {
      year: '2021',
      title: 'The Breaking Point',
      desc: 'After years running independent grocery and liquor stores, our founders hit a wall: outdated POS software costing $300+/month, paper invoices piling up, and zero real-time visibility into business performance. Something had to change.'
    },
    {
      year: '2022',
      title: 'Building the Fix',
      desc: 'We started building Storeveu in the back office of a real store. First feature: scanning paper invoices with AI so we would never type a vendor price again. We built it for ourselves before we built it for anyone else.'
    },
    {
      year: '2023',
      title: 'The POS That Gets It',
      desc: 'Launched our offline-first cashier app with lottery management, EBT/SNAP compliance, age verification, and direct hardware integration. No bloat. No features you will never use.'
    },
    {
      year: '2024',
      title: 'The Complete Platform',
      desc: 'Expanded from a POS terminal into a full retail operating system: back-office portal, AI-powered sales predictions, vendor auto-ordering, employee management, and direct PAX terminal integration at interchange rates.'
    },
    {
      year: '2025',
      title: 'E-Commerce and Beyond',
      desc: 'Launched built-in online storefronts with real-time inventory sync, multi-store support, and a 14-factor auto-ordering engine. Four integrated applications working together as one platform.'
    }
  ];

  const values = [
    {
      icon: <Lightbulb size={32} />,
      title: 'Simplicity',
      desc: 'One platform replaces five or more disconnected tools. POS, back-office, analytics, vendor management, and e-commerce all live under one roof with one login.'
    },
    {
      icon: <DollarSign size={32} />,
      title: 'Affordability',
      desc: 'Starting at $49/month versus $300+ for legacy systems. No hidden fees, no percentage skimmed off your transactions, no expensive hardware lock-in.'
    },
    {
      icon: <Brain size={32} />,
      title: 'Intelligence',
      desc: 'AI-powered invoice OCR, Holt-Winters sales forecasting, weather-correlated predictions, and a 14-factor auto-ordering engine that learns your store.'
    },
    {
      icon: <ShieldCheck size={32} />,
      title: 'Reliability',
      desc: 'Offline-first architecture means your POS never goes down. The cashier app works without internet and syncs when connectivity returns. Your store keeps running no matter what.'
    }
  ];

  const team = [
    { name: 'A.P.', role: 'Founder & CEO', initials: 'AP', color: 'var(--accent-primary)' },
    { name: 'M.J.', role: 'Chief Architect', initials: 'MJ', color: '#3b82f6' },
    { name: 'S.R.', role: 'Head of Growth', initials: 'SR', color: 'var(--error)' },
    { name: 'K.L.', role: 'Product Design', initials: 'KL', color: '#f8c01d' }
  ];

  const differentiators = [
    {
      icon: <Layers size={28} />,
      title: 'Four Apps, One Platform',
      desc: 'Most retailers juggle a POS terminal, a separate back-office tool, a standalone analytics dashboard, and a third-party e-commerce site. Storeveu integrates all four into a single platform: the Cashier App for the register, the Portal for back-office management, the Admin Panel for multi-store oversight, and a built-in Online Storefront that syncs inventory in real time.'
    },
    {
      icon: <WifiOff size={28} />,
      title: 'Offline-First Architecture',
      desc: 'Your internet goes down during Saturday rush. With legacy cloud POS systems, you are stuck. Storeveu keeps running. The cashier app stores your full product catalog locally, processes transactions offline, and syncs everything when connectivity returns. No outage, no lost sales, no panic.'
    },
    {
      icon: <TrendingUp size={28} />,
      title: 'AI That Actually Helps',
      desc: 'Invoice OCR that reads vendor paperwork so you never retype prices. Holt-Winters forecasting that predicts tomorrow\'s sales using weather data, day-of-week patterns, and holiday calendars. A 14-factor auto-ordering engine that generates purchase orders based on sales velocity, lead times, and shelf life. Intelligence built for the store floor, not a boardroom.'
    }
  ];

  return (
    <div className="about-page">
      <SEO
        title="About Us"
        description="Built by store owners who were tired of overpaying for bad software. Storeveu replaces 5+ disconnected tools with one affordable platform."
        url="https://storeveu.com/about"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Organization",
          "name": "Storeveu",
          "url": "https://storeveu.com",
          "description": "Modern POS and retail management platform for independent stores.",
          "foundingDate": "2022"
        }}
      />
      <MarketingNavbar />

      {/* Hero */}
      <section className="about-hero">
        <div className="mkt-container">
          <div className="about-hero-content">
            <h1 className="about-title">Built by Store Owners. <span className="text-gradient">For Store Owners.</span></h1>
            <p className="about-subtitle">
              We spent years running independent retail stores and paying for software that did not work for us. So we built the platform we wished existed: a complete retail operating system that replaces five disconnected tools with one affordable, intelligent platform.
            </p>
          </div>
        </div>
      </section>

      {/* Mission / Story */}
      <MarketingSection bgVariant="white">
        <div className="about-story-grid">
          <div className="story-content">
            <h2>We Sat on Your Side of the Counter</h2>
            <p>
              Our founders spent years running independent convenience, grocery, and liquor stores. They knew every corner of the business: early morning deliveries, vendor invoices stacked on the back desk, end-of-night cash counts, and the frustration of paying $300+ per month for POS software that barely worked while juggling separate tools for inventory, analytics, and vendor management.
            </p>
            <p>
              The tools that existed were either built for enterprise chains with dedicated IT departments, or they were cheap and unreliable. Nothing was purpose-built for the independent store owner who is also the buyer, the manager, the cashier, and the bookkeeper. So we built it ourselves, in the back office of a real store, solving real problems.
            </p>
            <p>
              Today Storeveu is a complete retail operating system: four integrated applications covering POS, back-office management, admin oversight, and e-commerce. Offline-first so your register never stops. AI-powered so you spend less time on paperwork and more time growing your business.
            </p>
            <div className="story-stats">
              <div className="stat-item">
                <span className="stat-number">4</span>
                <span className="stat-label">Integrated Apps</span>
              </div>
              <div className="stat-item">
                <span className="stat-number">99.9%</span>
                <span className="stat-label">Uptime</span>
              </div>
              <div className="stat-item">
                <span className="stat-number">$49</span>
                <span className="stat-label">Starting Price/mo</span>
              </div>
            </div>
          </div>
          <div className="story-visual">
            <div className="story-blob">
              <Compass size={120} />
            </div>
          </div>
        </div>
      </MarketingSection>

      {/* Values Grid */}
      <MarketingSection title="Our Core Values" bgVariant="light">
        <div className="values-grid">
          {values.map((v, i) => (
            <div key={i} className="value-card">
              <div className="value-icon">{v.icon}</div>
              <h3>{v.title}</h3>
              <p>{v.desc}</p>
            </div>
          ))}
        </div>
      </MarketingSection>

      {/* Why We're Different */}
      <MarketingSection title="Why We're Different" bgVariant="white">
        <div className="timeline-container">
          {differentiators.map((d, i) => (
            <div key={i} className="timeline-item">
              <div className="timeline-dot"></div>
              <div className="timeline-year timeline-year--icon">{d.icon}</div>
              <div className="timeline-content">
                <h3>{d.title}</h3>
                <p>{d.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </MarketingSection>

      {/* Timeline Section */}
      <MarketingSection title="Our Journey So Far" bgVariant="light">
        <div className="timeline-container">
          {milestones.map((m, i) => (
            <div key={i} className="timeline-item">
              <div className="timeline-dot"></div>
              <div className="timeline-year">{m.year}</div>
              <div className="timeline-content">
                <h3>{m.title}</h3>
                <p>{m.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </MarketingSection>

      {/* Team Section */}
      <MarketingSection title="The People Behind the Platform" bgVariant="white" id="careers">
        <div className="team-grid">
          {team.map((t, i) => (
            <div key={i} className="team-card">
              <div className="team-avatar" style={{ '--avatar-color': t.color }}>
                {t.initials}
              </div>
              <h3>{t.name}</h3>
              <p>{t.role}</p>
            </div>
          ))}
        </div>
        <div className="team-footer">
          <p>We are always looking for people who have worked retail and want to fix it.</p>
          <MarketingButton variant="ghost" href="/contact">Get in Touch</MarketingButton>
        </div>
      </MarketingSection>

      {/* Final CTA */}
      <section className="about-final-cta">
        <div className="mkt-container">
          <div className="about-cta-card">
            <h2>Ready to run your store smarter?</h2>
            <p>Storeveu gives you the same analytics, compliance tools, and operational efficiency as big-box retailers, at a fraction of the cost. One platform. One price. No surprises.</p>
            <p className="about-cta-contact">
              Questions? Call us at <a href="tel:+18007867383">+1 (800) 786-7383</a> or email <a href="mailto:demo@storeveu.com">demo@storeveu.com</a>. A real person will answer.
            </p>
            <div className="about-cta-actions">
              <MarketingButton href="/contact" size="lg">Talk to Us</MarketingButton>
              <MarketingButton href="/pricing" variant="secondary" size="lg">See Our Plans</MarketingButton>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

export default About;
