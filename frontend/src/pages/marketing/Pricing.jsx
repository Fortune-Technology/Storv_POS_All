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
        'Storv POS — Full Cashier App',
        'Cash & Card Payment Support',
        'Basic Inventory Tracking',
        'AI Invoice Import (50 invoices/mo)',
        'Email Support',
        'Single Location'
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
        'Everything in Starter, plus:',
        'AI Invoice Import (Unlimited)',
        'Lottery Module (full features)',
        'Weather-Synced Live Dashboard',
        '14-Day Sales Predictions',
        'Multi-Store Support (up to 3)',
        'Priority Support'
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
        'Everything in Growth, plus:',
        'Unlimited Store Locations',
        'Custom Hardware Configuration',
        'Direct PAX Terminal Setup',
        'Dedicated Account Manager',
        'On-site Training & Onboarding'
      ],
      cta: 'Contact Sales',
      variant: 'secondary'
    }
  ];

  const faqs = [
    {
      q: 'How does direct card processing work?',
      a: 'StoreVeu integrates directly with PAX payment terminals (A30, A35, A80) using the POSLINK protocol. This means your card payments go straight from the terminal to your processor — no StoreVeu markup, no middleman. You negotiate your own interchange rates.'
    },
    {
      q: 'Does StoreVeu replace my existing POS?',
      a: 'Yes. StoreVeu includes Storv POS — a full-featured cashier app that handles cash, card, EBT/SNAP, lottery, barcode scanning, age verification, and more. It runs in your browser on any Windows or Mac register.'
    },
    {
      q: 'Can I manage lottery through StoreVeu?',
      a: 'Yes. The Lottery Module handles provincial/state game management, box activation, cashier shift scanning, variance reporting, and commission calculations — all built in, no extra cost on Growth and Enterprise plans.'
    },
    {
      q: 'Do you offer a free trial?',
      a: 'We start with a personalized demo tailored to your store type. After that, we offer a 14-day free trial so you can see the real-world impact before committing.'
    },
    {
      q: 'Is there a contract?',
      a: 'No long-term contracts on Starter and Growth plans — month-to-month with no cancellation fee. Enterprise plans have flexible terms discussed directly with our team.'
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
            <p className="pricing-subtitle">No hidden processing fees. No middleman markup. No long-term lock-in.</p>
            
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
              </div>
              
              <div className="card-features">
                <p className="features-label">WHAT'S INCLUDED:</p>
                <ul>
                  {plan.features.map((f, fi) => (
                    <li key={fi}><Check size={18} /> {f}</li>
                  ))}
                </ul>
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
              <h4>Direct PAX Processing</h4>
              <p>Card payments at interchange rates. No middleman. No markup.</p>
            </div>
            <div className="trust-item">
              <Zap size={32} />
              <h4>No Lock-In</h4>
              <p>Month-to-month plans. Export your data anytime.</p>
            </div>
            <div className="trust-item">
              <HelpCircle size={32} />
              <h4>24/7 Support</h4>
              <p>Real people who've worked retail, whenever you need us.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="pricing-final-cta">
        <div className="mkt-container">
          <h2>Ready to see what you've been missing?</h2>
          <MarketingButton href="/contact" variant="secondary" size="lg">Talk to Our Team</MarketingButton>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

export default Pricing;
