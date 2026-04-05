import React from 'react';
import MarketingNavbar from '../../components/marketing/MarketingNavbar';
import MarketingFooter from '../../components/marketing/MarketingFooter';
import MarketingSection from '../../components/marketing/MarketingSection';
import MarketingButton from '../../components/marketing/MarketingButton';
import invoiceMockup from '../../assets/features-invoice-mockup.png';
import weatherMockup from '../../assets/features-weather-mockup.png';
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
  Globe
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
            <h1 className="features-title">Enterprise Power, <span className="text-gradient">Simplified</span></h1>
            <p className="features-subtitle">
              From AI-powered automation to predictive sales forecasting, Storeveu provides the tools you need to stay ahead of the competition.
            </p>
            <MarketingButton href="/contact" size="lg">Get Started Today</MarketingButton>
          </div>
        </div>
      </section>

      {/* AI Invoice Import Section */}
      <MarketingSection id="ocr" bgVariant="white">
        <div className="feature-detail-grid">
          <div className="feature-detail-visual">
            <img src={invoiceMockup} alt="AI Invoice Import UI" className="feature-mockup" />
          </div>
          <div className="feature-detail-content">
            <div className="feature-category">Automation</div>
            <h2>AI-Powered <span className="text-green">Invoice Import</span></h2>
            <p>
              Stop wasting hours on manual data entry. Our hybrid AI engine combines Azure Document Intelligence with GPT-4o-mini to scan and structure your vendor invoices in seconds.
            </p>
            <ul className="feature-bullets">
              <li>
                <div className="bullet-icon"><FileSearch size={20} /></div>
                <div>
                  <strong>Multi-File Batch Upload</strong>
                  <p>Process PDF, JPEG, and PNG invoices in bulk, saving hours of office time.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Layers size={20} /></div>
                <div>
                  <strong>6-Tier Matching Engine</strong>
                  <p>Intelligent matching across UPC, SKU, and Vendor Maps to ensure 99% accuracy.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Cpu size={20} /></div>
                <div>
                  <strong>Split-Pane Review</strong>
                  <p>Verify data with a dual-view UI showing the original scan alongside editable items.</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </MarketingSection>

      {/* Live Dashboard Section */}
      <MarketingSection id="dashboard" bgVariant="light">
        <div className="feature-detail-grid reverse">
          <div className="feature-detail-content">
            <div className="feature-category">Real-Time</div>
            <h2>The <span className="text-blue">Live Hub</span> Experience</h2>
            <p>
              Knowledge is power. Stay on top of your store's performance with a dedicated real-time hub designed to be kept open during business hours.
            </p>
            <ul className="feature-bullets">
              <li>
                <div className="bullet-icon"><RefreshCw size={20} /></div>
                <div>
                  <strong>60-Second Auto-Refresh</strong>
                  <p>Data updates automatically with a visible countdown timer for total transparency.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><CloudRain size={20} /></div>
                <div>
                  <strong>Weather Correlation</strong>
                  <p>See how temperature and rain impact your foot traffic and sales volume in real-time.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><BarChart3 size={20} /></div>
                <div>
                  <strong>Intelligent Fallback</strong>
                  <p>Always see the most recent data, even if today's POS sync is still pending.</p>
                </div>
              </li>
            </ul>
          </div>
          <div className="feature-detail-visual">
            <img src={weatherMockup} alt="Weather-Synced Dashboard" className="feature-mockup" />
          </div>
        </div>
      </MarketingSection>

      {/* Predictive Analytics Section */}
      <MarketingSection id="analytics" bgVariant="white">
        <div className="feature-detail-grid">
          <div className="feature-detail-visual">
            {/* Using a styled placeholder for this one to keep it balanced */}
            <div className="analytics-placeholder-visual">
              <div className="prediction-bars">
                <div className="bar" style={{ height: '60%' }}></div>
                <div className="bar" style={{ height: '80%' }}></div>
                <div className="bar highlighted" style={{ height: '95%' }}>
                   <div className="prediction-label">Prediction</div>
                </div>
                <div className="bar dashed" style={{ height: '70%' }}></div>
                <div className="bar dashed" style={{ height: '75%' }}></div>
              </div>
              <div className="holiday-marker"><Calendar size={16} /> Labor Day</div>
            </div>
          </div>
          <div className="feature-detail-content">
            <div className="feature-category">Intelligence</div>
            <h2>Advanced <span className="text-red">Sales Predictions</span></h2>
            <p>
              Anticipate the future using our proprietary forecasting engine. We use Holt-Winters Triple Exponential Smoothing to model your sales patterns.
            </p>
            <ul className="feature-bullets">
              <li>
                <div className="bullet-icon"><TrendingUp size={20} /></div>
                <div>
                  <strong>14-Day Sales Forecast</strong>
                  <p>Accurate daily predictions weighted by Day-of-Week factors and historical trends.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><Calendar size={20} /></div>
                <div>
                  <strong>Holiday Correlation</strong>
                  <p>Automatically flags major holidays to anticipate atypical spikes and dips in volume.</p>
                </div>
              </li>
              <li>
                <div className="bullet-icon"><LineChart size={20} /></div>
                <div>
                  <strong>Residual Error Analysis</strong>
                  <p>Transparent accuracy metrics (MAPE) so you know exactly how reliable the model is.</p>
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
            <Database size={32} />
            <h4>POS Integration</h4>
            <p>Direct sync with your POS catalog via high-performance APIs.</p>
          </div>
          <div className="quick-f-card">
            <Search size={32} />
            <h4>UPC Lookup</h4>
            <p>Search your entire product catalog from one search bar.</p>
          </div>
          <div className="quick-f-card">
            <Zap size={32} />
            <h4>Smart Ordering</h4>
            <p>Velocity-based recommendations to optimize your cash flow.</p>
          </div>
          <div className="quick-f-card">
            <Globe size={32} />
            <h4>Multi-Tenant</h4>
            <p>Isolate data securely across different organizations and users.</p>
          </div>
        </div>
      </MarketingSection>

      {/* Integrations Row */}
      <section className="integrations-section">
        <div className="mkt-container">
          <p className="integrations-label">WORKS SEAMLESSLY WITH</p>
          <div className="integrations-logos">
             {/* // TODO: add real integration logos */}
             <div className="logo-placeholder">AZURE AI</div>
             <div className="logo-placeholder">GPT-4</div>
             <div className="logo-placeholder">SHOPIFY</div>
             <div className="logo-placeholder">OPENWEATHER</div>
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
