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
      features: ['EBT/SNAP Support', 'Scale Integration', 'AI Invoice Import']
    },
    retail: {
      title: 'General Retail',
      desc: 'Seamless checkout and deep analytics. Understand your best sellers and customer behavior.',
      features: ['PAX Terminal Direct', 'Customer Loyalty Points', 'Promotions Engine']
    },
    liquor: {
      title: 'Liquor & Wine',
      desc: 'Complex tax handling and vendor-specific mappings for spirits and beer distributors.',
      features: ['Age Verification', 'Lottery Module', 'Case-to-Unit Conversion']
    },
    meat: {
      title: 'Meat & Food',
      desc: 'Weight-based pricing and cold-chain management for fresh departments.',
      features: ['Scale Sync (CAS/Mettler)', 'Weight-Based Pricing', 'Department Tax Rules']
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
      desc: 'Holt-Winters 14-day forecasting to anticipate demand before you run out.',
      path: '/features#analytics'
    },
    {
      icon: <Package size={32} />,
      title: 'Storv POS',
      desc: 'A complete cashier app with barcode scanning, EBT/SNAP, lottery, age verification, and PAX card processing.',
      path: '/features#inventory'
    },
    {
      icon: <Users size={32} />,
      title: 'Customer Loyalty',
      desc: 'Manage points and rewards synchronized directly with your POS.',
      path: '/features#loyalty'
    },
    {
      icon: <Globe size={32} />,
      title: 'Hardware Integration',
      desc: 'Receipt printers, cash drawers, PAX terminals, and scales — all configured in a simple setup wizard.',
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
              <span className="hero-badge">Retail Technology, Reimagined</span>
              <h1 className="hero-title">
                The POS System That <span className="text-gradient">Thinks</span> Like You Do
              </h1>
              <p className="hero-subtitle">
                StoreVeu is the complete retail platform built by store owners who got tired of overpaying for bad software. Run your POS, manage lottery, track inventory, and process payments — all without the middleman markup.
              </p>
              <div className="hero-actions">
                <MarketingButton href="/contact" size="lg">Book a Free Demo</MarketingButton>
                <MarketingButton href="/features" variant="secondary" size="lg">Explore Features</MarketingButton>
              </div>
              <div className="hero-trust">
                <ShieldCheck size={20} />
                <span>Trusted by independent retailers across North America</span>
              </div>
            </div>
            <div className="hero-visual">
              <div className="mockup-container">
                <img src={heroMockup} alt="Storeveu Dashboard Mockup" className="hero-mockup" />
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
        title="Stop Paying the Middleman"
        subtitle="Traditional POS companies take a cut of every card swipe. StoreVeu connects directly to your PAX terminal — you keep more of every dollar."
        bgVariant="white"
      >
        <div className="problem-grid">
          <div className="problem-card old">
            <h4>Old Ways</h4>
            <ul>
              <li>Paying 2.9%+ card processing through your POS vendor</li>
              <li>Manual invoice entry (hours of office work)</li>
              <li>Separate systems for POS, lottery, and inventory</li>
              <li>Cookie-cutter software that doesn't understand retail</li>
            </ul>
          </div>
          <div className="problem-divider">
            <div className="arrow-right">→</div>
          </div>
          <div className="problem-card new">
            <h4>StoreVeu</h4>
            <ul>
              <li>Direct PAX terminal integration at interchange rates</li>
              <li>AI scans vendor invoices in seconds</li>
              <li>POS + lottery + inventory + hardware in one platform</li>
              <li>Built by retailers who know your daily challenges</li>
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
        subtitle="Why retail owners are switching to Storeveu."
        bgVariant="light"
      >
        <div className="testimonial-teaser-grid">
          <div className="teaser-card">
            <div className="stars">★★★★★</div>
            <p>"Switching from Square to StoreVeu cut our card fees by nearly 1%. On our volume, that's thousands a year."</p>
            <div className="author">— David P., Grocery Owner</div>
          </div>
          <div className="teaser-card">
            <div className="stars">★★★★★</div>
            <p>"The lottery module alone saved us 3 hours of paperwork every week. Our cashiers love the shift scan feature."</p>
            <div className="author">— Priya M., Liquor Store Owner</div>
          </div>
          <div className="teaser-card">
            <div className="stars">★★★★★</div>
            <p>"AI invoice import is unreal. I used to spend Sunday nights entering vendor invoices. Now it takes 10 minutes."</p>
            <div className="author">— James T., Independent Market Owner</div>
          </div>
        </div>
      </MarketingSection>

      {/* CTA Footer */}
      <section className="final-cta-banner">
        <div className="mkt-container">
          <div className="cta-banner-content">
            <h2>Ready to stop paying the middleman?</h2>
            <p>Join retailers keeping more of every dollar they earn.</p>
            <div className="cta-banner-actions">
              <MarketingButton href="/contact" size="xl">Book Your Free Demo</MarketingButton>
              <MarketingButton href="/pricing" variant="ghost" size="xl" className="text-white">See Pricing</MarketingButton>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

export default Home;
