import React, { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import MarketingNavbar from '../../components/marketing/MarketingNavbar';
import MarketingFooter from '../../components/marketing/MarketingFooter';
import MarketingSection from '../../components/marketing/MarketingSection';
import MarketingButton from '../../components/marketing/MarketingButton';
import SEO from '../../components/SEO';
import ssLiveDashboard from '../../assets/Store_Dashboard/LiveDashboard.png';
import ssAnalytics from '../../assets/Store_Dashboard/Analytics.png';
import ssProducts from '../../assets/Store_Dashboard/ProductsCatalogue.png';
import ssTransactions from '../../assets/Store_Dashboard/Transactions.png';
import ssEmployees from '../../assets/Store_Dashboard/Employees.png';
import ssVendorOrders from '../../assets/Store_Dashboard/VendorOrder.png';
import ssPOS from '../../assets/Store_Dashboard/POS_Cashier_Screen.png';
import ssInvoice from '../../assets/Store_Dashboard/InvoiceImportPage.png';
import ssPredictions from '../../assets/Store_Dashboard/Sales_Predictions.png';
import {
  ArrowRight, WifiOff, ScanBarcode, CreditCard, ShieldCheck, Users, LayoutGrid,
  Globe, Boxes, ClipboardList, DollarSign, Lock, TrendingUp, RefreshCw,
  LineChart, CloudRain, BarChart3, FileSearch, Layers, Cpu, Store, ShoppingCart,
  Printer, SquareTerminal, Monitor, Package, Zap, Clock, Database, Receipt,
  Recycle, BaggageClaim, HeadphonesIcon, FileText, UserCheck, Mail,
  Smartphone, MonitorSmartphone, Fuel, MapPin, Ticket,
} from 'lucide-react';
import './Features.css';

const FadeIn = ({ children, className, delay = 0 }) => {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div ref={ref} className={className} initial={{ opacity: 0, y: 28 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5, delay, ease: [0.25, 0.1, 0.25, 1] }}>
      {children}
    </motion.div>
  );
};

/* ── Screenshot in browser frame ── */
const BrowserFrame = ({ src, alt, label, className = '' }) => (
  <div className={`ft-browser ${className}`}>
    <div className="ft-browser-bar">
      <span className="ft-dot ft-dot-r" />
      <span className="ft-dot ft-dot-y" />
      <span className="ft-dot ft-dot-g" />
      {label && <span className="ft-browser-label">{label}</span>}
    </div>
    <img src={src} alt={alt} className="ft-browser-img" loading="lazy" />
  </div>
);

/* ── Feature bullet ── */
const Bullet = ({ icon: Icon, title, desc }) => (
  <li className="ft-bullet">
    <div className="ft-bullet-icon"><Icon size={18} /></div>
    <div>
      <strong>{title}</strong>
      <p>{desc}</p>
    </div>
  </li>
);

/* ── Feature section: alternating text + visual ── */
const FeatureRow = ({ id, tag, title, desc, bullets, visual, reverse }) => (
  <FadeIn className={`ft-row ${reverse ? 'ft-row--reverse' : ''}`} id={id}>
    <div className="ft-row-text">
      <span className="ft-tag">{tag}</span>
      <h2 dangerouslySetInnerHTML={{ __html: title }} />
      <p>{desc}</p>
      <ul className="ft-bullets">{bullets}</ul>
    </div>
    <div className="ft-row-visual">{visual}</div>
  </FadeIn>
);

/* Marquee thumbnails */
const marqueeScreens = [ssLiveDashboard, ssAnalytics, ssProducts, ssTransactions, ssEmployees, ssVendorOrders];

const Features = () => {
  return (
    <div className="features-page">
      <SEO
        title="Features"
        description="Explore Storeveu's complete feature set: offline-first POS, lottery management, 14-factor auto-ordering, Holt-Winters sales predictions, e-commerce storefronts, and more."
        url="https://storeveu.com/features"
      />
      <MarketingNavbar />

      {/* ═══ HERO ═══ */}
      <section className="ft-hero">
        <div className="ft-hero-bg" />
        <div className="mkt-container">
          <FadeIn className="ft-hero-content">
            <h1>Built for Real Stores,{' '}<span className="text-gradient">Not Just Demos</span></h1>
            <p>Every feature listed here is live and running in production stores today. No vaporware.</p>
            <MarketingButton href="/contact" size="lg" icon={ArrowRight}>Get Started Today</MarketingButton>
          </FadeIn>
        </div>
        {/* Auto-scrolling thumbnail marquee */}
        <div className="ft-marquee-wrap">
          <div className="ft-marquee">
            {[...marqueeScreens, ...marqueeScreens].map((src, i) => (
              <div key={i} className="ft-marquee-thumb">
                <img src={src} alt="" loading="lazy" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 1. POS SYSTEM ═══ */}
      <MarketingSection id="pos" bgVariant="white">
        <FeatureRow
          tag="Point of Sale"
          title='A Complete POS <span class="text-gradient">Built for Real Stores</span>'
          desc="Storeveu POS is a full cashier app designed for high-volume retail. Handles groceries, liquor, lottery, EBT/SNAP, bottle deposits, and more."
          visual={<BrowserFrame src={ssPOS} alt="Storeveu POS Screen" label="POS Terminal" />}
          bullets={<>
            <Bullet icon={WifiOff} title="Offline-First PWA" desc="Works without internet via IndexedDB. Syncs automatically on reconnect." />
            <Bullet icon={ScanBarcode} title="Multi-UPC Barcode Scanning" desc="Multiple barcodes per product, pack-size picker, and real-time offline cache." />
            <Bullet icon={CreditCard} title="Multi-Payment Tender" desc="Cash, card (PAX terminals), EBT/SNAP, and split tender — all supported natively." />
            <Bullet icon={ShieldCheck} title="Age Verification" desc="Automatic 21+ enforcement for tobacco, alcohol, and age-restricted items." />
            <Bullet icon={Users} title="Customer Lookup & Loyalty" desc="Search customers at checkout by phone or card. Points accrue instantly." />
            <Bullet icon={LayoutGrid} title="Quick Access Folders" desc="Customizable product shortcut panels — tap to add, no barcode needed." />
          </>}
        />
      </MarketingSection>

      {/* ═══ 2. LOTTERY ═══ */}
      <MarketingSection id="lottery" bgVariant="light">
        <FeatureRow
          reverse
          tag="Specialty Retail"
          title='Built-in <span class="text-gradient">Lottery Management</span>'
          desc="Manage state and provincial lottery games without a separate system. Box activation to shift-end scanning — everything lives in Storeveu."
          visual={
            <div className="ft-mock-ui">
              <div className="ft-mock-header"><Ticket size={20} /> Lottery Shift Report</div>
              <div className="ft-mock-table">
                <div className="ft-mock-row ft-mock-row-h"><span>Game</span><span>Sold</span><span>Amount</span><span>Status</span></div>
                <div className="ft-mock-row"><span>Mega Millions</span><span>42</span><span>$84.00</span><span className="ft-badge ft-badge-green">Settled</span></div>
                <div className="ft-mock-row"><span>Powerball</span><span>28</span><span>$56.00</span><span className="ft-badge ft-badge-green">Settled</span></div>
                <div className="ft-mock-row"><span>Scratch-offs</span><span>65</span><span>$195.00</span><span className="ft-badge ft-badge-amber">Pending</span></div>
              </div>
            </div>
          }
          bullets={<>
            <Bullet icon={Globe} title="State/Province-Scoped Games" desc="Admin configures games per region; stores only see their relevant games." />
            <Bullet icon={Boxes} title="Box Inventory Lifecycle" desc="Track boxes from receiving through activation, depletion, and settlement." />
            <Bullet icon={ClipboardList} title="Shift-End Reconciliation" desc="Mandate ticket scanning at shift close. Variance calculated automatically." />
            <Bullet icon={DollarSign} title="Commission Reporting" desc="Store-level commission rates with downloadable CSV and chart reports." />
            <Bullet icon={Lock} title="Cash-Only Enforcement" desc="Optionally restrict lottery transactions to cash only at the tender screen." />
          </>}
        />
      </MarketingSection>

      {/* ═══ 3. VENDOR & INVENTORY ═══ */}
      <MarketingSection id="vendors" bgVariant="white">
        <FeatureRow
          tag="Vendor & Inventory"
          title='Intelligent <span class="text-gradient">Auto-Ordering</span>'
          desc="Stop guessing what to order. Storeveu analyzes 14 factors — from sales velocity to weather forecasts — to generate optimal purchase orders automatically."
          visual={<BrowserFrame src={ssVendorOrders} alt="Vendor Orders" label="Vendor Orders" />}
          bullets={<>
            <Bullet icon={TrendingUp} title="14-Factor Algorithm" desc="Velocity, trend, Holt-Winters, weather, holidays, shelf life, stockout history, and more." />
            <Bullet icon={ClipboardList} title="PO Lifecycle Management" desc="Draft, submit, receive (partial or full). Download as PDF for your vendors." />
            <Bullet icon={Package} title="Vendor Product Mapping" desc="Map vendor item codes to your catalog. Track payments by type." />
          </>}
        />
      </MarketingSection>

      {/* ═══ 4. ANALYTICS ═══ */}
      <MarketingSection id="analytics" bgVariant="light">
        <FeatureRow
          reverse
          tag="Analytics & Intelligence"
          title='Predictions Powered by <span class="text-gradient">Real Data</span>'
          desc="Triple exponential smoothing, weather correlation, and holiday calendars forecast your sales with precision."
          visual={
            <div className="ft-composite">
              <BrowserFrame src={ssAnalytics} alt="Analytics Dashboard" label="Analytics" className="ft-composite-main" />
              <div className="ft-composite-float">
                <img src={ssPredictions} alt="Sales Predictions" loading="lazy" />
              </div>
            </div>
          }
          bullets={<>
            <Bullet icon={RefreshCw} title="Live Dashboard" desc="Real-time KPIs, hourly chart, payment breakdown, top products, live feed, and 14-day trend." />
            <Bullet icon={LineChart} title="Holt-Winters Forecasting" desc="Triple exponential smoothing with day-of-week, holiday, and weather adjustments." />
            <Bullet icon={CloudRain} title="Weather Correlation" desc="Open-Meteo integration correlates weather patterns with your actual sales data." />
            <Bullet icon={BarChart3} title="Department & Product Analytics" desc="Sales by department, velocity ranking, and full CSV/PDF export." />
          </>}
        />
      </MarketingSection>

      {/* ═══ 5. AI INVOICE IMPORT ═══ */}
      <MarketingSection id="ocr" bgVariant="white">
        <FeatureRow
          tag="Automation"
          title='AI-Powered <span class="text-gradient">Invoice Import</span>'
          desc="Stop typing. Azure Document Intelligence + GPT-4o-mini scan your vendor invoices and structure them into your catalog automatically."
          visual={<BrowserFrame src={ssInvoice} alt="Invoice Import" label="Invoice Scanner" />}
          bullets={<>
            <Bullet icon={FileSearch} title="Multi-File Batch Upload" desc="Process PDF, JPEG, and PNG invoices in bulk, saving hours of manual time." />
            <Bullet icon={Layers} title="6-Tier Matching Engine" desc="Intelligent matching across UPC, SKU, and vendor maps for maximum accuracy." />
            <Bullet icon={Cpu} title="Split-Pane Review UI" desc="Verify data with a dual-view: original scan alongside editable line items." />
          </>}
        />
      </MarketingSection>

      {/* ═══ 6. E-COMMERCE ═══ */}
      <MarketingSection id="ecommerce" bgVariant="light">
        <FeatureRow
          reverse
          tag="E-Commerce"
          title='Your Own <span class="text-gradient">Online Storefront</span>'
          desc="Branded website for every store with real-time product sync from the POS. Customers browse, cart, checkout, and pick up — all connected to live inventory."
          visual={
            <div className="ft-mock-ui ft-mock-ecom">
              <div className="ft-mock-header"><ShoppingCart size={20} /> Online Store</div>
              <div className="ft-mock-grid">
                <div className="ft-mock-product"><div className="ft-mock-img" /><span>Organic Apples</span><span className="ft-mock-price">$4.99</span></div>
                <div className="ft-mock-product"><div className="ft-mock-img" /><span>Almond Milk</span><span className="ft-mock-price">$3.49</span></div>
                <div className="ft-mock-product"><div className="ft-mock-img" /><span>Fresh Bread</span><span className="ft-mock-price">$5.99</span></div>
                <div className="ft-mock-product"><div className="ft-mock-img" /><span>Orange Juice</span><span className="ft-mock-price">$6.99</span></div>
              </div>
            </div>
          }
          bullets={<>
            <Bullet icon={Store} title="Branded Storefront per Store" desc="Next.js site with 15 premium templates, custom colors, fonts, and logo." />
            <Bullet icon={RefreshCw} title="Real-Time Product Sync" desc="Products sync automatically from your POS catalog — no double entry." />
            <Bullet icon={ShoppingCart} title="Full Shopping Experience" desc="Cart, checkout, customer accounts, order tracking, and email notifications." />
            <Bullet icon={Globe} title="Custom Domain with SSL" desc="Connect your own domain with DNS verification and automatic SSL." />
          </>}
        />
      </MarketingSection>

      {/* ═══ 7. HARDWARE ═══ */}
      <MarketingSection id="hardware" bgVariant="white">
        <FeatureRow
          tag="Hardware"
          title='Every Device, <span class="text-gradient">Out of the Box</span>'
          desc="Set up your register in minutes. Electron desktop app with native USB/network printing, cash drawer control, and customer display."
          visual={
            <div className="ft-mock-ui ft-mock-hw">
              <div className="ft-mock-header"><Printer size={20} /> Hardware Setup</div>
              <div className="ft-mock-devices">
                <div className="ft-mock-device"><SquareTerminal size={24} /><span>PAX Terminal</span><span className="ft-badge ft-badge-green">Connected</span></div>
                <div className="ft-mock-device"><Printer size={24} /><span>Receipt Printer</span><span className="ft-badge ft-badge-green">Connected</span></div>
                <div className="ft-mock-device"><Monitor size={24} /><span>Customer Display</span><span className="ft-badge ft-badge-green">Active</span></div>
              </div>
            </div>
          }
          bullets={<>
            <Bullet icon={SquareTerminal} title="Electron Desktop App" desc="Native Windows app with USB/network printing and cash drawer via IPC." />
            <Bullet icon={Printer} title="Receipt Printers" desc="ESC/POS compatible via USB or TCP/IP — auto-detect supported." />
            <Bullet icon={CreditCard} title="PAX Payment Terminals" desc="A30, A35, A80, S300 — direct integration at interchange rates." />
            <Bullet icon={Monitor} title="Customer-Facing Display" desc="Read-only second screen showing live cart and totals to customers." />
          </>}
        />
      </MarketingSection>

      {/* ═══ 8. BACK-OFFICE ═══ */}
      <MarketingSection id="backoffice" bgVariant="light">
        <FeatureRow
          reverse
          tag="Back-Office Management"
          title='Run Your Store <span class="text-gradient">From Anywhere</span>'
          desc="Full management portal for products, employees, transactions, and compliance — accessible from any browser."
          visual={
            <div className="ft-composite">
              <BrowserFrame src={ssProducts} alt="Product Catalog" label="Products" className="ft-composite-main" />
              <div className="ft-composite-stack">
                <img src={ssEmployees} alt="Employees" className="ft-composite-mini" loading="lazy" />
                <img src={ssTransactions} alt="Transactions" className="ft-composite-mini" loading="lazy" />
              </div>
            </div>
          }
          bullets={<>
            <Bullet icon={Package} title="Product Catalog" desc="Multi-UPC, multi-pack-size, deposit rules, tax rules, and department management." />
            <Bullet icon={Zap} title="Promotions Engine" desc="BOGO, volume, mix and match, and combo promotions with date scheduling." />
            <Bullet icon={Clock} title="Employee Management" desc="Clock-in/out with PIN, timesheet reports, session management, and PDF export." />
            <Bullet icon={Database} title="Bulk Import" desc="CSV/Excel import with column mapping, AI invoice OCR, and CSV transform." />
            <Bullet icon={Receipt} title="Transaction Browser" desc="Advanced filters, receipt modal, real-time refresh, and full event log." />
          </>}
        />
      </MarketingSection>

      {/* ═══ MORE FEATURES (dark grid) ═══ */}
      <MarketingSection bgVariant="dark" title="And Much More">
        <div className="ft-quick-grid">
          {[
            { icon: Globe, title: 'Multi-Store Management', desc: 'Manage multiple locations from one portal with per-store settings.' },
            { icon: Lock, title: 'Role-Based Access', desc: 'Five-tier hierarchy from cashier to superadmin with granular permissions.' },
            { icon: DollarSign, title: 'Shift & Cash Control', desc: 'Opening float, mid-shift drops, vendor payouts, and reconciliation.' },
            { icon: Recycle, title: 'Bottle Deposit Redemption', desc: 'Negative line items for container returns. Refund calculated automatically.' },
            { icon: BaggageClaim, title: 'Bag Fee System', desc: 'Configurable per-bag fee at checkout. Works with discounts and EBT.' },
            { icon: HeadphonesIcon, title: 'Support Tickets', desc: 'Store-to-admin threads with priority levels and status tracking.' },
            { icon: FileText, title: 'Subscription Billing', desc: 'Plans, add-ons, invoices, and an equipment store — fully managed.' },
            { icon: UserCheck, title: 'Admin Impersonation', desc: 'Login-as-user for troubleshooting. Approval and suspension built in.' },
            { icon: Mail, title: 'Email Notifications', desc: 'Branded emails for password reset, user approval, and order updates.' },
          ].map((f, i) => {
            const Icon = f.icon;
            return (
              <FadeIn key={i} className="ft-quick-card" delay={i * 0.04}>
                <Icon size={28} />
                <h4>{f.title}</h4>
                <p>{f.desc}</p>
              </FadeIn>
            );
          })}
        </div>
      </MarketingSection>

      {/* ═══ INTEGRATIONS ═══ */}
      <div className="ft-integrations">
        <div className="mkt-container">
          <p className="ft-integrations-label">POWERED BY AND INTEGRATED WITH</p>
          <div className="ft-integrations-logos">
            {['Azure AI', 'OpenAI GPT-4o', 'PAX POSLINK', 'Open-Meteo', 'Next.js', 'BullMQ', 'ESC/POS', 'Electron'].map(n => (
              <span key={n} className="ft-int-logo">{n}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ COMING SOON ═══ */}
      <MarketingSection bgVariant="light" title="On the Roadmap" subtitle="These features are in active development.">
        <div className="ft-roadmap">
          {[
            { icon: Smartphone, title: 'Mobile Manager App', desc: 'Approve discounts, view reports, and get push alerts from your phone.' },
            { icon: MonitorSmartphone, title: 'Kiosk / Self-Checkout', desc: 'Customer-facing self-checkout mode for express lanes.' },
            { icon: Fuel, title: 'Fuel Pump Integration', desc: 'Connect forecourt pumps to your POS for unified sales.' },
            { icon: MapPin, title: 'Multi-State Lottery', desc: 'Full regulatory support for US states and Canadian provinces.' },
          ].map((f, i) => {
            const Icon = f.icon;
            return (
              <FadeIn key={i} className="ft-roadmap-card" delay={i * 0.06}>
                <div className="ft-roadmap-icon"><Icon size={24} /></div>
                <h4>{f.title}</h4>
                <p>{f.desc}</p>
                <span className="ft-roadmap-badge">Coming Soon</span>
              </FadeIn>
            );
          })}
        </div>
      </MarketingSection>

      <MarketingFooter />
    </div>
  );
};

export default Features;
