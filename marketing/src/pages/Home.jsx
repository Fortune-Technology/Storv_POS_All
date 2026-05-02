import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useInView, AnimatePresence } from 'framer-motion';
import MarketingNavbar from '../components/marketing/MarketingNavbar';
import MarketingFooter from '../components/marketing/MarketingFooter';
import MarketingSection from '../components/marketing/MarketingSection';
import MarketingButton from '../components/marketing/MarketingButton';
import ssLiveDashboard from '../assets/Store_Dashboard/LiveDashboard.png';
import ssAnalytics from '../assets/Store_Dashboard/Analytics.png';
import ssProducts from '../assets/Store_Dashboard/ProductsCatalogue.png';
import ssTransactions from '../assets/Store_Dashboard/Transactions.png';
import ssEmployees from '../assets/Store_Dashboard/Employees.png';
import ssVendorOrders from '../assets/Store_Dashboard/VendorOrder.png';
import {
  ArrowRight, WifiOff, BarChart3, TrendingUp, ShoppingCart,
  Package, Building2, ShieldCheck, Activity, LayoutDashboard,
  FileText, Users, Truck, Star, Check, X, Download,
} from 'lucide-react';
import SEO from '../components/SEO';
import './Home.css';

/* ── Data ── */
const dashboardTabs = [
  { key: 'dashboard', label: 'Live Dashboard',  icon: LayoutDashboard, img: ssLiveDashboard, desc: 'Real-time KPIs, hourly sales chart, payment breakdown, and live transaction feed.' },
  { key: 'analytics', label: 'Analytics',        icon: Activity,        img: ssAnalytics,     desc: 'Sales trends with weather correlation, department performance, and demand forecasting.' },
  { key: 'products',  label: 'Products',         icon: Package,          img: ssProducts,      desc: 'Full catalog with multi-UPC barcodes, pack sizes, margin tracking, and bulk import.' },
  { key: 'txns',      label: 'Transactions',     icon: FileText,         img: ssTransactions,  desc: 'Advanced transaction browser with filters, receipt preview, and export tools.' },
  { key: 'employees', label: 'Employees',        icon: Users,            img: ssEmployees,     desc: 'Timesheets, clock-in/out tracking, shift management, and per-cashier performance.' },
  { key: 'vendors',   label: 'Vendor Orders',    icon: Truck,            img: ssVendorOrders,  desc: 'AI-powered purchase order suggestions, vendor management, and receiving workflow.' },
];

const coreFeatures = [
  { icon: WifiOff,      title: 'Offline-First POS',        desc: 'Full cashier terminal that works without internet. Barcode scanning, multi-payment, lottery, and age verification.', path: '/features#pos' },
  { icon: BarChart3,    title: 'Live Analytics',            desc: 'Real-time KPIs, hourly charts, weather-correlated insights, and department analytics with export.', path: '/features#dashboard' },
  { icon: TrendingUp,   title: 'Sales Predictions',         desc: 'Holt-Winters forecasting with day-of-week, holiday, and weather adjustments for 14-day predictions.', path: '/features#analytics' },
  { icon: ShoppingCart, title: 'E-Commerce Storefront',     desc: 'Branded online store for each location. 15 templates, real-time product sync, cart, and checkout.', path: '/features#ecommerce' },
  { icon: Package,      title: 'Smart Auto-Ordering',       desc: '14-factor algorithm analyzes velocity, weather, holidays, and shelf life to generate POs automatically.', path: '/features#ordering' },
  { icon: Building2,    title: 'Multi-Store Management',    desc: 'Manage multiple locations with per-store pricing, inventory, employees, and role-based permissions.', path: '/features#stores' },
];

const industries = {
  grocery: { title: 'Grocery & Supermarket', features: ['EBT/SNAP Compliance', 'AI Invoice Import (OCR)', 'Bulk CSV/Excel Import', 'Multi-UPC Barcodes'] },
  retail:  { title: 'General Retail',        features: ['PAX Terminal Integration', 'Promotions Engine', 'Customer Loyalty & Points', 'Split Tender'] },
  liquor:  { title: 'Liquor & Wine',         features: ['Age Verification (21+)', 'Lottery Sales & Payouts', 'Bottle Deposit / CRV', 'Case-to-Unit Conversion'] },
  meat:    { title: 'Meat & Food',           features: ['Weight-Based Pricing', 'Department Tax Rules', 'Shelf-Life Auto-Ordering', 'Perishable Alerts'] },
};

const testimonials = [
  { quote: 'We replaced three different systems with Storeveu. POS, lottery, and vendor ordering all in one place. Our cashiers were trained in a day.', author: 'David P.', role: 'Grocery Owner', rating: 5 },
  { quote: 'The auto-ordering feature cut our out-of-stocks in half. It factors in weather and holidays. We stopped guessing and started knowing.', author: 'Priya M.', role: 'Liquor Store Owner', rating: 5 },
  { quote: 'We launched an online store in under an hour. Products synced from our POS. Orders show up right in the portal.', author: 'James T.', role: 'Market Owner', rating: 5 },
];

const visualHighlights = [
  { tag: 'Analytics', title: 'Decisions Backed by Data', desc: 'Weather-correlated sales, department performance, product velocity rankings, and AI-powered demand forecasting — all in real-time.', img: ssAnalytics, imgAlt: 'Analytics Dashboard' },
  { tag: 'Catalog',   title: 'Your Entire Inventory, Organized', desc: 'Multi-UPC barcodes, pack-size picker, margin tracking, bulk import, and vendor cost management across every location.', img: ssProducts, imgAlt: 'Product Catalog', reverse: true },
  { tag: 'Ordering',  title: 'Vendor Orders on Autopilot', desc: 'Our 14-factor algorithm considers velocity, weather, holidays, shelf life, and stockout history to generate purchase orders.', img: ssVendorOrders, imgAlt: 'Vendor Orders' },
];

/* ── Animate-on-scroll wrapper ── */
const FadeIn = ({ children, className, delay = 0 }) => {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, delay, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {children}
    </motion.div>
  );
};

const Home = () => {
  const [activeTab, setActiveTab] = useState('grocery');
  const [activeScreen, setActiveScreen] = useState('dashboard');
  const activeTabData = dashboardTabs.find(t => t.key === activeScreen);

  return (
    <div className="home-page">
      <SEO
        title="Modern POS & Retail Platform"
        description="The complete retail platform for convenience, grocery, and liquor stores. Offline-first POS, real-time analytics, AI-powered predictions, e-commerce, and vendor auto-ordering."
        url="https://storeveu.com/"
        jsonLd={{
          '@context': 'https://schema.org', '@type': 'SoftwareApplication',
          name: 'Storeveu', applicationCategory: 'BusinessApplication', operatingSystem: 'Web, Windows',
          description: 'Complete retail POS platform with offline-first checkout, analytics, predictions, e-commerce, and multi-store management.',
          offers: { '@type': 'Offer', price: '49', priceCurrency: 'USD', priceValidUntil: '2027-12-31' },
          aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.8', ratingCount: '120' },
        }}
      />
      <MarketingNavbar />

      {/* ═══ HERO ═══ */}
      <section className="hm-hero">
        <div className="hm-hero-bg" />
        <div className="mkt-container">
          <FadeIn className="hm-hero-content">
            <span className="hm-hero-badge">POS + E-Commerce + Analytics in One Platform</span>
            <h1 className="hm-hero-title">
              The Retail Platform That{' '}
              <span className="text-gradient">Runs</span> Your Entire Business
            </h1>
            <p className="hm-hero-subtitle">
              Offline-first POS, live analytics, AI predictions, online storefronts, smart auto-ordering,
              and multi-store management — one login, one platform.
            </p>
            <div className="hm-hero-actions">
              <MarketingButton href="/contact" size="lg" icon={ArrowRight}>Book a Free Demo</MarketingButton>
              <MarketingButton href="/download" variant="secondary" size="lg" icon={Download}>Download Cashier App</MarketingButton>
            </div>
            <p className="hm-hero-trust">
              <ShieldCheck size={16} />
              Trusted by independent retailers across North America
            </p>
          </FadeIn>

          {/* Screenshot with perspective tilt */}
          <FadeIn className="hm-hero-visual" delay={0.15}>
            <div className="hm-hero-browser">
              <div className="hm-browser-bar">
                <span className="hm-dot hm-dot-r" />
                <span className="hm-dot hm-dot-y" />
                <span className="hm-dot hm-dot-g" />
                <span className="hm-browser-url">app.storeveu.com</span>
              </div>
              <img src={ssLiveDashboard} alt="Storeveu Live Dashboard" className="hm-hero-screenshot" loading="eager" />
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══ TRUST STRIP ═══ */}
      <div className="hm-trust-strip">
        <div className="mkt-container">
          <div className="hm-trust-logos">
            {['PAX Technology', 'Azure AI', 'Stripe', 'QuickBooks', 'Square', 'Open-Meteo'].map(name => (
              <span key={name} className="hm-trust-logo">{name}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ PROBLEM / SOLUTION ═══ */}
      <MarketingSection bgVariant="white">
        <FadeIn>
          <div className="hm-compare">
            <div className="hm-compare-card hm-compare-old">
              <h4 className="hm-compare-heading">The Old Way</h4>
              <ul className="hm-compare-list">
                {['Paying 2.9%+ card processing through your POS vendor', 'Manual invoice entry and spreadsheet inventory', 'Separate systems for POS, lottery, e-commerce, ordering', 'No demand forecasting — you guess what to reorder'].map((t, i) => (
                  <li key={i}><X size={16} className="hm-compare-icon hm-compare-icon-x" />{t}</li>
                ))}
              </ul>
            </div>
            <div className="hm-compare-arrow">
              <ArrowRight size={28} />
            </div>
            <div className="hm-compare-card hm-compare-new">
              <h4 className="hm-compare-heading">With Storeveu</h4>
              <ul className="hm-compare-list">
                {['Direct PAX terminal integration — keep more of every dollar', 'AI invoice import and automated purchase orders', 'POS, lottery, e-commerce, analytics in one login', '14-day sales predictions with weather and holiday data'].map((t, i) => (
                  <li key={i}><Check size={16} className="hm-compare-icon hm-compare-icon-check" />{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </FadeIn>
      </MarketingSection>

      {/* ═══ DASHBOARD SHOWCASE ═══ */}
      <MarketingSection
        title="See It in Action"
        subtitle="Every screen is built for speed, clarity, and zero learning curve."
        bgVariant="light"
        id="showcase"
      >
        <div className="hm-dsh">
          {/* Tab pills */}
          <div className="hm-dsh-tabs">
            {dashboardTabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  className={`hm-dsh-tab ${activeScreen === t.key ? 'hm-dsh-tab--active' : ''}`}
                  onClick={() => setActiveScreen(t.key)}
                >
                  <Icon size={16} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Caption */}
          <p className="hm-dsh-caption">{activeTabData?.desc}</p>

          {/* Browser frame */}
          <div className="hm-dsh-frame">
            <div className="hm-browser-bar">
              <span className="hm-dot hm-dot-r" />
              <span className="hm-dot hm-dot-y" />
              <span className="hm-dot hm-dot-g" />
              <span className="hm-browser-url">{activeTabData?.label}</span>
            </div>
            <div className="hm-dsh-screen">
              <AnimatePresence mode="wait">
                <motion.img
                  key={activeScreen}
                  src={activeTabData?.img}
                  alt={activeTabData?.label}
                  className="hm-dsh-img"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.3 }}
                  draggable={false}
                />
              </AnimatePresence>
            </div>
          </div>
        </div>
      </MarketingSection>

      {/* ═══ FEATURE GRID ═══ */}
      <MarketingSection
        title="Everything You Need to Run and Grow"
        subtitle="From the cash register to the online storefront — every tool your store needs."
        bgVariant="white"
      >
        <div className="hm-features">
          {coreFeatures.map((f, i) => {
            const Icon = f.icon;
            return (
              <FadeIn key={i} className="hm-feature-card" delay={i * 0.06}>
                <div className="hm-feature-icon"><Icon size={24} /></div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
                <Link to={f.path} className="hm-feature-link">Learn more <ArrowRight size={14} /></Link>
              </FadeIn>
            );
          })}
        </div>
      </MarketingSection>

      {/* ═══ VISUAL HIGHLIGHTS ═══ */}
      <MarketingSection bgVariant="light">
        <div className="hm-highlights">
          {visualHighlights.map((h, i) => (
            <FadeIn key={i} className={`hm-highlight ${h.reverse ? 'hm-highlight--reverse' : ''}`}>
              <div className="hm-highlight-text">
                <span className="hm-highlight-tag">{h.tag}</span>
                <h3>{h.title}</h3>
                <p>{h.desc}</p>
                <MarketingButton href="/features" variant="ghost" size="sm" icon={ArrowRight}>Learn more</MarketingButton>
              </div>
              <div className="hm-highlight-img-wrap">
                <img src={h.img} alt={h.imgAlt} className="hm-highlight-img" loading="lazy" />
              </div>
            </FadeIn>
          ))}
        </div>
      </MarketingSection>

      {/* ═══ INDUSTRY TABS ═══ */}
      <MarketingSection
        title="Tailored for Your Industry"
        subtitle="One platform, specialized for every type of store."
        bgVariant="white"
        id="industries"
      >
        <div className="hm-ind">
          <div className="hm-ind-tabs">
            {Object.keys(industries).map((key) => (
              <button
                key={key}
                className={`hm-ind-tab ${activeTab === key ? 'hm-ind-tab--active' : ''}`}
                onClick={() => setActiveTab(key)}
              >
                {industries[key].title}
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              className="hm-ind-content"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              {industries[activeTab].features.map((f, i) => (
                <div key={i} className="hm-ind-feature">
                  <Check size={18} className="hm-ind-check" />
                  <span>{f}</span>
                </div>
              ))}
            </motion.div>
          </AnimatePresence>
          <div className="hm-ind-cta">
            <MarketingButton href="/contact" variant="secondary" size="md" icon={ArrowRight}>
              Request a Demo
            </MarketingButton>
          </div>
        </div>
      </MarketingSection>

      {/* ═══ TESTIMONIALS ═══ */}
      <MarketingSection
        title="Trusted by Store Owners"
        subtitle="Hear from retailers who made the switch."
        bgVariant="light"
      >
        <div className="hm-testimonials">
          {testimonials.map((t, i) => (
            <FadeIn key={i} className="hm-testimonial" delay={i * 0.08}>
              <div className="hm-testimonial-quote">&ldquo;</div>
              <div className="hm-testimonial-stars">
                {Array.from({ length: t.rating }, (_, j) => (
                  <Star key={j} size={16} fill="var(--color-star)" color="var(--color-star)" />
                ))}
              </div>
              <p className="hm-testimonial-text">{t.quote}</p>
              <div className="hm-testimonial-author">
                <div className="hm-testimonial-avatar">{t.author[0]}</div>
                <div>
                  <div className="hm-testimonial-name">{t.author}</div>
                  <div className="hm-testimonial-role">{t.role}</div>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </MarketingSection>

      <MarketingFooter />
    </div>
  );
};

export default Home;
