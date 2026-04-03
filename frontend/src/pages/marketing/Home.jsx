import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import MarketingNavbar from '../../components/marketing/MarketingNavbar';
import MarketingFooter from '../../components/marketing/MarketingFooter';
import MarketingSection from '../../components/marketing/MarketingSection';
import MarketingButton from '../../components/marketing/MarketingButton';
import heroMockup from '../../assets/pos-hero-mockup.png';
import { 
  Zap, 
  BarChart3, 
  TrendingUp, 
  Package, 
  Users, 
  Globe, 
  ShieldCheck, 
  Cpu 
} from 'lucide-react';
import './Home.css';

const Home = () => {
  const [activeTab, setActiveTab] = useState('grocery');

  const industries = {
    grocery: {
      title: 'Grocery & Supermarket',
      desc: 'Handle thousands of SKUs with ease. AI-powered invoice import and real-time inventory management.',
      features: ['Scale Integration', 'Writability Support', 'Expiration Tracking']
    },
    retail: {
      title: 'General Retail',
      desc: 'Seamless checkout and deep analytics. Understand your best sellers and customer behavior.',
      features: ['Multi-variant Support', 'Loyalty Program', 'Gift Cards']
    },
    liquor: {
      title: 'Liquor & Wine',
      desc: 'Complex tax handling and vendor-specific mappings for spirits and beer distributors.',
      features: ['Age Verification', 'Case-to-Unit Conversion', 'Bottle Deposits']
    },
    meat: {
      title: 'Meat & Food',
      desc: 'Weight-based pricing and cold-chain management for fresh departments.',
      features: ['Scale Sync', 'Yield Tracking', 'Batch Management']
    }
  };

  const coreFeatures = [
    {
      icon: <Cpu size={32} />,
      title: 'AI Invoice Import',
      desc: 'Convert PDF/JPEG invoices into structured POS data using Hybrid AI (Azure + GPT-4o).',
      path: '/features#ocr'
    },
    {
      icon: <Zap size={32} />,
      title: 'Live Dashboard',
      desc: 'Real-time sales updates every 60 seconds with weather correlation and data alerts.',
      path: '/features#dashboard'
    },
    {
      icon: <TrendingUp size={32} />,
      title: 'Sales Predictions',
      desc: 'Advanced Holt-Winters forecasting to predict sales volume and holiday spikes.',
      path: '/features#analytics'
    },
    {
      icon: <Package size={32} />,
      title: 'Smart Inventory',
      desc: 'Velocity-based reorder sheets that predict when you will run out of stock.',
      path: '/features#inventory'
    },
    {
      icon: <Users size={32} />,
      title: 'Customer Loyalty',
      desc: 'Manage points and rewards synchronized directly with your IT Retail POS.',
      path: '/features#loyalty'
    },
    {
      icon: <Globe size={32} />,
      title: 'Multi-Store Sync',
      desc: 'Manage different locations and organizations from a single cloud-based portal.',
      path: '/features#stores'
    }
  ];

  return (
    <div className="home-page">
      <MarketingNavbar />

      {/* Hero Section */}
      <section className="hero-section">
        <div className="mkt-container">
          <div className="hero-grid">
            <div className="hero-content">
              <span className="hero-badge">Smart Retail Evolution</span>
              <h1 className="hero-title">
                The POS System That <span className="text-gradient">Thinks</span> Like You Do
              </h1>
              <p className="hero-subtitle">
                FutureFoods combines AI-powered automation with deep retail analytics to help you manage inventory, boost sales, and simplify your daily operations.
              </p>
              <div className="hero-actions">
                <MarketingButton href="/contact" size="lg">Book a Free Demo</MarketingButton>
                <MarketingButton href="/features" variant="secondary" size="lg">Explore Features</MarketingButton>
              </div>
              <div className="hero-trust">
                <ShieldCheck size={20} />
                <span>Trusted by 500+ independent retailers across the country</span>
              </div>
            </div>
            <div className="hero-visual">
              <div className="mockup-container">
                <img src={heroMockup} alt="FutureFoods Dashboard Mockup" className="hero-mockup" />
                <div className="stats-bubble floating-1">
                  <BarChart3 size={18} />
                  <span>+24% Sales Target</span>
                </div>
                <div className="stats-bubble floating-2">
                  <Zap size={18} />
                  <span>AI Sync Live</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <MarketingSection 
        title="Stop Fighting Your Software" 
        subtitle="Traditional POS systems are just cash registers. FutureFoods is a complete business partner."
        bgVariant="white"
      >
        <div className="problem-grid">
          <div className="problem-card old">
            <h4>Old Ways</h4>
            <ul>
              <li>Manual invoice entry (Hours of work)</li>
              <li>Data sync delays and errors</li>
              <li>Guesswork for inventory orders</li>
              <li>Hidden trends and lost revenue</li>
            </ul>
          </div>
          <div className="problem-divider">
            <div className="arrow-right">→</div>
          </div>
          <div className="problem-card new">
            <h4>FutureFoods</h4>
            <ul>
              <li>AI scans invoices in seconds</li>
              <li>Real-time sync every 60 seconds</li>
              <li>Data-driven reorder velocity</li>
              <li>Predictive analytics to grow margin</li>
            </ul>
          </div>
        </div>
      </MarketingSection>

      {/* Feature Grid */}
      <MarketingSection 
        title="Everything You Need to Scale" 
        subtitle="Built from the ground up for grocery, liquor, and retail businesses."
        bgVariant="light"
      >
        <div className="main-feature-grid">
          {coreFeatures.map((f, i) => (
            <div key={i} className="mkt-feature-card">
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
              <Link to={f.path} className="feature-link">Learn more →</Link>
            </div>
          ))}
        </div>
      </MarketingSection>

      {/* Industry Tabs */}
      <MarketingSection 
        title="Tailored for Your Industry" 
        subtitle="One platform, multiple solutions for specialized retail sectors."
        bgVariant="white"
        id="industries"
      >
        <div className="industry-tabs">
          <div className="tabs-header">
            {Object.keys(industries).map((key) => (
              <button 
                key={key} 
                className={`tab-btn ${activeTab === key ? 'active' : ''}`}
                onClick={() => setActiveTab(key)}
              >
                {industries[key].title.split(' & ')[0]}
              </button>
            ))}
          </div>
          <div className="tab-content">
            <div className="tab-info">
              <h3>{industries[activeTab].title}</h3>
              <p>{industries[activeTab].desc}</p>
              <ul className="tab-features">
                {industries[activeTab].features.map((item, i) => (
                  <li key={i}><ShieldCheck size={18} /> {item}</li>
                ))}
              </ul>
              <MarketingButton href="/contact" variant="secondary">Demo for {industries[activeTab].title.split(' & ')[0]}</MarketingButton>
            </div>
            <div className="tab-visual">
              {/* TODO: Add industry specific visual/iconography */}
              <div className="industry-placeholder-icon">
                {activeTab === 'grocery' && <Package size={120} />}
                {activeTab === 'retail' && <Zap size={120} />}
                {activeTab === 'liquor' && <BarChart3 size={120} />}
                {activeTab === 'meat' && <Cpu size={120} />}
              </div>
            </div>
          </div>
        </div>
      </MarketingSection>

      {/* Testimonials Teaser */}
      <MarketingSection 
        title="Success Stories" 
        subtitle="Why retail owners are switching to FutureFoods."
        bgVariant="light"
      >
        <div className="testimonial-teaser-grid">
          <div className="teaser-card">
            <div className="stars">★★★★★</div>
            <p>"AI invoice import saved us 12 hours a week. It's the best investment we've ever made."</p>
            <div className="author">— John D., Grocery Owner</div>
          </div>
          <div className="teaser-card">
            <div className="stars">★★★★★</div>
            <p>"The predictive analytics helped us reduce overstock by 15% in just 3 months."</p>
            <div className="author">— Sarah L., Liquor Store Manager</div>
          </div>
          <div className="teaser-card">
            <div className="stars">★★★★★</div>
            <p>"Finally a system that speaks to IT Retail perfectly. The real-time hub is addictive."</p>
            <div className="author">— Mike R., Food Market Owner</div>
          </div>
        </div>
      </MarketingSection>

      {/* CTA Footer */}
      <section className="final-cta-banner">
        <div className="mkt-container">
          <div className="cta-banner-content">
            <h2>Ready to transform your retail operations?</h2>
            <p>Join hundreds of smart retailers who are simplifying their business today.</p>
            <div className="cta-banner-actions">
              <MarketingButton href="/contact" size="xl">Start Free Trial after Demo</MarketingButton>
              <MarketingButton href="/pricing" variant="ghost" size="xl" className="text-white">View Pricing Plans</MarketingButton>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

export default Home;
