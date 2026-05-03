import React, { useState } from 'react';
import MarketingNavbar from '../components/marketing/MarketingNavbar';
import MarketingFooter from '../components/marketing/MarketingFooter';
import MarketingSection from '../components/marketing/MarketingSection';
import MarketingButton from '../components/marketing/MarketingButton';
import { Check, X, HelpCircle, ChevronDown, ShieldCheck, Zap, Store, BarChart3, ShoppingCart, Package, Users, FileText, Cloud, Headphones, Monitor, Plus } from 'lucide-react';
import SEO from '../components/SEO';
import './Pricing.css';

const Pricing = () => {
  const [isAnnual, setIsAnnual] = useState(true);
  const [openFaq, setOpenFaq] = useState(0);

  const plans = [
    {
      name: 'Starter',
      desc: 'Perfect for single-location retailers getting started with modern POS.',
      monthlyPrice: 49,
      annualPrice: 39,
      includes: '1 store, 1 register included',
      features: [
        'Full POS terminal (offline-first)',
        'Cash & card payments',
        'Barcode scanning with multi-UPC',
        'Basic inventory management',
        'Product catalog',
        'Department management',
        'Employee clock-in/out',
        'Basic sales reports',
        'Email support',
        'AI invoice import (50/month)',
      ],
      cta: 'Start with Starter',
      variant: 'secondary',
    },
    {
      name: 'Growth',
      desc: 'Our most popular plan for scaling retail operations across multiple locations.',
      monthlyPrice: 99,
      annualPrice: 79,
      includes: 'Up to 3 stores, 3 registers',
      features: [
        'Everything in Starter, plus:',
        'Lottery module (full)',
        'Live Dashboard with real-time analytics',
        'Holt-Winters sales predictions',
        'Weather correlation analytics',
        'Promotions engine (BOGO, volume, combo)',
        'Advanced employee reports with PDF export',
        'Vendor management & purchase orders',
        'Bulk CSV/Excel import',
        'Priority support',
      ],
      extras: [
        'Additional stores: $29/mo each',
        'Additional registers: $19/mo each',
      ],
      cta: 'Go with Growth',
      variant: 'primary',
      popular: true,
    },
    {
      name: 'Enterprise',
      desc: 'Full-scale solution with unlimited capacity and dedicated support.',
      monthlyPrice: 'Custom',
      annualPrice: 'Custom',
      includes: 'Unlimited stores & registers',
      features: [
        'Everything in Growth, plus:',
        'E-commerce online store (Next.js storefront)',
        '14-factor auto-ordering algorithm',
        'Custom domain for online store',
        'Equipment procurement assistance',
        'Dedicated account manager',
        'On-site training & setup',
        'Custom integrations',
        'SLA-backed support',
        'White-label options',
      ],
      cta: 'Contact Sales',
      variant: 'secondary',
    },
  ];

  const addons = [
    {
      icon: ShoppingCart,
      name: 'E-commerce Module',
      price: 29,
      desc: 'Launch your own branded online store with product sync, checkout, and order management.',
    },
    {
      icon: BarChart3,
      name: 'Advanced Analytics',
      price: 19,
      desc: 'Weather-synced predictions, department analytics, and custom report builder.',
    },
  ];

  const comparisonCategories = [
    {
      label: 'POS & Checkout',
      features: [
        { name: 'Full POS terminal (offline-first)', starter: true, growth: true, enterprise: true },
        { name: 'Cash & card payments', starter: true, growth: true, enterprise: true },
        { name: 'Barcode scanning with multi-UPC', starter: true, growth: true, enterprise: true },
        { name: 'Multi-pack size support', starter: true, growth: true, enterprise: true },
        { name: 'Age verification', starter: true, growth: true, enterprise: true },
        { name: 'EBT/SNAP support', starter: true, growth: true, enterprise: true },
        { name: 'Bag fee management', starter: true, growth: true, enterprise: true },
        { name: 'Customer display screen', starter: true, growth: true, enterprise: true },
      ],
    },
    {
      label: 'Inventory & Catalog',
      features: [
        { name: 'Product catalog', starter: true, growth: true, enterprise: true },
        { name: 'Department management', starter: true, growth: true, enterprise: true },
        { name: 'Basic inventory tracking', starter: true, growth: true, enterprise: true },
        { name: 'Bulk CSV/Excel import', starter: false, growth: true, enterprise: true },
        { name: 'Deposit & tax rule engine', starter: true, growth: true, enterprise: true },
        { name: 'AI invoice import', starter: '50/mo', growth: 'Unlimited', enterprise: 'Unlimited' },
      ],
    },
    {
      label: 'Analytics & Reports',
      features: [
        { name: 'Basic sales reports', starter: true, growth: true, enterprise: true },
        { name: 'Employee clock-in/out & reports', starter: true, growth: true, enterprise: true },
        { name: 'Live Dashboard (real-time)', starter: false, growth: true, enterprise: true },
        { name: 'Holt-Winters sales predictions', starter: false, growth: true, enterprise: true },
        { name: 'Weather correlation analytics', starter: false, growth: true, enterprise: true },
        { name: 'Department & product analytics', starter: false, growth: true, enterprise: true },
        { name: 'PDF export for reports', starter: false, growth: true, enterprise: true },
      ],
    },
    {
      label: 'Lottery & Vendors',
      features: [
        { name: 'Lottery module (full)', starter: false, growth: true, enterprise: true },
        { name: 'Vendor management', starter: false, growth: true, enterprise: true },
        { name: 'Purchase orders', starter: false, growth: true, enterprise: true },
        { name: 'Promotions engine (BOGO, volume, combo)', starter: false, growth: true, enterprise: true },
        { name: '14-factor auto-ordering algorithm', starter: false, growth: false, enterprise: true },
      ],
    },
    {
      label: 'E-commerce & Integrations',
      features: [
        { name: 'Online store (Next.js storefront)', starter: false, growth: 'Add-on', enterprise: true },
        { name: 'Custom domain', starter: false, growth: false, enterprise: true },
        { name: 'Product sync (POS to web)', starter: false, growth: 'Add-on', enterprise: true },
        { name: 'Custom integrations', starter: false, growth: false, enterprise: true },
        { name: 'White-label options', starter: false, growth: false, enterprise: true },
      ],
    },
    {
      label: 'Support & Services',
      features: [
        { name: 'Email support', starter: true, growth: true, enterprise: true },
        { name: 'Priority support', starter: false, growth: true, enterprise: true },
        { name: 'Dedicated account manager', starter: false, growth: false, enterprise: true },
        { name: 'On-site training & setup', starter: false, growth: false, enterprise: true },
        { name: 'SLA-backed support', starter: false, growth: false, enterprise: true },
        { name: 'Equipment procurement assistance', starter: false, growth: false, enterprise: true },
      ],
    },
    {
      label: 'Scale',
      features: [
        { name: 'Stores included', starter: '1', growth: 'Up to 3', enterprise: 'Unlimited' },
        { name: 'Registers included', starter: '1', growth: 'Up to 3', enterprise: 'Unlimited' },
        { name: 'Additional stores', starter: false, growth: '$29/mo each', enterprise: 'Included' },
        { name: 'Additional registers', starter: false, growth: '$19/mo each', enterprise: 'Included' },
      ],
    },
  ];

  const faqs = [
    {
      q: 'How does direct card processing work?',
      a: 'Storeveu integrates directly with PAX payment terminals (A30, A35, A80) using the POSLINK protocol. Your card payments go straight from the terminal to your processor — no Storeveu markup, no middleman. You negotiate your own interchange rates.',
    },
    {
      q: 'What is included in the Starter plan?',
      a: 'Starter gives you a full offline-first POS terminal with cash and card payments, barcode scanning with multi-UPC support, product catalog, department management, employee clock-in/out, basic sales reports, and AI-powered invoice import (50 per month). It covers one store with one register.',
    },
    {
      q: 'Can I add more stores or registers to the Growth plan?',
      a: 'Yes. The Growth plan includes up to 3 stores and 3 registers. You can add more stores at $29/month each and additional registers at $19/month each, with no limit.',
    },
    {
      q: 'Can I manage lottery through Storeveu?',
      a: 'Yes. The Lottery Module is included on Growth and Enterprise plans. It handles provincial/state game management, box activation, cashier shift scanning, variance reporting, and commission calculations — all built in at no extra cost.',
    },
    {
      q: 'What are the add-on modules?',
      a: 'We offer two add-ons available on any plan: the E-commerce Module ($29/mo) for launching a branded online store, and Advanced Analytics ($19/mo) for weather-synced predictions, department analytics, and custom report tools.',
    },
    {
      q: 'Do you offer a free trial?',
      a: 'We start with a personalized demo tailored to your store type. After that, we offer a 14-day free trial so you can see the real-world impact before committing.',
    },
    {
      q: 'Is there a contract?',
      a: 'No long-term contracts on Starter and Growth plans — month-to-month with no cancellation fee. Enterprise plans have flexible terms discussed directly with our team.',
    },
    {
      q: 'Does Storeveu work offline?',
      a: 'Yes. The Storeveu POS terminal is offline-first. It uses IndexedDB to cache your product catalog locally, so your cashier app keeps working even if the internet drops. Transactions sync automatically when connectivity is restored.',
    },
  ];

  const renderCellValue = (val) => {
    if (val === true) return <Check size={18} className="cmp-check" />;
    if (val === false) return <X size={16} className="cmp-x" />;
    return <span className="cmp-text-val">{val}</span>;
  };

  return (
    <div className="pricing-page">
      <SEO
        title="Pricing"
        description="Simple, transparent pricing starting at $49/mo. Starter, Growth, and Enterprise plans with no hidden fees. E-commerce and analytics add-ons available."
        url="https://storeveu.com/pricing"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Storeveu POS Platform",
          "description": "Complete retail POS and management platform.",
          "brand": { "@type": "Brand", "name": "Storeveu" },
          "offers": [
            { "@type": "Offer", "name": "Starter", "price": "49", "priceCurrency": "USD", "description": "1 store, 1 register. Full POS, basic analytics." },
            { "@type": "Offer", "name": "Growth", "price": "99", "priceCurrency": "USD", "description": "Up to 3 stores. Lottery, predictions, vendor management." },
            { "@type": "Offer", "name": "Enterprise", "price": "0", "priceCurrency": "USD", "description": "Custom pricing. Unlimited stores, e-commerce, dedicated support." }
          ]
        }}
      />
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
                    <span className="amount custom-label">{plan.annualPrice}</span>
                  )}
                </div>
                {typeof plan.annualPrice === 'number' && isAnnual && (
                  <p className="plan-billed-note">Billed annually (${plan.annualPrice * 12}/yr)</p>
                )}
                <p className="plan-includes">
                  <Store size={14} /> {plan.includes}
                </p>
              </div>

              <div className="card-features">
                <p className="features-label">WHAT'S INCLUDED:</p>
                <ul>
                  {plan.features.map((f, fi) => (
                    <li key={fi}><Check size={18} /> {f}</li>
                  ))}
                </ul>
                {plan.extras && (
                  <div className="plan-extras">
                    {plan.extras.map((e, ei) => (
                      <p key={ei} className="plan-extra-line"><Plus size={14} /> {e}</p>
                    ))}
                  </div>
                )}
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

      {/* Add-ons */}
      <MarketingSection title="Available Add-ons" subtitle="Extend any plan with powerful modules." bgVariant="white">
        <div className="addons-grid">
          {addons.map((addon, i) => (
            <div key={i} className="addon-card">
              <div className="addon-icon-wrap">
                <addon.icon size={28} />
              </div>
              <div className="addon-info">
                <h4 className="addon-name">{addon.name}</h4>
                <p className="addon-desc">{addon.desc}</p>
              </div>
              <div className="addon-price-wrap">
                <span className="addon-price">${addon.price}</span>
                <span className="addon-period">/mo</span>
              </div>
            </div>
          ))}
        </div>
      </MarketingSection>

      {/* Feature Comparison Table */}
      <MarketingSection title="Compare Plans" subtitle="See exactly what you get with each tier." bgVariant="light">
        <div className="cmp-table-wrap">
          <table className="cmp-table">
            <thead>
              <tr>
                <th className="cmp-feature-col">Feature</th>
                <th className="cmp-plan-col">Starter</th>
                <th className="cmp-plan-col cmp-plan-highlight">Growth</th>
                <th className="cmp-plan-col">Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {comparisonCategories.map((cat, ci) => (
                <React.Fragment key={ci}>
                  <tr className="cmp-category-row">
                    <td colSpan={4}>{cat.label}</td>
                  </tr>
                  {cat.features.map((feat, fi) => (
                    <tr key={fi} className="cmp-feature-row">
                      <td className="cmp-feature-name">{feat.name}</td>
                      <td className="cmp-cell">{renderCellValue(feat.starter)}</td>
                      <td className="cmp-cell cmp-cell-highlight">{renderCellValue(feat.growth)}</td>
                      <td className="cmp-cell">{renderCellValue(feat.enterprise)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="cmp-price-row">
                <td className="cmp-feature-name">Monthly price</td>
                <td className="cmp-cell"><strong>${isAnnual ? 39 : 49}/mo</strong></td>
                <td className="cmp-cell cmp-cell-highlight"><strong>${isAnnual ? 79 : 99}/mo</strong></td>
                <td className="cmp-cell"><strong>Custom</strong></td>
              </tr>
              <tr className="cmp-cta-row">
                <td></td>
                <td className="cmp-cell">
                  <MarketingButton href="/contact" variant="secondary" size="sm">Get Started</MarketingButton>
                </td>
                <td className="cmp-cell cmp-cell-highlight">
                  <MarketingButton href="/contact" variant="primary" size="sm">Get Started</MarketingButton>
                </td>
                <td className="cmp-cell">
                  <MarketingButton href="/contact" variant="secondary" size="sm">Contact Sales</MarketingButton>
                </td>
              </tr>
            </tfoot>
          </table>
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
              <Headphones size={32} />
              <h4>Real Support</h4>
              <p>Real people who have worked retail, whenever you need us.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="pricing-final-cta">
        <div className="mkt-container">
          <h2>Ready to see what you have been missing?</h2>
          <p>Book a personalized demo and start your 14-day free trial.</p>
          <MarketingButton href="/contact" variant="secondary" size="lg">Talk to Our Team</MarketingButton>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

export default Pricing;
