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
  Compass
} from 'lucide-react';
import './About.css';

const About = () => {
  const milestones = [
    {
      year: '2020',
      title: 'The Foundation',
      desc: 'Storeveu was founded by retail veterans who were tired of overly complex and outdated POS systems.'
    },
    {
      year: '2021',
      title: 'First 100 Stores',
      desc: 'We proved our concept with 100 independent grocery stores, focusing on reliability and speed.'
    },
    {
      year: '2022',
      title: 'AI Revolution',
      desc: 'Launched our breakthrough AI Invoice Import, saving store owners hundreds of hours in data entry.'
    },
    {
      year: '2023',
      title: 'Predictive Insights',
      desc: 'Released our proprietary Holt-Winters forecasting engine to help retailers anticipate demand.'
    },
    {
      year: '2024',
      title: 'Expanding Horizons',
      desc: 'Moving into multi-store enterprises and scaling our impact across the retail landscape.'
    }
  ];

  const values = [
    {
      icon: <Zap size={32} />,
      title: 'Simplicity First',
      desc: 'We believe complex problems deserve simple solutions. Our UI is designed to be mastered in minutes, not days.'
    },
    {
      icon: <Award size={32} />,
      title: 'Absolute Reliability',
      desc: 'When your store is open, we are up. Our systems are built for 99.9% uptime and mission-critical performance.'
    },
    {
      icon: <Heart size={32} />,
      title: 'Local-First',
      desc: 'We support the independent retailers that form the backbone of our communities. Your success is our mission.'
    },
    {
      icon: <ShieldCheck size={32} />,
      title: 'Human Support',
      desc: 'No endless phone trees. When you need help, you talk to a real person who understands your business.'
    }
  ];

  const team = [
    { name: 'A.P.', role: 'Founder & CEO', initials: 'AP', color: '#7ac143' },
    { name: 'M.J.', role: 'Chief Architect', initials: 'MJ', color: '#3b82f6' },
    { name: 'S.R.', role: 'Head of Growth', initials: 'SR', color: '#e30613' },
    { name: 'K.L.', role: 'Product Design', initials: 'KL', color: '#f8c01d' }
  ];

  return (
    <div className="about-page">
      <MarketingNavbar />

      {/* Hero */}
      <section className="about-hero">
        <div className="mkt-container">
          <div className="about-hero-content">
            <h1 className="about-title">We Built This Because We've Been in <span className="text-gradient">Your Shoes</span></h1>
            <p className="about-subtitle">
              Storeveu isn't just software. It's a mission to empower independent retailers with the same advanced technology used by global giants.
            </p>
          </div>
        </div>
      </section>

      {/* Mission / Story */}
      <MarketingSection bgVariant="white">
        <div className="about-story-grid">
          <div className="story-content">
            <h2>The Storeveu Story</h2>
            <p>
              It started in the back office of a family-owned grocery store. We saw firsthand the stacks of paper invoices, the manual inventory counts, and the struggle to understand why sales were dipping.
            </p>
            <p>
              We realized that the technology available was either too expensive or too basic. So we decided to build something better—a POS system that doesn't just record sales, but actually helps you grow.
            </p>
            <div className="story-stats">
              <div className="stat-item">
                <span className="stat-number">500+</span>
                <span className="stat-label">Stores Active</span>
              </div>
              <div className="stat-item">
                <span className="stat-number">12k+</span>
                <span className="stat-label">Daily Users</span>
              </div>
              <div className="stat-item">
                <span className="stat-number">14M+</span>
                <span className="stat-label">Invoices Scanned</span>
              </div>
              {/* // TODO: replace with real business metrics */}
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

      {/* Timeline Section */}
      <MarketingSection title="Our Journey So Far" bgVariant="white">
        <div className="timeline-container">
          {milestones.map((m, i) => (
            <div key={i} className="timeline-item">
              <div className="timeline-dot"></div>
              <div className="timeline-year">{m.year}</div>
              <div className="timeline-content">
                <h3>{m.title}</h3>
                <p>{m.desc}</p>
                {/* // TODO: confirm company milestones with founders */}
              </div>
            </div>
          ))}
        </div>
      </MarketingSection>

      {/* Team Section Teaser */}
      <MarketingSection title="The People Behind the Platform" bgVariant="light">
        <div className="team-grid">
          {team.map((t, i) => (
            <div key={i} className="team-card">
              <div className="team-avatar" style={{ backgroundColor: `${t.color}20`, color: t.color }}>
                {t.initials}
              </div>
              <h3>{t.name}</h3>
              <p>{t.role}</p>
              {/* // TODO: replace with real team photos/names */}
            </div>
          ))}
        </div>
        <div className="team-footer">
          <p>Want to join our mission? We're always looking for talent.</p>
          <MarketingButton variant="ghost" href="/careers">View Open Positions →</MarketingButton>
        </div>
      </MarketingSection>

      {/* Final CTA */}
      <section className="about-final-cta">
        <div className="mkt-container">
          <div className="about-cta-card">
            <h2>Ready to be part of our next chapter?</h2>
            <p>Join the 500+ retailers who are already thriving with Storeveu.</p>
            <div className="about-cta-actions">
              <MarketingButton href="/contact" size="lg">Get Started Now</MarketingButton>
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
