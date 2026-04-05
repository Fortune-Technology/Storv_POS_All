import React from 'react';
import { Link } from 'react-router-dom';
import StoreveuLogo from '../StoreveuLogo';
import './MarketingFooter.css';

const MarketingFooter = () => {
  const currentYear = new Date().getFullYear();

  const footerGroups = [
    {
      title: 'Product',
      links: [
        { name: 'Features', path: '/features' },
        { name: 'Pricing', path: '/pricing' },
        { name: 'Live Dashboard', path: '/features#dashboard' },
        { name: 'AI Invoice Import', path: '/features#ocr' },
      ]
    },
    {
      title: 'Company',
      links: [
        { name: 'About Us', path: '/about' },
        { name: 'Contact', path: '/contact' },
        { name: 'Careers', path: '/about#careers' },
        { name: 'Privacy Policy', path: '/privacy' },
      ]
    },
    {
      title: 'Industries',
      links: [
        { name: 'Grocery & Supermarket', path: '/#industries' },
        { name: 'General Retail', path: '/#industries' },
        { name: 'Liquor & Wine', path: '/#industries' },
        { name: 'Meat & Food', path: '/#industries' },
      ]
    }
  ];

  return (
    <footer className="mkt-footer">
      <div className="mkt-footer-container">
        <div className="mkt-footer-grid">
          {/* Logo and About Col */}
          <div className="mkt-footer-brand">
            <Link to="/" className="mkt-footer-logo">
              <StoreveuLogo height={28} darkMode={false} />
            </Link>
            <p className="mkt-footer-desc">
              The smartest POS solution for modern retailers. Powered by AI to simplify your inventory, billing, and growth.
            </p>
            <div className="mkt-footer-social">
              {/* TODO: Add real social links */}
            </div>
          </div>

          {/* Link Groups */}
          {footerGroups.map((group) => (
            <div key={group.title} className="mkt-footer-group">
              <h4 className="mkt-footer-title">{group.title}</h4>
              <ul className="mkt-footer-links">
                {group.links.map((link) => (
                  <li key={link.name}>
                    <Link to={link.path}>{link.name}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mkt-footer-bottom">
          <p>© {currentYear} Storeveu. All rights reserved.</p>
          <div className="mkt-footer-legal">
            <Link to="/terms">Terms of Service</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/cookies">Cookies</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default MarketingFooter;
