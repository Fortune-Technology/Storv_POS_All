import React, { useState } from 'react';
import MarketingNavbar from '../../components/marketing/MarketingNavbar';
import MarketingFooter from '../../components/marketing/MarketingFooter';
import MarketingSection from '../../components/marketing/MarketingSection';
import MarketingButton from '../../components/marketing/MarketingButton';
import { Check, HelpCircle, ChevronDown, ShieldCheck, Zap } from 'lucide-react';
import './Pricing.css';

const Pricing = () => {
  const [isAnnual, setIsAnnual] = useState(true);
  const [openFaq, setOpenFaq] = useState(0);

  const plans = [
    {
      name: 'Starter',
      desc: 'Perfect for small, single-location retailers getting started.',
      monthlyPrice: 49,
      annualPrice: 39,
      features: [
        'Live Dashboard (Daily updates)',
        'Basic Inventory Tracking',
        'Standard POS Sync',
        'Email Support',
        'Up to 100 Invoices/mo'
      ],
      cta: 'Start with Starter',
      variant: 'secondary'
    },
    {
      name: 'Growth',
      desc: 'Our most popular plan for scaling retail operations.',
      monthlyPrice: 99,
      annualPrice: 79,
      features: [
        'everything in Starter, plus:',
        'AI Invoice Import (Unlimited)',
        'Weather-Synced Dashboard',
        'Sales Predictions (7-Day)',
        'Priority Match Engine',
        'Multi-Store Support (up to 3)'
      ],
      cta: 'Go with Growth',
      variant: 'primary',
      popular: true
    },
    {
      name: 'Enterprise',
      desc: 'Full-scale solution for multi-location enterprises.',
      monthlyPrice: 'Custom',
      annualPrice: 'Custom',
      features: [
        'everything in Growth, plus:',
        'Advanced Holt-Winters Predictions',
        'Unlimited Store Locations',
        'Custom Vendor Mappings',
        'Dedicated Account Manager',
        'On-site Training & Support'
      ],
      cta: 'Contact Sales',
      variant: 'secondary'
    }
  ];

  const faqs = [
    {
      q: 'How does the AI Invoice Import work?',
      a: 'We use a hybrid OCR approach combining Microsoft Azure Document Intelligence for layout extraction and OpenAI GPT-4o-mini for logical data enrichment. This ensures we capture net costs, deposits, and line items with over 99% accuracy.'
    },
    {
      q: 'Can I use FutureFoods with my existing IT Retail POS?',
      a: 'Yes! FutureFoods is specifically designed to integrate seamlessly with MarktPOS IT Retail via API. We handle the heavy lifting of syncing products, customers, and transactions automatically.'
    },
    {
      q: 'Is there a limit to how many stores I can manage?',
      a: 'The Starter and Growth plans have flexible limits suitable for most operations. Our Enterprise plan supports unlimited store locations with global management features.'
    },
    {
      q: 'Do you offer a free trial?',
      a: 'Absolutely. We typically start with a personalized demo to set up your organization, followed by a 14-day free trial so you can see the real-world impact on your store data.'
    },
    {
      q: 'Is my data secure?',
      a: 'Security is our priority. We use industry-standard encryption, multi-tenant isolation, and secure API protocols to ensure your business data is only accessible by authorized users.'
    }
  ];

  return (
    <div className="pricing-page">
      <MarketingNavbar />

      {/* Hero */}
      <section className="pricing-hero">
        <div className="mkt-container">
          <div className="pricing-hero-content">
            <h1 className="pricing-title">Simple, <span className="text-gradient">Transparent</span> Pricing</h1>
            <p className="pricing-subtitle">No hidden fees. No commitments. Choose the plan that fits your business scale.</p>
            
            {/* Toggle */}
            <div className="pricing-toggle-container">
              <span className={!isAnnual ? 'active' : ''}>Monthly</span>
              <button 
                className={`pricing-toggle-btn ${isAnnual ? 'annual' : 'monthly'}`}
                onClick={() => setIsAnnual(!isAnnual)}
              >
                <div className="toggle-thumb" />
              </button>
              <span className={isAnnual ? 'active' : ''}>
                Annual <span className="savings-badge">Save 20%</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <MarketingSection bgVariant="light">
        <div className="pricing-cards-grid">
          {plans.map((plan, i) => (
            <div key={i} className={`mkt-pricing-card ${plan.popular ? 'popular' : ''}`}>
              {plan.popular && <div className="popular-tag">MOST POPULAR</div>}
              <div className="card-top">
                <h3 className="plan-name">{plan.name}</h3>
                <p className="plan-desc">{plan.desc}</p>
                <div className="plan-price">
                  {typeof plan.annualPrice === 'number' ? (
                    <>
                      <span className="currency">$</span>
                      <span className="amount">{isAnnual ? plan.annualPrice : plan.monthlyPrice}</span>
                      <span className="period">/mo</span>
                    </>
                  ) : (
                    <span className="amount">{plan.annualPrice}</span>
                  )}
                </div>
                {/* // TODO: replace with real pricing from product team */}
              </div>
              
              <div className="card-features">
                <p className="features-label">WHAT'S INCLUDED:</p>
                <ul>
                  {plan.features.map((f, fi) => (
                    <li key={fi}><Check size={18} /> {f}</li>
                  ))}
                </ul>
                {/* // TODO: confirm these features exist — references in ProjectOverview.md */}
              </div>

              <div className="card-bottom">
                <MarketingButton 
                  href="/contact" 
                  variant={plan.variant} 
                  className="w-full"
                  size="lg"
                >
                  {plan.cta}
                </MarketingButton>
              </div>
            </div>
          ))}
        </div>
      </MarketingSection>

      {/* FAQ Accordion */}
      <MarketingSection title="Frequently Asked Questions" bgVariant="white">
        <div className="faq-container">
          {faqs.map((faq, i) => (
            <div 
              key={i} 
              className={`faq-item ${openFaq === i ? 'open' : ''}`}
              onClick={() => setOpenFaq(openFaq === i ? null : i)}
            >
              <div className="faq-question">
                <span>{faq.q}</span>
                <ChevronDown size={20} className="faq-icon" />
              </div>
              <div className="faq-answer">
                <p>{faq.a}</p>
                {/* // TODO: confirm FAQ content with product team */}
              </div>
            </div>
          ))}
        </div>
      </MarketingSection>

      {/* Trust Signal Banner */}
      <section className="pricing-trust-banner">
        <div className="mkt-container">
          <div className="trust-grid">
            <div className="trust-item">
              <ShieldCheck size={32} />
              <h4>Secure Data</h4>
              <p>Your business data is encrypted and isolated.</p>
            </div>
            <div className="trust-item">
              <Zap size={32} />
              <h4>Fast Setup</h4>
              <p>Get up and running in less than 24 hours.</p>
            </div>
            <div className="trust-item">
              <HelpCircle size={32} />
              <h4>24/7 Support</h4>
              <p>We're here whenever your store is open.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="pricing-final-cta">
        <div className="mkt-container">
          <h2>Still have questions?</h2>
          <p>Our retail experts are ready to help you find the perfect solution.</p>
          <MarketingButton href="/contact" variant="secondary" size="lg">Contact Our Team</MarketingButton>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

export default Pricing;
