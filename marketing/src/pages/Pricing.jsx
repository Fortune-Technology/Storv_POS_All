import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import MarketingNavbar from '../components/marketing/MarketingNavbar';
import MarketingFooter from '../components/marketing/MarketingFooter';
import MarketingSection from '../components/marketing/MarketingSection';
import MarketingButton from '../components/marketing/MarketingButton';
import { Check, X, ChevronDown, ShieldCheck, Zap, Store, Headphones, Plus, Loader } from 'lucide-react';
import SEO from '../components/SEO';
import './Pricing.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

/**
 * Pricing — fully data-driven from /api/plans/public.
 *
 * Renders three sections that all derive from the same payload:
 *  1) Plan cards     — one per active+public SubscriptionPlan
 *  2) Add-ons grid   — flattened/deduped across plan.addons
 *  3) Comparison     — feature-by-feature table grouped by module category
 *
 * Falls back to a curated static catalog (mirroring the seeded plans) if the
 * API request fails so the marketing page always renders something.
 */
const Pricing = () => {
  const [isAnnual, setIsAnnual] = useState(true);
  const [openFaq, setOpenFaq] = useState(0);
  const [data, setData] = useState(null);     // { plans, categories }
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axios.get(`${API_URL}/plans/public`)
      .then(res => {
        if (cancelled) return;
        setData(res.data);
        setFetchError(null);
      })
      .catch(err => {
        console.warn('[Pricing] live data fetch failed, using fallback', err);
        if (!cancelled) setFetchError(err.message || 'Network error');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Static fallback (matches seedPlanModulesV2.ts — S80 Phase 1) ──────────
  // Renders only when the API is unreachable. The 12 addons each unlock a
  // specific module on the Starter plan; Pro includes everything.
  const fallbackPayload = useMemo(() => ({
    plans: [
      {
        id: 'starter', slug: 'starter', name: 'Starter',
        tagline: 'Everything you need to run one store.',
        description: '$39/month per store. Add features as you grow.',
        basePrice: 39, annualPrice: 468, isCustomPriced: false,
        currency: 'USD', includedStores: 1, includedRegisters: 1,
        maxUsers: 5, trialDays: 14, highlighted: false, isDefault: true,
        addons: [
          { key: 'lottery',                label: 'Lottery',                       price: 15, description: 'Scratch ticket sales, EoD reconciliation, weekly settlement.', moduleKeys: ['lottery'] },
          { key: 'fuel',                   label: 'Fuel',                          price: 15, description: 'Pump-attributed sales, FIFO tank inventory, multi-tank topology.', moduleKeys: ['fuel'] },
          { key: 'ecommerce',              label: 'E-Commerce / Online Store',     price: 15, description: 'Branded online storefront, product sync, online orders.', moduleKeys: ['ecom_setup', 'ecom_orders', 'ecom_analytics'] },
          { key: 'marketplace',            label: 'Marketplace Integration',       price: 15, description: 'DoorDash, UberEats, Instacart inventory + order routing.', moduleKeys: ['delivery_platforms'] },
          { key: 'exchange',               label: 'StoreVeu Exchange',             price: 10, description: 'B2B trading network. Wholesale POs to/from partner stores.', moduleKeys: ['exchange', 'wholesale_orders'] },
          { key: 'loyalty',                label: 'Loyalty',                       price: 10, description: 'Points accrual, redemption, member tiers, charge accounts.', moduleKeys: ['loyalty'] },
          { key: 'scan_data',              label: 'Tobacco Scan Data',             price: 15, description: 'Altria/RJR/ITG scan-data + manufacturer coupon redemption.', moduleKeys: ['scan_data'] },
          { key: 'ai_assistant',           label: 'AI Assistant',                  price: 10, description: 'Floating chat widget for feature help + live-store Q&A.', moduleKeys: ['ai_assistant'] },
          { key: 'vendor_orders',          label: 'Vendor Orders / Auto Reorder',  price: 12, description: '14-factor demand forecasting + smart purchase orders.', moduleKeys: ['vendor_orders'] },
          { key: 'invoice_ocr',            label: 'Invoice OCR / Bulk Imports',    price: 15, description: 'AI invoice OCR + bulk CSV/XLSX product import.', moduleKeys: ['invoice_import', 'bulk_import'] },
          { key: 'multi_store_dashboard',  label: 'Multi-Store Dashboard',         price: 10, description: 'Cross-store rollup view (best on orgs with 2+ stores).', moduleKeys: ['multi_store_dashboard'] },
          { key: 'predictions',            label: 'Sales Predictions',             price: 10, description: 'Holt-Winters forecasts with weather + holiday adjustments.', moduleKeys: ['predictions'] },
        ],
        modules: [
          { key: 'live_dashboard', name: 'Live Dashboard', category: 'Operations', isCore: true },
          { key: 'chat',           name: 'Chat',           category: 'Operations', isCore: true },
          { key: 'products',       name: 'Products',       category: 'Catalog',    isCore: false },
          { key: 'departments',    name: 'Departments',    category: 'Catalog',    isCore: false },
          { key: 'transactions',   name: 'Transactions',   category: 'Reports & Analytics', isCore: false },
          { key: 'employees',      name: 'Employees',      category: 'Reports & Analytics', isCore: false },
          { key: 'analytics',      name: 'Analytics',      category: 'Reports & Analytics', isCore: false },
          { key: 'pos_config',     name: 'POS Config',     category: 'POS',        isCore: false },
          { key: 'support_tickets',name: 'Support Tickets',category: 'Support & Billing', isCore: true },
          { key: 'billing',        name: 'Billing',        category: 'Support & Billing', isCore: true },
          { key: 'account',        name: 'Account',        category: 'Account', isCore: true },
          { key: 'roles',          name: 'Roles',          category: 'Account', isCore: true },
        ],
      },
      {
        id: 'pro', slug: 'pro', name: 'Pro',
        tagline: 'Full platform. Every module included.',
        description: '$129/month per store. All add-ons included by default.',
        basePrice: 129, annualPrice: 1548, isCustomPriced: false,
        currency: 'USD', includedStores: 1, includedRegisters: 5,
        maxUsers: null, trialDays: 14, highlighted: true, isDefault: false,
        addons: [],   // Pro includes everything; no addons offered
        modules: [],  // Catalog list elided — too long for a fallback. Live API returns full list.
      },
    ],
    categories: [],
  }), []);

  const payload = data || fallbackPayload;
  const plans = payload.plans || [];
  const categories = payload.categories || [];

  // ── Derive add-ons (deduped across plans) ─────────────────────────────────
  const addons = useMemo(() => {
    const seen = new Map();
    for (const plan of plans) {
      for (const a of (plan.addons || [])) {
        if (!seen.has(a.key)) seen.set(a.key, a);
      }
    }
    return Array.from(seen.values());
  }, [plans]);

  // ── Derive plan price label ───────────────────────────────────────────────
  const priceForPlan = (plan) => {
    if (plan.isCustomPriced) return { label: 'Custom', annualLine: null };
    const monthly = Number(plan.basePrice) || 0;
    const annual = plan.annualPrice == null ? null : Number(plan.annualPrice);
    const shown = isAnnual && annual != null ? annual : monthly;
    const annualLine = (isAnnual && annual != null)
      ? `Billed annually ($${(annual * 12).toFixed(0)}/yr)`
      : null;
    return { label: shown, annualLine };
  };

  // ── Plan-card includes line ───────────────────────────────────────────────
  const includesLine = (plan) => {
    const stores = plan.includedStores >= 9999 ? 'Unlimited stores' :
      `${plan.includedStores} store${plan.includedStores === 1 ? '' : 's'}`;
    const regs = plan.includedRegisters >= 9999 ? 'Unlimited registers' :
      `${plan.includedRegisters} register${plan.includedRegisters === 1 ? '' : 's'}`;
    return `${stores}, ${regs} included`;
  };

  // ── Plan-card "What's included" feature list (top N modules grouped) ──────
  const featuresForPlan = (plan) => {
    const mods = (plan.modules || []).filter(m => m.active !== false);
    if (mods.length === 0) return ['Contact us for full feature list'];
    // Sort: core first, then by category for a stable, human-readable order.
    const sorted = [...mods].sort((a, b) => {
      if (a.isCore !== b.isCore) return a.isCore ? -1 : 1;
      const cat = (a.category || '').localeCompare(b.category || '');
      if (cat !== 0) return cat;
      return (a.name || '').localeCompare(b.name || '');
    });
    return sorted.map(m => m.name);
  };

  // ── Plan-card extras (addon hints) ────────────────────────────────────────
  const extrasForPlan = (plan) => {
    const out = [];
    if (plan.pricePerStore && Number(plan.pricePerStore) > 0) {
      out.push(`Additional stores: $${Number(plan.pricePerStore)}/mo each`);
    }
    if (plan.pricePerRegister && Number(plan.pricePerRegister) > 0) {
      out.push(`Additional registers: $${Number(plan.pricePerRegister)}/mo each`);
    }
    return out;
  };

  // ── Comparison cell value: does plan include this module? ─────────────────
  const planHasModule = (plan, moduleKey) => {
    return (plan.modules || []).some(m => m.key === moduleKey);
  };

  const renderCmpCell = (val) => {
    if (val === true) return <Check size={18} className="cmp-check" />;
    if (val === false) return <X size={16} className="cmp-x" />;
    return <span className="cmp-text-val">{val}</span>;
  };

  // ── FAQ (kept static — content is editorial, not data-driven) ─────────────
  const faqs = [
    {
      q: 'How does direct card processing work?',
      a: 'Storeveu integrates directly with PAX payment terminals (A30, A35, A80) using the POSLINK protocol. Your card payments go straight from the terminal to your processor — no Storeveu markup, no middleman. You negotiate your own interchange rates.',
    },
    {
      q: 'What does each plan include?',
      a: 'Every plan ships with a full offline-first POS terminal (cash + card payments, barcode scanning, employee clock-in/out, basic sales reports). Higher tiers unlock additional sidebar modules — see the comparison table above for the full breakdown by category.',
    },
    {
      q: 'Can I add more stores or registers?',
      a: 'Yes. Each store you add is its own subscription — choose Starter (with the add-ons you need) or Pro per location. You can mix-and-match across stores: one store on Starter + Lottery, another on Pro, etc.',
    },
    {
      q: 'Can I manage lottery through Storeveu?',
      a: 'Yes. The Lottery module is available as a $15/mo add-on on Starter, and is included by default on Pro. It handles provincial/state game management, box activation, cashier shift scanning, variance reporting, and commission calculations.',
    },
    {
      q: 'Do you offer a free trial?',
      a: 'We start with a personalized demo tailored to your store type. After that, we offer a 14-day free trial so you can see the real-world impact before committing.',
    },
    {
      q: 'Is there a contract?',
      a: 'No long-term contracts — month-to-month per store with no cancellation fee. Cancel a store sub anytime; the rest of your stores keep running.',
    },
    {
      q: 'Does Storeveu work offline?',
      a: 'Yes. The Storeveu POS terminal is offline-first. It uses IndexedDB to cache your product catalog locally, so your cashier app keeps working even if the internet drops. Transactions sync automatically when connectivity is restored.',
    },
  ];

  // ── Build comparison rows: one row per (category, module) ─────────────────
  const comparisonRows = useMemo(() => {
    if (!Array.isArray(categories) || categories.length === 0) return [];
    return categories.map(cat => ({
      label: cat.name,
      features: (cat.modules || []).map(mod => ({
        name: mod.name,
        description: mod.description,
        cells: plans.map(p => {
          if (mod.isCore) return true; // every plan gets core modules
          return planHasModule(p, mod.key);
        }),
      })),
    }));
  }, [categories, plans]);

  // For SEO JSON-LD — only emit numeric prices (skip Custom)
  const seoOffers = useMemo(() => {
    return plans.filter(p => !p.isCustomPriced).map(p => ({
      "@type": "Offer",
      "name": p.name,
      "price": String(p.basePrice),
      "priceCurrency": p.currency || "USD",
      "description": p.tagline || p.description || `${p.name} plan`,
    }));
  }, [plans]);

  return (
    <div className="pricing-page">
      <SEO
        title="Pricing"
        description="Simple, transparent pricing. No hidden fees. Plans tailored to single-location retailers, multi-store growth, and enterprise scale."
        url="https://storeveu.com/pricing"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Storeveu POS Platform",
          "description": "Complete retail POS and management platform.",
          "brand": { "@type": "Brand", "name": "Storeveu" },
          "offers": seoOffers,
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
                aria-label="Toggle annual billing"
              >
                <div className="toggle-thumb" />
              </button>
              <span className={isAnnual ? 'active' : ''}>
                Annual <span className="savings-badge">Save 20%</span>
              </span>
            </div>

            {fetchError && (
              <p className="pricing-fetch-warning">
                Showing default plan info — couldn't reach the live catalog.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Plan Cards */}
      <MarketingSection bgVariant="light">
        {loading && !data ? (
          <div className="pricing-loading">
            <Loader size={28} className="spin" /> Loading plans…
          </div>
        ) : (
          <div className="pricing-cards-grid">
            {plans.map(plan => {
              const { label, annualLine } = priceForPlan(plan);
              const features = featuresForPlan(plan);
              const extras = extrasForPlan(plan);
              return (
                <div key={plan.id} className={`mkt-pricing-card ${plan.highlighted ? 'popular' : ''}`}>
                  {plan.highlighted && <div className="popular-tag">MOST POPULAR</div>}
                  <div className="card-top">
                    <h3 className="plan-name">{plan.name}</h3>
                    <p className="plan-desc">{plan.tagline || plan.description || ''}</p>
                    <div className="plan-price">
                      {plan.isCustomPriced ? (
                        <span className="amount custom-label">Custom</span>
                      ) : (
                        <>
                          <span className="currency">$</span>
                          <span className="amount">{label}</span>
                          <span className="period">/mo</span>
                        </>
                      )}
                    </div>
                    {annualLine && <p className="plan-billed-note">{annualLine}</p>}
                    <p className="plan-includes">
                      <Store size={14} /> {includesLine(plan)}
                    </p>
                  </div>

                  <div className="card-features">
                    <p className="features-label">WHAT'S INCLUDED:</p>
                    <ul>
                      {features.slice(0, 12).map((f, fi) => (
                        <li key={fi}><Check size={18} /> {f}</li>
                      ))}
                      {features.length > 12 && (
                        <li className="features-more">+ {features.length - 12} more modules</li>
                      )}
                    </ul>
                    {extras.length > 0 && (
                      <div className="plan-extras">
                        {extras.map((e, ei) => (
                          <p key={ei} className="plan-extra-line"><Plus size={14} /> {e}</p>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="card-bottom">
                    <MarketingButton
                      href={plan.isCustomPriced ? '/contact' : '/contact'}
                      variant={plan.highlighted ? 'primary' : 'secondary'}
                      className="w-full"
                      size="lg"
                    >
                      {plan.isCustomPriced ? 'Contact Sales' : `Start with ${plan.name}`}
                    </MarketingButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </MarketingSection>

      {/* Add-ons (only renders when at least one plan exposes addons) */}
      {addons.length > 0 && (
        <MarketingSection
          title="Available Add-ons"
          subtitle="Build your Starter plan to fit your store. Pro includes every add-on by default."
          bgVariant="white"
        >
          <div className="addons-grid">
            {addons.map((addon, i) => (
              <div key={i} className="addon-card">
                <div className="addon-icon-wrap">
                  <Plus size={28} />
                </div>
                <div className="addon-info">
                  <h4 className="addon-name">{addon.label || addon.name}</h4>
                  <p className="addon-desc">{addon.description || ''}</p>
                </div>
                <div className="addon-price-wrap">
                  <span className="addon-price">
                    +${Number(addon.price ?? addon.monthlyPrice ?? 0).toFixed(0)}
                  </span>
                  <span className="addon-period">/mo</span>
                </div>
              </div>
            ))}
          </div>
        </MarketingSection>
      )}

      {/* Feature Comparison Table — driven by module categories */}
      {comparisonRows.length > 0 && (
        <MarketingSection title="Compare Plans" subtitle="See exactly which sidebar modules are included with each tier." bgVariant="light">
          <div className="cmp-table-wrap">
            <table className="cmp-table">
              <thead>
                <tr>
                  <th className="cmp-feature-col">Feature</th>
                  {plans.map(p => (
                    <th
                      key={p.id}
                      className={`cmp-plan-col ${p.highlighted ? 'cmp-plan-highlight' : ''}`}
                    >
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((cat, ci) => (
                  <React.Fragment key={ci}>
                    <tr className="cmp-category-row">
                      <td colSpan={1 + plans.length}>{cat.label}</td>
                    </tr>
                    {cat.features.map((feat, fi) => (
                      <tr key={fi} className="cmp-feature-row">
                        <td className="cmp-feature-name" title={feat.description || ''}>{feat.name}</td>
                        {feat.cells.map((cell, ci2) => (
                          <td
                            key={ci2}
                            className={`cmp-cell ${plans[ci2]?.highlighted ? 'cmp-cell-highlight' : ''}`}
                          >
                            {renderCmpCell(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}

                {/* Scale row — pulled directly from each plan's quotas */}
                <tr className="cmp-category-row">
                  <td colSpan={1 + plans.length}>Scale</td>
                </tr>
                <tr className="cmp-feature-row">
                  <td className="cmp-feature-name">Stores included</td>
                  {plans.map(p => (
                    <td key={p.id} className={`cmp-cell ${p.highlighted ? 'cmp-cell-highlight' : ''}`}>
                      {renderCmpCell(p.includedStores >= 9999 ? 'Unlimited' : `Up to ${p.includedStores}`)}
                    </td>
                  ))}
                </tr>
                <tr className="cmp-feature-row">
                  <td className="cmp-feature-name">Registers included</td>
                  {plans.map(p => (
                    <td key={p.id} className={`cmp-cell ${p.highlighted ? 'cmp-cell-highlight' : ''}`}>
                      {renderCmpCell(p.includedRegisters >= 9999 ? 'Unlimited' : `Up to ${p.includedRegisters}`)}
                    </td>
                  ))}
                </tr>
                <tr className="cmp-feature-row">
                  <td className="cmp-feature-name">Users</td>
                  {plans.map(p => (
                    <td key={p.id} className={`cmp-cell ${p.highlighted ? 'cmp-cell-highlight' : ''}`}>
                      {renderCmpCell(p.maxUsers == null ? 'Unlimited' : `Up to ${p.maxUsers}`)}
                    </td>
                  ))}
                </tr>
                <tr className="cmp-feature-row">
                  <td className="cmp-feature-name">Trial</td>
                  {plans.map(p => (
                    <td key={p.id} className={`cmp-cell ${p.highlighted ? 'cmp-cell-highlight' : ''}`}>
                      {renderCmpCell(p.trialDays > 0 ? `${p.trialDays} days` : '—')}
                    </td>
                  ))}
                </tr>
              </tbody>
              <tfoot>
                <tr className="cmp-price-row">
                  <td className="cmp-feature-name">Monthly price</td>
                  {plans.map(p => {
                    const { label } = priceForPlan(p);
                    return (
                      <td key={p.id} className={`cmp-cell ${p.highlighted ? 'cmp-cell-highlight' : ''}`}>
                        <strong>{p.isCustomPriced ? 'Custom' : `$${label}/mo`}</strong>
                      </td>
                    );
                  })}
                </tr>
                <tr className="cmp-cta-row">
                  <td></td>
                  {plans.map(p => (
                    <td key={p.id} className={`cmp-cell ${p.highlighted ? 'cmp-cell-highlight' : ''}`}>
                      <MarketingButton
                        href="/contact"
                        variant={p.highlighted ? 'primary' : 'secondary'}
                        size="sm"
                      >
                        {p.isCustomPriced ? 'Contact Sales' : 'Get Started'}
                      </MarketingButton>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </MarketingSection>
      )}

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
