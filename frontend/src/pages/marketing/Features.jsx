import React from 'react';
import MarketingNavbar from '../../components/marketing/MarketingNavbar';
import MarketingFooter from '../../components/marketing/MarketingFooter';
import MarketingSection from '../../components/marketing/MarketingSection';
import MarketingButton from '../../components/marketing/MarketingButton';
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
} from 'lucide-react';
import './Features.css';

const Features = () => {
  return (
    <div className="features-page">
      <MarketingNavbar />

      {/* Page Hero */}
      <section className="features-hero">
        <div className="mkt-container">
          <div className="features-hero-content">
            <h1 className="features-title">
              Built for Real Stores, <span className="text-gradient">Not Just Demos</span>
            </h1>
            <p className="features-subtitle">
              StoreVeu ships a complete retail operating system — from the cashier screen to the back office.
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
              <div className="placeholder-label">Storv POS — Cashier Screen</div>
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
              Storv POS is a full cashier-app designed for high-volume retail. Handles groceries, liquor,
              lottery, EBT/SNAP, and more — all in one screen.
            </p>
            <ul className="feature-bullets">
              <li>
                <div className="bullet-icon"><CreditCard size={20} /></div>
                <div>
                  <strong>Multi-Payment</strong>
                  <p>Cash, card (PAX terminal), EBT/SNAP, split tender — all supported natively.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Users size={20} /></div>
                <div>
                  <strong>Age Verification</strong>
                  <p>Built-in ID check flow for tobacco, alcohol, and all age-restricted items.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><DollarSign size={20} /></div>
                <div>
                  <strong>Promotions Engine</strong>
                  <p>Percentage and dollar discounts, order-level and line-level — manager-PIN protected.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Search size={20} /></div>
                <div>
                  <strong>Barcode Scanning</strong>
                  <p>Real-time scan-and-add with offline product cache so no scan is ever missed.</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </MarketingSection>

      {/* Section 2 — AI Invoice Import */}
      <MarketingSection id="ocr" bgVariant="light">
        <div className="feature-detail-grid reverse">
          <div className="feature-detail-content">
            <div className="feature-category">Automation</div>
            <h2>AI-Powered <span className="text-blue">Invoice Import</span></h2>
            <p>
              Stop typing. Our hybrid AI — Azure Document Intelligence plus GPT-4o-mini — scans your
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
          <div className="feature-detail-visual">
            <div className="analytics-placeholder-visual">
              <div className="placeholder-icon-wrap">
                <FileSearch size={64} strokeWidth={1.2} />
              </div>
              <div className="placeholder-label">Invoice Scan &amp; Review</div>
              <div className="placeholder-badges">
                <span className="pbadge">PDF</span>
                <span className="pbadge">JPEG</span>
                <span className="pbadge pbadge-green">Matched</span>
                <span className="pbadge pbadge-yellow">Review</span>
              </div>
            </div>
          </div>
        </div>
      </MarketingSection>

      {/* Section 3 — Lottery Module */}
      <MarketingSection id="lottery" bgVariant="white">
        <div className="feature-detail-grid">
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
          <div className="feature-detail-content">
            <div className="feature-category">Specialty Retail</div>
            <h2>Built-in <span className="text-red">Lottery Management</span></h2>
            <p>
              Manage provincial and state lottery games without a separate system. From box activation
              to cashier scanning at shift end, everything lives in StoreVeu.
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
                <div className="bullet-icon"><BarChart3 size={20} /></div>
                <div>
                  <strong>Shift-Wise Ticket Tracking</strong>
                  <p>Start and end ticket numbers calculated per shift with automatic variance reports.</p>
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
                <div className="bullet-icon"><Settings size={20} /></div>
                <div>
                  <strong>Cashier End-of-Shift Scan</strong>
                  <p>Mandate ticket scanning at shift close, configured from the backoffice.</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </MarketingSection>

      {/* Section 4 — Hardware Integration */}
      <MarketingSection id="hardware" bgVariant="light">
        <div className="feature-detail-grid reverse">
          <div className="feature-detail-content">
            <div className="feature-category">Hardware</div>
            <h2>Every Device, <span className="text-green">Out of the Box</span></h2>
            <p>
              Set up your register in minutes with our guided hardware wizard. StoreVeu speaks to real
              retail hardware — no IT department required.
            </p>
            <ul className="feature-bullets">
              <li>
                <div className="bullet-icon"><Printer size={20} /></div>
                <div>
                  <strong>Receipt Printers</strong>
                  <p>ESC/POS compatible via USB (QZ Tray) or TCP/IP network — auto-detect supported.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><CreditCard size={20} /></div>
                <div>
                  <strong>PAX Payment Terminals</strong>
                  <p>A30, A35, A80, S300 — direct integration at interchange rates, no middleman markup.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Scale size={20} /></div>
                <div>
                  <strong>Scales &amp; Scanners</strong>
                  <p>Web Serial API integration for CAS, Mettler Toledo, Avery, and more.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><DollarSign size={20} /></div>
                <div>
                  <strong>Cash Drawer</strong>
                  <p>Auto-kick on cash payment via RJ-11 through the receipt printer.</p>
                </div>
              </li>
            </ul>
          </div>
          <div className="feature-detail-visual">
            <div className="analytics-placeholder-visual">
              <div className="placeholder-icon-wrap">
                <Printer size={64} strokeWidth={1.2} />
              </div>
              <div className="placeholder-label">Hardware Setup Wizard</div>
              <div className="placeholder-badges">
                <span className="pbadge">PAX</span>
                <span className="pbadge pbadge-blue">ESC/POS</span>
                <span className="pbadge pbadge-green">Auto-Detect</span>
              </div>
            </div>
          </div>
        </div>
      </MarketingSection>

      {/* Section 5 — Shift & Cash Management */}
      <MarketingSection id="shifts" bgVariant="white">
        <div className="feature-detail-grid">
          <div className="feature-detail-visual">
            <div className="analytics-placeholder-visual">
              <div className="placeholder-icon-wrap">
                <DollarSign size={64} strokeWidth={1.2} />
              </div>
              <div className="placeholder-label">Shift Reconciliation Report</div>
              <div className="placeholder-badges">
                <span className="pbadge">Float</span>
                <span className="pbadge pbadge-blue">Drops</span>
                <span className="pbadge pbadge-green">Reconciled</span>
              </div>
            </div>
          </div>
          <div className="feature-detail-content">
            <div className="feature-category">Operations</div>
            <h2>Start-to-Close <span className="text-blue">Shift Control</span></h2>
            <p>
              Every shift is accounted for. Open with an opening float, track every drop and payout,
              and close with a full reconciliation report — all without leaving StoreVeu.
            </p>
            <ul className="feature-bullets">
              <li>
                <div className="bullet-icon"><DollarSign size={20} /></div>
                <div>
                  <strong>Opening &amp; Closing Floats</strong>
                  <p>Record and reconcile opening and closing cash counts with automatic variance reporting.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Settings size={20} /></div>
                <div>
                  <strong>Mid-Shift Drops &amp; Payouts</strong>
                  <p>Cash drops and payouts recorded in real-time, each requiring a manager PIN.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><BarChart3 size={20} /></div>
                <div>
                  <strong>Full Shift Report</strong>
                  <p>Sales broken down by payment method, lottery, refunds, and voids — ready to print or export.</p>
                </div>
              </li>
            </ul>
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
            <Users size={32} />
            <h4>Customer Loyalty</h4>
            <p>Points and rewards synced directly with the POS at the moment of sale.</p>
          </div>
          <div className="quick-f-card">
            <TrendingUp size={32} />
            <h4>Sales Predictions</h4>
            <p>Holt-Winters forecasting for 14-day sales volume with holiday spike detection.</p>
          </div>
          <div className="quick-f-card">
            <RefreshCw size={32} />
            <h4>Live Dashboard</h4>
            <p>60-second auto-refresh with weather correlation and intelligent data fallback.</p>
          </div>
          <div className="quick-f-card">
            <Package size={32} />
            <h4>Product Catalog</h4>
            <p>Full catalog with department, tax class, EBT eligibility, and deposit rules per item.</p>
          </div>
          <div className="quick-f-card">
            <WifiOff size={32} />
            <h4>Offline Mode</h4>
            <p>The POS keeps working when internet drops; syncs automatically on reconnect.</p>
          </div>
        </div>
      </MarketingSection>

      {/* Integrations Row */}
      <section className="integrations-section">
        <div className="mkt-container">
          <p className="integrations-label">POWERED BY &amp; INTEGRATED WITH</p>
          <div className="integrations-logos">
            <div className="logo-placeholder">Azure AI</div>
            <div className="logo-placeholder">OpenAI GPT-4o</div>
            <div className="logo-placeholder">PAX POSLINK</div>
            <div className="logo-placeholder">Web Serial API</div>
            <div className="logo-placeholder">ESC/POS</div>
            <div className="logo-placeholder">ZPL</div>
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
              <h4>Mobile App</h4>
              <p>Manage your store from your phone — inventory, reports, and alerts on the go.</p>
              <span className="coming-soon-badge">Coming Soon</span>
            </div>
            <div className="coming-soon-card">
              <div className="coming-soon-icon">
                <ShoppingCart size={28} />
              </div>
              <h4>Online Ordering</h4>
              <p>Integrated e-commerce for curbside pickup, connected directly to your inventory.</p>
              <span className="coming-soon-badge">Coming Soon</span>
            </div>
            <div className="coming-soon-card">
              <div className="coming-soon-icon">
                <LineChart size={28} />
              </div>
              <h4>Vendor Portal</h4>
              <p>Let vendors update their own prices and invoices through a self-serve portal.</p>
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
