import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import StoreveuLogo from '../StoreveuLogo';
import MarketingButton from './MarketingButton';
import axios from 'axios';
import './MarketingFooter.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const MarketingFooter = () => {
  const currentYear = new Date().getFullYear();
  const [cmsPages, setCmsPages] = useState([]);

  useEffect(() => {
    axios.get(`${API_URL}/public/cms-list`)
      .then(r => setCmsPages(r.data?.data || []))
      .catch(() => {});
  }, []);

  const staticCompanyLinks = [
    { name: 'About Us', path: '/about' },
    { name: 'Contact', path: '/contact' },
    { name: 'Careers', path: '/careers' },
    { name: 'Support', path: '/support' },
  ];
  const cmsLinks = cmsPages.map(p => ({ name: p.title, path: `/page/${p.slug}` }));
  const companyLinks = [...staticCompanyLinks, ...cmsLinks];

  const footerGroups = [
    {
      title: 'Product',
      links: [
        { name: 'Features', path: '/features' },
        { name: 'Pricing', path: '/pricing' },
        { name: 'Live Dashboard', path: '/features#dashboard' },
        { name: 'AI Invoice Import', path: '/features#ocr' },
      ],
    },
    {
      title: 'Company',
      links: companyLinks,
    },
    {
      title: 'Industries',
      links: [
        { name: 'Grocery & Supermarket', path: '/#industries' },
        { name: 'General Retail', path: '/#industries' },
        { name: 'Liquor & Wine', path: '/#industries' },
        { name: 'Meat & Food', path: '/#industries' },
      ],
    },
  ];

  return (
    <>
      {/* Pre-footer CTA */}
      <section className="mktf-cta">
        <div className="mktf-cta-inner">
          <div className="mktf-cta-text">
            <h3>Ready to modernize your store?</h3>
            <p>See how Storeveu replaces five systems with one platform.</p>
          </div>
          <div className="mktf-cta-actions">
            <MarketingButton href="/contact" size="lg" icon={ArrowRight}>Book a Demo</MarketingButton>
            <MarketingButton href="/pricing" variant="white" size="lg">See Pricing</MarketingButton>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mktf">
        <div className="mktf-container">
          <div className="mktf-grid">
            {/* Brand */}
            <div className="mktf-brand">
              <Link to="/" className="mktf-logo">
                <StoreveuLogo height={52} darkMode={true} />
              </Link>
              <p className="mktf-desc">
                The all-in-one retail platform for independent stores. POS, analytics, e-commerce, and auto-ordering — built for how you actually run your business.
              </p>
              <div className="mktf-social">
                <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="mktf-social-link">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
                </a>
                <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" aria-label="X / Twitter" className="mktf-social-link">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                </a>
                <a href="https://youtube.com" target="_blank" rel="noopener noreferrer" aria-label="YouTube" className="mktf-social-link">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>
                </a>
              </div>
            </div>

            {/* Link Groups */}
            {footerGroups.map((group) => (
              <div key={group.title} className="mktf-group">
                <h4 className="mktf-group-title">{group.title}</h4>
                <ul className="mktf-links">
                  {group.links.map((link) => (
                    <li key={link.name}>
                      <Link to={link.path}>{link.name}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Bottom bar */}
          <div className="mktf-bottom">
            <p>&copy; {currentYear} Storeveu. All rights reserved.</p>
            <div className="mktf-legal">
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/terms">Terms of Service</Link>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
};

export default MarketingFooter;
