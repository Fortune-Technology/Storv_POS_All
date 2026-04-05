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
  Handshake
} from 'lucide-react';
import './About.css';

const About = () => {
  const milestones = [
    {
      year: '2021',
      title: 'The Breaking Point',
      desc: 'After years running independent grocery and liquor stores, our founders hit a wall: bad POS systems, paper invoices, and payment processors taking 3% off every dollar. Something had to change.'
    },
    {
      year: '2022',
      title: 'Building the Fix',
      desc: 'We started building StoreVeu in our own back office. First feature: scanning paper invoices with AI so we\'d never type a vendor price again. We built it for ourselves before we built it for anyone else.'
    },
    {
      year: '2023',
      title: 'The POS That Gets It',
      desc: 'Launched Storv POS cashier app — built for real stores, with lottery, EBT, age verification, and hardware integration out of the box. No bloat. No features you\'ll never use.'
    },
    {
      year: '2024',
      title: 'Removing the Middleman',
      desc: 'Integrated direct PAX terminal support. Stores on StoreVeu now process cards at direct interchange rates with no processor markup. The fees that used to go to Square and Stripe stay in your register.'
    },
    {
      year: '2025',
      title: 'Growing Together',
      desc: 'Expanding to grocers, liquor stores, and specialty retailers across North America. Every new store that joins makes the platform better for all of us.'
    }
  ];

  const values = [
    {
      icon: <DollarSign size={32} />,
      title: 'No Middleman',
      desc: 'Direct payment processing integration with PAX terminals means you keep more of every sale. No third-party markup. No one skimming a percentage off the top because they can.'
    },
    {
      icon: <Store size={32} />,
      title: 'Built for the Floor',
      desc: 'Designed by cashiers and store owners, not corporate engineers who never ran a register. Every screen, every workflow was tested on a real counter with real customers waiting.'
    },
    {
      icon: <Heart size={32} />,
      title: 'Local-First',
      desc: 'We believe independent retailers are the backbone of every community. You\'re not a segment in our TAM — you\'re who we built this for. Your fight is our fight.'
    },
    {
      icon: <Handshake size={32} />,
      title: 'Real Support',
      desc: 'Call us. A real person who has run a store will pick up. No ticket queues, no chatbots, no "have you tried restarting." We know what it costs when your system goes down during a rush.'
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
      icon: <DollarSign size={28} />,
      title: 'Payment Processing',
      desc: 'Traditional POS companies resell payment processing at a markup — that\'s how they make their real money. We integrate directly with PAX terminals at interchange rates, meaning you save on every single transaction. No markup. No percentage skimmed. What you swipe is what you keep, minus only the true cost of the network.'
    },
    {
      icon: <ShieldCheck size={28} />,
      title: 'No Vendor Lock-in',
      desc: 'Export your data anytime in standard formats. No contracts longer than month-to-month on base plans. We keep your business because the product is worth it, not because leaving is a nightmare. Your inventory, your sales history, your customers — they\'re yours.'
    },
    {
      icon: <Store size={28} />,
      title: 'We Eat Our Own Cooking',
      desc: 'StoreVeu runs in actual stores our founders still own. Every bug we fix is a bug we felt too. When a cashier workflow is clunky, we hear about it from our own staff. That\'s not a marketing line — it\'s why the product actually works on the floor.'
    }
  ];

  return (
    <div className="about-page">
      <MarketingNavbar />

      {/* Hero */}
      <section className="about-hero">
        <div className="mkt-container">
          <div className="about-hero-content">
            <h1 className="about-title">Built by Retailers. <span className="text-gradient">For Retailers.</span></h1>
            <p className="about-subtitle">
              We know what it feels like to hand 2.9% of every sale to Stripe or Square and wonder why your POS vendor is getting rich off your margins. We owned stores. We paid those fees. Then we decided to stop.
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
              Our founders spent years running independent grocery and liquor stores. They knew every corner of the business — the early morning deliveries, the vendor invoices stacked on the back desk, the end-of-night cash counts. And they knew the frustration of paying a POS vendor every month for software that barely worked, while a payment processor quietly took 3% off every card swipe.
            </p>
            <p>
              The tools that existed were either built for enterprise chains with IT departments, or they were cheap and unreliable. Nothing was built for the independent store owner who is also the buyer, the manager, the cashier, and the bookkeeper. So we built it ourselves — in the back office of a real store, on real problems, with no outside investors telling us what features to prioritize.
            </p>
            <p>
              StoreVeu is the system we wished we had. No middleman on payments. No bloated features you'll never use. No support line that puts you on hold when your terminal goes down during Saturday rush.
            </p>
            <div className="story-stats">
              <div className="stat-item">
                <span className="stat-number">50+</span>
                <span className="stat-label">Stores Active</span>
              </div>
              <div className="stat-item">
                <span className="stat-number">99.9%</span>
                <span className="stat-label">Uptime</span>
              </div>
              <div className="stat-item">
                <span className="stat-number">$0</span>
                <span className="stat-label">Middleman Markup</span>
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
              <div className="timeline-year" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{d.icon}</div>
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
              <div className="team-avatar" style={{ backgroundColor: `${t.color}20`, color: t.color }}>
                {t.initials}
              </div>
              <h3>{t.name}</h3>
              <p>{t.role}</p>
            </div>
          ))}
        </div>
        <div className="team-footer">
          <p>We're always looking for people who've worked retail and want to fix it.</p>
          <MarketingButton variant="ghost" href="/contact">Get in Touch →</MarketingButton>
        </div>
      </MarketingSection>

      {/* Final CTA */}
      <section className="about-final-cta">
        <div className="mkt-container">
          <div className="about-cta-card">
            <h2>Join retailers who are taking back control.</h2>
            <p>Stop paying middleman fees on every card swipe. StoreVeu gives you direct interchange rates, honest pricing, and a POS built by people who've stood where you stand.</p>
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
