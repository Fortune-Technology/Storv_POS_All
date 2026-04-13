import React from 'react';
import MarketingNavbar from '../../components/marketing/MarketingNavbar';
import MarketingFooter from '../../components/marketing/MarketingFooter';
import MarketingSection from '../../components/marketing/MarketingSection';
import MarketingButton from '../../components/marketing/MarketingButton';
import SEO from '../../components/SEO';
import {
  Cpu,
  FileSearch,
  Layers,
  Zap,
  CloudRain,
  TrendingUp,
  Calendar,
  ArrowRight,
  Database,
  Search,
  RefreshCw,
  LineChart,
  BarChart3,
  Globe,
  ShoppingCart,
  Monitor,
  Package,
  Ticket,
  Settings,
  Wifi,
  WifiOff,
  Users,
  CreditCard,
  DollarSign,
  Scale,
  Printer,
  Smartphone,
  Truck,
  Store,
  ShieldCheck,
  ClipboardList,
  Boxes,
  ScanBarcode,
  Palette,
  LayoutGrid,
  Receipt,
  Clock,
  FileText,
  Lock,
  HeadphonesIcon,
  Fuel,
  MonitorSmartphone,
  MapPin,
  Mail,
  UserCheck,
  SquareTerminal,
  Recycle,
  BaggageClaim,
} from 'lucide-react';
import './Features.css';

const Features = () => {
  return (
    <div className="features-page">
      <SEO
        title="Features"
        description="Explore Storeveu's complete feature set: offline-first POS, lottery management, 14-factor auto-ordering, Holt-Winters sales predictions, e-commerce storefronts, and more."
        url="https://storeveu.com/features"
      />
      <MarketingNavbar />

      {/* Page Hero */}
      <section className="features-hero">
        <div className="mkt-container">
          <div className="features-hero-content">
            <h1 className="features-title">
              Built for Real Stores, <span className="text-gradient">Not Just Demos</span>
            </h1>
            <p className="features-subtitle">
              Storeveu ships a complete retail operating system -- from the cashier screen to the back office.
              Every feature listed here is live and running in production stores today.
            </p>
            <MarketingButton href="/contact" size="lg">Get Started Today</MarketingButton>
          </div>
        </div>
      </section>

      {/* Section 1 — Full Point-of-Sale System */}
      <MarketingSection id="pos" bgVariant="white">
        <div className="feature-detail-grid">
          <div className="feature-detail-visual">
            <div className="analytics-placeholder-visual">
              <div className="placeholder-icon-wrap">
                <Monitor size={64} strokeWidth={1.2} />
              </div>
              <div className="placeholder-label">Storeveu POS -- Cashier Screen</div>
              <div className="placeholder-badges">
                <span className="pbadge">Cash</span>
                <span className="pbadge">Card</span>
                <span className="pbadge pbadge-green">EBT</span>
                <span className="pbadge pbadge-blue">Split</span>
              </div>
            </div>
          </div>
          <div className="feature-detail-content">
            <div className="feature-category">Point of Sale</div>
            <h2>A Complete POS <span className="text-green">Built for Real Stores</span></h2>
            <p>
              Storeveu POS is a full cashier app designed for high-volume retail. Handles groceries, liquor,
              lottery, EBT/SNAP, bottle deposits, and more -- all in one screen with offline-first reliability.
            </p>
            <ul className="feature-bullets">
              <li>
                <div className="bullet-icon"><WifiOff size={20} /></div>
                <div>
                  <strong>Offline-First PWA</strong>
                  <p>Works without internet via IndexedDB. Scans never fail -- syncs automatically on reconnect.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><ScanBarcode size={20} /></div>
                <div>
                  <strong>Multi-UPC Barcode Scanning</strong>
                  <p>Multiple barcodes per product, pack size picker (single, 6-pack, case), and real-time offline cache.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><CreditCard size={20} /></div>
                <div>
                  <strong>Multi-Payment Tender</strong>
                  <p>Cash, card (PAX terminals), EBT/SNAP, and split tender -- all supported natively.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><ShieldCheck size={20} /></div>
                <div>
                  <strong>Age Verification</strong>
                  <p>Automatic 21+ enforcement for tobacco, alcohol, and all age-restricted items.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Users size={20} /></div>
                <div>
                  <strong>Customer Lookup and Loyalty</strong>
                  <p>Search customers at checkout by phone or loyalty card. Points accrue instantly at the register.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><LayoutGrid size={20} /></div>
                <div>
                  <strong>Quick Access Folders</strong>
                  <p>Customizable product shortcut panels for high-frequency items -- tap to add, no barcode needed.</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </MarketingSection>

      {/* Section 2 — Lottery Module */}
      <MarketingSection id="lottery" bgVariant="light">
        <div className="feature-detail-grid reverse">
          <div className="feature-detail-content">
            <div className="feature-category">Specialty Retail</div>
            <h2>Built-in <span className="text-red">Lottery Management</span></h2>
            <p>
              Manage state and provincial lottery games without a separate system. From box activation
              to cashier scanning at shift end, everything lives in Storeveu.
            </p>
            <ul className="feature-bullets">
              <li>
                <div className="bullet-icon"><Globe size={20} /></div>
                <div>
                  <strong>State/Province-Scoped Games</strong>
                  <p>Admin configures games per region; each store only sees the games relevant to them.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Boxes size={20} /></div>
                <div>
                  <strong>Box Inventory Lifecycle</strong>
                  <p>Track boxes from receiving through activation, depletion, and settlement -- full audit trail.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><ClipboardList size={20} /></div>
                <div>
                  <strong>Shift-End Ticket Reconciliation</strong>
                  <p>Mandate ticket scanning at shift close. Variance calculated automatically against sales.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><DollarSign size={20} /></div>
                <div>
                  <strong>Commission Reporting</strong>
                  <p>Store-level commission rates with downloadable CSV and visual chart reports.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Lock size={20} /></div>
                <div>
                  <strong>Cash-Only Enforcement</strong>
                  <p>Optionally restrict lottery transactions to cash only -- enforced at the tender screen.</p>
                </div>
              </li>
            </ul>
          </div>
          <div className="feature-detail-visual">
            <div className="analytics-placeholder-visual">
              <div className="placeholder-icon-wrap">
                <Ticket size={64} strokeWidth={1.2} />
              </div>
              <div className="placeholder-label">Lottery Shift Report</div>
              <div className="placeholder-badges">
                <span className="pbadge">Games</span>
                <span className="pbadge pbadge-blue">Variance</span>
                <span className="pbadge pbadge-green">Commission</span>
              </div>
            </div>
          </div>
        </div>
      </MarketingSection>

      {/* Section 3 — Vendor & Inventory */}
      <MarketingSection id="vendors" bgVariant="white">
        <div className="feature-detail-grid">
          <div className="feature-detail-visual">
            <div className="analytics-placeholder-visual">
              <div className="placeholder-icon-wrap">
                <Truck size={64} strokeWidth={1.2} />
              </div>
              <div className="placeholder-label">14-Factor Auto-Order Engine</div>
              <div className="placeholder-badges">
                <span className="pbadge">Velocity</span>
                <span className="pbadge pbadge-blue">Weather</span>
                <span className="pbadge pbadge-green">Safety Stock</span>
                <span className="pbadge pbadge-yellow">Holt-Winters</span>
              </div>
            </div>
          </div>
          <div className="feature-detail-content">
            <div className="feature-category">Vendor and Inventory</div>
            <h2>Intelligent <span className="text-blue">Auto-Ordering</span></h2>
            <p>
              Stop guessing what to order. Storeveu analyzes 14 factors -- from sales velocity and weather
              forecasts to shelf life and stockout history -- to generate optimal purchase orders automatically.
            </p>
            <ul className="feature-bullets">
              <li>
                <div className="bullet-icon"><TrendingUp size={20} /></div>
                <div>
                  <strong>14-Factor Algorithm</strong>
                  <p>Sales velocity, trend, Holt-Winters forecast, day-of-week, holiday, weather, inventory, lead time, safety stock, pack/case size, min order, shelf life, demand variability, and stockout history.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><ClipboardList size={20} /></div>
                <div>
                  <strong>PO Lifecycle Management</strong>
                  <p>Draft, submit, and receive (partial or full) purchase orders. Download as PDF for your vendors.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Package size={20} /></div>
                <div>
                  <strong>Vendor Product Mapping</strong>
                  <p>Map vendor item codes to your catalog. Track payments by expense or merchandise type.</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </MarketingSection>

      {/* Section 4 — Analytics & Intelligence */}
      <MarketingSection id="analytics" bgVariant="light">
        <div className="feature-detail-grid reverse">
          <div className="feature-detail-content">
            <div className="feature-category">Analytics and Intelligence</div>
            <h2>Predictions Powered by <span className="text-green">Real Data</span></h2>
            <p>
              Storeveu combines triple exponential smoothing, weather correlation, and holiday calendars
              to forecast your sales with precision. Every analytics page exports to CSV and PDF.
            </p>
            <ul className="feature-bullets">
              <li>
                <div className="bullet-icon"><RefreshCw size={20} /></div>
                <div>
                  <strong>Live Dashboard</strong>
                  <p>Real-time KPIs, hourly sales chart, payment breakdown, top products, live transaction feed, and 14-day trend.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><LineChart size={20} /></div>
                <div>
                  <strong>Holt-Winters Forecasting</strong>
                  <p>Triple exponential smoothing with day-of-week adjustment, holiday multipliers, and weather impact regression.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><CloudRain size={20} /></div>
                <div>
                  <strong>Weather Correlation</strong>
                  <p>Open-Meteo integration correlates rain, snow, heat, and cold with your actual sales patterns.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><BarChart3 size={20} /></div>
                <div>
                  <strong>Department and Product Analytics</strong>
                  <p>Sales by department, product velocity ranking, and full CSV/PDF export on every page.</p>
                </div>
              </li>
            </ul>
          </div>
          <div className="feature-detail-visual">
            <div className="analytics-placeholder-visual">
              <div className="placeholder-icon-wrap">
                <LineChart size={64} strokeWidth={1.2} />
              </div>
              <div className="placeholder-label">Sales Predictions Engine</div>
              <div className="placeholder-badges">
                <span className="pbadge">Holt-Winters</span>
                <span className="pbadge pbadge-blue">Weather</span>
                <span className="pbadge pbadge-green">Holiday</span>
                <span className="pbadge pbadge-yellow">CSV/PDF</span>
              </div>
            </div>
          </div>
        </div>
      </MarketingSection>

      {/* Section 5 — AI Invoice Import */}
      <MarketingSection id="ocr" bgVariant="white">
        <div className="feature-detail-grid">
          <div className="feature-detail-visual">
            <div className="analytics-placeholder-visual">
              <div className="placeholder-icon-wrap">
                <FileSearch size={64} strokeWidth={1.2} />
              </div>
              <div className="placeholder-label">Invoice Scan and Review</div>
              <div className="placeholder-badges">
                <span className="pbadge">PDF</span>
                <span className="pbadge">JPEG</span>
                <span className="pbadge pbadge-green">Matched</span>
                <span className="pbadge pbadge-yellow">Review</span>
              </div>
            </div>
          </div>
          <div className="feature-detail-content">
            <div className="feature-category">Automation</div>
            <h2>AI-Powered <span className="text-blue">Invoice Import</span></h2>
            <p>
              Stop typing. Our hybrid AI -- Azure Document Intelligence plus GPT-4o-mini -- scans your
              paper or PDF vendor invoices in seconds and structures them into your catalog automatically.
            </p>
            <ul className="feature-bullets">
              <li>
                <div className="bullet-icon"><FileSearch size={20} /></div>
                <div>
                  <strong>Multi-File Batch Upload</strong>
                  <p>Process PDF, JPEG, and PNG invoices in bulk, saving hours of manual office time.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Layers size={20} /></div>
                <div>
                  <strong>6-Tier Matching Engine</strong>
                  <p>Intelligent matching across UPC, SKU, and vendor maps to maximise accuracy.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Cpu size={20} /></div>
                <div>
                  <strong>Split-Pane Review UI</strong>
                  <p>Verify data with a dual-view interface showing the original scan alongside editable line items.</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </MarketingSection>

      {/* Section 6 — E-Commerce */}
      <MarketingSection id="ecommerce" bgVariant="light">
        <div className="feature-detail-grid reverse">
          <div className="feature-detail-content">
            <div className="feature-category">E-Commerce</div>
            <h2>Your Own <span className="text-green">Online Storefront</span></h2>
            <p>
              Give every store its own branded website with real-time product sync from the POS.
              Customers browse, add to cart, check out, and pick up or get delivery -- all connected to your live inventory.
            </p>
            <ul className="feature-bullets">
              <li>
                <div className="bullet-icon"><Store size={20} /></div>
                <div>
                  <strong>Branded Storefront per Store</strong>
                  <p>Next.js server-rendered site with 15 premium page templates, custom colors, fonts, and logo.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><RefreshCw size={20} /></div>
                <div>
                  <strong>Real-Time Product Sync</strong>
                  <p>Products sync automatically from your POS catalog via BullMQ or HTTP fallback.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><ShoppingCart size={20} /></div>
                <div>
                  <strong>Full Shopping Experience</strong>
                  <p>Cart, checkout, customer accounts, order tracking, and email notifications -- all built in.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Globe size={20} /></div>
                <div>
                  <strong>Custom Domain with SSL</strong>
                  <p>Connect your own domain with DNS verification and automatic SSL certificate provisioning.</p>
                </div>
              </li>
            </ul>
          </div>
          <div className="feature-detail-visual">
            <div className="analytics-placeholder-visual">
              <div className="placeholder-icon-wrap">
                <ShoppingCart size={64} strokeWidth={1.2} />
              </div>
              <div className="placeholder-label">Online Store Builder</div>
              <div className="placeholder-badges">
                <span className="pbadge">Templates</span>
                <span className="pbadge pbadge-blue">Sync</span>
                <span className="pbadge pbadge-green">SSL</span>
                <span className="pbadge pbadge-yellow">Orders</span>
              </div>
            </div>
          </div>
        </div>
      </MarketingSection>

      {/* Section 7 — Hardware Integration */}
      <MarketingSection id="hardware" bgVariant="white">
        <div className="feature-detail-grid">
          <div className="feature-detail-visual">
            <div className="analytics-placeholder-visual">
              <div className="placeholder-icon-wrap">
                <Printer size={64} strokeWidth={1.2} />
              </div>
              <div className="placeholder-label">Hardware Setup Wizard</div>
              <div className="placeholder-badges">
                <span className="pbadge">PAX</span>
                <span className="pbadge pbadge-blue">ESC/POS</span>
                <span className="pbadge pbadge-green">Electron</span>
              </div>
            </div>
          </div>
          <div className="feature-detail-content">
            <div className="feature-category">Hardware</div>
            <h2>Every Device, <span className="text-green">Out of the Box</span></h2>
            <p>
              Set up your register in minutes. Storeveu runs as an Electron desktop app with native USB
              and network printing, cash drawer control, and a customer-facing second display.
            </p>
            <ul className="feature-bullets">
              <li>
                <div className="bullet-icon"><SquareTerminal size={20} /></div>
                <div>
                  <strong>Electron Desktop App</strong>
                  <p>Native Windows app with USB/network printing and cash drawer support via IPC.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Printer size={20} /></div>
                <div>
                  <strong>Receipt Printers</strong>
                  <p>ESC/POS compatible via USB or TCP/IP network -- auto-detect supported.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><CreditCard size={20} /></div>
                <div>
                  <strong>PAX Payment Terminals</strong>
                  <p>A30, A35, A80, S300 -- direct integration at interchange rates, no middleman markup.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Monitor size={20} /></div>
                <div>
                  <strong>Customer-Facing Display</strong>
                  <p>Read-only second screen showing live cart, totals, and thank-you screen to customers.</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </MarketingSection>

      {/* Section 8 — Back-Office Management */}
      <MarketingSection id="backoffice" bgVariant="light">
        <div className="feature-detail-grid reverse">
          <div className="feature-detail-content">
            <div className="feature-category">Back-Office Management</div>
            <h2>Run Your Store <span className="text-blue">From Anywhere</span></h2>
            <p>
              A full management portal for products, employees, transactions, and compliance --
              accessible from any browser, no software to install.
            </p>
            <ul className="feature-bullets">
              <li>
                <div className="bullet-icon"><Package size={20} /></div>
                <div>
                  <strong>Product Catalog</strong>
                  <p>Multi-UPC, multi-pack-size, deposit rules, tax rules, and department management with drag-to-reorder.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Zap size={20} /></div>
                <div>
                  <strong>Promotions Engine</strong>
                  <p>Sale, BOGO, volume, mix and match, and combo promotions with date scheduling.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Clock size={20} /></div>
                <div>
                  <strong>Employee Management</strong>
                  <p>Clock-in/out with PIN, timesheet reports, session management, and PDF export.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Database size={20} /></div>
                <div>
                  <strong>Bulk Import</strong>
                  <p>CSV/Excel import with column mapping, AI invoice OCR, and CSV transform pipeline.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Receipt size={20} /></div>
                <div>
                  <strong>Transaction Browser</strong>
                  <p>Advanced filters, receipt modal, real-time refresh, and full event log.</p>
                </div>
              </li>
            </ul>
          </div>
          <div className="feature-detail-visual">
            <div className="analytics-placeholder-visual">
              <div className="placeholder-icon-wrap">
                <Settings size={64} strokeWidth={1.2} />
              </div>
              <div className="placeholder-label">Management Portal</div>
              <div className="placeholder-badges">
                <span className="pbadge">Catalog</span>
                <span className="pbadge pbadge-blue">Employees</span>
                <span className="pbadge pbadge-green">Reports</span>
                <span className="pbadge pbadge-yellow">Import</span>
              </div>
            </div>
          </div>
        </div>
      </MarketingSection>

      {/* Quick Features Grid */}
      <MarketingSection bgVariant="dark" title="And Much More">
        <div className="quick-features-grid">
          <div className="quick-f-card">
            <Globe size={32} />
            <h4>Multi-Store Management</h4>
            <p>Manage multiple locations from one portal with per-store settings and isolated data.</p>
          </div>
          <div className="quick-f-card">
            <Lock size={32} />
            <h4>Role-Based Access</h4>
            <p>Five-tier role hierarchy from cashier to superadmin with granular permission control.</p>
          </div>
          <div className="quick-f-card">
            <DollarSign size={32} />
            <h4>Shift and Cash Control</h4>
            <p>Opening float, mid-shift drops, vendor payouts, and full shift reconciliation reports.</p>
          </div>
          <div className="quick-f-card">
            <Recycle size={32} />
            <h4>Bottle Deposit Redemption</h4>
            <p>Negative line items in cart for container returns. Refund due calculated automatically.</p>
          </div>
          <div className="quick-f-card">
            <BaggageClaim size={32} />
            <h4>Bag Fee System</h4>
            <p>Configurable per-bag fee added at checkout. Works with discounts and EBT rules.</p>
          </div>
          <div className="quick-f-card">
            <HeadphonesIcon size={32} />
            <h4>Support Ticket System</h4>
            <p>Store-to-admin conversation threads with priority levels and status tracking.</p>
          </div>
          <div className="quick-f-card">
            <FileText size={32} />
            <h4>Subscription Billing</h4>
            <p>Plans, add-ons, invoices, and an equipment store -- all managed from the admin panel.</p>
          </div>
          <div className="quick-f-card">
            <UserCheck size={32} />
            <h4>Admin Impersonation</h4>
            <p>Login-as-user for troubleshooting. User approval and suspension workflows built in.</p>
          </div>
          <div className="quick-f-card">
            <Mail size={32} />
            <h4>Email Notifications</h4>
            <p>Branded emails for password reset, user approval, order confirmation, and contact forms.</p>
          </div>
        </div>
      </MarketingSection>

      {/* Integrations Row */}
      <section className="integrations-section">
        <div className="mkt-container">
          <p className="integrations-label">POWERED BY AND INTEGRATED WITH</p>
          <div className="integrations-logos">
            <div className="logo-placeholder">Azure AI</div>
            <div className="logo-placeholder">OpenAI GPT-4o</div>
            <div className="logo-placeholder">PAX POSLINK</div>
            <div className="logo-placeholder">Open-Meteo</div>
            <div className="logo-placeholder">Next.js</div>
            <div className="logo-placeholder">BullMQ</div>
            <div className="logo-placeholder">ESC/POS</div>
            <div className="logo-placeholder">Electron</div>
          </div>
        </div>
      </section>

      {/* Coming Soon Section */}
      <section className="coming-soon-section">
        <div className="mkt-container">
          <div className="coming-soon-header">
            <h2>On the Roadmap</h2>
            <p>These features are in active development. Stay tuned.</p>
          </div>
          <div className="coming-soon-grid">
            <div className="coming-soon-card">
              <div className="coming-soon-icon">
                <Smartphone size={28} />
              </div>
              <h4>Mobile Manager App</h4>
              <p>Approve discounts, view reports, and get push alerts from your phone.</p>
              <span className="coming-soon-badge">Coming Soon</span>
            </div>
            <div className="coming-soon-card">
              <div className="coming-soon-icon">
                <MonitorSmartphone size={28} />
              </div>
              <h4>Kiosk / Self-Checkout</h4>
              <p>Customer-facing self-checkout mode for express lanes and unattended stations.</p>
              <span className="coming-soon-badge">Coming Soon</span>
            </div>
            <div className="coming-soon-card">
              <div className="coming-soon-icon">
                <Fuel size={28} />
              </div>
              <h4>Fuel Pump Integration</h4>
              <p>Connect forecourt pumps to your POS for unified fuel and in-store sales.</p>
              <span className="coming-soon-badge">Coming Soon</span>
            </div>
            <div className="coming-soon-card">
              <div className="coming-soon-icon">
                <MapPin size={28} />
              </div>
              <h4>Multi-State Lottery Compliance</h4>
              <p>Full regulatory support for US states and Canadian provinces in one system.</p>
              <span className="coming-soon-badge">Coming Soon</span>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="features-bottom-cta">
        <div className="mkt-container">
          <div className="cta-card">
            <h2>Ready to see it in action?</h2>
            <p>Schedule a personalized walk-through with our team today.</p>
            <MarketingButton href="/contact" size="xl">Request a Free Demo</MarketingButton>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

export default Features;
