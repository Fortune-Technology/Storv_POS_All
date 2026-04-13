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
  Cpu,
  WifiOff,
  ShoppingCart,
  Store,
  Building2
} from 'lucide-react';
import SEO from '../../components/SEO';
import './Home.css';

const Home = () => {
  const [activeTab, setActiveTab] = useState('grocery');

  const industries = {
    grocery: {
      title: 'Grocery & Supermarket',
      desc: 'Handle thousands of SKUs with multi-UPC barcodes, EBT/SNAP compliance, and AI-powered invoice import that turns vendor PDFs into catalog data in seconds.',
      features: ['EBT/SNAP Compliance', 'AI Invoice Import (OCR)', 'Bulk CSV/Excel Import']
    },
    retail: {
      title: 'General Retail',
      desc: 'Fast checkout with split tender, customer loyalty lookup, and a promotions engine that handles BOGO, volume discounts, and mix-and-match deals automatically.',
      features: ['PAX Terminal Integration', 'Promotions Engine', 'Customer Loyalty & Points']
    },
    liquor: {
      title: 'Liquor & Wine',
      desc: 'Built-in age verification, full lottery management with shift reconciliation, bottle deposit tracking, and case-to-unit conversion for every product.',
      features: ['Age Verification (21+)', 'Lottery Sales & Payouts', 'Bottle Deposit / CRV']
    },
    meat: {
      title: 'Meat & Food',
      desc: 'Weight-based pricing, department-level tax rules, and perishable-aware auto-ordering that caps quantities to shelf life so you never over-order fresh stock.',
      features: ['Weight-Based Pricing', 'Department Tax Rules', 'Shelf-Life Auto-Ordering']
    }
  };

  const coreFeatures = [
    {
      icon: <WifiOff size={32} />,
      title: 'Offline-First POS',
      desc: 'A full cashier terminal that works without internet. Barcode scanning, multi-payment (cash, card, EBT), lottery, age verification, and customer display — all in one Electron desktop app.',
      path: '/features#pos'
    },
    {
      icon: <BarChart3 size={32} />,
      title: 'Live Dashboard & Analytics',
      desc: 'Real-time KPIs, hourly sales charts, payment breakdowns, and weather-correlated insights. Department and product analytics with CSV and PDF export.',
      path: '/features#dashboard'
    },
    {
      icon: <TrendingUp size={32} />,
      title: 'Sales Predictions',
      desc: 'Holt-Winters triple exponential smoothing with day-of-week, holiday, and weather adjustments. Get a 14-day forecast so you can staff and stock with confidence.',
      path: '/features#analytics'
    },
    {
      icon: <ShoppingCart size={32} />,
      title: 'E-Commerce & Online Store',
      desc: 'Launch a branded online storefront for each store. 15 premium templates, real-time product sync from your POS, shopping cart, checkout, and order management built in.',
      path: '/features#ecommerce'
    },
    {
      icon: <Package size={32} />,
      title: 'Smart Auto-Ordering',
      desc: 'A 14-factor algorithm analyzes sales velocity, weather forecasts, holidays, shelf life, and stockout history to generate purchase orders automatically — grouped by vendor.',
      path: '/features#ordering'
    },
    {
      icon: <Building2 size={32} />,
      title: 'Multi-Store Management',
      desc: 'Manage multiple locations from one portal. Per-store pricing, inventory, employees, POS stations, and analytics — all scoped by role-based permissions from cashier to owner.',
      path: '/features#stores'
    }
  ];

  return (
    <div className="home-page">
      <SEO
        title="Modern POS & Retail Platform"
        description="The complete retail platform for convenience, grocery, and liquor stores. Offline-first POS, real-time analytics, AI-powered predictions, e-commerce, and vendor auto-ordering."
        url="https://storeveu.com/"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          "name": "Storeveu",
          "applicationCategory": "BusinessApplication",
          "operatingSystem": "Web, Windows",
          "description": "Complete retail POS platform with offline-first checkout, analytics, predictions, e-commerce, and multi-store management.",
          "offers": { "@type": "Offer", "price": "49", "priceCurrency": "USD", "priceValidUntil": "2027-12-31" },
          "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.8", "ratingCount": "120" }
        }}
      />
      <MarketingNavbar />

      {/* Hero Section */}
      <section className="hero-section">
        <div className="mkt-container">
          <div className="hero-grid">
            <div className="hero-content">
              <span className="hero-badge">POS + E-Commerce + Analytics in One Platform</span>
              <h1 className="hero-title">
                The Retail Platform That <span className="text-gradient">Runs</span> Your Entire Business
              </h1>
              <p className="hero-subtitle">
                Storeveu is the all-in-one platform for independent retailers. Offline-first POS, live analytics, AI-powered predictions, e-commerce storefronts, smart auto-ordering, and multi-store management — built by store owners who got tired of paying for five different systems.
              </p>
              <div className="hero-actions">
                <MarketingButton href="/contact" size="lg">Book a Free Demo</MarketingButton>
                <MarketingButton href="/features" variant="secondary" size="lg">Explore Features</MarketingButton>
              </div>
              <div className="hero-trust">
                <ShieldCheck size={20} />
                <span>Trusted by independent grocery, liquor, and retail stores across North America</span>
              </div>
            </div>
            <div className="hero-visual">
              <div className="mockup-container">
                <img src={heroMockup} alt="Storeveu Dashboard Mockup" className="hero-mockup" />
                <div className="stats-bubble floating-1">
                  <BarChart3 size={18} />
                  <span>Live Sales Dashboard</span>
                </div>
                <div className="stats-bubble floating-2">
                  <Zap size={18} />
                  <span>Offline-Ready POS</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <MarketingSection
        title="One Platform Instead of Five"
        subtitle="Most retailers juggle separate tools for POS, inventory, analytics, e-commerce, and ordering. Storeveu replaces them all with a single integrated system."
        bgVariant="white"
      >
        <div className="problem-grid">
          <div className="problem-card old">
            <h4>The Old Way</h4>
            <ul>
              <li>Paying 2.9%+ card processing through your POS vendor</li>
              <li>Manual invoice entry and spreadsheet inventory</li>
              <li>Separate systems for POS, lottery, e-commerce, and ordering</li>
              <li>No demand forecasting — you guess what to reorder</li>
            </ul>
          </div>
          <div className="problem-divider">
            <div className="arrow-right">→</div>
          </div>
          <div className="problem-card new">
            <h4>Storeveu</h4>
            <ul>
              <li>Direct PAX terminal integration — keep more of every dollar</li>
              <li>AI invoice import and automated purchase orders</li>
              <li>POS, lottery, e-commerce, analytics, and ordering in one login</li>
              <li>14-day sales predictions with weather and holiday adjustments</li>
            </ul>
          </div>
        </div>
      </MarketingSection>

      {/* Feature Grid */}
      <MarketingSection 
        title="Everything You Need to Run and Grow"
        subtitle="From the cash register to the online storefront — every tool your store needs, built into one platform."
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
                {activeTab === 'grocery' && <ShoppingCart size={120} />}
                {activeTab === 'retail' && <Store size={120} />}
                {activeTab === 'liquor' && <ShieldCheck size={120} />}
                {activeTab === 'meat' && <Package size={120} />}
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
            <p>"We replaced three different systems with Storeveu. POS, lottery, and vendor ordering all in one place. Our cashiers were trained in a day."</p>
            <div className="author">— David P., Grocery Owner</div>
          </div>
          <div className="teaser-card">
            <div className="stars">★★★★★</div>
            <p>"The auto-ordering feature cut our out-of-stocks in half. It even factors in weather and holidays. We stopped guessing and started knowing."</p>
            <div className="author">— Priya M., Liquor Store Owner</div>
          </div>
          <div className="teaser-card">
            <div className="stars">★★★★★</div>
            <p>"We launched an online store for our shop in under an hour. Products synced straight from our POS catalog. Orders show up right in the portal."</p>
            <div className="author">— James T., Independent Market Owner</div>
          </div>
        </div>
      </MarketingSection>

      {/* CTA Footer */}
      <section className="final-cta-banner">
        <div className="mkt-container">
          <div className="cta-banner-content">
            <h2>Ready to run your store on one platform?</h2>
            <p>POS, analytics, e-commerce, and auto-ordering — all included. See it in action.</p>
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
